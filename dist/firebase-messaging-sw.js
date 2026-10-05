importScripts('./firebase-config.js');

const settings = globalThis.NOVELNEST_FIREBASE;
if (settings?.enabled && settings.config?.apiKey && settings.config?.projectId) {
  importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');
  firebase.initializeApp(settings.config);
  firebase.messaging();
}
