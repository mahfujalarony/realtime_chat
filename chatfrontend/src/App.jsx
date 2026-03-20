import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import AuthScreen from './components/chat/AuthScreen'
import ChatLoadingScreen from './components/chat/ChatLoadingScreen'
import ChatAppShell from './components/chat/ChatAppShell'
import useCallAlerts from './hooks/useCallAlerts'
import { clearAccessToken, fetchJsonWithAuth, fetchWithAuth, getAccessToken, logoutSession, refreshSession, setAccessToken, subscribeToAuth } from './lib/auth'
import './App.css'

const runtimeHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
const sameOriginBase = typeof window !== 'undefined' ? window.location.origin : `http://${runtimeHost}:5173`
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || sameOriginBase
const UPLOAD_SERVER_URL = import.meta.env.VITE_UPLOAD_SERVER_URL || ''
const UPLOAD_FILE_FIELD = import.meta.env.VITE_UPLOAD_FILE_FIELD || 'file'
const CHAT_LIST_PAGE_SIZE = 30
const MAX_LOADED_SIDEBAR_USERS = 180
const MAX_PINNED_SIDEBAR_USERS = 24
const MESSAGE_PAGE_SIZE = 40
const ZEGO_APP_ID = Number(import.meta.env.VITE_ZEGO_APP_ID || 0)
const ZEGO_SERVER_SECRET = import.meta.env.VITE_ZEGO_SERVER_SECRET || ''
const ENABLE_WEB_PUSH = String(import.meta.env.VITE_ENABLE_WEB_PUSH || '1') !== '0'
const MAX_REGISTER_PROFILE_SIZE = 5 * 1024 * 1024

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

