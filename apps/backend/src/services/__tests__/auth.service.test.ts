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
    role: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    passwordResetToken: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
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
        id: 'user-1',
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
        userId: 'user-1',
        tokenHash: 'tokenhash',
        expiresAt: new Date(),
        revoked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as RefreshToken);

      const result = await authService.registerCustomer('test@example.com', 'password123', 'John', 'Doe');

      expect(result.user).toEqual({
        id: 'user-1',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'CUSTOMER',
      });
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });

    it('should throw if email already registered', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
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
        id: 'user-1',
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

      vi.mocked(prisma.refreshToken.create).mockResolvedValueOnce({} as unknown as RefreshToken);

      const result = await authService.login('test@example.com', passwordPlain);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe('test@example.com');
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('should throw on invalid password', async () => {
      const passwordHashed = await hashPassword('password123');
      
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
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
        id: 'admin-1',
        email: 'admin@electrohub.com',
        firstName: 'Admin',
        lastName: 'ElectroHub',
        passwordHash: passwordHashed,
        roleId: 'role-admin',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: { id: 'role-admin', name: 'ADMIN', description: '', createdAt: new Date(), updatedAt: new Date() }
      } as unknown as User);

      vi.mocked(prisma.refreshToken.create).mockResolvedValueOnce({} as unknown as RefreshToken);

      const result = await authService.login('admin@electrohub.com', passwordPlain);

      expect(result.accessToken).toBeDefined();
      expect(result.user.role).toBe('ADMIN');
      expect(result.user.email).toBe('admin@electrohub.com');
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
        id: 'user-2',
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

      const result = await authService.registerCustomer('hacker@example.com', 'password123', 'Hacker', 'User');

      expect(result.user.role).toBe('CUSTOMER');
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          roleId: 'role-cust',
        }),
      });
    });
  });
});
