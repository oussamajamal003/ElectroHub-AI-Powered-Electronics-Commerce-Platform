import { describe, expect, it, vi } from 'vitest';
import { GoogleService } from '../google.service.js';
import type { GoogleRepository } from '../../repositories/google.repository.js';

describe('Google account-deletion re-authentication', () => {
  it('accepts only the linked Google subject for the active customer', async () => {
    const findIdentity = vi.fn().mockResolvedValue({ user: { id: 'customer-id', isActive: true, role: { name: 'CUSTOMER' } } });
    const repository = { findIdentity } as unknown as GoogleRepository;
    const service = new GoogleService(repository);

    await expect(service.verifyDeletionIdentity('customer-id', 'linked-subject')).resolves.toBeUndefined();
    await expect(service.verifyDeletionIdentity('another-customer', 'linked-subject')).rejects.toMatchObject({ code: 'ACCOUNT_REAUTH_IDENTITY_MISMATCH', statusCode: 403 });
    expect(findIdentity).toHaveBeenCalledWith('linked-subject');
  });

  it('rejects an inactive or non-customer linked identity', async () => {
    const findIdentity = vi.fn().mockResolvedValue({ user: { id: 'customer-id', isActive: false, role: { name: 'CUSTOMER' } } });
    const service = new GoogleService({ findIdentity } as unknown as GoogleRepository);

    await expect(service.verifyDeletionIdentity('customer-id', 'linked-subject')).rejects.toMatchObject({ code: 'ACCOUNT_REAUTH_IDENTITY_MISMATCH' });
  });

  it('rejects an unlinked identity even when its email would match', async () => {
    const findIdentity = vi.fn().mockResolvedValue(null);
    const service = new GoogleService({ findIdentity } as unknown as GoogleRepository);

    await expect(service.verifyDeletionIdentity('customer-id', 'different-subject')).rejects.toMatchObject({ code: 'ACCOUNT_REAUTH_IDENTITY_MISMATCH' });
  });
});
