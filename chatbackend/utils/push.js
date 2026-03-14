const webpush = require('web-push')

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'

const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)

if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

function isPushEnabled() {
  return pushEnabled
}

function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY
}

async function sendPushNotification(subscription, payload) {
  if (!pushEnabled) return { skipped: true, reason: 'vapid_not_configured' }
  return webpush.sendNotification(subscription, JSON.stringify(payload), {
    TTL: 45,
    urgency: 'high',
  })
}

module.exports = {
  isPushEnabled,
  getVapidPublicKey,
  sendPushNotification,
}

