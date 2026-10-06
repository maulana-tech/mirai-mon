import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useLenis } from 'lenis/react'
import { useTheme } from 'next-themes'
import {
  ActivityIcon,
  ArrowUpRightIcon,
  ChartCandlestickIcon,
  DropletsIcon,
  ExternalLinkIcon,
  LandmarkIcon,
  Link2Icon,
  LockIcon,
  LogOutIcon,
  MoonIcon,
  PanelLeftIcon,
  SendIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SunIcon,
  TrendingUpIcon,
  WalletIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { AddressAvatar } from '@/components/brand/address-avatar'
import { LogoMark } from '@/components/brand/logo'
import { Traces } from '@/components/landing/kit'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { CONTRACT_ID, EXPLORER_CONTRACT_URL } from '@/lib/config'
import { useT, type MessageKey } from '@/lib/i18n'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { cn } from '@/lib/utils'
import { useWallet } from '@/lib/wallet'
import { PasskeyDialog } from '@/components/passkey-dialog'

const ITEM =
  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]'
const ITEM_IDLE = 'text-muted-foreground hover:bg-muted hover:text-foreground'
const ITEM_ACTIVE = 'bg-primary/10 text-primary-ink'

const PANEL_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

function greetingKey(hour: number): MessageKey {
  if (hour >= 5 && hour < 12) return 'greeting.morning'
  if (hour >= 12 && hour < 17) return 'greeting.afternoon'
  if (hour >= 17 && hour < 21) return 'greeting.evening'
  return 'greeting.night'
}

function labelClass(rail: boolean): string {
  return cn(
    'whitespace-nowrap transition-[opacity,translate] duration-[180ms] ease-out motion-reduce:transition-none',
    // collapse fades with no delay so text never outlives the shrinking panel
    rail ? '-translate-x-1 opacity-0' : 'translate-x-0 opacity-100 delay-[90ms]',
  )
}

function SectionLabel({ rail, children }: { rail: boolean; children: string }) {
  return (
    <p
      className={cn(
        'px-3 pt-5 pb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase',
        labelClass(rail),
      )}
    >
      {children}
    </p>
  )
}

type SidebarContentProps = {
  rail?: boolean
  onNavigate?: () => void
  onToggle?: () => void
}

