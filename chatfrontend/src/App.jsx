import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import AuthScreen from './components/chat/AuthScreen'
import ChatSidebar from './components/chat/ChatSidebar'
import ChatPanel from './components/chat/ChatPanel'
import ProfileDrawer from './components/chat/ProfileDrawer'
import ConfirmDialog from './components/chat/ConfirmDialog'
import ZegoCallModal from './components/chat/ZegoCallModal'
import PermissionHelpModal from './components/chat/PermissionHelpModal'
import OutgoingCallOverlay from './components/chat/OutgoingCallOverlay'
import IncomingCallOverlay from './components/chat/IncomingCallOverlay'
import './App.css'

const runtimeHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
const sameOriginBase = typeof window !== 'undefined' ? window.location.origin : `http://${runtimeHost}:5173`
const API_URL = import.meta.env.VITE_API_URL || ''
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || sameOriginBase
const UPLOAD_SERVER_URL = import.meta.env.VITE_UPLOAD_SERVER_URL || ''
const UPLOAD_FILE_FIELD = import.meta.env.VITE_UPLOAD_FILE_FIELD || 'file'
const CHAT_LIST_PAGE_SIZE = 30
const MESSAGE_PAGE_SIZE = 40
const ZEGO_APP_ID = Number(import.meta.env.VITE_ZEGO_APP_ID || 0)
const ZEGO_SERVER_SECRET = import.meta.env.VITE_ZEGO_SERVER_SECRET || ''
const ENABLE_WEB_PUSH = String(import.meta.env.VITE_ENABLE_WEB_PUSH || '1') !== '0'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

