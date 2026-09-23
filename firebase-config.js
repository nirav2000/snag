// Central cloud configuration for Snag Recorder.
// Firebase web API keys are public project identifiers. Access is enforced by
// Firebase Authentication and Firestore Security Rules.
//
// Historical builds loaded firebase-config.js directly. Keep this compatibility
// surface stable so Version Lab can run old UIs against the current backend
// without rewiring every archived build.
const SNAG_PRIMARY_FIREBASE = {
  apiKey: 'AIzaSyBnph6Ob5jhvJZMGvk1cpF0euno__aRtfU',
  authDomain: 'snag-509418.firebaseapp.com',
  projectId: 'snag-509418',
  storageBucket: 'snag-509418.firebasestorage.app',
  messagingSenderId: '316637882706',
  appId: '1:316637882706:web:cde1ed38b47a4c27f3b28b'
};

const SNAG_LEGACY_FIREBASE = {
  apiKey: 'AIzaSyDrreK9rhsoOpIYNr4QeNZ7CsXgQiMPW0E',
  authDomain: 'kk-syllabus.firebaseapp.com',
  projectId: 'kk-syllabus',
  storageBucket: 'kk-syllabus.firebasestorage.app',
  messagingSenderId: '821660665663',
  appId: '1:821660665663:web:c708860329bb97dc24758a'
};

window.SNAG_FIREBASE_CONFIG = SNAG_PRIMARY_FIREBASE;
window.SNAG_CLOUD = {
  firebase: SNAG_PRIMARY_FIREBASE,
  primary: SNAG_PRIMARY_FIREBASE,
  legacy: SNAG_LEGACY_FIREBASE,
  schemaVersion: 2,
  migrationVersion: 1,
  legacyReadOnly: true,
  appId: 'snag',
  appName: 'Snag Recorder'
};

// Media remains on Cloudflare R2 and is not part of the Firestore project move.
window.SNAG_R2_API = 'https://snag-media-api.nirav2000-github.workers.dev';
