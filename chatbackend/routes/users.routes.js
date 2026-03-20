const express = require('express')
const { Op, QueryTypes } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { User, Contact, Message, ConversationAssignment, UserBlock, sequelize } = require('../models')
const { UPLOAD_SERVER_URL } = require('../utils/upload-server')
const {
  isAdmin,
  canBlockUsers,
  canHandleExternal,
  isExternalUser,
  isValidConversationPair,
  getExternalAndInternal,
  getOrCreateAssignmentForPair,
  getBlockState,
} = require('../utils/chat-access')

const router = express.Router()

async function resolveUserByIdentifier(identifier) {
  const directMatch = await User.findOne({
    where: {
      [Op.or]: [{ uniqueUsername: identifier }, { email: identifier }, { mobileNumber: identifier }],
    },
    attributes: ['id', 'username', 'uniqueUsername', 'role', 'canHandleExternalChat', 'email', 'mobileNumber', 'dateOfBirth', 'lastSeen', 'profileMediaUrl', 'createdAt'],
  })
  if (directMatch) return directMatch
  return null
}

function extractUploadProfilePath(mediaUrl) {
  try {
    const raw = String(mediaUrl || '').trim()
    if (!raw) return null
    const pathname = decodeURIComponent(
      raw.startsWith('/')
        ? raw
        : new URL(raw).pathname,
    )
    const match = pathname.match(/\/public\/chat\/([^/]+)\/profile\/([^/]+)$/)
    if (!match) return null
    return {
      uniqueUsername: match[1],
      filename: match[2],
    }
  } catch (error) {
    return null
  }
}

async function deleteProfileMediaFromUploadServer(mediaUrl) {
  if (!UPLOAD_SERVER_URL || !mediaUrl) return
  const parsed = extractUploadProfilePath(mediaUrl)
  if (!parsed) return

  const endpoint = `${UPLOAD_SERVER_URL}/delete/chat/${encodeURIComponent(parsed.uniqueUsername)}/profile/${encodeURIComponent(parsed.filename)}`
  await fetch(endpoint, { method: 'DELETE' }).catch(() => null)
}

function isProfileMediaUrlValidForUser(mediaUrl, uniqueUsername) {
  try {
    const raw = String(mediaUrl || '').trim()
    if (!raw) return false
    const pathname = decodeURIComponent(
      raw.startsWith('/')
        ? raw
        : new URL(raw).pathname,
    ).toLowerCase()
    const userPath = `/chat/${String(uniqueUsername).toLowerCase()}/`
    return pathname.includes(`${userPath}profile/`)
  } catch (error) {
    return false
  }
}

function serializeLookupUser(user) {
  return {
    id: user.id,
    username: user.username,
    uniqueUsername: user.uniqueUsername,
    role: user.role || 'user',
    canHandleExternalChat: Boolean(user.canHandleExternalChat),
    canBlockUsers: Boolean(user.canBlockUsers),
    email: user.email,
    mobileNumber: user.mobileNumber,
    dateOfBirth: user.dateOfBirth || null,
    lastSeen: user.lastSeen,
    profileMediaUrl: user.profileMediaUrl,
    createdAt: user.createdAt,
  }
}

