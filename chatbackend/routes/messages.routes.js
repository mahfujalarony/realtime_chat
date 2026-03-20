const express = require('express')
const { Op } = require('sequelize')
const PDFDocument = require('pdfkit')
const authMiddleware = require('../middleware/auth')
const { Message, User, Contact, MessageReaction } = require('../models')
const { canAccessPairConversation, canSendToUser, isExternalUser, isAdmin, isModelAdmin } = require('../utils/chat-access')
const { deleteUploadedFile } = require('../utils/upload-server')
const { ensureContactPairs } = require('../utils/contact-write')

const router = express.Router()
const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🙏']
const ALLOWED_REACTIONS_SET = new Set(ALLOWED_REACTIONS)
const MAX_PDF_EXPORT_MESSAGES = 1000
const MAX_PDF_EXPORT_CHARACTERS = 200000

function isSenderMediaUrlValid(mediaUrl, uniqueUsername, messageType) {
  try {
    const raw = String(mediaUrl || '').trim()
    if (!raw) return false
    const pathname = decodeURIComponent(
      raw.startsWith('/')
        ? raw
        : new URL(raw).pathname,
    ).toLowerCase()
    const userPath = `/chat/${String(uniqueUsername).toLowerCase()}/`
    if (!pathname.includes(userPath)) return false

    if (messageType === 'image') {
      return pathname.includes(`${userPath}images/`)
    }
    if (messageType === 'video') {
      return pathname.includes(`${userPath}videos/`)
    }
    if (messageType === 'audio') {
      return pathname.includes(`${userPath}audios/`)
    }
    if (messageType === 'file') {
      return pathname.includes(`${userPath}files/`)
    }
    return false
  } catch (error) {
    return false
  }
}

function formatMessage(message) {
  return {
    id: message.id,
    senderId: message.senderId,
    receiverId: message.receiverId,
    sender: message.sender
      ? {
          id: message.sender.id,
          username: message.sender.username,
          uniqueUsername: message.sender.uniqueUsername,
          role: message.sender.role || 'user',
          canHandleExternalChat: Boolean(message.sender.canHandleExternalChat),
        }
      : null,
    text: message.text,
    messageType: message.messageType,
    mediaUrl: message.mediaUrl,
    mediaMimeType: message.mediaMimeType,
    mediaOriginalName: message.mediaOriginalName,
    mediaGroupId: message.mediaGroupId,
    mediaDurationSec: message.mediaDurationSec,
    reactions: Array.isArray(message.reactions) ? message.reactions : [],
    seen: message.seen,
    createdAt: message.createdAt,
  }
}

function getSenderRoleLabel(sender) {
  const role = String(sender?.role || 'user').toLowerCase()
  if (role === 'admin') return 'Admin'
  if (role === 'model_admin') return 'Model Admin'
  if (sender?.canHandleExternalChat) return 'Agent'
  return 'User'
}

function canHandleExternalRole(user) {
  const role = String(user?.role || 'user').toLowerCase()
  return role === 'admin' || role === 'model_admin' || Boolean(user?.canHandleExternalChat)
}

function isMessageOutgoingForViewer(message, viewerUser, otherUser) {
  const viewerIsInternal = canHandleExternalRole(viewerUser)
  const otherIsExternal = !canHandleExternalRole(otherUser)
  if (viewerIsInternal && otherIsExternal) {
    return Number(message?.senderId) !== Number(otherUser?.id)
  }
  return Number(message?.senderId) === Number(viewerUser?.id)
}

function getExportSenderLabel(message, viewerUser, otherUser) {
  if (Number(message?.senderId) === Number(otherUser?.id)) {
    return `${otherUser?.username || otherUser?.uniqueUsername || `User #${otherUser?.id}`} • User`
  }

  if (message?.sender) {
    const senderName = message.sender.username || message.sender.uniqueUsername || `User #${message.sender.id}`
    const roleLabel = getSenderRoleLabel(message.sender)
    if (Number(message.sender.id) === Number(viewerUser?.id)) return `You • ${roleLabel}`
    return `${senderName} • ${roleLabel}`
  }

  if (Number(message?.senderId) === Number(viewerUser?.id)) {
    return `You • ${getSenderRoleLabel(viewerUser)}`
  }

  return `User #${message?.senderId || ''}`.trim()
}

