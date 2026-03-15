const express = require('express')
const { Op, literal } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { User, Message, Contact, ConversationAssignment } = require('../models')
const { canHandleExternal, isExternalUser } = require('../utils/chat-access')

const router = express.Router()
const allowRoleBypassForTest = String(process.env.ROLE_BYPASS_FOR_TEST || '0') === '1'

function requireAdmin(req, res, next) {
  if (allowRoleBypassForTest) return next()
  if (String(req.user?.role || 'user') !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' })
  }
  return next()
}

function serializeAdminUser(user) {
  return {
    id: user.id,
    username: user.username,
    uniqueUsername: user.uniqueUsername,
    role: user.role || 'user',
    canHandleExternalChat: Boolean(user.canHandleExternalChat),
    canDownloadConversations: Boolean(user.canDownloadConversations),
    email: user.email,
    mobileNumber: user.mobileNumber,
    profileMediaUrl: user.profileMediaUrl,
    createdAt: user.createdAt,
    lastSeen: user.lastSeen,
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

router.get('/users', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    const requestedLimit = Number(req.query.limit)
    const limit = Number.isInteger(requestedLimit) ? Math.max(10, Math.min(100, requestedLimit)) : 30
    const requestedPage = Number(req.query.page)
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const offset = (page - 1) * limit

    const where = {
      id: { [Op.ne]: Number(req.user.id) },
    }
    if (q) {
      where[Op.or] = [
        { username: { [Op.like]: `%${q}%` } },
        { uniqueUsername: { [Op.like]: `%${q}%` } },
        { email: { [Op.like]: `%${q}%` } },
        { mobileNumber: { [Op.like]: `%${q}%` } },
      ]
    }

    const { rows, count } = await User.findAndCountAll({
      where,
      attributes: ['id', 'username', 'uniqueUsername', 'role', 'canHandleExternalChat', 'canDownloadConversations', 'email', 'mobileNumber', 'profileMediaUrl', 'createdAt', 'lastSeen'],
      order: [
        [
          literal(`
            CASE
              WHEN role = 'model_admin' THEN 0
              WHEN role = 'user' AND can_handle_external_chat = 1 THEN 1
              WHEN role = 'user' THEN 2
              ELSE 3
            END
          `),
          'ASC',
        ],
        ['createdAt', 'DESC'],
      ],
      limit,
      offset,
    })

    const users = rows.map(serializeAdminUser)
    const hasMore = offset + users.length < Number(count || 0)
    return res.json({ users, page, limit, hasMore, total: Number(count || 0) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load users', error: error.message })
  }
})

router.get('/team-members', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const rows = await User.findAll({
      where: {
        [Op.or]: [
          { role: 'admin' },
          { role: 'model_admin' },
          { canHandleExternalChat: true },
        ],
      },
      attributes: ['id', 'username', 'uniqueUsername', 'role', 'canHandleExternalChat', 'profileMediaUrl'],
      order: [['username', 'ASC']],
    })
    return res.json({ teamMembers: rows.map(serializeAdminUser) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load team members', error: error.message })
  }
})

router.patch('/users/:userId/role', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId)
    const role = String(req.body?.role || '').trim().toLowerCase()
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    const normalizedRole = role === 'manager' ? 'model_admin' : role
    if (!['user', 'model_admin'].includes(normalizedRole)) {
      return res.status(400).json({ message: 'Role must be user or model_admin' })
    }
    if (userId === Number(req.user.id)) {
      return res.status(400).json({ message: 'You cannot change your own role from this panel' })
    }

    const target = await User.findByPk(userId)
    if (!target) return res.status(404).json({ message: 'User not found' })
    if (String(target.role || 'user') === 'admin') {
      return res.status(400).json({ message: 'Admin role cannot be changed here' })
    }

    target.role = normalizedRole
    if (normalizedRole === 'admin' || normalizedRole === 'model_admin') {
      target.canHandleExternalChat = true
      if (normalizedRole === 'admin') target.canDownloadConversations = true
    }
    await target.save()
    return res.json({ message: `Role updated to ${normalizedRole}`, user: serializeAdminUser(target) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update role', error: error.message })
  }
})

router.patch('/users/:userId/external-access', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId)
    const enabled = Boolean(req.body?.enabled)
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    const target = await User.findByPk(userId)
    if (!target) return res.status(404).json({ message: 'User not found' })
    if (String(target.role || 'user') === 'admin' || String(target.role || 'user') === 'model_admin') {
      return res.status(400).json({ message: 'Role already has external chat access by default' })
    }
    target.canHandleExternalChat = enabled
    await target.save()
    return res.json({ message: `External access ${enabled ? 'enabled' : 'disabled'}`, user: serializeAdminUser(target) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update access', error: error.message })
  }
})

