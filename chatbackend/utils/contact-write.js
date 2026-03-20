const { Contact } = require('../models')

function normalizeContactPairs(pairs = []) {
  const deduped = new Map()

  for (const pair of pairs) {
    const userId = Number(pair?.userId)
    const contactUserId = Number(pair?.contactUserId)
    if (!Number.isInteger(userId) || !Number.isInteger(contactUserId)) continue
    if (userId === contactUserId) continue
    deduped.set(`${userId}:${contactUserId}`, { userId, contactUserId })
  }

  return Array.from(deduped.values())
}

async function ensureContactPairs(pairs = []) {
  const normalizedPairs = normalizeContactPairs(pairs)
  if (!normalizedPairs.length) return []

  await Contact.bulkCreate(normalizedPairs, {
    ignoreDuplicates: true,
  })

  return normalizedPairs
}

module.exports = {
  ensureContactPairs,
  normalizeContactPairs,
}