async function buildReactionMapForMessages(messageIds = [], viewerUserId = null) {
  const normalizedIds = Array.from(new Set((messageIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id))))
  if (!normalizedIds.length) return {}

  const reactionRows = await MessageReaction.findAll({
    where: { messageId: { [Op.in]: normalizedIds } },
    attributes: ['messageId', 'userId', 'emoji'],
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'username'],
        required: false,
      },
    ],
  })

  const byMessage = new Map()
  for (const row of reactionRows) {
    const messageId = Number(row.messageId)
    const emoji = String(row.emoji || '')
    const userId = Number(row.userId)
    if (!Number.isInteger(messageId) || !emoji) continue
    if (!byMessage.has(messageId)) byMessage.set(messageId, new Map())
    const byEmoji = byMessage.get(messageId)
    if (!byEmoji.has(emoji)) byEmoji.set(emoji, { emoji, count: 0, reactedByMe: false, reactors: [] })
    const item = byEmoji.get(emoji)
    item.count += 1
    if (Number.isInteger(Number(viewerUserId)) && userId === Number(viewerUserId)) item.reactedByMe = true
    item.reactors.push({
      id: userId,
      username: String(row.user?.username || 'Unknown user'),
      reactedByMe: Number.isInteger(Number(viewerUserId)) && userId === Number(viewerUserId),
    })
  }

  const result = {}
  for (const [messageId, byEmoji] of byMessage.entries()) {
    const summary = Array.from(byEmoji.values())
    summary.forEach((item) => {
      item.reactors.sort((a, b) => {
        if (a.reactedByMe && !b.reactedByMe) return -1
        if (!a.reactedByMe && b.reactedByMe) return 1
        return a.username.localeCompare(b.username)
      })
    })
    summary.sort((a, b) => {
      const ai = ALLOWED_REACTIONS.indexOf(a.emoji)
      const bi = ALLOWED_REACTIONS.indexOf(b.emoji)
      if (ai === -1 && bi === -1) return a.emoji.localeCompare(b.emoji)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    result[String(messageId)] = summary
  }
  return result
}

function buildConversationWhere(requestUser, otherUser, assignment) {
  const requestIsExternal = isExternalUser(requestUser)
  const otherIsExternal = isExternalUser(otherUser)
  const externalId = requestIsExternal ? requestUser.id : otherIsExternal ? otherUser.id : null
  if (!externalId) {
    return {
      [Op.or]: [
        { senderId: requestUser.id, receiverId: otherUser.id },
        { senderId: otherUser.id, receiverId: requestUser.id },
      ],
    }
  }
  if (!requestIsExternal) {
    return {
      [Op.or]: [
        { senderId: externalId },
        { receiverId: externalId },
      ],
    }
  }
  return {
    [Op.or]: [
      { senderId: externalId, receiverId: { [Op.in]: [assignment.assignedToUserId, assignment.publicHandlerUserId].filter(Boolean) } },
      { receiverId: externalId, senderId: { [Op.in]: [assignment.assignedToUserId, assignment.publicHandlerUserId].filter(Boolean) } },
    ],
  }
}

function canEditConversationNote(user) {
  return isAdmin(user) || Boolean(user?.canEditConversationNote)
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatExportDateLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatExportTimeLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function shortenExportAttachmentName(value, maxLength = 28) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.length <= maxLength) return raw
  const dotIndex = raw.lastIndexOf('.')
  const ext = dotIndex > 0 ? raw.slice(dotIndex) : ''
  const keep = Math.max(8, maxLength - ext.length - 3)
  return `${raw.slice(0, keep)}...${ext}`
}

function getExportMessageBody(message) {
  const messageType = String(message.messageType || 'text')
  const text = String(message.text || '').trim()
  if (text) return text
  if (messageType === 'image') return `[Image] ${shortenExportAttachmentName(message.mediaOriginalName || 'Image attachment')}`
  if (messageType === 'video') return `[Video] ${shortenExportAttachmentName(message.mediaOriginalName || 'Video attachment')}`
  if (messageType === 'audio') return `[Audio] ${shortenExportAttachmentName(message.mediaOriginalName || 'Audio attachment')}`
  if (messageType === 'file') return `[File] ${shortenExportAttachmentName(message.mediaOriginalName || 'File attachment')}`
  return `[${messageType || 'message'}]`
}

