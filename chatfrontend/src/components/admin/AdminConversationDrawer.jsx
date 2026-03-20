import { Download, FileText } from 'lucide-react'

import { formatRelativeTime, messagePreview } from './adminApi'
import { Button } from '../ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet'

const API_URL = import.meta.env.VITE_API_URL || ''
const UPLOAD_SERVER_URL = import.meta.env.VITE_UPLOAD_SERVER_URL || ''

function resolveMediaUrl(rawUrl = '') {
  const raw = String(rawUrl || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('//')) return `${window.location.protocol}${raw}`

  const preferredBase = String(UPLOAD_SERVER_URL || API_URL || window.location.origin || '').trim()
  if (!preferredBase) return raw
  try {
    return new URL(raw, preferredBase).toString()
  } catch {
    return raw
  }
}

function getTeamLabel(user) {
  const role = String(user?.role || 'user').toLowerCase()
  if (role === 'admin') return 'Admin'
  if (role === 'model_admin') return 'Model Admin'
  if (user?.canHandleExternalChat) return 'Agent'
  return 'User'
}

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
    <Sheet open={Boolean(viewingConversation)} onOpenChange={(open) => { if (!open) closeConversationMessages() }}>
      <SheetContent side="right" className="w-full p-0 sm:max-w-4xl">
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-[#edf1f4] px-4 py-4 pr-14">
            <SheetHeader>
              <SheetTitle>
                {viewingConversation.externalUser?.username || `External #${viewingConversation.externalUserId}`} {'->'}{' '}
                {viewingConversation.assignedToUser?.username || `User #${viewingConversation.assignedToUserId}`}
              </SheetTitle>
              <SheetDescription>Total: {viewingTotal} messages</SheetDescription>
            </SheetHeader>
          </div>

          <div className="border-b border-[#edf1f4] bg-[#f8fafb] px-4 py-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={noteDraftByExternalId[viewingConversation.externalUserId] || ''}
                onChange={(event) =>
                  setNoteDraftByExternalId((prev) => ({ ...prev, [viewingConversation.externalUserId]: event.target.value }))
                }
                placeholder="Note"
                className="h-9 flex-1 rounded-lg border border-[#d5dde2] bg-white px-3 text-xs outline-none focus:border-[#1aa34a]"
              />
              <Button
                type="button"
                onClick={() => saveNote(viewingConversation.externalUserId)}
                disabled={savingConversationId === viewingConversation.externalUserId}
                className="bg-[#25d366] text-white hover:bg-[#1fab53]"
                size="sm"
              >
                {savingConversationId === viewingConversation.externalUserId ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>

          <div ref={viewingScrollRef} onScroll={onViewingScroll} className="flex-1 overflow-y-auto bg-[#efeae2] px-3 py-3 md:px-4">
            {viewingLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map((item) => {
                  const isLeft = item % 2 === 0
                  return (
                    <div key={`skeleton-${item}`} className={`flex ${isLeft ? 'justify-start' : 'justify-end'}`}>
                      <div className={`w-[78%] rounded-xl px-3 py-2 shadow-sm md:w-[62%] ${isLeft ? 'bg-white/90' : 'bg-[#d9fdd3]/80'}`}>
                        <div className="h-3.5 w-20 animate-pulse rounded bg-[#d9e2e7]" />
                        <div className="mt-2 h-3.5 w-full animate-pulse rounded bg-[#d9e2e7]" />
                        <div className="mt-1.5 h-3.5 w-4/5 animate-pulse rounded bg-[#d9e2e7]" />
                        <div className="mt-2 h-3 w-24 animate-pulse rounded bg-[#d9e2e7]" />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : viewingMessages.length === 0 ? (
              <p className="text-sm text-[#667781]">No messages found.</p>
            ) : (
              <div className="space-y-2">
                {viewingMessages.map((message) => {
                  const isExternal = Number(message.senderId) === Number(viewingConversation.externalUserId)
                  const senderName = isExternal
                    ? (message.sender?.username || viewingConversation.externalUser?.username || 'External user')
                    : (message.sender?.username || 'Team member')
                  const senderLabel = isExternal ? 'External user' : `${senderName} - ${getTeamLabel(message.sender)}`
                  const mediaUrl = resolveMediaUrl(message.mediaUrl)

                  return (
                    <div key={message.id} className={`flex ${isExternal ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs shadow-sm md:max-w-[70%] ${isExternal ? 'bg-white text-[#1f2c34]' : 'bg-[#d9fdd3] text-[#1f2c34]'}`}>
                        {message.messageType === 'image' && mediaUrl ? (
                          <a href={mediaUrl} target="_blank" rel="noreferrer" className="mb-2 block">
                            <img src={mediaUrl} alt={message.mediaOriginalName || 'Image'} loading="lazy" className="max-h-56 w-auto max-w-full rounded-md object-cover" />
                          </a>
                        ) : null}

                        {message.messageType === 'video' && mediaUrl ? (
                          <video src={mediaUrl} controls preload="metadata" className="mb-2 max-h-64 w-full rounded-md bg-black" />
                        ) : null}

                        {message.messageType === 'audio' && mediaUrl ? (
                          <audio src={mediaUrl} controls preload="metadata" className="mb-2 w-full" />
                        ) : null}

                        {message.messageType === 'file' && mediaUrl ? (
                          <a
                            href={mediaUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mb-2 flex items-center gap-2 rounded-md border border-[#d5dde2] bg-white/70 px-2.5 py-2 text-[#1f2c34] hover:bg-white"
                          >
                            <FileText size={14} />
                            <span className="min-w-0 flex-1 truncate">{message.mediaOriginalName || 'Download file'}</span>
                            <Download size={14} />
                          </a>
                        ) : null}

                        <p className="whitespace-pre-wrap break-words">{message.text || messagePreview(message)}</p>
                        <p className="mt-1 text-[11px] text-[#667781]">
                          {senderLabel} | {formatRelativeTime(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-[#edf1f4] bg-[#f8fafb] px-4 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadViewingPage(viewingConversation, viewingPage + 1, true)}
              disabled={viewingLoading || !viewingHasMore}
            >
              Older
            </Button>
            <p className="text-xs text-[#667781]">Page {viewingPage}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadViewingPage(viewingConversation, Math.max(1, viewingPage - 1), true)}
              disabled={viewingLoading || viewingPage <= 1}
            >
              Newer
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default AdminConversationDrawer