async function ensureOneWayContact(userId, contactUserId) {
  await Contact.findOrCreate({
    where: { userId, contactUserId },
    defaults: { userId, contactUserId },
  })
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const q = (req.query.q || '').trim()
    const requestedLimit = Number(req.query.limit)
    const limit = Number.isInteger(requestedLimit) ? Math.max(10, Math.min(100, requestedLimit)) : 30
    const cursorTime = String(req.query.cursorTime || '').trim()
    const cursorId = Number(req.query.cursorId)
    const hasCursor = Boolean(cursorTime) && Number.isInteger(cursorId) && cursorId > 0
    const likeQ = `%${q}%`
    const filterClause = q
      ? `AND (
          u.username LIKE :likeQ
          OR u.unique_username LIKE :likeQ
          OR u.email LIKE :likeQ
          OR u.mobile_number LIKE :likeQ
        )`
      : ''

    const cursorClause = hasCursor
      ? `
        AND (
          ranked.sortBucket > :cursorBucket
          OR (ranked.sortBucket = :cursorBucket AND ranked.sortTime < :cursorSortTime)
          OR (ranked.sortBucket = :cursorBucket AND ranked.sortTime = :cursorSortTime AND ranked.id > :cursorId)
        )
      `
      : ''

    let cursorBucket = 0
    let cursorSortTime = null
    if (hasCursor) {
      cursorSortTime = cursorTime
      cursorBucket = cursorTime ? 0 : 1
    }

    const rows = await sequelize.query(
      `
      SELECT *
      FROM (
        SELECT
          u.id AS id,
          u.username AS username,
          u.unique_username AS uniqueUsername,
          u.role AS role,
          u.can_handle_external_chat AS canHandleExternalChat,
          u.email AS email,
          u.mobile_number AS mobileNumber,
          u.date_of_birth AS dateOfBirth,
          u.last_seen AS lastSeen,
          u.profile_media_url AS profileMediaUrl,
          u.created_at AS createdAt,
          EXISTS(
            SELECT 1
            FROM user_blocks ub_blocked
            WHERE ub_blocked.blocker_id = :currentUserId
              AND ub_blocked.blocked_user_id = u.id
          ) AS isBlockedByMe,
          EXISTS(
            SELECT 1
            FROM user_blocks ub_blocked_me
            WHERE ub_blocked_me.blocker_id = u.id
              AND ub_blocked_me.blocked_user_id = :currentUserId
          ) AS hasBlockedMe,
          (
            SELECT MAX(m.created_at)
            FROM messages m
            WHERE
              (m.sender_id = :currentUserId AND m.receiver_id = u.id)
              OR
              (m.sender_id = u.id AND m.receiver_id = :currentUserId)
          ) AS lastMessageAt,
          (
            SELECT COUNT(*)
            FROM messages um
            WHERE
              um.receiver_id = :currentUserId
              AND um.sender_id = u.id
              AND um.seen = 0
          ) AS unreadCount,
          CASE
            WHEN (
              SELECT MAX(m2.created_at)
              FROM messages m2
              WHERE
                (m2.sender_id = :currentUserId AND m2.receiver_id = u.id)
                OR
                (m2.sender_id = u.id AND m2.receiver_id = :currentUserId)
            ) IS NULL THEN 1
            ELSE 0
          END AS sortBucket,
          COALESCE((
            SELECT MAX(m3.created_at)
            FROM messages m3
            WHERE
              (m3.sender_id = :currentUserId AND m3.receiver_id = u.id)
              OR
              (m3.sender_id = u.id AND m3.receiver_id = :currentUserId)
          ), u.created_at) AS sortTime
        FROM contacts c
        INNER JOIN users u ON u.id = c.contact_user_id
        WHERE c.user_id = :currentUserId
        ${filterClause}
      ) ranked
      WHERE 1 = 1
      ${cursorClause}
      ORDER BY ranked.sortBucket ASC, ranked.sortTime DESC, ranked.id ASC
      LIMIT :cursorLimit
      `,
      {
        replacements: {
          currentUserId: req.user.id,
          likeQ,
          cursorBucket,
          cursorSortTime,
          cursorId,
          cursorLimit: limit + 1,
        },
        type: QueryTypes.SELECT,
      },
    )

    const onlineUserSockets = req.app.get('onlineUserSockets') || new Map()
    const hasMore = rows.length > limit
    const trimmedRows = hasMore ? rows.slice(0, limit) : rows
    const users = trimmedRows.map((row) => ({
      ...row,
      canHandleExternalChat: Boolean(row.canHandleExternalChat),
      unreadCount: Number(row.unreadCount) || 0,
      isBlockedByMe: Boolean(row.isBlockedByMe),
      hasBlockedMe: Boolean(row.hasBlockedMe),
      isOnline: onlineUserSockets.has(Number(row.id)),
    }))
    const lastItem = trimmedRows[trimmedRows.length - 1] || null
    const nextCursor = hasMore && lastItem
      ? {
          cursorTime: lastItem.sortTime || lastItem.createdAt || '',
          cursorId: Number(lastItem.id),
        }
      : null
    return res.json({ users, limit, hasMore, nextCursor })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load users', error: error.message })
  }
})