function buildConversationExportHtml({ viewerUser, otherUser, messages }) {
  const safeMessages = Array.isArray(messages) ? messages : []
  let currentDateLabel = ''
  const messageBlocks = safeMessages.map((message) => {
    const dateLabel = formatExportDateLabel(message.createdAt)
    const timeLabel = formatExportTimeLabel(message.createdAt)
    const isMine = isMessageOutgoingForViewer(message, viewerUser, otherUser)
    const senderLabel = getExportSenderLabel(message, viewerUser, otherUser)
    const body = escapeHtml(getExportMessageBody(message))
      .replace(/\r?\n/g, '<br/>')

    const dateDivider = dateLabel !== currentDateLabel
      ? `<div class="date-divider"><span>${escapeHtml(dateLabel)}</span></div>`
      : ''
    currentDateLabel = dateLabel

    return [
      dateDivider,
      `<article class="message ${isMine ? 'outgoing' : 'incoming'}">`,
      `  <div class="message-meta">`,
      `    <span class="sender">${escapeHtml(senderLabel)}</span>`,
      `    <span class="time">${escapeHtml(timeLabel)}</span>`,
      '  </div>',
      `  <div class="message-body">${body || '[Empty]'}</div>`,
      '</article>',
    ].join('\n')
  }).join('\n')

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8"/>',
    '  <meta name="viewport" content="width=device-width, initial-scale=1"/>',
    '  <title>Conversation PDF Export</title>',
    '  <style>',
    '    :root { color-scheme: light; }',
    '    * { box-sizing: border-box; }',
    '    body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: #eef3f6; color: #14212b; }',
    '    .page { max-width: 920px; margin: 0 auto; padding: 24px; }',
    '    .header { background: linear-gradient(135deg, #ffffff 0%, #f6fbff 100%); border: 1px solid #d8e3ea; border-radius: 20px; padding: 22px 24px; margin-bottom: 20px; }',
    '    .title { margin: 0; font-size: 28px; font-weight: 700; }',
    '    .subtitle { margin: 8px 0 0; color: #516371; font-size: 14px; }',
    '    .stats { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }',
    '    .stat { background: #f3f7fa; border: 1px solid #d8e3ea; border-radius: 14px; padding: 10px 14px; min-width: 150px; }',
    '    .stat-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b7b88; }',
    '    .stat-value { display: block; margin-top: 4px; font-size: 15px; font-weight: 600; color: #14212b; }',
    '    .date-divider { display: flex; justify-content: center; margin: 18px 0 12px; }',
    '    .date-divider span { background: #dfe9ef; color: #4f6472; border-radius: 999px; padding: 7px 14px; font-size: 12px; font-weight: 700; }',
    '    .message { max-width: 76%; border-radius: 18px; padding: 12px 14px; margin-bottom: 12px; box-shadow: 0 8px 20px rgba(18, 38, 52, 0.06); break-inside: avoid; page-break-inside: avoid; }',
    '    .message.incoming { background: #ffffff; border: 1px solid #d9e4ea; margin-right: auto; }',
    '    .message.outgoing { background: #d9fdd3; border: 1px solid #baeeb3; margin-left: auto; }',
    '    .message-meta { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 8px; }',
    '    .sender { font-size: 13px; font-weight: 700; }',
    '    .time { font-size: 12px; color: #5f727f; white-space: nowrap; }',
    '    .message-body { font-size: 14px; line-height: 1.65; white-space: normal; word-break: break-word; }',
    '    .empty { border: 1px dashed #c9d6de; border-radius: 16px; background: #fff; padding: 24px; color: #6b7b88; text-align: center; }',
    '    .print-note { margin-top: 18px; color: #5f727f; font-size: 12px; text-align: center; }',
    '    @page { size: A4; margin: 14mm; }',
    '    @media print { body { background: #fff; } .page { max-width: none; padding: 0; } .header { break-inside: avoid; box-shadow: none; } .print-note { display: none; } }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main class="page">',
    '    <section class="header">',
    `      <h1 class="title">Conversation with ${escapeHtml(otherUser.username || otherUser.uniqueUsername || otherUser.id)}</h1>`,
    `      <p class="subtitle">Prepared for ${escapeHtml(viewerUser.username || viewerUser.uniqueUsername || viewerUser.id)}. Use your browser print dialog and choose "Save as PDF".</p>`,
    '      <div class="stats">',
    `        <div class="stat"><span class="stat-label">Total Messages</span><span class="stat-value">${safeMessages.length}</span></div>`,
    `        <div class="stat"><span class="stat-label">Exported At</span><span class="stat-value">${escapeHtml(new Date().toLocaleString('en-US'))}</span></div>`,
    `        <div class="stat"><span class="stat-label">Participant</span><span class="stat-value">${escapeHtml(otherUser.username || otherUser.uniqueUsername || `User #${otherUser.id}`)}</span></div>`,
    '      </div>',
    '    </section>',
    safeMessages.length
      ? messageBlocks
      : '    <div class="empty">No messages found in this conversation.</div>',
    '    <p class="print-note">Tip: In the print window, choose "Save as PDF".</p>',
    '  </main>',
    '  <script>',
    '    window.addEventListener("load", () => {',
    '      setTimeout(() => {',
    '        if (typeof window.print === "function") window.print()',
    '      }, 250)',
    '    })',
    '  </script>',
    '</body>',
    '</html>',
  ].join('\n')
}

