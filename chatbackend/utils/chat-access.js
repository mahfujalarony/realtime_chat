const { Contact, ConversationAssignment } = require('../models')

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
  await Contact.findOrCreate({
    where: { userId: userAId, contactUserId: userBId },
    defaults: { userId: userAId, contactUserId: userBId },
  })
  await Contact.findOrCreate({
    where: { userId: userBId, contactUserId: userAId },
    defaults: { userId: userBId, contactUserId: userAId },
  })
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

async function canAccessPairConversation(requestUser, otherUser) {
  if (!requestUser || !otherUser) {
    return { ok: false, reason: 'User not found', assignment: null, externalUser: null, internalUser: null }
  }
  if (!isValidConversationPair(requestUser, otherUser)) {
    return { ok: false, reason: 'Only external <> internal conversation is allowed', assignment: null, externalUser: null, internalUser: null }
  }

  const { externalUser, internalUser } = getExternalAndInternal(requestUser, otherUser)
  let assignment = await ConversationAssignment.findOne({
    where: { externalUserId: externalUser.id },
  })

  if (!assignment) {
    if (isExternalUser(requestUser)) {
      return { ok: false, reason: 'Conversation is not assigned yet', assignment: null, externalUser, internalUser }
    }
    assignment = await ConversationAssignment.create({
      externalUserId: externalUser.id,
      assignedToUserId: internalUser.id,
      assignedByUserId: isAdmin(requestUser) ? requestUser.id : null,
    })
  }

  if (isAdmin(requestUser)) {
    return { ok: true, reason: '', assignment, externalUser, internalUser }
  }

  if (isExternalUser(requestUser)) {
    const allowedPublicId = Number(assignment.publicHandlerUserId || assignment.assignedToUserId)
    if (allowedPublicId !== Number(otherUser.id)) {
      return { ok: false, reason: 'You are assigned to another agent', assignment, externalUser, internalUser }
    }
    return { ok: true, reason: '', assignment, externalUser, internalUser }
  }

  if (Number(assignment.assignedToUserId) !== Number(requestUser.id)) {
    return { ok: false, reason: 'This conversation is assigned to another user', assignment, externalUser, internalUser }
  }
  return { ok: true, reason: '', assignment, externalUser, internalUser }
}

module.exports = {
  isAdmin,
  isModelAdmin,
  canHandleExternal,
  isExternalUser,
  isValidConversationPair,
  getExternalAndInternal,
  ensureMutualContact,
  getOrCreateAssignmentForPair,
  canAccessPairConversation,
}
