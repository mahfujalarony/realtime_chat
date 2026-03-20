import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Menu, X } from 'lucide-react'

import { Button } from '../ui/button'
import AdminSidebar from './AdminSidebar'
import AdminUsersPanel from './AdminUsersPanel'
import AdminConversationsPanel from './AdminConversationsPanel'
import AdminConversationDrawer from './AdminConversationDrawer'
import { apiFetch } from './adminApi'
import { getAccessToken, subscribeToAuth } from '../../lib/auth'

const PAGE_SIZE = 20
const CONVERSATION_PAGE_SIZE = 10
const DRAWER_PAGE_SIZE = 40

function ManagementConsolePage({ basePath = '/admin', consoleTitle = 'Admin Console', dashboardTitle = 'Admin Dashboard' }) {
  const [token, setToken] = useState(() => getAccessToken())
  const location = useLocation()
  const navigate = useNavigate()
  const [me, setMe] = useState(null)
  const [users, setUsers] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [usersRefreshing, setUsersRefreshing] = useState(false)
  const [updatingId, setUpdatingId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [conversations, setConversations] = useState([])
  const [conversationSearchInput, setConversationSearchInput] = useState('')
  const [conversationQuery, setConversationQuery] = useState('')
  const [teamMembers, setTeamMembers] = useState([])
  const [conversationPage, setConversationPage] = useState(1)
  const [conversationHasMore, setConversationHasMore] = useState(false)
  const [conversationTotal, setConversationTotal] = useState(0)
  const [conversationLoading, setConversationLoading] = useState(false)
  const [conversationRefreshing, setConversationRefreshing] = useState(false)
  const [savingConversationId, setSavingConversationId] = useState(null)
  const [noteDraftByExternalId, setNoteDraftByExternalId] = useState({})
  const [forwardToByExternalId, setForwardToByExternalId] = useState({})
  const [viewingConversation, setViewingConversation] = useState(null)
  const [viewingMessages, setViewingMessages] = useState([])
  const [viewingLoading, setViewingLoading] = useState(false)
  const [viewingPage, setViewingPage] = useState(1)
  const [viewingHasMore, setViewingHasMore] = useState(false)
  const [viewingTotal, setViewingTotal] = useState(0)
  const viewingScrollRef = useRef(null)
  const [isViewingNearBottom, setIsViewingNearBottom] = useState(true)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const conversationListScrollRef = useRef(null)
  const [deletingConversationId, setDeletingConversationId] = useState(null)
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState(null)
  const [passwordDialog, setPasswordDialog] = useState(null)
  const [passwordDraft, setPasswordDraft] = useState('')
  const [profileNoteDialog, setProfileNoteDialog] = useState(null)
  const [profileNoteDraft, setProfileNoteDraft] = useState('')
  const [contactDialog, setContactDialog] = useState(null)
  const [contactDraft, setContactDraft] = useState({ email: '', mobileNumber: '' })

  const activePanel = useMemo(() => {
    const pathname = String(location.pathname || '').toLowerCase()
    if (pathname.endsWith('/users')) return 'users'
    if (pathname.endsWith('/conversations')) return 'conversations'
    return 'dashboard'
  }, [location.pathname])

  useEffect(() => subscribeToAuth((nextToken) => setToken(nextToken)), [])

  const loadUsers = async ({ targetPage = 1, append = false, currentQuery = '' } = {}) => {
    const preserveScroll = false
    const keepVisible = false
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: String(PAGE_SIZE),
      })
      if (currentQuery.trim()) params.set('q', currentQuery.trim())
      const data = await apiFetch(`/api/admin/users?${params.toString()}`, {}, token)
      setUsers((prev) => (append ? [...prev, ...(data.users || [])] : data.users || []))
      setPage(Number(data.page) || targetPage)
      setHasMore(Boolean(data.hasMore))
      setTotal(Number(data.total) || 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadUsersSmooth = async ({ targetPage = 1, append = false, currentQuery = '', preserveScroll = false, keepVisible = false } = {}) => {
    const container = typeof window !== 'undefined' ? window : null
    const previousScrollTop = preserveScroll && container ? window.scrollY : 0
    if (keepVisible) setUsersRefreshing(true)
    else setLoading(true)
    setError('')
    setSuccess('')
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: String(PAGE_SIZE),
      })
      if (currentQuery.trim()) params.set('q', currentQuery.trim())
      const data = await apiFetch(`/api/admin/users?${params.toString()}`, {}, token)
      setUsers((prev) => (append ? [...prev, ...(data.users || [])] : data.users || []))
      setPage(Number(data.page) || targetPage)
      setHasMore(Boolean(data.hasMore))
      setTotal(Number(data.total) || 0)
      if (preserveScroll && container) {
        requestAnimationFrame(() => {
          window.scrollTo({ top: previousScrollTop })
        })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      if (keepVisible) setUsersRefreshing(false)
      else setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const data = await apiFetch('/api/auth/me', {}, token)
        setMe(data.user || null)
      } catch (err) {
        setError(err.message)
      }
    })()
  }, [token])

  useEffect(() => {
    if (!token) return
    loadUsersSmooth({ targetPage: 1, append: false, currentQuery: query })
  }, [token, query])

  const loadConversations = async (targetPage = 1, options = {}) => {
    const preserveScroll = Boolean(options.preserveScroll)
    const keepVisible = Boolean(options.keepVisible)
    const currentQuery = String(options.currentQuery ?? conversationQuery)
    const container = conversationListScrollRef.current
    const previousScrollTop = preserveScroll && container ? container.scrollTop : 0
    if (keepVisible) setConversationRefreshing(true)
    else setConversationLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: String(CONVERSATION_PAGE_SIZE),
      })
      if (currentQuery.trim()) params.set('q', currentQuery.trim())
      const data = await apiFetch(`/api/admin/conversations?${params.toString()}`, {}, token)
      setConversations(data.conversations || [])
      setConversationPage(Number(data.page) || targetPage)
      setConversationHasMore(Boolean(data.hasMore))
      setConversationTotal(Number(data.total) || 0)
      setNoteDraftByExternalId(
        (data.conversations || []).reduce((acc, c) => {
          acc[c.externalUserId] = c.note || ''
          return acc
        }, {}),
      )
      if (preserveScroll) {
        requestAnimationFrame(() => {
          const nextContainer = conversationListScrollRef.current
          if (nextContainer) nextContainer.scrollTop = previousScrollTop
        })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      if (keepVisible) setConversationRefreshing(false)
      else setConversationLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    loadConversations(1, { currentQuery: conversationQuery })
  }, [token, conversationQuery])

  const loadTeamMembers = async () => {
    try {
      const data = await apiFetch('/api/admin/team-members', {}, token)
      setTeamMembers(data.teamMembers || [])
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    if (!token) return
    loadTeamMembers()
  }, [token])

  const onSubmitSearch = (event) => {
    event.preventDefault()
    setQuery(searchInput)
  }

  const onSubmitConversationSearch = (event) => {
    event.preventDefault()
    setConversationQuery(conversationSearchInput)
  }

  const saveNote = async (externalUserId) => {
    setSavingConversationId(externalUserId)
    setError('')
    try {
      await apiFetch(
        `/api/admin/conversations/${externalUserId}/note`,
        { method: 'PATCH', body: JSON.stringify({ note: noteDraftByExternalId[externalUserId] || '' }) },
        token,
      )
      await loadConversations(conversationPage)
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingConversationId(null)
    }
  }

  const forwardConversation = async (externalUserId, explicitToUserId = null) => {
    const fallbackUserId = Number(forwardToByExternalId[externalUserId] || 0)
    const pickedUserId = Number(explicitToUserId)
    const toUserId = Number.isInteger(pickedUserId) && pickedUserId > 0 ? pickedUserId : fallbackUserId
    if (!Number.isInteger(toUserId) || toUserId <= 0) return
    setSavingConversationId(externalUserId)
    setError('')
    try {
      await apiFetch(
        `/api/admin/conversations/${externalUserId}/forward`,
        { method: 'PATCH', body: JSON.stringify({ toUserId }) },
        token,
      )
      const nextAssigned = teamMembers.find((member) => Number(member.id) === toUserId) || null
      setConversations((prev) =>
        prev.map((item) =>
          Number(item.externalUserId) === Number(externalUserId)
            ? {
                ...item,
                assignedToUserId: toUserId,
                assignedToUser: nextAssigned
                  ? {
                      id: nextAssigned.id,
                      username: nextAssigned.username,
                      uniqueUsername: nextAssigned.uniqueUsername,
                      role: nextAssigned.role,
                      profileMediaUrl: nextAssigned.profileMediaUrl || null,
                    }
                  : item.assignedToUser,
              }
            : item,
        ),
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingConversationId(null)
    }
  }

  const fetchConversationMessages = async (externalUserId, targetPage = 1) => {
    const params = new URLSearchParams({
      page: String(targetPage),
      limit: String(DRAWER_PAGE_SIZE),
    })
    const data = await apiFetch(`/api/admin/conversations/${externalUserId}/messages?${params.toString()}`, {}, token)
    return {
      messages: data.messages || [],
      page: Number(data.page) || targetPage,
      total: Number(data.total) || 0,
      hasMore: Boolean(data.hasMore),
    }
  }

  const loadViewingPage = async (conversation, targetPage = 1, showLoader = false) => {
    if (!conversation?.externalUserId) return
    if (showLoader) setViewingLoading(true)
    setError('')
    try {
      const data = await fetchConversationMessages(conversation.externalUserId, targetPage)
      setViewingMessages(data.messages)
      setViewingPage(data.page)
      setViewingTotal(data.total)
      setViewingHasMore(data.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      if (showLoader) setViewingLoading(false)
    }
  }

  const openConversationMessages = async (conversation) => {
    setViewingConversation(conversation)
    setViewingMessages([])
    setViewingPage(1)
    setViewingHasMore(false)
    setViewingTotal(0)
    await loadViewingPage(conversation, 1, true)
  }

  const closeConversationMessages = () => {
    setViewingConversation(null)
    setViewingMessages([])
    setViewingPage(1)
    setViewingHasMore(false)
    setViewingTotal(0)
    setViewingLoading(false)
    setIsViewingNearBottom(true)
  }

  useEffect(() => {
    if (!viewingConversation?.externalUserId || !token) return undefined
    const intervalId = window.setInterval(async () => {
      if (viewingPage !== 1) return
      try {
        const data = await fetchConversationMessages(viewingConversation.externalUserId, 1)
        setViewingMessages(data.messages)
        setViewingPage(data.page)
        setViewingTotal(data.total)
        setViewingHasMore(data.hasMore)
      } catch {
        // Keep existing UI stable if background refresh fails once.
      }
    }, 2000)
    return () => window.clearInterval(intervalId)
  }, [viewingConversation?.externalUserId, token, viewingPage])

  useEffect(() => {
    if (!viewingConversation?.externalUserId || viewingPage !== 1) return
    const container = viewingScrollRef.current
    if (!container || !isViewingNearBottom) return
    container.scrollTop = container.scrollHeight
  }, [viewingMessages, viewingConversation?.externalUserId, viewingPage, isViewingNearBottom])

  const onViewingScroll = () => {
    const container = viewingScrollRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    setIsViewingNearBottom(distanceFromBottom < 80)
  }

  const onSelectPanel = (panel) => {
    const nextPath =
      panel === 'users'
        ? `${basePath}/users`
        : panel === 'conversations'
          ? `${basePath}/conversations`
          : `${basePath}/dashboard`
    navigate(nextPath)
    setMobileSidebarOpen(false)
  }

  const setUserStaffProfile = async (userId, profile) => {
    const normalizedUserId = Number(userId)
    if (!Number.isInteger(normalizedUserId)) return
    setUpdatingId(normalizedUserId)
    setError('')
    setSuccess('')
    try {
      await apiFetch(
        `/api/admin/users/${normalizedUserId}/staff-profile`,
        { method: 'PATCH', body: JSON.stringify({ profile }) },
        token,
      )
      await loadUsersSmooth({ targetPage: page, append: false, currentQuery: query })
      await loadTeamMembers()
    } catch (err) {
      setError(err.message)
    } finally {
      setUpdatingId(null)
    }
  }

  const toggleUserDownloadAccess = async (userId, enabled) => {
    const normalizedUserId = Number(userId)
    if (!Number.isInteger(normalizedUserId)) return
    setUpdatingId(normalizedUserId)
    setError('')
    setSuccess('')
    try {
      await apiFetch(
        `/api/admin/users/${normalizedUserId}/download-access`,
        { method: 'PATCH', body: JSON.stringify({ enabled: Boolean(enabled) }) },
        token,
      )
      await loadUsersSmooth({ targetPage: page, append: false, currentQuery: query })
    } catch (err) {
      setError(err.message)
    } finally {
      setUpdatingId(null)
    }
  }

  const toggleUserNoteAccess = async (userId, enabled) => {
    const normalizedUserId = Number(userId)
    if (!Number.isInteger(normalizedUserId)) return
    setUpdatingId(normalizedUserId)
    setError('')
    setSuccess('')
    try {
      await apiFetch(
        `/api/admin/users/${normalizedUserId}/note-access`,
        { method: 'PATCH', body: JSON.stringify({ enabled: Boolean(enabled) }) },
        token,
      )
      await loadUsersSmooth({ targetPage: page, append: false, currentQuery: query })
    } catch (err) {
      setError(err.message)
    } finally {
      setUpdatingId(null)
    }
  }

  const toggleUserBlockAccess = async (userId, enabled) => {
    const normalizedUserId = Number(userId)
    if (!Number.isInteger(normalizedUserId)) return
    setUpdatingId(normalizedUserId)
    setError('')
    setSuccess('')
    try {
      await apiFetch(
        `/api/admin/users/${normalizedUserId}/block-access`,
        { method: 'PATCH', body: JSON.stringify({ enabled: Boolean(enabled) }) },
        token,
      )
      await loadUsersSmooth({ targetPage: page, append: false, currentQuery: query })
    } catch (err) {
      setError(err.message)
    } finally {
      setUpdatingId(null)
    }
  }

  const requestDeleteConversation = (externalUserId, username) => {
    setDeleteConfirmDialog({ externalUserId, username })
  }

  const openSetPasswordDialog = (user) => {
    setPasswordDialog(user || null)
    setPasswordDraft('')
    setError('')
    setSuccess('')
  }

  const openProfileNoteDialog = (user) => {
    setProfileNoteDialog(user || null)
    setProfileNoteDraft(String(user?.profileNote || ''))
    setError('')
    setSuccess('')
  }

  const openContactDialog = (user) => {
    setContactDialog(user || null)
    setContactDraft({
      email: String(user?.email || ''),
      mobileNumber: String(user?.mobileNumber || ''),
    })
    setError('')
    setSuccess('')
  }

  const closeContactDialog = () => {
    if (updatingId !== null) return
    setContactDialog(null)
    setContactDraft({ email: '', mobileNumber: '' })
  }

  const closeProfileNoteDialog = () => {
    if (updatingId !== null) return
    setProfileNoteDialog(null)
    setProfileNoteDraft('')
  }

  const closeSetPasswordDialog = () => {
    if (updatingId !== null) return
    setPasswordDialog(null)
    setPasswordDraft('')
  }

  const submitSetPassword = async () => {
    const normalizedUserId = Number(passwordDialog?.id)
    if (!Number.isInteger(normalizedUserId)) return
    const nextPassword = String(passwordDraft || '')
    if (!nextPassword.trim()) {
      setError('New password is required')
      return
    }

    setUpdatingId(normalizedUserId)
    setError('')
    setSuccess('')
    try {
      const data = await apiFetch(
        `/api/admin/users/${normalizedUserId}/password`,
        { method: 'PATCH', body: JSON.stringify({ password: nextPassword }) },
        token,
      )
      setSuccess(data?.message || 'Password updated')
      setPasswordDialog(null)
      setPasswordDraft('')
      await loadUsersSmooth({ targetPage: page, append: false, currentQuery: query })
    } catch (err) {
      setError(err.message)
    } finally {
      setUpdatingId(null)
    }
  }

  const submitProfileNote = async () => {
    const normalizedUserId = Number(profileNoteDialog?.id)
    if (!Number.isInteger(normalizedUserId)) return

    setUpdatingId(normalizedUserId)
    setError('')
    setSuccess('')
    try {
      const data = await apiFetch(
        `/api/admin/users/${normalizedUserId}/profile-note`,
        { method: 'PATCH', body: JSON.stringify({ profileNote: profileNoteDraft }) },
        token,
      )
      setSuccess(data?.message || 'Profile note updated')
      setProfileNoteDialog(null)
      setProfileNoteDraft('')
      await loadUsersSmooth({ targetPage: page, append: false, currentQuery: query })
    } catch (err) {
      setError(err.message)
    } finally {
      setUpdatingId(null)
    }
  }

  const submitContactUpdate = async () => {
    const normalizedUserId = Number(contactDialog?.id)
    if (!Number.isInteger(normalizedUserId)) return

    setUpdatingId(normalizedUserId)
    setError('')
    setSuccess('')
    try {
      const data = await apiFetch(
        `/api/admin/users/${normalizedUserId}/contact`,
        { method: 'PATCH', body: JSON.stringify({ email: contactDraft.email, mobileNumber: contactDraft.mobileNumber }) },
        token,
      )
      setSuccess(data?.message || 'Contact updated')
      setContactDialog(null)
      setContactDraft({ email: '', mobileNumber: '' })
      await loadUsersSmooth({ targetPage: page, append: false, currentQuery: query })
    } catch (err) {
      setError(err.message)
    } finally {
      setUpdatingId(null)
    }
  }

  const confirmDeleteConversation = async () => {
    if (!deleteConfirmDialog) return
    const { externalUserId } = deleteConfirmDialog
    setDeletingConversationId(externalUserId)
    setError('')
    try {
      await apiFetch(`/api/admin/conversations/${externalUserId}`, { method: 'DELETE' }, token)
      await loadConversations(conversationPage, { preserveScroll: true })
      setDeleteConfirmDialog(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setDeletingConversationId(null)
    }
  }

  if (!token) {
    return (
      <main className="grid h-dvh place-items-center bg-[#f4f6f8] p-4">
        <div className="rounded-2xl border border-[#e1e7eb] bg-white px-6 py-5 text-center">
          <h1 className="text-2xl font-bold text-[#1f2c34]">{dashboardTitle}</h1>
          <p className="mt-2 text-sm text-[#667781]">Login required.</p>
        </div>
      </main>
    )
  }

  return (
    <>
      <main className="h-dvh overflow-hidden bg-[#f5f7fa]">
        <section className="grid h-full w-full lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="hidden h-dvh bg-white px-4 py-4 shadow-sm lg:block">
            <AdminSidebar
              me={me}
              total={total}
              conversationTotal={conversationTotal}
              activePanel={activePanel}
              onSelectPanel={onSelectPanel}
              consoleTitle={consoleTitle}
            />
          </aside>

          <div className="relative h-dvh min-w-0 overflow-y-auto px-4 pb-6 pt-14 md:px-6 lg:pt-6">
            <div className="lg:hidden">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setMobileSidebarOpen(true)}
                className={`fixed left-3 top-3 z-40 rounded-full bg-white shadow-sm ${mobileSidebarOpen ? 'pointer-events-none opacity-0' : ''}`}
              >
                <Menu size={16} />
                <span className="sr-only">Open menu</span>
              </Button>
            </div>

            <div className={activePanel === 'conversations' ? 'w-full' : 'mx-auto w-full max-w-7xl'}>
              {activePanel === 'dashboard' ? (
                <div className="mb-3 rounded-2xl bg-white p-3 shadow-sm md:p-4">
                  <h1 className="text-2xl font-bold text-[#1f2c34]">{dashboardTitle}</h1>
                </div>
              ) : null}

              {activePanel === 'dashboard' ? (
                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-white p-3 shadow-sm">
                    <p className="text-xs font-medium text-[#667781]">Total Users</p>
                    <p className="mt-1 text-xl font-bold text-[#1f2c34]">{total}</p>
                  </div>
                  <div className="rounded-xl bg-white p-3 shadow-sm">
                    <p className="text-xs font-medium text-[#667781]">Total Conversations</p>
                    <p className="mt-1 text-xl font-bold text-[#1f2c34]">{conversationTotal}</p>
                  </div>
                  <div className="rounded-xl bg-white p-3 shadow-sm">
                    <p className="text-xs font-medium text-[#667781]">User Page</p>
                    <p className="mt-1 text-xl font-bold text-[#1f2c34]">{page}</p>
                  </div>
                </div>
              ) : null}

              {error ? <p className="mb-3 rounded-lg bg-[#fff1f3] px-3 py-2 text-sm text-[#cf294f]">{error}</p> : null}
              {success ? <p className="mb-3 rounded-lg bg-[#e8f8ee] px-3 py-2 text-sm text-[#12813b]">{success}</p> : null}

              {activePanel === 'users' ? (
                <AdminUsersPanel
                  me={me}
                  searchInput={searchInput}
                  setSearchInput={setSearchInput}
                  onSubmitSearch={onSubmitSearch}
                  users={users}
                  total={total}
                  loading={loading}
                  usersRefreshing={usersRefreshing}
                  updatingId={updatingId}
                  page={page}
                  pageSize={PAGE_SIZE}
                  hasMore={hasMore}
                  query={query}
                  loadUsers={loadUsersSmooth}
                  setUserStaffProfile={setUserStaffProfile}
                  toggleUserDownloadAccess={toggleUserDownloadAccess}
                  toggleUserNoteAccess={toggleUserNoteAccess}
                  toggleUserBlockAccess={toggleUserBlockAccess}
                  openSetPasswordDialog={openSetPasswordDialog}
                  openProfileNoteDialog={openProfileNoteDialog}
                  openContactDialog={openContactDialog}
                />
              ) : null}

              {activePanel === 'conversations' ? (
                <AdminConversationsPanel
                  conversations={conversations}
                  conversationSearchInput={conversationSearchInput}
                  setConversationSearchInput={setConversationSearchInput}
                  onSubmitConversationSearch={onSubmitConversationSearch}
                  conversationTotal={conversationTotal}
                  conversationPageSize={CONVERSATION_PAGE_SIZE}
                  conversationPage={conversationPage}
                  conversationHasMore={conversationHasMore}
                  conversationLoading={conversationLoading}
                  conversationRefreshing={conversationRefreshing}
                  conversationQuery={conversationQuery}
                  loadConversations={loadConversations}
                  conversationListScrollRef={conversationListScrollRef}
                  me={me}
                  teamMembers={teamMembers}
                  reloadTeamMembers={loadTeamMembers}
                  forwardToByExternalId={forwardToByExternalId}
                  setForwardToByExternalId={setForwardToByExternalId}
                  forwardConversation={forwardConversation}
                  savingConversationId={savingConversationId}
                  deletingConversationId={deletingConversationId}
                  requestDeleteConversation={requestDeleteConversation}
                  openConversationMessages={openConversationMessages}
                />
              ) : null}
            </div>
          </div>

          <AdminConversationDrawer
            viewingConversation={viewingConversation}
            closeConversationMessages={closeConversationMessages}
            viewingTotal={viewingTotal}
            noteDraftByExternalId={noteDraftByExternalId}
            setNoteDraftByExternalId={setNoteDraftByExternalId}
            saveNote={saveNote}
            savingConversationId={savingConversationId}
            viewingScrollRef={viewingScrollRef}
            onViewingScroll={onViewingScroll}
            viewingLoading={viewingLoading}
            viewingMessages={viewingMessages}
            viewingPage={viewingPage}
            viewingHasMore={viewingHasMore}
            loadViewingPage={loadViewingPage}
          />
        </section>
      </main>

      {deleteConfirmDialog ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#e1e7eb] bg-white p-5 shadow-lg">
            <h2 className="text-lg font-bold text-[#1f2c34]">Delete Conversation?</h2>
            <p className="mt-2 text-sm text-[#667781]">
              Delete all messages for <span className="font-semibold">{deleteConfirmDialog.username}</span>. This action cannot be undone.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmDialog(null)}
                disabled={deletingConversationId !== null}
                className="flex-1 rounded-lg border border-[#d5dde2] bg-white px-3 py-2 text-sm font-semibold text-[#1f2c34] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteConversation}
                disabled={deletingConversationId !== null}
                className="flex-1 rounded-lg bg-[#cf294f] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {deletingConversationId !== null ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {passwordDialog ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#e1e7eb] bg-white p-5 shadow-lg">
            <h2 className="text-lg font-bold text-[#1f2c34]">Set New Password</h2>
            <p className="mt-2 text-sm text-[#667781]">
              Set a new password for <span className="font-semibold text-[#1f2c34]">{passwordDialog.username}</span>.
            </p>
            <div className="mt-4 space-y-3">
              <input
                type="password"
                value={passwordDraft}
                onChange={(event) => setPasswordDraft(event.target.value)}
                placeholder="New password"
                className="h-11 w-full rounded-lg border border-[#d5dde2] px-3 text-sm outline-none focus:border-[#1aa34a]"
              />
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={closeSetPasswordDialog}
                disabled={updatingId !== null}
                className="flex-1 rounded-lg border border-[#d5dde2] bg-white px-3 py-2 text-sm font-semibold text-[#1f2c34] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitSetPassword}
                disabled={updatingId === Number(passwordDialog.id)}
                className="flex-1 rounded-lg bg-[#25d366] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {updatingId === Number(passwordDialog.id) ? 'Saving...' : 'Save Password'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {profileNoteDialog ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#e1e7eb] bg-white p-5 shadow-lg">
            <h2 className="text-lg font-bold text-[#1f2c34]">Set Profile Note</h2>
            <p className="mt-2 text-sm text-[#667781]">
              Save a private profile note for <span className="font-semibold text-[#1f2c34]">{profileNoteDialog.username}</span>.
            </p>
            <div className="mt-4">
              <textarea
                value={profileNoteDraft}
                onChange={(event) => setProfileNoteDraft(event.target.value)}
                placeholder="Add profile note"
                rows={6}
                className="w-full rounded-lg border border-[#d5dde2] px-3 py-2 text-sm outline-none focus:border-[#1aa34a]"
              />
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={closeProfileNoteDialog}
                disabled={updatingId !== null}
                className="flex-1 rounded-lg border border-[#d5dde2] bg-white px-3 py-2 text-sm font-semibold text-[#1f2c34] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitProfileNote}
                disabled={updatingId === Number(profileNoteDialog.id)}
                className="flex-1 rounded-lg bg-[#25d366] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {updatingId === Number(profileNoteDialog.id) ? 'Saving...' : 'Save Note'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {contactDialog ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#e1e7eb] bg-white p-5 shadow-lg">
            <h2 className="text-lg font-bold text-[#1f2c34]">Edit Contact</h2>
            <p className="mt-2 text-sm text-[#667781]">
              Update email or mobile number for <span className="font-semibold text-[#1f2c34]">{contactDialog.username}</span>.
            </p>
            <div className="mt-4 space-y-3">
              <input
                type="email"
                value={contactDraft.email}
                onChange={(event) => setContactDraft((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="Email"
                className="h-11 w-full rounded-lg border border-[#d5dde2] px-3 text-sm outline-none focus:border-[#1aa34a]"
              />
              <input
                type="text"
                value={contactDraft.mobileNumber}
                onChange={(event) => setContactDraft((prev) => ({ ...prev, mobileNumber: event.target.value }))}
                placeholder="Mobile number"
                className="h-11 w-full rounded-lg border border-[#d5dde2] px-3 text-sm outline-none focus:border-[#1aa34a]"
              />
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={closeContactDialog}
                disabled={updatingId !== null}
                className="flex-1 rounded-lg border border-[#d5dde2] bg-white px-3 py-2 text-sm font-semibold text-[#1f2c34] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitContactUpdate}
                disabled={updatingId === Number(contactDialog.id)}
                className="flex-1 rounded-lg bg-[#25d366] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {updatingId === Number(contactDialog.id) ? 'Saving...' : 'Save Contact'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`fixed inset-0 z-50 transition-all duration-300 ease-out lg:hidden ${mobileSidebarOpen ? 'pointer-events-auto bg-black/35 opacity-100' : 'pointer-events-none bg-black/0 opacity-0'}`}
        onClick={() => setMobileSidebarOpen(false)}
      >
        <aside
          className={`absolute left-0 top-0 h-full w-[86vw] max-w-85 overflow-y-auto bg-white p-4 shadow-xl transition-transform duration-300 ease-out ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex justify-end">
            <Button variant="outline" size="icon-sm" onClick={() => setMobileSidebarOpen(false)}>
              <X size={16} />
            </Button>
          </div>
          <AdminSidebar
            me={me}
            total={total}
            conversationTotal={conversationTotal}
            activePanel={activePanel}
            onSelectPanel={onSelectPanel}
            consoleTitle={consoleTitle}
          />
        </aside>
      </div>
    </>
  )
}

export default ManagementConsolePage