function sendConversationPdf(res, viewerUser, otherUser, messages) {
  const filename = `conversation_${viewerUser.id}_${otherUser.id}_${Date.now()}.pdf`

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

  const doc = new PDFDocument({
    size: 'A4',
    margin: 28,
    info: {
      Title: `Conversation with ${otherUser.username || otherUser.uniqueUsername || otherUser.id}`,
      Author: viewerUser.username || 'Chat App',
    },
  })
  doc.pipe(res)

  const otherLabel = otherUser.username || otherUser.uniqueUsername || `User #${otherUser.id}`
  const exportStamp = 'Styled Export v3'
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const pageBottom = doc.page.height - doc.page.margins.bottom
  const bubbleMaxWidth = Math.min(250, pageWidth * 0.62)
  const bubbleMinWidth = 110
  const bubblePaddingX = 9
  const bubblePaddingTop = 7
  const bubblePaddingBottom = 8
  const bubbleGap = 7
  let cursorY = doc.page.margins.top

  const ensureSpace = (neededHeight = 0) => {
    if (cursorY + neededHeight <= pageBottom) return
    doc.addPage()
    cursorY = doc.page.margins.top
  }

  const drawHeader = (compact = false) => {
    const cardX = doc.page.margins.left
    const cardY = cursorY
    const cardHeight = compact ? 44 : 60

    doc.save()
    doc.roundedRect(cardX, cardY, pageWidth, cardHeight, 18).fillAndStroke('#f7fbff', '#d7e3ec')
    doc.restore()

    doc.fillColor('#14212b').fontSize(compact ? 11.5 : 14.5).text(`${exportStamp} • ${otherLabel}`, cardX + 14, cardY + 10, {
      width: pageWidth - 36,
    })
    doc.fillColor('#5f727f').fontSize(8.5).text(
      `${viewerUser.username || viewerUser.uniqueUsername || viewerUser.id} • ${messages.length} msgs • ${new Date().toLocaleString('en-US')}`,
      cardX + 14,
      cardY + (compact ? 24 : 30),
      { width: pageWidth - 36 },
    )
    cursorY = cardY + cardHeight + 10
  }

  const drawDateDivider = (label) => {
    const dividerWidth = 110
    const dividerHeight = 18
    ensureSpace(dividerHeight + 8)
    const x = doc.page.margins.left + (pageWidth - dividerWidth) / 2
    const y = cursorY
    doc.save()
    doc.roundedRect(x, y, dividerWidth, dividerHeight, 9).fill('#dfe9ef')
    doc.restore()
    doc.fillColor('#4f6472').fontSize(8.5).text(label, x, y + 5, {
      width: dividerWidth,
      align: 'center',
    })
    cursorY = y + dividerHeight + 7
  }

  const drawBubble = (message) => {
    const isMine = isMessageOutgoingForViewer(message, viewerUser, otherUser)
    const senderLabel = getExportSenderLabel(message, viewerUser, otherUser)
    const timeLabel = formatExportTimeLabel(message.createdAt)
    const body = getExportMessageBody(message) || '[Empty]'

    doc.font('Helvetica-Bold').fontSize(8.5)
    const senderHeight = doc.heightOfString(senderLabel, { width: bubbleMaxWidth - bubblePaddingX * 2 })
    doc.font('Helvetica').fontSize(9)
    const bodyHeight = doc.heightOfString(body, { width: bubbleMaxWidth - bubblePaddingX * 2, lineGap: 2 })
    const bodyWidth = Math.min(
      bubbleMaxWidth - bubblePaddingX * 2,
      Math.max(58, doc.widthOfString(body, { characterSpacing: 0 }) + 4),
    )
    const senderWidth = Math.min(
      bubbleMaxWidth - bubblePaddingX * 2,
      Math.max(42, doc.widthOfString(senderLabel) + 2),
    )
    doc.font('Helvetica').fontSize(7.5)
    const timeHeight = doc.heightOfString(timeLabel || ' ', { width: bubbleMaxWidth - bubblePaddingX * 2 })
    const timeWidth = Math.min(
      bubbleMaxWidth - bubblePaddingX * 2,
      Math.max(28, doc.widthOfString(timeLabel || '')),
    )
    const contentWidth = Math.max(senderWidth, bodyWidth, timeWidth)
    const bubbleWidth = Math.max(bubbleMinWidth, Math.min(bubbleMaxWidth, contentWidth + bubblePaddingX * 2))

    const bubbleHeight = bubblePaddingTop + senderHeight + 2 + bodyHeight + 4 + timeHeight + bubblePaddingBottom
    const x = isMine
      ? doc.page.width - doc.page.margins.right - bubbleWidth
      : doc.page.margins.left

    ensureSpace(bubbleHeight + bubbleGap)
    const y = cursorY

    doc.save()
    doc.roundedRect(x, y, bubbleWidth, bubbleHeight, 13).fillAndStroke(
      isMine ? '#dcf8c6' : '#ffffff',
      isMine ? '#b8df9f' : '#d6e1e8',
    )
    doc.restore()

    let textY = y + bubblePaddingTop
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(isMine ? '#14532d' : '#0f3b58')
      .text(senderLabel, x + bubblePaddingX, textY, { width: bubbleWidth - bubblePaddingX * 2 })
    textY += senderHeight + 2

    doc.font('Helvetica').fontSize(9).fillColor('#1f2933')
      .text(body, x + bubblePaddingX, textY, {
        width: bubbleWidth - bubblePaddingX * 2,
        lineGap: 1,
      })
    textY += bodyHeight + 4

    doc.font('Helvetica').fontSize(7.5).fillColor('#6b7b88')
      .text(timeLabel || '', x + bubblePaddingX, textY, {
        width: bubbleWidth - bubblePaddingX * 2,
        align: 'right',
      })

    cursorY = y + bubbleHeight + bubbleGap
  }

  drawHeader(false)

  let currentDateLabel = ''
  messages.forEach((message) => {
    const dateLabel = formatExportDateLabel(message.createdAt)
    if (dateLabel !== currentDateLabel) {
      drawDateDivider(dateLabel)
      currentDateLabel = dateLabel
    }
    drawBubble(message)
  })

  doc.end()
}

function buildConversationTextExport(viewerUser, otherUser, messages) {
  const header = [
    `Chat with ${otherUser.username || otherUser.uniqueUsername || otherUser.id}`,
    `Total Messages: ${messages.length}`,
    '',
  ]
  const lines = messages.map((message) => {
    const senderLabel = getExportSenderLabel(message, viewerUser, otherUser)
    const timeLabel = formatExportTimeLabel(message.createdAt)
    const dateLabel = formatExportDateLabel(message.createdAt)
    const body = getExportMessageBody(message)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' | ')
    return `[${dateLabel} ${timeLabel}] ${senderLabel}: ${body || '[Empty]'}`
  })
  return [...header, ...lines].join('\n')
}

