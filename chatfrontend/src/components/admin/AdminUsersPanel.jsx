import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { formatRelativeTime } from './adminApi'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../ui/pagination'

function buildPageItems(currentPage, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)

  const items = [1]
  const start = Math.max(2, currentPage - 1)
  const end = Math.min(totalPages - 1, currentPage + 1)

  if (start > 2) items.push('start-ellipsis')
  for (let page = start; page <= end; page += 1) items.push(page)
  if (end < totalPages - 1) items.push('end-ellipsis')

  items.push(totalPages)
  return items
}

function AdminUsersPanel({
  me,
  searchInput,
  setSearchInput,
  onSubmitSearch,
  users,
  total,
  loading,
  usersRefreshing,
  updatingId,
  page,
  pageSize,
  query,
  loadUsers,
  setUserStaffProfile,
  toggleUserDownloadAccess,
  toggleUserNoteAccess,
  toggleUserBlockAccess,
  openSetPasswordDialog,
  openProfileNoteDialog,
  openContactDialog,
}) {
  const [openPopoverUserId, setOpenPopoverUserId] = useState(null)

  const totalPages = Math.max(1, Math.ceil(Number(total || 0) / Math.max(1, Number(pageSize) || 1)))
  const pageItems = useMemo(() => buildPageItems(page, totalPages), [page, totalPages])

  const getProfileLabel = (user) => {
    if (user.role === 'admin') return 'Admin'
    if (user.role === 'model_admin') return 'Model Admin'
    if (user.canHandleExternalChat) return 'Agent User'
    return 'Default User'
  }

  const getProfileValue = (user) => {
    if (user.role === 'admin') return 'admin'
    if (user.role === 'model_admin') return 'model_admin'
    if (user.canHandleExternalChat) return 'agent'
    return 'default'
  }

  const goToPage = (targetPage) => {
    const nextPage = Math.max(1, Math.min(totalPages, Number(targetPage) || 1))
    if (nextPage === page || loading) return
    loadUsers({ targetPage: nextPage, append: false, currentQuery: query })
  }

  const refreshUsers = () => {
    if (loading || usersRefreshing) return
    loadUsers({ targetPage: page, append: false, currentQuery: query, preserveScroll: true, keepVisible: true })
  }

  const selectedUser = users.find((user) => Number(user.id) === Number(openPopoverUserId)) || null
  const isViewerModelAdmin = me?.role === 'model_admin'

  const renderUserActions = (user) => {
    const normalizedRole = String(user.role || 'user')
    const isAdmin = normalizedRole === 'admin'
    const isTargetModelAdmin = normalizedRole === 'model_admin'
    const isBusy = Number(updatingId) === Number(user.id)
    const cannotManageModelAdmin = isViewerModelAdmin && isTargetModelAdmin
    const canAssignModelAdmin = !isViewerModelAdmin

    return (
      <>
        <div className="border-b border-[#edf1f4] px-4 py-3">
          <p className="text-sm font-semibold text-[#1f2c34]">{user.username}</p>
          <p className="truncate text-xs text-[#667781]">{user.email || user.mobileNumber || '-'}</p>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#60727f]">Set Profile</p>
            <Select
              value={getProfileValue(user)}
              disabled={isBusy || isAdmin || cannotManageModelAdmin}
              onValueChange={(value) => setUserStaffProfile(user.id, value)}
            >
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Select profile" />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
                {canAssignModelAdmin ? <SelectItem value="model_admin">Model Admin</SelectItem> : null}
                {isAdmin ? <SelectItem value="admin">Admin</SelectItem> : null}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-[#33434d]">Download conversation</p>
            <Checkbox
              checked={Boolean(user.canDownloadConversations)}
              disabled={isBusy || isAdmin}
              onCheckedChange={(checked) => toggleUserDownloadAccess(user.id, checked === true)}
              aria-label="Toggle conversation download access"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-[#33434d]">Note</p>
            <Checkbox
              checked={Boolean(user.canEditConversationNote)}
              disabled={isBusy || isAdmin}
              onCheckedChange={(checked) => toggleUserNoteAccess(user.id, checked === true)}
              aria-label="Toggle note access"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-[#33434d]">Block</p>
            <Checkbox
              checked={Boolean(user.role === 'admin' || user.role === 'model_admin' || user.canBlockUsers)}
              disabled={isBusy || isAdmin || user.role === 'model_admin'}
              onCheckedChange={(checked) => toggleUserBlockAccess(user.id, checked === true)}
              aria-label="Toggle block access"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setOpenPopoverUserId(null)
              openContactDialog(user)
            }}
            disabled={isBusy}
            className="w-full rounded-lg border border-[#d5dde2] bg-white px-3 py-2 text-xs font-semibold text-[#1f2c34] transition hover:border-[#1aa34a] hover:text-[#12813b] disabled:opacity-50"
          >
            Edit Email & Number
          </button>

          <button
            type="button"
            onClick={() => {
              setOpenPopoverUserId(null)
              openProfileNoteDialog(user)
            }}
            disabled={isBusy}
            className="w-full rounded-lg border border-[#d5dde2] bg-white px-3 py-2 text-xs font-semibold text-[#1f2c34] transition hover:border-[#1aa34a] hover:text-[#12813b] disabled:opacity-50"
          >
            Set Profile Note
          </button>

          <button
            type="button"
            onClick={() => {
              setOpenPopoverUserId(null)
              openSetPasswordDialog(user)
            }}
            disabled={isBusy}
            className="w-full rounded-lg border border-[#d5dde2] bg-white px-3 py-2 text-xs font-semibold text-[#1f2c34] transition hover:border-[#1aa34a] hover:text-[#12813b] disabled:opacity-50"
          >
            Set New Password
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={onSubmitSearch} className="flex w-full items-center gap-2 sm:max-w-md">
          <input
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search user"
            className="h-9 flex-1 rounded-lg border border-[#d5dde2] bg-white px-3 text-sm outline-none focus:border-[#1aa34a]"
          />
          <button type="submit" className="rounded-lg bg-[#25d366] px-3 py-2 text-xs font-semibold text-white">
            Search
          </button>
        </form>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refreshUsers}
            disabled={loading || usersRefreshing}
            className={`shrink-0 transition-all duration-300 ${usersRefreshing ? 'scale-[1.02] shadow-[0_10px_24px_-18px_rgba(17,27,33,0.55)]' : ''}`}
          >
            <RefreshCw className={`refresh-spring-icon ${usersRefreshing ? 'is-refreshing' : ''}`} />
            {usersRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-[#dfe5e9] bg-[#f3f5f7] p-1.5 shadow-sm">
        <div className="flex items-center justify-between border-b border-[#edf1f4] bg-[#f8fafb] px-4 py-3">
          <p className="text-sm font-semibold text-[#1f2c34]">Users</p>
          <p className="text-xs text-[#667781]">
            {total} total
          </p>
        </div>

        <div className="hidden grid-cols-[minmax(0,2fr)_120px_minmax(0,1.5fr)_100px] gap-3 border-b border-[#edf1f4] bg-[#fbfcfd] px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#60727f] md:grid">
          <div>User</div>
          <div>Profile</div>
          <div>Contact</div>
          <div>Joined</div>
        </div>

        {users.map((user) => {
          return (
              <button
                key={user.id}
                type="button"
                onClick={() => setOpenPopoverUserId(user.id)}
                className="mb-1.5 grid w-full gap-2 rounded-lg border border-[#e1e7eb] bg-[#fafbfc] px-3 py-1.5 text-left transition-colors hover:bg-[#f0f2f4] last:mb-0 md:grid-cols-[minmax(0,2fr)_120px_minmax(0,1.5fr)_100px] md:items-center"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[#d0d7db]">
                    {user.profileMediaUrl ? (
                      <img src={user.profileMediaUrl} alt={user.username} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-[#30424f]">
                        {String(user.username || 'U').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold leading-tight text-[#1f2c34]">{user.username}</p>
                    <p className="mt-1 truncate text-xs text-[#33434d] md:hidden">{user.email || user.mobileNumber || '-'}</p>
                    <p className="mt-1 text-xs text-[#54656f] md:hidden">{formatRelativeTime(user.createdAt)}</p>
                  </div>
                </div>

                <div className="hidden md:block">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      user.role === 'model_admin'
                        ? 'bg-[#e7f5ec] text-[#0c8f4f]'
                        : user.role === 'admin'
                          ? 'bg-[#e8eefc] text-[#1d4ed8]'
                          : user.canHandleExternalChat
                            ? 'bg-[#e7f5ec] text-[#0c8f4f]'
                            : 'bg-[#edf1f4] text-[#4b5a66]'
                    }`}
                  >
                    {getProfileLabel(user)}
                  </span>
                </div>

                <div className="hidden min-w-0 md:block">
                  <p className="truncate text-xs text-[#33434d]">{user.email || user.mobileNumber || '-'}</p>
                </div>

                <div className="hidden md:block">
                  <p className="text-xs text-[#54656f]">{formatRelativeTime(user.createdAt)}</p>
                </div>
              </button>
            )
        })}
      </div>

      {!loading && users.length === 0 ? (
        <div className="mt-4 rounded-xl border border-[#e1e7eb] bg-white p-4 text-sm text-[#667781]">No users found.</div>
      ) : null}

      <div className="mt-4 flex flex-col items-center gap-2">
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious onClick={() => goToPage(page - 1)} disabled={page <= 1 || loading} />
            </PaginationItem>

            {pageItems.map((item) =>
              typeof item === 'number' ? (
                <PaginationItem key={`page-${item}`}>
                  <PaginationLink onClick={() => goToPage(item)} isActive={item === page}>
                    {item}
                  </PaginationLink>
                </PaginationItem>
              ) : (
                <PaginationItem key={item}>
                  <PaginationEllipsis />
                </PaginationItem>
              ),
            )}

            <PaginationItem>
              <PaginationNext onClick={() => goToPage(page + 1)} disabled={page >= totalPages || loading} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
        <p className="text-xs text-[#667781]">
          Page {page} of {totalPages}
        </p>
      </div>

      {selectedUser ? (
        <div className="fixed inset-0 z-50 bg-black/40 p-4" onClick={() => setOpenPopoverUserId(null)}>
          <div
            className="absolute inset-x-3 bottom-3 max-h-[82vh] overflow-y-auto rounded-3xl bg-white shadow-xl md:left-1/2 md:top-1/2 md:bottom-auto md:w-[min(92vw,26rem)] md:-translate-x-1/2 md:-translate-y-1/2"
            onClick={(event) => event.stopPropagation()}
          >
            {renderUserActions(selectedUser)}
          </div>
        </div>
      ) : null}
    </>
  )
}

export default AdminUsersPanel
