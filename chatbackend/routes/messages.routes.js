const express = require('express')
const { Op } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { Message, User } = require('../models')
const { canAccessPairConversation, isExternalUser, canHandleExternal } = require('../utils/chat-access')

const router = express.Router()

function isSenderMediaUrlValid(mediaUrl, uniqueUsername, messageType) {
  try {
    const raw = String(mediaUrl || '').trim()
    if (!raw) return false
    const pathname = decodeURIComponent(
      raw.startsWith('/')
        ? raw
        : new URL(raw).pathname,
    ).toLowerCase()
    const userPath = `/chat/${String(uniqueUsername).toLowerCase()}/`
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
    mediaGroupId: message.mediaGroupId,
    mediaDurationSec: message.mediaDurationSec,
    seen: message.seen,
    createdAt: message.createdAt,
  }
}

function buildConversationWhere(requestUser, otherUser, assignment) {
  const requestIsExternal = isExternalUser(requestUser)
  const otherIsExternal = isExternalUser(otherUser)
  const externalId = requestIsExternal ? requestUser.id : otherIsExternal ? otherUser.id : null
  if (!externalId || !assignment) {
    return {
      [Op.or]: [
        { senderId: requestUser.id, receiverId: otherUser.id },
        { senderId: otherUser.id, receiverId: requestUser.id },
      ],
    }
  }
  return {
    [Op.or]: [
      { senderId: externalId, receiverId: { [Op.in]: [assignment.assignedToUserId, assignment.publicHandlerUserId].filter(Boolean) } },
      { receiverId: externalId, senderId: { [Op.in]: [assignment.assignedToUserId, assignment.publicHandlerUserId].filter(Boolean) } },
    ],
  }
}

function mapPayloadForExternalViewer(messagePayload, assignment) {
  if (!assignment) return messagePayload
  const externalUserId = Number(assignment.externalUserId)
  const publicHandlerUserId = Number(assignment.publicHandlerUserId || assignment.assignedToUserId)
  if (!Number.isInteger(externalUserId) || !Number.isInteger(publicHandlerUserId)) return messagePayload
  const next = { ...messagePayload }
  if (Number(next.senderId) !== externalUserId) next.senderId = publicHandlerUserId
  if (Number(next.receiverId) !== externalUserId) next.receiverId = publicHandlerUserId
  return next
}

router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const otherUserId = Number(req.params.userId)
    const requestedLimit = Number(req.query.limit)
    const limit = Number.isInteger(requestedLimit) ? Math.max(10, Math.min(100, requestedLimit)) : 40
    const beforeIdRaw = Number(req.query.beforeId)
    const beforeId = Number.isInteger(beforeIdRaw) ? beforeIdRaw : null

    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) {
      return res.status(404).json({ message: 'User not found' })
    }
    const access = await canAccessPairConversation(req.user, otherUser)
    if (!access.ok) return res.status(403).json({ message: access.reason })

    const conversationWhere = buildConversationWhere(req.user, otherUser, access.assignment)
    if (beforeId) {
      conversationWhere.id = { [Op.lt]: beforeId }
    }

    const messagesDesc = await Message.findAll({
      where: conversationWhere,
      order: [['id', 'DESC']],
      limit,
    })
    const messages = [...messagesDesc].reverse()

    const oldestLoadedId = messages[0]?.id || null
    const hasMore = Boolean(
      oldestLoadedId &&
        (await Message.findOne({
          where: {
            ...buildConversationWhere(req.user, otherUser, access.assignment),
            id: { [Op.lt]: oldestLoadedId },
          },
          attributes: ['id'],
        })),
    )

    return res.json({
      messages: messages.map(formatMessage),
      hasMore,
      nextBeforeId: oldestLoadedId,
      conversationNote: access.assignment?.note || '',
      conversationAssignedToUserId: access.assignment?.assignedToUserId || null,
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch messages', error: error.message })
  }
})