function SidebarContent({ rail = false, onNavigate, onToggle }: SidebarContentProps) {
  const t = useT()
  const { address, connecting, disconnect } = useWallet()
  const label = labelClass(rail)
  const [pickerOpen, setPickerOpen] = useState(false)

  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(ITEM, isActive ? ITEM_ACTIVE : ITEM_IDLE)

  return (
    <div className="flex h-full flex-col p-4">
      <div className={cn("flex items-center pt-1 pb-2", rail ? "justify-center" : "justify-between px-[9px]")}>
        <div className={cn("flex items-center gap-2", rail && "hidden")}>
          <LogoMark size={22} />
          <span className={cn('text-lg font-semibold tracking-tight', label)}>Mirai</span>
        </div>
        {onToggle && (
          <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label="Toggle Sidebar" className={cn(rail && "size-10")}>
            <PanelLeftIcon className={cn("text-muted-foreground", rail ? "size-5" : "size-4")} />
          </Button>
        )}
      </div>
      <nav className="no-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <SectionLabel rail={rail}>{t('nav.menu')}</SectionLabel>
        <NavLink to="/app" end onClick={onNavigate} className={navClass}>
          <LandmarkIcon className="size-[18px] shrink-0" />
          <span className={label}>{t('nav.dashboard')}</span>
        </NavLink>
        <NavLink to="/app/activity" onClick={onNavigate} className={navClass}>
          <ActivityIcon className="size-[18px] shrink-0" />
          <span className={label}>{t('nav.activity')}</span>
        </NavLink>
        <SectionLabel rail={rail}>{t('nav.features')}</SectionLabel>
        <NavLink to="/app/link" onClick={onNavigate} className={navClass}>
          <Link2Icon className="size-[18px] shrink-0" />
          <span className={label}>{t('nav.paymentLink')}</span>
        </NavLink>
        <NavLink to="/app/rules" onClick={onNavigate} className={navClass}>
          <SlidersHorizontalIcon className="size-[18px] shrink-0" />
          <span className={label}>{t('nav.rules')}</span>
        </NavLink>
        <NavLink to="/app/yield" onClick={onNavigate} className={navClass}>
          <TrendingUpIcon className="size-[18px] shrink-0" />
          <span className={label}>{t('nav.yield')}</span>
        </NavLink>
        <NavLink to="/app/market" onClick={onNavigate} className={navClass}>
          <ChartCandlestickIcon className="size-[18px] shrink-0" />
          <span className={label}>{t('nav.market')}</span>
        </NavLink>
        <SectionLabel rail={rail}>{t('nav.action')}</SectionLabel>
        <NavLink to="/app/send" onClick={onNavigate} className={navClass}>
          <SendIcon className="size-[18px] shrink-0" />
          <span className={label}>{t('nav.send')}</span>
        </NavLink>
        <NavLink to="/app/withdraw" onClick={onNavigate} className={navClass}>
          <ArrowUpRightIcon className="size-[18px] shrink-0" />
          <span className={label}>{t('nav.withdraw')}</span>
        </NavLink>
        <NavLink to="/app/faucet" onClick={onNavigate} className={navClass}>
          <DropletsIcon className="size-[18px] shrink-0" />
          <span className={label}>{t('nav.faucet')}</span>
        </NavLink>
      </nav>
      <div className="mt-2 flex flex-col pt-2 border-t">
        <SectionLabel rail={rail}>{t('nav.protocol')}</SectionLabel>
        <NavLink to="/app/settings" onClick={onNavigate} className={navClass}>
          <SettingsIcon className="size-[18px] shrink-0" />
          <span className={label}>{t('settings.title')}</span>
        </NavLink>
        {CONTRACT_ID && (
          <a
            href={EXPLORER_CONTRACT_URL}
            target="_blank"
            rel="noreferrer"
            className={cn(ITEM, ITEM_IDLE, 'mb-2')}
          >
            <ExternalLinkIcon className="size-[18px] shrink-0" />
            <span className={label}>{t('nav.viewContract')}</span>
          </a>
        )}
        {address ? (
          <button
            type="button"
            className={cn(ITEM, 'text-destructive hover:bg-destructive/10 hover:text-destructive')}
            onClick={() => void disconnect()}
          >
            <LogOutIcon className="size-[18px] shrink-0" />
            <span className={label}>{t('nav.disconnect')}</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              className={cn(
                ITEM,
                'text-primary-ink hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-50',
              )}
              disabled={connecting}
              onClick={() => setPickerOpen(true)}
            >
              <WalletIcon className="size-[18px] shrink-0" />
              <span className={label}>
                {connecting ? `${t('topbar.connecting')}...` : t('topbar.connect')}
              </span>
            </button>
            <PasskeyDialog open={pickerOpen} onOpenChange={setPickerOpen} />
          </>
        )}
      </div>
    </div>
  )
}

function ThemeToggle() {
  const t = useT()
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'

  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-white hover:bg-white/10 hover:text-white dark:text-cobalt dark:hover:bg-cobalt/10 dark:hover:text-cobalt"
      aria-label={t('shell.theme')}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
    </Button>
  )
}

function AddressChip({ address }: { address: string }) {
  const t = useT()

  const copy = async () => {
    await navigator.clipboard.writeText(address)
    toast.success(t('settings.copied'))
  }

  return (
    <button
      type="button"
      aria-label={t('shell.copyAddress')}
      className="flex items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-1 font-mono text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={() => void copy()}
    >
      <AddressAvatar address={address} size={24} className="rounded-full" />
      {shortAddress(address)}
    </button>
  )
}

