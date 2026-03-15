function AdminAccessPanel({
  accessIdentifier,
  setAccessIdentifier,
  findAccessUser,
  accessLoading,
  accessResultUser,
  accessAssignType,
  setAccessAssignType,
  applyAccessFromFinder,
  updatingId,
  manageableTeamMembers,
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#e1e7eb] bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-[#1f2c34]">Find User By Email / Mobile / Unique ID</p>
        <div className="mt-3 flex flex-col gap-2 md:flex-row">
          <input
            type="text"
            value={accessIdentifier}
            onChange={(event) => setAccessIdentifier(event.target.value)}
            placeholder="example@mail.com / 017xxxx / unique_username"
            className="h-10 flex-1 rounded-lg border border-[#d5dde2] px-3 text-sm outline-none focus:border-[#1aa34a]"
          />
          <button
            type="button"
            onClick={findAccessUser}
            disabled={accessLoading}
            className="h-10 rounded-lg bg-[#111b21] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {accessLoading ? 'Searching...' : 'Find'}
          </button>
        </div>

        {accessResultUser ? (
          <div className="mt-4 rounded-xl border border-[#e8edf1] bg-[#f8fafb] p-3">
            <p className="text-sm font-semibold text-[#1f2c34]">{accessResultUser.username}</p>
            <p className="text-xs text-[#667781]">{accessResultUser.uniqueUsername || '-'}</p>
            <p className="mt-1 text-xs text-[#667781]">{accessResultUser.email || accessResultUser.mobileNumber || '-'}</p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-[#1f2c34]">
                <input
                  type="radio"
                  name="accessAssignType"
                  checked={accessAssignType === 'model_admin'}
                  onChange={() => setAccessAssignType('model_admin')}
                />
                Make Model Admin
              </label>
              <label className="flex items-center gap-2 text-sm text-[#1f2c34]">
                <input
                  type="radio"
                  name="accessAssignType"
                  checked={accessAssignType === 'agent'}
                  onChange={() => setAccessAssignType('agent')}
                />
                Make Agent User
              </label>
            </div>
            <button
              type="button"
              onClick={applyAccessFromFinder}
              disabled={updatingId === accessResultUser.id}
              className="mt-3 rounded-lg bg-[#25d366] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {updatingId === accessResultUser.id ? 'Saving...' : 'Apply Access'}
            </button>
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#e1e7eb] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#edf1f4] bg-[#f8fafb] px-4 py-3">
          <p className="text-sm font-semibold text-[#1f2c34]">Model Admin + Agent Users</p>
          <p className="text-xs text-[#667781]">Total: {manageableTeamMembers.length}</p>
        </div>
        {manageableTeamMembers.length === 0 ? (
          <div className="px-4 py-4 text-sm text-[#667781]">No model admin or agent user found.</div>
        ) : (
          manageableTeamMembers.map((member) => (
            <div key={`access-${member.id}`} className="border-b border-[#edf1f4] px-4 py-3 last:border-b-0">
              <p className="text-sm font-semibold text-[#1f2c34]">{member.username}</p>
              <p className="text-xs text-[#667781]">{member.uniqueUsername || '-'}</p>
              <p className="mt-1 text-xs text-[#667781]">{member.role === 'model_admin' ? 'Model Admin' : 'Agent User'}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default AdminAccessPanel
