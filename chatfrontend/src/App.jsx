import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import AuthScreen from './components/chat/AuthScreen'
import ChatSidebar from './components/chat/ChatSidebar'
import ChatPanel from './components/chat/ChatPanel'
import ProfileDrawer from './components/chat/ProfileDrawer'
import ConfirmDialog from './components/chat/ConfirmDialog'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_URL
const UPLOAD_SERVER_URL = import.meta.env.VITE_UPLOAD_SERVER_URL || 'http://localhost:5001'
const UPLOAD_FILE_FIELD = import.meta.env.VITE_UPLOAD_FILE_FIELD || 'file'
const CHAT_LIST_PAGE_SIZE = 30
const MESSAGE_PAGE_SIZE = 40

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

  const clearAuthSession = (message = 'Session expired. Please login again.') => {
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
      if (res.status === 401) clearAuthSession(data.message || 'Unauthorized')
      throw new Error(data.message || 'Request failed')
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
    if (!token) return
    let mounted = true
    ;(async () => {
      setLoadingApp(true)
      setError('')
      try {
        const me = await apiFetch('/api/auth/me', {}, token)
        if (!mounted) return
        setCurrentUser(me.user)
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
      socketRef.current?.disconnect()
      socketRef.current = null
    }
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
      const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify(loginForm) }, '')
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
