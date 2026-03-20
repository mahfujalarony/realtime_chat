const { Op } = require('sequelize')
const { Contact, ConversationAssignment, UserBlock } = require('../models')
const { ensureContactPairs } = require('./contact-write')

function normalizeRole(user) {
  return String(user?.role || 'user')
}

function isAdmin(user) {
  return normalizeRole(user) === 'admin'
}

function isModelAdmin(user) {
  return normalizeRole(user) === 'model_admin'
}

function canHandleExternal(user) {
  return isAdmin(user) || isModelAdmin(user) || Boolean(user?.canHandleExternalChat)
}

function canBlockUsers(user) {
  return isAdmin(user) || isModelAdmin(user) || Boolean(user?.canBlockUsers)
}

function isExternalUser(user) {
  return !canHandleExternal(user)
}

function isValidConversationPair(userA, userB) {
  if (!userA || !userB) return false
  if (Number(userA.id) === Number(userB.id)) return false
  return isExternalUser(userA) !== isExternalUser(userB)
}

function getExternalAndInternal(userA, userB) {
  if (!isValidConversationPair(userA, userB)) return { externalUser: null, internalUser: null }
  return isExternalUser(userA)
    ? { externalUser: userA, internalUser: userB }
    : { externalUser: userB, internalUser: userA }
}

async function ensureMutualContact(userAId, userBId) {
  await ensureContactPairs([
    { userId: userAId, contactUserId: userBId },
    { userId: userBId, contactUserId: userAId },
  ])
}

async function getOrCreateAssignmentForPair({
  externalUser,
  internalUser,
  assignedByUserId = null,
}) {
  let assignment = await ConversationAssignment.findOne({
    where: { externalUserId: externalUser.id },
  })
  if (!assignment) {
    assignment = await ConversationAssignment.create({
      externalUserId: externalUser.id,
      assignedToUserId: internalUser.id,
      publicHandlerUserId: internalUser.id,
      assignedByUserId: assignedByUserId || null,
    })
  }
  return assignment
}

async function getBlockState(requestUserId, otherUserId) {
  const normalizedRequestUserId = Number(requestUserId)
  const normalizedOtherUserId = Number(otherUserId)
  if (!Number.isInteger(normalizedRequestUserId) || !Number.isInteger(normalizedOtherUserId)) {
    return { isBlockedByMe: false, hasBlockedMe: false, blocked: false }
  }

  const rows = await UserBlock.findAll({
    where: {
      [Op.or]: [
        { blockerId: normalizedRequestUserId, blockedUserId: normalizedOtherUserId },
        { blockerId: normalizedOtherUserId, blockedUserId: normalizedRequestUserId },
      ],
    },
    attributes: ['blockerId', 'blockedUserId'],
    raw: true,
  })

  const isBlockedByMe = rows.some(
    (row) => Number(row.blockerId) === normalizedRequestUserId && Number(row.blockedUserId) === normalizedOtherUserId,
  )
  const hasBlockedMe = rows.some(
    (row) => Number(row.blockerId) === normalizedOtherUserId && Number(row.blockedUserId) === normalizedRequestUserId,
  )

  return {
    isBlockedByMe,
    hasBlockedMe,
    blocked: isBlockedByMe || hasBlockedMe,
  }
}

async function canAccessPairConversation(requestUser, otherUser) {
  if (!requestUser || !otherUser) {
    return { ok: false, reason: 'User not found', assignment: null, externalUser: null, internalUser: null }
  }
  if (Number(requestUser.id) === Number(otherUser.id)) {
    return { ok: false, reason: 'You cannot chat with yourself', assignment: null, externalUser: null, internalUser: null }
  }
  if (isAdmin(requestUser) && !isExternalUser(otherUser)) {
    return { ok: true, reason: '', assignment: null, externalUser: null, internalUser: null }
  }
  if (!isValidConversationPair(requestUser, otherUser)) {
    return { ok: false, reason: 'Only external <> internal conversation is allowed', assignment: null, externalUser: null, internalUser: null }
  }

  const { externalUser, internalUser } = getExternalAndInternal(requestUser, otherUser)
  let assignment = await ConversationAssignment.findOne({
    where: { externalUserId: externalUser.id },
  })

  if (!assignment) {
    assignment = await ConversationAssignment.create({
      externalUserId: externalUser.id,
      assignedToUserId: internalUser.id,
      publicHandlerUserId: internalUser.id,
      assignedByUserId: isAdmin(requestUser) ? requestUser.id : null,
    })
  }

  if (isExternalUser(requestUser)) {
    return { ok: true, reason: '', assignment, externalUser, internalUser }
  }

  if (Number(assignment.assignedToUserId) !== Number(requestUser.id)) {
    return { ok: false, reason: 'This conversation is assigned to another user', assignment, externalUser, internalUser }
  }
  return { ok: true, reason: '', assignment, externalUser, internalUser }
}

async function canSendToUser(requestUser, otherUser) {
  if (!requestUser || !otherUser) {
    return { ok: false, reason: 'User not found', blockState: { isBlockedByMe: false, hasBlockedMe: false, blocked: false } }
  }

  const blockState = await getBlockState(requestUser.id, otherUser.id)
  if (blockState.blocked) {
    return { ok: false, reason: 'You can no longer message each other', blockState }
  }

  return { ok: true, reason: '', blockState }
}

module.exports = {
  isAdmin,
  isModelAdmin,
  canHandleExternal,
  canBlockUsers,
  isExternalUser,
  isValidConversationPair,
  getExternalAndInternal,
  ensureMutualContact,
  getOrCreateAssignmentForPair,
  canAccessPairConversation,
  getBlockState,
  canSendToUser,
}
