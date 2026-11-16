// Render-blocking same-origin initializer. Mirror themePreference.ts before React or CSS paints.
(function () {
  var theme = null;
  var customerKey = 'electrohub:theme:customer';
  var adminKey = 'electrohub:theme:admin';
  function valid(value) { return value === 'light' || value === 'dark'; }
  try {
    var legacy = window.localStorage.getItem('electrohub:theme');
    if (legacy !== null) {
      if (valid(legacy) && !valid(window.localStorage.getItem(customerKey))) window.localStorage.setItem(customerKey, legacy);
      window.localStorage.removeItem('electrohub:theme');
    }
  } catch (error) { /* migration unavailable */ }
  try {
    var stored = window.localStorage.getItem(/^\/admin(?:\/|$)/.test(window.location.pathname) ? adminKey : customerKey);
    if (valid(stored)) theme = stored;
  } catch (error) { /* storage unavailable */ }
  if (!theme) {
    try { theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
    catch (error) { theme = 'light'; }
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
