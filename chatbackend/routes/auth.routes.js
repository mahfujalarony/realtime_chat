const express = require('express')
const { Op } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { User } = require('../models')
const { signToken } = require('../utils/token')

const router = express.Router()

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    mobileNumber: user.mobileNumber,
    dateOfBirth: user.dateOfBirth,
    lastSeen: user.lastSeen,
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

    const whereOr = [{ username }]
    if (email) whereOr.push({ email })
    if (mobileNumber) whereOr.push({ mobileNumber })

    const existing = await User.scope('withPassword').findOne({
      where: { [Op.or]: whereOr },
    })
    if (existing) {
      return res.status(409).json({ message: 'username/email/mobile already in use' })
    }

    const user = await User.create({
      username,
      email: email || null,
      mobileNumber: mobileNumber || null,
      dateOfBirth,
      passwordHash: password,
      lastSeen: new Date(),
    })

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

router.post('/login', async (req, res) => {
  try {
    const identifier = req.body.identifier || req.body.username
    const { password } = req.body

    if (!identifier || !password) {
      return res.status(400).json({ message: 'identifier (or username) and password are required' })
    }

    const user = await User.scope('withPassword').findOne({
      where: {
        [Op.or]: [{ username: identifier }, { email: identifier }, { mobileNumber: identifier }],
      },
    })

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    const valid = await user.comparePassword(password)
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

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
