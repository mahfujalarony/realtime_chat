import { ArrowLeft, Camera, EllipsisVertical, LogOut, MessageCirclePlus, Phone, Search, UserPlus, Users, Video } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

function ChatSidebar({
  isMobileChatOpen,
  currentUser,
  logout,
  searchQuery,
  setSearchQuery,
  onAddContact,
  lookupContact,
  contactIdentifier,
  setContactIdentifier,
  addingContact,
  uploadingProfile,
  onUploadProfile,
  error,
  filteredUsers,
  activeConversation,
  openConversation,
  getInitials,
  getLastMessageForUser,
  formatTime,
  formatLastSeen,
  onQuickAudioCall,
  onQuickVideoCall,
  onReachListEnd,
  loadingMoreSidebar,
}) {
  const [isAddContactOpen, setIsAddContactOpen] = useState(false)
  const [isMyProfileOpen, setIsMyProfileOpen] = useState(false)
  const newChatInputRef = useRef(null)
  const profileInputRef = useRef(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupResult, setLookupResult] = useState(null)
  const [lookupMessage, setLookupMessage] = useState('')

  const openAddContactScreen = () => {
    setIsMyProfileOpen(false)
    setIsAddContactOpen(true)
  }

  const openMyProfileScreen = () => {
    setIsAddContactOpen(false)
    setIsMyProfileOpen(true)
  }

  useEffect(() => {
    if (!isAddContactOpen) {
      setLookupLoading(false)
      setLookupResult(null)
      setLookupMessage('')
      return
    }

    const identifier = contactIdentifier.trim()
    if (!identifier) {
      setLookupLoading(false)
      setLookupResult(null)
      setLookupMessage('')
      return
    }

    let canceled = false
    const timer = setTimeout(async () => {
      try {
        setLookupLoading(true)
        setLookupMessage('')
        const result = await lookupContact(identifier)
        if (canceled) return
        setLookupResult(result)
      } catch (lookupError) {
        if (canceled) return
        setLookupResult(null)
        setLookupMessage(lookupError?.message || 'No user found')
      } finally {
        if (!canceled) setLookupLoading(false)
      }
    }, 320)

    return () => {
      canceled = true
      clearTimeout(timer)
    }
  }, [contactIdentifier, isAddContactOpen, lookupContact])

  const handleAddContactSubmit = async (event) => {
    const response = await onAddContact(event)
    if (response?.ok) {
      setIsAddContactOpen(false)
      setLookupResult(null)
      setLookupMessage('')
    }
  }

  const handleLookupAction = async () => {
    if (!lookupResult?.user || lookupResult?.isSelf) return
    if (lookupResult?.alreadyContact) {
      setIsAddContactOpen(false)
      await openConversation({ type: 'direct', id: lookupResult.user.id })
      return
    }
    const response = await onAddContact()
    if (response?.ok) {
      setIsAddContactOpen(false)
      setLookupResult(null)
      setLookupMessage('')
    }
  }

  const isActiveConversation = (type, id) => activeConversation?.type === type && Number(activeConversation?.id) === Number(id)
  const isInternalUser = currentUser?.role === 'admin' || currentUser?.role === 'model_admin' || currentUser?.canHandleExternalChat

  return (
    <aside
      className={`relative w-full bg-[#f8f8f8] md:max-w-sm md:border-r md:border-[#e4e4e4] ${
        isMobileChatOpen ? 'hidden md:flex md:flex-col' : 'flex flex-col'
      }`}
    >
      <header className="border-b border-[#dce4e8] bg-[#f0f2f5] px-4 pb-4 pt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={openMyProfileScreen}
              className="group relative h-10 w-10 overflow-hidden rounded-full border border-[#d5dde2] bg-[#d0d7db]"
              title="My profile"
              aria-label="My profile"
            >
              {currentUser?.profileMediaUrl ? (
                <img
                  src={currentUser.profileMediaUrl}
                  alt={currentUser.username || 'Profile'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-[#30424f]">
                  {getInitials(currentUser?.username || 'You')}
                </span>
              )}
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#1f2c34]">{currentUser?.username || 'My Profile'}</p>
              <p className="truncate text-[11px] text-[#667781]">Chats</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={openAddContactScreen}
              className="rounded-full p-2 text-[#54656f] transition hover:bg-[#e6eaed]"
              title="New chat"
              aria-label="New chat"
            >
              <Users size={19} />
            </button>
            <button type="button" className="rounded-full p-2 text-[#54656f] transition hover:bg-[#e6eaed]">
              <EllipsisVertical size={19} />
            </button>
            <button
              type="button"
              onClick={logout}
              className="rounded-full p-2 text-[#54656f] transition hover:bg-[#ffe9ec] hover:text-[#cc1744]"
              title="Logout"
              aria-label="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-full border border-[#25d366] bg-[#eeeeee] px-4 py-3 focus-within:border-[#20b85b] focus-within:ring-1 focus-within:ring-[#20b85b]">
          <Search size={22} className="text-[#65747e]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full border-none bg-transparent text-[14px] text-[#2f3a42] outline-none placeholder:text-[#8b98a1]"
          />
        </div>
      </header>

      {error ? <p className="m-3 rounded-md bg-red-100 px-3 py-2 text-xs text-red-700">{error}</p> : null}

      <ul
        className="flex-1 min-h-0 overflow-y-auto bg-[#f4f6f8] px-2 pb-2"
        onScroll={(event) => {
          const el = event.currentTarget
          const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 120
          if (nearBottom) onReachListEnd?.()
        }}
      >
        <li className="px-3 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[#667781]">Direct chats</li>
        {filteredUsers.length === 0 ? (
          <li className="px-4 py-2">
            <div className="rounded-xl border border-[#e3e9ec] bg-[#f7fbfd] p-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-[#dff6e9] text-[#0f8d4a]">
                  <MessageCirclePlus size={16} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#1f2c34]">Start your first chat</p>
                  <p className="mt-0.5 text-xs text-[#667781]">Add a contact and send a message.</p>
                  <button
                    type="button"
                    onClick={openAddContactScreen}
                    className="mt-2 rounded-md bg-[#25d366] px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-[#1fab53]"
                  >
                    New chat
                  </button>
                </div>
              </div>
            </div>
          </li>
        ) : null}
        {filteredUsers.map((chatUser) => {
          const lastMessage = getLastMessageForUser(chatUser.id)
          return (
            <li key={`direct-${chatUser.id}`} className="px-1 py-1.5">
              <div
                className={`rounded-2xl border px-3 py-3 shadow-[0_1px_2px_rgba(17,27,33,0.04)] transition ${
                  isActiveConversation('direct', chatUser.id)
                    ? 'border-[#b8e9cc] bg-[#ebf8f1]'
                    : 'border-[#e3e9ed] bg-white hover:bg-[#f7fafc]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => openConversation({ type: 'direct', id: chatUser.id })}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                  <div className="h-11 w-11 overflow-hidden rounded-full bg-[#d0d7db]">
                    {chatUser.profileMediaUrl ? (
                      <img
                        src={chatUser.profileMediaUrl}
                        alt={chatUser.username}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-[#30424f]">
                        {getInitials(chatUser.username)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-[#1f2c34]">{chatUser.username}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-[#667781]">{lastMessage ? formatTime(lastMessage.createdAt) : ''}</p>
                        {Number(chatUser.unreadCount) > 0 ? (
                          <span className="rounded-full bg-[#25d366] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            {chatUser.unreadCount}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-1 truncate text-sm text-[#667781]">
                      {lastMessage ? lastMessage.text || lastMessage.messageType : 'No messages yet'}
                    </p>
                    <p className={`mt-0.5 text-[11px] ${chatUser.isOnline ? 'text-[#1fa855]' : 'text-[#8696a0]'}`}>
                      {chatUser.isOnline ? 'online' : formatLastSeen(chatUser.lastSeen)}
                    </p>
                  </div>
                  </button>
                  <div className="mt-1 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onQuickAudioCall?.(chatUser)
                      }}
                      className="rounded-full p-1.5 text-[#54656f] transition hover:bg-[#e7ecef]"
                      title="Audio call"
                      aria-label={`Audio call ${chatUser.username}`}
                    >
                      <Phone size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onQuickVideoCall?.(chatUser)
                      }}
                      className="rounded-full p-1.5 text-[#54656f] transition hover:bg-[#e7ecef]"
                      title="Video call"
                      aria-label={`Video call ${chatUser.username}`}
                    >
                      <Video size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </li>
          )
        })}

      </ul>

      {loadingMoreSidebar ? (
        <div className="border-t border-[#e7ecef] px-4 py-2 text-center text-[11px] text-[#667781]">Loading more chats...</div>
      ) : null}

      {isAddContactOpen ? (
        <section className="absolute inset-0 z-30 bg-white">
          <header className="flex items-center gap-4 border-b border-[#e4e4e4] bg-white px-4 py-4 text-[#111b21]">
            <button
              type="button"
              onClick={() => setIsAddContactOpen(false)}
              className="rounded-full p-1 transition hover:bg-[#f1f4f6]"
              aria-label="Back"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <p className="text-base font-semibold">New chat</p>
              <p className="text-xs text-[#667781]">Add by username / unique id / email / mobile</p>
            </div>
          </header>

          <form onSubmit={handleAddContactSubmit} className="space-y-4 p-4">
            <div className="flex items-center gap-3 rounded-full border-2 border-[#25d366] bg-white px-4 py-2.5">
              <Search size={20} className="text-[#7b8b95]" />
              <input
                ref={newChatInputRef}
                type="text"
                value={contactIdentifier}
                onChange={(e) => setContactIdentifier(e.target.value)}
                placeholder={isInternalUser ? 'Search external user by id/number' : 'Enter agent unique id / number'}
                className="w-full border-none bg-transparent px-0 py-0 text-sm outline-none placeholder:text-[#6f7f89]"
                autoFocus
              />
            </div>
            <p className="px-1 text-[11px] text-[#6b7a84]">
              {isInternalUser
                ? 'Press Enter to connect with the matched external user.'
                : 'Press Enter to connect with the matched agent.'}
            </p>
          </form>

          <div className="space-y-2 px-4">
            <button
              type="button"
              onClick={() => newChatInputRef.current?.focus()}
              className="flex w-full items-center gap-4 rounded-lg px-2 py-2.5 text-left transition hover:bg-[#f4f6f8]"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#25d366] text-white">
                <UserPlus size={20} />
              </span>
              <span className="text-lg font-medium text-[#111b21]">New contact</span>
            </button>
          </div>

          <div className="px-5 pt-3">
            {lookupLoading ? <p className="text-xs text-[#667781]">Searching user...</p> : null}
            {!lookupLoading && lookupResult?.isSelf ? (
              <p className="text-xs text-[#667781]">This is your own account.</p>
            ) : null}
            {!lookupLoading && lookupResult?.user && !lookupResult?.isSelf ? (
              <div className="rounded-lg border border-[#e1e7eb] bg-[#f8fbfd] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-[#667781]">This person is available on chat.</p>
                    <div className="mt-2 flex min-w-0 items-center gap-3">
                      <div className="h-11 w-11 overflow-hidden rounded-full bg-[#d0d7db]">
                        {lookupResult.user.profileMediaUrl ? (
                          <img
                            src={lookupResult.user.profileMediaUrl}
                            alt={lookupResult.user.username}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-[#30424f]">
                            {getInitials(lookupResult.user.username)}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#1f2c34]">{lookupResult.user.username}</p>
                        <p className="truncate text-[11px] text-[#667781]">{lookupResult.user.uniqueUsername || ''}</p>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleLookupAction}
                    disabled={addingContact}
                    className="shrink-0 rounded-md bg-[#25d366] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {addingContact ? 'Please wait...' : lookupResult.alreadyContact ? 'Send message' : 'Add contact'}
                  </button>
                </div>
              </div>
            ) : null}
            {!lookupLoading && !lookupResult?.user && lookupMessage ? (
              <p className="text-xs text-[#667781]">{lookupMessage}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {isMyProfileOpen ? (
        <section className="absolute inset-0 z-40 bg-[#f0f2f5]">
          <header className="flex items-center gap-4 bg-[#008069] px-4 py-4 text-white">
            <button
              type="button"
              onClick={() => setIsMyProfileOpen(false)}
              className="rounded-full p-1 transition hover:bg-white/15"
              aria-label="Back"
            >
              <ArrowLeft size={20} />
            </button>
            <p className="text-base font-semibold">Profile</p>
          </header>

          <div className="p-5">
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <div className="relative mx-auto h-36 w-36">
                <div className="h-full w-full overflow-hidden rounded-full bg-[#d0d7db]">
                  {currentUser?.profileMediaUrl ? (
                    <img
                      src={currentUser.profileMediaUrl}
                      alt={currentUser?.username || 'Profile'}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-4xl font-semibold text-[#30424f]">
                      {getInitials(currentUser?.username || 'You')}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => profileInputRef.current?.click()}
                  disabled={uploadingProfile}
                  className="absolute bottom-0 right-0 z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-[#25d366] text-white shadow-lg transition hover:bg-[#1fab53] disabled:opacity-60"
                  aria-label="Change profile picture"
                  title="Change profile picture"
                >
                  <Camera size={17} />
                </button>
                <input
                  ref={profileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) onUploadProfile(file)
                    e.target.value = ''
                  }}
                />
              </div>
              <p className="mt-4 text-center text-xs text-[#667781]">
                {uploadingProfile ? 'Uploading profile photo...' : 'Tap camera icon to change photo'}
              </p>
            </div>

            <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-[#667781]">Name</p>
              <p className="mt-1 text-base font-semibold text-[#1f2c34]">{currentUser?.username || '-'}</p>
            </div>

            <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-[#667781]">Email</p>
              <p className="mt-1 text-sm font-medium text-[#1f2c34]">{currentUser?.email || 'Not set'}</p>
            </div>

            <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-[#667781]">Mobile Number</p>
              <p className="mt-1 text-sm font-medium text-[#1f2c34]">{currentUser?.mobileNumber || 'Not set'}</p>
            </div>
          </div>
        </section>
      ) : null}
    </aside>
  )
}

export default ChatSidebar
