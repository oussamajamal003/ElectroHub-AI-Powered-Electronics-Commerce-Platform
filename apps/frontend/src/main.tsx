// Start both module downloads together; auth's small dependency graph can
// restore the session while the React application is still downloading.
void import('./features/auth/sessionRestore').then(({ preloadSessionRestore }) => preloadSessionRestore());
void import('./render');
