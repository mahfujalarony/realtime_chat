import { useEffect, useMemo, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || ''

function resolveApiPath(path) {
  if (!path.startsWith('/')) return path
  if (API_URL) return `${API_URL}${path}`
  return path
}

async function apiFetch(path, options = {}, token = '') {
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
  if (!response.ok) throw new Error(payload?.message || 'Request failed')
  return payload
}

function ModelAdmin() {
  const token = useMemo(() => localStorage.getItem('chat_token') || '', [])
  const [me, setMe] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const data = await apiFetch('/api/auth/me', {}, token)
        setMe(data.user || null)
      } catch (err) {
        setError(err.message)
      }
    })()
  }, [token])

  if (!token) {
    return (
      <main className="grid h-[100dvh] place-items-center bg-[#f4f6f8] p-4">
        <div className="rounded-2xl border border-[#e1e7eb] bg-white px-6 py-5 text-center">
          <h1 className="text-2xl font-bold text-[#1f2c34]">Model Admin Page</h1>
          <p className="mt-2 text-sm text-[#667781]">Login required.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-[100dvh] bg-[#f4f6f8] p-4 md:p-6">
      <section className="mx-auto max-w-4xl space-y-4">
        <div className="rounded-2xl border border-[#e1e7eb] bg-white p-4 md:p-5">
          <h1 className="text-2xl font-bold text-[#1f2c34]">Model Admin Page</h1>
          <p className="mt-1 text-sm text-[#667781]">This page is intentionally empty for now. You will define content later.</p>
        </div>

        {error ? <p className="rounded-lg bg-[#fff1f3] px-3 py-2 text-sm text-[#cf294f]">{error}</p> : null}
      </section>
    </main>
  )
}

export default ModelAdmin
