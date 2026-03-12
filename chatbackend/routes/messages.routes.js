const express = require('express')
const { Op } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { Message, User, Contact } = require('../models')

const router = express.Router()

function isSenderMediaUrlValid(mediaUrl, username, messageType) {
  try {
    const parsed = new URL(mediaUrl)
    const pathname = decodeURIComponent(parsed.pathname).toLowerCase()
    const userPath = `/chat/${String(username).toLowerCase()}/`
    if (!pathname.includes(userPath)) return false

    if (messageType === 'image') {
      return pathname.includes(`${userPath}images/`)
    }
    if (messageType === 'video') {
      return pathname.includes(`${userPath}videos/`)
    }
    if (messageType === 'audio') {
      return pathname.includes(`${userPath}audios/`)
    }
    if (messageType === 'file') {
      return pathname.includes(`${userPath}files/`)
    }
    return false
  } catch (error) {
    return false
  }
}

function formatMessage(message) {
  return {
    id: message.id,
    senderId: message.senderId,
    receiverId: message.receiverId,
    text: message.text,
    messageType: message.messageType,
    mediaUrl: message.mediaUrl,
    mediaMimeType: message.mediaMimeType,
    mediaOriginalName: message.mediaOriginalName,
    mediaDurationSec: message.mediaDurationSec,
    seen: message.seen,
    createdAt: message.createdAt,
  }
}

async function ensureContact(currentUserId, otherUserId) {
  return Contact.findOne({
    where: { userId: currentUserId, contactUserId: otherUserId },
  })
}

router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const otherUserId = Number(req.params.userId)

    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) {
      return res.status(404).json({ message: 'User not found' })
    }
    const contact = await ensureContact(req.user.id, otherUserId)
    if (!contact) {
      return res.status(403).json({ message: 'Add this user to contacts first' })
    }

    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { senderId: req.user.id, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: req.user.id },
        ],
      },
      order: [['createdAt', 'ASC']],
    })

    return res.json({ messages: messages.map(formatMessage) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch messages', error: error.message })
  }
})

router.post('/:userId', authMiddleware, async (req, res) => {
  try {
    const otherUserId = Number(req.params.userId)
    const text = (req.body.text || '').trim()
    const mediaUrl = (req.body.mediaUrl || '').trim()
    const messageType = (req.body.messageType || 'text').trim().toLowerCase()
    const mediaMimeType = (req.body.mediaMimeType || '').trim()
    const mediaOriginalName = (req.body.mediaOriginalName || '').trim()
    const rawDuration = req.body.mediaDurationSec
    const mediaDurationSec = rawDuration !== null && rawDuration !== undefined && Number.isFinite(Number(rawDuration))
      ? Math.max(0, Math.floor(Number(rawDuration)))
      : null

    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    if (!text && !mediaUrl) {
      return res.status(400).json({ message: 'Message text or mediaUrl is required' })
    }
    if (mediaUrl && !['image', 'video', 'audio', 'file'].includes(messageType)) {
      return res.status(400).json({ message: 'messageType must be image, video, audio, or file when mediaUrl is provided' })
    }
    if (!mediaUrl && messageType !== 'text') {
      return res.status(400).json({ message: 'messageType must be text when mediaUrl is empty' })
    }
    if (messageType !== 'audio' && mediaDurationSec !== null) {
      return res.status(400).json({ message: 'mediaDurationSec is only allowed for audio messages' })
    }
    if (mediaDurationSec !== null && mediaDurationSec > 60 * 60) {
      return res.status(400).json({ message: 'mediaDurationSec is too large' })
    }
    if (mediaUrl && !isSenderMediaUrlValid(mediaUrl, req.user.username, messageType)) {
      return res.status(400).json({
        message: 'Invalid media URL path. It must be inside your chat/<username>/images, videos, audios, or files folder',
      })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) {
      return res.status(404).json({ message: 'User not found' })
    }
    const contact = await ensureContact(req.user.id, otherUserId)
    if (!contact) {
      return res.status(403).json({ message: 'Add this user to contacts first' })
    }

    const message = await Message.create({
      senderId: req.user.id,
      receiverId: otherUserId,
      text: text || null,
      messageType: mediaUrl ? messageType : 'text',
      mediaUrl: mediaUrl || null,
      mediaMimeType: mediaMimeType || null,
      mediaOriginalName: mediaOriginalName || null,
      mediaDurationSec: messageType === 'audio' ? mediaDurationSec : null,
    })

    const payload = formatMessage(message)
    const io = req.app.get('io')
    io.to(`user:${req.user.id}`).emit('chat:message', payload)
    io.to(`user:${otherUserId}`).emit('chat:message', payload)

    return res.status(201).json({ message: payload })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to send message', error: error.message })
  }
})

router.delete('/chat/:userId', authMiddleware, async (req, res) => {
  try {
    const otherUserId = Number(req.params.userId)
    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) {
      return res.status(404).json({ message: 'User not found' })
    }

    const contact = await ensureContact(req.user.id, otherUserId)
    if (!contact) {
      return res.status(403).json({ message: 'Add this user to contacts first' })
    }

    await Message.destroy({
      where: {
        [Op.or]: [
          { senderId: req.user.id, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: req.user.id },
        ],
      },
    })

    const io = req.app.get('io')
    io.to(`user:${req.user.id}`).emit('chat:conversation-cleared', { withUserId: otherUserId })
    io.to(`user:${otherUserId}`).emit('chat:conversation-cleared', { withUserId: req.user.id })

    return res.json({ message: 'Chat deleted successfully' })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete chat', error: error.message })
  }
})

router.delete('/:messageId', authMiddleware, async (req, res) => {
  try {
    const messageId = Number(req.params.messageId)
    if (!Number.isInteger(messageId)) {
      return res.status(400).json({ message: 'Invalid messageId' })
    }

    const message = await Message.findByPk(messageId)
    if (!message) {
      return res.status(404).json({ message: 'Message not found' })
    }

    if (message.senderId !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete your own messages' })
    }

    await message.destroy()
    const io = req.app.get('io')
    io.to(`user:${message.senderId}`).emit('chat:message-deleted', {
      messageId: message.id,
      withUserId: message.receiverId,
    })
    io.to(`user:${message.receiverId}`).emit('chat:message-deleted', {
      messageId: message.id,
      withUserId: message.senderId,
    })

    return res.json({ message: 'Message deleted successfully', messageId: message.id })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete message', error: error.message })
  }
})

module.exports = router
