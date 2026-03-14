const express = require('express')
const { Op } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { Group, GroupMember, GroupMessage, User, Contact, sequelize } = require('../models')

const router = express.Router()

function isSenderMediaUrlValid(mediaUrl, uniqueUsername, messageType) {
  try {
    const parsed = new URL(mediaUrl)
    const pathname = decodeURIComponent(parsed.pathname).toLowerCase()
    const userPath = `/chat/${String(uniqueUsername).toLowerCase()}/`
    if (!pathname.includes(userPath)) return false

    if (messageType === 'image') return pathname.includes(`${userPath}images/`)
    if (messageType === 'video') return pathname.includes(`${userPath}videos/`)
    if (messageType === 'audio') return pathname.includes(`${userPath}audios/`)
    if (messageType === 'file') return pathname.includes(`${userPath}files/`)
    return false
  } catch (error) {
    return false
  }
}

function formatGroupMessage(message) {
  return {
    id: message.id,
    groupId: message.groupId,
    senderId: message.senderId,
    text: message.text,
    messageType: message.messageType,
    mediaUrl: message.mediaUrl,
    mediaMimeType: message.mediaMimeType,
    mediaOriginalName: message.mediaOriginalName,
    mediaGroupId: message.mediaGroupId,
    mediaDurationSec: message.mediaDurationSec,
    createdAt: message.createdAt,
  }
}

function formatGroup(group, onlineUserSockets) {
  const members = (group.memberships || []).map((membership) => {
    const user = membership.memberUser
    return {
      id: user.id,
      username: user.username,
      uniqueUsername: user.uniqueUsername,
      profileMediaUrl: user.profileMediaUrl,
      isOnline: onlineUserSockets.has(user.id),
      role: membership.role,
    }
  })
  return {
    id: group.id,
    name: group.name,
    createdBy: group.createdBy,
    members,
    createdAt: group.createdAt,
  }
}

async function getMembership(groupId, userId) {
  return GroupMember.findOne({ where: { groupId, userId } })
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const myMemberships = await GroupMember.findAll({
      where: { userId: req.user.id },
      attributes: ['groupId', 'lastReadAt'],
      raw: true,
    })
    const groupIds = myMemberships.map((item) => item.groupId)

    if (groupIds.length === 0) return res.json({ groups: [] })

    const groups = await Group.findAll({
      where: { id: { [Op.in]: groupIds } },
      include: [
        {
          model: GroupMember,
          as: 'memberships',
          attributes: ['role'],
          include: [
            {
              model: User,
              as: 'memberUser',
              attributes: ['id', 'username', 'uniqueUsername', 'profileMediaUrl'],
            },
          ],
        },
      ],
      order: [['updatedAt', 'DESC']],
    })

    const latestMessages = await GroupMessage.findAll({
      where: { groupId: { [Op.in]: groupIds } },
      attributes: ['id', 'groupId', 'senderId', 'text', 'messageType', 'mediaUrl', 'mediaOriginalName', 'createdAt'],
      order: [['createdAt', 'DESC']],
      raw: true,
    })

    const latestByGroupId = {}
    for (const item of latestMessages) {
      if (!latestByGroupId[item.groupId]) {
        latestByGroupId[item.groupId] = item
      }
    }

    const unreadByGroupId = {}
    await Promise.all(
      myMemberships.map(async (membership) => {
        const where = {
          groupId: membership.groupId,
          senderId: { [Op.ne]: req.user.id },
        }
        if (membership.lastReadAt) {
          where.createdAt = { [Op.gt]: membership.lastReadAt }
        }
        const unreadCount = await GroupMessage.count({ where })
        unreadByGroupId[membership.groupId] = unreadCount
      }),
    )

    const onlineUserSockets = req.app.get('onlineUserSockets') || new Map()
    const output = groups.map((group) => {
      const formatted = formatGroup(group, onlineUserSockets)
      return {
        ...formatted,
        unreadCount: unreadByGroupId[formatted.id] || 0,
        lastMessage: latestByGroupId[formatted.id] || null,
      }
    })
    return res.json({ groups: output })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load groups', error: error.message })
  }
})

