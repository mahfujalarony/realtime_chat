import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

import Admin from './components/admin/AdminPage.jsx'
import ModelAdmin from './components/model_admin/ModelAdmin.jsx'

const API_URL = import.meta.env.VITE_API_URL || ''

function resolveApiPath(path) {
  if (!path.startsWith('/')) return path
  if (API_URL) return `${API_URL}${path}`
  return path
}

function defaultRouteForUser(user) {
  const role = String(user?.role || 'user')
  if (role === 'admin') return '/admin'
  if (role === 'model_admin') return '/model_admin'
  return '/'
}

function RoleRoute({ children, allowRoles = [], allowUnauthenticated = false }) {
  const [state, setState] = useState({ loading: true, user: null })

  useEffect(() => {
    const token = localStorage.getItem('chat_token') || ''
    if (!token) {
      setState({ loading: false, user: null })
      return
    }

    let mounted = true
    fetch(resolveApiPath('/api/auth/me'), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json().then((payload) => ({ ok: res.ok, payload })))
      .then(({ ok, payload }) => {
        if (!mounted) return
        if (!ok) {
          setState({ loading: false, user: null })
          return
        }
        setState({ loading: false, user: payload?.user || null })
      })
      .catch(() => {
        if (!mounted) return
        setState({ loading: false, user: null })
      })

    return () => {
      mounted = false
    }
  }, [])

  if (state.loading) {
    return <main className="grid h-dvh place-items-center bg-[#f4f6f8] text-sm text-[#667781]">Checking access...</main>
  }

  const token = localStorage.getItem('chat_token') || ''
  if (!token || !state.user) {
    if (allowUnauthenticated) return children
    return <Navigate to="/" replace />
  }

  const role = String(state.user.role || 'user')
  if (allowRoles.includes(role)) return children
  return <Navigate to={defaultRouteForUser(state.user)} replace />
}


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RoleRoute allowRoles={['user']} allowUnauthenticated><App /></RoleRoute>} />
        <Route path="/admin" element={<RoleRoute allowRoles={['admin']}><Admin /></RoleRoute>} />
        <Route path="/model_admin" element={<RoleRoute allowRoles={['model_admin']}><ModelAdmin /></RoleRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
