import { Phone, PhoneOff, Video } from 'lucide-react'

function IncomingCallOverlay({ incomingCall, onAccept, onReject }) {
  if (!incomingCall) return null

  return (
    <div className="absolute inset-0 z-50 overflow-hidden bg-[#0b141a]">
      <div className="absolute inset-0 bg-gradient-to-b from-[#1f2c34] via-[#0f1a20] to-[#0b141a]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(37,211,102,0.2),transparent_38%),radial-gradient(circle_at_80%_70%,rgba(0,168,132,0.18),transparent_42%)]" />
      <div className="relative z-10 flex h-full flex-col items-center justify-between px-6 pb-10 pt-14">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.18em] text-[#d1d7db]">Incoming {incomingCall.callType || 'video'} call</p>
          <div className="mx-auto mt-6 flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-white/25 bg-[#233138] text-3xl font-semibold text-[#d9fdd3]">
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
          <p className="mt-4 text-2xl font-semibold text-white">{incomingCall.fromUser?.username || 'Unknown user'}</p>
          <p className="mt-1 text-sm text-[#d1d7db]">Tap to answer</p>
        </div>

        <div className="mb-20 flex w-full items-center justify-center gap-12 sm:mb-4 sm:gap-16">
          <button
            type="button"
            onClick={onReject}
            className="group flex w-24 flex-col items-center gap-3 text-white"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#f15c6d] shadow-lg transition group-hover:scale-105">
              <PhoneOff size={28} />
            </span>
            <span className="text-sm text-[#d1d7db]">Decline</span>
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="group flex w-24 flex-col items-center gap-3 text-white"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#25d366] shadow-lg transition group-hover:scale-105">
              {String(incomingCall.callType || 'video') === 'audio' ? <Phone size={28} /> : <Video size={28} />}
            </span>
            <span className="text-sm text-[#d1d7db]">Accept</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default IncomingCallOverlay

