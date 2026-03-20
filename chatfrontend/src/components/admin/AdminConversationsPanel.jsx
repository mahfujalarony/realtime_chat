import { useMemo, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { formatRelativeTime } from './adminApi'
import { Button } from '../ui/button'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../ui/pagination'

function getInitials(name) {
  const value = String(name || '').trim()
  if (!value) return 'U'
  return value.slice(0, 1).toUpperCase()
}

function canForwardToConversation(user) {
  const normalizedRole = String(user?.role || 'user').toLowerCase()
  return normalizedRole === 'admin' || normalizedRole === 'model_admin' || Boolean(user?.canHandleExternalChat)
}

function getTeamLabel(role, canHandleExternalChat = false) {
  const normalized = String(role || 'user').toLowerCase()
  if (normalized === 'admin') return 'Admin'
  if (normalized === 'model_admin') return 'Model Admin'
  if (canHandleExternalChat) return 'Agent'
  return 'User'
}


function groupCandidatesByRole(candidates) {
  const groups = { Admin: [], 'Model Admin': [], Agent: [] }
  candidates.forEach((item) => {
    const group = getTeamLabel(item?.role, item?.canHandleExternalChat)
    if (groups[group]) groups[group].push(item)
  })
  return groups
}

function ForwardDropdown({
  conversation,
  candidates,
  onPick,
  isSaving,
  query,
  setQuery,
  align = 'left',
  selectedId,
}) {
  const normalizedQuery = String(query || '').trim().toLowerCase()
  const filtered = useMemo(
    () =>
      normalizedQuery
        ? candidates.filter((candidate) => {
            const username = String(candidate?.username || '').toLowerCase()
            const uniqueUsername = String(candidate?.uniqueUsername || '').toLowerCase()
            return username.includes(normalizedQuery) || uniqueUsername.includes(normalizedQuery)
          })
        : candidates,
    [candidates, normalizedQuery],
  )
  const grouped = useMemo(() => groupCandidatesByRole(filtered), [filtered])
  const groupOrder = ['Admin', 'Model Admin', 'Agent']

  return (
    <div
      className={`absolute ${align === 'right' ? 'right-0 md:right-0 md:left-auto left-1/2 -translate-x-1/2 md:translate-x-0' : 'left-1/2 -translate-x-1/2 md:left-0 md:translate-x-0'} top-full z-20 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-[#d5dde2] bg-white p-1.5 shadow-[0_18px_50px_-28px_rgba(17,27,33,0.45)]`}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
    >
      <div className="p-1">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search team member"
          className="h-7 w-full rounded border border-[#d5dde2] px-2 text-[11px] outline-none focus:border-[#1aa34a]"
        />
      </div>
      <div className="max-h-56 overflow-y-auto">
        {!filtered.length ? (
          <p className="px-2 py-2 text-xs text-[#667781]">No match found.</p>
        ) : (
          groupOrder.map((group) => (
            grouped[group].length ? (
              <div key={`${conversation.id}-${group}`} className="px-1 pb-1">
                <p className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#7b8b95]">{group}</p>
                {grouped[group].map((candidate) => {
                  const isSelected = Number(selectedId) === Number(candidate.id)
                  return (
                    <button
                      key={`fwd-${conversation.id}-${candidate.id}`}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onPick(candidate)
                      }}
                      disabled={isSaving}
                      className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-[#1f2c34] hover:bg-[#f3f7fb] disabled:opacity-60 ${
                        isSelected ? 'bg-[#eaf2ff]' : ''
                      }`}
                    >
                      <div className="h-7 w-7 overflow-hidden rounded-full bg-[#d0d7db]">
                        {candidate.profileMediaUrl ? (
                          <img src={candidate.profileMediaUrl} alt={candidate.username || 'Team'} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-[#30424f]">
                            {getInitials(candidate.username)}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{candidate.username}</p>
                        <p className="truncate text-[10px] text-[#70808a]">{getTeamLabel(candidate.role, candidate.canHandleExternalChat)}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : null
          ))
        )}
      </div>
    </div>
  )
}

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

function AdminConversationsPanel({
  conversations,
  conversationSearchInput,
  setConversationSearchInput,
  onSubmitConversationSearch,
  conversationTotal,
  conversationPageSize,
  conversationPage,
  conversationHasMore,
  conversationLoading,
  conversationRefreshing,
  conversationQuery,
  loadConversations,
  conversationListScrollRef,
  me,
  teamMembers,
  reloadTeamMembers,
  forwardToByExternalId,
  setForwardToByExternalId,
  forwardConversation,
  savingConversationId,
  deletingConversationId,
  requestDeleteConversation,
  openConversationMessages,
}) {
  const [openForwardFor, setOpenForwardFor] = useState(null)
  const [forwardQueryByExternalId, setForwardQueryByExternalId] = useState({})
  const safePageSize = Number(conversationPageSize) > 0 ? Number(conversationPageSize) : 10
  const totalPages = Math.max(1, Math.ceil(Number(conversationTotal || 0) / safePageSize))
  const pageItems = useMemo(() => buildPageItems(conversationPage, totalPages), [conversationPage, totalPages])

  const getTeamCandidates = (conversation) => {
    const assignedId = Number(conversation.assignedToUserId)
    const pool = [...teamMembers]
    if (me && canForwardToConversation(me)) {
      const hasMe = pool.some((item) => Number(item.id) === Number(me.id))
      if (!hasMe) pool.push(me)
    }
    return pool
      .filter((u) => canForwardToConversation(u) && Number(u.id) !== Number(conversation.externalUserId) && Number(u.id) !== assignedId)
      .sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')))
  }

  const toggleForwardMenu = async (externalUserId) => {
    const isOpen = Number(openForwardFor) === Number(externalUserId)
    if (isOpen) {
      setOpenForwardFor(null)
      return
    }
    await reloadTeamMembers?.()
    setOpenForwardFor(externalUserId)
  }

  const goToPage = (targetPage) => {
    const nextPage = Math.max(1, Math.min(totalPages, Number(targetPage) || 1))
    if (nextPage === conversationPage || conversationLoading) return
    loadConversations(nextPage, { currentQuery: conversationQuery })
  }


  return (
    <>
      <div className="w-full">
        <div className="flex flex-col gap-2 bg-[#f8fafb] px-4 py-3 md:flex-row md:items-center md:justify-between">
          <form onSubmit={onSubmitConversationSearch} className="flex w-full max-w-md items-center gap-2">
            <input
              type="text"
              value={conversationSearchInput}
              onChange={(event) => setConversationSearchInput(event.target.value)}
              placeholder="Search conversation user"
              className="h-8 flex-1 rounded-md border border-[#d5dde2] bg-white px-3 text-xs outline-none focus:border-[#1aa34a]"
            />
            <button type="submit" className="rounded-md bg-[#25d366] px-3 py-1.5 text-xs font-semibold text-white">
              Search
            </button>
          </form>
          <div className="flex items-center justify-between gap-2 md:justify-end">
            <p className="text-xs text-[#667781]">Showing {conversations.length} / {conversationTotal}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadConversations(conversationPage, { preserveScroll: true, keepVisible: true })}
              disabled={conversationLoading || conversationRefreshing}
              className={`transition-all duration-300 ${conversationRefreshing ? 'scale-[1.02] shadow-[0_10px_24px_-18px_rgba(17,27,33,0.55)]' : ''}`}
            >
              <span className="inline-flex items-center gap-1">
                <RefreshCw size={13} className={`refresh-spring-icon ${conversationRefreshing ? 'is-refreshing' : ''}`} />
                {conversationRefreshing ? 'Refreshing...' : 'Refresh'}
              </span>
            </Button>
          </div>
        </div>

        <div ref={conversationListScrollRef} className="w-full">
          {conversationLoading && conversations.length === 0 ? (
            <div className="px-4 py-4 text-sm text-[#667781]">Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <div className="px-4 py-4 text-sm text-[#667781]">No conversation assignment found yet.</div>
          ) : (
            <>
              <div className="space-y-3 p-2.5 md:hidden">
                {conversations.map((conversation) => {
                  const externalUser = conversation.externalUser || {}
                  const assignedUser = conversation.assignedToUser || {}
                  const teamCandidates = getTeamCandidates(conversation)
                  const isForwardOpen = Number(openForwardFor) === Number(conversation.externalUserId)

                  return (
                    <div key={conversation.id} className="rounded-2xl border border-[#e6edf2] bg-[#fcfdff] p-3 shadow-[0_14px_32px_-28px_rgba(17,27,33,0.45)]">
                      <div className="space-y-3">
                        <div>
                          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[#738491]">User</p>
                          <button
                            type="button"
                            onClick={() => openConversationMessages(conversation)}
                            className="mt-1 flex w-full items-center gap-2 rounded-xl bg-white/70 p-2 text-left transition hover:bg-[#eef4fa]"
                          >
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[#d0d7db]">
                              {externalUser.profileMediaUrl ? (
                                <img src={externalUser.profileMediaUrl} alt={externalUser.username || 'User'} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-[#30424f]">
                                  {getInitials(externalUser.username)}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-[#1f2c34]">{externalUser.username || `User #${conversation.externalUserId}`}</p>
                            </div>
                          </button>
                        </div>

                        <div className="relative">
                          <div className="flex items-center justify-between gap-2 px-1">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#738491]">{getTeamLabel(assignedUser.role, assignedUser.canHandleExternalChat)}</p>
                            <span className="rounded-full bg-[#eef4fa] px-2 py-0.5 text-[10px] font-semibold text-[#51636f]">
                              {teamCandidates.length} candidates
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleForwardMenu(conversation.externalUserId)}
                            className="mt-1 flex w-full items-center gap-2 rounded-xl bg-white/70 p-2 text-left transition hover:bg-[#eef4fa]"
                          >
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[#d0d7db]">
                              {assignedUser.profileMediaUrl ? (
                                <img src={assignedUser.profileMediaUrl} alt={assignedUser.username || 'Team'} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-[#30424f]">
                                  {getInitials(assignedUser.username)}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-[#1f2c34]">{assignedUser.username || `User #${conversation.assignedToUserId}`}</p>
                              <p className="text-[11px] text-[#6f808b]">{isForwardOpen ? 'Tap a teammate below to forward' : 'Tap to forward conversation'}</p>
                            </div>
                          </button>

                          {isForwardOpen ? (
                            <ForwardDropdown
                              conversation={conversation}
                              candidates={teamCandidates}
                              query={forwardQueryByExternalId[conversation.externalUserId] || ''}
                              setQuery={(value) =>
                                setForwardQueryByExternalId((prev) => ({ ...prev, [conversation.externalUserId]: value }))
                              }
                              selectedId={forwardToByExternalId[conversation.externalUserId]}
                              onPick={(candidate) => {
                                setForwardToByExternalId((prev) => ({ ...prev, [conversation.externalUserId]: String(candidate.id) }))
                                forwardConversation(conversation.externalUserId, candidate.id)
                                setForwardQueryByExternalId((prev) => ({ ...prev, [conversation.externalUserId]: '' }))
                                setOpenForwardFor(null)
                              }}
                              isSaving={savingConversationId === conversation.externalUserId}
                              align="right"
                            />
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-[#7b8b95]">
                        Last active: {formatRelativeTime(conversation.lastMessageAt || conversation.lastMessage?.createdAt)}
                      </p>
                      <div className="mt-3 flex flex-col gap-2 min-[380px]:flex-row">
                        <button
                          type="button"
                          onClick={() => openConversationMessages(conversation)}
                          disabled={savingConversationId === conversation.externalUserId || deletingConversationId === conversation.externalUserId}
                          className="flex-1 rounded-lg bg-[#111b21] px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => requestDeleteConversation(conversation.externalUserId, externalUser.username || `User #${conversation.externalUserId}`)}
                          disabled={savingConversationId === conversation.externalUserId || deletingConversationId === conversation.externalUserId}
                          className="flex-1 rounded-lg bg-[#cf294f] px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-60 flex items-center justify-center gap-1"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

                      <table className="hidden min-w-[980px] w-full text-left md:table">
                <thead className="sticky top-0 z-10 bg-[#f8fafb]">
                  <tr className="border-b border-[#edf1f4] text-xs font-semibold uppercase tracking-wide text-[#5f6f79]">
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Team Member</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Last Active</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((conversation) => {
                    const externalUser = conversation.externalUser || {}
                    const assignedUser = conversation.assignedToUser || {}
                    const teamCandidates = getTeamCandidates(conversation)
                    const isForwardOpen = Number(openForwardFor) === Number(conversation.externalUserId)

                    return (
                      <tr key={conversation.id} className="border-b border-[#edf1f4] align-top last:border-b-0">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openConversationMessages(conversation)}
                            className="flex w-full items-center gap-2 rounded-md p-1 text-left transition hover:bg-[#eef4fa]"
                          >
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[#d0d7db]">
                              {externalUser.profileMediaUrl ? (
                                <img src={externalUser.profileMediaUrl} alt={externalUser.username || 'User'} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-[#30424f]">
                                  {getInitials(externalUser.username)}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-[#1f2c34]">{externalUser.username || `User #${conversation.externalUserId}`}</p>
                            </div>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => toggleForwardMenu(conversation.externalUserId)}
                              className="flex w-full items-center gap-2 rounded-md p-1 text-left transition hover:bg-[#eef4fa]"
                            >
                              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[#d0d7db]">
                                {assignedUser.profileMediaUrl ? (
                                  <img src={assignedUser.profileMediaUrl} alt={assignedUser.username || 'Team'} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-[#30424f]">
                                    {getInitials(assignedUser.username)}
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-[#1f2c34]">{assignedUser.username || `User #${conversation.assignedToUserId}`}</p>
                              </div>
                            </button>

                            {isForwardOpen ? (
                              <ForwardDropdown
                                conversation={conversation}
                                candidates={teamCandidates}
                                query={forwardQueryByExternalId[conversation.externalUserId] || ''}
                                setQuery={(value) =>
                                  setForwardQueryByExternalId((prev) => ({ ...prev, [conversation.externalUserId]: value }))
                                }
                                selectedId={forwardToByExternalId[conversation.externalUserId]}
                                onPick={(candidate) => {
                                  setForwardToByExternalId((prev) => ({ ...prev, [conversation.externalUserId]: String(candidate.id) }))
                                  forwardConversation(conversation.externalUserId, candidate.id)
                                  setForwardQueryByExternalId((prev) => ({ ...prev, [conversation.externalUserId]: '' }))
                                  setOpenForwardFor(null)
                                }}
                                isSaving={savingConversationId === conversation.externalUserId}
                                align="left"
                              />
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-[#edf3ff] px-2.5 py-1 text-xs font-semibold text-[#1d4ed8]">{getTeamLabel(assignedUser.role, assignedUser.canHandleExternalChat)}</span>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-[#5a6b76]">
                          {formatRelativeTime(conversation.lastMessageAt || conversation.lastMessage?.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => openConversationMessages(conversation)}
                              disabled={savingConversationId === conversation.externalUserId || deletingConversationId === conversation.externalUserId}
                              className="rounded-md bg-[#111b21] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDeleteConversation(conversation.externalUserId, externalUser.username || `User #${conversation.externalUserId}`)}
                              disabled={savingConversationId === conversation.externalUserId || deletingConversationId === conversation.externalUserId}
                              className="rounded-md bg-[#cf294f] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60 flex items-center gap-1"
                            >
                              <Trash2 size={14} />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center gap-2 pb-4">
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious onClick={() => goToPage(conversationPage - 1)} disabled={conversationLoading || conversationPage <= 1} />
            </PaginationItem>
            {pageItems.map((item) =>
              typeof item === 'number' ? (
                <PaginationItem key={`conversation-page-${item}`}>
                  <PaginationLink onClick={() => goToPage(item)} isActive={item === conversationPage}>
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
              <PaginationNext onClick={() => goToPage(conversationPage + 1)} disabled={conversationLoading || !conversationHasMore} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
        <p className="text-xs text-[#54656f]">Page {conversationPage} of {totalPages}</p>
      </div>
    </>
  )
}

export default AdminConversationsPanel
