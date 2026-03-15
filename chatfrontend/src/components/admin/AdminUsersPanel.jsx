import { formatDateTime } from './adminApi'

function AdminUsersPanel({
  searchInput,
  setSearchInput,
  onSubmitSearch,
  users,
  total,
  loading,
  page,
  hasMore,
  query,
  loadUsers,
}) {
  return (
    <>
      <div className="mb-3 rounded-2xl border border-[#dce5eb] bg-white/95 p-3 shadow-sm backdrop-blur md:p-4">
        <h1 className="text-2xl font-bold text-[#1f2c34]">User List</h1>
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

      <div className="overflow-hidden rounded-2xl border border-[#e1e7eb] bg-white shadow-sm">
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

              <div className="flex flex-wrap items-center gap-2">
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
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    user.canHandleExternalChat ? 'bg-[#e7f5ec] text-[#0c8f4f]' : 'bg-[#fff2e5] text-[#b45309]'
                  }`}
                >
                  {user.canHandleExternalChat ? 'Agent Access: On' : 'Agent Access: Off'}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    user.canDownloadConversations ? 'bg-[#e8eefc] text-[#1d4ed8]' : 'bg-[#edf1f4] text-[#4b5a66]'
                  }`}
                >
                  {user.canDownloadConversations ? 'Download: On' : 'Download: Off'}
                </span>
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
        <div className="mt-2 flex justify-center text-xs text-[#667781]">More users available on next page</div>
      ) : null}
    </>
  )
}

export default AdminUsersPanel
