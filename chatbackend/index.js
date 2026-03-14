require('dotenv').config()

const http = require('http')
const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const { DataTypes } = require('sequelize')
const { Server } = require('socket.io')
const { sequelize, User, Message, Contact, GroupMember, GroupMessage, PushSubscription } = require('./models')
const authRoutes = require('./routes/auth.routes')
const userRoutes = require('./routes/users.routes')
const messageRoutes = require('./routes/messages.routes')
const groupRoutes = require('./routes/groups.routes')
const notificationsRoutes = require('./routes/notifications.routes')
const { ensureUserUniqueUsername } = require('./utils/user-identity')
const { sendPushNotification, isPushEnabled } = require('./utils/push')

const app = express()
const server = http.createServer(app)
const port = Number(process.env.PORT || 5000)
const rawCorsOrigin = process.env.CORS_ORIGIN || '*'
const corsOrigins = rawCorsOrigin
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const allowAllOrigins = corsOrigins.includes('*')

function isOriginAllowed(origin) {
  if (!origin) return true
  if (allowAllOrigins) return true
  return corsOrigins.includes(origin)
}

app.use(
  cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        return callback(null, true)
      }
      return callback(new Error('Not allowed by CORS'))
    },
    credentials: true,
  }),
)
app.use(express.json())

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        return callback(null, true)
      }
      return callback(new Error('Not allowed by CORS'))
    },
    credentials: true,
  },
})

app.set('io', io)
const onlineUserSockets = new Map()
app.set('onlineUserSockets', onlineUserSockets)
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || 'http://localhost:5173'

async function sendIncomingCallPush(toUserId, payload) {
  if (!isPushEnabled()) return
  const subscriptions = await PushSubscription.findAll({
    where: { userId: toUserId },
    attributes: ['id', 'endpoint', 'p256dh', 'auth'],
    raw: true,
  })
  if (!subscriptions.length) return

  const pushPayload = {
    type: 'incoming_call',
    title: `${payload.fromUser.username} is calling`,
    body: payload.callType === 'audio' ? 'Incoming audio call' : 'Incoming video call',
    roomId: payload.roomId,
    callType: payload.callType,
    fromUser: payload.fromUser,
    url: `${APP_PUBLIC_URL}/?incomingCall=1&roomId=${encodeURIComponent(payload.roomId)}`,
    ts: Date.now(),
  }

  await Promise.all(
    subscriptions.map(async (item) => {
      try {
        await sendPushNotification(
          {
            endpoint: item.endpoint,
            keys: { p256dh: item.p256dh, auth: item.auth },
          },
          pushPayload,
        )
      } catch (error) {
        const statusCode = Number(error?.statusCode)
        if (statusCode === 404 || statusCode === 410) {
          await PushSubscription.destroy({ where: { id: item.id } }).catch(() => null)
        }
      }
    }),
  )
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'chatbackend' })
})

app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/groups', groupRoutes)
app.use('/api/notifications', notificationsRoutes)

io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers.authorization || '').replace('Bearer ', '')

    if (!token) {
      return next(new Error('Unauthorized: token missing'))
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me')
    const user = await User.findByPk(decoded.userId)

    if (!user) {
      return next(new Error('Unauthorized: user not found'))
    }

    await ensureUserUniqueUsername(user, User)
    socket.user = user
    return next()
  } catch (error) {
    return next(new Error('Unauthorized: invalid token'))
  }
})

