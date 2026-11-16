'use strict';
// Task 04.3 DEV-only entrypoint. PROD deployment is handled by the exact reviewed migration workflow.
require('./dev-migrate.cjs')(process.argv[2], {
  entrypoint: 'product-media-migrate.cjs',
  approvedMigrations: '20261028000000_product_media,20261028010000_catalog_media_overlay,20261028020000_product_media_worker_health',
});
