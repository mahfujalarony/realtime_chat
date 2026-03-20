import { ArrowDownLeft, ArrowUpRight, ArrowLeft, Clock3, Download, FileText, Loader2, Maximize2, Mic, Paperclip, Pause, Phone, PhoneOff, Play, SmilePlus, Square, Trash2, UsersRound, Video, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const AUDIO_MIME_CANDIDATES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
const REACTION_OPTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🙏']

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '00:00'
  const s = Math.floor(totalSeconds)
  const minutes = Math.floor(s / 60)
  const seconds = s % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function pickSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  const userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent || '').toLowerCase() : ''
  const isFirefox = userAgent.includes('firefox')
  const candidates = isFirefox
    ? ['audio/ogg;codecs=opus', 'audio/ogg', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4']
    : AUDIO_MIME_CANDIDATES
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function normalizeAudioMimeType(mimeType) {
  const raw = String(mimeType || '').trim().toLowerCase()
  if (!raw) return ''
  const base = raw.split(';')[0].trim()
  if (!base) return ''
  if (base === 'audio/x-m4a') return 'audio/mp4'
  if (base === 'audio/x-wav') return 'audio/wav'
  return base
}

function parseCallLogText(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const missed = raw.match(/^Missed\s+(audio|video)\s+call$/i)
  if (missed) {
    return { kind: missed[1].toLowerCase(), missed: true, durationText: '' }
  }
  const completed = raw.match(/^(Audio|Video)\s+call\s+(?:•|-)\s+(.+)$/i)
  if (completed) {
    return { kind: completed[1].toLowerCase(), missed: false, durationText: completed[2] }
  }
  return null
}

function getHistoricalSenderLabel(sender) {
  const role = String(sender?.role || 'user').toLowerCase()
  if (role === 'admin') return 'Admin'
  if (role === 'model_admin') return 'Model Admin'
  if (sender?.canHandleExternalChat) return 'Agent'
  return 'User'
}

function isInternalConversationSender(message, activeChat) {
  return Number(message?.senderId) !== Number(activeChat?.id)
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

function AudioMessageBubble({ url, fallbackDurationSec, controlsList, mimeType }) {
  const audioRef = useRef(null)
  const progressIntervalRef = useRef(0)
  const progressBarRef = useRef(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [hasPlaybackError, setHasPlaybackError] = useState(false)
  const [duration, setDuration] = useState(Number.isFinite(Number(fallbackDurationSec)) ? Number(fallbackDurationSec) : 0)
  const normalizedMimeType = normalizeAudioMimeType(mimeType)

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const displayDuration = Math.max(safeDuration, currentTime, Number(fallbackDurationSec) || 0)
  const progressPercent = displayDuration > 0 ? Math.min(100, Math.max(0, (currentTime / displayDuration) * 100)) : 0
  const syncDurationFromElement = () => {
    const el = audioRef.current
    if (!el) return
    if (Number.isFinite(el.duration) && el.duration > 0) {
      setDuration(el.duration)
      return
    }
    if (el.seekable && el.seekable.length > 0) {
      const seekableEnd = el.seekable.end(el.seekable.length - 1)
      if (Number.isFinite(seekableEnd) && seekableEnd > 0) {
        setDuration(seekableEnd)
        return
      }
    }
    if ((el.currentTime || 0) > 0) {
      setDuration((prev) => Math.max(prev, el.currentTime || 0))
    }
  }

  const onLoadedMetadata = () => {
    syncDurationFromElement()
    setIsLoading(false)
    setHasPlaybackError(false)
  }

  const onTimeUpdate = () => {
    const el = audioRef.current
    if (!el) return
    setCurrentTime(el.currentTime || 0)
    syncDurationFromElement()
  }

  useEffect(() => {
    if (!isPlaying) {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
        progressIntervalRef.current = 0
      }
      return
    }

    const tick = () => {
      const el = audioRef.current
      if (!el) return
      const nextTime = el.currentTime || 0
      setCurrentTime((prev) => (Math.abs(prev - nextTime) >= 0.08 ? nextTime : prev))
      syncDurationFromElement()
    }

    tick()
    progressIntervalRef.current = window.setInterval(() => {
      const el = audioRef.current
      if (!el || el.paused || el.ended) return
      tick()
    }, 180)

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
        progressIntervalRef.current = 0
      }
    }
  }, [isPlaying])

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

  const onAudioError = () => {
    setIsLoading(false)
    setIsPlaying(false)
    setHasPlaybackError(true)
  }

  const seekToPosition = (clientX) => {
    const el = audioRef.current
    const track = progressBarRef.current
    if (!el || !track || !displayDuration) return
    const rect = track.getBoundingClientRect()
    if (!rect.width) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const nextTime = ratio * displayDuration
    el.currentTime = nextTime
    setCurrentTime(nextTime)
  }

  const onSeek = (event) => {
    seekToPosition(event.clientX)
  }

  const onSeekKeyDown = (event) => {
    const el = audioRef.current
    if (!el || !displayDuration) return
    const step = Math.max(1, displayDuration / 20)
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    let nextTime = el.currentTime || 0
    if (event.key === 'ArrowLeft') nextTime -= step
    if (event.key === 'ArrowRight') nextTime += step
    if (event.key === 'Home') nextTime = 0
    if (event.key === 'End') nextTime = displayDuration
    nextTime = Math.min(displayDuration, Math.max(0, nextTime))
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
    <div className="mb-1 w-[min(240px,70vw)] max-w-full rounded-lg bg-black/5 px-3 py-2 md:w-[300px]">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        data-chat-audio="1"
        controlsList={controlsList}
        data-mime-type={normalizedMimeType || undefined}
        className="hidden"
        onLoadedMetadata={onLoadedMetadata}
        onLoadedData={() => {
          syncDurationFromElement()
          setIsLoading(false)
        }}
        onDurationChange={syncDurationFromElement}
        onTimeUpdate={onTimeUpdate}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onPause}
        onError={onAudioError}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          disabled={hasPlaybackError}
          className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-[#00a884] text-white transition hover:bg-[#02916f]"
          aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
        >
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <div className="min-w-0 flex-1 px-1">
          <button
            ref={progressBarRef}
            type="button"
            onClick={onSeek}
            onKeyDown={onSeekKeyDown}
            disabled={!displayDuration}
            className="audio-progress-bar relative block h-6 w-full disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Audio seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(displayDuration)}
            aria-valuenow={Math.round(Math.min(currentTime, displayDuration))}
            aria-valuetext={`${formatDuration(currentTime)} of ${formatDuration(displayDuration)}`}
            role="slider"
          >
            <span className="audio-progress-bar__track absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#3f3f46]" />
            <span
              className="audio-progress-bar__fill absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#3f3f46]"
              style={{ width: `${progressPercent}%` }}
            />
            <span
              className="audio-progress-bar__thumb absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[#00a884] shadow-[0_0_0_2px_#fff,0_1px_3px_rgba(0,0,0,0.18)]"
              style={{ left: `calc(${progressPercent}% - 8px)` }}
            />
          </button>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between text-[11px] text-[#667781]">
        <span>{formatDuration(currentTime)}</span>
        <span>{formatDuration(displayDuration)}</span>
      </div>
      {hasPlaybackError ? (
        <p className="mt-1 text-[11px] text-[#cc1744]">Audio format not supported on this device/browser.</p>
      ) : null}
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
  startAudioCall,
  startVideoCall,
  getInitials,
  exportConversationPdf,
  canExportConversation,
  messageListRef,
  activeMessages,
  currentUser,
  formatTime,
  formatLastSeen,
  isBlockedByMe,
  hasBlockedMe,
  activeConversationNote,
  activeConversationCanEditNote,
  saveActiveConversationNote,
  requestDeleteMessage,
  reactToMessage,
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
  const draftInputRef = useRef(null)
  const recorderRef = useRef(null)
  const recordingStreamRef = useRef(null)
  const recordingTimerRef = useRef(null)
  const recordingSecondsRef = useRef(0)
  const recordingStartedAtRef = useRef(0)
  const audioChunksRef = useRef([])
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordingError, setRecordingError] = useState('')
  const [previewMedia, setPreviewMedia] = useState(null)
  const seenCheckRafRef = useRef(null)
  const lastScrollTopRef = useRef(0)
  const ignoreOlderLoadUntilRef = useRef(0)
  const [keyboardInset, setKeyboardInset] = useState(0)
  const [isEditingNote, setIsEditingNote] = useState(false)
  const [isNoteExpanded, setIsNoteExpanded] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState(null)
  const [reactionPicker, setReactionPicker] = useState(null)
  const [reactionDetails, setReactionDetails] = useState(null)
  const isConversationBlocked = Boolean(isBlockedByMe || hasBlockedMe)
  const canSendToActiveChat = Boolean(activeChat) && !isConversationBlocked
  const reactionLongPressTimerRef = useRef(null)
  const isStaffViewer = ['admin', 'model_admin'].includes(String(currentUser?.role || '').toLowerCase()) || Boolean(currentUser?.canHandleExternalChat)
  const canDownloadMedia = Boolean(currentUser?.canDownloadConversations)
  const canDownloadFile = true

  const copyMessageText = async (text, messageId) => {
    const raw = String(text || '')
    if (!raw.trim()) return
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(raw)
      } else {
        const el = document.createElement('textarea')
        el.value = raw
        el.setAttribute('readonly', '')
        el.style.position = 'fixed'
        el.style.opacity = '0'
        document.body.appendChild(el)
        el.focus()
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      setCopiedMessageId(messageId)
      window.setTimeout(() => {
        setCopiedMessageId((prev) => (prev === messageId ? null : prev))
      }, 1200)
    } catch {
      // Ignore clipboard errors to avoid breaking chat interactions.
    }
  }

  useEffect(() => {
    setIsEditingNote(false)
    setIsNoteExpanded(false)
    setNoteDraft(String(activeConversationNote || ''))
    setReactionDetails(null)
  }, [activeConversationNote, activeChat?.id])

  const onSaveNote = async () => {
    if (!activeConversationCanEditNote || typeof saveActiveConversationNote !== 'function') return
    setSavingNote(true)
    const ok = await saveActiveConversationNote(noteDraft)
    setSavingNote(false)
    if (ok) setIsEditingNote(false)
    return ok
  }

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
    recordingStartedAtRef.current = 0
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
      if (reactionLongPressTimerRef.current) {
        clearTimeout(reactionLongPressTimerRef.current)
        reactionLongPressTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!reactionPicker) return undefined
    const close = () => setReactionPicker(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('touchstart', close, { passive: true })
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('touchstart', close)
    }
  }, [reactionPicker])

  const openReactionDetails = (message, reaction) => {
    if (!message?.id || !reaction?.emoji) return
    setReactionDetails({
      messageId: Number(message.id),
      emoji: String(reaction.emoji),
      reactors: Array.isArray(reaction.reactors) ? reaction.reactors : [],
    })
  }

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

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return undefined
    const viewport = window.visualViewport

    const updateInset = () => {
      const rawInset = window.innerHeight - viewport.height - viewport.offsetTop
      const nextInset = rawInset > 0 ? Math.round(rawInset) : 0
      setKeyboardInset(nextInset)
    }

    viewport.addEventListener('resize', updateInset)
    viewport.addEventListener('scroll', updateInset)
    updateInset()
    return () => {
      viewport.removeEventListener('resize', updateInset)
      viewport.removeEventListener('scroll', updateInset)
    }
  }, [])

  const ensureInputVisible = () => {
    const node = draftInputRef.current
    if (!node) return
    requestAnimationFrame(() => {
      node.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    })
  }

  const autoResizeDraft = () => {
    const node = draftInputRef.current
    if (!node) return
    node.style.height = 'auto'
    const nextHeight = Math.min(node.scrollHeight, 112)
    node.style.height = `${Math.max(38, nextHeight)}px`
  }

  useEffect(() => {
    autoResizeDraft()
  }, [draftMessage, isRecording])

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
      recordingStartedAtRef.current = Date.now()
      setRecordingSeconds(0)
      setIsRecording(true)

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        const preferredType = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, { type: preferredType })
        const elapsedFromClock = recordingStartedAtRef.current > 0
          ? Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)
          : 0
        const durationSec = Math.max(recordingSecondsRef.current, elapsedFromClock, 1)
        cleanupStream()
        if (blob.size < 2048) {
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
      recorder.start()
      recordingTimerRef.current = setInterval(() => {
        if (recordingStartedAtRef.current > 0) {
          recordingSecondsRef.current = Math.max(
            recordingSecondsRef.current + 1,
            Math.floor((Date.now() - recordingStartedAtRef.current) / 1000),
          )
        } else {
          recordingSecondsRef.current += 1
        }
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

  const clearReactionLongPressTimer = () => {
    if (!reactionLongPressTimerRef.current) return
    clearTimeout(reactionLongPressTimerRef.current)
    reactionLongPressTimerRef.current = null
  }

  const getReactionAnchorElement = (targetElement) => {
    const element = targetElement instanceof HTMLElement ? targetElement : null
    if (!element) return null
    if (element.dataset.reactionAnchor === 'true') return element
    const row = element.closest('[data-message-row="true"]')
    return row?.querySelector?.('[data-reaction-anchor="true"]') || element
  }

  const openReactionPickerAt = (message, targetElement) => {
    const messageId = Number(message?.id)
    if (!Number.isInteger(messageId)) return
    const element = getReactionAnchorElement(targetElement)
    const rect = element?.getBoundingClientRect?.()
    if (!rect) return
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0
    const pickerWidth = 300
    const pickerHeight = 56
    const edge = 12

    const desiredLeft = rect.left + rect.width / 2
    const minLeft = edge + pickerWidth / 2
    const maxLeft = Math.max(minLeft, viewportWidth - edge - pickerWidth / 2)
    const left = Math.max(minLeft, Math.min(maxLeft, desiredLeft))

    const topCandidate = rect.top - 10
    const shouldOpenBelow = topCandidate < pickerHeight + edge
    const top = shouldOpenBelow ? Math.min(viewportHeight - edge, rect.bottom + 10) : topCandidate
    setReactionPicker({ messageId, x: left, y: top, placeBelow: shouldOpenBelow })
  }

  const onMessageLongPressStart = (message, targetElement) => {
    const messageId = Number(message?.id)
    if (!Number.isInteger(messageId)) return
    clearReactionLongPressTimer()
    reactionLongPressTimerRef.current = setTimeout(() => {
      openReactionPickerAt(message, targetElement)
      reactionLongPressTimerRef.current = null
      if (navigator.vibrate) navigator.vibrate(12)
    }, 420)
  }

  const onReactionPick = async (emoji) => {
    if (!reactionPicker?.messageId || typeof reactToMessage !== 'function') return
    await reactToMessage(reactionPicker.messageId, emoji)
    setReactionPicker(null)
  }

  return (
    <section className={`h-full w-full min-h-0 flex-col ${isMobileChatOpen ? 'flex' : 'hidden md:flex md:flex-col'}`}>
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
            <div className="ml-auto flex items-center">
              {activeConversationType === 'direct' ? (
                <div className="mr-1 inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={startAudioCall}
                    disabled={!canSendToActiveChat}
                    className="rounded-full p-2 text-[#54656f] transition hover:bg-[#e7ecef] disabled:cursor-not-allowed disabled:opacity-50"
                    title="Audio call"
                    aria-label="Audio call"
                  >
                    <Phone size={18} />
                  </button>
                  {canExportConversation ? (
                    <button
                      type="button"
                      onClick={exportConversationPdf}
                      className="rounded-full p-2 text-[#54656f] transition hover:bg-[#e7ecef]"
                      title="Export chat as PDF"
                      aria-label="Export chat as PDF"
                    >
                      <Download size={18} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={startVideoCall}
                    disabled={!canSendToActiveChat}
                    className="rounded-full p-2 text-[#54656f] transition hover:bg-[#e7ecef] disabled:cursor-not-allowed disabled:opacity-50"
                    title="Video call"
                    aria-label="Video call"
                  >
                    <Video size={18} />
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-sm text-[#667781]">Select a chat to start messaging</p>
        )}
      </header>

      {activeChat && activeConversationType === 'direct' ? (
        <div className="border-b border-[#e3e9ee] bg-[linear-gradient(180deg,#f7fafc_0%,#eef4f6_100%)] px-4 py-1.5 md:px-12">
          <div className="mx-auto max-w-3xl">
            {activeConversationNote ? (
              <button
                type="button"
                onClick={() => {
                  setIsEditingNote(false)
                  setIsNoteExpanded(true)
                }}
                className="flex w-full items-center gap-2 rounded-xl border border-[#d8e2ea] bg-white/90 px-2.5 py-1.5 text-left shadow-[0_6px_16px_rgba(15,23,42,0.05)] transition hover:border-[#c7d5e0] hover:bg-white"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#edf5ff] text-[#295f98]">
                  <FileText size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#617787]">Note</p>
                  <p className="truncate text-xs text-[#243746]">{activeConversationNote}</p>
                </div>
                <div className="shrink-0 rounded-full bg-[#f4f7fa] px-2 py-0.5 text-[10px] font-semibold text-[#3e5465]">
                  View
                </div>
              </button>
            ) : activeConversationCanEditNote ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-[#cad6df] bg-white/80 px-2.5 py-1.5 shadow-[0_6px_16px_rgba(15,23,42,0.04)]">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#273947]">No note added</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNoteDraft('')
                    setIsEditingNote(true)
                    setIsNoteExpanded(true)
                  }}
                  className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#214e78] px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm transition hover:bg-[#193f61]"
                >
                  Add note
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeChat && activeConversationType === 'direct' && isNoteExpanded ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4" onClick={() => {
          setIsNoteExpanded(false)
          setIsEditingNote(false)
          setNoteDraft(String(activeConversationNote || ''))
        }}>
          <div
            className="w-full max-w-lg rounded-3xl border border-[#d6e0e7] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#edf5ff] text-[#295f98]">
                <FileText size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#617787]">Note</p>
                    <p className="mt-1 text-sm text-[#6b7f8d]">Private note for this direct conversation.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsNoteExpanded(false)
                      setIsEditingNote(false)
                      setNoteDraft(String(activeConversationNote || ''))
                    }}
                    className="rounded-full p-2 text-[#617787] transition hover:bg-[#f3f6f8]"
                    aria-label="Close note"
                  >
                    <X size={18} />
                  </button>
                </div>

                {!isEditingNote ? (
                  <>
                    <div className="mt-4 rounded-2xl bg-[#f6f9fb] px-4 py-3 text-sm leading-6 text-[#243746]">
                      {activeConversationNote ? (
                        <p className="whitespace-pre-wrap wrap-break-word">{activeConversationNote}</p>
                      ) : (
                        <p className="text-[#6a7d8c]">No note added yet.</p>
                      )}
                    </div>
                    {activeConversationCanEditNote ? (
                      <div className="mt-4 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setNoteDraft(String(activeConversationNote || ''))
                            setIsEditingNote(true)
                          }}
                          className="rounded-full bg-[#214e78] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#193f61]"
                        >
                          {activeConversationNote ? 'Edit note' : 'Add note'}
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="mt-4 space-y-3">
                    <textarea
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      rows={5}
                      placeholder="Add internal note"
                      className="w-full rounded-2xl border border-[#cfdae4] bg-[#fbfdff] px-3 py-2 text-sm text-[#243746] outline-none transition focus:border-[#8aa9c2] focus:bg-white"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingNote(false)
                          setNoteDraft(String(activeConversationNote || ''))
                        }}
                        className="rounded-full border border-[#d6dee6] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#4f6474]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await onSaveNote()
                          if (ok) {
                            setIsNoteExpanded(false)
                          }
                        }}
                        disabled={savingNote}
                        className="rounded-full bg-[#214e78] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#193f61] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingNote ? 'Saving...' : 'Save note'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
              const callLog = message.messageType === 'text' ? parseCallLogText(message.text) : null
              const isMine = currentUser && Number(message.senderId) === Number(currentUser.id)
              const isTempMessage = typeof message.id === 'string'
              const prevMessage = activeMessages[index - 1]
              const isDirectExternalMessage = activeConversationType === 'direct' && Number(message.senderId) === Number(activeChat?.id)
              const isHistoricalInternalMessage = activeConversationType === 'direct' && !isMine && !isDirectExternalMessage
              const alignAsOutgoing = Boolean(
                isMine || (activeConversationType === 'direct' && isStaffViewer && isInternalConversationSender(message, activeChat)),
              )
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
              if (callLog) {
                const isOutgoingCallLog = alignAsOutgoing
                const callToneClass = callLog.missed
                  ? 'border-[#ffd9de] bg-[#fff1f3] text-[#cf294f]'
                  : 'border-[#cdeedd] bg-[#ebfff3] text-[#0c8f4f]'
                const callTypeLabel = callLog.kind === 'video' ? 'video' : 'audio'
                const titleText = callLog.missed
                  ? `Missed ${callTypeLabel} call`
                  : `${isOutgoingCallLog ? 'Outgoing' : 'Incoming'} ${callTypeLabel} call`
                const actorText = isOutgoingCallLog
                  ? 'You called'
                  : `${activeChat?.username || 'User'} called you`
                return (
                  <div
                    key={message.id}
                    data-message-id={message.id}
                    className={`mt-2 flex ${isOutgoingCallLog ? 'justify-end pr-1' : 'justify-start pl-1'}`}
                  >
                    <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs shadow-sm ${callToneClass}`}>
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/80">
                        {callLog.missed ? (
                          <PhoneOff size={13} />
                        ) : isOutgoingCallLog ? (
                          <ArrowUpRight size={13} />
                        ) : (
                          <ArrowDownLeft size={13} />
                        )}
                      </span>
                      <div className="flex flex-col leading-tight">
                        <span className="font-semibold">{actorText}</span>
                        <span className="text-[11px]">{titleText}</span>
                        <span className="text-[11px] text-[#667781]">
                          {callLog.durationText ? (
                            <span className="inline-flex items-center gap-1">
                              <Clock3 size={11} />
                              {callLog.durationText}
                            </span>
                          ) : (
                            callLog.kind === 'video' ? 'Video call' : 'Audio call'
                          )}
                        </span>
                      </div>
                      <span className="ml-1 text-[11px] text-[#667781]">{formatTime(message.createdAt)}</span>
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={message.id}
                  data-message-id={message.id}
                  data-message-row="true"
                  className={`group flex items-end gap-1 ${alignAsOutgoing ? 'flex-row-reverse' : 'flex-row'} ${showTail ? 'mt-2' : 'mt-0.5'}`}
                >
              <div className={`relative flex max-w-[82%] flex-col sm:max-w-[75%] md:max-w-[65%] ${alignAsOutgoing ? 'items-end' : 'items-start'}`}>
                    <div
                      data-reaction-anchor="true"
                      className={`relative w-fit max-w-full message-bubble select-none ${alignAsOutgoing ? 'sent' : 'received'} ${isHistoricalInternalMessage && isStaffViewer ? 'internal-history' : ''} ${!showTail ? (alignAsOutgoing ? '!rounded-tr-lg' : '!rounded-tl-lg') : ''}`}
                      onSelectStart={(event) => event.preventDefault()}
                      onContextMenu={(event) => {
                        if (activeConversationType !== 'direct' || typeof reactToMessage !== 'function' || isTempMessage) return
                        event.preventDefault()
                        openReactionPickerAt(message, event.currentTarget)
                      }}
                      onTouchStart={(event) => {
                        if (activeConversationType !== 'direct' || typeof reactToMessage !== 'function' || isTempMessage) return
                        onMessageLongPressStart(message, event.currentTarget)
                      }}
                      onTouchEnd={clearReactionLongPressTimer}
                      onTouchMove={clearReactionLongPressTimer}
                      onTouchCancel={clearReactionLongPressTimer}
                    >
                    {!isMine && activeConversationType === 'group' && showTail ? (
                      <p className="mb-1 text-[11px] font-medium text-[#008069]">{groupMemberNames[message.senderId] || 'Member'}</p>
                    ) : null}
                    {isHistoricalInternalMessage && showTail && isStaffViewer ? (
                      <p className="mb-1 text-[11px] font-medium text-[#0b6bcb]">
                        {(message.sender?.username || 'Team member')} • {getHistoricalSenderLabel(message.sender)}
                      </p>
                    ) : null}

                    {showAsAlbum ? (
                      <div className="mb-1 grid max-w-full grid-cols-3 gap-1 rounded-md">
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
                              {canDownloadMedia ? (
                                <a
                                  href={`${item.mediaUrl}${item.mediaUrl.includes('?') ? '&' : '?'}download=1`}
                                  download={item.mediaOriginalName || true}
                                  className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white opacity-0 transition group-hover/album:opacity-100"
                                  title="Download image"
                                >
                                  <Download size={12} />
                                </a>
                              ) : null}
                            </div>
                          ) : (
                            <div key={item.id} className="group/album relative col-span-3 max-h-72 w-full overflow-hidden rounded-md">
                              <ViewportMedia className="max-h-72 w-full rounded-md" placeholderClassName="h-56 w-full animate-pulse rounded-md bg-[#dfe7eb]">
                                {(shouldLoad) => (
                                  <video
                                    src={shouldLoad ? item.mediaUrl : undefined}
                                    controls
                                    controlsList={canDownloadMedia ? undefined : 'nodownload'}
                                    preload="none"
                                    className="max-h-72 w-full rounded-md"
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
                              {canDownloadMedia ? (
                                <a
                                  href={`${item.mediaUrl}${item.mediaUrl.includes('?') ? '&' : '?'}download=1`}
                                  download={item.mediaOriginalName || true}
                                  className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white opacity-0 transition group-hover/album:opacity-100"
                                  title="Download video"
                                >
                                  <Download size={12} />
                                </a>
                              ) : null}
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
                        {canDownloadMedia ? (
                          <a
                            href={`${message.mediaUrl}${message.mediaUrl.includes('?') ? '&' : '?'}download=1`}
                            download={message.mediaOriginalName || true}
                            className="absolute right-2 top-2 rounded-full bg-black/55 p-1.5 text-white opacity-0 transition group-hover/single:opacity-100"
                            title="Download image"
                          >
                            <Download size={14} />
                          </a>
                        ) : null}
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
                              controlsList={canDownloadMedia ? undefined : 'nodownload'}
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
                        {canDownloadMedia ? (
                          <a
                            href={`${message.mediaUrl}${message.mediaUrl.includes('?') ? '&' : '?'}download=1`}
                            download={message.mediaOriginalName || true}
                            className="absolute right-2 top-2 rounded-full bg-black/55 p-1.5 text-white opacity-0 transition group-hover/single:opacity-100"
                            title="Download video"
                          >
                            <Download size={14} />
                          </a>
                        ) : null}
                      </div>
                    ) : null}

                    {message.mediaUrl && message.messageType === 'audio' ? (
                      <AudioMessageBubble
                        url={message.mediaUrl}
                        fallbackDurationSec={message.mediaDurationSec}
                        mimeType={message.mediaMimeType}
                        controlsList={canDownloadMedia ? undefined : 'nodownload'}
                      />
                    ) : null}

                    {message.mediaUrl && message.messageType === 'file' ? (
                      <div className="mb-1 flex items-center gap-3 rounded-lg bg-black/5 px-3 py-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#00a884] text-white">
                          <FileText size={20} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#111b21]">{getFileName(message.mediaUrl, message.mediaOriginalName)}</p>
                          <p className="text-xs text-[#667781]">{formatFileSize(message.fileSize)} {canDownloadFile ? '- Click to download' : ''}</p>
                        </div>
                        {canDownloadFile ? (
                          <a
                            href={`${message.mediaUrl}${message.mediaUrl.includes('?') ? '&' : '?'}download=1`}
                            download={message.mediaOriginalName || true}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-full p-1 text-[#667781] transition hover:bg-black/10"
                            title="Download file"
                          >
                            <Download size={18} className="text-[#667781]" />
                          </a>
                        ) : null}
                      </div>
                    ) : null}

                    {message.text ? (
                      <p
                        className="break-words whitespace-pre-wrap text-[14.2px] leading-[19px] text-[#111b21] select-none"
                        title="Click to copy message"
                        onClick={(event) => {
                          event.stopPropagation()
                          copyMessageText(message.text, message.id)
                        }}
                      >
                        {message.text}
                      </p>
                    ) : null}

                    </div>

{/* ✅ WhatsApp-style reaction bubble — bottom corner-এ */}
{false && Array.isArray(message.reactions) && message.reactions.length > 0 ? (
  <div
    className={`absolute -bottom-2 z-10 flex items-center gap-0.5 rounded-full border border-white bg-white px-1.5 py-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.18)] ${
      isMine ? 'right-1.5' : 'left-1.5'
    }`}
  >
    {message.reactions.map((reaction) => (
      <button
        key={`${message.id}-reaction-${reaction.emoji}`}
        type="button"
        onClick={() => reactToMessage?.(message.id, reaction.emoji)}
        className={`flex items-center gap-0.5 text-sm leading-none transition-transform duration-150 hover:scale-125 active:scale-110 ${
          reaction.reactedByMe ? 'opacity-100' : 'opacity-90'
        }`}
        title="Toggle reaction"
      >
        <span className="text-[15px]">{reaction.emoji}</span>
        {reaction.count > 1 && (
          <span className="text-[11px] font-semibold text-[#3d4f5b]">
            {reaction.count}
          </span>
        )}
      </button>
    ))}
  </div>
) : null}
                    {Array.isArray(message.reactions) && message.reactions.length > 0 ? (
                      <div className={`-mt-1.5 relative z-10 flex ${alignAsOutgoing ? 'justify-end pr-2' : 'justify-start pl-2'}`}>
                        <div className="flex items-center gap-0.5 rounded-full border border-white/80 bg-white px-1.5 py-[2px] shadow-[0_1px_4px_rgba(0,0,0,0.16)]">
                          {message.reactions.map((reaction) => (
                            <button
                              key={`${message.id}-reaction-${reaction.emoji}`}
                              type="button"
                              onClick={() => openReactionDetails(message, reaction)}
                              className={`flex items-center gap-0.5 text-sm leading-none transition-transform duration-150 hover:scale-125 active:scale-110 ${
                                reaction.reactedByMe ? 'opacity-100' : 'opacity-90'
                              }`}
                              title="See who reacted"
                            >
                              <span className="text-[15px]">{reaction.emoji}</span>
                              {reaction.count > 1 ? (
                                <span className="text-[11px] font-semibold text-[#3d4f5b]">{reaction.count}</span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className={`mt-1 flex items-center gap-1 ${alignAsOutgoing ? 'justify-end' : 'justify-start'}`}>
                      {copiedMessageId === message.id ? <span className="text-[10px] text-[#00a884]">Copied</span> : null}
                      <span className="text-[10px] text-[#667781]">{metaText}</span>
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

                  {activeConversationType === 'direct' && !isTempMessage ? (
                    <button
                      type="button"
                      onClick={(event) => openReactionPickerAt(message, event.currentTarget)}
                      className="mb-1 hidden rounded p-1 text-[#8696a0] opacity-0 transition hover:bg-black/5 group-hover:opacity-100 md:inline-flex"
                      aria-label="React to message"
                      title="React"
                    >
                      <SmilePlus size={14} />
                    </button>
                  ) : null}

                  {activeConversationType === 'direct' && isMine && !isTempMessage ? (
                    <button
                      type="button"
                      onClick={() => requestDeleteMessage(message.id)}
                      className="mb-1 rounded p-1 text-[#8696a0] transition hover:bg-black/5"
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

      <footer
        className="border-t border-[#e4e4e4] bg-[#f0f2f5] p-2 md:p-3"
        style={{ paddingBottom: `calc(max(0.5rem, env(safe-area-inset-bottom)) + ${keyboardInset}px)` }}
      >
        <div className="mx-auto max-w-3xl">
          {recordingError ? (
            <div className="mb-2 rounded-md bg-[#fff1f1] px-3 py-2 text-xs text-[#cc1744]">{recordingError}</div>
          ) : null}

          {!isConversationBlocked && pendingMedia?.length > 0 ? (
            <div className="mb-2 rounded-lg border border-[#d7e0e4] bg-white p-2">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-[#1f2c34]">{pendingMedia.length} media selected</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clearPendingMedia}
                    disabled={!canSendToActiveChat}
                    className="text-xs font-medium text-[#667781] hover:text-[#1f2c34]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={sendPendingMedia}
                    disabled={uploadingMedia || !canSendToActiveChat}
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

          {isConversationBlocked ? (
            <div className="rounded-2xl border border-[#ffd7df] bg-[#fff4f6] px-4 py-3 text-center text-sm font-semibold text-[#9f2f49]">
              You can no longer message each other.
            </div>
          ) : (
          <div className={`flex w-full items-center gap-2 ${isRecording ? 'flex-wrap sm:flex-nowrap' : 'flex-nowrap'}`}>
            <button
              type="button"
              onClick={() => mediaInputRef.current?.click()}
              disabled={!canSendToActiveChat || uploadingMedia || isRecording}
              className="shrink-0 rounded-lg bg-white p-2 text-[#54656f] transition hover:bg-[#edf0f2] disabled:cursor-not-allowed disabled:opacity-60"
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
              disabled={!canSendToActiveChat || uploadingMedia}
              className={`shrink-0 rounded-lg p-2 transition ${
                isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-white text-[#54656f] hover:bg-[#edf0f2]'
              } disabled:cursor-not-allowed disabled:opacity-60`}
              aria-label={isRecording ? 'Stop recording' : 'Record voice'}
            >
              {isRecording ? <Square size={18} /> : <Mic size={18} />}
            </button>
            {isRecording ? (
              <div className="order-last basis-full rounded-lg bg-[#fff1f1] px-3 py-2 text-xs font-semibold text-[#cc1744] sm:order-none sm:basis-auto">
                Recording {formatDuration(recordingSeconds)}
              </div>
            ) : null}
            <textarea
              ref={draftInputRef}
              placeholder={
                !activeChat
                  ? 'Select a chat first'
                  : hasBlockedMe
                    ? 'This user blocked you'
                    : isRecording
                      ? 'Recording in progress...'
                      : 'Type a message...'
              }
              value={draftMessage}
              onChange={(event) => {
                setDraftMessage(event.target.value)
                autoResizeDraft()
              }}
              onFocus={ensureInputVisible}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !isRecording) {
                  event.preventDefault()
                  sendMessage()
                }
              }}
              disabled={!canSendToActiveChat || isRecording}
              rows={1}
              className="max-h-28 min-h-[38px] min-w-0 flex-1 resize-none rounded-lg border border-[#e3e7ea] bg-white px-3 py-2 text-sm leading-5 outline-none placeholder:text-[#7a8b95] focus:border-[#25d366] disabled:cursor-not-allowed disabled:bg-[#f7f7f7]"
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={!canSendToActiveChat || uploadingMedia || isRecording}
              className="shrink-0 rounded-lg bg-[#25d366] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#1fab53] disabled:cursor-not-allowed disabled:opacity-60 md:px-4"
            >
              {uploadingMedia ? 'Uploading...' : 'Send'}
            </button>
          </div>
          )}
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
              <video
                src={previewMedia.url}
                controls
                controlsList={canDownloadMedia ? undefined : 'nodownload'}
                autoPlay
                className="max-h-[78vh] w-full rounded"
              />
            ) : (
              <img src={previewMedia.url} alt={previewMedia.name} className="max-h-[78vh] w-full rounded object-contain" />
            )}
            {canDownloadMedia ? (
              <div className="mt-2 flex justify-end">
                <a
                  href={`${previewMedia.url}${previewMedia.url.includes('?') ? '&' : '?'}download=1`}
                  download={previewMedia.name || true}
                  className="rounded-md bg-[#25d366] px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Download
                </a>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {reactionDetails ? (
        <div
          className="absolute inset-0 z-40 grid place-items-center bg-black/30 p-4 backdrop-blur-[1px]"
          onClick={() => setReactionDetails(null)}
        >
          <div
            className="w-full max-w-xs rounded-2xl bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.22)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-[#111b21]">{reactionDetails.emoji} Reactions</p>
                <p className="text-xs text-[#667781]">{reactionDetails.reactors.length} people reacted</p>
              </div>
              <button
                type="button"
                onClick={() => setReactionDetails(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#60727f] transition hover:bg-[#f1f5f9]"
                aria-label="Close reaction details"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
              {reactionDetails.reactors.map((reactor) => (
                <div key={`${reactionDetails.messageId}-${reactionDetails.emoji}-${reactor.id}`} className="flex items-center justify-between rounded-xl bg-[#f7f8fa] px-3 py-2">
                  <span className="truncate text-sm text-[#111b21]">
                    {reactor.username}
                    {reactor.reactedByMe ? ' (You)' : ''}
                  </span>
                  <span className="ml-3 text-base leading-none">{reactionDetails.emoji}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {reactionPicker ? (
        <div
          className="fixed z-50 -translate-y-full rounded-full border border-[#d6e0e7] bg-white/95 px-2 py-1 shadow-[0_16px_40px_rgba(15,23,42,0.18)] backdrop-blur"
          style={{ left: reactionPicker.x, top: reactionPicker.y, transform: reactionPicker.placeBelow ? 'translate(-50%, 0%)' : 'translate(-50%, -105%)' }}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-1">
            {REACTION_OPTIONS.map((emoji) => (
              <button
                key={`picker-${emoji}`}
                type="button"
                onClick={() => onReactionPick(emoji)}
               className="rounded-full px-1.5 py-1 text-lg leading-none transition-all duration-150 
           hover:scale-[1.35] hover:-translate-y-1 hover:bg-[#f1f5f9] active:scale-110 
           cursor-pointer"
                aria-label={`React with ${emoji}`}
                title={emoji}
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setReactionPicker(null)}
              className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-[#60727f] transition hover:bg-[#f1f5f9]"
              aria-label="Close reaction picker"
            >
              <SmilePlus size={14} />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default ChatPanel
