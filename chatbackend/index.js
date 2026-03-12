require('dotenv').config()

const http = require('http')
const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const { Server } = require('socket.io')
const { sequelize, User, Message, Contact } = require('./models')
const authRoutes = require('./routes/auth.routes')
const userRoutes = require('./routes/users.routes')
const messageRoutes = require('./routes/messages.routes')

const app = express()
const server = http.createServer(app)
const port = Number(process.env.PORT || 5000)
const corsOrigin = process.env.CORS_ORIGIN || '*'

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
)
app.use(express.json())

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    credentials: true,
  },
})

app.set('io', io)

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'chatbackend' })
})

app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/messages', messageRoutes)

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

    socket.user = user
    return next()
  } catch (error) {
    return next(new Error('Unauthorized: invalid token'))
  }
})

io.on('connection', (socket) => {
  const currentUserId = socket.user.id
  socket.join(`user:${currentUserId}`)

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
      })

      const messagePayload = {
        id: message.id,
        senderId: message.senderId,
        receiverId: message.receiverId,
        text: message.text,
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

  socket.on('disconnect', async () => {
    try {
      socket.user.lastSeen = new Date()
      await socket.user.save()
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
    await sequelize.sync()
    server.listen(port, () => {
      console.log(`Server listening on port ${port}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error.message)
    process.exit(1)
  }
}

start()
