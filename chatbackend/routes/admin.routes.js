const express = require('express')
const { Op, literal } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { sequelize, User, Message, Contact, ConversationAssignment } = require('../models')
const { canHandleExternal, isExternalUser } = require('../utils/chat-access')
const { deleteUserFolder } = require('../utils/upload-server')

const router = express.Router()
const allowRoleBypassForTest = String(process.env.ROLE_BYPASS_FOR_TEST || '0') === '1'

function requireAdmin(req, res, next) {
  if (allowRoleBypassForTest) return next()
  const role = String(req.user?.role || 'user')
  if (role !== 'admin' && role !== 'model_admin') {
    return res.status(403).json({ message: 'Admin or Model Admin access required' })
  }
  return next()
}

function hasConversationNoteAccess(user) {
  return String(user?.role || 'user') === 'admin' || Boolean(user?.canEditConversationNote)
}

function isModelAdmin(user) {
  return String(user?.role || 'user') === 'model_admin'
}

function cannotManageModelAdmin(reqUser, targetUser, nextRole) {
  if (!isModelAdmin(reqUser)) return false
  return String(targetUser?.role || 'user') === 'model_admin' || String(nextRole || 'user') === 'model_admin'
}

function serializeAdminUser(user) {
  return {
    id: user.id,
    username: user.username,
    uniqueUsername: user.uniqueUsername,
    role: user.role || 'user',
    canHandleExternalChat: Boolean(user.canHandleExternalChat),
    canDownloadConversations: Boolean(user.canDownloadConversations),
    canEditConversationNote: Boolean(user.canEditConversationNote),
    canBlockUsers: Boolean(user.canBlockUsers),
    profileNote: user.profileNote || '',
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
    sender: message.sender
      ? {
          id: message.sender.id,
          username: message.sender.username,
          uniqueUsername: message.sender.uniqueUsername,
          role: message.sender.role || 'user',
          canHandleExternalChat: Boolean(message.sender.canHandleExternalChat),
        }
      : null,
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
    if (isModelAdmin(req.user)) {
      where.role = { [Op.ne]: 'admin' }
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
      attributes: ['id', 'username', 'uniqueUsername', 'role', 'canHandleExternalChat', 'canDownloadConversations', 'canEditConversationNote', 'canBlockUsers', 'profileNote', 'email', 'mobileNumber', 'profileMediaUrl', 'createdAt', 'lastSeen'],
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
    const teamWhere = {
      [Op.or]: [
        { role: 'admin' },
        { role: 'model_admin' },
        { canHandleExternalChat: true },
      ],
    }
    if (isModelAdmin(req.user)) {
      teamWhere[Op.and] = [{ role: { [Op.ne]: 'admin' } }]
    }
    const rows = await User.findAll({
      where: teamWhere,
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
    if (cannotManageModelAdmin(req.user, target, normalizedRole)) {
      return res.status(403).json({ message: 'Model Admin cannot assign or remove Model Admin profile' })
    }

    target.role = normalizedRole
    if (normalizedRole === 'model_admin') {
      // Model admin permissions come from role; keep agent flag off to avoid dual state.
      target.canHandleExternalChat = false
    }
    if (normalizedRole === 'admin') {
      target.canHandleExternalChat = false
      target.canDownloadConversations = true
    }
    await target.save()
    return res.json({ message: `Role updated to ${normalizedRole}`, user: serializeAdminUser(target) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update role', error: error.message })
  }
})

router.patch('/users/:userId/staff-profile', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId)
    const profile = String(req.body?.profile || '').trim().toLowerCase()
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    if (!['default', 'agent', 'model_admin'].includes(profile)) {
      return res.status(400).json({ message: 'profile must be default, agent, or model_admin' })
    }
    if (userId === Number(req.user.id)) {
      return res.status(400).json({ message: 'You cannot change your own profile from this panel' })
    }

    const target = await User.findByPk(userId)
    if (!target) return res.status(404).json({ message: 'User not found' })
    if (String(target.role || 'user') === 'admin') {
      return res.status(400).json({ message: 'Admin profile cannot be changed here' })
    }
    if (cannotManageModelAdmin(req.user, target, profile === 'model_admin' ? 'model_admin' : 'user')) {
      return res.status(403).json({ message: 'Model Admin cannot assign or remove Model Admin profile' })
    }

    if (profile === 'model_admin') {
      target.role = 'model_admin'
      target.canHandleExternalChat = false
    } else if (profile === 'agent') {
      target.role = 'user'
      target.canHandleExternalChat = true
    } else {
      target.role = 'user'
      target.canHandleExternalChat = false
      target.canDownloadConversations = false
    }

    await target.save()
    return res.json({ message: `Profile updated to ${profile}`, user: serializeAdminUser(target) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update staff profile', error: error.message })
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
    const io = req.app.get('io')
    io.to(`user:${target.id}`).emit('chat:download-access-updated', {
      enabled: Boolean(target.canDownloadConversations),
      updatedAt: new Date().toISOString(),
    })
    return res.json({ message: `Download access ${enabled ? 'enabled' : 'disabled'}`, user: serializeAdminUser(target) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update access', error: error.message })
  }
})

router.patch('/users/:userId/note-access', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId)
    const enabled = Boolean(req.body?.enabled)
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    const target = await User.findByPk(userId)
    if (!target) return res.status(404).json({ message: 'User not found' })
    if (String(target.role || 'user') === 'admin') {
      return res.status(400).json({ message: 'Admin always has note access' })
    }
    target.canEditConversationNote = enabled
    await target.save()
    const io = req.app.get('io')
    io.to(`user:${target.id}`).emit('chat:note-access-updated', {
      enabled: Boolean(target.canEditConversationNote),
      updatedAt: new Date().toISOString(),
    })
    return res.json({ message: `Note access ${enabled ? 'enabled' : 'disabled'}`, user: serializeAdminUser(target) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update note access', error: error.message })
  }
})

router.patch('/users/:userId/block-access', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId)
    const enabled = Boolean(req.body?.enabled)
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    const target = await User.findByPk(userId)
    if (!target) return res.status(404).json({ message: 'User not found' })
    if (String(target.role || 'user') === 'admin' || String(target.role || 'user') === 'model_admin') {
      return res.status(400).json({ message: 'This user already has block access' })
    }
    target.canBlockUsers = enabled
    await target.save()
    return res.json({ message: `Block access ${enabled ? 'enabled' : 'disabled'}`, user: serializeAdminUser(target) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update block access', error: error.message })
  }
})

router.patch('/users/:userId/profile-note', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId)
    const profileNote = String(req.body?.profileNote || '').trim()
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    const target = await User.findByPk(userId)
    if (!target) return res.status(404).json({ message: 'User not found' })

    target.profileNote = profileNote || null
    await target.save()

    const io = req.app.get('io')
    io.to(`user:${target.id}`).emit('chat:profile-note-updated', {
      profileNote: Boolean(target.canEditConversationNote) ? (target.profileNote || '') : '',
      updatedAt: new Date().toISOString(),
    })
    return res.json({ message: 'Profile note updated', user: serializeAdminUser(target) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update profile note', error: error.message })
  }
})

router.patch('/users/:userId/contact', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId)
    const emailRaw = String(req.body?.email || '').trim()
    const mobileNumberRaw = String(req.body?.mobileNumber || '').trim()

    if (!Number.isInteger(userId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }

    const email = emailRaw || null
    const mobileNumber = mobileNumberRaw || null

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' })
    }

    const target = await User.findByPk(userId)
    if (!target) return res.status(404).json({ message: 'User not found' })

    if (email) {
      const emailOwner = await User.findOne({
        where: {
          id: { [Op.ne]: userId },
          email,
        },
        attributes: ['id'],
      })
      if (emailOwner) return res.status(409).json({ message: 'Email already in use' })
    }

    if (mobileNumber) {
      const mobileOwner = await User.findOne({
        where: {
          id: { [Op.ne]: userId },
          mobileNumber,
        },
        attributes: ['id'],
      })
      if (mobileOwner) return res.status(409).json({ message: 'Mobile number already in use' })
    }

    target.email = email
    target.mobileNumber = mobileNumber
    await target.save()

    return res.json({ message: 'Contact updated', user: serializeAdminUser(target) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update contact', error: error.message })
  }
})

router.patch('/users/:userId/password', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId)
    const password = String(req.body?.password || '')
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    if (!password.trim()) {
      return res.status(400).json({ message: 'Password is required' })
    }
    if (userId === Number(req.user.id)) {
      return res.status(400).json({ message: 'You cannot set your own password from this panel' })
    }

    const target = await User.scope('withPassword').findByPk(userId)
    if (!target) return res.status(404).json({ message: 'User not found' })

    target.passwordHash = password
    await target.save()

    return res.json({ message: `Password updated for ${target.username}`, user: serializeAdminUser(target) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update password', error: error.message })
  }
})

