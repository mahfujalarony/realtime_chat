function ConfirmDialog({ confirmAction, setConfirmAction, runConfirmAction }) {
  if (!confirmAction) return null

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
        <p className="text-base font-semibold text-[#1f2c34]">
          {confirmAction.type === 'delete_message'
            ? 'Delete this message?'
            : confirmAction.type === 'clear_chat'
              ? 'Clear this chat?'
              : confirmAction.type === 'delete_chat'
                ? 'Delete this chat?'
                : 'Logout now?'}
        </p>
        <p className="mt-2 text-sm text-[#667781]">
          {confirmAction.type === 'delete_message'
            ? 'This message will be removed.'
            : confirmAction.type === 'clear_chat'
              ? 'All messages in this conversation will be removed.'
              : confirmAction.type === 'delete_chat'
                ? 'Chat and contact will be removed from your list.'
                : 'You will be signed out from this device.'}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmAction(null)}
            className="rounded-md border border-[#d7dce0] px-3 py-1.5 text-sm text-[#1f2c34]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={runConfirmAction}
            className="rounded-md bg-[#cc1744] px-3 py-1.5 text-sm font-semibold text-white"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
