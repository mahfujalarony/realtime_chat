self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const title = payload.title || 'Incoming call'
  const options = {
    body: payload.body || 'Open chat to answer.',
    icon: '/vite.svg',
    badge: '/vite.svg',
    tag: payload.roomId ? `call-${payload.roomId}` : 'incoming-call',
    renotify: true,
    requireInteraction: true,
    data: {
      url: payload.url || '/',
      roomId: payload.roomId || '',
      callType: payload.callType || 'video',
      fromUser: payload.fromUser || null,
    },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification?.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({
            type: 'notification_click',
            payload: event.notification?.data || {},
          })
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
      return null
    }),
  )
})

