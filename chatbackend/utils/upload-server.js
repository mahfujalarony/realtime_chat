const UPLOAD_SERVER_URL = process.env.UPLOAD_SERVER_URL || 'http://localhost:5001'

function extractUploadFilePath(mediaUrl) {
  try {
    const raw = String(mediaUrl || '').trim()
    if (!raw) return null
    const pathname = decodeURIComponent(
      raw.startsWith('/')
        ? raw
        : new URL(raw).pathname,
    )
    const match = pathname.match(/\/public\/chat\/([^/]+)\/(images|videos|audios|files|profile)\/([^/]+)$/)
    if (!match) return null
    return {
      uniqueUsername: match[1],
      mediaType: match[2],
      filename: match[3],
    }
  } catch (error) {
    return null
  }
}

async function ensureUserFolder(uniqueUsername) {
  if (!UPLOAD_SERVER_URL) {
    return { skipped: true }
  }

  const endpoint = `${UPLOAD_SERVER_URL}/create-folder`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: uniqueUsername,
      targetPath: `chat/${uniqueUsername}`,
    }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || 'Upload server folder create failed')
  }

  return response.json().catch(() => ({}))
}

function getUploadUrl(uniqueUsername, mediaType = 'images') {
  if (!UPLOAD_SERVER_URL) return null
  return `${UPLOAD_SERVER_URL}/upload/chat/${encodeURIComponent(uniqueUsername)}/${mediaType}`
}

async function deleteUserFolder(uniqueUsername) {
  if (!UPLOAD_SERVER_URL || !uniqueUsername) return { skipped: true }

  const endpoint = `${UPLOAD_SERVER_URL}/delete-folder/chat/${encodeURIComponent(uniqueUsername)}`
  const response = await fetch(endpoint, { method: 'DELETE' })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || 'Upload server folder delete failed')
  }
  return response.json().catch(() => ({}))
}

async function deleteUploadedFile(mediaUrl) {
  if (!UPLOAD_SERVER_URL || !mediaUrl) return { skipped: true }

  const parsed = extractUploadFilePath(mediaUrl)
  if (!parsed) return { skipped: true }

  const endpoint = `${UPLOAD_SERVER_URL}/delete/chat/${encodeURIComponent(parsed.uniqueUsername)}/${encodeURIComponent(parsed.mediaType)}/${encodeURIComponent(parsed.filename)}`
  const response = await fetch(endpoint, { method: 'DELETE' })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || 'Upload server file delete failed')
  }
  return response.json().catch(() => ({}))
}

module.exports = {
  ensureUserFolder,
  extractUploadFilePath,
  getUploadUrl,
  deleteUploadedFile,
  deleteUserFolder,
  UPLOAD_SERVER_URL,
}
