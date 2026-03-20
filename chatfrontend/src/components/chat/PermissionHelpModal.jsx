import { Camera, Mic } from 'lucide-react'

function PermissionHelpModal({ permissionHelp, onClose, onRetry }) {
  if (!permissionHelp) return null

  return (
    <div className="absolute inset-0 z-[70] grid place-items-center bg-black/45 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl">
        <p className="text-base font-semibold text-[#1f2c34]">{permissionHelp.title}</p>
        <p className="mt-2 text-sm text-[#54656f]">{permissionHelp.message}</p>
        <div className="mt-3 rounded-lg bg-[#f4f7f9] p-3 text-xs text-[#445762]">
          <p className="font-semibold text-[#1f2c34]">Quick fix</p>
          <p className="mt-1">1.Press browser address bar lock/info icon</p>
          <p>2. Camera and Microphone = Allow</p>
          <p>3. Reload the page and call again</p>
          <p className="mt-1 text-[#667781]">Android: Settings {`>`} Apps {`>`} Chrome {`>`} Permissions</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#d8dde1] px-3 py-2 text-sm text-[#1f2c34]"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-md bg-[#25d366] px-3 py-2 text-sm font-semibold text-white"
          >
            {permissionHelp.callType === 'audio' ? <Mic size={14} /> : <Camera size={14} />}
            Try Again
          </button>
        </div>
      </div>
    </div>
  )
}

export default PermissionHelpModal