io.on('connection', (socket) => {
  const currentUserId = socket.user.id
  socket.join(`user:${currentUserId}`)
  const existingSockets = onlineUserSockets.get(currentUserId) || 0
  onlineUserSockets.set(currentUserId, existingSockets + 1)

  if (existingSockets === 0) {
    io.emit('chat:presence', { userId: currentUserId, isOnline: true, lastSeen: socket.user.lastSeen })
  }

  GroupMember.findAll({
    where: { userId: currentUserId },
    attributes: ['groupId'],
    raw: true,
  })
    .then((memberships) => {
      memberships.forEach((item) => socket.join(`group:${item.groupId}`))
    })
    .catch(() => null)

  socket.on('chat:send', async (payload, ack) => {
    try {
      const toUserId = Number(payload?.toUserId)
      const text = (payload?.text || '').trim()

      if (!Number.isInteger(toUserId) || !text) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Invalid payload' })
        return
      }

      const toUser = await User.findByPk(toUserId)
      if (!toUser) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Receiver not found' })
        return
      }
      const contact = await Contact.findOne({
        where: { userId: currentUserId, contactUserId: toUserId },
      })
      if (!contact) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Add this user to contacts first' })
        return
      }

      const message = await Message.create({
        senderId: currentUserId,
        receiverId: toUserId,
        text,
        messageType: 'text',
      })

      const messagePayload = {
        id: message.id,
        senderId: message.senderId,
        receiverId: message.receiverId,
        text: message.text,
        messageType: message.messageType,
        mediaUrl: message.mediaUrl,
        mediaMimeType: message.mediaMimeType,
        mediaOriginalName: message.mediaOriginalName,
        seen: message.seen,
        createdAt: message.createdAt,
      }

      io.to(`user:${currentUserId}`).emit('chat:message', messagePayload)
      io.to(`user:${toUserId}`).emit('chat:message', messagePayload)
      if (typeof ack === 'function') ack({ ok: true, message: messagePayload })
    } catch (error) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Failed to send message' })
    }
  })

  socket.on('chat:group-send', async (payload, ack) => {
    try {
      const groupId = Number(payload?.groupId)
      const text = (payload?.text || '').trim()
      if (!Number.isInteger(groupId) || !text) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Invalid payload' })
        return
      }

      const membership = await GroupMember.findOne({ where: { groupId, userId: currentUserId } })
      if (!membership) {
        if (typeof ack === 'function') ack({ ok: false, message: 'You are not a member of this group' })
        return
      }

      const message = await GroupMessage.create({
        groupId,
        senderId: currentUserId,
        text,
        messageType: 'text',
      })
      const messagePayload = {
        id: message.id,
        groupId: message.groupId,
        senderId: message.senderId,
        text: message.text,
        messageType: message.messageType,
        mediaUrl: message.mediaUrl,
        mediaMimeType: message.mediaMimeType,
        mediaOriginalName: message.mediaOriginalName,
        mediaDurationSec: message.mediaDurationSec,
        createdAt: message.createdAt,
      }

      await GroupMember.update({ lastReadAt: new Date() }, { where: { groupId, userId: currentUserId } })
      io.to(`group:${groupId}`).emit('chat:group-message', messagePayload)
      if (typeof ack === 'function') ack({ ok: true, message: messagePayload })
    } catch (error) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Failed to send group message' })
    }
  })

  socket.on('call:invite', async (payload, ack) => {
    try {
      const toUserId = Number(payload?.toUserId)
      const roomId = String(payload?.roomId || '').trim()
      const callType = String(payload?.callType || 'video').toLowerCase() === 'audio' ? 'audio' : 'video'
      if (!Number.isInteger(toUserId) || !roomId) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Invalid payload' })
        return
      }

      const toUser = await User.findByPk(toUserId)
      if (!toUser) {
        if (typeof ack === 'function') ack({ ok: false, message: 'User not found' })
        return
      }

      const contact = await Contact.findOne({ where: { userId: currentUserId, contactUserId: toUserId } })
      if (!contact) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Add this user to contacts first' })
        return
      }

      const invitePayload = {
        roomId,
        callType,
        fromUser: {
          id: socket.user.id,
          username: socket.user.username,
          uniqueUsername: socket.user.uniqueUsername,
          profileMediaUrl: socket.user.profileMediaUrl,
        },
      }
      io.to(`user:${toUserId}`).emit('call:incoming', invitePayload)
      sendIncomingCallPush(toUserId, invitePayload).catch(() => null)
      if (typeof ack === 'function') ack({ ok: true })
    } catch (error) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Failed to send invite' })
    }
  })

  socket.on('call:ringing', (payload) => {
    const toUserId = Number(payload?.toUserId)
    if (!Number.isInteger(toUserId)) return
    io.to(`user:${toUserId}`).emit('call:ringing', {
      roomId: String(payload?.roomId || ''),
      byUser: {
        id: socket.user.id,
        username: socket.user.username,
      },
    })
  })

  socket.on('call:response', (payload) => {
    const toUserId = Number(payload?.toUserId)
    if (!Number.isInteger(toUserId)) return
    io.to(`user:${toUserId}`).emit('call:response', {
      roomId: String(payload?.roomId || ''),
      accepted: Boolean(payload?.accepted),
      byUser: {
        id: socket.user.id,
        username: socket.user.username,
      },
    })
  })

  socket.on('disconnect', async () => {
    try {
      const currentCount = onlineUserSockets.get(currentUserId) || 0
      if (currentCount <= 1) {
        onlineUserSockets.delete(currentUserId)
        socket.user.lastSeen = new Date()
        await socket.user.save()
        io.emit('chat:presence', { userId: currentUserId, isOnline: false, lastSeen: socket.user.lastSeen })
      } else {
        onlineUserSockets.set(currentUserId, currentCount - 1)
      }
    } catch (error) {
      // no-op
    }
  })
})

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err)
  }
  return res.status(500).json({ message: 'Server error', error: err.message })
})

