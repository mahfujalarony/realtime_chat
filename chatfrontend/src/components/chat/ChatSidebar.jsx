import { Camera, EllipsisVertical, Search } from 'lucide-react'
import { useRef } from 'react'

function ChatSidebar({
  isMobileChatOpen,
  logout,
  searchQuery,
  setSearchQuery,
  onAddContact,
  contactIdentifier,
  setContactIdentifier,
  addingContact,
  error,
  filteredUsers,
  activeChatId,
  openChat,
  getInitials,
  getLastMessageForUser,
  formatTime,
  uploadingProfile,
  onUploadProfile,
}) {
  const profileInputRef = useRef(null)

  return (
    <aside
      className={`w-full bg-[#f8f8f8] md:max-w-sm md:border-r md:border-[#e4e4e4] ${
        isMobileChatOpen ? 'hidden md:flex md:flex-col' : 'flex flex-col'
      }`}
    >
      <header className="border-b border-[#e4e4e4] bg-[#f8f8f8] px-4 pb-4 pt-3">
        <div className="flex items-center justify-between">
          <h1 className="text-[34px] font-bold leading-none text-[#1faa59]">Chat Web</h1>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-md p-2 text-[#1f2c34] hover:bg-[#eceff1]">
              <Camera size={24} />
            </button>
            <button type="button" className="rounded-md p-2 text-[#1f2c34] hover:bg-[#eceff1]">
              <EllipsisVertical size={24} />
            </button>
            <button type="button" onClick={logout} className="rounded-md px-2 py-1 text-xs font-semibold text-[#54656f] hover:bg-[#eceff1]">
              Logout
            </button>
            <button
              type="button"
              onClick={() => profileInputRef.current?.click()}
              disabled={uploadingProfile}
              className="rounded-md px-2 py-1 text-xs font-semibold text-[#54656f] hover:bg-[#eceff1] disabled:opacity-50"
            >
              {uploadingProfile ? 'Uploading...' : 'Profile'}
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
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-full bg-[#eeeeee] px-4 py-3">
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

      <form onSubmit={onAddContact} className="border-b border-[#e4e4e4] p-3">
        <p className="mb-2 text-xs font-semibold text-[#54656f]">Add Contact (username/email/mobile)</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={contactIdentifier}
            onChange={(e) => setContactIdentifier(e.target.value)}
            placeholder="Enter identifier"
            className="w-full rounded-lg border border-[#e4e4e4] bg-white px-3 py-2 text-sm outline-none placeholder:text-[#7a8b95] focus:border-[#25d366]"
          />
          <button
            type="submit"
            disabled={addingContact}
            className="rounded-lg bg-[#25d366] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {addingContact ? '...' : 'Add'}
          </button>
        </div>
      </form>

      {error ? <p className="m-3 rounded-md bg-red-100 px-3 py-2 text-xs text-red-700">{error}</p> : null}

      <ul className="flex-1 min-h-0 overflow-y-auto">
        {filteredUsers.length === 0 ? (
          <li className="px-4 py-4 text-sm text-[#667781]">No contacts yet. Add a contact first.</li>
        ) : null}
        {filteredUsers.map((chatUser) => {
          const lastMessage = getLastMessageForUser(chatUser.id)
          return (
            <li key={chatUser.id}>
              <button
                type="button"
                onClick={() => openChat(chatUser.id)}
                className={`w-full cursor-pointer border-b border-[#ececec] px-4 py-3 text-left transition ${
                  chatUser.id === activeChatId ? 'bg-[#ebf8f1]' : 'hover:bg-[#f2f3f5]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#d0d7db] text-sm font-semibold text-[#30424f]">
                    {getInitials(chatUser.username)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-[#1f2c34]">{chatUser.username}</p>
                      <p className="text-xs text-[#667781]">{lastMessage ? formatTime(lastMessage.createdAt) : ''}</p>
                    </div>
                    <p className="mt-1 truncate text-sm text-[#667781]">{lastMessage ? lastMessage.text : 'No messages yet'}</p>
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

export default ChatSidebar
