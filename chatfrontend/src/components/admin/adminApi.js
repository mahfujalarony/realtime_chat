import { fetchJsonWithAuth } from '../../lib/auth'

export async function apiFetch(path, options = {}, token = '') {
  return fetchJsonWithAuth(path, options, {
    tokenOverride: token,
    skipAuth: !token && /^\/api\/auth\/(login|register)$/i.test(String(path || '')),
  })
}

export function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

 export function formatRelativeTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d ago`
  if (diffSec < 86400 * 365) return `${Math.floor(diffSec / (86400 * 30))}mo ago`
  return `${Math.floor(diffSec / (86400 * 365))}y ago`
}

export function messagePreview(message) {
  if (message?.text) return message.text
  if (message?.messageType === 'image') return '[Image]'
  if (message?.messageType === 'video') return '[Video]'
  if (message?.messageType === 'audio') return '[Audio]'
  if (message?.messageType === 'file') return '[File]'
  return `[${message?.messageType || 'message'}]`
}
