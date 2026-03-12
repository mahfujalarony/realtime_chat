function AuthScreen({
  authMode,
  setAuthMode,
  error,
  submitting,
  loginForm,
  setLoginForm,
  registerForm,
  setRegisterForm,
  onLogin,
  onRegister,
}) {
  return (
    <main className="min-h-screen bg-[#e8dfd6] p-4 md:p-10">
      <section className="mx-auto w-full max-w-xl rounded-2xl border border-[#d9d9d9] bg-white p-6 shadow-xl">
        <h1 className="text-2xl font-bold text-[#1f2c34]">Chat App</h1>
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

        {authMode === 'login' ? (
          <form onSubmit={onLogin} className="mt-4 space-y-3">
            <input
              type="text"
              placeholder="Username / Email / Mobile"
              value={loginForm.identifier}
              onChange={(e) => setLoginForm((prev) => ({ ...prev, identifier: e.target.value }))}
              className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 text-sm outline-none focus:border-[#25d366]"
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={loginForm.password}
              onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
              className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 text-sm outline-none focus:border-[#25d366]"
              required
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-[#25d366] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? 'Logging in...' : 'Login'}
            </button>
          </form>
        ) : (
          <form onSubmit={onRegister} className="mt-4 space-y-3">
            <input
              type="text"
              placeholder="Username"
              value={registerForm.username}
              onChange={(e) => setRegisterForm((prev) => ({ ...prev, username: e.target.value }))}
              className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 text-sm outline-none focus:border-[#25d366]"
              required
            />
            <input
              type="email"
              placeholder="Email (optional if mobile is provided)"
              value={registerForm.email}
              onChange={(e) => setRegisterForm((prev) => ({ ...prev, email: e.target.value }))}
              className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 text-sm outline-none focus:border-[#25d366]"
            />
            <input
              type="text"
              placeholder="Mobile Number (optional if email is provided)"
              value={registerForm.mobileNumber}
              onChange={(e) => setRegisterForm((prev) => ({ ...prev, mobileNumber: e.target.value }))}
              className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 text-sm outline-none focus:border-[#25d366]"
            />
            <input
              type="date"
              value={registerForm.dateOfBirth}
              onChange={(e) => setRegisterForm((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
              className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 text-sm outline-none focus:border-[#25d366]"
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={registerForm.password}
              onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))}
              className="w-full rounded-lg border border-[#d9d9d9] px-3 py-2 text-sm outline-none focus:border-[#25d366]"
              required
            />
            <button
              type="submit"
              disabled={submitting}
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