async function start() {
  try {
    await sequelize.authenticate()
    const dbSyncMode = (process.env.DB_SYNC_MODE || 'safe').toLowerCase()
    if (dbSyncMode === 'alter') {
      await sequelize.sync({ alter: true })
    } else if (dbSyncMode === 'force') {
      await sequelize.sync({ force: true })
    } else {
      await sequelize.sync()
    }
    const queryInterface = sequelize.getQueryInterface()
    const messagesTable = await queryInterface.describeTable('messages').catch(() => null)
    const usersTable = await queryInterface.describeTable('users').catch(() => null)
    const groupMessagesTable = await queryInterface.describeTable('group_messages').catch(() => null)
    if (messagesTable && !messagesTable.media_duration_sec) {
      await queryInterface.addColumn('messages', 'media_duration_sec', {
        type: DataTypes.INTEGER,
        allowNull: true,
      })
    }
    if (messagesTable && !messagesTable.media_group_id) {
      await queryInterface.addColumn('messages', 'media_group_id', {
        type: DataTypes.STRING(80),
        allowNull: true,
      })
    }
    if (groupMessagesTable && !groupMessagesTable.media_group_id) {
      await queryInterface.addColumn('group_messages', 'media_group_id', {
        type: DataTypes.STRING(80),
        allowNull: true,
      })
    }
    if (usersTable && !usersTable.unique_username) {
      await queryInterface.addColumn('users', 'unique_username', {
        type: DataTypes.STRING(120),
        allowNull: true,
        unique: true,
      })
    }
    const userIndexes = await queryInterface.showIndex('users').catch(() => [])
    const usernameUniqueIndexes = userIndexes.filter((idx) => {
      if (!idx.unique || idx.primary) return false
      const fieldNames = (idx.fields || []).map((f) => f.attribute || f.name).filter(Boolean)
      return fieldNames.length === 1 && fieldNames[0] === 'username'
    })
    for (const idx of usernameUniqueIndexes) {
      await queryInterface.removeIndex('users', idx.name).catch(() => null)
    }
    console.log(`Database sync mode: ${dbSyncMode}`)
    server.listen(port, () => {
      console.log(`Server listening on port ${port}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error.message)
    process.exit(1)
  }
}

start()
