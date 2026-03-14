const express = require('express')
const { Op, QueryTypes } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { User, Contact, Message, sequelize } = require('../models')
const { UPLOAD_SERVER_URL } = require('../utils/upload-server')

const router = express.Router()

async function resolveUserByIdentifier(identifier) {
  const directMatch = await User.findOne({
    where: {
      [Op.or]: [{ uniqueUsername: identifier }, { email: identifier }, { mobileNumber: identifier }],
    },
    attributes: ['id', 'username', 'uniqueUsername', 'email', 'mobileNumber', 'lastSeen', 'profileMediaUrl', 'createdAt'],
  })
  if (directMatch) return directMatch

  const sameNameUsers = await User.findAll({
    where: { username: identifier },
    attributes: ['id', 'username', 'uniqueUsername', 'email', 'mobileNumber', 'lastSeen', 'profileMediaUrl', 'createdAt'],
    limit: 2,
  })
  if (sameNameUsers.length === 1) return sameNameUsers[0]
  if (sameNameUsers.length > 1) {
    const error = new Error('Multiple users found with this name. Please search by unique username/email/mobile')
    error.statusCode = 409
    throw error
  }
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
    const match = pathname.match(/\/uploads\/chat\/([^/]+)\/profile\/([^/]+)$/)
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

router.get('/', authMiddleware, async (req, res) => {
  try {
    const q = (req.query.q || '').trim()
    const requestedLimit = Number(req.query.limit)
    const limit = Number.isInteger(requestedLimit) ? Math.max(10, Math.min(100, requestedLimit)) : 30
    const requestedPage = Number(req.query.page)
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const offset = (page - 1) * limit
    const likeQ = `%${q}%`

    const filterClause = q
      ? `AND (
          u.username LIKE :likeQ
          OR u.unique_username LIKE :likeQ
          OR u.email LIKE :likeQ
          OR u.mobile_number LIKE :likeQ
        )`
      : ''

    const [{ total = 0 } = { total: 0 }] = await sequelize.query(
      `
      SELECT COUNT(*) AS total
      FROM contacts c
      INNER JOIN users u ON u.id = c.contact_user_id
      WHERE c.user_id = :currentUserId
      ${filterClause}
      `,
      {
        replacements: { currentUserId: req.user.id, likeQ },
        type: QueryTypes.SELECT,
      },
    )

    const rows = await sequelize.query(
      `
      SELECT
        u.id AS id,
        u.username AS username,
        u.unique_username AS uniqueUsername,
        u.email AS email,
        u.mobile_number AS mobileNumber,
        u.last_seen AS lastSeen,
        u.profile_media_url AS profileMediaUrl,
        u.created_at AS createdAt,
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
        ) AS unreadCount
      FROM contacts c
      INNER JOIN users u ON u.id = c.contact_user_id
      WHERE c.user_id = :currentUserId
      ${filterClause}
      ORDER BY
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
        END ASC,
        (
          SELECT MAX(m3.created_at)
          FROM messages m3
          WHERE
            (m3.sender_id = :currentUserId AND m3.receiver_id = u.id)
            OR
            (m3.sender_id = u.id AND m3.receiver_id = :currentUserId)
        ) DESC,
        u.username ASC
      LIMIT :limit OFFSET :offset
      `,
      {
        replacements: {
          currentUserId: req.user.id,
          likeQ,
          limit,
          offset,
        },
        type: QueryTypes.SELECT,
      },
    )

    const onlineUserSockets = req.app.get('onlineUserSockets') || new Map()
    const users = rows.map((row) => ({
      ...row,
      unreadCount: Number(row.unreadCount) || 0,
      isOnline: onlineUserSockets.has(Number(row.id)),
    }))

    const hasMore = offset + users.length < Number(total || 0)
    return res.json({ users, page, limit, hasMore })
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

    const [, created] = await Contact.findOrCreate({
      where: { userId: req.user.id, contactUserId: targetUser.id },
      defaults: { userId: req.user.id, contactUserId: targetUser.id },
    })

    await Contact.findOrCreate({
      where: { userId: targetUser.id, contactUserId: req.user.id },
      defaults: { userId: targetUser.id, contactUserId: req.user.id },
    })

    return res.status(created ? 201 : 200).json({
      message: 'Contact added successfully',
      contact: targetUser,
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
        user: targetUser,
        alreadyContact: false,
        isSelf: true,
      })
    }

    const contact = await Contact.findOne({
      where: { userId: req.user.id, contactUserId: targetUser.id },
    })

    return res.json({
      user: targetUser,
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
  try {
    const contactUserId = Number(req.params.contactUserId)
    if (!Number.isInteger(contactUserId)) {
      return res.status(400).json({ message: 'Invalid contactUserId' })
    }

    const deleted = await Contact.destroy({
      where: { userId: req.user.id, contactUserId },
    })

    if (!deleted) {
      return res.status(404).json({ message: 'Contact not found' })
    }

    return res.json({ message: 'Contact removed' })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to remove contact', error: error.message })
  }
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
        email: req.user.email,
        mobileNumber: req.user.mobileNumber,
        lastSeen: req.user.lastSeen,
        profileMediaUrl: req.user.profileMediaUrl,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update profile media', error: error.message })
  }
})

module.exports = router