router.post('/contacts', authMiddleware, async (req, res) => {
  try {
    const identifier = (req.body.identifier || '').trim()
    if (!identifier) {
      return res.status(400).json({ message: 'identifier is required' })
    }

    const targetUser = await resolveUserByIdentifier(identifier)

    if (!targetUser) {
      return res.status(404).json({ message: 'User not found with this identifier' })
    }
    if (targetUser.id === req.user.id) {
      return res.status(400).json({ message: 'You cannot add yourself as contact' })
    }
    const blockState = await getBlockState(req.user.id, targetUser.id)
    if (blockState.hasBlockedMe) {
      return res.status(403).json({ message: 'This user blocked you' })
    }

    if (isAdmin(req.user) && !isExternalUser(targetUser)) {
      await ensureOneWayContact(req.user.id, targetUser.id)
      return res.status(201).json({
        message: 'Conversation added successfully',
        contact: serializeLookupUser(targetUser),
        assignment: null,
      })
    }

    if (!isValidConversationPair(req.user, targetUser)) {
      return res.status(403).json({ message: 'Only external user and internal team member chat is allowed' })
    }

    const { externalUser, internalUser } = getExternalAndInternal(req.user, targetUser)
    if (!canHandleExternal(internalUser)) {
      return res.status(403).json({ message: 'This user is not allowed to handle external conversations' })
    }

    let assignment = await ConversationAssignment.findOne({
      where: { externalUserId: externalUser.id },
    })

    if (assignment && Number(assignment.assignedToUserId) !== Number(internalUser.id)) {
      return res.status(403).json({ message: 'This conversation is assigned to another team member' })
    }
    if (!assignment) {
      assignment = await getOrCreateAssignmentForPair({
        externalUser,
        internalUser,
        assignedByUserId: isAdmin(req.user) ? req.user.id : null,
      })
    }

    await ensureOneWayContact(assignment.assignedToUserId, externalUser.id)
    await ensureOneWayContact(externalUser.id, Number(assignment.publicHandlerUserId || assignment.assignedToUserId))

    return res.status(201).json({
      message: 'Conversation added successfully',
      contact: serializeLookupUser(targetUser),
      assignment: {
        externalUserId: assignment.externalUserId,
        assignedToUserId: assignment.assignedToUserId,
      },
    })
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message })
    }
    return res.status(500).json({ message: 'Failed to add contact', error: error.message })
  }
})

router.get('/lookup', authMiddleware, async (req, res) => {
  try {
    const identifier = (req.query.identifier || '').trim()
    if (!identifier) {
      return res.status(400).json({ message: 'identifier is required' })
    }

    const targetUser = await resolveUserByIdentifier(identifier)

    if (!targetUser) {
      return res.status(404).json({ message: 'No user found with this identifier' })
    }

    if (targetUser.id === req.user.id) {
      return res.json({
        user: serializeLookupUser(targetUser),
        alreadyContact: false,
        isSelf: true,
      })
    }
    const blockState = await getBlockState(req.user.id, targetUser.id)
    if (blockState.hasBlockedMe) {
      return res.status(403).json({ message: 'This user blocked you' })
    }

    if (isAdmin(req.user) && !isExternalUser(targetUser)) {
      const contact = await Contact.findOne({
        where: { userId: req.user.id, contactUserId: targetUser.id },
      })
      return res.json({
        user: serializeLookupUser(targetUser),
        alreadyContact: Boolean(contact),
        isSelf: false,
      })
    }

    if (!isValidConversationPair(req.user, targetUser)) {
      return res.status(403).json({ message: 'This user cannot be added to your chat list' })
    }
    const { internalUser, externalUser } = getExternalAndInternal(req.user, targetUser)
    if (!canHandleExternal(internalUser)) {
      return res.status(403).json({ message: 'This user is not allowed to handle external conversations' })
    }
    const assignment = await ConversationAssignment.findOne({
      where: { externalUserId: externalUser.id },
    })
    const blockedByAssignment = assignment && (
      isExternalUser(req.user)
        ? Number(assignment.publicHandlerUserId || assignment.assignedToUserId) !== Number(targetUser.id)
        : Number(assignment.assignedToUserId) !== Number(internalUser.id)
    )
    if (blockedByAssignment) {
      return res.status(403).json({ message: 'Conversation already assigned to another team member' })
    }

    const contact = await Contact.findOne({
      where: { userId: req.user.id, contactUserId: targetUser.id },
    })

    return res.json({
      user: serializeLookupUser(targetUser),
      alreadyContact: Boolean(contact),
      isSelf: false,
    })
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message })
    }
    return res.status(500).json({ message: 'Failed to lookup user', error: error.message })
  }
})

router.delete('/contacts/:contactUserId', authMiddleware, async (req, res) => {
  return res.status(403).json({ message: 'Contact removal is disabled.' })
})

