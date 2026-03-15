import { RefreshCw } from 'lucide-react'
import { formatDateTime, messagePreview } from './adminApi'

function AdminConversationsPanel({
  conversations,
  conversationTotal,
  conversationPage,
  conversationHasMore,
  conversationLoading,
  loadConversations,
  conversationListScrollRef,
  me,
  teamMembers,
  forwardToByExternalId,
  setForwardToByExternalId,
  openConversationMessages,
  forwardConversation,
  savingConversationId,
}) {
  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-[#e1e7eb] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#edf1f4] bg-[#f8fafb] px-4 py-3">
          <p className="text-sm font-semibold text-[#1f2c34]">All Conversations (Admin View)</p>
          <div className="flex items-center gap-2">
            <p className="text-xs text-[#667781]">
              Showing {conversations.length} / {conversationTotal}
            </p>
            <button
              type="button"
              onClick={() => loadConversations(conversationPage)}
              disabled={conversationLoading}
              className="rounded-md border border-[#d5dde2] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f2c34] disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-1">
                <RefreshCw size={13} />
                Refresh
              </span>
            </button>
          </div>
        </div>

        <div ref={conversationListScrollRef} className="max-h-[calc(100dvh-260px)] w-full overflow-auto">
          {conversationLoading ? (
            <div className="px-4 py-4 text-sm text-[#667781]">Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <div className="px-4 py-4 text-sm text-[#667781]">No conversation assignment found yet.</div>
          ) : (
            <table className="min-w-[1080px] w-full text-left">
              <thead className="sticky top-0 z-10 bg-[#f8fafb]">
                <tr className="border-b border-[#edf1f4] text-xs font-semibold uppercase tracking-wide text-[#5f6f79]">
                  <th className="px-4 py-3">External User</th>
                  <th className="px-4 py-3">Assigned To</th>
                  <th className="px-4 py-3">Last Message</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Forward To</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((conversation) => {
                  const mergedCandidates = [...teamMembers]
                  if (me && (me.role === 'admin' || me.role === 'model_admin' || me.canHandleExternalChat)) {
                    const exists = mergedCandidates.some((item) => Number(item.id) === Number(me.id))
                    if (!exists) mergedCandidates.push(me)
                  }
                  const teamCandidates = mergedCandidates
                    .filter((u) => Number(u.id) !== Number(conversation.externalUserId))
                    .sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')))

                  return (
                    <tr key={conversation.id} className="border-b border-[#edf1f4] align-top last:border-b-0">
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-[#1f2c34]">
                          {conversation.externalUser?.username || `External #${conversation.externalUserId}`}
                        </p>
                        <p className="text-xs text-[#667781]">{conversation.externalUser?.uniqueUsername || '-'}</p>
                        <p className="text-[11px] text-[#7b8b95]">ID: {conversation.externalUserId}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-[#1f2c34]">
                          {conversation.assignedToUser?.username || `User #${conversation.assignedToUserId}`}
                        </p>
                        <p className="text-xs text-[#667781]">{conversation.assignedToUser?.uniqueUsername || '-'}</p>
                        <p className="text-[11px] text-[#7b8b95]">ID: {conversation.assignedToUserId}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-[280px] truncate text-sm text-[#1f2c34]">{messagePreview(conversation.lastMessage)}</p>
                        <p className="text-[11px] text-[#7b8b95]">
                          {conversation.lastMessage?.createdAt ? formatDateTime(conversation.lastMessage.createdAt) : '-'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-[#1f2c34]">{Number(conversation.totalMessages || 0)}</td>
                      <td className="px-4 py-3">
                        <select
                          value={forwardToByExternalId[conversation.externalUserId] || ''}
                          onChange={(event) =>
                            setForwardToByExternalId((prev) => ({
                              ...prev,
                              [conversation.externalUserId]: event.target.value,
                            }))
                          }
                          className="h-9 w-full min-w-[240px] rounded-md border border-[#d5dde2] bg-white px-2 text-xs text-[#1f2c34] outline-none focus:border-[#1aa34a]"
                        >
                          <option value="">Select user to forward</option>
                          {teamCandidates.map((candidate) => (
                            <option key={`fwd-${conversation.id}-${candidate.id}`} value={candidate.id}>
                              {candidate.username} ({candidate.uniqueUsername || candidate.id})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openConversationMessages(conversation)}
                            className="rounded-md border border-[#d5dde2] bg-white px-3 py-2 text-xs font-semibold text-[#1f2c34]"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => forwardConversation(conversation.externalUserId)}
                            disabled={savingConversationId === conversation.externalUserId || !forwardToByExternalId[conversation.externalUserId]}
                            className="rounded-md border border-[#d5dde2] bg-white px-3 py-2 text-xs font-semibold text-[#1f2c34] disabled:opacity-60"
                          >
                            {savingConversationId === conversation.externalUserId ? 'Forwarding...' : 'Forward'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => loadConversations(Math.max(1, conversationPage - 1))}
          disabled={conversationLoading || conversationPage <= 1}
          className="rounded-lg border border-[#d5dde2] bg-white px-4 py-2 text-sm font-semibold text-[#1f2c34] disabled:opacity-50"
        >
          Previous
        </button>
        <p className="text-sm text-[#54656f]">Conversation Page {conversationPage}</p>
        <button
          type="button"
          onClick={() => loadConversations(conversationPage + 1)}
          disabled={conversationLoading || !conversationHasMore}
          className="rounded-lg border border-[#d5dde2] bg-white px-4 py-2 text-sm font-semibold text-[#1f2c34] disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </>
  )
}

export default AdminConversationsPanel