router.get('/conversations', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    const requestedLimit = Number(req.query.limit)
    const requestedPage = Number(req.query.page)
    const limit = Number.isInteger(requestedLimit) ? Math.max(5, Math.min(50, requestedLimit)) : 12
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const offset = (page - 1) * limit

    const include = [
      {
        model: User,
        as: 'externalUser',
        attributes: ['id', 'username', 'uniqueUsername', 'profileMediaUrl'],
        ...(q
          ? {
              where: {
                [Op.or]: [
                  { username: { [Op.like]: `%${q}%` } },
                  { uniqueUsername: { [Op.like]: `%${q}%` } },
                  { email: { [Op.like]: `%${q}%` } },
                  { mobileNumber: { [Op.like]: `%${q}%` } },
                ],
              },
            }
          : {}),
      },
      { model: User, as: 'assignedToUser', attributes: ['id', 'username', 'uniqueUsername', 'role', 'profileMediaUrl'] },
    ]

    const { rows, count } = await ConversationAssignment.findAndCountAll({
      attributes: {
        include: [
          [
            literal(`(
              SELECT MAX(m.created_at)
              FROM messages m
              WHERE m.sender_id = ConversationAssignment.external_user_id
                 OR m.receiver_id = ConversationAssignment.external_user_id
            )`),
            'lastMessageAt',
          ],
        ],
      },
      include,
      distinct: true,
      order: [
        [
          literal(`COALESCE((
            SELECT MAX(m.created_at)
            FROM messages m
            WHERE m.sender_id = ConversationAssignment.external_user_id
               OR m.receiver_id = ConversationAssignment.external_user_id
          ), ConversationAssignment.updated_at)`),
          'DESC',
        ],
        ['updatedAt', 'DESC'],
      ],
      limit,
      offset,
    })

    const items = rows.map((row) => row.toJSON())
    const externalUserIds = items
      .map((item) => Number(item.externalUserId))
      .filter((value) => Number.isInteger(value))

    let countByExternalUserId = {}
    let lastMessageByExternalUserId = {}

    if (externalUserIds.length) {
      const countRows = await sequelize.query(
        `
        SELECT t.external_user_id AS externalUserId, COUNT(*) AS totalMessages, MAX(t.created_at) AS lastMessageAt
        FROM (
          SELECT sender_id AS external_user_id, created_at
          FROM messages
          WHERE sender_id IN (:externalUserIds)
          UNION ALL
          SELECT receiver_id AS external_user_id, created_at
          FROM messages
          WHERE receiver_id IN (:externalUserIds)
        ) t
        GROUP BY t.external_user_id
        `,
        {
          replacements: { externalUserIds },
          type: sequelize.QueryTypes.SELECT,
        },
      )

      countByExternalUserId = countRows.reduce((acc, row) => {
        acc[String(row.externalUserId)] = {
          totalMessages: Number(row.totalMessages || 0),
          lastMessageAt: row.lastMessageAt || null,
        }
        return acc
      }, {})

      const lastMessageIdRows = await sequelize.query(
        `
        SELECT t.external_user_id AS externalUserId, MAX(t.id) AS lastMessageId
        FROM (
          SELECT sender_id AS external_user_id, id
          FROM messages
          WHERE sender_id IN (:externalUserIds)
          UNION ALL
          SELECT receiver_id AS external_user_id, id
          FROM messages
          WHERE receiver_id IN (:externalUserIds)
        ) t
        GROUP BY t.external_user_id
        `,
        {
          replacements: { externalUserIds },
          type: sequelize.QueryTypes.SELECT,
        },
      )

      const lastMessageIds = lastMessageIdRows
        .map((row) => Number(row.lastMessageId))
        .filter((value) => Number.isInteger(value))

      if (lastMessageIds.length) {
        const lastMessages = await Message.findAll({
          where: { id: { [Op.in]: lastMessageIds } },
          attributes: ['id', 'text', 'messageType', 'createdAt'],
          raw: true,
        })
        const lastMessageMap = lastMessages.reduce((acc, item) => {
          acc[String(item.id)] = item
          return acc
        }, {})
        lastMessageByExternalUserId = lastMessageIdRows.reduce((acc, row) => {
          acc[String(row.externalUserId)] = lastMessageMap[String(row.lastMessageId)] || null
          return acc
        }, {})
      }
    }

    const conversations = items.map((item) => {
      const metrics = countByExternalUserId[String(item.externalUserId)] || {}
      return {
        id: item.id,
        externalUserId: item.externalUserId,
        assignedToUserId: item.assignedToUserId,
        note: item.note || '',
        noteUpdatedAt: item.noteUpdatedAt,
        lastMessageAt: metrics.lastMessageAt || item.lastMessageAt || null,
        externalUser: item.externalUser,
        assignedToUser: item.assignedToUser,
        totalMessages: Number(metrics.totalMessages || 0),
        lastMessage: lastMessageByExternalUserId[String(item.externalUserId)] || null,
      }
    })

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
      include: [
        { model: User, as: 'sender', attributes: ['id', 'username', 'uniqueUsername', 'role', 'canHandleExternalChat'] },
      ],
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

    const io = req.app.get('io')
    const externalUser = await User.findByPk(assignment.externalUserId, { attributes: ['id', 'role', 'canEditConversationNote'] })
    const assignedToUser = await User.findByPk(assignment.assignedToUserId, { attributes: ['id', 'role', 'canEditConversationNote'] })
    const publicHandlerUser = assignment.publicHandlerUserId
      ? await User.findByPk(assignment.publicHandlerUserId, { attributes: ['id', 'role', 'canEditConversationNote'] })
      : null
    const recipients = [externalUser, assignedToUser, publicHandlerUser].filter(Boolean)
    const uniqueRecipientIds = [...new Set(recipients.map((u) => Number(u.id)).filter(Number.isInteger))]

    for (const recipientId of uniqueRecipientIds) {
      const recipient = recipients.find((u) => Number(u.id) === recipientId)
      if (!hasConversationNoteAccess(recipient)) continue

      const withUserId = Number(recipientId) === Number(assignment.externalUserId)
        ? Number(assignment.publicHandlerUserId || assignment.assignedToUserId)
        : Number(assignment.externalUserId)

      io.to(`user:${recipientId}`).emit('chat:conversation-note-updated', {
        withUserId,
        conversationNote: assignment.note || '',
        conversationAssignedToUserId: Number(assignment.assignedToUserId),
      })
    }

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
    const previousPublicHandlerId = Number(assignment.publicHandlerUserId || assignment.assignedToUserId)
    const visibleHandlerUserId = previousPublicHandlerId || previousAssigneeId || toUserId
    assignment.assignedToUserId = toUserId
    assignment.publicHandlerUserId = visibleHandlerUserId
    assignment.assignedByUserId = req.user.id
    await assignment.save()

    await Contact.findOrCreate({
      where: { userId: toUserId, contactUserId: externalUserId },
      defaults: { userId: toUserId, contactUserId: externalUserId },
    })
    await Contact.findOrCreate({
      where: { userId: externalUserId, contactUserId: visibleHandlerUserId },
      defaults: { userId: externalUserId, contactUserId: visibleHandlerUserId },
    })

    if (previousAssigneeId !== toUserId) {
      await Contact.destroy({ where: { userId: previousAssigneeId, contactUserId: externalUserId } }).catch(() => null)
    }

    const io = req.app.get('io')
    const assignmentPayload = {
      externalUserId,
      previousAssigneeId,
      assignedToUserId: toUserId,
      publicHandlerUserId: visibleHandlerUserId,
      updatedAt: new Date().toISOString(),
    }
    // Notify external user that assignment changed (they see same visible handler)
    io.to(`user:${externalUserId}`).emit('chat:assignment-updated', assignmentPayload)

    // New agent: directly inject the external user contact into their sidebar
    const externalUserData = {
      id: externalUser.id,
      username: externalUser.username,
      uniqueUsername: externalUser.uniqueUsername,
      role: externalUser.role || 'user',
      canHandleExternalChat: Boolean(externalUser.canHandleExternalChat),
      email: externalUser.email,
      mobileNumber: externalUser.mobileNumber,
      lastSeen: externalUser.lastSeen,
      profileMediaUrl: externalUser.profileMediaUrl,
      unreadCount: 0,
      isOnline: false,
    }
    io.to(`user:${toUserId}`).emit('chat:contact-added', { user: externalUserData })

    // Old agent: remove the external user from their sidebar
    if (previousAssigneeId !== toUserId) {
      io.to(`user:${previousAssigneeId}`).emit('chat:contact-removed', { userId: externalUserId })
    }

    return res.json({ message: 'Conversation forwarded', assignment })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to forward conversation', error: error.message })
  }
})