function shouldFallbackToTxt(messages) {
  const safeMessages = Array.isArray(messages) ? messages : []
  if (safeMessages.length > MAX_PDF_EXPORT_MESSAGES) return true
  const totalCharacters = safeMessages.reduce((sum, message) => sum + getExportMessageBody(message).length, 0)
  return totalCharacters > MAX_PDF_EXPORT_CHARACTERS
}

router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const otherUserId = Number(req.params.userId)
    const requestedLimit = Number(req.query.limit)
    const limit = Number.isInteger(requestedLimit) ? Math.max(10, Math.min(100, requestedLimit)) : 40
    const beforeIdRaw = Number(req.query.beforeId)
    const beforeId = Number.isInteger(beforeIdRaw) ? beforeIdRaw : null

    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) {
      return res.status(404).json({ message: 'User not found' })
    }
    const access = await canAccessPairConversation(req.user, otherUser)
    if (!access.ok) return res.status(403).json({ message: access.reason })

    const conversationWhere = buildConversationWhere(req.user, otherUser, access.assignment)
    if (beforeId) {
      conversationWhere.id = { [Op.lt]: beforeId }
    }

    const messagesDesc = await Message.findAll({
      where: conversationWhere,
      include: [
        { model: User, as: 'sender', attributes: ['id', 'username', 'uniqueUsername', 'role', 'canHandleExternalChat'] },
      ],
      order: [['id', 'DESC']],
      limit,
    })
    const messages = [...messagesDesc].reverse()
    const reactionMap = await buildReactionMapForMessages(messages.map((item) => item.id), req.user.id)

    const oldestLoadedId = messages[0]?.id || null
    const hasMore = Boolean(
      oldestLoadedId &&
        (await Message.findOne({
          where: {
            ...buildConversationWhere(req.user, otherUser, access.assignment),
            id: { [Op.lt]: oldestLoadedId },
          },
          attributes: ['id'],
        })),
    )

    const canViewConversationNote = canEditConversationNote(req.user)
    return res.json({
      messages: messages.map((item) => {
        const payload = formatMessage(item)
        payload.reactions = reactionMap[String(item.id)] || []
        return payload
      }),
      hasMore,
      nextBeforeId: oldestLoadedId,
      conversationNote: canViewConversationNote ? (access.assignment?.note || '') : '',
      conversationAssignedToUserId: canViewConversationNote ? (access.assignment?.assignedToUserId || null) : null,
      canEditConversationNote: canViewConversationNote,
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch messages', error: error.message })
  }
})

router.put('/:messageId/reactions', authMiddleware, async (req, res) => {
  try {
    const messageId = Number(req.params.messageId)
    const emoji = String(req.body?.emoji || '').trim()
    if (!Number.isInteger(messageId)) {
      return res.status(400).json({ message: 'Invalid messageId' })
    }
    if (!ALLOWED_REACTIONS_SET.has(emoji)) {
      return res.status(400).json({ message: `emoji must be one of: ${ALLOWED_REACTIONS.join(', ')}` })
    }

    const message = await Message.findByPk(messageId, { attributes: ['id', 'senderId', 'receiverId'] })
    if (!message) {
      return res.status(404).json({ message: 'Message not found' })
    }
    if (Number(req.user.id) !== Number(message.senderId) && Number(req.user.id) !== Number(message.receiverId)) {
      return res.status(403).json({ message: 'You cannot react to this message' })
    }

    const otherUserId = Number(req.user.id) === Number(message.senderId) ? Number(message.receiverId) : Number(message.senderId)
    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) return res.status(404).json({ message: 'User not found' })

    const access = await canAccessPairConversation(req.user, otherUser)
    if (!access.ok) return res.status(403).json({ message: access.reason })

    const hasMessageAccess = await Message.findOne({
      where: {
        ...buildConversationWhere(req.user, otherUser, access.assignment),
        id: messageId,
      },
      attributes: ['id'],
      raw: true,
    })
    if (!hasMessageAccess) {
      return res.status(403).json({ message: 'You cannot react to this message' })
    }

    const existingReaction = await MessageReaction.findOne({
      where: { messageId, userId: req.user.id },
      attributes: ['id', 'emoji'],
    })
    if (existingReaction) {
      if (String(existingReaction.emoji) === emoji) {
        await existingReaction.destroy()
      } else {
        await existingReaction.update({ emoji })
      }
    } else {
      await MessageReaction.create({ messageId, userId: req.user.id, emoji })
    }

    const requesterReactionsMap = await buildReactionMapForMessages([messageId], req.user.id)
    const otherReactionsMap = await buildReactionMapForMessages([messageId], otherUser.id)
    const requesterReactions = requesterReactionsMap[String(messageId)] || []
    const otherReactions = otherReactionsMap[String(messageId)] || []

    const io = req.app.get('io')
    io.to(`user:${req.user.id}`).emit('chat:reaction-updated', {
      messageId,
      reactions: requesterReactions,
    })
    io.to(`user:${otherUser.id}`).emit('chat:reaction-updated', {
      messageId,
      reactions: otherReactions,
    })

    return res.json({ message: 'Reaction updated', messageId, reactions: requesterReactions })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update reaction', error: error.message })
  }
})

