process.env.OTP_HASH_SECRET = 'unit-test-secret';
import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../auth.service.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../utils/hash.js';
import { User, RefreshToken } from '@prisma/client';

// Mock the prisma client
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    oAuthAccount: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    role: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    passwordResetToken: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    otpChallenge: {
      updateMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    emailDelivery: {
      create: vi.fn().mockResolvedValue({ id: 'delivery-1', status: 'PENDING' }),
      update: vi.fn().mockResolvedValue({ id: 'delivery-1', status: 'FAILED' }),
    },
    securityEvent: {
      create: vi.fn(),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}));

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    authService = new AuthService();
  });

  describe('registerCustomer', () => {
    it('should register a new customer successfully', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null); // User does not exist
      vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({ id: 'role-1', name: 'CUSTOMER', description: '', createdAt: new Date(), updatedAt: new Date() });
      
      const mockUser = {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        passwordHash: 'hashedpassword',
        roleId: 'role-1',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      vi.mocked(prisma.user.create).mockResolvedValueOnce(mockUser as unknown as User);
      vi.mocked(prisma.refreshToken.create).mockResolvedValueOnce({
        id: 'token-1',
        userId: '11111111-1111-4111-8111-111111111111',
        tokenHash: 'tokenhash',
        expiresAt: new Date(),
        revoked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as RefreshToken);

      const result = await authService.registerCustomer('test@example.com', 'password123', 'John', 'Doe');

      expect(result.requiresVerification).toBe(true);
      expect(result.email).toBe('test@example.com');
      expect(result.message).toMatch(/verify/i);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });

    it('should throw if email already registered', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        passwordHash: 'hashedpassword',
        roleId: 'role-1',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: { id: 'role-1', name: 'CUSTOMER', description: '', createdAt: new Date(), updatedAt: new Date() }
      } as unknown as User);

      await expect(authService.registerCustomer('test@example.com', 'password123', 'John', 'Doe')).rejects.toThrow('Email already registered');
    });
  });

  describe('login', () => {
    it('should login successfully and return tokens', async () => {
      const passwordPlain = 'password123';
      const passwordHashed = await hashPassword(passwordPlain);
      
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        passwordHash: passwordHashed,
        roleId: 'role-1',
        isActive: true,
        emailVerifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        role: { id: 'role-1', name: 'CUSTOMER', description: '', createdAt: new Date(), updatedAt: new Date() }
      } as unknown as User);

      // Account re-read under the lifecycle lock when the session is issued
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ passwordHash: passwordHashed, isActive: true, roleId: 'role-1', emailVerifiedAt: new Date() } as unknown as User);
      vi.mocked(prisma.refreshToken.create).mockResolvedValueOnce({} as unknown as RefreshToken);

      const result = await authService.login('test@example.com', passwordPlain);
      if ('requiresVerification' in result) throw new Error('Expected success');

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user?.email).toBe('test@example.com');
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('should refuse to issue a session when the account changed after the password was verified', async () => {
      const passwordHashed = await hashPassword('password123');
      const account = {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        passwordHash: passwordHashed,
        roleId: 'role-1',
        isActive: true,
        emailVerifiedAt: new Date(),
        role: { id: 'role-1', name: 'CUSTOMER', description: '' },
      };
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(account as unknown as User);
      // Under the lock the password hash differs: a password change committed in between
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ ...account, passwordHash: 'changed-hash' } as unknown as User);

      await expect(authService.login('test@example.com', 'password123')).rejects.toThrow('Invalid credentials');

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0])
        .toBeLessThan(vi.mocked(prisma.user.findUnique).mock.invocationCallOrder[1]);
    });

    it('should throw on invalid password', async () => {
      const passwordHashed = await hashPassword('password123');
      
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        passwordHash: passwordHashed,
        roleId: 'role-1',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: { id: 'role-1', name: 'CUSTOMER', description: '', createdAt: new Date(), updatedAt: new Date() }
      } as unknown as User);

      await expect(authService.login('test@example.com', 'wrongpassword')).rejects.toThrow('Invalid credentials');
    });

    it('should throw on unknown email', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      await expect(authService.login('unknown@electrohub.com', 'password123')).rejects.toThrow('Invalid credentials');
    });

    it('should login valid ADMIN successfully with role ADMIN', async () => {
      const passwordPlain = 'admin123!';
      const passwordHashed = await hashPassword(passwordPlain);
      
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: '44444444-4444-4444-8444-444444444444',
        email: 'admin@electrohub.com',
        firstName: 'Admin',
        lastName: 'ElectroHub',
        passwordHash: passwordHashed,
        roleId: 'role-admin',
        isActive: true,
        emailVerifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        role: { id: 'role-admin', name: 'ADMIN', description: '', createdAt: new Date(), updatedAt: new Date() }
      } as unknown as User);

      // Account re-read under the lifecycle lock when the session is issued
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ passwordHash: passwordHashed, isActive: true, roleId: 'role-admin', emailVerifiedAt: new Date() } as unknown as User);
      vi.mocked(prisma.refreshToken.create).mockResolvedValueOnce({} as unknown as RefreshToken);

      const result = await authService.login('admin@electrohub.com', passwordPlain);
      if ('requiresVerification' in result) throw new Error('Expected success');

      expect(result.accessToken).toBeDefined();
      expect(result.user?.role).toBe('ADMIN');
      expect(result.user?.email).toBe('admin@electrohub.com');
    });

    it('registration unconditionally assigns CUSTOMER role server-side', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({ 
        id: 'role-cust', 
        name: 'CUSTOMER', 
        description: '', 
        createdAt: new Date(), 
        updatedAt: new Date() 
      });
      
      const mockUser = {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'hacker@example.com',
        firstName: 'Hacker',
        lastName: 'User',
        passwordHash: 'hashedpassword',
        roleId: 'role-cust',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      vi.mocked(prisma.user.create).mockResolvedValueOnce(mockUser as unknown as User);
      vi.mocked(prisma.refreshToken.create).mockResolvedValueOnce({} as unknown as RefreshToken);

      await authService.registerCustomer('hacker@example.com', 'password123', 'Hacker', 'User');

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          roleId: 'role-cust',
        }),
      });
    });
  });

  describe('refreshSession', () => {
    const rawToken = 'valid-test-refresh-token';
    const mockUser = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      passwordHash: 'hashed',
      roleId: 'role-1',
      isActive: true,
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      role: { id: 'role-1', name: 'CUSTOMER', description: '', createdAt: new Date(), updatedAt: new Date() },
    };

    const FAMILY_ID = '22222222-2222-4222-8222-222222222222';
    const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
    const activeRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'tok-1',
      userId: mockUser.id,
      tokenHash: 'hash-1',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isRevoked: false,
      familyId: FAMILY_ID,
      replacedByTokenHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as unknown as RefreshToken;

    it('should rotate a valid refresh token successfully and keep the successor in the same family', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(activeRow());
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as unknown as User);
      // Eligibility read inside the rotation transaction
      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce({ id: 'tok-1', familyId: FAMILY_ID } as unknown as RefreshToken);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 1 });
      vi.mocked(prisma.refreshToken.create).mockResolvedValueOnce({ id: 'tok-2' } as unknown as RefreshToken);

      const result = await authService.refreshSession(rawToken);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.userId).toBe(mockUser.id);
      const newHash = sha(result.refreshToken!);
      // Old token is revoked and linked to its successor in a single conditional update
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'tok-1', isRevoked: false, expiresAt: { gt: expect.any(Date) } },
        data: { isRevoked: true, replacedByTokenHash: newHash },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: { userId: mockUser.id, tokenHash: newHash, expiresAt: expect.any(Date), familyId: FAMILY_ID },
      });
    });

    it('should reject an expired refresh token with 401 AppError', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce({
        id: 'tok-expired',
        userId: mockUser.id,
        tokenHash: 'hash-expired',
        expiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour ago
        isRevoked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as RefreshToken);

      await expect(authService.refreshSession(rawToken)).rejects.toMatchObject({
        statusCode: 401,
        code: 'EXPIRED_REFRESH_TOKEN',
      });
    });

    it('should reject an unknown refresh token with 401 AppError', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(null);

      await expect(authService.refreshSession('unknown-token')).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
      });
    });

    it('should reject an inactive user with 401 AppError', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce({
        id: 'tok-1',
        userId: mockUser.id,
        tokenHash: 'hash-1',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        isRevoked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as RefreshToken);

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        ...mockUser,
        isActive: false,
      } as unknown as User);

      await expect(authService.refreshSession(rawToken)).rejects.toMatchObject({
        statusCode: 401,
        code: 'USER_INACTIVE',
      });
    });

    it('should detect reuse outside grace period and revoke all user refresh tokens', async () => {
      const revokedAt = new Date(Date.now() - 30_000); // 30 seconds ago (outside 10s grace)
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce({
        id: 'tok-stolen',
        userId: mockUser.id,
        tokenHash: 'hash-stolen',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        isRevoked: true,
        createdAt: new Date(Date.now() - 60_000),
        updatedAt: revokedAt,
      } as unknown as RefreshToken);

      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 3 });

      await expect(authService.refreshSession(rawToken)).rejects.toMatchObject({
        statusCode: 401,
        code: 'REFRESH_TOKEN_REUSED',
      });

      // Verifies all user tokens were revoked and expired
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
        data: { isRevoked: true, expiresAt: new Date(0) },
      });
    });

    it('should allow concurrent refresh within the 10-second grace window when the durable successor is active', async () => {
      const recentlyRevoked = new Date(Date.now() - 2_000);
      const tokenHash = sha(rawToken);

      vi.mocked(prisma.refreshToken.findUnique)
        .mockResolvedValueOnce(activeRow({ id: 'tok-racing', tokenHash, isRevoked: true, updatedAt: recentlyRevoked }))
        // Durable pointer written by the winning rotation
        .mockResolvedValueOnce({ userId: mockUser.id, familyId: FAMILY_ID, replacedByTokenHash: 'hash-replacement' } as unknown as RefreshToken);
      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce(
        activeRow({ id: 'tok-replacement', tokenHash: 'hash-replacement' })
      );
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as unknown as User);

      const result = await authService.refreshSession(rawToken);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeNull(); // Do not overwrite new cookie
      expect(result.userId).toBe(mockUser.id);
      // Successor must belong to the same user and family and still be active
      expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith({
        where: {
          tokenHash: 'hash-replacement',
          userId: mockUser.id,
          familyId: FAMILY_ID,
          isRevoked: false,
          expiresAt: { gt: expect.any(Date) },
        },
      });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('should reject grace refresh when the revoked token has no durable successor (e.g. logout, restart, other instance)', async () => {
      const recentlyRevoked = new Date(Date.now() - 2_000);
      const tokenHash = sha(rawToken);

      vi.mocked(prisma.refreshToken.findUnique)
        .mockResolvedValueOnce(activeRow({ tokenHash, isRevoked: true, updatedAt: recentlyRevoked }))
        .mockResolvedValueOnce({ userId: mockUser.id, familyId: FAMILY_ID, replacedByTokenHash: null } as unknown as RefreshToken);

      // An active token on another device must never be borrowed: no successor lookup happens at all.
      await expect(authService.refreshSession(rawToken)).rejects.toMatchObject({
        statusCode: 401,
        code: 'SESSION_REVOKED',
      });
      expect(prisma.refreshToken.findFirst).not.toHaveBeenCalled();
    });

    it('should reject concurrent grace refresh with 401 when the durable successor is no longer active (e.g. logged out)', async () => {
      const recentlyRevoked = new Date(Date.now() - 2_000);
      const tokenHash = sha(rawToken);

      vi.mocked(prisma.refreshToken.findUnique)
        .mockResolvedValueOnce(activeRow({ tokenHash, isRevoked: true, updatedAt: recentlyRevoked }))
        .mockResolvedValueOnce({ userId: mockUser.id, familyId: FAMILY_ID, replacedByTokenHash: 'hash-successor' } as unknown as RefreshToken);
      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce(null);

      await expect(authService.refreshSession(rawToken)).rejects.toMatchObject({
        statusCode: 401,
        code: 'SESSION_REVOKED',
      });
    });

    it('should reject refresh outside grace window (> 10s) and revoke all user tokens', async () => {
      const elevenSecondsAgo = new Date(Date.now() - 11_000); // 11s ago (> 10s grace boundary)
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(
        activeRow({ id: 'tok-past-grace', tokenHash: 'hash-past-grace', isRevoked: true, updatedAt: elevenSecondsAgo })
      );
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 2 });

      await expect(authService.refreshSession(rawToken)).rejects.toMatchObject({
        statusCode: 401,
        code: 'REFRESH_TOKEN_REUSED',
      });

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
        data: { isRevoked: true, expiresAt: expect.any(Date) },
      });
    });

    it('should resolve a lost rotation race from the winner durable successor', async () => {
      const tokenHash = sha(rawToken);

      vi.mocked(prisma.refreshToken.findUnique)
        .mockResolvedValueOnce(activeRow({ tokenHash }))
        .mockResolvedValueOnce({ userId: mockUser.id, familyId: FAMILY_ID, replacedByTokenHash: 'hash-winner' } as unknown as RefreshToken);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as unknown as User);
      // Inside our transaction the winner has already revoked the token: not eligible
      vi.mocked(prisma.refreshToken.findFirst)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(activeRow({ id: 'tok-winner', tokenHash: 'hash-winner' }));

      const result = await authService.refreshSession(rawToken);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeNull();
      expect(result.userId).toBe(mockUser.id);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('should reject losing race rotation if the token has no durable successor', async () => {
      vi.mocked(prisma.refreshToken.findUnique)
        .mockResolvedValueOnce(activeRow())
        .mockResolvedValueOnce({ userId: mockUser.id, familyId: FAMILY_ID, replacedByTokenHash: null } as unknown as RefreshToken);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as unknown as User);
      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce(null);

      await expect(authService.refreshSession(rawToken)).rejects.toMatchObject({
        statusCode: 401,
        code: 'SESSION_REVOKED',
      });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('should revoke the whole session family and expire it on logout, under the user lifecycle lock', async () => {
      vi.mocked(prisma.refreshToken.findUnique)
        .mockResolvedValueOnce({ userId: mockUser.id } as unknown as RefreshToken)
        .mockResolvedValueOnce({ familyId: FAMILY_ID } as unknown as RefreshToken);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 3 });

      await authService.logout('raw-logout-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id, familyId: FAMILY_ID },
        data: { isRevoked: true, expiresAt: new Date(0) },
      });
      expect(vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0])
        .toBeLessThan(vi.mocked(prisma.refreshToken.updateMany).mock.invocationCallOrder[0]);
    });

    it('should do nothing on logout with an unknown token', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(null);

      await authService.logout('unknown-logout-token');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('should propagate a PostgreSQL failure during logout so the caller can observe it', async () => {
      vi.mocked(prisma.refreshToken.findUnique)
        .mockResolvedValueOnce({ userId: mockUser.id } as unknown as RefreshToken)
        .mockResolvedValueOnce({ familyId: FAMILY_ID } as unknown as RefreshToken);
      vi.mocked(prisma.refreshToken.updateMany).mockRejectedValueOnce(new Error('PostgreSQL connection dropped'));

      await expect(authService.logout('failing-db-token')).rejects.toThrow('PostgreSQL connection dropped');
    });

    it('should invalidate all user sessions with expired timestamps on password change', async () => {
      const validHash = await hashPassword('password123');
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ ...mockUser, passwordHash: validHash } as unknown as User);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 4 });

      await authService.changePassword(mockUser.id, 'password123', 'newpassword456');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
        data: { isRevoked: true, expiresAt: new Date(0) },
      });
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('should take the user lifecycle advisory lock before any refresh_tokens statement during rotation', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(activeRow());
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as unknown as User);
      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce({ id: 'tok-1', familyId: FAMILY_ID } as unknown as RefreshToken);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 1 });
      vi.mocked(prisma.refreshToken.create).mockResolvedValueOnce({ id: 'tok-2' } as unknown as RefreshToken);

      await authService.refreshSession(rawToken);

      const lockOrder = vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(vi.mocked(prisma.refreshToken.findFirst).mock.invocationCallOrder[0]);
      expect(lockOrder).toBeLessThan(vi.mocked(prisma.refreshToken.updateMany).mock.invocationCallOrder[0]);
      expect(lockOrder).toBeLessThan(vi.mocked(prisma.refreshToken.create).mock.invocationCallOrder[0]);
      const [strings, userArg] = vi.mocked(prisma.$executeRaw).mock.calls[0] as unknown as [TemplateStringsArray, string];
      expect(strings.join('?')).toContain("pg_advisory_xact_lock(hashtext('user_token_lifecycle')");
      expect(userArg).toBe(mockUser.id);
    });

    it('should reject rotation and prevent successor insertion when racing password change commits first', async () => {
      vi.mocked(prisma.refreshToken.findUnique)
        .mockResolvedValueOnce(activeRow({ tokenHash: sha(rawToken) }))
        .mockResolvedValueOnce({ userId: mockUser.id, familyId: FAMILY_ID, replacedByTokenHash: null } as unknown as RefreshToken);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as unknown as User);
      // Racing password change committed first: the token is no longer eligible inside our transaction
      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce(null);

      await expect(authService.refreshSession(rawToken)).rejects.toMatchObject({
        statusCode: 401,
        code: 'SESSION_REVOKED',
      });

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('should surface a transaction failure unchanged, without a 401, so the cookie is preserved', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(activeRow());
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as unknown as User);
      const failure = new Error('PostgreSQL transaction serialization failure');
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(failure);

      await expect(authService.refreshSession(rawToken)).rejects.toBe(failure);
    });

    it('should not swallow a failed statement and keep using the transaction (no pre-migration fallback)', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(activeRow());
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as unknown as User);
      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce({ id: 'tok-1', familyId: FAMILY_ID } as unknown as RefreshToken);
      const missingColumn = new Error('column "replacedByTokenHash" of relation "refresh_tokens" does not exist');
      vi.mocked(prisma.refreshToken.updateMany).mockRejectedValueOnce(missingColumn);

      await expect(authService.refreshSession(rawToken)).rejects.toBe(missingColumn);

      // The transaction stops at the failing statement: nothing is inserted after it.
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('should resolve successors with typed queries only (no raw SQL, no schema-compatibility catch)', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(
        { userId: mockUser.id, familyId: FAMILY_ID, replacedByTokenHash: 'hash-successor-db' } as unknown as RefreshToken
      );
      const durableSuccessor = activeRow({ id: 'tok-durable-succ', tokenHash: 'hash-successor-db' });
      vi.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce(durableSuccessor);

      const found = await authService['repository'].findRotationSuccessor(sha('db-durable-token'));

      expect(found).toEqual(durableSuccessor);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('should propagate a database error from the successor lookup instead of falling back to memory', async () => {
      const failure = new Error('connection terminated');
      vi.mocked(prisma.refreshToken.findUnique).mockRejectedValueOnce(failure);

      await expect(authService['repository'].findRotationSuccessor(sha('any'))).rejects.toBe(failure);
    });
  });
});
