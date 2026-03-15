import { useEffect, useMemo, useRef, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { Button } from '../ui/button'
import AdminSidebar from './AdminSidebar'
import AdminUsersPanel from './AdminUsersPanel'
import AdminAccessPanel from './AdminAccessPanel'
import AdminConversationsPanel from './AdminConversationsPanel'
import AdminConversationDrawer from './AdminConversationDrawer'
import { apiFetch } from './adminApi'

const PAGE_SIZE = 30
const CONVERSATION_PAGE_SIZE = 10
const DRAWER_PAGE_SIZE = 40

function AdminPage() {
  const token = useMemo(() => localStorage.getItem('chat_token') || '', [])
  const [me, setMe] = useState(null)
  const [users, setUsers] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [updatingId, setUpdatingId] = useState(null)
  const [error, setError] = useState('')
  const [activePanel, setActivePanel] = useState('dashboard')
  const [conversations, setConversations] = useState([])
  const [teamMembers, setTeamMembers] = useState([])
  const [conversationPage, setConversationPage] = useState(1)
  const [conversationHasMore, setConversationHasMore] = useState(false)
  const [conversationTotal, setConversationTotal] = useState(0)
  const [conversationLoading, setConversationLoading] = useState(false)
  const [savingConversationId, setSavingConversationId] = useState(null)
  const [noteDraftByExternalId, setNoteDraftByExternalId] =  useState({})
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
  const [accessIdentifier, setAccessIdentifier] = useState('')
  const [accessResultUser, setAccessResultUser] = useState(null)
  const [accessAssignType, setAccessAssignType] = useState('model_admin')
  const [accessLoading, setAccessLoading] = useState(false)
  const conversationListScrollRef = useRef(null)

  const loadUsers = async ({ targetPage = 1, append = false, currentQuery = '' } = {}) => {
    setLoading(true)
    setError('')
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
    loadUsers({ targetPage: 1, append: false, currentQuery: query })
  }, [token, query])

  const loadConversations = async (targetPage = 1, options = {}) => {
    const preserveScroll = Boolean(options.preserveScroll)
    const container = conversationListScrollRef.current
    const previousScrollTop = preserveScroll && container ? container.scrollTop : 0
    setConversationLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: String(CONVERSATION_PAGE_SIZE),
      })
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
      setConversationLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    loadConversations(1)
  }, [token])

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

  const findAccessUser = async () => {
    const identifier = accessIdentifier.trim()
    if (!identifier) return
    setAccessLoading(true)
    setError('')
    setAccessResultUser(null)
    try {
      const params = new URLSearchParams({ page: '1', limit: '50', q: identifier })
      const data = await apiFetch(`/api/admin/users?${params.toString()}`, {}, token)
      const normalized = identifier.toLowerCase()
      const exact = (data.users || []).find((u) =>
        [u.uniqueUsername, u.email, u.mobileNumber].some((value) => String(value || '').toLowerCase() === normalized),
      )
      if (!exact) {
        throw new Error('No user found by this email/mobile/unique id')
      }
      setAccessResultUser(exact)
      setAccessAssignType(exact.role === 'model_admin' ? 'model_admin' : (exact.canHandleExternalChat ? 'agent' : 'agent'))
    } catch (err) {
      setError(err.message)
    } finally {
      setAccessLoading(false)
    }
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

  const forwardConversation = async (externalUserId) => {
    const toUserId = Number(forwardToByExternalId[externalUserId] || 0)
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

  const applyAccessFromFinder = async () => {
    if (!accessResultUser) return
    setUpdatingId(accessResultUser.id)
    setError('')
    try {
      const user = accessResultUser
      if (accessAssignType === 'model_admin') {
        if (user.role !== 'model_admin') {
          await apiFetch(
            `/api/admin/users/${user.id}/role`,
            { method: 'PATCH', body: JSON.stringify({ role: 'model_admin' }) },
            token,
          )
        }
      } else {
        if (user.role !== 'user') {
          await apiFetch(
            `/api/admin/users/${user.id}/role`,
            { method: 'PATCH', body: JSON.stringify({ role: 'user' }) },
            token,
          )
        }
        await apiFetch(
          `/api/admin/users/${user.id}/external-access`,
          { method: 'PATCH', body: JSON.stringify({ enabled: true }) },
          token,
        )
      }

      await loadUsers({ targetPage: page, append: false, currentQuery: query })
      await loadTeamMembers()
      await findAccessUser()
    } catch (err) {
      setError(err.message)
    } finally {
      setUpdatingId(null)
    }
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
      } catch (_err) {
        // Keep existing UI stable if background refresh fails once.
      }
    }, 2000)
    return () => window.clearInterval(intervalId)
  }, [viewingConversation?.externalUserId, token, viewingPage])

  useEffect(() => {
    if (!viewingConversation?.externalUserId || viewingPage !== 1) return
    const container = viewingScrollRef.current
    if (!container) return
    if (!isViewingNearBottom) return
    container.scrollTop = container.scrollHeight
  }, [viewingMessages, viewingConversation?.externalUserId, viewingPage, isViewingNearBottom])

  const onViewingScroll = () => {
    const container = viewingScrollRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    setIsViewingNearBottom(distanceFromBottom < 80)
  }

  const manageableTeamMembers = teamMembers
    .filter(
      (member) =>
        Number(member.id) !== Number(me?.id) &&
        (member.role === 'model_admin' || (member.role === 'user' && member.canHandleExternalChat)),
    )
    .sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')))

  const onSelectPanel = (panel) => {
    setActivePanel(panel)
    setMobileSidebarOpen(false)
  }

  if (!token) {
    return (
      <main className="grid h-dvh place-items-center bg-[#f4f6f8] p-4">
        <div className="rounded-2xl border border-[#e1e7eb] bg-white px-6 py-5 text-center">
          <h1 className="text-2xl font-bold text-[#1f2c34]">Admin Page</h1>
          <p className="mt-2 text-sm text-[#667781]">Login required.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-dvh bg-linear-to-b from-[#eef6ff] via-[#f5f8fb] to-[#f4f6f8] p-4 md:p-6">
      <section className={`mx-auto grid w-full gap-4 lg:grid-cols-[260px_minmax(0,1fr)] ${activePanel === 'conversations' ? 'max-w-none' : 'max-w-7xl'}`}>
        <aside className="hidden rounded-2xl border border-[#dce5eb] bg-white/95 p-4 shadow-sm backdrop-blur lg:block">
          <AdminSidebar me={me} total={total} conversationTotal={conversationTotal} activePanel={activePanel} onSelectPanel={onSelectPanel} />
        </aside>

        <div>
        <div className="mb-3 lg:hidden">
          <Button variant="outline" size="sm" onClick={() => setMobileSidebarOpen(true)} className="inline-flex items-center gap-2">
            <Menu size={16} />
            Open Menu
          </Button>
        </div>
        {activePanel === 'dashboard' || activePanel === 'access' ? (
        <div className="mb-3 rounded-2xl border border-[#dce5eb] bg-white/95 p-3 shadow-sm backdrop-blur md:p-4">
          <h1 className="text-2xl font-bold text-[#1f2c34]">
            {activePanel === 'access' ? 'Make Model Admin / Agent' : 'Admin Dashboard'}
          </h1>
        </div>
        ) : null}

        {activePanel === 'dashboard' ? (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[#dce5eb] bg-white p-3 shadow-sm">
            <p className="text-xs font-medium text-[#667781]">Total Users</p>
            <p className="mt-1 text-xl font-bold text-[#1f2c34]">{total}</p>
          </div>
          <div className="rounded-xl border border-[#dce5eb] bg-white p-3 shadow-sm">
            <p className="text-xs font-medium text-[#667781]">Total Conversations</p>
            <p className="mt-1 text-xl font-bold text-[#1f2c34]">{conversationTotal}</p>
          </div>
          <div className="rounded-xl border border-[#dce5eb] bg-white p-3 shadow-sm">
            <p className="text-xs font-medium text-[#667781]">User Page</p>
            <p className="mt-1 text-xl font-bold text-[#1f2c34]">{page}</p>
          </div>
        </div>
        ) : null}

        {error ? <p className="mb-3 rounded-lg bg-[#fff1f3] px-3 py-2 text-sm text-[#cf294f]">{error}</p> : null}

        {activePanel === 'users' ? (
          <AdminUsersPanel
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            onSubmitSearch={onSubmitSearch}
            users={users}
            total={total}
            loading={loading}
            page={page}
            hasMore={hasMore}
            query={query}
            loadUsers={loadUsers}
          />
        ) : null}

        {activePanel === 'access' ? (
          <AdminAccessPanel
            accessIdentifier={accessIdentifier}
            setAccessIdentifier={setAccessIdentifier}
            findAccessUser={findAccessUser}
            accessLoading={accessLoading}
            accessResultUser={accessResultUser}
            accessAssignType={accessAssignType}
            setAccessAssignType={setAccessAssignType}
            applyAccessFromFinder={applyAccessFromFinder}
            updatingId={updatingId}
            manageableTeamMembers={manageableTeamMembers}
          />
        ) : null}

        {activePanel === 'conversations' ? (
          <AdminConversationsPanel
            conversations={conversations}
            conversationTotal={conversationTotal}
            conversationPage={conversationPage}
            conversationHasMore={conversationHasMore}
            conversationLoading={conversationLoading}
            loadConversations={loadConversations}
            conversationListScrollRef={conversationListScrollRef}
            me={me}
            teamMembers={teamMembers}
            forwardToByExternalId={forwardToByExternalId}
            setForwardToByExternalId={setForwardToByExternalId}
            openConversationMessages={openConversationMessages}
            forwardConversation={forwardConversation}
            savingConversationId={savingConversationId}
          />
        ) : null}
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

      <div
        className={`fixed inset-0 z-50 transition-all duration-300 ease-out lg:hidden ${
          mobileSidebarOpen ? 'pointer-events-auto bg-black/35 opacity-100' : 'pointer-events-none bg-black/0 opacity-0'
        }`}
        onClick={() => setMobileSidebarOpen(false)}
      >
          <aside
            className={`absolute left-0 top-0 h-full w-[86vw] max-w-85 overflow-y-auto border-r border-[#dce5eb] bg-white p-4 shadow-xl transition-transform duration-300 ease-out ${
              mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex justify-end">
              <Button variant="outline" size="icon-sm" onClick={() => setMobileSidebarOpen(false)}>
                <X size={16} />
              </Button>
            </div>
            <AdminSidebar me={me} total={total} conversationTotal={conversationTotal} activePanel={activePanel} onSelectPanel={onSelectPanel} />
          </aside>
      </div>
    </main>
  )
}

export default AdminPage
