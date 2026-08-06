// Service Worker for Time Tracker Web Push Notifications

self.addEventListener('push', function(event) {
  let data = { title: '⏱️ Time Tracker Alert', body: 'Break or Lunch warning alert' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    vibrate: [500, 200, 500, 200, 500, 200, 1000, 500, 1000],
    tag: data.tag || 'time-tracker-alarm',
    requireInteraction: true, // Keep notification pinned on screen until user interacts!
    renotify: true,
    data: {
      url: '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        let client = clientList[i];
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
