import { ArrowLeft, Download, FileText, Loader2, Maximize2, Mic, Paperclip, Pause, Play, Square, Trash2, UsersRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const AUDIO_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '00:00'
  const s = Math.floor(totalSeconds)
  const minutes = Math.floor(s / 60)
  const seconds = s % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function pickSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  return AUDIO_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function ViewportMedia({ className = '', placeholderClassName = '', rootMargin = '220px', children }) {
  const hostRef = useRef(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (isVisible) return
    const node = hostRef.current
    if (!node) return

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { root: null, rootMargin, threshold: 0.01 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [isVisible, rootMargin])

  return (
    <div ref={hostRef} className={className}>
      {isVisible ? children(true) : <div className={placeholderClassName} />}
    </div>
  )
}

function AudioMessageBubble({ url, fallbackDurationSec }) {
  const audioRef = useRef(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(Number.isFinite(Number(fallbackDurationSec)) ? Number(fallbackDurationSec) : 0)

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0

  const onLoadedMetadata = () => {
    const el = audioRef.current
    if (!el) return
    if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration)
    setIsLoading(false)
  }

  const onTimeUpdate = () => {
    const el = audioRef.current
    if (!el) return
    setCurrentTime(el.currentTime || 0)
  }

  const onPlay = () => {
    const currentEl = audioRef.current
    if (!currentEl) return
    const allPlayers = document.querySelectorAll('audio[data-chat-audio="1"]')
    allPlayers.forEach((node) => {
      if (node !== currentEl) node.pause()
    })
    setIsPlaying(true)
  }

  const onPause = () => setIsPlaying(false)

  const onSeek = (event) => {
    const el = audioRef.current
    if (!el) return
    const nextTime = Number(event.target.value)
    if (!Number.isFinite(nextTime)) return
    el.currentTime = nextTime
    setCurrentTime(nextTime)
  }

  const togglePlay = async () => {
    const el = audioRef.current
    if (!el) return
    try {
      if (el.paused) {
        await el.play()
      } else {
        el.pause()
      }
    } catch {
      setIsPlaying(false)
    }
  }

  return (
    <div className="mb-1 w-[240px] rounded-lg bg-black/5 px-3 py-2 md:w-[300px]">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        data-chat-audio="1"
        className="hidden"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onPause}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#00a884] text-white transition hover:bg-[#02916f]"
          aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
        >
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <input
          type="range"
          min="0"
          max={safeDuration || 0}
          step="0.1"
          value={Math.min(currentTime, safeDuration || 0)}
          onChange={onSeek}
          disabled={!safeDuration}
          className="h-1 flex-1 cursor-pointer accent-[#00a884]"
          aria-label="Audio seek"
        />
      </div>

      <div className="mt-1 flex items-center justify-between text-[11px] text-[#667781]">
        <span>{formatDuration(currentTime)}</span>
        <span>{formatDuration(safeDuration)}</span>
      </div>
    </div>
  )
}

function ChatPanel({
  isMobileChatOpen,
  backToList,
  activeChat,
  activeConversationType,
  groupMemberNames,
  openProfile,
  getInitials,
  profileMenuOpen,
  setProfileMenuOpen,
  requestClearChat,
  requestDeleteChat,
  messageListRef,
  activeMessages,
  currentUser,
  formatTime,
  formatLastSeen,
  requestDeleteMessage,
  draftMessage,
  setDraftMessage,
  sendMessage,
  sendMedia,
  onPickMediaFiles,
  pendingMedia,
  removePendingMedia,
  clearPendingMedia,
  sendPendingMedia,
  uploadingMedia,
  hasOlderMessages,
  loadingOlderMessages,
  loadOlderMessages,
  markConversationSeen,
}) {
  const mediaInputRef = useRef(null)
  const recorderRef = useRef(null)
  const recordingStreamRef = useRef(null)
  const recordingTimerRef = useRef(null)
  const recordingSecondsRef = useRef(0)
  const audioChunksRef = useRef([])
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordingError, setRecordingError] = useState('')
  const [previewMedia, setPreviewMedia] = useState(null)
  const seenCheckRafRef = useRef(null)
  const lastScrollTopRef = useRef(0)
  const ignoreOlderLoadUntilRef = useRef(0)

  const cleanupStream = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
    }
    recorderRef.current = null
    audioChunksRef.current = []
    recordingSecondsRef.current = 0
    setRecordingSeconds(0)
    setIsRecording(false)
  }

  useEffect(() => {
    return () => {
      if (seenCheckRafRef.current) {
        cancelAnimationFrame(seenCheckRafRef.current)
        seenCheckRafRef.current = null
      }
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      cleanupStream()
    }
  }, [])

  const maybeMarkSeenWhenLastVisible = () => {
    if (activeConversationType !== 'direct') return
    if (!activeChat?.id || typeof markConversationSeen !== 'function') return

    const hasUnseenIncoming = activeMessages.some(
      (message) => Number(message.senderId) === Number(activeChat.id) && !message.seen && typeof message.id !== 'string',
    )
    if (!hasUnseenIncoming) return

    const listEl = messageListRef?.current
    if (!listEl) return

    const lastServerMessage = [...activeMessages].reverse().find((message) => typeof message.id !== 'string')
    if (!lastServerMessage) return

    const rawMessageId = String(lastServerMessage.id)
    const escapedMessageId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(rawMessageId)
      : rawMessageId.replace(/"/g, '\\"')
    const lastMessageEl = listEl.querySelector(`[data-message-id="${escapedMessageId}"]`)
    if (!lastMessageEl) return

    const listRect = listEl.getBoundingClientRect()
    const messageRect = lastMessageEl.getBoundingClientRect()
    const isVisibleInViewport = messageRect.top >= listRect.top && messageRect.bottom <= listRect.bottom
    if (!isVisibleInViewport) return

    markConversationSeen(activeChat.id)
  }

  useEffect(() => {
    if (activeConversationType !== 'direct') return
    if (seenCheckRafRef.current) cancelAnimationFrame(seenCheckRafRef.current)
    seenCheckRafRef.current = requestAnimationFrame(() => maybeMarkSeenWhenLastVisible())
    return () => {
      if (seenCheckRafRef.current) {
        cancelAnimationFrame(seenCheckRafRef.current)
        seenCheckRafRef.current = null
      }
    }
  }, [activeChat?.id, activeMessages, activeConversationType])

  useEffect(() => {
    // After switching chats, give UI time to auto-scroll to bottom before enabling top-load.
    lastScrollTopRef.current = 0
    ignoreOlderLoadUntilRef.current = Date.now() + 900
  }, [activeChat?.id, activeConversationType])

  useEffect(() => {
    const listEl = messageListRef?.current
    if (!listEl) return
    const onScroll = () => {
      const currentTop = listEl.scrollTop
      const isGoingUp = currentTop < lastScrollTopRef.current
      lastScrollTopRef.current = currentTop

      if (activeConversationType === 'direct') {
        maybeMarkSeenWhenLastVisible()
      }
      if (
        isGoingUp &&
        currentTop <= 80 &&
        hasOlderMessages &&
        !loadingOlderMessages &&
        Date.now() > ignoreOlderLoadUntilRef.current
      ) {
        loadOlderMessages?.()
      }
    }
    listEl.addEventListener('scroll', onScroll, { passive: true })
    return () => listEl.removeEventListener('scroll', onScroll)
  }, [activeChat?.id, activeMessages, messageListRef, activeConversationType, hasOlderMessages, loadingOlderMessages, loadOlderMessages])

  const startRecording = async () => {
    if (isRecording || uploadingMedia) return
    setRecordingError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecordingError('Voice recording is not supported in this browser')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      const mimeType = pickSupportedAudioMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recordingStreamRef.current = stream
      recorderRef.current = recorder
      audioChunksRef.current = []
      recordingSecondsRef.current = 0
      setRecordingSeconds(0)
      setIsRecording(true)

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        const preferredType = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, { type: preferredType })
        const durationSec = recordingSecondsRef.current
        cleanupStream()
        if (blob.size < 2048 || durationSec <= 0) {
          setRecordingError('Record was too short. Please try again.')
          return
        }
        const extension = preferredType.includes('ogg') ? 'ogg' : preferredType.includes('mp4') ? 'm4a' : 'webm'
        const audioFile = new File([blob], `voice-${Date.now()}.${extension}`, { type: preferredType })
        await sendMedia(audioFile, { mediaDurationSec: durationSec })
      }
      recorder.onerror = () => {
        cleanupStream()
        setRecordingError('Recording failed. Please allow microphone and retry.')
      }
      recorder.start(250)
      recordingTimerRef.current = setInterval(() => {
        recordingSecondsRef.current += 1
        setRecordingSeconds(recordingSecondsRef.current)
      }, 1000)
    } catch {
      cleanupStream()
      setRecordingError('Microphone permission denied or unavailable')
    }
  }

  const stopRecording = () => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getFileName = (url, originalName) => {
    if (originalName) return originalName
    try {
      const pathname = new URL(url).pathname
      return pathname.split('/').pop() || 'file'
    } catch {
      return 'file'
    }
  }

  const openMediaPreview = (message) => {
    if (!message?.mediaUrl) return
    if (message.messageType !== 'image' && message.messageType !== 'video') return
    setPreviewMedia({
      url: message.mediaUrl,
      type: message.messageType,
      name: message.mediaOriginalName || message.messageType,
    })
  }

  const isAlbumMedia = (message) =>
    Boolean(message?.mediaGroupId) && (message?.messageType === 'image' || message?.messageType === 'video')

  const getAlbumItemsFromIndex = (startIndex) => {
    const start = activeMessages[startIndex]
    if (!isAlbumMedia(start)) return []
    const groupId = start.mediaGroupId
    const senderId = start.senderId
    const items = []
    for (let i = startIndex; i < activeMessages.length; i += 1) {
      const current = activeMessages[i]
      if (
        !current ||
        current.mediaGroupId !== groupId ||
        Number(current.senderId) !== Number(senderId) ||
        !isAlbumMedia(current)
      ) {
        break
      }
      items.push(current)
    }
    return items
  }

  return (
    <section className={`w-full min-h-0 flex-col ${isMobileChatOpen ? 'flex' : 'hidden md:flex md:flex-col'}`}>
      <header className="flex items-center gap-3 border-b border-[#e4e4e4] bg-[#f0f2f5] px-4 py-3">
        {activeChat ? (
          <>
            <button
              type="button"
              onClick={backToList}
              className="rounded-full p-1 text-[#54656f] transition hover:bg-[#e6eaed] md:hidden"
              aria-label="Back to chat list"
            >
              <ArrowLeft size={20} />
            </button>
            <button
              type="button"
              onClick={openProfile}
              className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[#d0d7db] text-sm font-semibold text-[#30424f]"
            >
              {activeConversationType === 'group' ? (
                <UsersRound size={18} />
              ) : activeChat.profileMediaUrl ? (
                <img src={activeChat.profileMediaUrl} alt={activeChat.username} className="h-full w-full object-cover" />
              ) : (
                getInitials(activeChat.username)
              )}
            </button>
            <button type="button" onClick={openProfile} className="text-left">
              <p className="text-sm font-semibold text-[#1f2c34]">
                {activeConversationType === 'group' ? activeChat.name : activeChat.username}
              </p>
              <p className="text-xs text-[#667781]">
                {activeConversationType === 'group'
                  ? `${activeChat.members?.length || 0} members`
                  : activeChat.isOnline ? 'online' : formatLastSeen(activeChat.lastSeen)}
              </p>
            </button>
            <div className="relative ml-auto">
              <button
                type="button"
                onClick={() => setProfileMenuOpen((prev) => !prev)}
                className="rounded-md px-2 py-1 text-xl leading-none text-[#54656f] hover:bg-[#e7ecef]"
              >
                ...
              </button>
              {profileMenuOpen && activeConversationType === 'direct' ? (
                <div className="absolute right-0 top-10 z-10 w-44 rounded-lg border border-[#e4e4e4] bg-white p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={requestClearChat}
                    className="w-full rounded-md px-3 py-2 text-left text-sm text-[#111b21] hover:bg-[#f3f5f7]"
                  >
                    Clear chat
                  </button>
                  <button
                    type="button"
                    onClick={requestDeleteChat}
                    className="w-full rounded-md px-3 py-2 text-left text-sm text-[#cc1744] hover:bg-[#fff2f4]"
                  >
                    Delete chat
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-sm text-[#667781]">Select a chat to start messaging</p>
        )}
      </header>

      <div ref={messageListRef} className="chat-wallpaper chat-scrollbar flex-1 overflow-y-auto px-4 py-2 md:px-12">
        <div className="messages-container mx-auto max-w-3xl">
          {loadingOlderMessages ? (
            <div className="mx-auto my-2 w-fit rounded-full bg-white/90 px-3 py-1 text-[11px] text-[#667781] shadow">
              Loading older messages...
            </div>
          ) : null}
          {activeMessages.length === 0 ? (
            <div className="mx-auto my-4 rounded-lg bg-white/90 px-4 py-2 text-center text-xs text-[#54656f] shadow-sm">
              No messages yet. Start the conversation!
            </div>
          ) : null}

          <div className="flex flex-col gap-1 py-2">
            {activeMessages.map((message, index) => {
              const isMine = currentUser && Number(message.senderId) === Number(currentUser.id)
              const isTempMessage = typeof message.id === 'string'
              const prevMessage = activeMessages[index - 1]
              const albumCandidate = isAlbumMedia(message)
              const isContinuationOfAlbum =
                albumCandidate &&
                prevMessage &&
                prevMessage.mediaGroupId === message.mediaGroupId &&
                Number(prevMessage.senderId) === Number(message.senderId) &&
                isAlbumMedia(prevMessage)
              if (isContinuationOfAlbum) return null
              const albumItems = albumCandidate ? getAlbumItemsFromIndex(index) : []
              const showAsAlbum = albumItems.length > 1
              const showTail = !prevMessage || Number(prevMessage.senderId) !== Number(message.senderId)
              const statusLabel = message.clientStatus === 'uploading'
                ? `uploading ${Number(message.uploadProgress) || 0}%`
                : message.clientStatus === 'sending'
                  ? 'sending...'
                  : message.clientStatus === 'failed'
                    ? 'failed'
                    : ''
              const metaText =
                statusLabel ||
                (activeConversationType === 'direct' && isMine && !isTempMessage && message.clientStatus !== 'failed' && !message.seen
                  ? 'delivered'
                  : formatTime(message.createdAt))
              const isDeliveredLabel = metaText === 'delivered'

              return (
                <div
                  key={message.id}
                  data-message-id={message.id}
                  className={`group flex items-end gap-1 ${isMine ? 'flex-row-reverse' : 'flex-row'} ${showTail ? 'mt-2' : 'mt-0.5'}`}
                >
                  <div
                    className={`message-bubble ${isMine ? 'sent' : 'received'} ${!showTail ? (isMine ? '!rounded-tr-lg' : '!rounded-tl-lg') : ''}`}
                    style={{ maxWidth: '65%' }}
                  >
                    {!isMine && activeConversationType === 'group' && showTail ? (
                      <p className="mb-1 text-[11px] font-medium text-[#008069]">{groupMemberNames[message.senderId] || 'Member'}</p>
                    ) : null}

                    {showAsAlbum ? (
                      <div className="mb-1 grid max-w-[360px] grid-cols-3 gap-1 rounded-md">
                        {albumItems.map((item) =>
                          item.messageType === 'image' ? (
                            <div key={item.id} className="group/album relative h-24 w-full overflow-hidden rounded">
                              <button
                                type="button"
                                onClick={() => openMediaPreview(item)}
                                className="h-full w-full"
                                title="Preview image"
                              >
                                <ViewportMedia className="h-24 w-full" placeholderClassName="h-24 w-full animate-pulse bg-[#dfe7eb]">
                                  {(shouldLoad) => (
                                    <img
                                      src={shouldLoad ? item.mediaUrl : undefined}
                                      alt={item.mediaOriginalName || 'Image'}
                                      loading="lazy"
                                      className="h-24 w-full object-cover"
                                    />
                                  )}
                                </ViewportMedia>
                              </button>
                              <a
                                href={`${item.mediaUrl}${item.mediaUrl.includes('?') ? '&' : '?'}download=1`}
                                download={item.mediaOriginalName || true}
                                className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white opacity-0 transition group-hover/album:opacity-100"
                                title="Download image"
                              >
                                <Download size={12} />
                              </a>
                            </div>
                          ) : (
                            <div key={item.id} className="group/album relative col-span-2 h-28 w-full overflow-hidden rounded">
                              <ViewportMedia className="h-28 w-full" placeholderClassName="h-28 w-full animate-pulse bg-[#dfe7eb]">
                                {(shouldLoad) => (
                                  <video
                                    src={shouldLoad ? item.mediaUrl : undefined}
                                    controls
                                    preload="none"
                                    className="h-28 w-full object-cover"
                                  />
                                )}
                              </ViewportMedia>
                              <button
                                type="button"
                                onClick={() => openMediaPreview(item)}
                                className="absolute left-1 top-1 rounded-full bg-black/55 p-1 text-white opacity-0 transition group-hover/album:opacity-100"
                                title="Open large preview"
                              >
                                <Maximize2 size={12} />
                              </button>
                              <a
                                href={`${item.mediaUrl}${item.mediaUrl.includes('?') ? '&' : '?'}download=1`}
                                download={item.mediaOriginalName || true}
                                className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white opacity-0 transition group-hover/album:opacity-100"
                                title="Download video"
                              >
                                <Download size={12} />
                              </a>
                            </div>
                          ),
                        )}
                      </div>
                    ) : null}

                    {!showAsAlbum && message.mediaUrl && message.messageType === 'image' ? (
                      <div className="group/single relative mb-1">
                        <button type="button" onClick={() => openMediaPreview(message)} title="Preview image">
                          <ViewportMedia
                            className="max-h-64 w-auto rounded-md"
                            placeholderClassName="h-52 w-64 max-w-full animate-pulse rounded-md bg-[#dfe7eb]"
                          >
                            {(shouldLoad) => (
                              <img
                                src={shouldLoad ? message.mediaUrl : undefined}
                                alt={message.mediaOriginalName || 'Image'}
                                loading="lazy"
                                className="max-h-64 w-auto rounded-md object-cover"
                              />
                            )}
                          </ViewportMedia>
                        </button>
                        <a
                          href={`${message.mediaUrl}${message.mediaUrl.includes('?') ? '&' : '?'}download=1`}
                          download={message.mediaOriginalName || true}
                          className="absolute right-2 top-2 rounded-full bg-black/55 p-1.5 text-white opacity-0 transition group-hover/single:opacity-100"
                          title="Download image"
                        >
                          <Download size={14} />
                        </a>
                      </div>
                    ) : null}

                    {!showAsAlbum && message.mediaUrl && message.messageType === 'video' ? (
                      <div className="group/single relative mb-1">
                        <ViewportMedia
                          className="max-h-72 w-full rounded-md"
                          placeholderClassName="h-56 w-full animate-pulse rounded-md bg-[#dfe7eb]"
                        >
                          {(shouldLoad) => (
                            <video
                              src={shouldLoad ? message.mediaUrl : undefined}
                              controls
                              preload="none"
                              className="max-h-72 w-full rounded-md"
                            />
                          )}
                        </ViewportMedia>
                        <button
                          type="button"
                          onClick={() => openMediaPreview(message)}
                          className="absolute left-2 top-2 rounded-full bg-black/55 p-1.5 text-white opacity-0 transition group-hover/single:opacity-100"
                          title="Open large preview"
                        >
                          <Maximize2 size={14} />
                        </button>
                        <a
                          href={`${message.mediaUrl}${message.mediaUrl.includes('?') ? '&' : '?'}download=1`}
                          download={message.mediaOriginalName || true}
                          className="absolute right-2 top-2 rounded-full bg-black/55 p-1.5 text-white opacity-0 transition group-hover/single:opacity-100"
                          title="Download video"
                        >
                          <Download size={14} />
                        </a>
                      </div>
                    ) : null}

                    {message.mediaUrl && message.messageType === 'audio' ? (
                      <AudioMessageBubble url={message.mediaUrl} fallbackDurationSec={message.mediaDurationSec} />
                    ) : null}

                    {message.mediaUrl && message.messageType === 'file' ? (
                      <a
                        href={`${message.mediaUrl}${message.mediaUrl.includes('?') ? '&' : '?'}download=1`}
                        download={message.mediaOriginalName || true}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mb-1 flex items-center gap-3 rounded-lg bg-black/5 px-3 py-2 transition hover:bg-black/10"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#00a884] text-white">
                          <FileText size={20} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#111b21]">{getFileName(message.mediaUrl, message.mediaOriginalName)}</p>
                          <p className="text-xs text-[#667781]">{formatFileSize(message.fileSize)} - Click to download</p>
                        </div>
                        <Download size={18} className="text-[#667781]" />
                      </a>
                    ) : null}

                    {message.text ? (
                      <p className="break-words whitespace-pre-wrap text-[14.2px] leading-[19px] text-[#111b21]">{message.text}</p>
                    ) : null}
                    <div className="mt-1 -mb-1 flex items-center justify-end gap-1">
                      <span className={isDeliveredLabel ? 'text-[10px] text-[#667781]' : 'text-[11px] text-[#667781]'}>{metaText}</span>
                      {activeConversationType === 'direct' && isMine && !isTempMessage && message.clientStatus !== 'failed' ? (
                        <svg viewBox="0 0 16 11" height="11" width="16" className={message.seen ? 'text-[#53bdeb]' : 'text-[#8696a0]'}>
                          {message.seen ? (
                            <path d="M11.0714 0.652832C10.991 0.585124 10.8894 0.547339 10.7839 0.545765C10.6783 0.544191 10.5757 0.579091 10.4933 0.644379L4.31327 5.59399L2.50683 3.96327C2.42427 3.89517 2.31994 3.8563 2.212 3.85338C2.10406 3.85045 1.99804 3.88367 1.91238 3.94727L1.27038 4.45327C1.18615 4.51544 1.12693 4.60462 1.10237 4.7055C1.07781 4.80638 1.08953 4.91258 1.13538 5.00527L3.74127 9.99327C3.78715 10.0872 3.86359 10.1623 3.95864 10.2064C4.05369 10.2506 4.16134 10.2611 4.26327 10.2363C4.66327 10.1353 7.33327 9.29727 11.2273 3.48527C11.2936 3.39019 11.3203 3.27454 11.3021 3.16143C11.2839 3.04832 11.2221 2.94651 11.1293 2.87627L11.0714 0.652832ZM14.3083 0.652832C14.2279 0.585124 14.1263 0.547339 14.0208 0.545765C13.9152 0.544191 13.8126 0.579091 13.7302 0.644379L7.55023 5.59399L7.25023 5.35399C7.17135 5.28885 7.06956 5.25809 6.96572 5.26758C6.86189 5.27707 6.76561 5.32602 6.69723 5.40427L6.18523 6.02127C6.11617 6.10074 6.08017 6.20306 6.08417 6.30817C6.08817 6.41329 6.13185 6.51256 6.20723 6.58627L7.97827 8.23027C8.04767 8.29755 8.13793 8.33837 8.23363 8.34627C8.32993 8.35417 8.42603 8.32853 8.50623 8.27327C8.91023 8.00827 11.5862 6.06427 14.4643 3.48527C14.5306 3.39019 14.5573 3.27454 14.5391 3.16143C14.5209 3.04832 14.4591 2.94651 14.3663 2.87627L14.3083 0.652832Z" fill="currentColor"></path>
                          ) : (
                            <path d="M11.0714 0.652832C10.991 0.585124 10.8894 0.547339 10.7839 0.545765C10.6783 0.544191 10.5757 0.579091 10.4933 0.644379L4.31327 5.59399L2.50683 3.96327C2.42427 3.89517 2.31994 3.8563 2.212 3.85338C2.10406 3.85045 1.99804 3.88367 1.91238 3.94727L1.27038 4.45327C1.18615 4.51544 1.12693 4.60462 1.10237 4.7055C1.07781 4.80638 1.08953 4.91258 1.13538 5.00527L3.74127 9.99327C3.78715 10.0872 3.86359 10.1623 3.95864 10.2064C4.05369 10.2506 4.16134 10.2611 4.26327 10.2363C4.66327 10.1353 7.33327 9.29727 11.2273 3.48527C11.2936 3.39019 11.3203 3.27454 11.3021 3.16143C11.2839 3.04832 11.2221 2.94651 11.1293 2.87627L11.0714 0.652832Z" fill="currentColor"></path>
                          )}
                        </svg>
                      ) : null}
                    </div>
                  </div>

                  {activeConversationType === 'direct' && isMine && !isTempMessage ? (
                    <button
                      type="button"
                      onClick={() => requestDeleteMessage(message.id)}
                      className="mb-1 rounded p-1 text-[#8696a0] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/5"
                      aria-label="Delete message"
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <footer className="border-t border-[#e4e4e4] bg-[#f0f2f5] p-3">
        <div className="mx-auto max-w-3xl">
          {recordingError ? (
            <div className="mb-2 rounded-md bg-[#fff1f1] px-3 py-2 text-xs text-[#cc1744]">{recordingError}</div>
          ) : null}

          {pendingMedia?.length > 0 ? (
            <div className="mb-2 rounded-lg border border-[#d7e0e4] bg-white p-2">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-[#1f2c34]">{pendingMedia.length} media selected</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clearPendingMedia}
                    className="text-xs font-medium text-[#667781] hover:text-[#1f2c34]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={sendPendingMedia}
                    disabled={uploadingMedia}
                    className="rounded-md bg-[#25d366] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {uploadingMedia ? 'Sending...' : 'Send media'}
                  </button>
                </div>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {pendingMedia.map((item) => (
                  <div key={item.id} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-[#d5dde2]">
                    {item.kind === 'video' ? (
                      <video src={item.previewUrl} className="h-full w-full object-cover" />
                    ) : (
                      <img src={item.previewUrl} alt="preview" className="h-full w-full object-cover" />
                    )}
                    <button
                      type="button"
                      onClick={() => removePendingMedia(item.id)}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
                      aria-label="Remove media"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => mediaInputRef.current?.click()}
              disabled={!activeChat || uploadingMedia || isRecording}
              className="rounded-lg bg-white p-2 text-[#54656f] transition hover:bg-[#edf0f2] disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Attach file"
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={mediaInputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files || [])
                onPickMediaFiles?.(files)
                event.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={!activeChat || uploadingMedia}
              className={`rounded-lg p-2 transition ${
                isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-white text-[#54656f] hover:bg-[#edf0f2]'
              } disabled:cursor-not-allowed disabled:opacity-60`}
              aria-label={isRecording ? 'Stop recording' : 'Record voice'}
            >
              {isRecording ? <Square size={18} /> : <Mic size={18} />}
            </button>
            {isRecording ? (
              <div className="rounded-lg bg-[#fff1f1] px-3 py-2 text-xs font-semibold text-[#cc1744]">
                Recording {formatDuration(recordingSeconds)}
              </div>
            ) : null}
            <input
              type="text"
              placeholder={activeChat ? (isRecording ? 'Recording in progress...' : 'Type a message') : 'Select a chat first'}
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isRecording) sendMessage()
              }}
              disabled={!activeChat || isRecording}
              className="flex-1 rounded-lg border border-[#dde2e5] bg-white px-3 py-2 text-sm outline-none placeholder:text-[#7a8b95] focus:border-[#25d366] disabled:cursor-not-allowed disabled:bg-[#f7f7f7]"
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={!activeChat || uploadingMedia || isRecording}
              className="rounded-lg bg-[#25d366] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1fab53] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploadingMedia ? 'Uploading...' : 'Send'}
            </button>
          </div>
        </div>
      </footer>

      {previewMedia ? (
        <div
          className="absolute inset-0 z-40 grid place-items-center bg-black/80 p-3"
          onClick={() => setPreviewMedia(null)}
        >
          <div
            className="relative w-full max-w-4xl rounded-lg bg-black p-2"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewMedia(null)}
              className="absolute right-3 top-3 z-10 rounded-full bg-black/60 p-1.5 text-white"
              aria-label="Close preview"
            >
              <X size={16} />
            </button>
            {previewMedia.type === 'video' ? (
              <video src={previewMedia.url} controls autoPlay className="max-h-[78vh] w-full rounded" />
            ) : (
              <img src={previewMedia.url} alt={previewMedia.name} className="max-h-[78vh] w-full rounded object-contain" />
            )}
            <div className="mt-2 flex justify-end">
              <a
                href={`${previewMedia.url}${previewMedia.url.includes('?') ? '&' : '?'}download=1`}
                download={previewMedia.name || true}
                className="rounded-md bg-[#25d366] px-3 py-1.5 text-xs font-semibold text-white"
              >
                Download
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default ChatPanel
