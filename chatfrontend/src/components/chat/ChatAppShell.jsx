import ChatSidebar from './ChatSidebar'
import ChatPanel from './ChatPanel'
import ProfileDrawer from './ProfileDrawer'
import ConfirmDialog from './ConfirmDialog'
import PermissionHelpModal from './PermissionHelpModal'
import OutgoingCallOverlay from './OutgoingCallOverlay'
import IncomingCallOverlay from './IncomingCallOverlay'
import ZegoCallModal from './ZegoCallModal'

function ChatAppShell({
  portalBadgeLabel,
  isMobileChatOpen,
  currentUser,
  refreshCurrentUser,
  requestLogout,
  searchQuery,
  setSearchQuery,
  onAddContact,
  lookupContact,
  contactIdentifier,
  setContactIdentifier,
  addingContact,
  uploadingProfile,
  uploadProfileMedia,
  updateOwnProfileNote,
  error,
  filteredUsers,
  activeConversation,
  openConversation,
  getInitials,
  getLastMessageForUser,
  formatTime,
  formatLastSeen,
  startDirectCall,
  startCallToUser,
  loadMoreSidebarData,
  loadingMoreSidebar,
  backToList,
  activeChat,
  activeConversationType,
  isProfileOpen,
  setIsProfileOpen,
  toggleBlockUser,
  blockingUserId,
  exportConversationPdf,
  canExportConversation,
  messageListRef,
  activeMessages,
  activeConversationNote,
  activeConversationCanEditNote,
  saveActiveConversationNote,
  requestDeleteMessage,
  requestDeleteMessages,
  reactToMessage,
  draftMessage,
  setDraftMessage,
  sendMessage,
  sendMedia,
  pickMediaFiles,
  pendingMedia,
  removePendingMedia,
  clearPendingMedia,
  sendPendingMedia,
  uploadingMedia,
  activePaginationMeta,
  loadOlderMessages,
  markConversationSeen,
  confirmAction,
  setConfirmAction,
  runConfirmAction,
  permissionHelp,
  closePermissionHelp,
  retryPermissionCheck,
  outgoingCall,
  cancelOutgoingCall,
  incomingCall,
  acceptIncomingCall,
  rejectIncomingCall,
  activeCall,
  endActiveCall,
  ZEGO_APP_ID,
  ZEGO_SERVER_SECRET,
}) {
  return (
    <main className="h-dvh overflow-hidden bg-[#e8dfd6] p-0">
      {portalBadgeLabel ? (
        <div className="pointer-events-none absolute right-3 top-3 z-40 rounded-full bg-[#111b21] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
          {portalBadgeLabel} Route
        </div>
      ) : null}
      <section className="relative flex h-full w-full overflow-hidden bg-white">
        <ChatSidebar
          isMobileChatOpen={isMobileChatOpen}
          currentUser={currentUser}
          refreshCurrentUser={refreshCurrentUser}
          logout={requestLogout}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onAddContact={onAddContact}
          lookupContact={lookupContact}
          contactIdentifier={contactIdentifier}
          setContactIdentifier={setContactIdentifier}
          addingContact={addingContact}
          uploadingProfile={uploadingProfile}
          onUploadProfile={uploadProfileMedia}
          onUpdateProfileNote={updateOwnProfileNote}
          error={error}
          filteredUsers={filteredUsers}
          activeConversation={activeConversation}
          openConversation={openConversation}
          getInitials={getInitials}
          getLastMessageForUser={getLastMessageForUser}
          formatTime={formatTime}
          formatLastSeen={formatLastSeen}
          onQuickAudioCall={(chatUser) => startCallToUser(chatUser, 'audio')}
          onQuickVideoCall={(chatUser) => startCallToUser(chatUser, 'video')}
          onReachListEnd={loadMoreSidebarData}
          loadingMoreSidebar={loadingMoreSidebar}
        />

        <ChatPanel
          isMobileChatOpen={isMobileChatOpen}
          backToList={backToList}
          activeChat={activeChat}
          activeConversationType={activeConversationType}
          groupMemberNames={{}}
          openProfile={() => setIsProfileOpen(true)}
          startAudioCall={() => startDirectCall('audio')}
          startVideoCall={() => startDirectCall('video')}
          getInitials={getInitials}
          exportConversationPdf={exportConversationPdf}
          canExportConversation={canExportConversation}
          messageListRef={messageListRef}
          activeMessages={activeMessages}
          currentUser={currentUser}
          formatTime={formatTime}
          formatLastSeen={formatLastSeen}
          isBlockedByMe={Boolean(activeChat?.isBlockedByMe)}
          hasBlockedMe={Boolean(activeChat?.hasBlockedMe)}
          activeConversationNote={activeConversationNote}
          activeConversationCanEditNote={activeConversationCanEditNote}
          saveActiveConversationNote={saveActiveConversationNote}
          requestDeleteMessage={requestDeleteMessage}
          requestDeleteMessages={requestDeleteMessages}
          reactToMessage={reactToMessage}
          draftMessage={draftMessage}
          setDraftMessage={setDraftMessage}
          sendMessage={sendMessage}
          sendMedia={sendMedia}
          onPickMediaFiles={pickMediaFiles}
          pendingMedia={pendingMedia}
          removePendingMedia={removePendingMedia}
          clearPendingMedia={clearPendingMedia}
          sendPendingMedia={sendPendingMedia}
          uploadingMedia={uploadingMedia}
          hasOlderMessages={Boolean(activePaginationMeta.hasMore)}
          loadingOlderMessages={Boolean(activePaginationMeta.loadingOlder)}
          loadOlderMessages={loadOlderMessages}
          markConversationSeen={markConversationSeen}
        />

        <ProfileDrawer
          activeChat={activeConversationType === 'direct' ? activeChat : null}
          currentUser={currentUser}
          isProfileOpen={isProfileOpen}
          closeProfile={() => setIsProfileOpen(false)}
          getInitials={getInitials}
          onToggleBlockUser={toggleBlockUser}
          blockingUserId={blockingUserId}
        />

        <ConfirmDialog confirmAction={confirmAction} setConfirmAction={setConfirmAction} runConfirmAction={runConfirmAction} />
        <PermissionHelpModal permissionHelp={permissionHelp} onClose={closePermissionHelp} onRetry={retryPermissionCheck} />
        <OutgoingCallOverlay outgoingCall={outgoingCall} onCancel={cancelOutgoingCall} />
        <IncomingCallOverlay incomingCall={incomingCall} onAccept={acceptIncomingCall} onReject={rejectIncomingCall} />

        <ZegoCallModal
          open={Boolean(activeCall && activeCall.status === 'connected')}
          onClose={endActiveCall}
          appId={ZEGO_APP_ID}
          serverSecret={ZEGO_SERVER_SECRET}
          roomId={activeCall?.roomId || ''}
          userId={String(currentUser?.id || '')}
          userName={currentUser?.username || 'User'}
          callType={activeCall?.callType || 'video'}
          peerUser={activeCall?.peerUser || null}
          callStatus={activeCall?.status || 'connecting'}
          callStartedAt={activeCall?.startedAt || null}
        />
      </section>
    </main>
  )
}

export default ChatAppShell
