import { Phone, PhoneOff, Video } from 'lucide-react'

function IncomingCallOverlay({ incomingCall, onAccept, onReject }) {
  if (!incomingCall) return null

  return (
    <div className="call-overlay absolute inset-0 z-50 overflow-hidden bg-[#0b141a]">
      <div className="absolute inset-0 bg-gradient-to-b from-[#1f2c34] via-[#0f1a20] to-[#0b141a]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(37,211,102,0.2),transparent_38%),radial-gradient(circle_at_80%_70%,rgba(0,168,132,0.18),transparent_42%)]" />
      <div className="relative z-10 flex h-full flex-col items-center justify-between px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))] sm:px-6 sm:pt-14">
        <div className="w-full max-w-sm text-center">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#d1d7db] sm:text-xs">Incoming {incomingCall.callType || 'video'} call</p>
          <div className="mx-auto mt-4 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-white/25 bg-[#233138] text-3xl font-semibold text-[#d9fdd3] sm:mt-6 sm:h-28 sm:w-28">
            {incomingCall.fromUser?.profileMediaUrl ? (
              <img
                src={incomingCall.fromUser.profileMediaUrl}
                alt={incomingCall.fromUser?.username || 'Unknown user'}
                className="h-full w-full object-cover"
              />
            ) : (
              String(incomingCall.fromUser?.username || 'U').slice(0, 1).toUpperCase()
            )}
          </div>
          <p className="mt-3 line-clamp-2 break-words px-2 text-xl font-semibold text-white sm:mt-4 sm:text-2xl">{incomingCall.fromUser?.username || 'Unknown user'}</p>
          <p className="mt-1 text-xs text-[#d1d7db] sm:text-sm">Tap to answer</p>
        </div>

        <div className="call-overlay-actions flex w-full max-w-sm items-center justify-center gap-8 sm:gap-16">
          <button
            type="button"
            onClick={onReject}
            className="group flex min-w-0 flex-1 flex-col items-center gap-2 text-white sm:flex-none sm:gap-3"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f15c6d] shadow-lg transition group-hover:scale-105 sm:h-16 sm:w-16">
              <PhoneOff size={24} className="sm:size-7" />
            </span>
            <span className="text-xs text-[#d1d7db] sm:text-sm">Decline</span>
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="group flex min-w-0 flex-1 flex-col items-center gap-2 text-white sm:flex-none sm:gap-3"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#25d366] shadow-lg transition group-hover:scale-105 sm:h-16 sm:w-16">
              {String(incomingCall.callType || 'video') === 'audio' ? <Phone size={24} className="sm:size-7" /> : <Video size={24} className="sm:size-7" />}
            </span>
            <span className="text-xs text-[#d1d7db] sm:text-sm">Accept</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default IncomingCallOverlay
