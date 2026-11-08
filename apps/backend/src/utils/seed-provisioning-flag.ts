/** Operator seed provisioning (and everything that points to it) exists only when explicitly enabled, and never in production. */
export const seedProvisioningRoutesEnabled = (config: { NODE_ENV: string; ADMIN_SEED_PROVISIONING_ENABLED?: string }) =>
  config.ADMIN_SEED_PROVISIONING_ENABLED === 'true' && config.NODE_ENV !== 'production';
