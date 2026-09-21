// The service worker exists for exactly one reason: a browser will only
// deliver a push to one of these. It handles `push` and `notificationclick`
// and nothing else.
//
// Deliberately NO fetch handler and no caching. A caching service worker on
// GitHub Pages is how a site ends up serving a build from three weeks ago to
// someone who cannot work out why the page is wrong, and this app has no
// offline story to gain from it.

self.addEventListener('push', (event) => {
  // A push with an unreadable payload still has to show something: iOS
  // revokes the permission of a web app that receives a push and displays
  // nothing, so there is no silent path out of here.
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const title = typeof payload.title === 'string' && payload.title !== '' ? payload.title : 'Geng Turun Peluh'
  const body = typeof payload.body === 'string' ? payload.body : ''
  const url = typeof payload.url === 'string' ? payload.url : '/sepak/'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/sepak/icon-192.png',
      badge: '/sepak/icon-192.png',
      // One promotion should replace its own earlier notification rather
      // than stack, if two ever arrive.
      tag: 'gtp-promotion',
      data: { url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/sepak/'

  event.waitUntil(
    (async () => {
      // Reuse an open window where there is one -- opening a second copy of
      // the app on top of the one they already had is disorienting.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if (client.url.includes('/sepak/')) {
          await client.focus()
          if ('navigate' in client) await client.navigate(url)
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
