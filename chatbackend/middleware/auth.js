const { User } = require('../models')
const { ensureUserUniqueUsername } = require('../utils/user-identity')
const { verifyAccessToken } = require('../utils/token')

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Unauthorized: token missing' })
    }

    const decoded = verifyAccessToken(token)
    const user = await User.findByPk(decoded.userId)

    if (!user) {
      return res.status(401).json({ message: 'Unauthorized: user not found' })
    }

    await ensureUserUniqueUsername(user, User)
    req.user = user
    next()
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized: invalid token' })
  }
}

module.exports = authMiddleware
