import { formatDateTime, messagePreview } from './adminApi'

function AdminConversationDrawer({
  viewingConversation,
  closeConversationMessages,
  viewingTotal,
  noteDraftByExternalId,
  setNoteDraftByExternalId,
  saveNote,
  savingConversationId,
  viewingScrollRef,
  onViewingScroll,
  viewingLoading,
  viewingMessages,
  viewingPage,
  viewingHasMore,
  loadViewingPage,
}) {
  if (!viewingConversation) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/35" onClick={closeConversationMessages}>
      <div
        className="absolute inset-x-0 bottom-0 mx-auto flex h-[82dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-[#e2e8f0] bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-[#d5dde2]" />
        <div className="flex items-center justify-between border-b border-[#edf1f4] px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#1f2c34]">
              {viewingConversation.externalUser?.username || `External #${viewingConversation.externalUserId}`} {'->'}{' '}
              {viewingConversation.assignedToUser?.username || `User #${viewingConversation.assignedToUserId}`}
            </p>
            <p className="mt-0.5 text-xs text-[#667781]">Total: {viewingTotal} messages</p>
          </div>
          <button
            type="button"
            onClick={closeConversationMessages}
            className="rounded-md border border-[#d5dde2] px-3 py-1.5 text-xs font-semibold text-[#1f2c34]"
          >
            Close
          </button>
        </div>
        <div className="border-b border-[#edf1f4] bg-[#f8fafb] px-4 py-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <input
              type="text"
              value={noteDraftByExternalId[viewingConversation.externalUserId] || ''}
              onChange={(event) =>
                setNoteDraftByExternalId((prev) => ({ ...prev, [viewingConversation.externalUserId]: event.target.value }))
              }
              placeholder="Admin note for this conversation"
              className="h-9 flex-1 rounded-md border border-[#d5dde2] bg-white px-3 text-xs outline-none focus:border-[#1aa34a]"
            />
            <button
              type="button"
              onClick={() => saveNote(viewingConversation.externalUserId)}
              disabled={savingConversationId === viewingConversation.externalUserId}
              className="rounded-md bg-[#111b21] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {savingConversationId === viewingConversation.externalUserId ? 'Saving...' : 'Save Note'}
            </button>
          </div>
        </div>

        <div ref={viewingScrollRef} onScroll={onViewingScroll} className="flex-1 overflow-y-auto bg-[#efeae2] px-3 py-3 md:px-4">
          {viewingLoading ? (
            <p className="text-sm text-[#667781]">Loading messages...</p>
          ) : viewingMessages.length === 0 ? (
            <p className="text-sm text-[#667781]">No messages found.</p>
          ) : (
            <div className="space-y-2">
              {viewingMessages.map((message) => {
                const isExternal = Number(message.senderId) === Number(viewingConversation.externalUserId)
                return (
                  <div key={message.id} className={`flex ${isExternal ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-xs shadow-sm md:max-w-[70%] ${
                        isExternal ? 'bg-white text-[#1f2c34]' : 'bg-[#d9fdd3] text-[#1f2c34]'
                      }`}
                    >
                      <p className="whitespace-pre-wrap wrap-break-word">{messagePreview(message)}</p>
                      <p className="mt-1 text-[11px] text-[#667781]">
                        {isExternal ? 'External user' : 'Agent side'} | {formatDateTime(message.createdAt)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#edf1f4] bg-[#f8fafb] px-4 py-3">
          <button
            type="button"
            onClick={() => loadViewingPage(viewingConversation, viewingPage + 1, true)}
            disabled={viewingLoading || !viewingHasMore}
            className="rounded-md border border-[#d5dde2] bg-white px-3 py-2 text-xs font-semibold text-[#1f2c34] disabled:opacity-50"
          >
            Older Messages
          </button>
          <p className="text-xs text-[#667781]">Page {viewingPage}</p>
          <button
            type="button"
            onClick={() => loadViewingPage(viewingConversation, Math.max(1, viewingPage - 1), true)}
            disabled={viewingLoading || viewingPage <= 1}
            className="rounded-md border border-[#d5dde2] bg-white px-3 py-2 text-xs font-semibold text-[#1f2c34] disabled:opacity-50"
          >
            Newer Messages
          </button>
        </div>
      </div>
    </div>
  )
}

export default AdminConversationDrawer
