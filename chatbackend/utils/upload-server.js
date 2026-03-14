const UPLOAD_SERVER_URL = process.env.UPLOAD_SERVER_URL || 'http://localhost:5001'

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

module.exports = {
  ensureUserFolder,
  getUploadUrl,
  deleteUserFolder,
  UPLOAD_SERVER_URL,
}
