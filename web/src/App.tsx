import { useEffect, useState } from 'react'
import { ThemeProvider } from 'next-themes'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/app-shell'
import { NotFoundContent } from '@/components/not-found-content'
import { Toaster } from '@/components/ui/sonner'
import { AppStateProvider } from '@/lib/app-state'
import { SettingsProvider } from '@/lib/settings'
import { ActivityPage } from '@/pages/activity'
import { Dashboard } from '@/pages/dashboard'
import { FaucetPage } from '@/pages/faucet'
import { Landing } from '@/pages/landing'
import { MarketPage } from '@/pages/market'
import { NotFoundPage } from '@/pages/not-found'
import { PayPage } from '@/pages/pay'
import { PaymentLinkPage } from '@/pages/payment-link'
import { RulesPage } from '@/pages/rules'
import { SendPage } from '@/pages/send'
import { SettingsPage } from '@/pages/settings'
import { WithdrawPage } from '@/pages/withdraw'
import { YieldPage } from '@/pages/yield'

import { ReactLenis } from 'lenis/react'

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export function App() {
  const reducedMotion = usePrefersReducedMotion()
  return (
    <ReactLenis root options={{ duration: reducedMotion ? 0 : 1.1 }}>
      <ThemeProvider
        attribute="class"
        storageKey="mirai:theme"
        defaultTheme="light"
        disableTransitionOnChange
      >
        <SettingsProvider>
          <AppStateProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/pay/:address" element={<PayPage />} />
                <Route path="/app" element={<AppShell />}>
                  <Route index element={<Dashboard />} />
                  <Route path="activity" element={<ActivityPage />} />
                  <Route path="faucet" element={<FaucetPage />} />
                  <Route path="yield" element={<YieldPage />} />
                  <Route path="market" element={<MarketPage />} />
                  <Route path="send" element={<SendPage />} />
                  <Route path="withdraw" element={<WithdrawPage />} />
                  <Route path="rules" element={<RulesPage />} />
                  <Route path="link" element={<PaymentLinkPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFoundContent />} />
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </BrowserRouter>
            <Toaster />
          </AppStateProvider>
        </SettingsProvider>
      </ThemeProvider>
    </ReactLenis>
  )
}
