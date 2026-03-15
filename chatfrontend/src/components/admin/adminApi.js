const API_URL = import.meta.env.VITE_API_URL || ''

function resolveApiPath(path) {
  if (!path.startsWith('/')) return path
  if (API_URL) return `${API_URL}${path}`
  return path
}

export async function apiFetch(path, options = {}, token = '') {
  const response = await fetch(resolveApiPath(path), {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body,
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.message || 'Request failed')
  }
  return payload
}

export function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

export function messagePreview(message) {
  if (message?.text) return message.text
  if (message?.messageType === 'image') return '[Image]'
  if (message?.messageType === 'video') return '[Video]'
  if (message?.messageType === 'audio') return '[Audio]'
  if (message?.messageType === 'file') return '[File]'
  return `[${message?.messageType || 'message'}]`
}
