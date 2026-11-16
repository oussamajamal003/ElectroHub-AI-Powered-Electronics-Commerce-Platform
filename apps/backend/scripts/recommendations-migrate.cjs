'use strict';
// Task 04.4 DEV-only entrypoint. PROD deployment is handled by the exact reviewed migration workflow.
require('./dev-migrate.cjs')(process.argv[2], {
  entrypoint: 'recommendations-migrate.cjs',
  approvedMigrations: '20261029000000_recommendations,20261029010000_recommendation_retention_index,20261029020000_recommendation_consent_consistency',
});
