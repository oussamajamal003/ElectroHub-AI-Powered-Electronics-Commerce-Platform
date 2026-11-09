import { ApiError } from '@/lib/api';
import type { AdminCapabilities } from './api';

/**
 * Who may open the Administrators page. Mirrors the server's MANAGE_ADMINS capability (an Owner always holds it); the server
 * stays authoritative, this only decides what the console shows and whether it asks for team data at all.
 */
export const canAccessAdministrators = (capabilities: AdminCapabilities | null | undefined) =>
  Boolean(capabilities && (capabilities.isOwner || capabilities.canManageAdmins));

/** The server's answer when this administrator's capabilities no longer allow the request (not a network or server fault). */
export const isCapabilityDenied = (error: unknown) =>
  error instanceof ApiError && error.status === 403 && error.code === 'CAPABILITY_REQUIRED';
