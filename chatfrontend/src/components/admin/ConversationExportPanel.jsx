import { useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || ''

function resolveApiPath(path) {
  if (!path.startsWith('/')) return path
  if (API_URL) return `${API_URL}${path}`
  return path
}

function getFilenameFromDisposition(dispositionHeader) {
  const raw = String(dispositionHeader || '')
  const match = raw.match(/filename="?([^"]+)"?/)
  return match?.[1] || `conversation_${Date.now()}.csv`
}

function ConversationExportPanel({
  token,
  title = 'Download Conversation CSV',
  defaultA = '',
  defaultB = '',
  userAId: externalA,
  userBId: externalB,
  onChangeUserAId,
  onChangeUserBId,
}) {
  const [localA, setLocalA] = useState(String(defaultA || ''))
  const [localB, setLocalB] = useState(String(defaultB || ''))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const userAId = externalA ?? localA
  const userBId = externalB ?? localB
  const setUserAId = onChangeUserAId ?? setLocalA
  const setUserBId = onChangeUserBId ?? setLocalB

  const onDownload = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    const a = Number(userAId)
    const b = Number(userBId)
    if (!Number.isInteger(a) || !Number.isInteger(b) || a <= 0 || b <= 0 || a === b) {
      setError('Enter two different valid user IDs.')
      return
    }

    setLoading(true)
    try {
      const url = resolveApiPath(`/api/moderation/conversations/export-csv?userAId=${a}&userBId=${b}`)
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.message || 'Failed to download CSV')
      }

      const blob = await response.blob()
      const link = document.createElement('a')
      const objectUrl = URL.createObjectURL(blob)
      link.href = objectUrl
      link.download = getFilenameFromDisposition(response.headers.get('content-disposition'))
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)
      setSuccess('CSV downloaded successfully.')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-[#e1e7eb] bg-white p-4 md:p-5">
      <h2 className="text-base font-semibold text-[#1f2c34]">{title}</h2>
      <p className="mt-1 text-xs text-[#667781]">Enter two user IDs to download their full direct conversation.</p>

      <form onSubmit={onDownload} className="mt-3 flex flex-col gap-2 md:flex-row">
        <input
          type="number"
          min="1"
          value={userAId}
          onChange={(event) => setUserAId(event.target.value)}
          placeholder="User A ID"
          className="h-10 rounded-lg border border-[#d5dde2] px-3 text-sm outline-none focus:border-[#1aa34a]"
        />
        <input
          type="number"
          min="1"
          value={userBId}
          onChange={(event) => setUserBId(event.target.value)}
          placeholder="User B ID"
          className="h-10 rounded-lg border border-[#d5dde2] px-3 text-sm outline-none focus:border-[#1aa34a]"
        />
        <button
          type="submit"
          disabled={loading}
          className="h-10 rounded-lg bg-[#111b21] px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? 'Downloading...' : 'Download CSV'}
        </button>
      </form>

      {error ? <p className="mt-2 text-xs text-[#cf294f]">{error}</p> : null}
      {success ? <p className="mt-2 text-xs text-[#0c8f4f]">{success}</p> : null}
    </div>
  )
}

export default ConversationExportPanel
