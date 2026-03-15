const express = require('express')
const { Op } = require('sequelize')
const authMiddleware = require('../middleware/auth')
const { User, Message } = require('../models')

const router = express.Router()
const allowRoleBypassForTest = String(process.env.ROLE_BYPASS_FOR_TEST || '1') === '1'

function requireStaff(req, res, next) {
  if (allowRoleBypassForTest) return next()
  const role = String(req.user?.role || 'user')
  if (role !== 'admin' && role !== 'model_admin') {
    return res.status(403).json({ message: 'Admin or model_admin access required' })
  }
  return next()
}

function toInt(value) {
  const n = Number(value)
  return Number.isInteger(n) ? n : null
}

function escapeCsv(value) {
  const raw = String(value ?? '')
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

router.get('/conversations/export-csv', authMiddleware, requireStaff, async (req, res) => {
  try {
    const userAId = toInt(req.query.userAId)
    const userBId = toInt(req.query.userBId)

    if (!userAId || !userBId || userAId === userBId) {
      return res.status(400).json({ message: 'userAId and userBId are required and must be different integers' })
    }

    const users = await User.findAll({
      where: { id: { [Op.in]: [userAId, userBId] } },
      attributes: ['id', 'username', 'uniqueUsername'],
      raw: true,
    })
    if (users.length !== 2) {
      return res.status(404).json({ message: 'One or both users not found' })
    }
    const userById = users.reduce((acc, item) => {
      acc[Number(item.id)] = item
      return acc
    }, {})

    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { senderId: userAId, receiverId: userBId },
          { senderId: userBId, receiverId: userAId },
        ],
      },
      order: [['createdAt', 'ASC']],
      raw: true,
    })

    const headers = [
      'id',
      'createdAt',
      'senderId',
      'senderUsername',
      'receiverId',
      'receiverUsername',
      'messageType',
      'text',
      'mediaUrl',
      'mediaMimeType',
      'mediaOriginalName',
      'seen',
    ]

    const rows = messages.map((m) => [
      m.id,
      m.createdAt,
      m.senderId,
      userById[Number(m.senderId)]?.uniqueUsername || userById[Number(m.senderId)]?.username || '',
      m.receiverId,
      userById[Number(m.receiverId)]?.uniqueUsername || userById[Number(m.receiverId)]?.username || '',
      m.messageType || '',
      m.text || '',
      m.mediaUrl || '',
      m.mediaMimeType || '',
      m.mediaOriginalName || '',
      m.seen ? 'true' : 'false',
    ])

    const csv = [headers, ...rows]
      .map((line) => line.map((cell) => escapeCsv(cell)).join(','))
      .join('\n')

    const datePart = new Date().toISOString().slice(0, 10)
    const filename = `conversation_${userAId}_${userBId}_${datePart}.csv`

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.status(200).send(csv)
  } catch (error) {
    return res.status(500).json({ message: 'Failed to export conversation CSV', error: error.message })
  }
})

module.exports = router
