function ProfileDrawer({ activeChat, isProfileOpen, closeProfile, getInitials }) {
  if (!activeChat) return null

  return (
    <section
      className={`absolute inset-y-0 right-0 z-20 w-full bg-white shadow-lg transition-all duration-300 ease-out md:w-[520px] md:border-l md:border-[#e4e4e4] ${
        isProfileOpen
          ? 'translate-x-0 opacity-100'
          : 'pointer-events-none translate-x-full opacity-0'
      }`}
    >
      <header className="flex items-center gap-3 border-b border-[#e4e4e4] px-4 py-3">
        <button type="button" onClick={closeProfile} className="text-xl text-[#1f2c34]">
          x
        </button>
        <p className="text-xl text-[#1f2c34]">Contact info</p>
      </header>

      <div className="p-6 text-center">
        {activeChat.profileMediaUrl ? (
          <img
            src={activeChat.profileMediaUrl}
            alt={activeChat.username}
            className="mx-auto h-32 w-32 rounded-full object-cover"
          />
        ) : (
          <div className="mx-auto flex h-32 w-32 items-center justify-center rounded-full bg-black text-3xl font-semibold text-white">
            {getInitials(activeChat.username)}
          </div>
        )}
        <p className="mt-4 text-xl font-semibold text-[#111b21]">{activeChat.username}</p>
        <p className="mt-2 text-sm text-[#667781]">{activeChat.mobileNumber || activeChat.email || 'No contact detail'}</p>
      </div>

      <div className="border-t border-[#ececec] px-4 py-3">
        <p className="text-[#111b21]">Media, links and docs</p>
      </div>
      <div className="border-t border-[#ececec] px-4 py-3">
        <p className="text-[#cc1744]">Block {activeChat.username}</p>
      </div>
      <div className="border-t border-[#ececec] px-4 py-3">
        <p className="text-[#cc1744]">Report {activeChat.username}</p>
      </div>
    </section>
  )
}

export default ProfileDrawer