function App({ portalRole = 'user' }) {
  const [token, setToken] = useState(() => getAccessToken())
  const [authReady, setAuthReady] = useState(() => Boolean(getAccessToken()))
  const [currentUser, setCurrentUser] = useState(null)
  const [users, setUsers] = useState([])
  const [usersCursor, setUsersCursor] = useState(null)
  const [usersHasMore, setUsersHasMore] = useState(true)
  const [loadingMoreSidebar, setLoadingMoreSidebar] = useState(false)
  const [messagesByUser, setMessagesByUser] = useState({})
  const [conversationMetaByUser, setConversationMetaByUser] = useState({})
  const [directPaginationById, setDirectPaginationById] = useState({})
  const [activeConversation, setActiveConversation] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [contactIdentifier, setContactIdentifier] = useState('')
  const [addingContact, setAddingContact] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [submitting, setSubmitting] = useState(false)
  const [loadingApp, setLoadingApp] = useState(false)
  const [error, setError] = useState('')
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [pendingMedia, setPendingMedia] = useState([])
  const [uploadingProfile, setUploadingProfile] = useState(false)
  const [registerProfileFile, setRegisterProfileFile] = useState(null)
  const [incomingCall, setIncomingCall] = useState(null)
  const [outgoingCall, setOutgoingCall] = useState(null)
  const [activeCall, setActiveCall] = useState(null)
  const [permissionHelp, setPermissionHelp] = useState(null)
  const [blockingUserId, setBlockingUserId] = useState(null)
  const [blockedUserIds, setBlockedUserIds] = useState({})

  const [loginForm, setLoginForm] = useState({ identifier: '', password: '' })
  const [registerForm, setRegisterForm] = useState({
    username: '',
    email: '',
    mobileNumber: '',
    dateOfBirth: '',
    password: '',
    confirmPassword: '',
  })

  const socketRef = useRef(null)
  const messageListRef = useRef(null)
  const activeConversationRef = useRef(null)
  const suppressAutoScrollRef = useRef(false)
  const seenRequestRef = useRef({})
  const serviceWorkerRegRef = useRef(null)
  const hasPushSubscribedRef = useRef(false)

  useEffect(() => subscribeToAuth((nextToken) => setToken(nextToken)), [])

  useEffect(() => {
    let mounted = true
    if (getAccessToken()) {
      setAuthReady(true)
      return () => {
        mounted = false
      }
    }

    refreshSession()
      .catch(() => null)
      .finally(() => {
        if (mounted) setAuthReady(true)
      })

    return () => {
      mounted = false
    }
  }, [])

  const {
    primeAlertAudio,
    stopIncomingAlert,
    playIncomingAlert,
    stopOutgoingAlert,
    playOutgoingAlert,
  } = useCallAlerts()

  const activeConversationType = activeConversation?.type || null
  const portalBadgeLabel =
    portalRole === 'admin'
      ? 'Admin'
      : portalRole === 'model_admin'
        ? 'Model Admin'
        : ''
  const activeChat = useMemo(() => {
    if (!activeConversation) return null
    const matched = users.find((u) => u.id === activeConversation.id)
    if (matched) return matched
    if (activeConversation.type === 'direct') {
      return {
        id: activeConversation.id,
        username: `User #${activeConversation.id}`,
        profileMediaUrl: '',
        isOnline: false,
        lastSeen: null,
        isBlockedByMe: Boolean(blockedUserIds[String(activeConversation.id)]),
        hasBlockedMe: false,
      }
    }
    return null
  }, [activeConversation, users, blockedUserIds])

  const activeMessages = useMemo(() => {
    if (!activeConversation) return []
    return messagesByUser[String(activeConversation.id)] || []
  }, [activeConversation, messagesByUser])

  const activePaginationMeta = useMemo(() => {
    if (!activeConversation) return { hasMore: false, loadingOlder: false }
    return directPaginationById[String(activeConversation.id)] || { hasMore: false, loadingOlder: false }
  }, [activeConversation, directPaginationById])

  const canExportConversation = useMemo(
    () => Boolean(currentUser?.canDownloadConversations || currentUser?.role === 'admin' || currentUser?.role === 'model_admin'),
    [currentUser],
  )

  useEffect(() => {
    activeConversationRef.current = activeConversation
  }, [activeConversation])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim())
    }, 260)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  const replaceTempWithServerMessage = (list, tempId, serverMessage) => {
    const hasServer = list.some((m) => m.id === serverMessage?.id)
    return list
      .map((m) => {
        if (m.id !== tempId) return m
        return hasServer ? null : serverMessage
      })
      .filter(Boolean)
  }

  const normalizeReactions = (reactions) =>
    Array.isArray(reactions)
      ? reactions.map((reaction) => ({
          ...(reaction || {}),
          reactors: Array.isArray(reaction?.reactors) ? reaction.reactors : [],
        }))
      : []

  const normalizeMediaMimeType = (mimeType) => {
    const raw = String(mimeType || '').trim().toLowerCase()
    if (!raw) return null
    const base = raw.split(';')[0].trim()
    if (!base) return null
    if (base === 'audio/x-m4a') return 'audio/mp4'
    if (base === 'audio/x-wav') return 'audio/wav'
    return base
  }

  const normalizeMessage = (message) => ({
    ...(message || {}),
    reactions: normalizeReactions(message?.reactions),
  })

  const applyBlockStateToUsers = (targetUserId, nextBlockState = {}) => {
    const normalizedTargetUserId = Number(targetUserId)
    if (!Number.isInteger(normalizedTargetUserId)) return

    setUsers((prev) =>
      prev.map((user) =>
        Number(user.id) === normalizedTargetUserId
          ? {
              ...user,
              isBlockedByMe: Boolean(nextBlockState.isBlockedByMe),
              hasBlockedMe: Boolean(nextBlockState.hasBlockedMe),
            }
          : user,
      ),
    )

    setBlockedUserIds((prev) => {
      const next = { ...prev }
      if (nextBlockState.isBlockedByMe) next[String(normalizedTargetUserId)] = true
      else delete next[String(normalizedTargetUserId)]
      return next
    })
  }

  const applyReactionUpdateToAllConversations = (messageId, reactions = []) => {
    const normalizedMessageId = Number(messageId)
    if (!Number.isInteger(normalizedMessageId)) return
    const nextReactions = normalizeReactions(reactions)
    setMessagesByUser((prev) => {
      let changed = false
      const next = {}
      for (const [key, list] of Object.entries(prev || {})) {
        const updatedList = (list || []).map((message) => {
          if (Number(message?.id) !== normalizedMessageId) return message
          changed = true
          return { ...message, reactions: nextReactions }
        })
        next[key] = updatedList
      }
      return changed ? next : prev
    })
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

  const getSidebarUserSortTime = (user, messageState = messagesByUser) => {
    const list = messageState[String(user?.id)] || []
    const lastLoadedMessage = list[list.length - 1]
    const candidates = [lastLoadedMessage?.createdAt, user?.lastMessageAt, user?.updatedAt, user?.createdAt]
    for (const value of candidates) {
      const ts = new Date(value || '').getTime()
      if (Number.isFinite(ts) && ts > 0) return ts
    }
    return 0
  }

  const trimSidebarUsers = (list = [], options = {}) => {
    const max = Number(options.max) > 0 ? Number(options.max) : MAX_LOADED_SIDEBAR_USERS
    if (!Array.isArray(list) || list.length <= max) return Array.isArray(list) ? list : []

    const activeId = Number(options.activeId ?? activeConversationRef.current?.id)
    const pinnedIds = new Set()
    if (Number.isInteger(activeId) && activeId > 0) pinnedIds.add(activeId)

    const sorted = [...list].sort((a, b) => {
      const unreadDiff = (Number(b?.unreadCount) || 0) - (Number(a?.unreadCount) || 0)
      if (unreadDiff !== 0) return unreadDiff
      const onlineDiff = Number(Boolean(b?.isOnline)) - Number(Boolean(a?.isOnline))
      if (onlineDiff !== 0) return onlineDiff
      const timeDiff = getSidebarUserSortTime(b) - getSidebarUserSortTime(a)
      if (timeDiff !== 0) return timeDiff
      return String(a?.username || '').localeCompare(String(b?.username || ''))
    })

    for (const item of sorted) {
      if (pinnedIds.size >= MAX_PINNED_SIDEBAR_USERS) break
      if ((Number(item?.unreadCount) || 0) > 0 || item?.isOnline) pinnedIds.add(Number(item.id))
    }

    const pinned = []
    const rest = []
    for (const item of sorted) {
      if (pinnedIds.has(Number(item?.id))) pinned.push(item)
      else rest.push(item)
    }

    return [...pinned, ...rest].slice(0, max)
  }

  const matchesSidebarQuery = (user, query = debouncedSearchQuery) => {
    const q = String(query || '').trim().toLowerCase()
    if (!q) return true
    return (
      String(user?.username || '').toLowerCase().includes(q) ||
      String(user?.uniqueUsername || '').toLowerCase().includes(q) ||
      String(user?.email || '').toLowerCase().includes(q) ||
      String(user?.mobileNumber || '').toLowerCase().includes(q)
    )
  }

  const closePermissionHelp = () => setPermissionHelp(null)
  const retryPermissionCheck = () => {
    setPermissionHelp(null)
  }

  const ensureServiceWorker = async () => {
    if (!ENABLE_WEB_PUSH) return null
    if (!('serviceWorker' in navigator)) return null
    if (serviceWorkerRegRef.current) {
      serviceWorkerRegRef.current.update().catch(() => null)
      return serviceWorkerRegRef.current
    }
    const reg = await navigator.serviceWorker.register('/sw.js?v=20260320-1')
    reg.update().catch(() => null)
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

  const resetAuthUi = (message = 'Session expired. Please login again.') => {
    stopIncomingAlert()
    stopOutgoingAlert()
    socketRef.current?.disconnect()
    socketRef.current = null
    setCurrentUser(null)
    setUsers([])
    setUsersCursor(null)
    setUsersHasMore(true)
    setMessagesByUser({})
    setDirectPaginationById({})
    setActiveConversation(null)
    setBlockedUserIds({})
    setError(message)
    setIncomingCall(null)
    setOutgoingCall(null)
    setActiveCall(null)
  }

  const clearAuthSession = async (message = 'Session expired. Please login again.', options = {}) => {
    const shouldNotifyServer = Boolean(options.notifyServer)
    if (shouldNotifyServer) {
      await logoutSession()
    } else {
      clearAccessToken()
    }
    resetAuthUi(message)
  }

  useEffect(() => {
    if (!authReady || token) return
    const hasSessionState =
      Boolean(currentUser) ||
      users.length > 0 ||
      Object.keys(messagesByUser).length > 0 ||
      Object.keys(directPaginationById).length > 0 ||
      Boolean(socketRef.current)
    if (hasSessionState) {
      resetAuthUi('')
    }
  }, [authReady, token, currentUser, users.length, messagesByUser, directPaginationById])

  const apiFetch = async (path, options = {}, authToken = token) => {
    try {
      return await fetchJsonWithAuth(path, options, {
        tokenOverride: authToken,
        skipAuth: !authToken && /^\/api\/auth\/(login|register)$/i.test(String(path || '')),
        allowRefresh: !/^\/api\/auth\/(login|register|refresh|logout)$/i.test(String(path || '')),
      })
    } catch (error) {
      if (error?.code === 'AUTH_UNAUTHORIZED') {
        resetAuthUi('Session expired. Please login again.')
      }
      throw error
    }
  }

  const normalizeUploadUrl = (value) => {
    if (typeof value !== 'string') return ''
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (trimmed.startsWith('/')) return `${UPLOAD_SERVER_URL}${trimmed}`
    if (trimmed.startsWith('public/')) return `${UPLOAD_SERVER_URL}/${trimmed}`
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
    const append = Boolean(options.append)
    const currentQuery = String(options.query ?? debouncedSearchQuery).trim()
    const params = new URLSearchParams({
      limit: String(CHAT_LIST_PAGE_SIZE),
    })
    if (append && options.cursor?.cursorTime && options.cursor?.cursorId) {
      params.set('cursorTime', String(options.cursor.cursorTime))
      params.set('cursorId', String(options.cursor.cursorId))
    }
    if (currentQuery) params.set('q', currentQuery)
    const data = await apiFetch(`/api/users?${params.toString()}`, {}, authToken)
    const incoming = data.users || []
    setBlockedUserIds((prev) => {
      const next = append ? { ...prev } : {}
      incoming.forEach((user) => {
        if (!user?.id) return
        if (user.isBlockedByMe) next[String(user.id)] = true
        else delete next[String(user.id)]
      })
      return next
    })
    setUsers((prev) => trimSidebarUsers(append ? mergeUniqueById(prev, incoming) : incoming))
    setUsersCursor(data.nextCursor || null)
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
    const incoming = (data.messages || []).map(normalizeMessage)

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
    setConversationMetaByUser((prev) => ({
      ...prev,
      [String(id)]: {
        note: String(data.conversationNote || ''),
        assignedToUserId: data.conversationAssignedToUserId || null,
        canEditNote: Boolean(data.canEditConversationNote),
      },
    }))
    return incoming.length > 0
  }

  const openConversation = async (conversation) => {
    if (conversation.type !== 'direct') return
    setActiveConversation(conversation)
    setIsMobileChatOpen(true)
    setIsProfileOpen(false)
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
      if (usersHasMore) await fetchContacts(token, { append: true, query: debouncedSearchQuery, cursor: usersCursor })
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
    let primed = false
    const runPrime = () => {
      if (primed) return
      primed = true
      primeAlertAudio()
    }

    window.addEventListener('pointerdown', runPrime, { passive: true })
    window.addEventListener('touchstart', runPrime, { passive: true })
    window.addEventListener('keydown', runPrime)

    return () => {
      window.removeEventListener('pointerdown', runPrime)
      window.removeEventListener('touchstart', runPrime)
      window.removeEventListener('keydown', runPrime)
    }
  }, [primeAlertAudio])

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
    if (!incomingCall) return undefined

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        primeAlertAudio()
        playIncomingAlert()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [incomingCall, playIncomingAlert, primeAlertAudio])

  useEffect(() => {
    if (!token) return
    let mounted = true;
    (async () => {
      setLoadingApp(true)
      setError('')
      try {
        const me = await apiFetch('/api/auth/me', {}, token)
        if (!mounted) return
        setCurrentUser(me.user)
        ensurePushSubscription(token).catch(() => null)
        const fetchedUsers = await fetchContacts(token, { append: false, query: '' })
        if (!mounted) return
        if (fetchedUsers[0]) {
          setActiveConversation({ type: 'direct', id: fetchedUsers[0].id })
          await loadDirectConversation(fetchedUsers[0].id, token)
          forceScrollToBottom(8)
        }

        const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] })
        socket.on('chat:message', (rawMessage) => {
          const message = normalizeMessage(rawMessage)
          const otherId = Number(message.senderId) === Number(me.user.id) ? message.receiverId : message.senderId
          const isFromMe = Number(message.senderId) === Number(me.user.id)
          setMessagesByUser((prev) => {
            const key = String(otherId)
            const list = prev[key] || []
            if (list.some((m) => m.id === message.id)) return prev
            return { ...prev, [key]: [...list, message] }
          })
          setUsers((prev) => {
            const shouldIncreaseUnread = !isFromMe && !(activeConversation?.type === 'direct' && Number(activeConversation.id) === Number(otherId))
            const existing = prev.find((u) => Number(u.id) === Number(otherId))
            const nextList = existing
              ? prev.map((u) => {
                  if (Number(u.id) !== Number(otherId)) return u
                  return {
                    ...u,
                    lastMessageAt: message.createdAt || new Date().toISOString(),
                    unreadCount: shouldIncreaseUnread ? (Number(u.unreadCount) || 0) + 1 : Number(u.unreadCount) || 0,
                  }
                })
              : matchesSidebarQuery(message?.sender || { username: message?.sender?.username || `User #${otherId}` })
                ? [
                  {
                    id: otherId,
                    username: String(message?.sender?.username || activeConversationRef.current?.username || `User #${otherId}`),
                    uniqueUsername: String(message?.sender?.uniqueUsername || ''),
                    role: String(message?.sender?.role || 'user'),
                    canHandleExternalChat: Boolean(message?.sender?.canHandleExternalChat),
                    profileMediaUrl: message?.sender?.profileMediaUrl || null,
                    lastSeen: null,
                    lastMessageAt: message.createdAt || new Date().toISOString(),
                    unreadCount: shouldIncreaseUnread ? 1 : 0,
                    isOnline: false,
                    isBlockedByMe: false,
                    hasBlockedMe: false,
                  },
                  ...prev,
                ]
                : prev
            return trimSidebarUsers(nextList)
          })
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
        socket.on('chat:assignment-updated', async () => {
          try {
            await fetchContacts(token, { append: false })
          } catch {
            // ignore refresh errors for realtime sync helper
          }
        })
        socket.on('chat:reaction-updated', (payload) => {
          applyReactionUpdateToAllConversations(payload?.messageId, payload?.reactions || [])
        })
        socket.on('chat:conversation-note-updated', (payload) => {
          const withUserId = Number(payload?.withUserId)
          if (!Number.isInteger(withUserId)) return
          setConversationMetaByUser((prev) => ({
            ...prev,
            [String(withUserId)]: {
              ...(prev[String(withUserId)] || {}),
              note: String(payload?.conversationNote || ''),
              assignedToUserId: payload?.conversationAssignedToUserId || null,
              canEditNote: true,
            },
          }))
        })
        socket.on('chat:note-access-updated', async (payload) => {
          const enabled = Boolean(payload?.enabled)
          setCurrentUser((prev) => (prev ? { ...prev, canEditConversationNote: enabled, profileNote: enabled ? prev.profileNote || '' : '' } : prev))
          setConversationMetaByUser((prev) => {
            const next = {}
            for (const [key, meta] of Object.entries(prev || {})) {
              next[key] = enabled
                ? { ...(meta || {}), canEditNote: true }
                : { ...(meta || {}), canEditNote: false, note: '', assignedToUserId: null }
            }
            return next
          })

          if (!enabled) return
          try {
            const meData = await apiFetch('/api/auth/me', {}, token)
            setCurrentUser((prev) => (prev ? { ...prev, ...(meData.user || {}) } : meData.user || prev))
          } catch {
            // ignore realtime refresh errors
          }
          const current = activeConversationRef.current
          if (!current || current.type !== 'direct' || !current.id) return
          try {
            await loadDirectConversation(current.id, token)
          } catch {
            // ignore realtime refresh errors
          }
        })
        socket.on('chat:profile-note-updated', (payload) => {
          setCurrentUser((prev) => (prev ? { ...prev, profileNote: String(payload?.profileNote || '') } : prev))
        })
        socket.on('chat:download-access-updated', (payload) => {
          const enabled = Boolean(payload?.enabled)
          setCurrentUser((prev) => (prev ? { ...prev, canDownloadConversations: enabled } : prev))
        })
        socket.on('chat:contact-added', ({ user }) => {
          if (!user?.id) return
          setUsers((prev) => {
            if (!matchesSidebarQuery(user)) return prev
            const existing = prev.find((item) => Number(item.id) === Number(user.id))
            const nextUser = {
              ...user,
              isBlockedByMe: Boolean(user?.isBlockedByMe ?? existing?.isBlockedByMe),
              hasBlockedMe: Boolean(user?.hasBlockedMe ?? existing?.hasBlockedMe),
            }
            return trimSidebarUsers(mergeUniqueById(prev, [nextUser]))
          })
        })
        socket.on('chat:block-status-updated', (payload) => {
          const targetUserId = Number(payload?.userId)
          if (!Number.isInteger(targetUserId)) return
          applyBlockStateToUsers(targetUserId, {
            isBlockedByMe: Boolean(payload?.isBlockedByMe),
            hasBlockedMe: Boolean(payload?.hasBlockedMe),
          })
        })
        socket.on('chat:contact-removed', ({ userId: removedUserId }) => {
          const removedId = Number(removedUserId)
          if (!Number.isInteger(removedId)) return
          setUsers((prev) => prev.filter((u) => Number(u.id) !== removedId))
          setMessagesByUser((prev) => {
            const next = { ...prev }
            delete next[String(removedId)]
            return next
          })
          setDirectPaginationById((prev) => {
            const next = { ...prev }
            delete next[String(removedId)]
            return next
          })
          setActiveConversation((prev) => (Number(prev?.id) === removedId ? null : prev))
          fetchContacts(token, { append: false }).catch(() => null)
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
    if (!token) return
    fetchContacts(token, { append: false, query: debouncedSearchQuery }).catch((err) => {
      setError(err.message)
    })
  }, [token, debouncedSearchQuery])

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
    const filtered = [...users]

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
  }, [users, messagesByUser])

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
    const identifier = String(loginForm.identifier || '').trim()
    const password = String(loginForm.password || '')
    if (!identifier) {
      setError('Username, email, or mobile is required')
      return
    }
    if (!password) {
      setError('Password is required')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const payload = {
        ...loginForm,
        identifier,
      }
      const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }, '')
      setAccessToken(data.token)
      setAuthReady(true)
      setLoginForm({ identifier: '', password: '' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const onRegister = async (e) => {
    e.preventDefault()
    const username = String(registerForm.username || '').trim()
    const email = String(registerForm.email || '').trim()
    const mobileNumber = String(registerForm.mobileNumber || '').trim()
    const dateOfBirth = String(registerForm.dateOfBirth || '').trim()
    const password = String(registerForm.password || '')
    const confirmPassword = String(registerForm.confirmPassword || '')
    if (username.length < 3) {
      setError('Username must be at least 3 characters')
      return
    }
    if (!email && !mobileNumber) {
      setError('Email or mobile number is required')
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address')
      return
    }
    if (mobileNumber && !/^[0-9+\-\s]{3,20}$/.test(mobileNumber)) {
      setError('Please enter a valid mobile number')
      return
    }
    if (!dateOfBirth) {
      setError('Date of birth is required')
      return
    }
    const dob = new Date(`${dateOfBirth}T00:00:00`)
    if (Number.isNaN(dob.getTime())) {
      setError('Please enter a valid date of birth')
      return
    }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (dob > today) {
      setError('Date of birth cannot be in the future')
      return
    }
    const maxAgeDate = new Date(today)
    maxAgeDate.setFullYear(today.getFullYear() - 120)
    if (dob < maxAgeDate) {
      setError('Age cannot be more than 120 years')
      return
    }
    const minAgeDate = new Date(today)
    minAgeDate.setFullYear(today.getFullYear() - 13)
    if (dob > minAgeDate) {
      setError('You must be at least 13 years old')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setSubmitting(true)
    setError('')
    let rollbackToken = ''
    let rollbackAttempted = false
    let rollbackSucceeded = false
    let rollbackFailureReason = ''
    try {
      const payload = {
        username,
        email: email || undefined,
        mobileNumber: mobileNumber || undefined,
        dateOfBirth,
        password,
      }
      const data = await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }, '')
      rollbackToken = data?.token || ''
      if (registerProfileFile) {
        if (registerProfileFile.size > MAX_REGISTER_PROFILE_SIZE) {
          throw new Error('Profile image must be 5MB or less.')
        }
        const uniqueUsername = data?.user?.uniqueUsername || data?.user?.username
        const profileMediaUrl = await uploadToExternalServer(registerProfileFile, 'profile', uniqueUsername)
        await apiFetch('/api/users/profile-media', { method: 'POST', body: JSON.stringify({ profileMediaUrl }) }, data.token)
      }
      setAccessToken(data.token)
      setAuthReady(true)
      setRegisterForm({ username: '', email: '', mobileNumber: '', dateOfBirth: '', password: '', confirmPassword: '' })
      setRegisterProfileFile(null)
    } catch (err) {
      if (rollbackToken) {
        rollbackAttempted = true
        try {
          await apiFetch('/api/auth/rollback-registration', { method: 'POST' }, rollbackToken)
          rollbackSucceeded = true
        } catch (rollbackError) {
          rollbackFailureReason = rollbackError.message
        }
      }
      const rollbackNote = rollbackSucceeded
        ? ' Registration data was rolled back. Please try again.'
        : rollbackAttempted
          ? ` Rollback failed: ${rollbackFailureReason || 'unknown reason'}. Please retry registration rollback.`
          : ''
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
      const contacts = await fetchContacts(token, { append: false })
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
    if (activeChat?.hasBlockedMe || activeChat?.isBlockedByMe) {
      setError('You can no longer message each other')
      return
    }
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
          return { ...prev, [key]: replaceTempWithServerMessage(list, tempId, normalizeMessage(ack.message)) }
        })
      })
      return
    }
    try {
      const data = await apiFetch(`/api/messages/${activeConversation.id}`, { method: 'POST', body: JSON.stringify({ text }) })
      setMessagesByUser((prev) => {
        const key = String(activeConversation.id)
        const list = prev[key] || []
        return { ...prev, [key]: replaceTempWithServerMessage(list, tempId, normalizeMessage(data.message)) }
      })
    } catch (err) {
      setError(err.message)
    }
  }

  const saveActiveConversationNote = async (note) => {
    if (!activeConversation || activeConversation.type !== 'direct') return false
    try {
      const data = await apiFetch(`/api/messages/${activeConversation.id}/note`, {
        method: 'PATCH',
        body: JSON.stringify({ note: String(note || '') }),
      })
      setConversationMetaByUser((prev) => ({
        ...prev,
        [String(activeConversation.id)]: {
          ...(prev[String(activeConversation.id)] || {}),
          note: String(data.conversationNote || ''),
          canEditNote: true,
        },
      }))
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  const sendMedia = async (file, options = {}) => {
    if (!file || !activeConversation) return
    if (activeChat?.hasBlockedMe || activeChat?.isBlockedByMe) {
      setError('You can no longer message each other')
      return
    }
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
          mediaMimeType: normalizeMediaMimeType(file.type),
          mediaOriginalName: file.name || null,
          mediaDurationSec: messageType === 'audio' ? Math.floor(Number(options.mediaDurationSec || 0)) : null,
          text: '',
        }),
      })
      setMessagesByUser((prev) => {
        const key = String(activeConversation.id)
        const list = prev[key] || []
        if (list.some((m) => m.id === data.message?.id)) return prev
        return { ...prev, [key]: [...list, normalizeMessage(data.message)] }
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

  const MAX_MEDIA_BATCH_SIZE = 30

  const sendMediaBatch = async (files) => {
    if (!Array.isArray(files) || files.length === 0) return
    const picked = files.slice(0, MAX_MEDIA_BATCH_SIZE)
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
    const picked = files.slice(0, MAX_MEDIA_BATCH_SIZE)
    const allVisual = picked.every((file) => file?.type?.startsWith('image/') || file?.type?.startsWith('video/'))

    if (!allVisual) {
      await sendMediaBatch(picked)
      return
    }

    setPendingMedia((prev) => {
      const remain = Math.max(0, MAX_MEDIA_BATCH_SIZE - prev.length)
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

  const exportConversationPdf = async () => {
    if (!activeConversation || activeConversation.type !== 'direct') return
    if (!canExportConversation) return
    try {
      const res = await fetchWithAuth(`/api/messages/${activeConversation.id}/export-pdf`)
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        if (payload?.fallbackFormat === 'txt') {
          const fallbackRes = await fetchWithAuth(`/api/messages/${activeConversation.id}/export-txt`)
          if (!fallbackRes.ok) {
            const fallbackPayload = await fallbackRes.json().catch(() => ({}))
            throw new Error(fallbackPayload.message || 'Failed to export conversation TXT')
          }
          const fallbackBlob = await fallbackRes.blob()
          const fallbackUrl = URL.createObjectURL(fallbackBlob)
          const fallbackFilename = (() => {
            const raw = fallbackRes.headers.get('content-disposition') || ''
            const match = raw.match(/filename=\"?([^\";]+)\"?/)
            return match?.[1] || `conversation_${activeConversation.id}.txt`
          })()
          const fallbackLink = document.createElement('a')
          fallbackLink.href = fallbackUrl
          fallbackLink.download = fallbackFilename
          document.body.appendChild(fallbackLink)
          fallbackLink.click()
          fallbackLink.remove()
          setTimeout(() => URL.revokeObjectURL(fallbackUrl), 1000)
          setError(payload.message || 'Conversation was exported as TXT because it is too large for PDF.')
          return
        }
        throw new Error(payload.message || 'Failed to export conversation PDF')
      }
      const contentType = String(res.headers.get('content-type') || '').toLowerCase()
      if (!contentType.includes('application/pdf')) {
        throw new Error('PDF export is not active yet. Please restart the backend server and try again.')
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const filenameFromHeader = (() => {
        const raw = res.headers.get('content-disposition') || ''
        const match = raw.match(/filename=\"?([^\";]+)\"?/)
        return match?.[1] || `conversation_${activeConversation.id}.pdf`
      })()
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filenameFromHeader
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (err) {
      setError(err.message)
    }
  }

  const updateOwnProfileNote = async (profileNote) => {
    const data = await apiFetch('/api/users/profile-note', {
      method: 'PATCH',
      body: JSON.stringify({ profileNote: String(profileNote || '') }),
    })
    setCurrentUser((prev) => ({ ...prev, ...(data.user || {}), profileNote: data?.user?.profileNote || '' }))
    return data.user || null
  }

  const toggleBlockUser = async (chatUser) => {
    const targetId = Number(chatUser?.id)
    if (!Number.isInteger(targetId)) return
    setBlockingUserId(targetId)
    try {
      const isBlocked = Boolean(blockedUserIds[String(targetId)] || chatUser?.isBlockedByMe)
      if (isBlocked) {
        await apiFetch(`/api/users/${targetId}/block`, { method: 'DELETE' })
        applyBlockStateToUsers(targetId, { isBlockedByMe: false, hasBlockedMe: false })
      } else {
        await apiFetch(`/api/users/${targetId}/block`, { method: 'POST' })
        applyBlockStateToUsers(targetId, { isBlockedByMe: true, hasBlockedMe: false })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBlockingUserId(null)
    }
  }

  const refreshCurrentUser = async (authToken = token) => {
    if (!authToken) return null
    const data = await apiFetch('/api/auth/me', {}, authToken)
    setCurrentUser(data.user || null)
    return data.user || null
  }

  const requestLogout = () => setConfirmAction({ type: 'logout' })
  const requestDeleteMessage = (messageId) => setConfirmAction({ type: 'delete_message', messageId })
  const requestDeleteMessages = (messageIds) => setConfirmAction({ type: 'delete_messages', messageIds })

  const reactToMessage = async (messageId, emoji) => {
    const normalizedMessageId = Number(messageId)
    if (!Number.isInteger(normalizedMessageId)) return
    try {
      const data = await apiFetch(`/api/messages/${normalizedMessageId}/reactions`, {
        method: 'PUT',
        body: JSON.stringify({ emoji: String(emoji || '') }),
      })
      applyReactionUpdateToAllConversations(normalizedMessageId, data?.reactions || [])
    } catch (err) {
      setError(err.message)
    }
  }

  const runConfirmAction = async () => {
    if (!confirmAction) return
    if (confirmAction.type === 'delete_message') await deleteMessage(confirmAction.messageId)
    else if (confirmAction.type === 'delete_messages') await deleteMessages(confirmAction.messageIds)
    else if (confirmAction.type === 'logout') await clearAuthSession('', { notifyServer: true })
    setConfirmAction(null)
  }

  const startDirectCall = async (callType = 'video') => {
    if (activeConversationType !== 'direct' || !activeChat || !currentUser) return
    if (activeChat?.hasBlockedMe || activeChat?.isBlockedByMe) {
      setError('You can no longer message each other')
      return
    }
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

  const startCallToUser = async (chatUser, callType = 'video') => {
    if (!chatUser || !currentUser) return
    if (chatUser?.hasBlockedMe || chatUser?.isBlockedByMe) {
      setError('You can no longer message each other')
      return
    }
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

  const markConversationSeen = async (otherUserId) => {
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
  }

  if (!authReady) {
    return <ChatLoadingScreen portalBadgeLabel={portalBadgeLabel} />
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
    return <ChatLoadingScreen portalBadgeLabel={portalBadgeLabel} />
  }

  return (
    <ChatAppShell
      portalBadgeLabel={portalBadgeLabel}
      isMobileChatOpen={isMobileChatOpen}
      currentUser={currentUser}
      refreshCurrentUser={refreshCurrentUser}
      requestLogout={requestLogout}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      onAddContact={onAddContact}
      lookupContact={lookupContact}
      contactIdentifier={contactIdentifier}
      setContactIdentifier={setContactIdentifier}
      addingContact={addingContact}
      uploadingProfile={uploadingProfile}
      uploadProfileMedia={uploadProfileMedia}
      updateOwnProfileNote={updateOwnProfileNote}
      error={error}
      filteredUsers={filteredUsers}
      activeConversation={activeConversation}
      openConversation={openConversation}
      getInitials={getInitials}
      getLastMessageForUser={getLastMessageForUser}
      formatTime={formatTime}
      formatLastSeen={formatLastSeen}
      startDirectCall={startDirectCall}
      startCallToUser={startCallToUser}
      loadMoreSidebarData={loadMoreSidebarData}
      loadingMoreSidebar={loadingMoreSidebar}
      backToList={backToList}
      activeChat={activeChat}
      activeConversationType={activeConversationType}
      isProfileOpen={isProfileOpen}
      setIsProfileOpen={setIsProfileOpen}
      toggleBlockUser={toggleBlockUser}
      blockingUserId={blockingUserId}
      exportConversationPdf={exportConversationPdf}
      canExportConversation={canExportConversation}
      messageListRef={messageListRef}
      activeMessages={activeMessages}
      activeConversationNote={conversationMetaByUser[String(activeConversation?.id || '')]?.note || ''}
      activeConversationCanEditNote={Boolean(conversationMetaByUser[String(activeConversation?.id || '')]?.canEditNote)}
      saveActiveConversationNote={saveActiveConversationNote}
      requestDeleteMessage={requestDeleteMessage}
      requestDeleteMessages={requestDeleteMessages}
      reactToMessage={reactToMessage}
      draftMessage={draftMessage}
      setDraftMessage={setDraftMessage}
      sendMessage={sendMessage}
      sendMedia={sendMedia}
      pickMediaFiles={pickMediaFiles}
      pendingMedia={pendingMedia}
      removePendingMedia={removePendingMedia}
      clearPendingMedia={clearPendingMedia}
      sendPendingMedia={sendPendingMedia}
      uploadingMedia={uploadingMedia}
      activePaginationMeta={activePaginationMeta}
      loadOlderMessages={loadOlderMessages}
      markConversationSeen={markConversationSeen}
      confirmAction={confirmAction}
      setConfirmAction={setConfirmAction}
      runConfirmAction={runConfirmAction}
      permissionHelp={permissionHelp}
      closePermissionHelp={closePermissionHelp}
      retryPermissionCheck={retryPermissionCheck}
      outgoingCall={outgoingCall}
      cancelOutgoingCall={cancelOutgoingCall}
      incomingCall={incomingCall}
      acceptIncomingCall={acceptIncomingCall}
      rejectIncomingCall={rejectIncomingCall}
      activeCall={activeCall}
      endActiveCall={endActiveCall}
      ZEGO_APP_ID={ZEGO_APP_ID}
      ZEGO_SERVER_SECRET={ZEGO_SERVER_SECRET}
    />
  )
}

export default App
