require('dotenv').config()

const http = require('http')
const express = require('express')
const cors = require('cors')
const { DataTypes, Op } = require('sequelize')
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
const { canAccessPairConversation, canSendToUser, isExternalUser } = require('./utils/chat-access')
const { verifyAccessToken } = require('./utils/token')
const { ensureContactPairs } = require('./utils/contact-write')

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
const activeCallByUser = new Map()

function getUserActiveCallSession(userId) {
  const normalizedUserId = Number(userId)
  if (!Number.isInteger(normalizedUserId)) return null
  const roomId = activeCallByUser.get(normalizedUserId)
  if (!roomId) return null
  const session = callSessions.get(roomId)
  if (!session || session.finalized) {
    activeCallByUser.delete(normalizedUserId)
    return null
  }
  return session
}

function setCallSession(session) {
  if (!session?.roomId) return
  callSessions.set(session.roomId, session)
  activeCallByUser.set(Number(session.callerId), session.roomId)
  activeCallByUser.set(Number(session.calleeId), session.roomId)
}

function clearCallSession(roomId) {
  const session = callSessions.get(roomId)
  if (!session) return null
  callSessions.delete(roomId)
  activeCallByUser.delete(Number(session.callerId))
  activeCallByUser.delete(Number(session.calleeId))
  return session
}

function getCallCounterpartUserId(session, currentUserId) {
  if (!session) return null
  const normalizedUserId = Number(currentUserId)
  if (!Number.isInteger(normalizedUserId)) return null
  if (Number(session.callerId) === normalizedUserId) return Number(session.calleeId)
  if (Number(session.calleeId) === normalizedUserId) return Number(session.callerId)
  return null
}

function validateCallRelay(socket, payload) {
  const roomId = String(payload?.roomId || '').trim()
  if (!roomId) return null
  const session = callSessions.get(roomId)
  if (!session || session.finalized) return null

  const currentUserId = Number(socket.user?.id)
  const targetUserId = Number(payload?.toUserId)
  const expectedTargetUserId = getCallCounterpartUserId(session, currentUserId)
  if (!Number.isInteger(expectedTargetUserId) || expectedTargetUserId !== targetUserId) return null

  return { roomId, session, currentUserId, targetUserId: expectedTargetUserId }
}

async function getPresenceAudienceUserIds(userId) {
  const normalizedUserId = Number(userId)
  if (!Number.isInteger(normalizedUserId)) return []

  const relatedContacts = await Contact.findAll({
    where: {
      [Op.or]: [{ userId: normalizedUserId }, { contactUserId: normalizedUserId }],
    },
    attributes: ['userId', 'contactUserId'],
    raw: true,
  })

  return uniqueIds([
    normalizedUserId,
    ...relatedContacts.map((item) => item.userId),
    ...relatedContacts.map((item) => item.contactUserId),
  ])
}

async function emitPresenceUpdate(userId, payload) {
  const audienceUserIds = await getPresenceAudienceUserIds(userId)
  audienceUserIds.forEach((audienceUserId) => {
    io.to(`user:${audienceUserId}`).emit('chat:presence', payload)
  })
}

