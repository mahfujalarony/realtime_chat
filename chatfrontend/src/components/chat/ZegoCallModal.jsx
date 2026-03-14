import { useEffect, useRef, useState } from 'react'
import { Mic, PhoneOff, Video } from 'lucide-react'

const ZEGO_WEB_SDK_URL = 'https://unpkg.com/@zegocloud/zego-uikit-prebuilt/zego-uikit-prebuilt.js'

function loadZegoScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('Window not available'))
    if (window.ZegoUIKitPrebuilt) return resolve(window.ZegoUIKitPrebuilt)

    const existing = document.querySelector('script[data-zego-sdk="1"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.ZegoUIKitPrebuilt))
      existing.addEventListener('error', () => reject(new Error('Failed to load ZEGO SDK')))
      return
    }

    const script = document.createElement('script')
    script.src = ZEGO_WEB_SDK_URL
    script.async = true
    script.dataset.zegoSdk = '1'
    script.onload = () => resolve(window.ZegoUIKitPrebuilt)
    script.onerror = () => reject(new Error('Failed to load ZEGO SDK'))
    document.body.appendChild(script)
  })
}

function ZegoCallModal({
  open,
  onClose,
  appId,
  serverSecret,
  roomId,
  userId,
  userName,
  callType = 'video',
  peerUser = null,
  callStatus = 'connecting',
}) {
  const containerRef = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    if (!appId || !serverSecret || !roomId || !userId) {
      setError('ZEGO config missing. Set VITE_ZEGO_APP_ID and VITE_ZEGO_SERVER_SECRET.')
      return
    }

    let instance = null
    let canceled = false

    ;(async () => {
      try {
        setError('')
        const ZegoUIKitPrebuilt = await loadZegoScript()
        if (canceled || !containerRef.current) return

        const kitToken = ZegoUIKitPrebuilt.generateKitTokenForTest(
          Number(appId),
          String(serverSecret),
          String(roomId),
          String(userId),
          String(userName || 'User'),
        )
        instance = ZegoUIKitPrebuilt.create(kitToken)
        instance.joinRoom({
          container: containerRef.current,
          scenario: { mode: ZegoUIKitPrebuilt.OneONoneCall },
          turnOnMicrophoneWhenJoining: true,
          turnOnCameraWhenJoining: callType !== 'audio',
          showTextChat: false,
          showScreenSharingButton: false,
          onLeaveRoom: onClose,
          onReturnToHomeScreenClicked: onClose,
        })
      } catch (sdkError) {
        setError(sdkError?.message || 'Failed to start call')
      }
    })()

    return () => {
      canceled = true
      try {
        instance?.destroy()
      } catch {
        // no-op
      }
    }
  }, [open, appId, serverSecret, roomId, userId, userName, callType, onClose])

  if (!open) return null

  const statusText =
    callStatus === 'ringing'
      ? 'Ringing...'
      : callStatus === 'connected'
        ? 'Connected'
        : 'Connecting...'

  return (
    <div className="absolute inset-0 z-50 overflow-hidden bg-[#0b141a]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-[#233138] text-sm font-semibold text-[#d9fdd3]">
            {peerUser?.profileMediaUrl ? (
              <img src={peerUser.profileMediaUrl} alt={peerUser?.username || 'User'} className="h-full w-full object-cover" />
            ) : (
              String(peerUser?.username || 'U').slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-white">{peerUser?.username || 'Calling...'}</p>
            <div className="flex items-center gap-2 text-xs text-[#d1d7db]">
              <span className={callStatus === 'connected' ? 'h-2 w-2 rounded-full bg-[#25d366]' : 'h-2 w-2 animate-pulse rounded-full bg-[#ffbf47]'} />
              <span>{statusText}</span>
              <span className="text-[#9ca8b0]">•</span>
              <span className="inline-flex items-center gap-1 capitalize">
                {callType === 'audio' ? <Mic size={13} /> : <Video size={13} />}
                {callType} call
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute right-3 top-3 z-30">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-2 rounded-full bg-[#f15c6d] px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-[#dc4b5d]"
        >
          <PhoneOff size={14} />
          End
        </button>
      </div>
      {error ? (
        <div className="grid h-full place-items-center p-4">
          <div className="rounded-lg bg-white px-4 py-3 text-sm text-[#cc1744]">{error}</div>
        </div>
      ) : (
        <>
          <div ref={containerRef} className="h-full w-full" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/65 to-transparent px-5 pb-7 pt-14">
            <div className="mx-auto h-1.5 w-16 rounded-full bg-white/40" />
          </div>
        </>
      )}
    </div>
  )
}

export default ZegoCallModal
