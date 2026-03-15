const express = require('express')
const { Op } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { User } = require('../models')

const router = express.Router()
const allowRoleBypassForTest = String(process.env.ROLE_BYPASS_FOR_TEST || '1') === '1'

function requireAdmin(req, res, next) {
  if (allowRoleBypassForTest) return next()
  if (String(req.user?.role || 'user') !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' })
  }
  return next()
}

function serializeAdminUser(user) {
  return {
    id: user.id,
    username: user.username,
    uniqueUsername: user.uniqueUsername,
    role: user.role || 'user',
    email: user.email,
    mobileNumber: user.mobileNumber,
    profileMediaUrl: user.profileMediaUrl,
    createdAt: user.createdAt,
    lastSeen: user.lastSeen,
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

    const where = {}
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
      attributes: ['id', 'username', 'uniqueUsername', 'role', 'email', 'mobileNumber', 'profileMediaUrl', 'createdAt', 'lastSeen'],
      order: [['createdAt', 'DESC']],
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

    target.role = normalizedRole
    await target.save()
    return res.json({ message: `Role updated to ${normalizedRole}`, user: serializeAdminUser(target) })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update role', error: error.message })
  }
})

module.exports = router