router.patch('/:userId/note', authMiddleware, async (req, res) => {
  try {
    const otherUserId = Number(req.params.userId)
    const note = String(req.body?.note || '').trim()
    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    if (!canEditConversationNote(req.user)) {
      return res.status(403).json({ message: 'Conversation note access is disabled by admin' })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) return res.status(404).json({ message: 'User not found' })

    const access = await canAccessPairConversation(req.user, otherUser)
    if (!access.ok) return res.status(403).json({ message: access.reason })
    if (!access.assignment) {
      return res.status(404).json({ message: 'Conversation assignment not found' })
    }

    access.assignment.note = note || null
    access.assignment.noteUpdatedAt = note ? new Date() : null
    access.assignment.assignedByUserId = req.user.id
    await access.assignment.save()

    const io = req.app.get('io')
    const assignmentPayload = {
      externalUserId: Number(access.assignment.externalUserId),
      assignedToUserId: Number(access.assignment.assignedToUserId),
      publicHandlerUserId: Number(access.assignment.publicHandlerUserId || access.assignment.assignedToUserId),
      updatedAt: new Date().toISOString(),
    }
    const notePayloadForRequester = {
      withUserId: Number(otherUser.id),
      conversationNote: access.assignment.note || '',
      conversationAssignedToUserId: Number(access.assignment.assignedToUserId),
    }
    const notePayloadForOther = {
      withUserId: Number(req.user.id),
      conversationNote: access.assignment.note || '',
      conversationAssignedToUserId: Number(access.assignment.assignedToUserId),
    }
    uniqueIds([
      assignmentPayload.externalUserId,
      assignmentPayload.assignedToUserId,
      assignmentPayload.publicHandlerUserId,
      req.user.id,
      otherUser.id,
    ]).forEach((userId) => {
      io.to(`user:${userId}`).emit('chat:assignment-updated', assignmentPayload)
    })
    if (canEditConversationNote(req.user)) {
      io.to(`user:${req.user.id}`).emit('chat:conversation-note-updated', notePayloadForRequester)
    }
    if (canEditConversationNote(otherUser)) {
      io.to(`user:${otherUser.id}`).emit('chat:conversation-note-updated', notePayloadForOther)
    }

    return res.json({ message: 'Conversation note updated', conversationNote: access.assignment.note || '' })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update conversation note', error: error.message })
  }
})

router.get('/:userId/export-txt', authMiddleware, async (req, res) => {
  try {
    if (!req.user?.canDownloadConversations && !isAdmin(req.user) && !isModelAdmin(req.user)) {
      return res.status(403).json({ message: 'Download access is disabled by admin' })
    }

    const otherUserId = Number(req.params.userId)
    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) {
      return res.status(404).json({ message: 'User not found' })
    }

    const access = await canAccessPairConversation(req.user, otherUser)
    if (!access.ok) return res.status(403).json({ message: access.reason })

    const messages = await Message.findAll({
      where: buildConversationWhere(req.user, otherUser, access.assignment),
      order: [['id', 'ASC']],
      attributes: ['senderId', 'receiverId', 'text', 'messageType', 'mediaOriginalName', 'createdAt'],
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'username', 'uniqueUsername', 'role', 'canHandleExternalChat'],
          required: false,
        },
      ],
    })
    const content = buildConversationTextExport(req.user, otherUser, messages)
    const filename = `conversation_${req.user.id}_${otherUser.id}_${Date.now()}.txt`
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.status(200).send(content)
  } catch (error) {
    return res.status(500).json({ message: 'Failed to export conversation TXT', error: error.message })
  }
})

router.get('/:userId/export-pdf', authMiddleware, async (req, res) => {
  try {
    if (!req.user?.canDownloadConversations && !isAdmin(req.user) && !isModelAdmin(req.user)) {
      return res.status(403).json({ message: 'Download access is disabled by admin' })
    }

    const otherUserId = Number(req.params.userId)
    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) {
      return res.status(404).json({ message: 'User not found' })
    }

    const access = await canAccessPairConversation(req.user, otherUser)
    if (!access.ok) return res.status(403).json({ message: access.reason })

    const messages = await Message.findAll({
      where: buildConversationWhere(req.user, otherUser, access.assignment),
      order: [['id', 'ASC']],
      attributes: ['senderId', 'receiverId', 'text', 'messageType', 'mediaOriginalName', 'createdAt'],
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'username', 'uniqueUsername', 'role', 'canHandleExternalChat'],
          required: false,
        },
      ],
    })
    if (shouldFallbackToTxt(messages)) {
      return res.status(409).json({
        message: 'Conversation is too large for PDF export. TXT export is recommended.',
        fallbackFormat: 'txt',
      })
    }
    sendConversationPdf(res, req.user, otherUser, messages)
    return undefined
  } catch (error) {
    return res.status(500).json({ message: 'Failed to export conversation PDF', error: error.message })
  }
})