/** Signing-session state: prompt-free until it ends, then the next action asks for the passkey. */
function SessionBadge() {
  const t = useT()
  const { status, sessionEndsAt, lock } = useWallet()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (status !== 'unlocked') return
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [status])

  if (status === 'none') return null
  if (status === 'locked' || sessionEndsAt === null) {
    return (
      <span
        title={t('session.lockedHint')}
        className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground"
      >
        <LockIcon className="size-3.5" />
        {t('session.locked')}
      </span>
    )
  }
  const minutes = Math.max(1, Math.ceil((sessionEndsAt - now) / 60_000))
  return (
    <span className="flex items-center gap-1 rounded-full border bg-card py-1 pr-1 pl-3 text-xs">
      <span className="size-2 rounded-full bg-cyan" aria-hidden="true" />
      <span title={t('session.activeHint')} className="tabular-nums">
        {t('session.active', { min: minutes })}
      </span>
      <button
        type="button"
        aria-label={t('session.lockNow')}
        title={t('session.lockNow')}
        onClick={lock}
        className="grid size-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <LockIcon className="size-3.5" />
      </button>
    </span>
  )
}

// inline transition-duration on the aside beats any motion-reduce: class, so query directly
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

export function AppShell() {
  const t = useT()
  const { address } = useWallet()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const reducedMotion = usePrefersReducedMotion()
  const asideRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()

  useScrollLock()

  // The app scrolls through the root Lenis instance, which overrides window.scrollTo with its own
  // target, so a new page has to reset Lenis itself or it opens at the previous page's offset.
  const lenis = useLenis()
  useEffect(() => {
    if (lenis) lenis.scrollTo(0, { immediate: true })
    else window.scrollTo(0, 0)
  }, [pathname, lenis])

  const toggleSidebar = () => setSidebarOpen((prev) => !prev)

  return (
    <div className="relative min-h-svh bg-cobalt dark:bg-white">
      {/* same cobalt + traces backdrop as the payment page; cards sit on it in white */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <Traces className="top-[28vh] -left-[30%] h-[46vh] w-[160%] text-white dark:text-cobalt" />
      </div>
      <aside
        ref={asideRef}
        id="app-sidebar"
        className={cn(
          'fixed top-4 bottom-4 left-4 z-40 hidden flex-col overflow-hidden rounded-2xl border bg-card shadow-lg shadow-stone-950/10 transition-[width] md:flex',
          sidebarOpen ? 'w-[264px]' : 'w-[72px]'
        )}
        style={{
          transitionTimingFunction: PANEL_EASE,
          transitionDuration: reducedMotion ? '0ms' : '300ms',
        }}
      >
        <SidebarContent rail={!sidebarOpen} onToggle={toggleSidebar} />
      </aside>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="left"
          className="w-72"
          closeLabel={t('common.close')}
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
          <SidebarContent onNavigate={() => setSheetOpen(false)} />
        </SheetContent>
      </Sheet>
      <div 
        ref={scrollRef} 
        className={cn(
          "relative z-10 w-full transition-[padding] duration-300",
          sidebarOpen ? "md:pl-[280px]" : "md:pl-[88px]"
        )}
      >
        <main className="mx-auto w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl px-4 pt-6 pb-12 md:pt-16">
          {/* touch tablets pass md: but never fire mouse hot zones, so keep the sheet toggle */}
          <div className="mb-4 flex md:pointer-fine:hidden">
            <button
              type="button"
              aria-label={t('shell.openMenu')}
              aria-haspopup="dialog"
              className="flex size-10 items-center justify-center rounded-xl border bg-card shadow-sm outline-none transition-all duration-200 hover:shadow-md focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
              onClick={() => setSheetOpen(true)}
            >
              <LogoMark size={22} />
            </button>
          </div>
          <div className="mb-8 flex items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-white dark:text-cobalt">
              {t(greetingKey(new Date().getHours()))}
            </h1>
            <div className="flex items-center gap-2">
              <SessionBadge />
              {address && <AddressChip address={address} />}
              <ThemeToggle />
            </div>
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
