// Applique le thème choisi avant le premier rendu (évite le flash clair/sombre).
// Fichier séparé plutôt que script en ligne : compatible avec une CSP stricte (script-src 'self').
try {
  var theme = localStorage.getItem('bouffe.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch (e) {
  /* stockage indisponible : thème automatique */
}