router.post('/:userId/seen', authMiddleware, async (req, res) => {
  try {
    const otherUserId = Number(req.params.userId)
    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) return res.status(404).json({ message: 'User not found' })
    const access = await canAccessPairConversation(req.user, otherUser)
    if (!access.ok) return res.status(403).json({ message: access.reason })

    const requestIsExternal = isExternalUser(req.user)
    const senderIds = requestIsExternal
      ? [access.assignment?.assignedToUserId, access.assignment?.publicHandlerUserId].filter(Boolean)
      : [otherUserId]

    const unseenMessages = await Message.findAll({
      where: {
        senderId: senderIds.length > 1 ? { [Op.in]: senderIds } : senderIds[0],
        receiverId: req.user.id,
        seen: false,
      },
      attributes: ['id'],
      raw: true,
    })
    const seenMessageIds = unseenMessages.map((item) => item.id)

    if (seenMessageIds.length > 0) {
      await Message.update(
        { seen: true },
        {
          where: {
            id: { [Op.in]: seenMessageIds },
          },
        },
      )

      const io = req.app.get('io')
      // Receiver's conversation key is sender (otherUserId),
      // sender's conversation key is receiver (req.user.id).
      io.to(`user:${req.user.id}`).emit('chat:messages-seen', {
        byUserId: req.user.id,
        withUserId: otherUserId,
        messageIds: seenMessageIds,
      })
      io.to(`user:${otherUserId}`).emit('chat:messages-seen', {
        byUserId: req.user.id,
        withUserId: req.user.id,
        messageIds: seenMessageIds,
      })
    }

    return res.json({ seenCount: seenMessageIds.length, messageIds: seenMessageIds })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to mark messages as seen', error: error.message })
  }
})

