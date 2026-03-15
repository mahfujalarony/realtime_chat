function ChatLoadingScreen({ portalBadgeLabel }) {
  return (
    <main className="h-[100dvh] overflow-hidden bg-[#e8dfd6] p-0">
      {portalBadgeLabel ? (
        <div className="pointer-events-none absolute right-3 top-3 z-40 rounded-full bg-[#111b21] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
          {portalBadgeLabel} Route
        </div>
      ) : null}
      <section className="relative flex h-full w-full overflow-hidden bg-white">
        <aside className="w-full bg-[#f8f8f8] md:max-w-sm md:border-r md:border-[#e4e4e4]">
          <div className="border-b border-[#dce4e8] bg-[#f0f2f5] px-4 pb-4 pt-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 animate-pulse rounded-full bg-[#d7dde1]" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-28 animate-pulse rounded bg-[#d7dde1]" />
                <div className="h-2.5 w-16 animate-pulse rounded bg-[#dfe4e8]" />
              </div>
            </div>
            <div className="mt-4 h-11 animate-pulse rounded-full bg-[#e2e7eb]" />
          </div>
          <div className="space-y-1 px-4 py-3">
            {[...Array(7)].map((_, i) => (
              <div key={`sk-user-${i}`} className="flex items-center gap-3 rounded-lg px-1 py-2">
                <div className="h-11 w-11 animate-pulse rounded-full bg-[#d9dfe3]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3 w-32 animate-pulse rounded bg-[#d7dde1]" />
                  <div className="h-2.5 w-24 animate-pulse rounded bg-[#e2e7eb]" />
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="hidden flex-1 flex-col bg-[#efeae2] md:flex">
          <div className="border-b border-[#e4e4e4] bg-[#f0f2f5] px-5 py-4">
            <div className="h-4 w-44 animate-pulse rounded bg-[#d7dde1]" />
          </div>
          <div className="flex-1 space-y-3 px-8 py-6">
            {[...Array(8)].map((_, i) => (
              <div
                key={`sk-msg-${i}`}
                className={`h-12 animate-pulse rounded-2xl ${i % 2 === 0 ? 'w-56 bg-white/85' : 'ml-auto w-64 bg-[#d9fdd3]/80'}`}
              />
            ))}
          </div>
          <div className="border-t border-[#e4e4e4] bg-[#f0f2f5] px-4 py-3">
            <div className="h-10 animate-pulse rounded-full bg-white" />
          </div>
        </div>
      </section>
    </main>
  )
}

export default ChatLoadingScreen
