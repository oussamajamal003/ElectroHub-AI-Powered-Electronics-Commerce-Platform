import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Task 05.2 sanitized administrative audit. `details` must hold only identifiers, versions and enumerated values: never tokens,
 * codes, passwords, raw request bodies, addresses or free-text customer data. Pass the transaction client to make the audit row
 * commit or roll back with the change it describes.
 */
export interface AdminAuditEntry {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: 'SUCCESS' | 'DENIED' | 'FAILED' | 'PARTIAL';
  details?: Prisma.InputJsonValue;
  requestId?: string | null;
}

export async function recordAdminAudit(entry: AdminAuditEntry, client: Prisma.TransactionClient = prisma): Promise<void> {
  await client.adminAuditLog.create({
    data: {
      actorId: entry.actorId, action: entry.action, resourceType: entry.resourceType, resourceId: entry.resourceId ?? null,
      outcome: entry.outcome, details: entry.details, requestId: entry.requestId?.slice(0, 64) ?? null,
    },
  });
}
