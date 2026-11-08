import { AdminInvitationDelivery, AdminInvitationStatus, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const row: Record<string, unknown> = {};
  let transactionTail = Promise.resolve();
  const invitation = {
    findFirst: vi.fn(async (): Promise<unknown> => null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(row, { id: 'invite-id', status: AdminInvitationStatus.PENDING, ...data });
      return { ...row };
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(row, data);
      return { ...row, invitedBy: null };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (where.tokenHash !== row.tokenHash) return { count: 0 };
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'object' && value !== null && 'increment' in value) {
          row[key] = Number(row[key] ?? 0) + Number((value as { increment: number }).increment);
        } else row[key] = value;
      }
      return { count: 1 };
    }),
    findUnique: vi.fn(async () => ({ ...row, invitedBy: null })),
  };
  const db: Record<string, unknown> = {
    adminInvitation: invitation,
    adminAccountSecurity: { findUnique: vi.fn(async () => ({ isOwner: false })) },
    user: {
      findUnique: vi.fn(async () => ({ firstName: 'Owner', lastName: 'Admin' })),
      findFirst: vi.fn(async (): Promise<unknown> => null),
    },
    $queryRaw: vi.fn(async () => [{ id: 'invite-id', status: AdminInvitationStatus.PENDING,
      lastSentAt: row.lastSentAt ?? null, email: 'invitee@example.com' }]),
    $transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) => {
      const next = transactionTail.then(() => callback(db));
      transactionTail = next.then(() => undefined, () => undefined);
      return next;
    }),
  };
  return { row, invitation, db, reset() { transactionTail = Promise.resolve(); } };
});

const audit = vi.hoisted(() => ({ recordAdminAudit: vi.fn(async () => undefined) }));
const email = vi.hoisted(() => ({ sendAdminInvitationEmail: vi.fn(async () => true) }));

vi.mock('../../lib/prisma.js', () => ({ prisma: state.db }));
vi.mock('../admin-audit.js', () => ({ recordAdminAudit: audit.recordAdminAudit }));
vi.mock('../admin-invitation-email.js', () => ({ sendAdminInvitationEmail: email.sendAdminInvitationEmail }));
vi.mock('../admin-mfa.service.js', () => ({ adminMfaService: {}, INVITE_ENROLLMENT_WINDOW_MS: 86_400_000 }));
vi.mock('../../sockets/delivery.publisher.js', () => ({ DeliveryPublisher: {} }));
vi.mock('../admin-notification.service.js', () => ({ adminNotifications: {} }));

import { AdminTeamService } from '../admin-team.service.js';
import { AppError } from '../../middleware/errorHandler.js';

describe('AdminTeamService.resendInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.reset();
    for (const key of Object.keys(state.row)) delete state.row[key];
    Object.assign(state.row, { tokenHash: 'initial', deliveryStatus: AdminInvitationDelivery.SENT, sendCount: 1 });
    email.sendAdminInvitationEmail.mockResolvedValue(true);
  });

  it('reserves the resend cooldown before sending so concurrent resends cannot invalidate each other’s link', async () => {
    const service = new AdminTeamService();
    const results = await Promise.allSettled([
      service.resendInvitation({ userId: 'owner-id' }, 'invite-id'),
      service.resendInvitation({ userId: 'owner-id' }, 'invite-id'),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(AppError);
      expect((rejected.reason as AppError).code).toBe('RESEND_COOLDOWN');
    }
    expect(email.sendAdminInvitationEmail).toHaveBeenCalledTimes(1);
  });

  it('records failed delivery and permits a retry after the reserved cooldown expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    try {
      email.sendAdminInvitationEmail.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const service = new AdminTeamService();
      const failed = await service.resendInvitation({ userId: 'owner-id' }, 'invite-id');

      expect(failed.deliveryStatus).toBe(AdminInvitationDelivery.FAILED);
      expect(state.row.lastSentAt).toEqual(new Date('2026-11-05T12:00:00Z'));

      vi.setSystemTime(new Date('2026-11-05T12:01:01Z'));
      const retried = await service.resendInvitation({ userId: 'owner-id' }, 'invite-id');
      expect(retried.deliveryStatus).toBe(AdminInvitationDelivery.SENT);
      expect(email.sendAdminInvitationEmail).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let an older send completion overwrite the newer token generation status', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    let finishFirst!: (sent: boolean) => void;
    let firstStarted!: () => void;
    const started = new Promise<void>(resolve => { firstStarted = resolve; });
    const firstResult = new Promise<boolean>(resolve => { finishFirst = resolve; });
    email.sendAdminInvitationEmail.mockImplementationOnce(async () => { firstStarted(); return firstResult; })
      .mockResolvedValueOnce(true);
    try {
      const service = new AdminTeamService();
      const first = service.resendInvitation({ userId: 'owner-id' }, 'invite-id');
      await started;

      vi.setSystemTime(new Date('2026-11-05T12:01:01Z'));
      await service.resendInvitation({ userId: 'owner-id' }, 'invite-id');
      const newerLastSentAt = state.row.lastSentAt;
      expect(state.row.deliveryStatus).toBe(AdminInvitationDelivery.SENT);

      finishFirst(true);
      await first;
      expect(state.row.deliveryStatus).toBe(AdminInvitationDelivery.SENT);
      expect(state.row.lastSentAt).toBe(newerLastSentAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reserves the initial delivery so resend cannot replace a token while create invitation email is in flight', async () => {
    let finishFirst!: (sent: boolean) => void;
    let firstStarted!: () => void;
    const started = new Promise<void>(resolve => { firstStarted = resolve; });
    const firstResult = new Promise<boolean>(resolve => { finishFirst = resolve; });
    email.sendAdminInvitationEmail.mockImplementationOnce(async () => { firstStarted(); return firstResult; });
    const service = new AdminTeamService();
    const creating = service.createInvitation({ userId: 'owner-id' }, { email: 'invitee@example.com', grantManageAdmins: false });
    await started;

    await expect(service.resendInvitation({ userId: 'owner-id' }, 'invite-id')).rejects.toMatchObject({ code: 'RESEND_COOLDOWN' });
    expect(email.sendAdminInvitationEmail).toHaveBeenCalledTimes(1);
    finishFirst(true);
    await creating;
  });
});

