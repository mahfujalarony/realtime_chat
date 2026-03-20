const API_URL = import.meta.env.VITE_API_URL || ''

let accessToken = ''
let refreshPromise = null
const listeners = new Set()

function resolveApiPath(path) {
  if (!path.startsWith('/')) return path
  if (API_URL) return `${API_URL}${path}`
  return path
}

function notifyAuthListeners() {
  listeners.forEach((listener) => {
    try {
      listener(accessToken)
    } catch {
      // Keep auth propagation resilient.
    }
  })
}

export function getAccessToken() {
  return accessToken
}

export function setAccessToken(token) {
  accessToken = String(token || '')
  notifyAuthListeners()
  return accessToken
}

export function clearAccessToken() {
  accessToken = ''
  notifyAuthListeners()
}

export function subscribeToAuth(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function buildAuthError(message = 'Unauthorized') {
  const error = new Error(message)
  error.code = 'AUTH_UNAUTHORIZED'
  return error
}

async function parseJsonSafe(response) {
  return response.json().catch(() => ({}))
}

export async function refreshSession() {
  if (refreshPromise) return refreshPromise

  refreshPromise = fetch(resolveApiPath('/api/auth/refresh'), {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (response) => {
      const payload = await parseJsonSafe(response)
      if (!response.ok || !payload?.token) {
        clearAccessToken()
        throw buildAuthError(payload?.message || 'Session expired')
      }
      setAccessToken(payload.token)
      return payload
    })
    .catch((error) => {
      clearAccessToken()
      if (error?.code === 'AUTH_UNAUTHORIZED') throw error
      throw buildAuthError(error?.message || 'Session expired')
    })
    .finally(() => {
      refreshPromise = null
    })

  return refreshPromise
}

export async function fetchWithAuth(path, options = {}, config = {}) {
  const skipAuth = Boolean(config.skipAuth)
  const allowRefresh = config.allowRefresh !== false
  const tokenOverride = config.tokenOverride
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  const token = typeof tokenOverride === 'string' ? tokenOverride : getAccessToken()

  const response = await fetch(resolveApiPath(path), {
    ...options,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(!skipAuth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })

  if (response.status !== 401 || skipAuth || !allowRefresh) {
    return response
  }

  const nextSession = await refreshSession()
  const nextToken = nextSession?.token || getAccessToken()
  if (!nextToken) {
    throw buildAuthError('Session expired')
  }

  return fetch(resolveApiPath(path), {
    ...options,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${nextToken}`,
      ...(options.headers || {}),
    },
  })
}

export async function fetchJsonWithAuth(path, options = {}, config = {}) {
  const response = await fetchWithAuth(path, options, config)
  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    if (response.status === 401) {
      clearAccessToken()
      throw buildAuthError(payload?.message || 'Unauthorized')
    }
    throw new Error(payload?.message || 'Request failed')
  }

  return payload
}

export async function logoutSession() {
  try {
    await fetch(resolveApiPath('/api/auth/logout'), {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    // Best-effort server logout.
  } finally {
    clearAccessToken()
  }
}
