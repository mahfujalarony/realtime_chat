import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { Phone, PhoneOff, Video } from 'lucide-react'
import AuthScreen from './components/chat/AuthScreen'
import ChatSidebar from './components/chat/ChatSidebar'
import ChatPanel from './components/chat/ChatPanel'
import ProfileDrawer from './components/chat/ProfileDrawer'
import ConfirmDialog from './components/chat/ConfirmDialog'
import ZegoCallModal from './components/chat/ZegoCallModal'
import './App.css'

const runtimeHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
const API_URL = import.meta.env.VITE_API_URL || `http://${runtimeHost}:5000`
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_URL
const UPLOAD_SERVER_URL = import.meta.env.VITE_UPLOAD_SERVER_URL || `http://${runtimeHost}:5001`
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

function App() {
  const [token, setToken] = useState(localStorage.getItem('chat_token') || '')
  const [currentUser, setCurrentUser] = useState(null)
  const [users, setUsers] = useState([])
  const [groups, setGroups] = useState([])
  const [usersPage, setUsersPage] = useState(1)
  const [groupsPage, setGroupsPage] = useState(1)
  const [usersHasMore, setUsersHasMore] = useState(true)
  const [groupsHasMore, setGroupsHasMore] = useState(true)
  const [loadingMoreSidebar, setLoadingMoreSidebar] = useState(false)
  const [messagesByUser, setMessagesByUser] = useState({})
  const [groupMessagesById, setGroupMessagesById] = useState({})
  const [directPaginationById, setDirectPaginationById] = useState({})
  const [groupPaginationById, setGroupPaginationById] = useState({})
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
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false)
  const [groupNameInput, setGroupNameInput] = useState('')
  const [groupMemberIds, setGroupMemberIds] = useState([])
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [incomingCall, setIncomingCall] = useState(null)
  const [outgoingCall, setOutgoingCall] = useState(null)
  const [activeCall, setActiveCall] = useState(null)

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
  const groupSeenRequestRef = useRef({})
  const serviceWorkerRegRef = useRef(null)
  const ringtoneIntervalRef = useRef(null)
  const ringtoneAudioContextRef = useRef(null)
  const hasPushSubscribedRef = useRef(false)

  const activeConversationType = activeConversation?.type || null
  const activeChat = useMemo(() => {
    if (!activeConversation) return null
    if (activeConversation.type === 'group') return groups.find((g) => g.id === activeConversation.id) || null
    return users.find((u) => u.id === activeConversation.id) || null
  }, [activeConversation, groups, users])

  const activeMessages = useMemo(() => {
    if (!activeConversation) return []
    return activeConversation.type === 'group'
      ? groupMessagesById[String(activeConversation.id)] || []
      : messagesByUser[String(activeConversation.id)] || []
  }, [activeConversation, groupMessagesById, messagesByUser])

  const activePaginationMeta = useMemo(() => {
    if (!activeConversation) return { hasMore: false, loadingOlder: false }
    if (activeConversation.type === 'group') {
      return groupPaginationById[String(activeConversation.id)] || { hasMore: false, loadingOlder: false }
    }
    return directPaginationById[String(activeConversation.id)] || { hasMore: false, loadingOlder: false }
  }, [activeConversation, directPaginationById, groupPaginationById])

  const groupMemberNames = useMemo(() => {
    if (activeConversationType !== 'group' || !activeChat?.members) return {}
    return activeChat.members.reduce((acc, member) => {
      acc[member.id] = member.username
      return acc
    }, {})
  }, [activeChat, activeConversationType])

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
    if (ringtoneIntervalRef.current) {
      clearInterval(ringtoneIntervalRef.current)
      ringtoneIntervalRef.current = null
    }
    if (navigator.vibrate) navigator.vibrate(0)
    if (ringtoneAudioContextRef.current) {
      ringtoneAudioContextRef.current.close().catch(() => null)
      ringtoneAudioContextRef.current = null
    }
  }

  const playIncomingAlert = () => {
    stopIncomingAlert()
    try {
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
    } catch {
      // ignore if autoplay policy blocks audio context
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
    socketRef.current?.disconnect()
    socketRef.current = null
    localStorage.removeItem('chat_token')
    setToken('')
    setCurrentUser(null)
    setUsers([])
    setGroups([])
    setUsersPage(1)
    setGroupsPage(1)
    setUsersHasMore(true)
    setGroupsHasMore(true)
    setMessagesByUser({})
    setGroupMessagesById({})
    setDirectPaginationById({})
    setGroupPaginationById({})
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

  const fetchGroups = async (authToken = token, options = {}) => {
    const page = Number(options.page) > 0 ? Number(options.page) : 1
    const append = Boolean(options.append)
    const data = await apiFetch(`/api/groups?page=${page}&limit=${CHAT_LIST_PAGE_SIZE}`, {}, authToken)
    const incoming = data.groups || []
    setGroups((prev) => (append ? mergeUniqueById(prev, incoming) : incoming))
    setGroupsPage(page)
    setGroupsHasMore(Boolean(data.hasMore))
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

  const loadGroupConversation = async (id, authToken = token, options = {}) => {
    const appendOlder = Boolean(options.appendOlder)
    const currentMeta = groupPaginationById[String(id)] || { hasMore: true, loadingOlder: false, nextBeforeId: null, initialized: false }
    if (appendOlder && (currentMeta.loadingOlder || !currentMeta.hasMore)) return false

    const beforeId = appendOlder ? currentMeta.nextBeforeId : null
    setGroupPaginationById((prev) => ({
      ...prev,
      [String(id)]: { ...currentMeta, loadingOlder: appendOlder ? true : false },
    }))

    const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) })
    if (beforeId) params.set('beforeId', String(beforeId))
    const data = await apiFetch(`/api/groups/${id}/messages?${params.toString()}`, {}, authToken)
    const incoming = data.messages || []
    setGroupMessagesById((prev) => {
      const key = String(id)
      const existing = prev[key] || []
      return {
        ...prev,
        [key]: appendOlder ? [...incoming, ...existing] : incoming,
      }
    })
    setGroupPaginationById((prev) => ({
      ...prev,
      [String(id)]: {
        hasMore: Boolean(data.hasMore),
        loadingOlder: false,
        nextBeforeId: data.nextBeforeId || null,
        initialized: true,
      },
    }))
    await markGroupSeen(id)
    return incoming.length > 0
  }

  const markGroupSeen = async (groupId) => {
    if (groupSeenRequestRef.current[groupId]) return
    groupSeenRequestRef.current[groupId] = true
    try {
      await apiFetch(`/api/groups/${groupId}/seen`, { method: 'POST' })
      setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, unreadCount: 0 } : g)))
    } finally {
      groupSeenRequestRef.current[groupId] = false
    }
  }

  const openConversation = async (conversation) => {
    setActiveConversation(conversation)
    setIsMobileChatOpen(true)
    setIsProfileOpen(false)
    setProfileMenuOpen(false)
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      window.history.pushState({ mobileChatOpen: true, conversation }, '')
    }
    try {
      if (conversation.type === 'group') {
        const meta = groupPaginationById[String(conversation.id)]
        if (!meta?.initialized) await loadGroupConversation(conversation.id)
      } else {
        const meta = directPaginationById[String(conversation.id)]
        if (!meta?.initialized) await loadDirectConversation(conversation.id)
      }
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
      if (activeConversation.type === 'group') {
        await loadGroupConversation(activeConversation.id, token, { appendOlder: true })
      } else {
        await loadDirectConversation(activeConversation.id, token, { appendOlder: true })
      }

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
    if (!usersHasMore && !groupsHasMore) return
    setLoadingMoreSidebar(true)
    try {
      const tasks = []
      if (usersHasMore) tasks.push(fetchContacts(token, { page: usersPage + 1, append: true }))
      if (groupsHasMore) tasks.push(fetchGroups(token, { page: groupsPage + 1, append: true }))
      await Promise.all(tasks)
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
        setError('No answer from other user')
        return null
      })
    }, 45000)
    return () => clearTimeout(timer)
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
        const [fetchedUsers, fetchedGroups] = await Promise.all([
          fetchContacts(token, { page: 1, append: false }),
          fetchGroups(token, { page: 1, append: false }),
        ])
        if (!mounted) return
        if (fetchedUsers[0]) {
          setActiveConversation({ type: 'direct', id: fetchedUsers[0].id })
          await loadDirectConversation(fetchedUsers[0].id, token)
          forceScrollToBottom(8)
        } else if (fetchedGroups[0]) {
          setActiveConversation({ type: 'group', id: fetchedGroups[0].id })
          await loadGroupConversation(fetchedGroups[0].id, token)
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
          if (!isFromMe && !(activeConversation?.type === 'direct' && Number(activeConversation.id) === Number(otherId))) {
            setUsers((prev) => prev.map((u) => (u.id === otherId ? { ...u, unreadCount: (Number(u.unreadCount) || 0) + 1 } : u)))
          }
        })
        socket.on('chat:group-message', (message) => {
          setGroupMessagesById((prev) => {
            const key = String(message.groupId)
            const list = prev[key] || []
            if (list.some((m) => m.id === message.id)) return prev
            return { ...prev, [key]: [...list, message] }
          })
          setGroups((prev) =>
            prev.map((g) => {
              if (g.id !== message.groupId) return g
              const isOpen = activeConversation?.type === 'group' && Number(activeConversation.id) === Number(g.id)
              const fromMe = Number(message.senderId) === Number(me.user.id)
              return { ...g, lastMessage: message, unreadCount: !isOpen && !fromMe ? (Number(g.unreadCount) || 0) + 1 : g.unreadCount || 0 }
            }),
          )
        })
        socket.on('chat:group-created', (group) => {
          setGroups((prev) => (prev.some((g) => g.id === group.id) ? prev : [group, ...prev]))
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
              })
              return null
            })
            return
          }
          if (!payload?.accepted) {
            setIncomingCall((prev) => (prev?.roomId === payload?.roomId ? null : prev))
            setOutgoingCall((prev) => {
              if (!prev || prev.roomId !== payload?.roomId) return prev
              setError(`${payload?.byUser?.username || 'User'} declined the call`)
              return null
            })
            setActiveCall(null)
          }
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
    if (!q) return users
    return users.filter((u) => u.username.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.mobileNumber || '').toLowerCase().includes(q))
  }, [users, searchQuery])

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((g) => g.name.toLowerCase().includes(q))
  }, [groups, searchQuery])

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
  const getLastMessageForGroup = (id) => {
    const list = groupMessagesById[String(id)] || []
    return list[list.length - 1] || groups.find((g) => g.id === id)?.lastMessage || null
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
    try {
      const payload = { ...registerForm, email: registerForm.email || undefined, mobileNumber: registerForm.mobileNumber || undefined }
      const data = await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }, '')
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
      setError(err.message)
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
      receiverId: activeConversation.type === 'direct' ? activeConversation.id : null,
      groupId: activeConversation.type === 'group' ? activeConversation.id : null,
      text,
      messageType: 'text',
      createdAt: new Date().toISOString(),
      clientStatus: 'sending',
    }
    const targetSetter = activeConversation.type === 'group' ? setGroupMessagesById : setMessagesByUser
    targetSetter((prev) => {
      const key = String(activeConversation.id)
      return { ...prev, [key]: [...(prev[key] || []), temp] }
    })
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
    if (socket?.connected && activeConversation.type === 'group') {
      socket.emit('chat:group-send', { groupId: activeConversation.id, text }, (ack) => {
        if (!ack?.ok) return setError(ack?.message || 'Group message failed')
        setGroupMessagesById((prev) => {
          const key = String(activeConversation.id)
          const list = prev[key] || []
          return { ...prev, [key]: replaceTempWithServerMessage(list, tempId, ack.message) }
        })
      })
      return
    }

    try {
      const path = activeConversation.type === 'group' ? `/api/groups/${activeConversation.id}/messages` : `/api/messages/${activeConversation.id}`
      const data = await apiFetch(path, { method: 'POST', body: JSON.stringify({ text }) })
      targetSetter((prev) => {
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
      const path = activeConversation.type === 'group' ? `/api/groups/${activeConversation.id}/messages` : `/api/messages/${activeConversation.id}`
      const data = await apiFetch(path, {
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
      if (activeConversation.type === 'group') {
        setGroupMessagesById((prev) => {
          const key = String(activeConversation.id)
          const list = prev[key] || []
          if (list.some((m) => m.id === data.message?.id)) return prev
          return { ...prev, [key]: [...list, data.message] }
        })
      } else {
        setMessagesByUser((prev) => {
          const key = String(activeConversation.id)
          const list = prev[key] || []
          if (list.some((m) => m.id === data.message?.id)) return prev
          return { ...prev, [key]: [...list, data.message] }
        })
      }
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

  const createGroup = async () => {
    if (!groupNameInput.trim() || groupMemberIds.length === 0) return
    setCreatingGroup(true)
    try {
      const data = await apiFetch('/api/groups', { method: 'POST', body: JSON.stringify({ name: groupNameInput.trim(), memberIds: groupMemberIds }) })
      setGroups((prev) => (prev.some((g) => g.id === data.group.id) ? prev : [data.group, ...prev]))
      setIsCreateGroupOpen(false)
      setGroupNameInput('')
      setGroupMemberIds([])
      await openConversation({ type: 'group', id: data.group.id })
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingGroup(false)
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
  const requestClearChat = () => setConfirmAction({ type: 'clear_chat' })
  const requestDeleteChat = () => setConfirmAction({ type: 'delete_chat' })

  const runConfirmAction = async () => {
    if (!confirmAction) return
    if (confirmAction.type === 'delete_message') await deleteMessage(confirmAction.messageId)
    else if (confirmAction.type === 'clear_chat') await clearChat()
    else if (confirmAction.type === 'delete_chat') await deleteChat()
    else if (confirmAction.type === 'logout') clearAuthSession('')
    setConfirmAction(null)
  }

  const startDirectCall = (callType = 'video') => {
    if (activeConversationType !== 'direct' || !activeChat || !currentUser) return
    const a = Number(currentUser.id)
    const b = Number(activeChat.id)
    const roomId = `call_${Math.min(a, b)}_${Math.max(a, b)}_${Date.now()}`
    socketRef.current?.emit('call:invite', { toUserId: activeChat.id, roomId, callType }, (ack) => {
      if (!ack?.ok) {
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

  const acceptIncomingCall = () => {
    if (!incomingCall) return
    socketRef.current?.emit('call:response', {
      toUserId: incomingCall.fromUser?.id,
      roomId: incomingCall.roomId,
      accepted: true,
    })
    setActiveCall({
      roomId: incomingCall.roomId,
      callType: incomingCall.callType || 'video',
      status: 'connected',
      peerUser: incomingCall.fromUser || null,
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
      socketRef.current?.emit('call:response', {
        toUserId: outgoingCall.peerUser.id,
        roomId: outgoingCall.roomId,
        accepted: false,
      })
    }
    setOutgoingCall(null)
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
      <main className="grid min-h-screen place-items-center bg-[#e8dfd6]">
        <p className="rounded-lg bg-white px-4 py-3 text-sm text-[#1f2c34] shadow">Loading chats...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#e8dfd6] p-0">
      <section className="relative flex h-screen w-full overflow-hidden bg-white">
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
          filteredGroups={filteredGroups}
          activeConversation={activeConversation}
          openConversation={openConversation}
          openCreateGroup={() => setIsCreateGroupOpen(true)}
          getInitials={getInitials}
          getLastMessageForUser={getLastMessageForUser}
          getLastMessageForGroup={getLastMessageForGroup}
          formatTime={formatTime}
          formatLastSeen={formatLastSeen}
          onReachListEnd={loadMoreSidebarData}
          loadingMoreSidebar={loadingMoreSidebar}
        />

        <ChatPanel
          isMobileChatOpen={isMobileChatOpen}
          backToList={backToList}
          activeChat={activeChat}
          activeConversationType={activeConversationType}
          groupMemberNames={groupMemberNames}
          openProfile={() => {
            if (activeConversationType !== 'group') setIsProfileOpen(true)
          }}
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

        {outgoingCall ? (
          <div className="absolute inset-0 z-50 overflow-hidden bg-[#0b141a]">
            <div className="absolute inset-0 bg-gradient-to-b from-[#1f2c34] via-[#0f1a20] to-[#0b141a]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_25%,rgba(37,211,102,0.22),transparent_38%),radial-gradient(circle_at_82%_75%,rgba(0,168,132,0.18),transparent_42%)]" />
            <div className="relative z-10 flex h-full flex-col items-center justify-between px-6 pb-12 pt-14">
              <div className="text-center">
                <p className="text-xs uppercase tracking-[0.18em] text-[#d1d7db]">
                  {outgoingCall.status === 'ringing' ? 'Ringing...' : 'Calling...'}
                </p>
                <div className="mx-auto mt-6 flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-white/25 bg-[#233138] text-3xl font-semibold text-[#d9fdd3]">
                  {outgoingCall.peerUser?.profileMediaUrl ? (
                    <img
                      src={outgoingCall.peerUser.profileMediaUrl}
                      alt={outgoingCall.peerUser?.username || 'User'}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    String(outgoingCall.peerUser?.username || 'U').slice(0, 1).toUpperCase()
                  )}
                </div>
                <p className="mt-4 text-2xl font-semibold text-white">{outgoingCall.peerUser?.username || 'User'}</p>
                <p className="mt-1 text-sm text-[#d1d7db]">
                  {outgoingCall.callType === 'audio' ? 'Audio call' : 'Video call'}
                </p>
                <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/25 px-3 py-1.5 text-xs text-[#d1d7db]">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#ffbf47]" />
                  <span>
                    {outgoingCall.status === 'ringing'
                      ? 'Other side phone is ringing'
                      : 'Sending call request'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={cancelOutgoingCall}
                className="group flex flex-col items-center gap-3 text-white"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#f15c6d] shadow-lg transition group-hover:scale-105">
                  <PhoneOff size={28} />
                </span>
                <span className="text-sm text-[#d1d7db]">End</span>
              </button>
            </div>
          </div>
        ) : null}

        {incomingCall ? (
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

              <div className="mb-2 flex w-full max-w-xs items-center justify-between">
                <button
                  type="button"
                  onClick={rejectIncomingCall}
                  className="group flex flex-col items-center gap-3 text-white"
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#f15c6d] shadow-lg transition group-hover:scale-105">
                    <PhoneOff size={28} />
                  </span>
                  <span className="text-sm text-[#d1d7db]">Decline</span>
                </button>
                <button
                  type="button"
                  onClick={acceptIncomingCall}
                  className="group flex flex-col items-center gap-3 text-white"
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#25d366] shadow-lg transition group-hover:scale-105">
                    {String(incomingCall.callType || 'video') === 'audio' ? <Phone size={28} /> : <Video size={28} />}
                  </span>
                  <span className="text-sm text-[#d1d7db]">Accept</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <ZegoCallModal
          open={Boolean(activeCall && activeCall.status === 'connected')}
          onClose={() => setActiveCall(null)}
          appId={ZEGO_APP_ID}
          serverSecret={ZEGO_SERVER_SECRET}
          roomId={activeCall?.roomId || ''}
          userId={String(currentUser?.id || '')}
          userName={currentUser?.username || 'User'}
          callType={activeCall?.callType || 'video'}
          peerUser={activeCall?.peerUser || null}
          callStatus={activeCall?.status || 'connecting'}
        />

        {isCreateGroupOpen ? (
          <div className="absolute inset-0 z-40 grid place-items-center bg-black/35 p-4">
            <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl">
              <p className="text-lg font-semibold text-[#1f2c34]">Create group</p>
              <input
                type="text"
                value={groupNameInput}
                onChange={(e) => setGroupNameInput(e.target.value)}
                placeholder="Group name"
                className="mt-3 w-full rounded-lg border border-[#d8dde1] px-3 py-2 text-sm outline-none focus:border-[#25d366]"
              />
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-[#ecf0f2] p-2">
                {users.map((user) => (
                  <label key={user.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-[#f6f8f9]">
                    <input
                      type="checkbox"
                      checked={groupMemberIds.includes(user.id)}
                      onChange={(e) => {
                        if (e.target.checked) setGroupMemberIds((prev) => [...prev, user.id])
                        else setGroupMemberIds((prev) => prev.filter((id) => id !== user.id))
                      }}
                    />
                    <span className="text-sm text-[#1f2c34]">{user.username}</span>
                  </label>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setIsCreateGroupOpen(false)} className="rounded-md border border-[#d7dce0] px-3 py-1.5 text-sm text-[#1f2c34]">Cancel</button>
                <button type="button" disabled={creatingGroup} onClick={createGroup} className="rounded-md bg-[#25d366] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
                  {creatingGroup ? 'Creating...' : 'Create group'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default App
