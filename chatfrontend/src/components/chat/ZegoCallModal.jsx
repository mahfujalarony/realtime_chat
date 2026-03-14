import { useEffect, useRef, useState } from 'react'

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
          showPreJoinView: false,
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

  return (
    <div className="zego-call-mobile-fix fixed inset-0 z-[90] overflow-hidden bg-[#0b141a]">
      {error ? (
        <div className="grid h-full place-items-center p-4">
          <div className="rounded-lg bg-white px-4 py-3 text-sm text-[#cc1744]">{error}</div>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="zego-call-mobile-fix h-[100dvh] w-screen overflow-hidden pb-[max(8px,env(safe-area-inset-bottom))]"
        />
      )}
    </div>
  )
}

export default ZegoCallModal
