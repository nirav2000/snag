importScripts('./sw.js');
self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification?.data?.FCM_MSG?.data?.url||event.notification?.data?.url||'./';event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const client of list){if('focus' in client){client.navigate(url);return client.focus()}}if(clients.openWindow)return clients.openWindow(url)}))});
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');
const params=new URL(self.location.href).searchParams;
const config={apiKey:params.get('apiKey')||'',authDomain:params.get('authDomain')||undefined,projectId:params.get('projectId')||'',messagingSenderId:params.get('messagingSenderId')||'',appId:params.get('appId')||''};
if(config.apiKey&&config.projectId&&config.appId){firebase.initializeApp(config);firebase.messaging()}
