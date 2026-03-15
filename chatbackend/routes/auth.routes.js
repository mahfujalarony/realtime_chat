const express = require('express')
const { Op } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { User, sequelize } = require('../models')
const { signToken } = require('../utils/token')
const { ensureUserFolder, deleteUserFolder } = require('../utils/upload-server')
const { buildUnusedUniqueUsername, ensureUserUniqueUsername } = require('../utils/user-identity')

const router = express.Router()

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    uniqueUsername: user.uniqueUsername,
    role: user.role || 'user',
    email: user.email,
    mobileNumber: user.mobileNumber,
    dateOfBirth: user.dateOfBirth,
    lastSeen: user.lastSeen,
    profileMediaUrl: user.profileMediaUrl,
    createdAt: user.createdAt,
  }
}

router.post('/register', async (req, res) => {
  try {
    const { username, email, mobileNumber, dateOfBirth, password } = req.body

    if (!username || !dateOfBirth || !password) {
      return res.status(400).json({ message: 'username, dateOfBirth, password are required' })
    }
    if (!email && !mobileNumber) {
      return res.status(400).json({ message: 'email or mobileNumber is required' })
    }

    const whereOr = []
    if (email) whereOr.push({ email })
    if (mobileNumber) whereOr.push({ mobileNumber })

    const existing =
      whereOr.length > 0
        ? await User.scope('withPassword').findOne({
            where: { [Op.or]: whereOr },
          })
        : null
    if (existing) {
      return res.status(409).json({ message: 'email/mobile already in use' })
    }

    const uniqueUsername = await buildUnusedUniqueUsername(User, username)

    try {
      await ensureUserFolder(uniqueUsername)
    } catch (folderError) {
      return res.status(502).json({
        message: 'Registration failed because upload folder creation failed',
        error: folderError.message,
      })
    }

    let user
    try {
      user = await sequelize.transaction(async (t) =>
        User.create(
          {
            username,
            uniqueUsername,
            email: email || null,
            mobileNumber: mobileNumber || null,
            dateOfBirth,
            passwordHash: password,
            role: 'user',
            lastSeen: new Date(),
          },
          { transaction: t },
        ),
      )
    } catch (dbError) {
      await deleteUserFolder(uniqueUsername).catch(() => null)
      throw dbError
    }

    const token = signToken(user.id)
    return res.status(201).json({
      message: 'Registration successful',
      token,
      user: serializeUser(user),
    })
  } catch (error) {
    return res.status(500).json({ message: 'Registration failed', error: error.message })
  }
})

router.post('/rollback-registration', authMiddleware, async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    const uniqueUsername = req.user?.uniqueUsername || req.user?.username

    if (!Number.isInteger(userId) || !uniqueUsername) {
      return res.status(400).json({ message: 'Invalid rollback context' })
    }

    await sequelize.transaction(async (t) => {
      await User.destroy({ where: { id: userId }, transaction: t })
    })
    await deleteUserFolder(uniqueUsername).catch(() => null)

    return res.json({ message: 'Registration rolled back' })
  } catch (error) {
    return res.status(500).json({ message: 'Rollback failed', error: error.message })
  }
})

router.post('/login', async (req, res) => {
  try {
    const identifierRaw = req.body.identifier || req.body.username
    const identifier = String(identifierRaw || '').trim()
    const { password } = req.body

    if (!identifier || !password) {
      return res.status(400).json({ message: 'identifier (or username) and password are required' })
    }

    let user = await User.scope('withPassword').findOne({
      where: {
        [Op.or]: [{ uniqueUsername: identifier }, { email: identifier }, { mobileNumber: identifier }],
      },
    })

    if (!user) {
      const sameName = await User.scope('withPassword').findAll({
        where: { username: identifier },
        limit: 2,
      })
      if (sameName.length === 1) {
        user = sameName[0]
      } else if (sameName.length > 1) {
        return res.status(409).json({ message: 'Multiple users found with this name. Please login using unique username/email/mobile' })
      }
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    const valid = await user.comparePassword(password)
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    await ensureUserUniqueUsername(user, User)
    user.lastSeen = new Date()
    await user.save()

    const token = signToken(user.id)
    return res.json({
      message: 'Login successful',
      token,
      user: serializeUser(user),
    })
  } catch (error) {
    return res.status(500).json({ message: 'Login failed', error: error.message })
  }
})

router.get('/me', authMiddleware, async (req, res) => {
  return res.json({ user: serializeUser(req.user) })
})

module.exports = router