function App({ portalRole = 'user' }) {
  const [token, setToken] = useState(localStorage.getItem('chat_token') || '')
  const [currentUser, setCurrentUser] = useState(null)
  const [users, setUsers] = useState([])
  const [groups, setGroups] = useState([])
  const [usersPage, setUsersPage] = useState(1)
  const [usersHasMore, setUsersHasMore] = useState(true)
  const [loadingMoreSidebar, setLoadingMoreSidebar] = useState(false)
  const [messagesByUser, setMessagesByUser] = useState({})
  const [directPaginationById, setDirectPaginationById] = useState({})
  const [activeConversation, setActiveConversation] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [contactIdentifier, setContactIdentifier] = useState('')
  const [addingContact, setAddingContact] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [submitting, setSubmitting] = useState(false)
  const [loadingApp, setLoadingApp] = useState(false)
  const [error, setError] = useState('')
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [pendingMedia, setPendingMedia] = useState([])
  const [uploadingProfile, setUploadingProfile] = useState(false)
  const [registerProfileFile, setRegisterProfileFile] = useState(null)
  const [incomingCall, setIncomingCall] = useState(null)
  const [outgoingCall, setOutgoingCall] = useState(null)
  const [activeCall, setActiveCall] = useState(null)
  const [permissionHelp, setPermissionHelp] = useState(null)

  const [loginForm, setLoginForm] = useState({ identifier: '', password: '' })
  const [registerForm, setRegisterForm] = useState({
    username: '',
    email: '',
    mobileNumber: '',
    dateOfBirth: '',
    password: '',
  })

  const socketRef = useRef(null)
  const messageListRef = useRef(null)
  const suppressAutoScrollRef = useRef(false)
  const seenRequestRef = useRef({})
  const serviceWorkerRegRef = useRef(null)
  const ringtoneIntervalRef = useRef(null)
  const ringtoneAudioContextRef = useRef(null)
  const ringtoneElementRef = useRef(null)
  const incomingAlertTokenRef = useRef(0)
  const outgoingRingIntervalRef = useRef(null)
  const outgoingRingAudioContextRef = useRef(null)
  const hasPushSubscribedRef = useRef(false)

  const activeConversationType = activeConversation?.type || null
  const portalBadgeLabel =
    portalRole === 'admin'
      ? 'Admin'
      : portalRole === 'model_admin'
        ? 'Model Admin'
        : ''
  const activeChat = useMemo(() => {
    if (!activeConversation) return null
    return users.find((u) => u.id === activeConversation.id) || null
  }, [activeConversation, users])

  const activeMessages = useMemo(() => {
    if (!activeConversation) return []
    return messagesByUser[String(activeConversation.id)] || []
  }, [activeConversation, messagesByUser])

  const activePaginationMeta = useMemo(() => {
    if (!activeConversation) return { hasMore: false, loadingOlder: false }
    return directPaginationById[String(activeConversation.id)] || { hasMore: false, loadingOlder: false }
  }, [activeConversation, directPaginationById])

  const replaceTempWithServerMessage = (list, tempId, serverMessage) => {
    const hasServer = list.some((m) => m.id === serverMessage?.id)
    return list
      .map((m) => {
        if (m.id !== tempId) return m
        return hasServer ? null : serverMessage
      })
      .filter(Boolean)
  }

  const clearPendingMedia = () => {
    setPendingMedia((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      })
      return []
    })
  }

  const forceScrollToBottom = (attempts = 6) => {
    let count = 0
    const run = () => {
      const list = messageListRef.current
      if (list) {
        list.scrollTop = list.scrollHeight
      }
      count += 1
      if (count < attempts) {
        requestAnimationFrame(run)
      }
    }
    requestAnimationFrame(run)
  }

  const mergeUniqueById = (prev = [], next = []) => {
    const map = new Map()
    ;[...prev, ...next].forEach((item) => {
      if (item?.id !== undefined && item?.id !== null) {
        map.set(item.id, item)
      }
    })
    return Array.from(map.values())
  }

  const stopIncomingAlert = () => {
    incomingAlertTokenRef.current += 1
    if (ringtoneIntervalRef.current) {
      clearInterval(ringtoneIntervalRef.current)
      ringtoneIntervalRef.current = null
    }
    if (navigator.vibrate) navigator.vibrate(0)
    if (ringtoneElementRef.current) {
      ringtoneElementRef.current.pause()
      ringtoneElementRef.current.currentTime = 0
      ringtoneElementRef.current = null
    }
    if (ringtoneAudioContextRef.current) {
      ringtoneAudioContextRef.current.close().catch(() => null)
      ringtoneAudioContextRef.current = null
    }
  }

  const playIncomingAlert = () => {
    stopIncomingAlert()
    const alertToken = incomingAlertTokenRef.current
    const startBeepFallback = () => {
      if (alertToken !== incomingAlertTokenRef.current) return
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return
      const audioContext = new AudioCtx()
      ringtoneAudioContextRef.current = audioContext
      const playPulse = () => {
        const now = audioContext.currentTime
        const osc = audioContext.createOscillator()
        const gainNode = audioContext.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(880, now)
        gainNode.gain.setValueAtTime(0.0001, now)
        gainNode.gain.exponentialRampToValueAtTime(0.18, now + 0.02)
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.28)
        osc.connect(gainNode)
        gainNode.connect(audioContext.destination)
        osc.start(now)
        osc.stop(now + 0.32)
      }

      playPulse()
      ringtoneIntervalRef.current = setInterval(playPulse, 1300)
      if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120])
    }

    const ringtonePath = '/sounds/incoming-call.mp3'
    try {
      const audio = new Audio(ringtonePath)
      audio.loop = true
      audio.preload = 'auto'
      const playPromise = audio.play()
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            if (alertToken !== incomingAlertTokenRef.current) {
              audio.pause()
              audio.currentTime = 0
              return
            }
            ringtoneElementRef.current = audio
            if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120])
          })
          .catch(() => {
            ringtoneElementRef.current = null
            startBeepFallback()
          })
      } else {
        ringtoneElementRef.current = audio
        if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120])
      }
      return
    } catch {
      // fallback below
    }

    try {
      startBeepFallback()
    } catch {
      // ignore if autoplay policy blocks audio context
    }
  }

  const stopOutgoingAlert = () => {
    if (outgoingRingIntervalRef.current) {
      clearInterval(outgoingRingIntervalRef.current)
      outgoingRingIntervalRef.current = null
    }
    if (outgoingRingAudioContextRef.current) {
      outgoingRingAudioContextRef.current.close().catch(() => null)
      outgoingRingAudioContextRef.current = null
    }
  }

  const playOutgoingAlert = () => {
    stopOutgoingAlert()
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return
      const audioContext = new AudioCtx()
      outgoingRingAudioContextRef.current = audioContext

      const playPulse = () => {
        const now = audioContext.currentTime
        const osc = audioContext.createOscillator()
        const gainNode = audioContext.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(510, now)
        gainNode.gain.setValueAtTime(0.0001, now)
        gainNode.gain.exponentialRampToValueAtTime(0.12, now + 0.03)
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.26)
        osc.connect(gainNode)
        gainNode.connect(audioContext.destination)
        osc.start(now)
        osc.stop(now + 0.3)
      }

      playPulse()
      outgoingRingIntervalRef.current = setInterval(playPulse, 1200)
    } catch {
      // ignore autoplay blocked case
    }
  }

  const closePermissionHelp = () => setPermissionHelp(null)
  const retryPermissionCheck = async () => {
    if (!permissionHelp) return
    const ok = await ensureCallDevicePermission(permissionHelp.callType || 'video')
    if (ok) setPermissionHelp(null)
  }

  const ensureCallDevicePermission = async (type = 'video') => {
    const needCamera = type !== 'audio'
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionHelp({
        callType: type,
        title: 'This browser does not support calling',
        message: 'Your browser does not support microphone/camera access.',
      })
      return false
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: needCamera,
      })
      stream.getTracks().forEach((track) => track.stop())
      return true
    } catch (error) {
      const errName = String(error?.name || '').toLowerCase()
      const blocked = errName.includes('notallowed') || errName.includes('permission')
      const missing = errName.includes('notfound') || errName.includes('overconstrained')
      const title = blocked
        ? `${needCamera ? 'Camera + microphone' : 'Microphone'} permission is blocked`
        : missing
          ? `${needCamera ? 'Camera or microphone' : 'Microphone'} not found`
          : `Cannot access ${needCamera ? 'camera/microphone' : 'microphone'}`

      setPermissionHelp({
        callType: type,
        title,
        message: blocked
          ? `Please allow ${needCamera ? 'camera and microphone' : 'microphone'} in browser site settings, then try again.`
          : 'Please check device availability and browser permissions, then try again.',
      })
      return false
    }
  }

  const ensureServiceWorker = async () => {
    if (!ENABLE_WEB_PUSH) return null
    if (!('serviceWorker' in navigator)) return null
    if (serviceWorkerRegRef.current) return serviceWorkerRegRef.current
    const reg = await navigator.serviceWorker.register('/sw.js')
    serviceWorkerRegRef.current = reg
    return reg
  }

  const ensurePushSubscription = async (authToken = token) => {
    if (!ENABLE_WEB_PUSH || !authToken) return
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (hasPushSubscribedRef.current) return

    const permission =
      Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission().catch(() => 'default')
    if (permission !== 'granted') return

    const registration = await ensureServiceWorker()
    if (!registration) return

    const vapid = await apiFetch('/api/notifications/vapid-public-key', {}, authToken).catch(() => null)
    const publicKey = vapid?.publicKey
    if (!publicKey) return

    const existing = await registration.pushManager.getSubscription()
    const subscription =
      existing ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }))

    if (!subscription) return
    await apiFetch(
      '/api/notifications/subscribe',
      {
        method: 'POST',
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      },
      authToken,
    ).catch(() => null)
    hasPushSubscribedRef.current = true
  }

  const clearAuthSession = (message = 'Session expired. Please login again.') => {
    stopIncomingAlert()
    stopOutgoingAlert()
    socketRef.current?.disconnect()
    socketRef.current = null
    localStorage.removeItem('chat_token')
    setToken('')
    setCurrentUser(null)
    setUsers([])
    setGroups([])
    setUsersPage(1)
    setUsersHasMore(true)
    setMessagesByUser({})
    setDirectPaginationById({})
    setActiveConversation(null)
    setError(message)
    setIncomingCall(null)
    setOutgoingCall(null)
    setActiveCall(null)
  }

  const apiFetch = async (path, options = {}, authToken = token) => {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(options.headers || {}),
      },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 401 && authToken) clearAuthSession(data.message || 'Unauthorized')
      const baseMessage = data.message || 'Request failed'
      const details = data.error && data.error !== baseMessage ? `: ${data.error}` : ''
      throw new Error(`${baseMessage}${details}`)
    }
    return data
  }

  const normalizeUploadUrl = (value) => {
    if (typeof value !== 'string') return ''
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (trimmed.startsWith('/')) return `${UPLOAD_SERVER_URL}${trimmed}`
    if (trimmed.startsWith('uploads/')) return `${UPLOAD_SERVER_URL}/${trimmed}`
    return ''
  }

  const pickUploadedUrl = (payload = {}) => {
    const candidates = [
      payload?.url,
      payload?.fileUrl,
      payload?.path,
      payload?.urls?.[0],
      payload?.urls?.[0]?.url,
      payload?.urls?.[0]?.path,
      payload?.data?.url,
      payload?.data?.fileUrl,
      payload?.data?.path,
      payload?.data?.urls?.[0],
      payload?.data?.urls?.[0]?.url,
      payload?.data?.urls?.[0]?.path,
      payload?.result?.url,
      payload?.result?.path,
      payload?.files?.[0]?.url,
      payload?.files?.[0]?.path,
    ]

    for (const value of candidates) {
      const normalized = normalizeUploadUrl(value)
      if (normalized) return normalized
    }
    throw new Error('Upload server did not return URL')
  }

  const uploadToExternalServer = async (file, mediaType, targetUniqueUsername) => {
    const uniqueUsername = targetUniqueUsername || currentUser?.uniqueUsername || currentUser?.username
    if (!uniqueUsername) throw new Error('User not ready for upload')
    const endpoint = `${UPLOAD_SERVER_URL}/upload/chat/${encodeURIComponent(uniqueUsername)}/${mediaType}`
    const fd = new FormData()
    fd.append(UPLOAD_FILE_FIELD, file)
    const res = await fetch(endpoint, { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'Upload failed')
    return pickUploadedUrl(data)
  }

  const fetchContacts = async (authToken = token, options = {}) => {
    const page = Number(options.page) > 0 ? Number(options.page) : 1
    const append = Boolean(options.append)
    const data = await apiFetch(`/api/users?page=${page}&limit=${CHAT_LIST_PAGE_SIZE}`, {}, authToken)
    const incoming = data.users || []
    setUsers((prev) => (append ? mergeUniqueById(prev, incoming) : incoming))
    setUsersPage(page)
    setUsersHasMore(Boolean(data.hasMore))
    return incoming
  }

  const loadDirectConversation = async (id, authToken = token, options = {}) => {
    const appendOlder = Boolean(options.appendOlder)
    const currentMeta = directPaginationById[String(id)] || { hasMore: true, loadingOlder: false, nextBeforeId: null, initialized: false }
    if (appendOlder && (currentMeta.loadingOlder || !currentMeta.hasMore)) return false

    const beforeId = appendOlder ? currentMeta.nextBeforeId : null
    setDirectPaginationById((prev) => ({
      ...prev,
      [String(id)]: { ...currentMeta, loadingOlder: appendOlder ? true : false },
    }))

    const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) })
    if (beforeId) params.set('beforeId', String(beforeId))
    const data = await apiFetch(`/api/messages/${id}?${params.toString()}`, {}, authToken)
    const incoming = data.messages || []

    setMessagesByUser((prev) => {
      const key = String(id)
      const existing = prev[key] || []
      return {
        ...prev,
        [key]: appendOlder ? [...incoming, ...existing] : incoming,
      }
    })
    setDirectPaginationById((prev) => ({
      ...prev,
      [String(id)]: {
        hasMore: Boolean(data.hasMore),
        loadingOlder: false,
        nextBeforeId: data.nextBeforeId || null,
        initialized: true,
      },
    }))
    return incoming.length > 0
  }

  const openConversation = async (conversation) => {
    if (conversation.type !== 'direct') return
    setActiveConversation(conversation)
    setIsMobileChatOpen(true)
    setIsProfileOpen(false)
    setProfileMenuOpen(false)
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      window.history.pushState({ mobileChatOpen: true, conversation }, '')
    }
    try {
      const meta = directPaginationById[String(conversation.id)]
      if (!meta?.initialized) await loadDirectConversation(conversation.id)
      suppressAutoScrollRef.current = false
      forceScrollToBottom(8)
    } catch (e) {
      setError(e.message)
    }
  }

  const loadOlderMessages = async () => {
    if (!activeConversation) return
    const listEl = messageListRef.current
    const prevHeight = listEl?.scrollHeight || 0
    const prevTop = listEl?.scrollTop || 0
    suppressAutoScrollRef.current = true

    try {
      await loadDirectConversation(activeConversation.id, token, { appendOlder: true })

      requestAnimationFrame(() => {
        const node = messageListRef.current
        if (node) {
          const nextHeight = node.scrollHeight
          node.scrollTop = nextHeight - prevHeight + prevTop
        }
        requestAnimationFrame(() => {
          suppressAutoScrollRef.current = false
        })
      })
    } catch (err) {
      suppressAutoScrollRef.current = false
      setError(err.message)
    }
  }

  const loadMoreSidebarData = async () => {
    if (loadingMoreSidebar) return
    if (!usersHasMore) return
    setLoadingMoreSidebar(true)
    try {
      if (usersHasMore) await fetchContacts(token, { page: usersPage + 1, append: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingMoreSidebar(false)
    }
  }

  useEffect(() => {
    return () => {
      clearPendingMedia()
    }
  }, [])

  useEffect(() => {
    clearPendingMedia()
  }, [activeConversation?.id, activeConversation?.type])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.history.replaceState({ mobileChatOpen: false }, '')
    const onPopState = (event) => {
      const state = event.state
      if (state?.mobileChatOpen) {
        setIsMobileChatOpen(true)
        return
      }
      setIsMobileChatOpen(false)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const backToList = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches && window.history.state?.mobileChatOpen) {
      window.history.back()
      return
    }
    setIsMobileChatOpen(false)
  }

  useEffect(() => {
    if (!outgoingCall) return
    const timer = setTimeout(() => {
      setOutgoingCall((prev) => {
        if (!prev || prev.roomId !== outgoingCall.roomId) return prev
        if (prev.peerUser?.id) {
          socketRef.current?.emit('call:cancel', {
            toUserId: prev.peerUser.id,
            roomId: prev.roomId,
            reason: 'no-answer',
          })
        }
        setError('No answer from other user')
        return null
      })
    }, 45000)
    return () => clearTimeout(timer)
  }, [outgoingCall])

  useEffect(() => {
    if (!outgoingCall) {
      stopOutgoingAlert()
      return
    }
    if (outgoingCall.status === 'calling' || outgoingCall.status === 'ringing') {
      playOutgoingAlert()
      return () => stopOutgoingAlert()
    }
    stopOutgoingAlert()
    return undefined
  }, [outgoingCall])

  useEffect(() => {
    if (!incomingCall) {
      stopIncomingAlert()
      return
    }
    playIncomingAlert()

    if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`${incomingCall.fromUser?.username || 'Unknown user'} is calling`, {
        body: incomingCall.callType === 'audio' ? 'Incoming audio call' : 'Incoming video call',
        tag: `incoming-${incomingCall.roomId}`,
        renotify: true,
      })
    }

    return () => {
      stopIncomingAlert()
    }
  }, [incomingCall])

  useEffect(() => {
    if (!token) return
    let mounted = true
    ;(async () => {
      setLoadingApp(true)
      setError('')
      try {
        const me = await apiFetch('/api/auth/me', {}, token)
        if (!mounted) return
        setCurrentUser(me.user)
        ensurePushSubscription(token).catch(() => null)
        const fetchedUsers = await fetchContacts(token, { page: 1, append: false })
        if (!mounted) return
        if (fetchedUsers[0]) {
          setActiveConversation({ type: 'direct', id: fetchedUsers[0].id })
          await loadDirectConversation(fetchedUsers[0].id, token)
          forceScrollToBottom(8)
        }

        const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] })
        socket.on('chat:message', (message) => {
          const otherId = Number(message.senderId) === Number(me.user.id) ? message.receiverId : message.senderId
          const isFromMe = Number(message.senderId) === Number(me.user.id)
          setMessagesByUser((prev) => {
            const key = String(otherId)
            const list = prev[key] || []
            if (list.some((m) => m.id === message.id)) return prev
            return { ...prev, [key]: [...list, message] }
          })
          setUsers((prev) =>
            prev.map((u) => {
              if (u.id !== otherId) return u
              const shouldIncreaseUnread = !isFromMe && !(activeConversation?.type === 'direct' && Number(activeConversation.id) === Number(otherId))
              return {
                ...u,
                lastMessageAt: message.createdAt || new Date().toISOString(),
                unreadCount: shouldIncreaseUnread ? (Number(u.unreadCount) || 0) + 1 : Number(u.unreadCount) || 0,
              }
            }),
          )
        })
        socket.on('chat:presence', (payload) => {
          setUsers((prev) => prev.map((u) => (u.id === payload.userId ? { ...u, isOnline: payload.isOnline, lastSeen: payload.lastSeen } : u)))
        })
        socket.on('chat:messages-seen', (payload) => {
          const withUserId = Number(payload?.withUserId)
          if (!Number.isInteger(withUserId)) return
          const seenSet = new Set((payload.messageIds || []).map((id) => Number(id)))
          setMessagesByUser((prev) => {
            const key = String(withUserId)
            return {
              ...prev,
              [key]: (prev[key] || []).map((m) => (seenSet.has(Number(m.id)) ? { ...m, seen: true } : m)),
            }
          })
          setUsers((prev) => prev.map((u) => (u.id === withUserId ? { ...u, unreadCount: 0 } : u)))
        })
        socket.on('call:incoming', (payload) => {
          setIncomingCall(payload)
          socket.emit('call:ringing', {
            toUserId: payload?.fromUser?.id,
            roomId: payload?.roomId,
          })
        })
        socket.on('call:busy', (payload) => {
          const busyUser = payload?.byUser?.username || 'User'
          const busyMessage = payload?.message || `${busyUser} is busy on another call`
          setOutgoingCall((prev) => {
            if (!prev) return prev
            if (payload?.roomId && prev.roomId !== payload.roomId) return prev
            return null
          })
          setError(busyMessage)
        })
        socket.on('call:ringing', (payload) => {
          setOutgoingCall((prev) => {
            if (!prev || prev.roomId !== payload?.roomId) return prev
            return { ...prev, status: 'ringing' }
          })
        })
        socket.on('call:response', (payload) => {
          if (payload?.accepted) {
            setOutgoingCall((prev) => {
              if (!prev || prev.roomId !== payload.roomId) return prev
              setActiveCall({
                roomId: prev.roomId,
                callType: prev.callType,
                status: 'connected',
                peerUser: prev.peerUser,
                startedAt: Date.now(),
              })
              return null
            })
            return
          }
          if (!payload?.accepted) {
            setIncomingCall((prev) => (prev?.roomId === payload?.roomId ? null : prev))
            setOutgoingCall((prev) => {
              if (!prev || prev.roomId !== payload?.roomId) return prev
              const reason = String(payload?.reason || '')
              if (reason === 'busy') setError(`${payload?.byUser?.username || 'User'} is busy`)
              else setError(`${payload?.byUser?.username || 'User'} declined the call`)
              return null
            })
            setActiveCall(null)
          }
        })
        socket.on('call:canceled', (payload) => {
          const roomId = payload?.roomId
          if (!roomId) return
          setIncomingCall((prev) => (prev?.roomId === roomId ? null : prev))
          setOutgoingCall((prev) => {
            if (!prev || prev.roomId !== roomId) return prev
            return null
          })
          if (String(payload?.reason || '') === 'no-answer') {
            setError('No answer from other user')
          } else if (payload?.byUser?.username) {
            setError(`${payload.byUser.username} canceled the call`)
          }
        })
        socket.on('call:ended', (payload) => {
          const roomId = payload?.roomId
          if (!roomId) return
          setIncomingCall((prev) => (prev?.roomId === roomId ? null : prev))
          setOutgoingCall((prev) => (prev?.roomId === roomId ? null : prev))
          setActiveCall((prev) => (prev?.roomId === roomId ? null : prev))
        })
        socketRef.current = socket
      } catch (e) {
        setError(e.message)
        clearAuthSession('')
      } finally {
        if (mounted) setLoadingApp(false)
      }
    })()
    return () => {
      mounted = false
      stopIncomingAlert()
      stopOutgoingAlert()
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [token])

  useEffect(() => {
    if (!token || !ENABLE_WEB_PUSH) return
    ensureServiceWorker().catch(() => null)
  }, [token])

  useEffect(() => {
    if (suppressAutoScrollRef.current) return
    const list = messageListRef.current
    if (!list) return
    requestAnimationFrame(() => list.scrollTo({ top: list.scrollHeight, behavior: activeMessages.length <= 1 ? 'auto' : 'smooth' }))
  }, [activeMessages.length, activeConversation?.id, activeConversationType])

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = !q
      ? [...users]
      : users.filter((u) => u.username.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.mobileNumber || '').toLowerCase().includes(q))

    const getUserSortTime = (user) => {
      const list = messagesByUser[String(user.id)] || []
      const lastLoadedMessage = list[list.length - 1]
      const candidates = [lastLoadedMessage?.createdAt, user.lastMessageAt, user.updatedAt, user.createdAt]
      for (const value of candidates) {
        const ts = new Date(value || '').getTime()
        if (Number.isFinite(ts) && ts > 0) return ts
      }
      return 0
    }

    filtered.sort((a, b) => {
      const diff = getUserSortTime(b) - getUserSortTime(a)
      if (diff !== 0) return diff
      return String(a.username || '').localeCompare(String(b.username || ''))
    })

    return filtered
  }, [users, searchQuery, messagesByUser])

  const getInitials = (name = '') => name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()
  const formatTime = (value) => (value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '')
  const formatLastSeen = (value) => {
    if (!value) return 'offline'
    const diff = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
    if (diff < 60) return 'last active just now'
    if (diff < 3600) return `last active ${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `last active ${Math.floor(diff / 3600)}h ago`
    return `last active ${Math.floor(diff / 86400)}d ago`
  }

  const getLastMessageForUser = (id) => {
    const list = messagesByUser[String(id)] || []
    return list[list.length - 1] || null
  }
  const onLogin = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const payload = {
        ...loginForm,
        identifier: String(loginForm.identifier || '').trim(),
      }
      const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }, '')
      localStorage.setItem('chat_token', data.token)
      setToken(data.token)
      setLoginForm({ identifier: '', password: '' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const onRegister = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    let rollbackToken = ''
    let rollbackRequested = false
    try {
      const payload = { ...registerForm, email: registerForm.email || undefined, mobileNumber: registerForm.mobileNumber || undefined }
      const data = await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }, '')
      rollbackToken = data?.token || ''
      if (registerProfileFile) {
        const uniqueUsername = data?.user?.uniqueUsername || data?.user?.username
        const profileMediaUrl = await uploadToExternalServer(registerProfileFile, 'profile', uniqueUsername)
        await apiFetch('/api/users/profile-media', { method: 'POST', body: JSON.stringify({ profileMediaUrl }) }, data.token)
      }
      localStorage.setItem('chat_token', data.token)
      setToken(data.token)
      setRegisterForm({ username: '', email: '', mobileNumber: '', dateOfBirth: '', password: '' })
      setRegisterProfileFile(null)
    } catch (err) {
      if (rollbackToken) {
        rollbackRequested = true
        await apiFetch('/api/auth/rollback-registration', { method: 'POST' }, rollbackToken).catch(() => null)
      }
      const rollbackNote = rollbackRequested ? ' Registration data was rolled back. Please try again.' : ''
      setError(`${err.message}${rollbackNote}`)
    } finally {
      setSubmitting(false)
    }
  }

  const onAddContact = async (event) => {
    event?.preventDefault?.()
    const identifier = contactIdentifier.trim()
    if (!identifier) return { ok: false }
    setAddingContact(true)
    setError('')
    try {
      const data = await apiFetch('/api/users/contacts', { method: 'POST', body: JSON.stringify({ identifier }) })
      const contacts = await fetchContacts(token, { page: 1, append: false })
      if (data.contact?.id && contacts.some((c) => c.id === data.contact.id)) {
        await openConversation({ type: 'direct', id: data.contact.id })
      }
      setContactIdentifier('')
      return { ok: true }
    } catch (err) {
      setError(err.message)
      return { ok: false }
    } finally {
      setAddingContact(false)
    }
  }

  const lookupContact = async (identifier) => apiFetch(`/api/users/lookup?identifier=${encodeURIComponent(String(identifier || '').trim())}`)

  const sendMessage = async () => {
    const text = draftMessage.trim()
    if (!text || !activeConversation || !currentUser) return
    const tempId = `temp-${Date.now()}`
    const temp = {
      id: tempId,
      senderId: currentUser.id,
      receiverId: activeConversation.id,
      text,
      messageType: 'text',
      createdAt: new Date().toISOString(),
      clientStatus: 'sending',
    }
    setMessagesByUser((prev) => {
      const key = String(activeConversation.id)
      return { ...prev, [key]: [...(prev[key] || []), temp] }
    })
    setUsers((prev) =>
      prev.map((u) => (u.id === activeConversation.id ? { ...u, lastMessageAt: temp.createdAt } : u)),
    )
    setDraftMessage('')

    const socket = socketRef.current
    if (socket?.connected && activeConversation.type === 'direct') {
      socket.emit('chat:send', { toUserId: activeConversation.id, text }, (ack) => {
        if (!ack?.ok) return setError(ack?.message || 'Message failed')
        setMessagesByUser((prev) => {
          const key = String(activeConversation.id)
          const list = prev[key] || []
          return { ...prev, [key]: replaceTempWithServerMessage(list, tempId, ack.message) }
        })
      })
      return
    }
    try {
      const data = await apiFetch(`/api/messages/${activeConversation.id}`, { method: 'POST', body: JSON.stringify({ text }) })
      setMessagesByUser((prev) => {
        const key = String(activeConversation.id)
        const list = prev[key] || []
        return { ...prev, [key]: replaceTempWithServerMessage(list, tempId, data.message) }
      })
    } catch (err) {
      setError(err.message)
    }
  }

  const sendMedia = async (file, options = {}) => {
    if (!file || !activeConversation) return
    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    const isAudio = file.type.startsWith('audio/')
    const mediaFolder = isImage ? 'images' : isVideo ? 'videos' : isAudio ? 'audios' : 'files'
    const messageType = isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : 'file'
    if (!options.skipUploadingState) setUploadingMedia(true)
    try {
      const mediaUrl = await uploadToExternalServer(file, mediaFolder)
      const data = await apiFetch(`/api/messages/${activeConversation.id}`, {
        method: 'POST',
        body: JSON.stringify({
          mediaUrl,
          messageType,
          mediaGroupId: options.mediaGroupId || null,
          mediaMimeType: file.type || null,
          mediaOriginalName: file.name || null,
          mediaDurationSec: messageType === 'audio' ? Math.floor(Number(options.mediaDurationSec || 0)) : null,
          text: '',
        }),
      })
      setMessagesByUser((prev) => {
        const key = String(activeConversation.id)
        const list = prev[key] || []
        if (list.some((m) => m.id === data.message?.id)) return prev
        return { ...prev, [key]: [...list, data.message] }
      })
      setUsers((prev) =>
        prev.map((u) => (u.id === activeConversation.id ? { ...u, lastMessageAt: data.message?.createdAt || new Date().toISOString() } : u)),
      )
    } catch (err) {
      setError(err.message)
    } finally {
      if (!options.skipUploadingState) setUploadingMedia(false)
    }
  }

  const createMediaGroupId = () => `mg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const sendMediaBatch = async (files) => {
    if (!Array.isArray(files) || files.length === 0) return
    const picked = files.slice(0, 10)
    const canGroup = picked.every((file) => file?.type?.startsWith('image/') || file?.type?.startsWith('video/'))
    const mediaGroupId = canGroup && picked.length > 1 ? createMediaGroupId() : null

    setUploadingMedia(true)
    try {
      for (const file of picked) {
        // Keep sequential uploads so conversation order remains stable.
        await sendMedia(file, { mediaGroupId, skipUploadingState: true })
      }
    } finally {
      setUploadingMedia(false)
    }
  }

  const pickMediaFiles = async (files) => {
    if (!Array.isArray(files) || files.length === 0 || !activeConversation) return
    const picked = files.slice(0, 10)
    const allVisual = picked.every((file) => file?.type?.startsWith('image/') || file?.type?.startsWith('video/'))

    if (!allVisual) {
      await sendMediaBatch(picked)
      return
    }

    setPendingMedia((prev) => {
      const remain = Math.max(0, 10 - prev.length)
      const nextFiles = picked.slice(0, remain)
      const nextItems = nextFiles.map((file) => ({
        id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        kind: file.type.startsWith('video/') ? 'video' : 'image',
      }))
      return [...prev, ...nextItems]
    })
  }

  const removePendingMedia = (pendingId) => {
    setPendingMedia((prev) => {
      const target = prev.find((item) => item.id === pendingId)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((item) => item.id !== pendingId)
    })
  }

  const sendPendingMedia = async () => {
    if (pendingMedia.length === 0) return
    const files = pendingMedia.map((item) => item.file)
    await sendMediaBatch(files)
    clearPendingMedia()
  }

  const uploadProfileMedia = async (file) => {
    if (!file) return
    setUploadingProfile(true)
    try {
      const profileMediaUrl = await uploadToExternalServer(file, 'profile')
      const data = await apiFetch('/api/users/profile-media', { method: 'POST', body: JSON.stringify({ profileMediaUrl }) })
      setCurrentUser((prev) => ({ ...prev, ...(data.user || {}), profileMediaUrl }))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploadingProfile(false)
    }
  }

  const deleteMessage = async (messageId) => {
    if (!activeConversation || activeConversation.type !== 'direct') return
    await apiFetch(`/api/messages/${messageId}`, { method: 'DELETE' })
    setMessagesByUser((prev) => {
      const key = String(activeConversation.id)
      return { ...prev, [key]: (prev[key] || []).filter((m) => m.id !== messageId) }
    })
  }

  const deleteMessages = async (messageIds = []) => {
    if (!activeConversation || activeConversation.type !== 'direct') return
    const normalized = Array.from(
      new Set(
        (Array.isArray(messageIds) ? messageIds : [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id)),
      ),
    )
    if (!normalized.length) return
    await Promise.all(normalized.map((id) => apiFetch(`/api/messages/${id}`, { method: 'DELETE' })))
    setMessagesByUser((prev) => {
      const key = String(activeConversation.id)
      const removeSet = new Set(normalized)
      return { ...prev, [key]: (prev[key] || []).filter((m) => !removeSet.has(Number(m.id))) }
    })
  }

  const clearChat = async () => {
    if (!activeConversation || activeConversation.type !== 'direct') return
    await apiFetch(`/api/messages/chat/${activeConversation.id}`, { method: 'DELETE' })
    setMessagesByUser((prev) => ({ ...prev, [String(activeConversation.id)]: [] }))
  }

  const deleteChat = async () => {
    if (!activeConversation || activeConversation.type !== 'direct') return
    await apiFetch(`/api/messages/chat/${activeConversation.id}`, { method: 'DELETE' })
    await apiFetch(`/api/users/contacts/${activeConversation.id}`, { method: 'DELETE' })
    setUsers((prev) => prev.filter((u) => u.id !== activeConversation.id))
    setMessagesByUser((prev) => {
      const next = { ...prev }
      delete next[String(activeConversation.id)]
      return next
    })
    setActiveConversation(null)
  }

  const requestLogout = () => setConfirmAction({ type: 'logout' })
  const requestDeleteMessage = (messageId) => setConfirmAction({ type: 'delete_message', messageId })
  const requestDeleteMessages = (messageIds) => setConfirmAction({ type: 'delete_messages', messageIds })
  const requestClearChat = () => setConfirmAction({ type: 'clear_chat' })
  const requestDeleteChat = () => setConfirmAction({ type: 'delete_chat' })

  const runConfirmAction = async () => {
    if (!confirmAction) return
    if (confirmAction.type === 'delete_message') await deleteMessage(confirmAction.messageId)
    else if (confirmAction.type === 'delete_messages') await deleteMessages(confirmAction.messageIds)
    else if (confirmAction.type === 'clear_chat') await clearChat()
    else if (confirmAction.type === 'delete_chat') await deleteChat()
    else if (confirmAction.type === 'logout') clearAuthSession('')
    setConfirmAction(null)
  }

  const startDirectCall = async (callType = 'video') => {
    if (activeConversationType !== 'direct' || !activeChat || !currentUser) return
    const a = Number(currentUser.id)
    const b = Number(activeChat.id)
    const roomId = `call_${Math.min(a, b)}_${Math.max(a, b)}_${Date.now()}`
    socketRef.current?.emit('call:invite', { toUserId: activeChat.id, roomId, callType }, (ack) => {
      if (!ack?.ok) {
        setOutgoingCall((prev) => (prev?.roomId === roomId ? null : prev))
        setError(ack?.message || 'Failed to start call')
      }
    })
    setOutgoingCall({
      roomId,
      callType,
      status: 'calling',
      peerUser: { id: activeChat.id, username: activeChat.username, profileMediaUrl: activeChat.profileMediaUrl || null },
    })
  }

  const startCallToUser = (chatUser, callType = 'video') => {
    if (!chatUser || !currentUser) return
    const targetId = Number(chatUser.id)
    if (!Number.isInteger(targetId)) return
    const a = Number(currentUser.id)
    const b = targetId
    const roomId = `call_${Math.min(a, b)}_${Math.max(a, b)}_${Date.now()}`
    socketRef.current?.emit('call:invite', { toUserId: targetId, roomId, callType }, (ack) => {
      if (!ack?.ok) {
        setOutgoingCall((prev) => (prev?.roomId === roomId ? null : prev))
        setError(ack?.message || 'Failed to start call')
      }
    })
    setOutgoingCall({
      roomId,
      callType,
      status: 'calling',
      peerUser: { id: targetId, username: chatUser.username, profileMediaUrl: chatUser.profileMediaUrl || null },
    })
  }

  const acceptIncomingCall = async () => {
    if (!incomingCall) return
    const callType = incomingCall.callType || 'video'
    socketRef.current?.emit('call:response', {
      toUserId: incomingCall.fromUser?.id,
      roomId: incomingCall.roomId,
      accepted: true,
    })
    setActiveCall({
      roomId: incomingCall.roomId,
      callType,
      status: 'connected',
      peerUser: incomingCall.fromUser || null,
      startedAt: Date.now(),
    })
    setOutgoingCall(null)
    setIncomingCall(null)
  }

  const rejectIncomingCall = () => {
    if (!incomingCall) return
    socketRef.current?.emit('call:response', {
      toUserId: incomingCall.fromUser?.id,
      roomId: incomingCall.roomId,
      accepted: false,
    })
    setIncomingCall(null)
  }

  const cancelOutgoingCall = () => {
    if (outgoingCall?.peerUser?.id) {
      socketRef.current?.emit('call:cancel', {
        toUserId: outgoingCall.peerUser.id,
        roomId: outgoingCall.roomId,
        reason: 'canceled',
      })
    }
    setOutgoingCall(null)
  }

  const endActiveCall = () => {
    setActiveCall((prev) => {
      if (prev?.roomId && prev?.peerUser?.id) {
        const startedAt = Number(prev.startedAt) || Date.now()
        const durationSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
        socketRef.current?.emit('call:end', {
          roomId: prev.roomId,
          toUserId: prev.peerUser.id,
          durationSec,
        })
      }
      return null
    })
  }

  if (!token) {
    return (
      <AuthScreen
        authMode={authMode}
        setAuthMode={setAuthMode}
        error={error}
        submitting={submitting}
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        registerForm={registerForm}
        setRegisterForm={setRegisterForm}
        registerProfileFile={registerProfileFile}
        setRegisterProfileFile={setRegisterProfileFile}
        onLogin={onLogin}
        onRegister={onRegister}
      />
    )
  }

  if (loadingApp) {
    return (
      <main className="h-[100dvh] overflow-hidden bg-[#e8dfd6] p-0">
        {portalBadgeLabel ? (
          <div className="pointer-events-none absolute right-3 top-3 z-40 rounded-full bg-[#111b21] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
            {portalBadgeLabel} Route
          </div>
        ) : null}
        <section className="relative flex h-full w-full overflow-hidden bg-white">
          <aside className="w-full bg-[#f8f8f8] md:max-w-sm md:border-r md:border-[#e4e4e4]">
            <div className="border-b border-[#dce4e8] bg-[#f0f2f5] px-4 pb-4 pt-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 animate-pulse rounded-full bg-[#d7dde1]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-28 animate-pulse rounded bg-[#d7dde1]" />
                  <div className="h-2.5 w-16 animate-pulse rounded bg-[#dfe4e8]" />
                </div>
              </div>
              <div className="mt-4 h-11 animate-pulse rounded-full bg-[#e2e7eb]" />
            </div>
            <div className="space-y-1 px-4 py-3">
              {[...Array(7)].map((_, i) => (
                <div key={`sk-user-${i}`} className="flex items-center gap-3 rounded-lg px-1 py-2">
                  <div className="h-11 w-11 animate-pulse rounded-full bg-[#d9dfe3]" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3 w-32 animate-pulse rounded bg-[#d7dde1]" />
                    <div className="h-2.5 w-24 animate-pulse rounded bg-[#e2e7eb]" />
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <div className="hidden flex-1 flex-col bg-[#efeae2] md:flex">
            <div className="border-b border-[#e4e4e4] bg-[#f0f2f5] px-5 py-4">
              <div className="h-4 w-44 animate-pulse rounded bg-[#d7dde1]" />
            </div>
            <div className="flex-1 space-y-3 px-8 py-6">
              {[...Array(8)].map((_, i) => (
                <div
                  key={`sk-msg-${i}`}
                  className={`h-12 animate-pulse rounded-2xl ${i % 2 === 0 ? 'w-56 bg-white/85' : 'ml-auto w-64 bg-[#d9fdd3]/80'}`}
                />
              ))}
            </div>
            <div className="border-t border-[#e4e4e4] bg-[#f0f2f5] px-4 py-3">
              <div className="h-10 animate-pulse rounded-full bg-white" />
            </div>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="h-[100dvh] overflow-hidden bg-[#e8dfd6] p-0">
      {portalBadgeLabel ? (
        <div className="pointer-events-none absolute right-3 top-3 z-40 rounded-full bg-[#111b21] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
          {portalBadgeLabel} Route
        </div>
      ) : null}
      <section className="relative flex h-full w-full overflow-hidden bg-white">
        <ChatSidebar
          isMobileChatOpen={isMobileChatOpen}
          currentUser={currentUser}
          logout={requestLogout}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onAddContact={onAddContact}
          lookupContact={lookupContact}
          contactIdentifier={contactIdentifier}
          setContactIdentifier={setContactIdentifier}
          addingContact={addingContact}
          uploadingProfile={uploadingProfile}
          onUploadProfile={uploadProfileMedia}
          error={error}
          filteredUsers={filteredUsers}
          activeConversation={activeConversation}
          openConversation={openConversation}
          getInitials={getInitials}
          getLastMessageForUser={getLastMessageForUser}
          formatTime={formatTime}
          formatLastSeen={formatLastSeen}
          onQuickAudioCall={(chatUser) => startCallToUser(chatUser, 'audio')}
          onQuickVideoCall={(chatUser) => startCallToUser(chatUser, 'video')}
          onReachListEnd={loadMoreSidebarData}
          loadingMoreSidebar={loadingMoreSidebar}
        />

        <ChatPanel
          isMobileChatOpen={isMobileChatOpen}
          backToList={backToList}
          activeChat={activeChat}
          activeConversationType={activeConversationType}
          groupMemberNames={{}}
          openProfile={() => setIsProfileOpen(true)}
          startAudioCall={() => startDirectCall('audio')}
          startVideoCall={() => startDirectCall('video')}
          getInitials={getInitials}
          profileMenuOpen={profileMenuOpen}
          setProfileMenuOpen={setProfileMenuOpen}
          requestClearChat={requestClearChat}
          requestDeleteChat={requestDeleteChat}
          messageListRef={messageListRef}
          activeMessages={activeMessages}
          currentUser={currentUser}
          formatTime={formatTime}
          formatLastSeen={formatLastSeen}
          requestDeleteMessage={requestDeleteMessage}
          requestDeleteMessages={requestDeleteMessages}
          draftMessage={draftMessage}
          setDraftMessage={setDraftMessage}
          sendMessage={sendMessage}
          sendMedia={sendMedia}
          onPickMediaFiles={pickMediaFiles}
          pendingMedia={pendingMedia}
          removePendingMedia={removePendingMedia}
          clearPendingMedia={clearPendingMedia}
          sendPendingMedia={sendPendingMedia}
          uploadingMedia={uploadingMedia}
          hasOlderMessages={Boolean(activePaginationMeta.hasMore)}
          loadingOlderMessages={Boolean(activePaginationMeta.loadingOlder)}
          loadOlderMessages={loadOlderMessages}
          markConversationSeen={async (otherUserId) => {
            if (!otherUserId || seenRequestRef.current[otherUserId]) return
            seenRequestRef.current[otherUserId] = true
            try {
              const data = await apiFetch(`/api/messages/${otherUserId}/seen`, { method: 'POST' })
              const idSet = new Set((data.messageIds || []).map((id) => Number(id)))
              setMessagesByUser((prev) => {
                const key = String(otherUserId)
                return {
                  ...prev,
                  [key]: (prev[key] || []).map((m) => (idSet.has(Number(m.id)) ? { ...m, seen: true } : m)),
                }
              })
            } finally {
              seenRequestRef.current[otherUserId] = false
            }
          }}
        />

        <ProfileDrawer
          activeChat={activeConversationType === 'direct' ? activeChat : null}
          isProfileOpen={isProfileOpen}
          closeProfile={() => setIsProfileOpen(false)}
          getInitials={getInitials}
        />

        <ConfirmDialog confirmAction={confirmAction} setConfirmAction={setConfirmAction} runConfirmAction={runConfirmAction} />
        <PermissionHelpModal
          permissionHelp={permissionHelp}
          onClose={closePermissionHelp}
          onRetry={retryPermissionCheck}
        />

        <OutgoingCallOverlay outgoingCall={outgoingCall} onCancel={cancelOutgoingCall} />

        <IncomingCallOverlay
          incomingCall={incomingCall}
          onAccept={acceptIncomingCall}
          onReject={rejectIncomingCall}
        />

        <ZegoCallModal
          open={Boolean(activeCall && activeCall.status === 'connected')}
          onClose={endActiveCall}
          appId={ZEGO_APP_ID}
          serverSecret={ZEGO_SERVER_SECRET}
          roomId={activeCall?.roomId || ''}
          userId={String(currentUser?.id || '')}
          userName={currentUser?.username || 'User'}
          callType={activeCall?.callType || 'video'}
          peerUser={activeCall?.peerUser || null}
          callStatus={activeCall?.status || 'connecting'}
          callStartedAt={activeCall?.startedAt || null}
        />
      </section>
    </main>
  )
}

export default App
