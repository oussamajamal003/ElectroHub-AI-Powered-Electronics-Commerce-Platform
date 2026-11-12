// ElectroHub — pre-paint theme initialisation.
// Loaded as a classic, render-blocking, same-origin script in <head> (compatible with a `script-src 'self'` CSP; no
// inline script) so <html data-theme> is set before the first paint and dark-mode users never see a light flash.
// Mirrors src/features/theme/themePreference.ts: saved explicit choice → prefers-color-scheme → light.
(function () {
  var theme = null;
  try {
    var stored = window.localStorage.getItem('electrohub:theme');
    if (stored === 'light' || stored === 'dark') theme = stored;
  } catch (error) {
    /* storage unavailable: fall through to the system preference */
  }
  if (!theme) {
    try {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (error) {
      theme = 'light';
    }
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
