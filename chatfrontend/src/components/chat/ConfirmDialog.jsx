import { Button } from '../ui/button'

function ConfirmDialog({ confirmAction, setConfirmAction, runConfirmAction }) {
  if (!confirmAction) return null

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/35 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-sm rounded-2xl border border-[#e4e7eb] bg-white p-4 shadow-2xl">
        <p className="text-base font-semibold text-[#1f2c34]">
          {confirmAction.type === 'delete_message'
            ? 'Delete this message?'
            : confirmAction.type === 'delete_messages'
              ? `Delete ${Array.isArray(confirmAction.messageIds) ? confirmAction.messageIds.length : 0} messages?`
              : 'Logout now?'}
        </p>
        <p className="mt-2 text-sm text-[#667781]">
          {confirmAction.type === 'delete_message'
            ? 'This message will be removed.'
            : confirmAction.type === 'delete_messages'
              ? 'Selected messages will be removed.'
              : 'You will be signed out from this device.'}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setConfirmAction(null)} className="h-9 px-3 text-sm">
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={runConfirmAction} className="h-9 px-3 text-sm">
            Confirm
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