router.post('/:userId', authMiddleware, async (req, res) => {
  try {
    const otherUserId = Number(req.params.userId)
    const text = (req.body.text || '').trim()
    const mediaUrl = (req.body.mediaUrl || '').trim()
    const messageType = (req.body.messageType || 'text').trim().toLowerCase()
    const mediaMimeType = (req.body.mediaMimeType || '').trim()
    const mediaOriginalName = (req.body.mediaOriginalName || '').trim()
    const mediaGroupIdRaw = req.body.mediaGroupId
    const mediaGroupId = typeof mediaGroupIdRaw === 'string' ? mediaGroupIdRaw.trim().slice(0, 80) : null
    const rawDuration = req.body.mediaDurationSec
    const mediaDurationSec = rawDuration !== null && rawDuration !== undefined && Number.isFinite(Number(rawDuration))
      ? Math.max(0, Math.floor(Number(rawDuration)))
      : null

    if (!Number.isInteger(otherUserId)) {
      return res.status(400).json({ message: 'Invalid userId' })
    }
    if (!text && !mediaUrl) {
      return res.status(400).json({ message: 'Message text or mediaUrl is required' })
    }
    if (mediaUrl && !['image', 'video', 'audio', 'file'].includes(messageType)) {
      return res.status(400).json({ message: 'messageType must be image, video, audio, or file when mediaUrl is provided' })
    }
    if (!mediaUrl && messageType !== 'text') {
      return res.status(400).json({ message: 'messageType must be text when mediaUrl is empty' })
    }
    if (messageType !== 'audio' && mediaDurationSec !== null) {
      return res.status(400).json({ message: 'mediaDurationSec is only allowed for audio messages' })
    }
    if (mediaDurationSec !== null && mediaDurationSec > 60 * 60) {
      return res.status(400).json({ message: 'mediaDurationSec is too large' })
    }
    if (mediaGroupId && !/^[a-zA-Z0-9_-]{4,80}$/.test(mediaGroupId)) {
      return res.status(400).json({ message: 'Invalid mediaGroupId format' })
    }
    if (mediaUrl && !isSenderMediaUrlValid(mediaUrl, req.user.uniqueUsername || req.user.username, messageType)) {
      return res.status(400).json({
        message: 'Invalid media URL path. It must be inside your chat/<uniqueUsername>/images, videos, audios, or files folder',
      })
    }

    const otherUser = await User.findByPk(otherUserId)
    if (!otherUser) {
      return res.status(404).json({ message: 'User not found' })
    }
    const access = await canAccessPairConversation(req.user, otherUser)
    if (!access.ok) return res.status(403).json({ message: access.reason })
    const sendAccess = await canSendToUser(req.user, otherUser)
    if (!sendAccess.ok) return res.status(403).json({ message: sendAccess.reason })

    const requestIsExternal = isExternalUser(req.user)
    const effectiveOtherUserId = requestIsExternal
      ? Number(access.assignment?.assignedToUserId || otherUserId)
      : otherUserId
    const effectiveOtherUser = effectiveOtherUserId === otherUserId ? otherUser : await User.findByPk(effectiveOtherUserId)
    if (!effectiveOtherUser) {
      return res.status(404).json({ message: 'User not found' })
    }

    const message = await Message.create({
      senderId: req.user.id,
      receiverId: effectiveOtherUserId,
      text: text || null,
      messageType: mediaUrl ? messageType : 'text',
      mediaUrl: mediaUrl || null,
      mediaMimeType: mediaMimeType || null,
      mediaOriginalName: mediaOriginalName || null,
      mediaGroupId: mediaGroupId || null,
      mediaDurationSec: messageType === 'audio' ? mediaDurationSec : null,
    })

    const payload = formatMessage(message)
    const assignment = access.assignment
    const externalUserId = Number(assignment?.externalUserId || 0)
    const visibleHandlerUserId = Number(assignment?.publicHandlerUserId || assignment?.assignedToUserId || 0)
    let visibleHandlerUser = null
    if (visibleHandlerUserId === Number(req.user.id)) {
      visibleHandlerUser = req.user
    } else if (visibleHandlerUserId === Number(effectiveOtherUserId)) {
      visibleHandlerUser = effectiveOtherUser
    } else if (visibleHandlerUserId > 0) {
      visibleHandlerUser = await User.findByPk(visibleHandlerUserId)
    }
    const senderPayload = Number(req.user.id) === externalUserId
      ? mapPayloadForExternalViewer(payload, assignment)
      : payload
    const receiverPayload = Number(effectiveOtherUserId) === externalUserId
      ? mapPayloadForExternalViewer(payload, assignment)
      : payload
    const io = req.app.get('io')

    if (externalUserId) {
      const internalParticipantIds = uniqueIds([req.user.id, effectiveOtherUserId]).filter((id) => id !== externalUserId)
      await ensureContactPairs([
        ...internalParticipantIds.map((internalId) => ({ userId: internalId, contactUserId: externalUserId })),
        ...(visibleHandlerUserId > 0 ? [{ userId: externalUserId, contactUserId: visibleHandlerUserId }] : []),
      ])

      if (Number(req.user.id) === externalUserId) {
        io.to(`user:${req.user.id}`).emit('chat:contact-added', {
          user: serializeRealtimeContact(visibleHandlerUser || effectiveOtherUser, message.createdAt),
        })
      } else {
        io.to(`user:${req.user.id}`).emit('chat:contact-added', {
          user: serializeRealtimeContact(effectiveOtherUserId === externalUserId ? effectiveOtherUser : req.user, message.createdAt),
        })
      }

      if (Number(effectiveOtherUserId) === externalUserId) {
        io.to(`user:${effectiveOtherUserId}`).emit('chat:contact-added', {
          user: serializeRealtimeContact(visibleHandlerUser || req.user, message.createdAt),
        })
      } else {
        io.to(`user:${effectiveOtherUserId}`).emit('chat:contact-added', {
          user: serializeRealtimeContact(Number(req.user.id) === externalUserId ? req.user : effectiveOtherUser, message.createdAt),
        })
      }
    } else {
      await ensureContactPairs([
        { userId: req.user.id, contactUserId: effectiveOtherUserId },
        { userId: effectiveOtherUserId, contactUserId: req.user.id },
      ])

      io.to(`user:${req.user.id}`).emit('chat:contact-added', {
        user: serializeRealtimeContact(effectiveOtherUser, message.createdAt),
      })
      io.to(`user:${effectiveOtherUserId}`).emit('chat:contact-added', {
        user: serializeRealtimeContact(req.user, message.createdAt),
      })
    }

    io.to(`user:${req.user.id}`).emit('chat:message', senderPayload)
    io.to(`user:${effectiveOtherUserId}`).emit('chat:message', receiverPayload)

    return res.status(201).json({ message: senderPayload })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to send message', error: error.message })
  }
})

router.delete('/chat/:userId', authMiddleware, async (req, res) => {
  return res.status(403).json({ message: 'Conversation removal is disabled. You can delete only your own messages.' })
})

router.delete('/:messageId', authMiddleware, async (req, res) => {
  try {
    const messageId = Number(req.params.messageId)
    if (!Number.isInteger(messageId)) {
      return res.status(400).json({ message: 'Invalid messageId' })
    }

    const message = await Message.findByPk(messageId)
    if (!message) {
      return res.status(404).json({ message: 'Message not found' })
    }

    if (message.senderId !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete your own messages' })
    }

    const mediaUrl = String(message.mediaUrl || '').trim()
    let mediaDeleteError = null
    if (mediaUrl) {
      try {
        await deleteUploadedFile(mediaUrl)
      } catch (error) {
        mediaDeleteError = error
      }
    }

    await MessageReaction.destroy({ where: { messageId: message.id } })
    await message.destroy()
    const io = req.app.get('io')
    io.to(`user:${message.senderId}`).emit('chat:message-deleted', {
      messageId: message.id,
      withUserId: message.receiverId,
    })
    io.to(`user:${message.receiverId}`).emit('chat:message-deleted', {
      messageId: message.id,
      withUserId: message.senderId,
    })

    if (mediaDeleteError) {
      return res.json({
        message: 'Message deleted, but media cleanup failed',
        messageId: message.id,
        mediaDeleted: false,
        error: mediaDeleteError.message,
      })
    }

    return res.json({ message: 'Message deleted successfully', messageId: message.id, mediaDeleted: true })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete message', error: error.message })
  }
})

module.exports = router