router.post('/profile-media', authMiddleware, async (req, res) => {
  try {
    const profileMediaUrl = (req.body.profileMediaUrl || '').trim()
    if (!profileMediaUrl) {
      return res.status(400).json({ message: 'profileMediaUrl is required' })
    }
    if (!isProfileMediaUrlValidForUser(profileMediaUrl, req.user.uniqueUsername || req.user.username)) {
      return res.status(400).json({
        message: 'Invalid profile media URL path. It must be inside your chat/<uniqueUsername>/profile folder',
      })
    }

    const previousProfileMediaUrl = req.user.profileMediaUrl
    req.user.profileMediaUrl = profileMediaUrl
    await req.user.save()

    if (previousProfileMediaUrl && previousProfileMediaUrl !== profileMediaUrl) {
      await deleteProfileMediaFromUploadServer(previousProfileMediaUrl)
    }

    return res.json({
      message: 'Profile media updated',
      user: {
        id: req.user.id,
        username: req.user.username,
        uniqueUsername: req.user.uniqueUsername,
        role: req.user.role || 'user',
        canHandleExternalChat: Boolean(req.user.canHandleExternalChat),
        canDownloadConversations: Boolean(req.user.canDownloadConversations),
        canEditConversationNote: Boolean(req.user.canEditConversationNote),
        canBlockUsers: Boolean(req.user.canBlockUsers),
        email: req.user.email,
        mobileNumber: req.user.mobileNumber,
        lastSeen: req.user.lastSeen,
        profileMediaUrl: req.user.profileMediaUrl,
        profileNote: req.user.canEditConversationNote ? (req.user.profileNote || '') : '',
      },
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update profile media', error: error.message })
  }
})

router.patch('/profile-note', authMiddleware, async (req, res) => {
  try {
    if (!Boolean(req.user?.canEditConversationNote)) {
      return res.status(403).json({ message: 'Note access is disabled for this account' })
    }

    const profileNote = String(req.body?.profileNote || '').trim()
    req.user.profileNote = profileNote || null
    await req.user.save()

    return res.json({
      message: 'Profile note updated',
      user: {
        id: req.user.id,
        username: req.user.username,
        uniqueUsername: req.user.uniqueUsername,
        role: req.user.role || 'user',
        canHandleExternalChat: Boolean(req.user.canHandleExternalChat),
        canDownloadConversations: Boolean(req.user.canDownloadConversations),
        canEditConversationNote: Boolean(req.user.canEditConversationNote),
        canBlockUsers: Boolean(req.user.canBlockUsers),
        email: req.user.email,
        mobileNumber: req.user.mobileNumber,
        lastSeen: req.user.lastSeen,
        profileMediaUrl: req.user.profileMediaUrl,
        profileNote: req.user.profileNote || '',
      },
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update profile note', error: error.message })
  }
})

router.post('/:userId/block', authMiddleware, async (req, res) => {
  try {
    if (!canBlockUsers(req.user)) {
      return res.status(403).json({ message: 'Block access is disabled by admin' })
    }

    const otherUserId = Number(req.params.userId)
    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    if (otherUserId === Number(req.user.id)) {
      return res.status(400).json({ message: 'You cannot block yourself' })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) return res.status(404).json({ message: 'User not found' })

    const blockState = await getBlockState(req.user.id, otherUserId)
    if (blockState.hasBlockedMe) {
      return res.status(403).json({ message: 'You cannot block this user until they unblock you' })
    }

    await UserBlock.findOrCreate({
      where: { blockerId: req.user.id, blockedUserId: otherUserId },
      defaults: { blockerId: req.user.id, blockedUserId: otherUserId },
    })

    const io = req.app.get('io')
    io.to(`user:${req.user.id}`).emit('chat:block-status-updated', {
      userId: otherUserId,
      isBlockedByMe: true,
      hasBlockedMe: false,
    })
    io.to(`user:${otherUserId}`).emit('chat:block-status-updated', {
      userId: Number(req.user.id),
      isBlockedByMe: false,
      hasBlockedMe: true,
    })

    return res.json({ message: 'User blocked successfully', blockedUserId: otherUserId })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to block user', error: error.message })
  }
})

router.delete('/:userId/block', authMiddleware, async (req, res) => {
  try {
    if (!canBlockUsers(req.user)) {
      return res.status(403).json({ message: 'Block access is disabled by admin' })
    }

    const otherUserId = Number(req.params.userId)
    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    if (otherUserId === Number(req.user.id)) {
      return res.status(400).json({ message: 'You cannot unblock yourself' })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) return res.status(404).json({ message: 'User not found' })

    await UserBlock.destroy({
      where: { blockerId: req.user.id, blockedUserId: otherUserId },
    })

    await ensureOneWayContact(req.user.id, otherUserId)
    await ensureOneWayContact(otherUserId, req.user.id)

    const io = req.app.get('io')
    io.to(`user:${req.user.id}`).emit('chat:block-status-updated', {
      userId: otherUserId,
      isBlockedByMe: false,
      hasBlockedMe: false,
    })
    io.to(`user:${otherUserId}`).emit('chat:block-status-updated', {
      userId: Number(req.user.id),
      isBlockedByMe: false,
      hasBlockedMe: false,
    })

    return res.json({ message: 'User unblocked successfully', blockedUserId: otherUserId })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to unblock user', error: error.message })
  }
})

module.exports = router
