import { PhoneOff } from 'lucide-react'

function OutgoingCallOverlay({ outgoingCall, onCancel }) {
  if (!outgoingCall) return null

  return (
    <div className="call-overlay absolute inset-0 z-50 overflow-hidden bg-[#0b141a]">
      <div className="absolute inset-0 bg-gradient-to-b from-[#1f2c34] via-[#0f1a20] to-[#0b141a]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_25%,rgba(37,211,102,0.22),transparent_38%),radial-gradient(circle_at_82%_75%,rgba(0,168,132,0.18),transparent_42%)]" />
      <div className="relative z-10 flex h-full flex-col items-center justify-between px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))] sm:px-6 sm:pt-14">
        <div className="w-full max-w-sm text-center">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#d1d7db] sm:text-xs">
            {outgoingCall.status === 'ringing' ? 'Ringing...' : 'Calling...'}
          </p>
          <div className="mx-auto mt-4 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-white/25 bg-[#233138] text-3xl font-semibold text-[#d9fdd3] sm:mt-6 sm:h-28 sm:w-28">
            {outgoingCall.peerUser?.profileMediaUrl ? (
              <img
                src={outgoingCall.peerUser.profileMediaUrl}
                alt={outgoingCall.peerUser?.username || 'User'}
                className="h-full w-full object-cover"
              />
            ) : (
              String(outgoingCall.peerUser?.username || 'U').slice(0, 1).toUpperCase()
            )}
          </div>
          <p className="mt-3 line-clamp-2 break-words px-2 text-xl font-semibold text-white sm:mt-4 sm:text-2xl">{outgoingCall.peerUser?.username || 'User'}</p>
          <p className="mt-1 text-xs text-[#d1d7db] sm:text-sm">
            {outgoingCall.callType === 'audio' ? 'Audio call' : 'Video call'}
          </p>
          <div className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border border-white/20 bg-black/25 px-3 py-1.5 text-[11px] text-[#d1d7db] sm:text-xs">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#ffbf47]" />
            <span className="truncate">
              {outgoingCall.status === 'ringing'
                ? 'Other side phone is ringing'
                : 'Sending call request'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="group flex flex-col items-center gap-2 text-white sm:gap-3"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f15c6d] shadow-[0_10px_24px_rgba(241,92,109,0.45)] transition group-hover:scale-105 sm:h-16 sm:w-16">
            <PhoneOff size={24} className="sm:size-7" />
          </span>
          <span className="rounded-full bg-black/25 px-3 py-1 text-xs text-[#d1d7db] sm:text-sm">Cancel</span>
        </button>
      </div>
    </div>
  )
}

export default OutgoingCallOverlay
