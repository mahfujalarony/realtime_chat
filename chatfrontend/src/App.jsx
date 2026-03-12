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

async function deleteMediaFromUploadServer(mediaUrl) {
  if (!mediaUrl) return
  try {
    const parsed = new URL(mediaUrl)
    const pathname = decodeURIComponent(parsed.pathname)
    const match = pathname.match(/\/uploads\/chat\/([^/]+)\/(images|videos|audios|files)\/([^/]+)$/)
    if (!match) return
    const [, username, mediaType, filename] = match
    const deleteUrl = `${UPLOAD_SERVER_URL}/delete/chat/${encodeURIComponent(username)}/${mediaType}/${encodeURIComponent(filename)}`
    await fetch(deleteUrl, { method: 'DELETE' })
  } catch (error) {
    console.error('Failed to delete media:', error.message)
  }
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('chat_token') || '')
  const [currentUser, setCurrentUser] = useState(null)
  const [users, setUsers] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [messagesByUser, setMessagesByUser] = useState({})
  const [activeChatId, setActiveChatId] = useState(null)
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [draftMessage, setDraftMessage] = useState('')
  const [contactIdentifier, setContactIdentifier] = useState('')
  const [addingContact, setAddingContact] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [submitting, setSubmitting] = useState(false)
  const [loadingApp, setLoadingApp] = useState(false)
  const [error, setError] = useState('')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [uploadingProfile, setUploadingProfile] = useState(false)

  const [loginForm, setLoginForm] = useState({
    identifier: '',
    password: '',
  })

  const [registerForm, setRegisterForm] = useState({
    username: '',
    email: '',
    mobileNumber: '',
    dateOfBirth: '',
    password: '',
  })

  const socketRef = useRef(null)
  const messageListRef = useRef(null)

  const clearAuthSession = (message = 'Session expired. Please login again.') => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    localStorage.removeItem('chat_token')
    setToken('')
    setCurrentUser(null)
    setUsers([])
    setMessagesByUser({})
    setActiveChatId(null)
    setIsMobileChatOpen(false)
    setDraftMessage('')
    setProfileMenuOpen(false)
    setConfirmAction(null)
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
      const message = data.message || 'Request failed'
      if (res.status === 401) {
        clearAuthSession(message)
      }
      throw new Error(message)
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

  const pickUploadedUrl = (payload, context = {}) => {
    const urlsFieldCandidates = []
    if (typeof payload?.urls === 'string') {
      urlsFieldCandidates.push(payload.urls)
    } else if (Array.isArray(payload?.urls)) {
      for (const item of payload.urls) {
        if (typeof item === 'string') {
          urlsFieldCandidates.push(item)
        } else if (item && typeof item === 'object') {
          urlsFieldCandidates.push(item.url, item.path, item.fileUrl, item.location)
        }
      }
    } else if (payload?.urls && typeof payload.urls === 'object') {
      for (const value of Object.values(payload.urls)) {
        if (typeof value === 'string') {
          urlsFieldCandidates.push(value)
        } else if (value && typeof value === 'object') {
          urlsFieldCandidates.push(value.url, value.path, value.fileUrl, value.location)
        }
      }
    }

    const candidates = [
      payload?.url,
      payload?.fileUrl,
      payload?.secure_url,
      payload?.path,
      payload?.filePath,
      payload?.location,
      payload?.data?.url,
      payload?.data?.fileUrl,
      payload?.data?.path,
      payload?.result?.url,
      payload?.result?.path,
      payload?.file?.url,
      payload?.file?.path,
      payload?.files?.[0]?.url,
      payload?.files?.[0]?.path,
      payload?.data?.files?.[0]?.url,
      payload?.data?.files?.[0]?.path,
      payload?.urls?.[0]?.url,
      payload?.urls?.[0]?.path,
      payload?.urls?.[0],
      payload?.data?.urls?.[0]?.url,
      payload?.data?.urls?.[0]?.path,
      payload?.data?.urls?.[0],
      ...urlsFieldCandidates,
    ]

    for (const value of candidates) {
      const normalized = normalizeUploadUrl(value)
      if (normalized) return normalized
    }

    const fileNameCandidates = [
      payload?.filename,
      payload?.fileName,
      payload?.name,
      payload?.savedName,
      payload?.data?.filename,
      payload?.data?.fileName,
      payload?.file?.filename,
      payload?.file?.name,
      payload?.files?.[0]?.filename,
      payload?.files?.[0]?.name,
      payload?.data?.files?.[0]?.filename,
      payload?.data?.files?.[0]?.name,
    ]
    const firstFileName = fileNameCandidates.find((v) => typeof v === 'string' && v.trim())
    if (firstFileName && context.username && context.mediaType) {
      return `${UPLOAD_SERVER_URL}/uploads/chat/${encodeURIComponent(context.username)}/${context.mediaType}/${encodeURIComponent(firstFileName.trim())}`
    }

    const keys = payload && typeof payload === 'object' ? Object.keys(payload).join(', ') : 'none'
    throw new Error(`Upload server response did not include file URL (keys: ${keys || 'none'})`)
  }

  const uploadToExternalServer = async (file, mediaType) => {
    if (!UPLOAD_SERVER_URL) {
      throw new Error('Upload server URL is not configured')
    }
    if (!currentUser?.username) {
      throw new Error('User not ready for upload')
    }

    // mediaType: 'images', 'videos', 'audios', 'files'
    const endpoint = `${UPLOAD_SERVER_URL}/upload/chat/${encodeURIComponent(currentUser.username)}/${mediaType}`

    const formData = new FormData()
    formData.append(UPLOAD_FILE_FIELD, file)

    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload.error || payload.message || 'Upload failed')
    }

    return pickUploadedUrl(payload, { username: currentUser.username, mediaType })
  }

  const appendMessage = (otherUserId, message) => {
    const key = String(otherUserId)
    setMessagesByUser((prev) => {
      const prevList = prev[key] || []
      if (prevList.some((item) => item.id === message.id)) {
        return prev
      }
      return {
        ...prev,
        [key]: [...prevList, message],
      }
    })
  }

  const removeMessageById = (messageId, otherUserId) => {
    const key = String(otherUserId)
    setMessagesByUser((prev) => {
      const prevList = prev[key] || []
      return {
        ...prev,
        [key]: prevList.filter((item) => item.id !== messageId),
      }
    })
  }

  const clearConversationLocal = (otherUserId) => {
    const key = String(otherUserId)
    setMessagesByUser((prev) => ({
      ...prev,
      [key]: [],
    }))
  }

  const fetchContacts = async (authToken = token) => {
    const usersRes = await apiFetch('/api/users', {}, authToken)
    const fetchedUsers = usersRes.users || []
    setUsers(fetchedUsers)
    return fetchedUsers
  }

  const loadConversation = async (otherUserId, authToken = token) => {
    if (!otherUserId) return
    try {
      const data = await apiFetch(`/api/messages/${otherUserId}`, {}, authToken)
      setMessagesByUser((prev) => ({
        ...prev,
        [String(otherUserId)]: data.messages || [],
      }))
    } catch (err) {
      setError(err.message)
    }
  }

  const bootstrap = async (authToken) => {
    setLoadingApp(true)
    setError('')
    try {
      const meRes = await apiFetch('/api/auth/me', {}, authToken)
      setCurrentUser(meRes.user)

      const fetchedUsers = await fetchContacts(authToken)

      if (fetchedUsers.length > 0) {
        const firstUserId = fetchedUsers[0].id
        setActiveChatId(firstUserId)
        await loadConversation(firstUserId, authToken)
      } else {
        setActiveChatId(null)
      }

      const socket = io(SOCKET_URL, {
        auth: { token: authToken },
        transports: ['websocket'],
      })

      socket.on('chat:message', (message) => {
        const isFromMe = message.senderId === meRes.user.id
        const otherUserId = isFromMe ? message.receiverId : message.senderId
        appendMessage(otherUserId, message)
      })
      socket.on('chat:message-deleted', (payload) => {
        removeMessageById(payload.messageId, payload.withUserId)
      })
      socket.on('chat:conversation-cleared', (payload) => {
        clearConversationLocal(payload.withUserId)
      })
      socket.on('connect_error', (socketError) => {
        const msg = socketError?.message || ''
        if (msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid token')) {
          clearAuthSession(msg)
        }
      })

      socketRef.current = socket
    } catch (err) {
      setError(err.message)
      localStorage.removeItem('chat_token')
      setToken('')
      setCurrentUser(null)
      setUsers([])
      setActiveChatId(null)
    } finally {
      setLoadingApp(false)
    }
  }

  useEffect(() => {
    if (!token) return

    bootstrap(token)

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
    }
  }, [token])

  useEffect(() => {
    window.history.replaceState({ mobileChatOpen: false }, '')

    const handlePopState = (event) => {
      const state = event.state
      if (state?.mobileChatOpen) {
        if (state.chatId) setActiveChatId(state.chatId)
        setIsMobileChatOpen(true)
        return
      }
      setIsMobileChatOpen(false)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return users
    return users.filter((user) => {
      return (
        user.username.toLowerCase().includes(q) ||
        (user.email || '').toLowerCase().includes(q) ||
        (user.mobileNumber || '').toLowerCase().includes(q)
      )
    })
  }, [users, searchQuery])

  const activeChat = useMemo(() => {
    return users.find((u) => u.id === activeChatId) || null
  }, [users, activeChatId])

  const activeMessages = useMemo(() => {
    if (!activeChatId) return []
    return messagesByUser[String(activeChatId)] || []
  }, [messagesByUser, activeChatId])

  useEffect(() => {
    const listEl = messageListRef.current
    if (!listEl) return
    requestAnimationFrame(() => {
      listEl.scrollTo({
        top: listEl.scrollHeight,
        behavior: activeMessages.length <= 1 ? 'auto' : 'smooth',
      })
    })
  }, [activeChatId, activeMessages.length])

  const getInitials = (name = '') => {
    return name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  }

  const formatTime = (dateValue) => {
    if (!dateValue) return ''
    return new Date(dateValue).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  const getLastMessageForUser = (userId) => {
    const list = messagesByUser[String(userId)] || []
    if (list.length === 0) return null
    return list[list.length - 1]
  }

  const openChat = async (chatId) => {
    setActiveChatId(chatId)
    setIsMobileChatOpen(true)
    setIsProfileOpen(false)
    setProfileMenuOpen(false)
    if (window.matchMedia('(max-width: 767px)').matches) {
      window.history.pushState({ mobileChatOpen: true, chatId }, '')
    }
    await loadConversation(chatId)
  }

  const backToList = () => {
    if (window.matchMedia('(max-width: 767px)').matches && window.history.state?.mobileChatOpen) {
      window.history.back()
      return
    }
    setIsMobileChatOpen(false)
  }

  const openProfile = () => {
    if (!activeChat) return
    setIsProfileOpen(true)
  }

  const closeProfile = () => {
    setIsProfileOpen(false)
    setProfileMenuOpen(false)
  }

  const onRegister = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const payload = {
        ...registerForm,
        email: registerForm.email || undefined,
        mobileNumber: registerForm.mobileNumber || undefined,
      }
      const data = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      }, '')

      localStorage.setItem('chat_token', data.token)
      setToken(data.token)
      setRegisterForm({ username: '', email: '', mobileNumber: '', dateOfBirth: '', password: '' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const onLogin = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginForm),
      }, '')

      localStorage.setItem('chat_token', data.token)
      setToken(data.token)
      setLoginForm({ identifier: '', password: '' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const onAddContact = async (event) => {
    event.preventDefault()
    const identifier = contactIdentifier.trim()
    if (!identifier) return

    setAddingContact(true)
    setError('')
    try {
      const data = await apiFetch('/api/users/contacts', {
        method: 'POST',
        body: JSON.stringify({ identifier }),
      })
      const contacts = await fetchContacts()
      const contactId = data.contact?.id
      if (contactId && contacts.some((item) => item.id === contactId)) {
        setActiveChatId(contactId)
        await loadConversation(contactId)
      }
      setContactIdentifier('')
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingContact(false)
    }
  }

  const sendMessage = async () => {
    const text = draftMessage.trim()
    if (!text || !activeChatId || !currentUser) return

    setDraftMessage('')

    const socket = socketRef.current
    if (socket && socket.connected) {
      socket.emit('chat:send', { toUserId: activeChatId, text }, (ack) => {
        if (!ack?.ok) {
          setError(ack?.message || 'Message send failed')
        }
      })
      return
    }

    try {
      const data = await apiFetch(`/api/messages/${activeChatId}`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      appendMessage(activeChatId, data.message)
    } catch (err) {
      setError(err.message)
    }
  }

  const sendMedia = async (file, options = {}) => {
    if (!file || !activeChatId || !currentUser) return

    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    const isAudio = file.type.startsWith('audio/')
    
    let mediaFolder
    let messageType
    
    if (isImage) {
      mediaFolder = 'images'
      messageType = 'image'
    } else if (isVideo) {
      mediaFolder = 'videos'
      messageType = 'video'
    } else if (isAudio) {
      mediaFolder = 'audios'
      messageType = 'audio'
    } else {
      mediaFolder = 'files'
      messageType = 'file'
    }

    setUploadingMedia(true)
    setError('')
    try {
      const mediaUrl = await uploadToExternalServer(file, mediaFolder)
      const durationFromOptions =
        Number.isFinite(Number(options.mediaDurationSec)) && Number(options.mediaDurationSec) >= 0
          ? Math.floor(Number(options.mediaDurationSec))
          : null
      const data = await apiFetch(`/api/messages/${activeChatId}`, {
        method: 'POST',
        body: JSON.stringify({
          text: '',
          mediaUrl,
          messageType,
          mediaMimeType: file.type || null,
          mediaOriginalName: file.name || null,
          mediaDurationSec: messageType === 'audio' ? durationFromOptions : null,
        }),
      })
      appendMessage(activeChatId, data.message)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploadingMedia(false)
    }
  }

  const uploadProfileMedia = async (file) => {
    if (!file || !currentUser) return
    if (!file.type.startsWith('image/')) {
      setError('Profile must be an image file')
      return
    }

    setUploadingProfile(true)
    setError('')
    try {
      const profileMediaUrl = await uploadToExternalServer(file, 'images')
      const data = await apiFetch('/api/users/profile-media', {
        method: 'POST',
        body: JSON.stringify({ profileMediaUrl }),
      })
      setCurrentUser((prev) => ({ ...prev, profileMediaUrl }))
      setUsers((prev) => prev.map((item) => (item.id === data.user.id ? { ...item, profileMediaUrl } : item)))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploadingProfile(false)
    }
  }

  const deleteMessage = async (messageId) => {
    if (!activeChatId) return
    try {
      // Find the message to delete its media from upload server
      const messages = messagesByUser[String(activeChatId)] || []
      const msg = messages.find((m) => m.id === messageId)
      if (msg?.mediaUrl) {
        await deleteMediaFromUploadServer(msg.mediaUrl)
      }
      await apiFetch(`/api/messages/${messageId}`, {
        method: 'DELETE',
      })
      removeMessageById(messageId, activeChatId)
    } catch (err) {
      setError(err.message)
    }
  }

  const clearChat = async () => {
    if (!activeChatId) return
    try {
      // Delete all media files from upload server
      const messages = messagesByUser[String(activeChatId)] || []
      await Promise.all(
        messages.filter((m) => m.mediaUrl).map((m) => deleteMediaFromUploadServer(m.mediaUrl))
      )
      await apiFetch(`/api/messages/chat/${activeChatId}`, {
        method: 'DELETE',
      })
      clearConversationLocal(activeChatId)
      setIsProfileOpen(false)
      setProfileMenuOpen(false)
    } catch (err) {
      setError(err.message)
    }
  }

  const deleteChat = async () => {
    if (!activeChatId) return
    try {
      // Delete all media files from upload server
      const messages = messagesByUser[String(activeChatId)] || []
      await Promise.all(
        messages.filter((m) => m.mediaUrl).map((m) => deleteMediaFromUploadServer(m.mediaUrl))
      )
      await apiFetch(`/api/messages/chat/${activeChatId}`, { method: 'DELETE' })
      await apiFetch(`/api/users/contacts/${activeChatId}`, { method: 'DELETE' })

      setUsers((prev) => prev.filter((item) => item.id !== activeChatId))
      setMessagesByUser((prev) => {
        const next = { ...prev }
        delete next[String(activeChatId)]
        return next
      })
      setActiveChatId(null)
      setIsProfileOpen(false)
      setIsMobileChatOpen(false)
      setProfileMenuOpen(false)
    } catch (err) {
      setError(err.message)
    }
  }

  const logout = () => {
    clearAuthSession('')
  }

  const requestDeleteMessage = (messageId) => {
    setConfirmAction({ type: 'delete_message', messageId })
  }

  const requestClearChat = () => {
    setProfileMenuOpen(false)
    setConfirmAction({ type: 'clear_chat' })
  }

  const requestDeleteChat = () => {
    setProfileMenuOpen(false)
    setConfirmAction({ type: 'delete_chat' })
  }

  const runConfirmAction = async () => {
    if (!confirmAction) return

    if (confirmAction.type === 'delete_message') {
      await deleteMessage(confirmAction.messageId)
    } else if (confirmAction.type === 'clear_chat') {
      await clearChat()
    } else if (confirmAction.type === 'delete_chat') {
      await deleteChat()
    }
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
          logout={logout}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onAddContact={onAddContact}
          contactIdentifier={contactIdentifier}
          setContactIdentifier={setContactIdentifier}
          addingContact={addingContact}
          error={error}
          filteredUsers={filteredUsers}
          activeChatId={activeChatId}
          openChat={openChat}
          getInitials={getInitials}
          getLastMessageForUser={getLastMessageForUser}
          formatTime={formatTime}
          uploadingProfile={uploadingProfile}
          onUploadProfile={uploadProfileMedia}
        />

        <ChatPanel
          isMobileChatOpen={isMobileChatOpen}
          backToList={backToList}
          activeChat={activeChat}
          openProfile={openProfile}
          getInitials={getInitials}
          profileMenuOpen={profileMenuOpen}
          setProfileMenuOpen={setProfileMenuOpen}
          requestClearChat={requestClearChat}
          requestDeleteChat={requestDeleteChat}
          messageListRef={messageListRef}
          activeMessages={activeMessages}
          currentUser={currentUser}
          formatTime={formatTime}
          requestDeleteMessage={requestDeleteMessage}
          draftMessage={draftMessage}
          setDraftMessage={setDraftMessage}
          sendMessage={sendMessage}
          sendMedia={sendMedia}
          uploadingMedia={uploadingMedia}
        />

        <ProfileDrawer
          activeChat={activeChat}
          isProfileOpen={isProfileOpen}
          closeProfile={closeProfile}
          getInitials={getInitials}
        />

        <ConfirmDialog
          confirmAction={confirmAction}
          setConfirmAction={setConfirmAction}
          runConfirmAction={runConfirmAction}
        />
      </section>
    </main>
  )
}

export default App