describe('AdminTeamService.createInvitation collisions', () => {
  const owner = { userId: 'owner-id' };
  const db = state.db as { user: { findFirst: ReturnType<typeof vi.fn> } };
  beforeEach(() => {
    vi.clearAllMocks();
    state.reset();
    for (const key of Object.keys(state.row)) delete state.row[key];
    state.invitation.findFirst.mockResolvedValue(null);
    db.user.findFirst.mockReset().mockResolvedValue(null);
    email.sendAdminInvitationEmail.mockResolvedValue(true);
  });

  it.each([['active ADMIN'], ['inactive ADMIN']])('rejects an existing %s without creating an invitation', async () => {
      db.user.findFirst.mockResolvedValue({ role: { name: 'ADMIN' } });
      await expect(new AdminTeamService().createInvitation(owner, { email: 'person@example.com', grantManageAdmins: false }))
        .rejects.toMatchObject({ statusCode: 409, code: 'ADMIN_ALREADY_EXISTS' });
      expect(state.invitation.create).not.toHaveBeenCalled();
      expect(email.sendAdminInvitationEmail).not.toHaveBeenCalled();
    });

  it.each([['CUSTOMER', { role: { name: 'CUSTOMER' } }], ['pending email reservation', null]])(
    'rejects an existing %s with a generic conflict', async (_label, primary) => {
      db.user.findFirst.mockResolvedValueOnce(primary).mockResolvedValueOnce({ id: 'existing-user' });
      await expect(new AdminTeamService().createInvitation(owner, { email: 'person@example.com', grantManageAdmins: false }))
        .rejects.toMatchObject({ statusCode: 409, code: 'ACCOUNT_EXISTS' });
      expect(state.invitation.create).not.toHaveBeenCalled();
      expect(email.sendAdminInvitationEmail).not.toHaveBeenCalled();
    });

  it('matches the normalized address against both the account email and a pending email change', async () => {
    db.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'existing-user' });
    await expect(new AdminTeamService().createInvitation(owner, { email: '  Person@Example.COM ', grantManageAdmins: false })).rejects.toBeInstanceOf(AppError);
    expect(db.user.findFirst).toHaveBeenNthCalledWith(1, { where: { email: { equals: 'person@example.com', mode: 'insensitive' } }, select: { role: { select: { name: true } } } });
    expect(db.user.findFirst).toHaveBeenNthCalledWith(2, { where: { pendingEmail: { equals: 'person@example.com', mode: 'insensitive' } }, select: { id: true } });
  });

  it('keeps a live pending invitation distinct from an account collision', async () => {
    state.invitation.findFirst.mockResolvedValue({ id: 'pending-id', expiresAt: new Date(Date.now() + 60_000) });
    await expect(new AdminTeamService().createInvitation(owner, { email: 'person@example.com', grantManageAdmins: false }))
      .rejects.toMatchObject({ statusCode: 409, code: 'INVITATION_EXISTS' });
    expect(state.invitation.create).not.toHaveBeenCalled();
  });

  it('closes an expired pending invitation as history and issues a new one', async () => {
    state.invitation.findFirst.mockResolvedValue({ id: 'expired-id', expiresAt: new Date(Date.now() - 60_000) });
    await new AdminTeamService().createInvitation(owner, { email: 'person@example.com', grantManageAdmins: false });
    expect(state.invitation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'expired-id' }, data: expect.objectContaining({ status: AdminInvitationStatus.REVOKED }) }));
    expect(state.invitation.create).toHaveBeenCalledTimes(1);
  });

  it('reports a concurrent invitation race (unique violation) as INVITATION_EXISTS', async () => {
    state.invitation.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }));
    await expect(new AdminTeamService().createInvitation(owner, { email: 'person@example.com', grantManageAdmins: false }))
      .rejects.toMatchObject({ statusCode: 409, code: 'INVITATION_EXISTS' });
  });
});
