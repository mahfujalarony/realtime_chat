const express = require('express')
const { Op } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { User, Contact } = require('../models')

const router = express.Router()

function isProfileMediaUrlValidForUser(mediaUrl, username) {
  try {
    const parsed = new URL(mediaUrl)
    const pathname = decodeURIComponent(parsed.pathname).toLowerCase()
    const userPath = `/chat/${String(username).toLowerCase()}/`
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
          attributes: ['id', 'username', 'email', 'mobileNumber', 'lastSeen', 'profileMediaUrl', 'createdAt'],
          where: contactUserWhere,
          required: true,
        },
      ],
      order: [[{ model: User, as: 'contactUser' }, 'username', 'ASC']],
    })

    const users = contacts.map((item) => item.contactUser)
    return res.json({ users })
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

    const targetUser = await User.findOne({
      where: {
        [Op.or]: [{ username: identifier }, { email: identifier }, { mobileNumber: identifier }],
      },
      attributes: ['id', 'username', 'email', 'mobileNumber', 'lastSeen', 'profileMediaUrl', 'createdAt'],
    })

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
    return res.status(500).json({ message: 'Failed to add contact', error: error.message })
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
    if (!isProfileMediaUrlValidForUser(profileMediaUrl, req.user.username)) {
      return res.status(400).json({
        message: 'Invalid profile media URL path. It must be inside your chat/<username>/profile folder',
      })
    }

    req.user.profileMediaUrl = profileMediaUrl
    await req.user.save()

    return res.json({
      message: 'Profile media updated',
      user: {
        id: req.user.id,
        username: req.user.username,
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