router.patch('/users/:userId/download-access', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId)
    const enabled = Boolean(req.body?.enabled)
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    const target = await User.findByPk(userId)
    if (!target) return res.status(404).json({ message: 'User not found' })
    if (String(target.role || 'user') === 'admin') {
      return res.status(400).json({ message: 'Admin always has download access' })
    }
    target.canDownloadConversations = enabled
    await target.save()
    return res.json({ message: `Download access ${enabled ? 'enabled' : 'disabled'}`, user: serializeAdminUser(target) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update access', error: error.message })
  }
})

router.get('/conversations', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const requestedLimit = Number(req.query.limit)
    const requestedPage = Number(req.query.page)
    const limit = Number.isInteger(requestedLimit) ? Math.max(5, Math.min(50, requestedLimit)) : 12
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const offset = (page - 1) * limit

    const { rows, count } = await ConversationAssignment.findAndCountAll({
      include: [
        { model: User, as: 'externalUser', attributes: ['id', 'username', 'uniqueUsername', 'profileMediaUrl'] },
        { model: User, as: 'assignedToUser', attributes: ['id', 'username', 'uniqueUsername', 'role', 'profileMediaUrl'] },
      ],
      order: [['updatedAt', 'DESC']],
      limit,
      offset,
    })

    const conversations = await Promise.all(
      rows.map(async (row) => {
        const item = row.toJSON()
        const messageWhere = {
          [Op.or]: [{ senderId: item.externalUserId }, { receiverId: item.externalUserId }],
        }
        const lastMessage = await Message.findOne({
          where: messageWhere,
          order: [['id', 'DESC']],
          attributes: ['id', 'text', 'messageType', 'createdAt'],
          raw: true,
        })
        const totalMessages = await Message.count({ where: messageWhere })
        return {
          id: item.id,
          externalUserId: item.externalUserId,
          assignedToUserId: item.assignedToUserId,
          note: item.note || '',
          noteUpdatedAt: item.noteUpdatedAt,
          externalUser: item.externalUser,
          assignedToUser: item.assignedToUser,
          totalMessages: Number(totalMessages || 0),
          lastMessage: lastMessage || null,
        }
      }),
    )

    const hasMore = offset + conversations.length < Number(count || 0)
    return res.json({
      conversations,
      page,
      limit,
      total: Number(count || 0),
      hasMore,
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load conversations', error: error.message })
  }
})