async function finalizeCallSession(roomId, options = {}) {
  const session = callSessions.get(roomId)
  if (!session || session.finalized) return null

  session.finalized = true
  clearCallSession(roomId)

  const status =
    options.status ||
    (session.accepted ? 'completed' : 'missed')
  const reason = String(options.reason || '')
  const durationSec = Number.isFinite(Number(options.durationSec))
    ? Math.max(0, Math.floor(Number(options.durationSec)))
    : 0
  const actor = options.actorUser || null

  if (reason === 'disconnect') {
    const counterpartUserId = actor?.id ? getCallCounterpartUserId(session, actor.id) : null
    if (Number.isInteger(counterpartUserId)) {
      io.to(`user:${counterpartUserId}`).emit('call:canceled', {
        roomId,
        reason,
        byUser: actor ? { id: actor.id, username: actor.username } : null,
      })
    }
  } else if (status === 'completed') {
    const endedPayload = {
      roomId,
      byUser: actor ? { id: actor.id, username: actor.username } : null,
    }
    io.to(`user:${session.callerId}`).emit('call:ended', endedPayload)
    io.to(`user:${session.calleeId}`).emit('call:ended', endedPayload)
  }

  const payloadMsg = await createCallHistoryMessage({
    callerId: session.callerId,
    calleeId: session.calleeId,
    callType: session.callType,
    status,
    durationSec: status === 'completed' ? durationSec : 0,
  }).catch(() => null)

  if (payloadMsg) {
    io.to(`user:${session.callerId}`).emit('chat:message', payloadMsg)
    io.to(`user:${session.calleeId}`).emit('chat:message', payloadMsg)
  }

  return session
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

function serializeRealtimeContact(user, lastMessageAt = null) {
  if (!user) return null
  return {
    id: user.id,
    username: user.username,
    uniqueUsername: user.uniqueUsername,
    role: user.role || 'user',
    canHandleExternalChat: Boolean(user.canHandleExternalChat),
    email: user.email || null,
    mobileNumber: user.mobileNumber || null,
    lastSeen: user.lastSeen || null,
    profileMediaUrl: user.profileMediaUrl || null,
    createdAt: user.createdAt || null,
    lastMessageAt,
    unreadCount: 0,
  }
}

function uniqueIds(values) {
  return Array.from(new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value))))
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
    reactions: [],
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

    const decoded = verifyAccessToken(token)
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
    emitPresenceUpdate(currentUserId, { userId: currentUserId, isOnline: true, lastSeen: socket.user.lastSeen }).catch(() => null)
  }

  socket.on('chat:send', async (payload, ack) => {
    try {
      const currentUser = await User.findByPk(currentUserId)
      if (!currentUser) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Unauthorized: user not found' })
        return
      }
      await ensureUserUniqueUsername(currentUser, User)
      socket.user = currentUser

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
      const access = await canAccessPairConversation(currentUser, toUser)
      if (!access.ok) {
        if (typeof ack === 'function') ack({ ok: false, message: access.reason || 'Chat not allowed' })
        return
      }
      const sendAccess = await canSendToUser(currentUser, toUser)
      if (!sendAccess.ok) {
        if (typeof ack === 'function') ack({ ok: false, message: sendAccess.reason || 'Chat not allowed' })
        return
      }

      const effectiveToUserId = isExternalUser(currentUser)
        ? Number(access.assignment?.assignedToUserId || toUserId)
        : toUserId
      const effectiveToUser = effectiveToUserId === toUserId ? toUser : await User.findByPk(effectiveToUserId)
      if (!effectiveToUser) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Receiver not found' })
        return
      }

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
        reactions: [],
        seen: message.seen,
        createdAt: message.createdAt,
      }

      const assignment = access.assignment
      const externalUserId = Number(assignment?.externalUserId || 0)
      const visibleHandlerUserId = Number(assignment?.publicHandlerUserId || assignment?.assignedToUserId || 0)
      let visibleHandlerUser = null
      if (visibleHandlerUserId === Number(currentUserId)) {
        visibleHandlerUser = currentUser
      } else if (visibleHandlerUserId === Number(effectiveToUserId)) {
        visibleHandlerUser = effectiveToUser
      } else if (visibleHandlerUserId > 0) {
        visibleHandlerUser = await User.findByPk(visibleHandlerUserId)
      }
      const senderPayload = Number(currentUserId) === externalUserId
        ? mapPayloadForExternalViewer(messagePayload, assignment)
        : messagePayload
      const receiverPayload = Number(effectiveToUserId) === externalUserId
        ? mapPayloadForExternalViewer(messagePayload, assignment)
        : messagePayload

      if (externalUserId) {
        const internalParticipantIds = uniqueIds([currentUserId, effectiveToUserId]).filter((id) => id !== externalUserId)
        await ensureContactPairs([
          ...internalParticipantIds.map((internalId) => ({ userId: internalId, contactUserId: externalUserId })),
          ...(visibleHandlerUserId > 0 ? [{ userId: externalUserId, contactUserId: visibleHandlerUserId }] : []),
        ])

        if (Number(currentUserId) === externalUserId) {
          io.to(`user:${currentUserId}`).emit('chat:contact-added', {
            user: serializeRealtimeContact(visibleHandlerUser || effectiveToUser, message.createdAt),
          })
        } else {
          io.to(`user:${currentUserId}`).emit('chat:contact-added', {
            user: serializeRealtimeContact(effectiveToUserId === externalUserId ? effectiveToUser : currentUser, message.createdAt),
          })
        }

        if (Number(effectiveToUserId) === externalUserId) {
          io.to(`user:${effectiveToUserId}`).emit('chat:contact-added', {
            user: serializeRealtimeContact(visibleHandlerUser || currentUser, message.createdAt),
          })
        } else {
          io.to(`user:${effectiveToUserId}`).emit('chat:contact-added', {
            user: serializeRealtimeContact(currentUserId === externalUserId ? currentUser : effectiveToUser, message.createdAt),
          })
        }
      } else {
        await ensureContactPairs([
          { userId: currentUserId, contactUserId: effectiveToUserId },
          { userId: effectiveToUserId, contactUserId: currentUserId },
        ])

        io.to(`user:${currentUserId}`).emit('chat:contact-added', {
          user: serializeRealtimeContact(effectiveToUser, message.createdAt),
        })
        io.to(`user:${effectiveToUserId}`).emit('chat:contact-added', {
          user: serializeRealtimeContact(currentUser, message.createdAt),
        })
      }

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
      const sendAccess = await canSendToUser(socket.user, toUser)
      if (!sendAccess.ok) {
        if (typeof ack === 'function') ack({ ok: false, message: sendAccess.reason || 'Call not allowed' })
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
      setCallSession({
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
    const relay = validateCallRelay(socket, payload)
    if (!relay) return
    const toUserId = relay.targetUserId
    io.to(`user:${toUserId}`).emit('call:ringing', {
      roomId: String(payload?.roomId || ''),
      byUser: {
        id: socket.user.id,
        username: socket.user.username,
      },
    })
  })

  socket.on('call:busy', (payload) => {
    const relay = validateCallRelay(socket, payload)
    if (!relay) return
    const toUserId = relay.targetUserId
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
    const relay = validateCallRelay(socket, payload)
    if (!relay) return
    const toUserId = relay.targetUserId
    const roomId = relay.roomId
    const reason = String(payload?.reason || 'canceled')
    await finalizeCallSession(roomId, {
      actorUser: socket.user,
      reason,
      status: 'missed',
      durationSec: 0,
    }).catch(() => null)
  })

  socket.on('call:response', async (payload) => {
    const relay = validateCallRelay(socket, payload)
    if (!relay) return
    const toUserId = relay.targetUserId
    const roomId = relay.roomId
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
      setCallSession(session)
      return
    }

    await finalizeCallSession(roomId, {
      actorUser: socket.user,
      reason: 'rejected',
      status: 'missed',
      durationSec: 0,
    }).catch(() => null)
  })

  socket.on('call:end', async (payload) => {
    const roomId = String(payload?.roomId || '')
    const rawDuration = Number(payload?.durationSec)
    const durationSec = Number.isFinite(rawDuration) ? Math.max(0, Math.floor(rawDuration)) : 0
    const session = callSessions.get(roomId)
    if (!session || session.finalized) return

    const isParticipant = [session.callerId, session.calleeId].includes(currentUserId)
    if (!isParticipant) return

    await finalizeCallSession(roomId, {
      actorUser: socket.user,
      reason: session.accepted ? 'completed' : 'ended',
      status: session.accepted ? 'completed' : 'missed',
      durationSec,
    }).catch(() => null)
  })

  socket.on('disconnect', async () => {
    try {
      const currentCount = onlineUserSockets.get(currentUserId) || 0
      if (currentCount <= 1) {
        const activeSession = getUserActiveCallSession(currentUserId)
        if (activeSession) {
          await finalizeCallSession(activeSession.roomId, {
            actorUser: socket.user,
            reason: 'disconnect',
            status: activeSession.accepted ? 'completed' : 'missed',
            durationSec: 0,
          }).catch(() => null)
        }
        onlineUserSockets.delete(currentUserId)
        socket.user.lastSeen = new Date()
        await socket.user.save()
        emitPresenceUpdate(currentUserId, { userId: currentUserId, isOnline: false, lastSeen: socket.user.lastSeen }).catch(() => null)
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
    if (usersTable) {
      if (!usersTable.unique_username) {
        await queryInterface.addColumn('users', 'unique_username', {
          type: DataTypes.STRING(120),
          allowNull: true,
          unique: true,
        })
      }
      if (!usersTable.role) {
        await queryInterface.addColumn('users', 'role', {
          type: DataTypes.ENUM('user', 'model_admin', 'admin'),
          allowNull: false,
          defaultValue: 'user',
        })
      }
      await sequelize.query("UPDATE users SET role = 'model_admin' WHERE role = 'manager'").catch(() => null)
      await sequelize.query("UPDATE users SET role = 'user' WHERE role NOT IN ('user','model_admin','admin') OR role IS NULL").catch(() => null)
      await queryInterface
        .changeColumn('users', 'role', {
          type: DataTypes.ENUM('user', 'model_admin', 'admin'),
          allowNull: false,
          defaultValue: 'user',
        })
        .catch(() => null)
      if (!usersTable.can_handle_external_chat) {
        await queryInterface.addColumn('users', 'can_handle_external_chat', {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        })
      }
      if (!usersTable.can_download_conversations) {
        await queryInterface.addColumn('users', 'can_download_conversations', {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        })
      }
      if (!usersTable.can_edit_conversation_note) {
        await queryInterface.addColumn('users', 'can_edit_conversation_note', {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        })
      }
      if (!usersTable.can_block_users) {
        await queryInterface.addColumn('users', 'can_block_users', {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        })
      }
      if (!usersTable.profile_note) {
        await queryInterface.addColumn('users', 'profile_note', {
          type: DataTypes.TEXT,
          allowNull: true,
        })
      }
      await sequelize.query("UPDATE users SET can_handle_external_chat = 0 WHERE role IN ('admin','model_admin')").catch(() => null)
      await sequelize.query("UPDATE users SET can_download_conversations = 1 WHERE role = 'admin'").catch(() => null)
      await sequelize.query("UPDATE users SET can_edit_conversation_note = 1 WHERE role = 'admin'").catch(() => null)
      await sequelize.query("UPDATE users SET can_block_users = 1 WHERE role IN ('admin','model_admin')").catch(() => null)
    }
    const userBlocksTable = await queryInterface.describeTable('user_blocks').catch(() => null)
    if (!userBlocksTable) {
      await queryInterface.createTable('user_blocks', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        blocker_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        blocked_user_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
        },
      }).catch(() => null)
      await queryInterface.addIndex('user_blocks', ['blocker_id', 'blocked_user_id'], {
        unique: true,
        name: 'user_blocks_blocker_id_blocked_user_id_unique',
      }).catch(() => null)
      await queryInterface.addIndex('user_blocks', ['blocked_user_id'], {
        name: 'user_blocks_blocked_user_id_index',
      }).catch(() => null)
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
    await sequelize.query(`
      DELETE mr1 FROM message_reactions mr1
      INNER JOIN message_reactions mr2
        ON mr1.message_id = mr2.message_id
       AND mr1.user_id = mr2.user_id
       AND mr1.id > mr2.id
    `).catch(() => null)
    const reactionIndexes = await queryInterface.showIndex('message_reactions').catch(() => [])
    const reactionUniqueIndexes = reactionIndexes.filter((idx) => {
      if (!idx.unique || idx.primary) return false
      const fieldNames = (idx.fields || []).map((f) => f.attribute || f.name).filter(Boolean)
      return fieldNames.length === 3 && fieldNames[0] === 'message_id' && fieldNames[1] === 'user_id' && fieldNames[2] === 'emoji'
    })
    for (const idx of reactionUniqueIndexes) {
      await queryInterface.removeIndex('message_reactions', idx.name).catch(() => null)
    }
    const hasReactionUserUniqueIndex = reactionIndexes.some((idx) => {
      if (!idx.unique || idx.primary) return false
      const fieldNames = (idx.fields || []).map((f) => f.attribute || f.name).filter(Boolean)
      return fieldNames.length === 2 && fieldNames[0] === 'message_id' && fieldNames[1] === 'user_id'
    })
    if (!hasReactionUserUniqueIndex) {
      await queryInterface.addIndex('message_reactions', ['message_id', 'user_id'], {
        unique: true,
        name: 'message_reactions_message_id_user_id_unique',
      }).catch(() => null)
    }
    const contactIndexes = await queryInterface.showIndex('contacts').catch(() => [])
    const hasContactUserIdIndex = contactIndexes.some((idx) => {
      const fieldNames = (idx.fields || []).map((f) => f.attribute || f.name).filter(Boolean)
      return fieldNames.length === 1 && fieldNames[0] === 'user_id'
    })
    if (!hasContactUserIdIndex) {
      await queryInterface.addIndex('contacts', ['user_id'], {
        name: 'contacts_user_id_index',
      }).catch(() => null)
    }
    const hasContactReverseIndex = contactIndexes.some((idx) => {
      const fieldNames = (idx.fields || []).map((f) => f.attribute || f.name).filter(Boolean)
      return fieldNames.length === 1 && fieldNames[0] === 'contact_user_id'
    })
    if (!hasContactReverseIndex) {
      await queryInterface.addIndex('contacts', ['contact_user_id'], {
        name: 'contacts_contact_user_id_index',
      }).catch(() => null)
    }

    const messageIndexes = await queryInterface.showIndex('messages').catch(() => [])
    const hasReceiverSeenIndex = messageIndexes.some((idx) => {
      const fieldNames = (idx.fields || []).map((f) => f.attribute || f.name).filter(Boolean)
      return fieldNames.length === 3 && fieldNames[0] === 'receiver_id' && fieldNames[1] === 'sender_id' && fieldNames[2] === 'seen'
    })
    if (!hasReceiverSeenIndex) {
      await queryInterface.addIndex('messages', ['receiver_id', 'sender_id', 'seen'], {
        name: 'messages_receiver_id_sender_id_seen_index',
      }).catch(() => null)
    }
    const hasSenderReceiverCreatedIndex = messageIndexes.some((idx) => {
      const fieldNames = (idx.fields || []).map((f) => f.attribute || f.name).filter(Boolean)
      return fieldNames.length === 3 && fieldNames[0] === 'sender_id' && fieldNames[1] === 'receiver_id' && fieldNames[2] === 'created_at'
    })
    if (!hasSenderReceiverCreatedIndex) {
      await queryInterface.addIndex('messages', ['sender_id', 'receiver_id', 'created_at'], {
        name: 'messages_sender_id_receiver_id_created_at_index',
      }).catch(() => null)
    }
    const hasReceiverSenderCreatedIndex = messageIndexes.some((idx) => {
      const fieldNames = (idx.fields || []).map((f) => f.attribute || f.name).filter(Boolean)
      return fieldNames.length === 3 && fieldNames[0] === 'receiver_id' && fieldNames[1] === 'sender_id' && fieldNames[2] === 'created_at'
    })
    if (!hasReceiverSenderCreatedIndex) {
      await queryInterface.addIndex('messages', ['receiver_id', 'sender_id', 'created_at'], {
        name: 'messages_receiver_id_sender_id_created_at_index',
      }).catch(() => null)
    }

    const assignmentIndexes = await queryInterface.showIndex('conversation_assignments').catch(() => [])
    const hasAssignedUpdatedIndex = assignmentIndexes.some((idx) => {
      const fieldNames = (idx.fields || []).map((f) => f.attribute || f.name).filter(Boolean)
      return fieldNames.length === 2 && fieldNames[0] === 'assigned_to_user_id' && fieldNames[1] === 'updated_at'
    })
    if (!hasAssignedUpdatedIndex) {
      await queryInterface.addIndex('conversation_assignments', ['assigned_to_user_id', 'updated_at'], {
        name: 'conversation_assignments_assigned_to_user_id_updated_at_index',
      }).catch(() => null)
    }
    const hasPublicHandlerIndex = assignmentIndexes.some((idx) => {
      const fieldNames = (idx.fields || []).map((f) => f.attribute || f.name).filter(Boolean)
      return fieldNames.length === 1 && fieldNames[0] === 'public_handler_user_id'
    })
    if (!hasPublicHandlerIndex) {
      await queryInterface.addIndex('conversation_assignments', ['public_handler_user_id'], {
        name: 'conversation_assignments_public_handler_user_id_index',
      }).catch(() => null)
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
