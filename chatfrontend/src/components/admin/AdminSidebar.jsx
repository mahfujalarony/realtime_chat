import { Shield, Users, MessagesSquare } from 'lucide-react'
import { Button } from '../ui/button'

function AdminSidebar({ me, total, conversationTotal, activePanel, onSelectPanel, consoleTitle = 'Admin Console' }) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Shield },
    { id: 'users', label: 'User List', icon: Users },
    { id: 'conversations', label: 'Conversations', icon: MessagesSquare },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-2">
        <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
          <img src="/logo.png" alt="Chat logo" className="h-full w-full object-cover" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1f2c34]">{consoleTitle}</p>
          <p className="text-xs text-[#667781]">{me?.username || 'admin'}</p>
        </div>
      </div>

      <div className="mt-5 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activePanel === item.id
          return (
            <Button
              key={item.id}
              type="button"
              variant={isActive ? 'secondary' : 'ghost'}
              size="default"
              onClick={() => onSelectPanel(item.id)}
              className={`h-10 w-full justify-start gap-2 rounded-lg px-3 text-sm ${
                isActive ? 'bg-[#eaf2ff] text-[#1d4ed8] hover:bg-[#e1edff]' : 'text-[#1f2c34]'
              }`}
            >
              <Icon size={16} />
              {item.label}
            </Button>
          )
        })}
      </div>

      <div className="mt-auto rounded-xl bg-[#f3f6f8] p-3">
        <p className="text-xs font-medium text-[#667781]">Quick Stats</p>
        <p className="mt-1 text-sm font-semibold text-[#1f2c34]">Users: {total}</p>
        <p className="text-sm font-semibold text-[#1f2c34]">Conversations: {conversationTotal}</p>
      </div>
    </div>
  )
}

export default AdminSidebar