router.delete('/conversations/:externalUserId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const externalUserId = Number(req.params.externalUserId)
    if (!Number.isInteger(externalUserId)) {
      return res.status(400).json({ message: 'Invalid externalUserId' })
    }

    const externalUser = await User.findByPk(externalUserId, {
      attributes: ['id', 'uniqueUsername', 'username'],
    })
    if (!externalUser) {
      return res.status(404).json({ message: 'External user not found' })
    }

    const assignment = await ConversationAssignment.findOne({ where: { externalUserId } })
    if (!assignment) {
      return res.status(404).json({ message: 'Conversation assignment not found' })
    }
    const assignedToUserId = Number(assignment.assignedToUserId)

    const deletedCount = await sequelize.transaction(async (transaction) => {
      const removedMessages = await Message.destroy({
        where: {
          [Op.or]: [{ senderId: externalUserId }, { receiverId: externalUserId }],
        },
        transaction,
      })

      await Contact.destroy({
        where: {
          [Op.or]: [{ userId: externalUserId }, { contactUserId: externalUserId }],
        },
        transaction,
      })

      await ConversationAssignment.destroy({ where: { externalUserId }, transaction })
      return removedMessages
    })

    let mediaCleanupError = null
    const uploadFolderOwner = String(externalUser.uniqueUsername || externalUser.username || '').trim()
    if (uploadFolderOwner) {
      try {
        await deleteUserFolder(uploadFolderOwner)
      } catch (error) {
        mediaCleanupError = error
      }
    }

    const io = req.app.get('io')
    io.to(`user:${externalUserId}`).emit('chat:conversation-cleared', { withUserId: assignedToUserId })
    io.to(`user:${assignedToUserId}`).emit('chat:conversation-cleared', { withUserId: externalUserId })
    io.to(`user:${externalUserId}`).emit('chat:contact-removed', { userId: assignedToUserId })
    io.to(`user:${assignedToUserId}`).emit('chat:contact-removed', { userId: externalUserId })
    io.emit('chat:assignment-updated', {
      externalUserId,
      assignedToUserId: null,
      publicHandlerUserId: null,
      removed: true,
      updatedAt: new Date().toISOString(),
    })

    if (mediaCleanupError) {
      return res.status(502).json({
        message: 'Conversation removed, but media cleanup failed',
        deletedCount,
        mediaDeleted: false,
        error: mediaCleanupError.message,
      })
    }

    return res.json({ message: 'Conversation removed successfully', deletedCount, mediaDeleted: true })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to remove conversation', error: error.message })
  }
})

module.exports = router
