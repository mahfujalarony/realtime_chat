import { CloudUpload, Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'

function AuthScreen({
  authMode,
  setAuthMode,
  error,
  submitting,
  loginForm,
  setLoginForm,
  registerForm,
  setRegisterForm,
  registerProfileFile,
  setRegisterProfileFile,
  onLogin,
  onRegister,
}) {
  const [previewUrl, setPreviewUrl] = useState('')
  const [registerProfileError, setRegisterProfileError] = useState('')
  const [loginValidationError, setLoginValidationError] = useState('')
  const [registerValidationError, setRegisterValidationError] = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [showRegisterPassword, setShowRegisterPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const MAX_REGISTER_PROFILE_SIZE = 5 * 1024 * 1024

  const validateDateOfBirth = (dateOfBirth) => {
    if (!dateOfBirth) return 'Date of birth is required'
    const dob = new Date(`${dateOfBirth}T00:00:00`)
    if (Number.isNaN(dob.getTime())) return 'Please enter a valid date of birth'
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (dob > today) return 'Date of birth cannot be in the future'
    const minAllowed = new Date(today)
    minAllowed.setFullYear(today.getFullYear() - 120)
    if (dob < minAllowed) return 'Age cannot be more than 120 years'
    const minAgeDate = new Date(today)
    minAgeDate.setFullYear(today.getFullYear() - 13)
    if (dob > minAgeDate) return 'You must be at least 13 years old'
    return ''
  }

  useEffect(() => {
    if (!registerProfileFile) {
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(registerProfileFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [registerProfileFile])

  useEffect(() => {
    if (authMode !== 'register') {
      setRegisterProfileError('')
    }
    setLoginValidationError('')
    setRegisterValidationError('')
  }, [authMode])

  const validateLogin = () => {
    const identifier = String(loginForm.identifier || '').trim()
    const password = String(loginForm.password || '')
    if (!identifier) return 'Username, email, or mobile is required'
    if (!password) return 'Password is required'
    return ''
  }

  const validateRegister = () => {
    const username = String(registerForm.username || '').trim()
    const email = String(registerForm.email || '').trim()
    const mobileNumber = String(registerForm.mobileNumber || '').trim()
    const dateOfBirth = String(registerForm.dateOfBirth || '').trim()
    const password = String(registerForm.password || '')
    const confirmPassword = String(registerForm.confirmPassword || '')

    if (username.length < 3) return 'Username must be at least 3 characters'
    if (!email && !mobileNumber) return 'Email or mobile number is required'
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Please enter a valid email address'
    if (mobileNumber && !/^[0-9+\-\s]{3,20}$/.test(mobileNumber)) return 'Please enter a valid mobile number'
    const dobError = validateDateOfBirth(dateOfBirth)
    if (dobError) return dobError
    if (password.length < 6) return 'Password must be at least 6 characters'
    if (password !== confirmPassword) return 'Passwords do not match'
    return ''
  }

  const liveRegisterError = validateRegister()
  const isRegisterDisabled = submitting || Boolean(liveRegisterError) || Boolean(registerProfileError)

  const handleLoginSubmit = (event) => {
    const nextError = validateLogin()
    setLoginValidationError(nextError)
    if (nextError) {
      event.preventDefault()
      return
    }
    onLogin(event)
  }

  const handleRegisterSubmit = (event) => {
    const nextError = validateRegister()
    setRegisterValidationError(nextError)
    if (nextError) {
      event.preventDefault()
      return
    }
    onRegister(event)
  }

  return (
    <main className="min-h-screen bg-[#e8dfd6] p-4 md:p-10">
      <section className="mx-auto w-full max-w-xl rounded-2xl border border-[#d9d9d9] bg-white p-6 shadow-xl">
        <h1 className="text-2xl font-bold text-[#1f2c34]">Chat Web</h1>
        <p className="mt-1 text-sm text-[#667781]">Login or create account to start realtime chat</p>

        <div className="mt-4 flex rounded-lg bg-[#f0f2f5] p-1">
          <button
            type="button"
            onClick={() => setAuthMode('login')}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${
              authMode === 'login' ? 'bg-white text-[#1f2c34]' : 'text-[#667781]'
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('register')}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${
              authMode === 'register' ? 'bg-white text-[#1f2c34]' : 'text-[#667781]'
            }`}
          >
            Register
          </button>
        </div>

        {error ? <p className="mt-3 rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {authMode === 'login' && loginValidationError ? (
          <p className="mt-3 rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">{loginValidationError}</p>
        ) : null}
        {authMode === 'register' && (registerValidationError || liveRegisterError) ? (
          <p className="mt-3 rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">{registerValidationError || liveRegisterError}</p>
        ) : null}

        {authMode === 'login' ? (
          <form onSubmit={handleLoginSubmit} className="mt-4 space-y-3">
            <input
              type="text"
              placeholder="Username / Email / Mobile"
              value={loginForm.identifier}
              onChange={(e) => {
                setLoginForm((prev) => ({ ...prev, identifier: e.target.value }))
                setLoginValidationError('')
              }}
              className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 text-sm outline-none focus:border-[#25d366]"
              required
            />

            <div className="relative">
              <input
                type={showLoginPassword ? 'text' : 'password'}
                placeholder="Password"
                value={loginForm.password}
                onChange={(e) => {
                  setLoginForm((prev) => ({ ...prev, password: e.target.value }))
                  setLoginValidationError('')
                }}
                className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 pr-11 text-sm outline-none focus:border-[#25d366]"
                required
              />
              <button
                type="button"
                onClick={() => setShowLoginPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#667781]"
                aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
              >
                {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-[#25d366] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? 'Logging in...' : 'Login'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegisterSubmit} className="mt-4 space-y-3">
            <input
              type="text"
              placeholder="Username"
              value={registerForm.username}
              onChange={(e) => {
                setRegisterForm((prev) => ({ ...prev, username: e.target.value }))
                setRegisterValidationError('')
              }}
              className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 text-sm outline-none focus:border-[#25d366]"
              required
            />
            <input
              type="email"
              placeholder="Email (optional if mobile is provided)"
              value={registerForm.email}
              onChange={(e) => {
                setRegisterForm((prev) => ({ ...prev, email: e.target.value }))
                setRegisterValidationError('')
              }}
              className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 text-sm outline-none focus:border-[#25d366]"
            />
            <input
              type="text"
              placeholder="Mobile Number (optional if email is provided)"
              value={registerForm.mobileNumber}
              onChange={(e) => {
                setRegisterForm((prev) => ({ ...prev, mobileNumber: e.target.value }))
                setRegisterValidationError('')
              }}
              className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 text-sm outline-none focus:border-[#25d366]"
            />
            <input
              type="date"
              value={registerForm.dateOfBirth}
              onChange={(e) => {
                setRegisterForm((prev) => ({ ...prev, dateOfBirth: e.target.value }))
                setRegisterValidationError('')
              }}
              className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 text-sm outline-none focus:border-[#25d366]"
              required
            />

            <div className="relative">
              <input
                type={showRegisterPassword ? 'text' : 'password'}
                placeholder="Password"
                value={registerForm.password}
                onChange={(e) => {
                  setRegisterForm((prev) => ({ ...prev, password: e.target.value }))
                  setRegisterValidationError('')
                }}
                className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 pr-11 text-sm outline-none focus:border-[#25d366]"
                required
              />
              <button
                type="button"
                onClick={() => setShowRegisterPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#667781]"
                aria-label={showRegisterPassword ? 'Hide password' : 'Show password'}
              >
                {showRegisterPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Confirm Password"
                value={registerForm.confirmPassword || ''}
                onChange={(e) => {
                  setRegisterForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
                  setRegisterValidationError('')
                }}
                className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 pr-11 text-sm outline-none focus:border-[#25d366]"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#667781]"
                aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[#667781]">Profile Image (optional)</label>
              <input
                id="register-profile-image"
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null
                  if (file && file.size > MAX_REGISTER_PROFILE_SIZE) {
                    setRegisterProfileFile(null)
                    setRegisterProfileError('Profile image must be 5MB or less.')
                    e.target.value = ''
                    return
                  }
                  setRegisterProfileError('')
                  setRegisterProfileFile(file)
                }}
                className="hidden"
              />
              <label
                htmlFor="register-profile-image"
                className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-[#bfc9cf] bg-[#f7fafb] px-3 py-3 text-sm font-medium text-[#3d4f59] transition hover:border-[#25d366] hover:text-[#1f2c34]"
              >
                <div className="relative">
                  <div className="h-20 w-20 overflow-hidden rounded-full border-2 border-[#d9e0e4] bg-[#eef3f6]">
                    {previewUrl ? (
                      <img src={previewUrl} alt="Profile preview" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[#83949f]">
                        <CloudUpload size={28} />
                      </div>
                    )}
                  </div>
                  <div className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-[#25d366] text-white shadow">
                    <CloudUpload size={14} />
                  </div>
                </div>
                <span>{registerProfileFile ? 'Change profile image' : 'Upload profile image'}</span>
              </label>
              {registerProfileFile ? (
                <p className="text-xs text-[#54656f]">Selected: {registerProfileFile.name}</p>
              ) : (
                <p className="text-xs text-[#8696a0]">No file selected</p>
              )}
              {registerProfileError ? <p className="text-xs text-red-600">{registerProfileError}</p> : null}
            </div>

            <button
              type="submit"
              disabled={isRegisterDisabled}
              className="w-full rounded-lg bg-[#25d366] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? 'Creating account...' : 'Register'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}

export default AuthScreen
