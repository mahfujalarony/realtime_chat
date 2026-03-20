const express = require('express')
const { Op } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { User, Message, Contact, PushSubscription, ConversationAssignment, sequelize } = require('../models')
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/token')
const { ensureUserFolder, deleteUserFolder } = require('../utils/upload-server')
const { buildUnusedUniqueUsername, ensureUserUniqueUsername } = require('../utils/user-identity')
const { setRefreshTokenCookie, clearRefreshTokenCookie, getRefreshTokenFromRequest } = require('../utils/cookies')
const { getThrottleState, recordFailedLogin, clearFailedLoginState, getRateLimitMessage } = require('../utils/login-rate-limit')

const router = express.Router()

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    uniqueUsername: user.uniqueUsername,
    role: user.role || 'user',
    canHandleExternalChat: Boolean(user.canHandleExternalChat),
    canDownloadConversations: Boolean(user.canDownloadConversations),
    canEditConversationNote: Boolean(user.canEditConversationNote),
    canBlockUsers: Boolean(user.canBlockUsers),
    email: user.email,
    mobileNumber: user.mobileNumber,
    dateOfBirth: user.dateOfBirth,
    lastSeen: user.lastSeen,
    profileMediaUrl: user.profileMediaUrl,
    profileNote: user.canEditConversationNote ? (user.profileNote || '') : '',
    createdAt: user.createdAt,
  }
}

function buildAuthPayload(user) {
  return {
    token: signAccessToken(user.id),
    user: serializeUser(user),
  }
}

async function rollbackRegisteredUserArtifacts(userId, uniqueUsername) {
  const normalizedUserId = Number(userId)
  const normalizedUniqueUsername = String(uniqueUsername || '').trim()

  if (!Number.isInteger(normalizedUserId) || !normalizedUniqueUsername) {
    throw new Error('Invalid rollback context')
  }

  // Delete upload folder first so we don't leave orphaned media after DB cleanup.
  await deleteUserFolder(normalizedUniqueUsername)

  await sequelize.transaction(async (t) => {
    await PushSubscription.destroy({
      where: { userId: normalizedUserId },
      transaction: t,
    })
    await Contact.destroy({
      where: {
        [Op.or]: [{ userId: normalizedUserId }, { contactUserId: normalizedUserId }],
      },
      transaction: t,
    })
    await Message.destroy({
      where: {
        [Op.or]: [{ senderId: normalizedUserId }, { receiverId: normalizedUserId }],
      },
      transaction: t,
    })
    await ConversationAssignment.destroy({
      where: {
        [Op.or]: [
          { externalUserId: normalizedUserId },
          { assignedToUserId: normalizedUserId },
          { publicHandlerUserId: normalizedUserId },
          { assignedByUserId: normalizedUserId },
        ],
      },
      transaction: t,
    })
    await User.destroy({
      where: { id: normalizedUserId },
      transaction: t,
    })
  })
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

    const refreshToken = signRefreshToken(user.id)
    const authPayload = buildAuthPayload(user)
    setRefreshTokenCookie(res, req, refreshToken)
    return res.status(201).json({
      message: 'Registration successful',
      ...authPayload,
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

    await rollbackRegisteredUserArtifacts(userId, uniqueUsername)

    return res.json({ message: 'Registration rolled back' })
  } catch (error) {
    return res.status(500).json({
      message: 'Rollback failed. Please retry rollback to avoid partial registration.',
      error: error.message,
    })
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

    const throttleState = getThrottleState(req, identifier)
    if (throttleState.blocked) {
      return res.status(429).json({ message: getRateLimitMessage(throttleState.remainingMs) })
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
      const failedState = recordFailedLogin(req, identifier)
      if (failedState.blocked) {
        return res.status(429).json({ message: getRateLimitMessage(failedState.remainingMs) })
      }
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    await ensureUserUniqueUsername(user, User)
    clearFailedLoginState(req, identifier)
    user.lastSeen = new Date()
    await user.save()

    const refreshToken = signRefreshToken(user.id)
    const authPayload = buildAuthPayload(user)
    setRefreshTokenCookie(res, req, refreshToken)
    return res.json({
      message: 'Login successful',
      ...authPayload,
    })
  } catch (error) {
    return res.status(500).json({ message: 'Login failed', error: error.message })
  }
})

router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = getRefreshTokenFromRequest(req)
    if (!refreshToken) {
      return res.status(401).json({ message: 'Unauthorized: refresh token missing' })
    }

    const decoded = verifyRefreshToken(refreshToken)
    const user = await User.findByPk(decoded.userId)
    if (!user) {
      clearRefreshTokenCookie(res, req)
      return res.status(401).json({ message: 'Unauthorized: user not found' })
    }

    await ensureUserUniqueUsername(user, User)
    const nextRefreshToken = signRefreshToken(user.id)
    const authPayload = buildAuthPayload(user)
    setRefreshTokenCookie(res, req, nextRefreshToken)
    return res.json({
      message: 'Session refreshed',
      ...authPayload,
    })
  } catch (error) {
    clearRefreshTokenCookie(res, req)
    return res.status(401).json({ message: 'Unauthorized: invalid refresh token' })
  }
})

router.get('/me', authMiddleware, async (req, res) => {
  return res.json({ user: serializeUser(req.user) })
})

router.post('/logout', (req, res) => {
  clearRefreshTokenCookie(res, req)
  return res.json({ message: 'Logout successful' })
})

module.exports = router
