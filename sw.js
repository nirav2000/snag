self.APPS_PWA_CONFIG={
  cacheName:'snag-static-v45',
  cachePrefix:'snag-static-',
  defaultStrategy:'cache-first',
  precache:['./styles.css?v=2026.09.28.1053','./notes.css?v=2026.09.28.1053','./theme-coral.css?v=2026.09.28.1053','./welcome-v4.css?v=2026.09.28.1053','./pricing.css?v=2026.09.28.1053','./assets/hero-before.jpg','./assets/hero-after.jpg','./assets/hero-phone-wall.jpg','./assets/process-capture.jpg','./assets/process-assign.jpg','./assets/process-track.jpg','./assets/process-resolve.jpg','./manifest.webmanifest','./icon.svg'],
  networkFirstPaths:['/snag/','/index.html','/app.js','/notes.js','/firebase-config.js','/legacy-bridge.html','/version-lab.html','/version.json','/release.js','/welcome.html','/pricing.html','/privacy.html','/terms.html','/sw.js']
};
importScripts('https://nirav2000.github.io/Apps/pwa/v1/service-worker.js');
