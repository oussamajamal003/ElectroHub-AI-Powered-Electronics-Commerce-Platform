'use strict';
// Task 05.2 DEV-only entrypoint. PROD deployment is handled by the exact reviewed migration workflow.
require('./dev-migrate.cjs')(process.argv[2], {
  entrypoint: 'admin-security-migrate.cjs',
  approvedMigrations: '20261107000000_admin_password_recovery',
});
