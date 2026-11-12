// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs before the first paint: puts the saved theme on <html>, so a dark theme never flashes light.
// Keep the key in step with THEME_STORAGE_KEY in src/composables/useTheme.ts.
try {
  var theme = localStorage.getItem('aurelia.theme')
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
} catch {
  // Storage blocked: the page follows the system theme.
}
