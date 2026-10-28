// Mount the application as part of the entry module so direct route loads are
// available before the browser finishes any optional session preloading.
import './render';

void import('./features/auth/sessionRestore').then(({ preloadSessionRestore }) =>
  preloadSessionRestore(),
);
