const LOGIN_RATE_LIMIT_THRESHOLD = Math.max(1, Number(process.env.LOGIN_RATE_LIMIT_THRESHOLD || 10))
const LOGIN_RATE_LIMIT_COOLDOWN_MS = Math.max(1000, Number(process.env.LOGIN_RATE_LIMIT_COOLDOWN_MS || 15 * 60 * 1000))
const LOGIN_RATE_LIMIT_MAX_KEYS = Math.max(1000, Number(process.env.LOGIN_RATE_LIMIT_MAX_KEYS || 50000))

const loginAttempts = new Map()

function normalizeIdentifier(identifier) {
  return String(identifier || '').trim().toLowerCase()
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (forwarded[0]) return forwarded[0]

  return String(
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    'unknown',
  ).trim()
}

function buildRateLimitKey(req, identifier) {
  return `${getClientIp(req)}::${normalizeIdentifier(identifier)}`
}

function pruneLoginAttemptMap() {
  if (loginAttempts.size < LOGIN_RATE_LIMIT_MAX_KEYS) return

  const now = Date.now()
  for (const [key, entry] of loginAttempts.entries()) {
    if (!entry) {
      loginAttempts.delete(key)
      continue
    }

    const lockedUntil = Number(entry.lockedUntil || 0)
    const lastFailedAt = Number(entry.lastFailedAt || 0)
    if ((lockedUntil && lockedUntil <= now) || (!lockedUntil && now - lastFailedAt > LOGIN_RATE_LIMIT_COOLDOWN_MS)) {
      loginAttempts.delete(key)
    }
    if (loginAttempts.size < LOGIN_RATE_LIMIT_MAX_KEYS) break
  }
}

function getThrottleState(req, identifier) {
  const key = buildRateLimitKey(req, identifier)
  const entry = loginAttempts.get(key)
  if (!entry) return { key, remainingMs: 0, lockedUntil: null, blocked: false }

  const now = Date.now()
  const lockedUntil = Number(entry.lockedUntil || 0)
  if (!lockedUntil || lockedUntil <= now) {
    if (lockedUntil && lockedUntil <= now) loginAttempts.delete(key)
    return { key, remainingMs: 0, lockedUntil: null, blocked: false }
  }

  return {
    key,
    remainingMs: lockedUntil - now,
    lockedUntil: new Date(lockedUntil),
    blocked: true,
  }
}

function recordFailedLogin(req, identifier) {
  const key = buildRateLimitKey(req, identifier)
  const now = Date.now()
  const current = loginAttempts.get(key)

  if (!current || (current.lockedUntil && current.lockedUntil <= now) || now - Number(current.lastFailedAt || 0) > LOGIN_RATE_LIMIT_COOLDOWN_MS) {
    const next = {
      count: 1,
      lastFailedAt: now,
      lockedUntil: null,
    }
    loginAttempts.set(key, next)
    pruneLoginAttemptMap()
    return { blocked: false, remainingMs: 0, count: next.count }
  }

  const nextCount = Number(current.count || 0) + 1
  const next = {
    count: nextCount,
    lastFailedAt: now,
    lockedUntil: nextCount >= LOGIN_RATE_LIMIT_THRESHOLD ? now + LOGIN_RATE_LIMIT_COOLDOWN_MS : null,
  }
  loginAttempts.set(key, next)
  pruneLoginAttemptMap()

  return {
    blocked: Boolean(next.lockedUntil),
    remainingMs: next.lockedUntil ? next.lockedUntil - now : 0,
    count: next.count,
  }
}

function clearFailedLoginState(req, identifier) {
  loginAttempts.delete(buildRateLimitKey(req, identifier))
}

function getRateLimitMessage(remainingMs) {
  const remainingMin = Math.max(1, Math.ceil(Math.max(0, Number(remainingMs || 0)) / (60 * 1000)))
  return `Too many failed login attempts from this network. Try again in ${remainingMin} minute${remainingMin === 1 ? '' : 's'}.`
}

module.exports = {
  LOGIN_RATE_LIMIT_THRESHOLD,
  LOGIN_RATE_LIMIT_COOLDOWN_MS,
  getThrottleState,
  recordFailedLogin,
  clearFailedLoginState,
  getRateLimitMessage,
}
