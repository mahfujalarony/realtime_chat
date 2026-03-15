import { Shield, Users, MessagesSquare } from 'lucide-react'

function AdminSidebar({ me, total, conversationTotal, activePanel, onSelectPanel }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#111b21] text-white">
          <Shield size={18} />
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1f2c34]">Admin Console</p>
          <p className="text-xs text-[#667781]">{me?.username || 'admin'}</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <button
          type="button"
          onClick={() => onSelectPanel('dashboard')}
          className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
            activePanel === 'dashboard'
              ? 'border-[#d4e3ff] bg-[#eaf2ff] text-[#1d4ed8]'
              : 'border-[#e7edf2] bg-[#f8fafb] text-[#1f2c34]'
          }`}
        >
          <Shield size={16} />
          Dashboard
        </button>
        <button
          type="button"
          onClick={() => onSelectPanel('users')}
          className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
            activePanel === 'users'
              ? 'border-[#d4e3ff] bg-[#eaf2ff] text-[#1d4ed8]'
              : 'border-[#e7edf2] bg-[#f8fafb] text-[#1f2c34]'
          }`}
        >
          <Users size={16} />
          User List
        </button>
        <button
          type="button"
          onClick={() => onSelectPanel('conversations')}
          className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
            activePanel === 'conversations'
              ? 'border-[#d4e3ff] bg-[#eaf2ff] text-[#1d4ed8]'
              : 'border-[#e7edf2] bg-[#f8fafb] text-[#1f2c34]'
          }`}
        >
          <MessagesSquare size={16} />
          Conversations
        </button>
        <button
          type="button"
          onClick={() => onSelectPanel('access')}
          className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
            activePanel === 'access'
              ? 'border-[#d4e3ff] bg-[#eaf2ff] text-[#1d4ed8]'
              : 'border-[#e7edf2] bg-[#f8fafb] text-[#1f2c34]'
          }`}
        >
          <Users size={16} />
          Make Model Admin / Agent
        </button>
      </div>

      <div className="mt-4 space-y-2 rounded-xl border border-[#e7edf2] bg-[#f8fafb] p-3">
        <p className="text-xs font-medium text-[#667781]">Quick Stats</p>
        <p className="text-sm font-semibold text-[#1f2c34]">Users: {total}</p>
        <p className="text-sm font-semibold text-[#1f2c34]">Conversations: {conversationTotal}</p>
      </div>
    </>
  )
}

export default AdminSidebar
