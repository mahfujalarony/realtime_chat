require('dotenv').config()

const http = require('http')
const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const { DataTypes } = require('sequelize')
const { Server } = require('socket.io')
const { sequelize, User, Message, Contact, PushSubscription } = require('./models')
const authRoutes = require('./routes/auth.routes')
const userRoutes = require('./routes/users.routes')
const messageRoutes = require('./routes/messages.routes')
const notificationsRoutes = require('./routes/notifications.routes')
const adminRoutes = require('./routes/admin.routes')
const moderationRoutes = require('./routes/moderation.routes')
const { ensureUserUniqueUsername } = require('./utils/user-identity')
const { sendPushNotification, isPushEnabled } = require('./utils/push')
const { canAccessPairConversation, isExternalUser } = require('./utils/chat-access')

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
const callSessions = new Map()

function getUserActiveCallSession(userId) {
  if (!Number.isInteger(Number(userId))) return null
  const normalizedUserId = Number(userId)
  for (const session of callSessions.values()) {
    if (!session || session.finalized) continue
    if (Number(session.callerId) === normalizedUserId || Number(session.calleeId) === normalizedUserId) {
      return session
    }
  }
  return null
}

function formatCallDuration(totalSec) {
  const safe = Math.max(0, Math.floor(Number(totalSec) || 0))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function mapPayloadForExternalViewer(messagePayload, assignment) {
  if (!assignment) return messagePayload
  const externalUserId = Number(assignment.externalUserId)
  const publicHandlerUserId = Number(assignment.publicHandlerUserId || assignment.assignedToUserId)
  if (!Number.isInteger(externalUserId) || !Number.isInteger(publicHandlerUserId)) return messagePayload
  const next = { ...messagePayload }
  if (Number(next.senderId) !== externalUserId) next.senderId = publicHandlerUserId
  if (Number(next.receiverId) !== externalUserId) next.receiverId = publicHandlerUserId
  return next
}

async function createCallHistoryMessage({ callerId, calleeId, callType, status, durationSec }) {
  if (!Number.isInteger(callerId) || !Number.isInteger(calleeId)) return null
  const kind = String(callType || 'video') === 'audio' ? 'Audio' : 'Video'

  let text = `${kind} call`
  if (status === 'missed') {
    text = `Missed ${String(callType || 'video')} call`
  } else if (status === 'completed') {
    text = `${kind} call - ${formatCallDuration(durationSec)}`
  }

  const message = await Message.create({
    senderId: callerId,
    receiverId: calleeId,
    text,
    messageType: 'text',
  })

  return {
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
}

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
app.use('/api/notifications', notificationsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/moderation', moderationRoutes)

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
      const access = await canAccessPairConversation(socket.user, toUser)
      if (!access.ok) {
        if (typeof ack === 'function') ack({ ok: false, message: access.reason || 'Chat not allowed' })
        return
      }

      const effectiveToUserId = isExternalUser(socket.user)
        ? Number(access.assignment?.assignedToUserId || toUserId)
        : toUserId

      const message = await Message.create({
        senderId: currentUserId,
        receiverId: effectiveToUserId,
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

      const assignment = access.assignment
      const externalUserId = Number(assignment?.externalUserId || 0)
      const senderPayload = Number(currentUserId) === externalUserId
        ? mapPayloadForExternalViewer(messagePayload, assignment)
        : messagePayload
      const receiverPayload = Number(effectiveToUserId) === externalUserId
        ? mapPayloadForExternalViewer(messagePayload, assignment)
        : messagePayload

      io.to(`user:${currentUserId}`).emit('chat:message', senderPayload)
      io.to(`user:${effectiveToUserId}`).emit('chat:message', receiverPayload)
      if (typeof ack === 'function') ack({ ok: true, message: senderPayload })
    } catch (error) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Failed to send message' })
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

      const access = await canAccessPairConversation(socket.user, toUser)
      if (!access.ok) {
        if (typeof ack === 'function') ack({ ok: false, message: access.reason || 'Call not allowed' })
        return
      }

      const effectiveToUserId = isExternalUser(socket.user)
        ? Number(access.assignment?.assignedToUserId || toUserId)
        : toUserId
      const effectiveToUser = effectiveToUserId === toUserId ? toUser : await User.findByPk(effectiveToUserId)
      if (!effectiveToUser) {
        if (typeof ack === 'function') ack({ ok: false, message: 'User not found' })
        return
      }

      const callerBusySession = getUserActiveCallSession(currentUserId)
      if (callerBusySession) {
        if (typeof ack === 'function') ack({ ok: false, message: 'You are already in another call' })
        return
      }

      const calleeBusySession = getUserActiveCallSession(effectiveToUserId)
      if (calleeBusySession) {
        io.to(`user:${currentUserId}`).emit('call:busy', {
          roomId,
          byUser: { id: effectiveToUser.id, username: effectiveToUser.username },
          message: 'User is busy on another call',
        })
        if (typeof ack === 'function') ack({ ok: false, message: 'User is busy on another call' })
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
      callSessions.set(roomId, {
        roomId,
        callerId: currentUserId,
        calleeId: effectiveToUserId,
        callType,
        accepted: false,
        acceptedAt: null,
        finalized: false,
      })
      io.to(`user:${effectiveToUserId}`).emit('call:incoming', invitePayload)
      sendIncomingCallPush(effectiveToUserId, invitePayload).catch(() => null)
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

  socket.on('call:busy', (payload) => {
    const toUserId = Number(payload?.toUserId)
    if (!Number.isInteger(toUserId)) return
    io.to(`user:${toUserId}`).emit('call:busy', {
      roomId: String(payload?.roomId || ''),
      byUser: {
        id: socket.user.id,
        username: socket.user.username,
      },
      message: String(payload?.message || 'User is busy on another call'),
    })
  })

  socket.on('call:cancel', async (payload) => {
    const toUserId = Number(payload?.toUserId)
    if (!Number.isInteger(toUserId)) return
    const roomId = String(payload?.roomId || '')
    const reason = String(payload?.reason || 'canceled')

    io.to(`user:${toUserId}`).emit('call:canceled', {
      roomId,
      reason,
      byUser: {
        id: socket.user.id,
        username: socket.user.username,
      },
    })

    const session = callSessions.get(roomId)
    if (!session || session.finalized) return
    session.finalized = true
    callSessions.delete(roomId)

    const payloadMsg = await createCallHistoryMessage({
      callerId: session.callerId,
      calleeId: session.calleeId,
      callType: session.callType,
      status: 'missed',
      durationSec: 0,
    }).catch(() => null)
    if (payloadMsg) {
      io.to(`user:${session.callerId}`).emit('chat:message', payloadMsg)
      io.to(`user:${session.calleeId}`).emit('chat:message', payloadMsg)
    }
  })

  socket.on('call:response', async (payload) => {
    const toUserId = Number(payload?.toUserId)
    if (!Number.isInteger(toUserId)) return
    const roomId = String(payload?.roomId || '')
    const accepted = Boolean(payload?.accepted)
    io.to(`user:${toUserId}`).emit('call:response', {
      roomId,
      accepted,
      reason: String(payload?.reason || ''),
      byUser: {
        id: socket.user.id,
        username: socket.user.username,
      },
    })

    const session = callSessions.get(roomId)
    if (!session || session.finalized) return

    if (accepted) {
      session.accepted = true
      session.acceptedAt = Date.now()
      callSessions.set(roomId, session)
      return
    }

    // Rejected/canceled before connection -> missed call log
    session.finalized = true
    callSessions.delete(roomId)
    const payloadMsg = await createCallHistoryMessage({
      callerId: session.callerId,
      calleeId: session.calleeId,
      callType: session.callType,
      status: 'missed',
      durationSec: 0,
    }).catch(() => null)
    if (payloadMsg) {
      io.to(`user:${session.callerId}`).emit('chat:message', payloadMsg)
      io.to(`user:${session.calleeId}`).emit('chat:message', payloadMsg)
    }
  })

  socket.on('call:end', async (payload) => {
    const roomId = String(payload?.roomId || '')
    const rawDuration = Number(payload?.durationSec)
    const durationSec = Number.isFinite(rawDuration) ? Math.max(0, Math.floor(rawDuration)) : 0
    const session = callSessions.get(roomId)
    if (!session || session.finalized) return

    const isParticipant = [session.callerId, session.calleeId].includes(currentUserId)
    if (!isParticipant) return

    session.finalized = true
    callSessions.delete(roomId)

    const endedPayload = {
      roomId,
      byUser: {
        id: socket.user.id,
        username: socket.user.username,
      },
    }
    io.to(`user:${session.callerId}`).emit('call:ended', endedPayload)
    io.to(`user:${session.calleeId}`).emit('call:ended', endedPayload)

    const payloadMsg = await createCallHistoryMessage({
      callerId: session.callerId,
      calleeId: session.calleeId,
      callType: session.callType,
      status: session.accepted ? 'completed' : 'missed',
      durationSec: session.accepted ? durationSec : 0,
    }).catch(() => null)
    if (payloadMsg) {
      io.to(`user:${session.callerId}`).emit('chat:message', payloadMsg)
      io.to(`user:${session.calleeId}`).emit('chat:message', payloadMsg)
    }
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
    const assignmentsTable = await queryInterface.describeTable('conversation_assignments').catch(() => null)
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
    if (usersTable && !usersTable.unique_username) {
      await queryInterface.addColumn('users', 'unique_username', {
        type: DataTypes.STRING(120),
        allowNull: true,
        unique: true,
      })
    }
    if (usersTable && !usersTable.role) {
      await queryInterface.addColumn('users', 'role', {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'user',
      })
    }
    if (usersTable && usersTable.role) {
      await sequelize.query("UPDATE users SET role = 'model_admin' WHERE role = 'manager'").catch(() => null)
      await sequelize.query("UPDATE users SET can_handle_external_chat = 1 WHERE role IN ('admin','model_admin')").catch(() => null)
      await sequelize.query("UPDATE users SET can_download_conversations = 1 WHERE role = 'admin'").catch(() => null)
    }
    if (usersTable && !usersTable.can_handle_external_chat) {
      await queryInterface.addColumn('users', 'can_handle_external_chat', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      })
    }
    if (usersTable && !usersTable.can_download_conversations) {
      await queryInterface.addColumn('users', 'can_download_conversations', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      })
    }
    if (usersTable && usersTable.role) {
      await sequelize.query("UPDATE users SET can_handle_external_chat = 1 WHERE role IN ('admin','model_admin')").catch(() => null)
      await sequelize.query("UPDATE users SET can_download_conversations = 1 WHERE role = 'admin'").catch(() => null)
    }
    if (assignmentsTable && !assignmentsTable.public_handler_user_id) {
      await queryInterface.addColumn('conversation_assignments', 'public_handler_user_id', {
        type: DataTypes.INTEGER,
        allowNull: true,
      })
      await sequelize.query(
        'UPDATE conversation_assignments SET public_handler_user_id = assigned_to_user_id WHERE public_handler_user_id IS NULL',
      ).catch(() => null)
      await queryInterface.changeColumn('conversation_assignments', 'public_handler_user_id', {
        type: DataTypes.INTEGER,
        allowNull: false,
      }).catch(() => null)
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
