function sanitizeUsername(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function createUniqueUsernameCandidate(username = '', date = new Date()) {
  const base = sanitizeUsername(username) || 'user'
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const random = Math.random().toString(36).slice(2, 8)
  return `${base}_${y}${m}${d}_${random}`
}

async function buildUnusedUniqueUsername(User, username) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = createUniqueUsernameCandidate(username)
    const existing = await User.findOne({
      where: { uniqueUsername: candidate },
      attributes: ['id'],
    })
    if (!existing) return candidate
  }

  return `${sanitizeUsername(username) || 'user'}_${Date.now()}`
}

async function ensureUserUniqueUsername(user, User) {
  if (user.uniqueUsername) return user.uniqueUsername

  const uniqueUsername = await buildUnusedUniqueUsername(User, user.username)
  user.uniqueUsername = uniqueUsername
  await user.save()
  return uniqueUsername
}

module.exports = {
  sanitizeUsername,
  createUniqueUsernameCandidate,
  buildUnusedUniqueUsername,
  ensureUserUniqueUsername,
}