router.post('/', authMiddleware, async (req, res) => {
  const tx = await sequelize.transaction()
  try {
    const name = String(req.body.name || '').trim()
    const memberIdsInput = Array.isArray(req.body.memberIds) ? req.body.memberIds : []
    if (!name || name.length < 2) {
      await tx.rollback()
      return res.status(400).json({ message: 'Group name must be at least 2 characters' })
    }

    const normalizedMemberIds = [...new Set(memberIdsInput.map((id) => Number(id)).filter((id) => Number.isInteger(id)))]
    const memberIds = [...new Set([req.user.id, ...normalizedMemberIds])]
    if (memberIds.length < 2) {
      await tx.rollback()
      return res.status(400).json({ message: 'Group requires at least 2 members including you' })
    }

    const contacts = await Contact.findAll({
      where: { userId: req.user.id, contactUserId: { [Op.in]: memberIds.filter((id) => id !== req.user.id) } },
      attributes: ['contactUserId'],
      raw: true,
      transaction: tx,
    })
    const allowedMemberIdSet = new Set([req.user.id, ...contacts.map((item) => item.contactUserId)])
    const validMemberIds = memberIds.filter((id) => allowedMemberIdSet.has(id))
    if (validMemberIds.length < 2) {
      await tx.rollback()
      return res.status(400).json({ message: 'Add contacts first before creating a group' })
    }

    const users = await User.findAll({
      where: { id: { [Op.in]: validMemberIds } },
      attributes: ['id', 'username', 'uniqueUsername', 'profileMediaUrl'],
      transaction: tx,
    })
    const existingIds = new Set(users.map((u) => u.id))
    const filteredMemberIds = validMemberIds.filter((id) => existingIds.has(id))
    if (filteredMemberIds.length < 2) {
      await tx.rollback()
      return res.status(400).json({ message: 'Not enough valid users to create group' })
    }

    const group = await Group.create(
      { name, createdBy: req.user.id },
      { transaction: tx },
    )

    await GroupMember.bulkCreate(
      filteredMemberIds.map((userId) => ({
        groupId: group.id,
        userId,
        role: userId === req.user.id ? 'admin' : 'member',
        lastReadAt: new Date(),
      })),
      { transaction: tx },
    )

    await tx.commit()

    const memberUsers = await GroupMember.findAll({
      where: { groupId: group.id },
      include: [{ model: User, as: 'memberUser', attributes: ['id', 'username', 'uniqueUsername', 'profileMediaUrl'] }],
      order: [[{ model: User, as: 'memberUser' }, 'username', 'ASC']],
    })
    const onlineUserSockets = req.app.get('onlineUserSockets') || new Map()
    const payload = {
      id: group.id,
      name: group.name,
      createdBy: group.createdBy,
      members: memberUsers.map((membership) => ({
        id: membership.memberUser.id,
        username: membership.memberUser.username,
        uniqueUsername: membership.memberUser.uniqueUsername,
        profileMediaUrl: membership.memberUser.profileMediaUrl,
        role: membership.role,
        isOnline: onlineUserSockets.has(membership.memberUser.id),
      })),
      unreadCount: 0,
      lastMessage: null,
      createdAt: group.createdAt,
    }

    const io = req.app.get('io')
    for (const member of payload.members) {
      io.in(`user:${member.id}`).socketsJoin(`group:${group.id}`)
      io.to(`user:${member.id}`).emit('chat:group-created', payload)
    }

    return res.status(201).json({ group: payload })
  } catch (error) {
    await tx.rollback().catch(() => null)
    return res.status(500).json({ message: 'Failed to create group', error: error.message })
  }
})

router.get('/:groupId/messages', authMiddleware, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId)
    if (!Number.isInteger(groupId)) {
      return res.status(400).json({ message: 'Invalid groupId' })
    }

    const member = await getMembership(groupId, req.user.id)
    if (!member) {
      return res.status(403).json({ message: 'You are not a member of this group' })
    }

    const messages = await GroupMessage.findAll({
      where: { groupId },
      order: [['createdAt', 'ASC']],
    })

    return res.json({ messages: messages.map(formatGroupMessage) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch group messages', error: error.message })
  }
})

router.post('/:groupId/seen', authMiddleware, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId)
    if (!Number.isInteger(groupId)) {
      return res.status(400).json({ message: 'Invalid groupId' })
    }

    const member = await getMembership(groupId, req.user.id)
    if (!member) {
      return res.status(403).json({ message: 'You are not a member of this group' })
    }

    member.lastReadAt = new Date()
    await member.save()
    return res.json({ ok: true, lastReadAt: member.lastReadAt })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update group seen status', error: error.message })
  }
})

router.post('/:groupId/messages', authMiddleware, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId)
    const text = (req.body.text || '').trim()
    const mediaUrl = (req.body.mediaUrl || '').trim()
    const messageType = (req.body.messageType || 'text').trim().toLowerCase()
    const mediaMimeType = (req.body.mediaMimeType || '').trim()
    const mediaOriginalName = (req.body.mediaOriginalName || '').trim()
    const mediaGroupIdRaw = req.body.mediaGroupId
    const mediaGroupId = typeof mediaGroupIdRaw === 'string' ? mediaGroupIdRaw.trim().slice(0, 80) : null
    const rawDuration = req.body.mediaDurationSec
    const mediaDurationSec =
      rawDuration !== null && rawDuration !== undefined && Number.isFinite(Number(rawDuration))
        ? Math.max(0, Math.floor(Number(rawDuration)))
        : null

    if (!Number.isInteger(groupId)) {
      return res.status(400).json({ message: 'Invalid groupId' })
    }
    if (!text && !mediaUrl) {
      return res.status(400).json({ message: 'Message text or mediaUrl is required' })
    }
    if (mediaUrl && !['image', 'video', 'audio', 'file'].includes(messageType)) {
      return res.status(400).json({ message: 'Invalid messageType for media message' })
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

    const member = await getMembership(groupId, req.user.id)
    if (!member) {
      return res.status(403).json({ message: 'You are not a member of this group' })
    }

    const groupMessage = await GroupMessage.create({
      groupId,
      senderId: req.user.id,
      text: text || null,
      messageType: mediaUrl ? messageType : 'text',
      mediaUrl: mediaUrl || null,
      mediaMimeType: mediaMimeType || null,
      mediaOriginalName: mediaOriginalName || null,
      mediaGroupId: mediaGroupId || null,
      mediaDurationSec: messageType === 'audio' ? mediaDurationSec : null,
    })
    const payload = formatGroupMessage(groupMessage)

    await GroupMember.update(
      { lastReadAt: new Date() },
      { where: { groupId, userId: req.user.id } },
    )

    const io = req.app.get('io')
    io.to(`group:${groupId}`).emit('chat:group-message', payload)

    return res.status(201).json({ message: payload })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to send group message', error: error.message })
  }
})

module.exports = router
