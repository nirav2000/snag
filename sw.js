self.APPS_PWA_CONFIG={
  cacheName:'snag-static-v56',
  cachePrefix:'snag-static-',
  defaultStrategy:'cache-first',
  precache:['./styles.css?v=2026.11.02.1911','./notes.css?v=2026.11.02.1911','./theme-coral.css?v=2026.11.02.1911','./home-themes.css?v=2026.11.02.1911','./ui-refinements.css?v=2026.11.02.1911','./ui-polish.css?v=2026.11.02.1911','./layout-system.css?v=2026.11.02.1911','./welcome-v4.css?v=2026.11.02.1911','./pricing.css?v=2026.11.02.1911','./assets/hero-before.jpg','./assets/hero-after.jpg','./assets/hero-phone-wall.jpg','./assets/process-capture.jpg','./assets/process-assign.jpg','./assets/process-track.jpg','./assets/process-resolve.jpg','./manifest.webmanifest','./icon.svg'],
  networkFirstPaths:['/snag/','/index.html','/app.js','/notes.js','/firebase-config.js','/legacy-bridge.html','/version-lab.html','/version.json','/release.js','/home-themes.js','/home-themes.css','/ui-refinements.css','/ui-polish.css','/layout-system.css','/snag-bulk.mjs','/snag-export.js','/snag-export-ui.js','/welcome.html','/pricing.html','/privacy.html','/terms.html','/sw.js']
};
importScripts('https://nirav2000.github.io/Apps/pwa/v1/service-worker.js');
