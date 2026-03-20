import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { clearAccessToken, fetchJsonWithAuth, getAccessToken, refreshSession, subscribeToAuth } from './lib/auth'

import Admin from './components/admin/AdminPage.jsx'
import ModelAdmin from './components/model_admin/ModelAdmin.jsx'

function defaultRouteForUser(user) {
  const role = String(user?.role || 'user')
  if (role === 'admin') return '/admin/dashboard'
  if (role === 'model_admin') return '/model_admin/dashboard'
  return '/'
}

function RoleRoute({ children, allowRoles = [], allowUnauthenticated = false }) {
  const [state, setState] = useState({ loading: true, user: null, token: getAccessToken() })

  useEffect(() => subscribeToAuth((token) => setState((prev) => ({ ...prev, token }))), [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        let user = null
        if (getAccessToken()) {
          const payload = await fetchJsonWithAuth('/api/auth/me')
          user = payload?.user || null
        } else {
          const payload = await refreshSession()
          user = payload?.user || null
        }
        if (!mounted) return
        setState({ loading: false, user, token: getAccessToken() })
      } catch {
        if (!mounted) return
        clearAccessToken()
        setState({ loading: false, user: null, token: '' })
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (state.loading) return

    const token = state.token || getAccessToken()
    if (!token) {
      setState((prev) => {
        if (!prev.user) return prev
        return { ...prev, user: null }
      })
      return
    }

    if (state.user) return

    let cancelled = false
    setState((prev) => ({ ...prev, loading: true }))

    fetchJsonWithAuth('/api/auth/me')
      .then((payload) => {
        if (cancelled) return
        setState({ loading: false, user: payload?.user || null, token: getAccessToken() })
      })
      .catch(() => {
        if (cancelled) return
        clearAccessToken()
        setState({ loading: false, user: null, token: '' })
      })

    return () => {
      cancelled = true
    }
  }, [state.loading, state.token, state.user])

  if (state.loading && !allowUnauthenticated) {
    return <main className="grid h-dvh place-items-center bg-[#f4f6f8] text-sm text-[#667781]">Checking access...</main>
  }

  const token = state.token || getAccessToken()
  if (!token) {
    if (allowUnauthenticated) return children
    return <Navigate to="/" replace />
  }

  if (!state.user) {
    if (allowUnauthenticated) return children
    return <Navigate to="/" replace />
  }

  const role = String(state.user.role || 'user')
  if (allowRoles.includes(role)) return children || <Outlet />
  return <Navigate to={defaultRouteForUser(state.user)} replace />
}


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RoleRoute allowRoles={['user', 'admin', 'model_admin']} allowUnauthenticated><App /></RoleRoute>} />
        <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
        <Route element={<RoleRoute allowRoles={['admin', 'model_admin']} />}>
          <Route path="/admin/*" element={<Admin />} />
        </Route>
        <Route path="/model_admin" element={<Navigate to="/model_admin/dashboard" replace />} />
        <Route element={<RoleRoute allowRoles={['admin', 'model_admin']} />}>
          <Route path="/model_admin/*" element={<ModelAdmin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