router.post('/:userId/seen', authMiddleware, async (req, res) => {
  try {
    const otherUserId = Number(req.params.userId)
    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) return res.status(404).json({ message: 'User not found' })
    const access = await canAccessPairConversation(req.user, otherUser)
    if (!access.ok) return res.status(403).json({ message: access.reason })

    const requestIsExternal = isExternalUser(req.user)
    const senderIds = requestIsExternal
      ? [access.assignment?.assignedToUserId, access.assignment?.publicHandlerUserId].filter(Boolean)
      : [otherUserId]

    const unseenMessages = await Message.findAll({
      where: {
        senderId: senderIds.length > 1 ? { [Op.in]: senderIds } : senderIds[0],
        receiverId: req.user.id,
        seen: false,
      },
      attributes: ['id'],
      raw: true,
    })
    const seenMessageIds = unseenMessages.map((item) => item.id)

    if (seenMessageIds.length > 0) {
      await Message.update(
        { seen: true },
        {
          where: {
            id: { [Op.in]: seenMessageIds },
          },
        },
      )

      const io = req.app.get('io')
      // Receiver's conversation key is sender (otherUserId),
      // sender's conversation key is receiver (req.user.id).
      io.to(`user:${req.user.id}`).emit('chat:messages-seen', {
        byUserId: req.user.id,
        withUserId: otherUserId,
        messageIds: seenMessageIds,
      })
      io.to(`user:${otherUserId}`).emit('chat:messages-seen', {
        byUserId: req.user.id,
        withUserId: req.user.id,
        messageIds: seenMessageIds,
      })
    }

    return res.json({ seenCount: seenMessageIds.length, messageIds: seenMessageIds })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to mark messages as seen', error: error.message })
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
    const mediaGroupIdRaw = req.body.mediaGroupId
    const mediaGroupId = typeof mediaGroupIdRaw === 'string' ? mediaGroupIdRaw.trim().slice(0, 80) : null
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
    if (mediaGroupId && !/^[a-zA-Z0-9_-]{4,80}$/.test(mediaGroupId)) {
      return res.status(400).json({ message: 'Invalid mediaGroupId format' })
    }
    if (mediaUrl && !isSenderMediaUrlValid(mediaUrl, req.user.uniqueUsername || req.user.username, messageType)) {
      return res.status(400).json({
        message: 'Invalid media URL path. It must be inside your chat/<uniqueUsername>/images, videos, audios, or files folder',
      })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) {
      return res.status(404).json({ message: 'User not found' })
    }
    const access = await canAccessPairConversation(req.user, otherUser)
    if (!access.ok) return res.status(403).json({ message: access.reason })

    const requestIsExternal = isExternalUser(req.user)
    const effectiveOtherUserId = requestIsExternal
      ? Number(access.assignment?.assignedToUserId || otherUserId)
      : otherUserId

    const message = await Message.create({
      senderId: req.user.id,
      receiverId: effectiveOtherUserId,
      text: text || null,
      messageType: mediaUrl ? messageType : 'text',
      mediaUrl: mediaUrl || null,
      mediaMimeType: mediaMimeType || null,
      mediaOriginalName: mediaOriginalName || null,
      mediaGroupId: mediaGroupId || null,
      mediaDurationSec: messageType === 'audio' ? mediaDurationSec : null,
    })

    const payload = formatMessage(message)
    const assignment = access.assignment
    const externalUserId = Number(assignment?.externalUserId || 0)
    const senderPayload = Number(req.user.id) === externalUserId
      ? mapPayloadForExternalViewer(payload, assignment)
      : payload
    const receiverPayload = Number(effectiveOtherUserId) === externalUserId
      ? mapPayloadForExternalViewer(payload, assignment)
      : payload
    const io = req.app.get('io')
    io.to(`user:${req.user.id}`).emit('chat:message', senderPayload)
    io.to(`user:${effectiveOtherUserId}`).emit('chat:message', receiverPayload)

    return res.status(201).json({ message: senderPayload })
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

    const access = await canAccessPairConversation(req.user, otherUser)
    if (!access.ok) return res.status(403).json({ message: access.reason })

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