router.get('/conversations/:externalUserId/messages', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const externalUserId = Number(req.params.externalUserId)
    const requestedLimit = Number(req.query.limit)
    const requestedPage = Number(req.query.page)
    const limit = Number.isInteger(requestedLimit) ? Math.max(20, Math.min(200, requestedLimit)) : 40
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const offset = (page - 1) * limit
    if (!Number.isInteger(externalUserId)) {
      return res.status(400).json({ message: 'Invalid externalUserId' })
    }

    const assignment = await ConversationAssignment.findOne({
      where: { externalUserId },
      include: [
        { model: User, as: 'externalUser', attributes: ['id', 'username', 'uniqueUsername', 'profileMediaUrl'] },
        { model: User, as: 'assignedToUser', attributes: ['id', 'username', 'uniqueUsername', 'role'] },
        { model: User, as: 'publicHandlerUser', attributes: ['id', 'username', 'uniqueUsername', 'role'] },
      ],
    })
    if (!assignment) return res.status(404).json({ message: 'Conversation assignment not found' })

    const messageWhere = {
      [Op.or]: [{ senderId: externalUserId }, { receiverId: externalUserId }],
    }
    const total = await Message.count({ where: messageWhere })
    const messages = await Message.findAll({
      where: messageWhere,
      order: [['id', 'DESC']],
      offset,
      limit,
    })

    return res.json({
      assignment: assignment.toJSON(),
      page,
      limit,
      total: Number(total || 0),
      hasMore: offset + messages.length < Number(total || 0),
      messages: messages.reverse().map(formatMessage),
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load conversation messages', error: error.message })
  }
})

router.patch('/conversations/:externalUserId/note', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const externalUserId = Number(req.params.externalUserId)
    const note = String(req.body?.note || '').trim()
    if (!Number.isInteger(externalUserId)) {
      return res.status(400).json({ message: 'Invalid externalUserId' })
    }
    const assignment = await ConversationAssignment.findOne({ where: { externalUserId } })
    if (!assignment) return res.status(404).json({ message: 'Conversation assignment not found' })
    assignment.note = note || null
    assignment.noteUpdatedAt = note ? new Date() : null
    assignment.assignedByUserId = req.user.id
    await assignment.save()
    return res.json({ message: 'Note updated', assignment })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update note', error: error.message })
  }
})

router.patch('/conversations/:externalUserId/forward', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const externalUserId = Number(req.params.externalUserId)
    const toUserId = Number(req.body?.toUserId)
    if (!Number.isInteger(externalUserId) || !Number.isInteger(toUserId)) {
      return res.status(400).json({ message: 'Invalid ids' })
    }
    const externalUser = await User.findByPk(externalUserId)
    const targetUser = await User.findByPk(toUserId)
    if (!externalUser || !targetUser) return res.status(404).json({ message: 'User not found' })
    if (!isExternalUser(externalUser)) return res.status(400).json({ message: 'Target conversation user must be external user' })
    if (!canHandleExternal(targetUser)) return res.status(400).json({ message: 'Target assignee cannot handle external chat' })

    const assignment = await ConversationAssignment.findOne({ where: { externalUserId } })
    if (!assignment) return res.status(404).json({ message: 'Conversation assignment not found' })
    const previousAssigneeId = Number(assignment.assignedToUserId)
    assignment.assignedToUserId = toUserId
    assignment.assignedByUserId = req.user.id
    await assignment.save()

    await Contact.findOrCreate({
      where: { userId: toUserId, contactUserId: externalUserId },
      defaults: { userId: toUserId, contactUserId: externalUserId },
    })

    // Keep external user's visible contact stable (publicHandlerUserId),
    // but remove previous assignee's own access from contact list.
    if (previousAssigneeId !== toUserId) {
      await Contact.destroy({ where: { userId: previousAssigneeId, contactUserId: externalUserId } }).catch(() => null)
    }

    const io = req.app.get('io')
    const assignmentPayload = {
      externalUserId,
      previousAssigneeId,
      assignedToUserId: toUserId,
      publicHandlerUserId: Number(assignment.publicHandlerUserId || assignment.assignedToUserId),
      updatedAt: new Date().toISOString(),
    }
    io.to(`user:${externalUserId}`).emit('chat:assignment-updated', assignmentPayload)
    io.to(`user:${previousAssigneeId}`).emit('chat:assignment-updated', assignmentPayload)
    io.to(`user:${toUserId}`).emit('chat:assignment-updated', assignmentPayload)
    io.emit('chat:assignment-updated', assignmentPayload)

    return res.json({ message: 'Conversation forwarded', assignment })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to forward conversation', error: error.message })
  }
})

module.exports = router
