// Mount the application as part of the entry module so direct route loads are
// available before the browser finishes any optional session preloading.
import './render';

void import('./features/auth/sessionRestore').then(({ preloadSessionRestore }) => {
  // Each scope starts its own restore only for its own identity hint; neither authorizes anything.
  preloadSessionRestore('customer');
  if (window.location.pathname.startsWith('/admin')) preloadSessionRestore('admin');
});
