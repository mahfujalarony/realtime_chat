const jwt = require('jsonwebtoken')
const { User } = require('../models')
const { ensureUserUniqueUsername } = require('../utils/user-identity')

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Unauthorized: token missing' })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me')
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
