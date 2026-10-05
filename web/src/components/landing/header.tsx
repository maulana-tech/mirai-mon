import { Link } from 'react-router-dom'
import { useT } from '@/lib/i18n'
import { useWallet } from '@/lib/wallet'
import { cn } from '@/lib/utils'
import { ArrowLink, MiraiMark } from './kit'

/**
 * Fixed header: logo left, nav capsule centre, CTA capsule right.
 * `data-tone` is switched by LandingFX to "light" over white sections (logo + capsules turn cobalt).
 */
export function LandingHeader() {
  const t = useT()
  const { address } = useWallet()
  const nav = [
    ['#how', t('landing.navHow')],
    ['#features', t('landing.navFeatures')],
    ['#live', t('landing.navLive')],
  ] as const
  const capsule =
    'rounded-[4px] bg-black/25 p-1 backdrop-blur-md transition-colors duration-300 group-data-[tone=light]/h:bg-cobalt'
  return (
    <header data-site-header data-tone="dark" className="group/h fixed inset-x-0 top-0 z-30">
      <div className="flex items-center justify-between gap-4 px-5 py-5 md:px-6">
        <Link
          to="/"
          className="inline-flex shrink-0 items-center gap-2.5 text-white transition-colors duration-300 group-data-[tone=light]/h:text-cobalt"
        >
          <MiraiMark className="h-5" />
          <span className="font-fragment text-[15px] tracking-[0.25em] uppercase">Mirai</span>
        </Link>
        <nav className={cn('hidden items-center gap-1 text-[15px] text-white md:flex', capsule)}>
          {nav.map(([href, label]) => (
            <a key={href} href={href} className="rounded-[3px] px-4 py-2 hover:bg-white/10">
              {label}
            </a>
          ))}
        </nav>
        <div className={capsule}>
          <ArrowLink to="/app" className="h-9 gap-6 text-[15px] [&>span]:size-7">
            {address ? t('landing.ctaDashboard') : t('landing.cta')}
          </ArrowLink>
        </div>
      </div>
    </header>
  )
}
