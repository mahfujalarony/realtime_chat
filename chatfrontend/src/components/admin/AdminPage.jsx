import { useEffect, useMemo, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || ''
const PAGE_SIZE = 30

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
  if (!response.ok) {
    throw new Error(payload?.message || 'Request failed')
  }
  return payload
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function AdminPage() {
  const token = useMemo(() => localStorage.getItem('chat_token') || '', [])
  const [me, setMe] = useState(null)
  const [users, setUsers] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [updatingId, setUpdatingId] = useState(null)
  const [error, setError] = useState('')

  const loadUsers = async ({ targetPage = 1, append = false, currentQuery = '' } = {}) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: String(PAGE_SIZE),
      })
      if (currentQuery.trim()) params.set('q', currentQuery.trim())
      const data = await apiFetch(`/api/admin/users?${params.toString()}`, {}, token)
      setUsers((prev) => (append ? [...prev, ...(data.users || [])] : data.users || []))
      setPage(Number(data.page) || targetPage)
      setHasMore(Boolean(data.hasMore))
      setTotal(Number(data.total) || 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

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

  useEffect(() => {
    if (!token || String(me?.role || '') !== 'admin') return
    loadUsers({ targetPage: 1, append: false, currentQuery: query })
  }, [token, me?.role, query])

  const onSubmitSearch = (event) => {
    event.preventDefault()
    setQuery(searchInput)
  }

  const updateRole = async (user, nextRole) => {
    setUpdatingId(user.id)
    setError('')
    try {
      const data = await apiFetch(
        `/api/admin/users/${user.id}/role`,
        { method: 'PATCH', body: JSON.stringify({ role: nextRole }) },
        token,
      )
      setUsers((prev) => prev.map((item) => (item.id === user.id ? data.user : item)))
    } catch (err) {
      setError(err.message)
    } finally {
      setUpdatingId(null)
    }
  }

  if (!token) {
    return (
      <main className="grid h-[100dvh] place-items-center bg-[#f4f6f8] p-4">
        <div className="rounded-2xl border border-[#e1e7eb] bg-white px-6 py-5 text-center">
          <h1 className="text-2xl font-bold text-[#1f2c34]">Admin Page</h1>
          <p className="mt-2 text-sm text-[#667781]">Login required.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-[100dvh] bg-[#f4f6f8] p-4 md:p-6">
      <section className="mx-auto max-w-5xl">
        <div className="mb-4 rounded-2xl border border-[#e1e7eb] bg-white p-4 md:p-5">
          <h1 className="text-2xl font-bold text-[#1f2c34]">Admin Page</h1>
          <p className="mt-1 text-sm text-[#667781]">Users are sorted by latest join date.</p>

          <form onSubmit={onSubmitSearch} className="mt-4 flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search user by name/email/mobile/unique username"
              className="h-10 flex-1 rounded-lg border border-[#d5dde2] px-3 text-sm outline-none focus:border-[#1aa34a]"
            />
            <button type="submit" className="rounded-lg bg-[#25d366] px-4 text-sm font-semibold text-white">
              Search
            </button>
          </form>
        </div>

        {error ? <p className="mb-3 rounded-lg bg-[#fff1f3] px-3 py-2 text-sm text-[#cf294f]">{error}</p> : null}

        <div className="overflow-hidden rounded-2xl border border-[#e1e7eb] bg-white">
          <div className="flex items-center justify-between border-b border-[#edf1f4] bg-[#f8fafb] px-4 py-3">
            <p className="text-sm font-semibold text-[#1f2c34]">User List</p>
            <p className="text-xs text-[#667781]">Total: {total}</p>
          </div>
          {users.map((user) => (
            <div key={user.id} className="border-b border-[#edf1f4] px-4 py-3 last:border-b-0 md:py-3.5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-11 w-11 overflow-hidden rounded-full bg-[#d0d7db]">
                    {user.profileMediaUrl ? (
                      <img src={user.profileMediaUrl} alt={user.username} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-[#30424f]">
                        {String(user.username || 'U').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-[#1f2c34]">{user.username}</p>
                    <p className="truncate text-xs text-[#667781]">{user.uniqueUsername || '-'}</p>
                    <p className="mt-1 truncate text-xs text-[#667781]">{user.email || user.mobileNumber || '-'}</p>
                    <p className="mt-1 text-[11px] text-[#667781]">Joined: {formatDateTime(user.createdAt)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      user.role === 'model_admin'
                        ? 'bg-[#e7f5ec] text-[#0c8f4f]'
                        : user.role === 'admin'
                          ? 'bg-[#e8eefc] text-[#1d4ed8]'
                          : 'bg-[#edf1f4] text-[#4b5a66]'
                    }`}
                  >
                    {user.role}
                  </span>

                  {user.role !== 'admin' ? (
                    <button
                      type="button"
                      onClick={() => updateRole(user, user.role === 'model_admin' ? 'user' : 'model_admin')}
                      disabled={updatingId === user.id}
                      className="rounded-md bg-[#111b21] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {updatingId === user.id ? 'Please wait...' : user.role === 'model_admin' ? 'Remove Model Admin' : 'Make Model Admin'}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>

        {!loading && users.length === 0 ? (
          <div className="mt-4 rounded-xl border border-[#e1e7eb] bg-white p-4 text-sm text-[#667781]">No users found.</div>
        ) : null}

        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => loadUsers({ targetPage: Math.max(1, page - 1), append: false, currentQuery: query })}
            disabled={loading || page <= 1}
            className="rounded-lg border border-[#d5dde2] bg-white px-4 py-2 text-sm font-semibold text-[#1f2c34] disabled:opacity-50"
          >
            Previous
          </button>
          <p className="text-sm text-[#54656f]">Page {page}</p>
          <button
            type="button"
            onClick={() => loadUsers({ targetPage: page + 1, append: false, currentQuery: query })}
            disabled={loading || !hasMore}
            className="rounded-lg border border-[#d5dde2] bg-white px-4 py-2 text-sm font-semibold text-[#1f2c34] disabled:opacity-50"
          >
            Next
          </button>
        </div>

        {hasMore ? (
          <div className="mt-2 flex justify-center text-xs text-[#667781]">
            More users available on next page
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default AdminPage
