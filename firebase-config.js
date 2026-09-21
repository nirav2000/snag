// Public client configuration for the shared kk-syllabus Firebase project.
// Firebase web API keys are identifiers, not service-account secrets. Access is
// controlled by Authentication and Firestore rules.
window.SNAG_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDrreK9rhsoOpIYNr4QeNZ7CsXgQiMPW0E',
  authDomain: 'kk-syllabus.firebaseapp.com',
  projectId: 'kk-syllabus',
  storageBucket: 'kk-syllabus.firebasestorage.app',
  messagingSenderId: '821660665663',
  appId: '1:821660665663:web:c708860329bb97dc24758a'
};
window.SNAG_CLOUD = {
  firebase: window.SNAG_FIREBASE_CONFIG,
  ownerUid: '2AJSfYdtg5URWHv7HCzpNMmKIlg2',
  appId: 'snag',
  appName: 'Snag Recorder'
};
// Set this to the deployed Cloudflare Worker URL once the R2 binding is ready.
// Example: https://snag-media-api.<account>.workers.dev
window.SNAG_R2_API = 'https://snag-media-api.nirav2000-github.workers.dev';
