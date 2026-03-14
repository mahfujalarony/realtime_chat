const express = require('express')
const authMiddleware = require('../middleware/auth')
const { PushSubscription } = require('../models')
const { getVapidPublicKey, isPushEnabled } = require('../utils/push')

const router = express.Router()

router.get('/vapid-public-key', authMiddleware, (req, res) => {
  if (!isPushEnabled()) {
    return res.status(503).json({ message: 'Push notifications are not configured on server' })
  }
  return res.json({ publicKey: getVapidPublicKey() })
})

router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    if (!isPushEnabled()) {
      return res.status(503).json({ message: 'Push notifications are not configured on server' })
    }

    const subscription = req.body?.subscription || req.body
    const endpoint = String(subscription?.endpoint || '').trim()
    const p256dh = String(subscription?.keys?.p256dh || '').trim()
    const auth = String(subscription?.keys?.auth || '').trim()
    const contentEncoding = String(subscription?.contentEncoding || '').trim() || null
    const expirationTime =
      subscription?.expirationTime === null || subscription?.expirationTime === undefined
        ? null
        : Number(subscription.expirationTime)

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ message: 'Invalid subscription payload' })
    }

    await PushSubscription.upsert({
      userId: req.user.id,
      endpoint,
      p256dh,
      auth,
      contentEncoding,
      expirationTime: Number.isFinite(expirationTime) ? expirationTime : null,
    })
    return res.status(201).json({ ok: true })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save push subscription', error: error.message })
  }
})

router.post('/unsubscribe', authMiddleware, async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || '').trim()
    if (!endpoint) return res.status(400).json({ message: 'endpoint is required' })
    await PushSubscription.destroy({
      where: { userId: req.user.id, endpoint },
    })
    return res.json({ ok: true })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to remove push subscription', error: error.message })
  }
})

module.exports = router

