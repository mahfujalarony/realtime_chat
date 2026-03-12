const express = require('express')
const { Op } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { Message, User, Contact } = require('../models')

const router = express.Router()

function formatMessage(message) {
  return {
    id: message.id,
    senderId: message.senderId,
    receiverId: message.receiverId,
    text: message.text,
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

    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    if (!text) {
      return res.status(400).json({ message: 'Message text is required' })
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
      text,
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
