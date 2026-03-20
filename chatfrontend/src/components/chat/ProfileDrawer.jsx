function ProfileDrawer({ activeChat, currentUser, isProfileOpen, closeProfile, getInitials, onToggleBlockUser, blockingUserId }) {
  if (!activeChat) return null
  const canBlock = Boolean(currentUser?.role === 'admin' || currentUser?.role === 'model_admin' || currentUser?.canBlockUsers)
  const isBlocking = Number(blockingUserId) === Number(activeChat.id)
  const isBlocked = Boolean(activeChat?.isBlockedByMe)
  const hasBlockedMe = Boolean(activeChat?.hasBlockedMe)
  const canShowBlockAction = canBlock && (!hasBlockedMe || isBlocked)
  const infoItems = [
    { label: 'Name', value: activeChat.username || '-' },
    { label: 'Username', value: activeChat.uniqueUsername || 'Not set' },
    { label: 'Mobile Number', value: activeChat.mobileNumber || 'Not set' },
    { label: 'Email', value: activeChat.email || 'Not set' },
    {
      label: 'Date of Birth',
      value: activeChat.dateOfBirth
        ? new Date(activeChat.dateOfBirth).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : 'Not set',
    },
  ]

  return (
    <section
      className={`absolute inset-y-0 right-0 z-20 w-full overflow-y-auto bg-white shadow-lg transition-all duration-300 ease-out md:w-[520px] md:border-l md:border-[#e4e4e4] ${
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
        <p className="mt-2 text-sm text-[#667781]">{activeChat.uniqueUsername || activeChat.mobileNumber || activeChat.email || 'No contact detail'}</p>
      </div>

      <div className="border-t border-[#ececec] px-4 py-4">
        {hasBlockedMe ? (
          <div className="mb-3 rounded-xl border border-[#ffd7df] bg-[#fff4f6] px-4 py-3 text-left text-sm font-medium text-[#a12d4a]">
            This user blocked you. You cannot message them until they unblock you.
          </div>
        ) : null}
        <div className="space-y-3">
          {infoItems.map((item) => (
            <div key={item.label} className="rounded-xl bg-[#f8fafb] px-4 py-3 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#667781]">{item.label}</p>
              <p className="mt-1 break-words text-sm font-medium text-[#1f2c34]">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {canShowBlockAction ? (
        <div className="border-t border-[#ececec] px-4 py-4">
          <button
            type="button"
            onClick={() => onToggleBlockUser?.(activeChat)}
            disabled={isBlocking}
            className={`w-full rounded-xl px-4 py-3 text-left text-sm font-semibold transition disabled:opacity-60 ${
              isBlocked
                ? 'border border-[#d4ead9] bg-[#eefbf1] text-[#12813b] hover:bg-[#e2f7e7]'
                : 'border border-[#ffd7df] bg-[#fff3f6] text-[#cc1744] hover:bg-[#ffe7ee]'
            }`}
          >
            {isBlocking ? `${isBlocked ? 'Unblocking' : 'Blocking'} ${activeChat.username}...` : `${isBlocked ? 'Unblock' : 'Block'} ${activeChat.username}`}
          </button>
        </div>
      ) : null}
    </section>
  )
}

export default ProfileDrawer
