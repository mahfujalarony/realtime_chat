const express = require('express')
const { Op } = require('sequelize')
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
    const parsed = new URL(mediaUrl)
    const pathname = decodeURIComponent(parsed.pathname)
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
    const parsed = new URL(mediaUrl)
    const pathname = decodeURIComponent(parsed.pathname).toLowerCase()
    const userPath = `/chat/${String(uniqueUsername).toLowerCase()}/`
    return pathname.includes(`${userPath}profile/`)
  } catch (error) {
    return false
  }
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const q = (req.query.q || '').trim()
    const where = { userId: req.user.id }
    const contactUserWhere = {}
    if (q) {
      contactUserWhere[Op.or] = [
        { username: { [Op.like]: `%${q}%` } },
        { uniqueUsername: { [Op.like]: `%${q}%` } },
        { email: { [Op.like]: `%${q}%` } },
        { mobileNumber: { [Op.like]: `%${q}%` } },
      ]
    }

    const contacts = await Contact.findAll({
      where,
      include: [
        {
          model: User,
          as: 'contactUser',
          attributes: ['id', 'username', 'uniqueUsername', 'email', 'mobileNumber', 'lastSeen', 'profileMediaUrl', 'createdAt'],
          where: contactUserWhere,
          required: true,
        },
      ],
      order: [[{ model: User, as: 'contactUser' }, 'username', 'ASC']],
    })

    const onlineUserSockets = req.app.get('onlineUserSockets') || new Map()
    const users = contacts.map((item) => {
      const user = item.contactUser.toJSON()
      return {
        ...user,
        isOnline: onlineUserSockets.has(user.id),
      }
    })

    const contactIds = users.map((u) => u.id)
    let unreadBySenderId = {}
    if (contactIds.length > 0) {
      const unreadRows = await Message.findAll({
        where: {
          receiverId: req.user.id,
          seen: false,
          senderId: { [Op.in]: contactIds },
        },
        attributes: ['senderId', [sequelize.fn('COUNT', sequelize.col('id')), 'unreadCount']],
        group: ['senderId'],
        raw: true,
      })
      unreadBySenderId = unreadRows.reduce((acc, row) => {
        acc[Number(row.senderId)] = Number(row.unreadCount) || 0
        return acc
      }, {})
    }

    const withUnread = users.map((user) => ({
      ...user,
      unreadCount: unreadBySenderId[user.id] || 0,
    }))
    return res.json({ users: withUnread })
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
