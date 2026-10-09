import { useEffect, useState } from 'react'
import {
  ArrowDownLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  CheckIcon,
  FingerprintIcon,
  KeyRoundIcon,
  LaptopIcon,
  LockKeyholeIcon,
  PlaneIcon,
  SignatureIcon,
  UmbrellaIcon,
  VaultIcon,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { LandingFX } from '@/components/landing/fx'
import { LandingHeader } from '@/components/landing/header'
import { Basket, Hub, Lockers, Padlock, Relay, Vault } from '@lucasmarkes/hairline/react'
import { ArrowLink, MiraiMark, MonoLabel, PixelBand, Traces } from '@/components/landing/kit'
import { NetworkCircle } from '@/components/landing/network'
import { fetchProtocolStats, type ProtocolStats } from '@/lib/activity'
import { CHAIN_ID, EXPLORER_CONTRACT_URL, MIRAI_ADDRESS } from '@/lib/config'
import { FALLBACK_RATES } from '@/lib/rates'
import { formatMoney, useT, type MessageKey } from '@/lib/i18n'
import { formatApr } from '@/lib/strategies'
import { useStrategies } from '@/lib/use-strategies'

// The landing page is the public pitch: always English, whatever the app's saved locale.
const LANDING_LOCALE = 'en'

// Type scale follows the reference at 1920px: h1 ≈ 3.9vw, section titles ≈ 5vw, body ≈ 1vw.
const H1 = 'text-[clamp(2.6rem,3.9vw,5rem)] leading-[1] font-normal tracking-[-0.01em]'
const H2 = 'text-[clamp(3rem,5vw,6.5rem)] leading-[1] font-normal tracking-[-0.015em]'
const H3 = 'text-[clamp(1.75rem,2.4vw,3rem)] leading-[1.05] font-normal tracking-[-0.01em]'
const BODY = 'text-[clamp(1rem,1vw,1.2rem)] leading-[1.3]'

// What Mirai runs on, by layer: on-chain money, passkey identity, data, and the app itself.
// Each item has a logo (public/logos, see its README) or, for open standards without one, an icon.
const STACK: { group: MessageKey; items: [string, MessageKey, string | LucideIcon][] }[] = [
  {
    group: 'landing.stackGroupChain',
    items: [
      ['Monad', 'landing.stackMonad', '/tokens/mon.png'],
      ['AUSD · Agora', 'landing.stackAusd', '/tokens/ausd.png'],
      ['ERC-4626', 'landing.stackVault', VaultIcon],
      ['EIP-2612', 'landing.stackPermit', SignatureIcon],
    ],
  },
  {
    group: 'landing.stackGroupIdentity',
    items: [
      ['Mera', 'landing.stackMera', '/logos/mera.svg'],
      ['WebAuthn PRF', 'landing.stackPrf', '/logos/webauthn.svg'],
      ['BIP-39 · secp256k1', 'landing.stackKeys', KeyRoundIcon],
      ['AES-256-GCM', 'landing.stackAes', LockKeyholeIcon],
    ],
  },
  {
    group: 'landing.stackGroupData',
    items: [
      ['Nansen', 'landing.stackNansen', '/logos/nansen.png'],
      ['Chainlink', 'landing.stackChainlink', '/logos/chainlink.svg'],
      ['DexScreener', 'landing.stackDex', '/logos/dexscreener.png'],
      ['Envio', 'landing.stackEnvio', '/logos/envio.png'],
    ],
  },
  {
    group: 'landing.stackGroupApp',
    items: [
      ['Foundry · OpenZeppelin', 'landing.stackFoundry', '/logos/foundry.png'],
      ['React 19 · Vite', 'landing.stackReact', '/logos/react.svg'],
      ['ethers v6', 'landing.stackEthers', '/logos/ethers.svg'],
      ['Vercel', 'landing.stackVercel', '/logos/vercel.svg'],
    ],
  },
]

// Each card's figure is an interactive isometric drawing (hairline) that answers the pointer and idles on its own:
// a padlock that opens, payers around one hub, a payment routed down branches, lockers, a vault dial, a basket.
const FEATURES: { tag: MessageKey; title: MessageKey; body: MessageKey; Figure: typeof Padlock; to: string }[] = [
  { tag: 'landing.f1Tag', title: 'landing.f1Title', body: 'landing.f1Body', Figure: Padlock, to: '/app' },
  { tag: 'landing.f2Tag', title: 'landing.f2Title', body: 'landing.f2Body', Figure: Hub, to: '/app/link' },
  { tag: 'landing.f3Tag', title: 'landing.f3Title', body: 'landing.f3Body', Figure: Relay, to: '/app/rules' },
  { tag: 'landing.f4Tag', title: 'landing.f4Title', body: 'landing.f4Body', Figure: Lockers, to: '/app/pockets' },
  { tag: 'landing.f5Tag', title: 'landing.f5Title', body: 'landing.f5Body', Figure: Vault, to: '/app/yield' },
  { tag: 'landing.f6Tag', title: 'landing.f6Title', body: 'landing.f6Body', Figure: Basket, to: '/app/market' },
]

// hairline's colour hooks, mapped onto the card: plates take the card colour (it changes on hover), lines are white.
const FIGURE_THEME =
  '[--hairline-plate:var(--card)] [--hairline-hi:#fff] [--hairline-edge:rgb(255_255_255/0.75)] [--hairline-mid:rgb(255_255_255/0.45)] [--hairline-lo:rgb(255_255_255/0.18)] [--hairline-stroke:1]'

const USES: [MessageKey, MessageKey][] = [
  ['landing.use1Title', 'landing.use1Body'],
  ['landing.use2Title', 'landing.use2Body'],
  ['landing.use3Title', 'landing.use3Body'],
  ['landing.use4Title', 'landing.use4Body'],
]

// Gently staggered card heights on desktop; literal classes so Tailwind generates them.
// Offsets and drift stay small so a card never slides under the header or off the pinned viewport.
const CARD_OFFSET = ['md:mt-0', 'md:mt-[7vh]', 'md:mt-[3vh]', 'md:mt-[10vh]', 'md:mt-[5vh]']
const CARD_DRIFT = [0.03, 0.1, 0.06, 0.13, 0.08]

// System architecture: three lanes, each a list of [name, detail]. Names are code/product names (not translated).
const ARCH: { lane: MessageKey; nodes: [string, MessageKey | string][] }[] = [
  {
    lane: 'landing.archDevice',
    nodes: [
      ['Web app', 'React 19 · Vite · ethers v6'],
      ['Mera passkey', 'landing.archPasskey'],
      ['Account key', 'PRF → BIP-39 → secp256k1'],
      ['Pocket key', 'PRF (2nd salt) → HKDF → AES-GCM'],
    ],
  },
  {
    lane: 'landing.archChain',
    nodes: [
      ['Mirai.sol', 'landing.archMirai'],
      ['MiraiVault ×3', 'ERC-4626 · YieldStreamer 4 / 8 / 12%'],
      ['BasketVault', 'landing.archBasket'],
      ['AUSD', 'Agora · EIP-2612 permit'],
    ],
  },
  {
    lane: 'landing.archOff',
    nodes: [
      ['Envio HyperIndex', 'landing.archEnvio'],
      ['/api/market', 'landing.archMarket'],
      ['/api/onboard', 'landing.archOnboard'],
      ['Chainlink', 'BTC · ETH · LINK · USDC feeds'],
    ],
  },
]
const ARCH_ARROWS: MessageKey[] = ['landing.archArrowSign', 'landing.archArrowEvents']
const FLOW: [MessageKey, MessageKey][] = [
  ['landing.flowTitle1', 'landing.flow1'],
  ['landing.flowTitle2', 'landing.flow2'],
  ['landing.flowTitle3', 'landing.flow3'],
  ['landing.flowTitle4', 'landing.flow4'],
  ['landing.flowTitle5', 'landing.flow5'],
]

function Architecture() {
  const t = useT(LANDING_LOCALE)
  const label = (v: string) => (v.startsWith('landing.') ? t(v as MessageKey) : v)
  return (
    <>
      <div data-stagger className="mt-[8vh] grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        {ARCH.flatMap((lane, i) => [
          <div key={lane.lane} className="rounded-[4px] border border-white/15 p-4">
            <p className="font-fragment text-[11px] tracking-wider text-white/60 uppercase">{t(lane.lane)}</p>
            <ul className="mt-4 space-y-2">
              {lane.nodes.map(([name, detail]) => (
                <li key={name} className="rounded-[3px] bg-white/[0.07] px-3 py-2.5 transition-[background-color,transform] duration-300 hover:translate-x-1 hover:bg-white/[0.14]">
                  <p className="text-[15px]">{name}</p>
                  <p className="mt-0.5 font-fragment text-[10px] tracking-wider text-white/60 uppercase">{label(detail)}</p>
                </li>
              ))}
            </ul>
          </div>,
          i < ARCH_ARROWS.length && (
            <div key={`arrow-${i}`} className="flex items-center justify-center gap-2 py-1 md:flex-col md:px-1">
              <span className="font-fragment text-[10px] tracking-wider text-white/60 uppercase md:[writing-mode:vertical-rl]">
                {t(ARCH_ARROWS[i])}
              </span>
              <ArrowRightIcon className="size-4 text-white/70 max-md:rotate-90" />
            </div>
          ),
        ])}
      </div>
      {/* bento: each step is a tile with a small slice of the real product, all in blues, kept to a readable width */}
      <div className="mx-auto mt-[12vh] max-w-6xl">
      <h3 data-split className={H3}>
        {t('landing.archFlowTitle')}
      </h3>
      <ol data-stagger className="mt-10 grid gap-3 md:grid-cols-12">
        {FLOW.map(([title, body], i) => (
          <li
            key={title}
            className={`group/tile flex min-h-[22rem] flex-col rounded-[6px] p-5 text-white transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:-translate-y-1 hover:shadow-[0_24px_60px_-24px_rgb(6_71_179/0.8)] ${BENTO[i]}`}
          >
            <span className="grid size-8 place-items-center rounded-[3px] bg-current/10 font-fragment text-[11px]">0{i + 1}</span>
            <p className="mt-5 text-[clamp(1.3rem,1.6vw,1.9rem)] leading-tight">{t(title)}</p>
            <p className="mt-2 max-w-[30rem] text-sm leading-snug opacity-75">{t(body)}</p>
            <div className="mt-auto pt-6">
              <BentoVisual step={i} />
            </div>
          </li>
        ))}
      </ol>
      </div>
    </>
  )
}

// Bento tiles: column span (desktop) and tone per step; literal classes so Tailwind generates them.
const BENTO = [
  'md:col-span-5 bg-cobalt',
  'md:col-span-4 bg-[#053a94]',
  'md:col-span-3 bg-[#0a54cc]',
  'md:col-span-5 bg-[#053a94]',
  'md:col-span-7 bg-cobalt',
]

/** The product slice inside each bento tile: the pay sheet, the receipt, the split, the pockets, the activity feed. */
function BentoVisual({ step }: { step: number }) {
  const t = useT(LANDING_LOCALE)
  if (step === 0)
    return (
      <div className="rounded-[6px] border border-white/15 bg-white/10 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-white font-fragment text-xs text-cobalt">A</span>
          <div>
            <p className="text-sm">{t('pay.title', { name: 'Alya' })}</p>
            <p className="font-fragment text-[10px] text-white/50">0x59cC…2d98</p>
          </div>
        </div>
        <p className="mt-4 text-3xl tracking-tight tabular-nums">
          120.00 <span className="text-base text-white/50">AUSD</span>
        </p>
        <span className="mt-4 flex h-10 items-center justify-center gap-2 rounded-[4px] bg-white text-sm text-cobalt transition-transform duration-300 group-hover/tile:scale-[0.98]">
          <FingerprintIcon className="size-4 transition-transform duration-500 group-hover/tile:scale-125" />
          {t('pay.button')}
        </span>
      </div>
    )
  if (step === 1)
    return (
      <dl className="divide-y divide-white/10 rounded-[6px] border border-white/10 font-fragment text-[11px]">
        {[
          ['fn', 'payWithPermit()'],
          ['tx', '0x9f3a…c21e'],
          ['amount', '120.00 AUSD'],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between px-3 py-2.5">
            <dt className="text-white/50 uppercase">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div className="flex items-center gap-2 px-3 py-2.5 text-cyan">
          <CheckIcon className="size-3.5" />
          {t('landing.bentoSettled')}
        </div>
      </dl>
    )
  if (step === 2)
    return (
      <div>
        <p className="text-5xl tracking-tight tabular-nums">20%</p>
        <div className="mt-4 flex h-2.5 gap-1">
          <span className="w-4/5 rounded-full bg-white/35 transition-[width] duration-700 group-hover/tile:w-3/5" />
          <span className="flex-1 rounded-full bg-cyan" />
        </div>
        <div className="mt-3 flex justify-between font-fragment text-[10px] uppercase">
          <span className="opacity-70">{t('balances.spendable')} 96</span>
          <span>{t('balances.savings')} 24</span>
        </div>
      </div>
    )
  if (step === 3)
    return (
      <ul className="space-y-3">
        {(
          [
            [LaptopIcon, 'landing.bentoLaptop', 50, 'w-1/2 group-hover/tile:w-3/5'],
            [PlaneIcon, 'landing.bentoTrip', 30, 'w-[30%] group-hover/tile:w-2/5'],
            [UmbrellaIcon, 'landing.bentoRainy', 20, 'w-1/5 group-hover/tile:w-[30%]'],
          ] as const
        ).map(([Icon, name, pct, w]) => (
          <li key={name} className="flex items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-[4px] bg-white/15">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex justify-between text-sm">
                <span>{t(name)}</span>
                <span className="font-fragment text-xs tabular-nums">{((24 * pct) / 100).toFixed(2)}</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-white/15">
                <div className={`h-full rounded-full bg-white transition-[width] duration-700 ${w}`} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    )
  const feed: [typeof ArrowDownLeftIcon, string][] = [
    [ArrowDownLeftIcon, t('activity.pay', { amount: '120.00', saved: '24.00' })],
    [LaptopIcon, t('landing.bentoSavedTo', { amount: '12.00', name: t('landing.bentoLaptop') })],
    [PlaneIcon, t('landing.bentoSavedTo', { amount: '7.20', name: t('landing.bentoTrip') })],
  ]
  return (
    <ul className="divide-y divide-white/10 rounded-[6px] bg-white/[0.07]">
      {feed.map(([Icon, text], i) => (
        <li
          key={text}
          className="flex items-center gap-3 px-4 py-3 text-sm transition-transform duration-500 group-hover/tile:translate-x-1.5"
          style={{ transitionDelay: `${i * 60}ms` }}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 flex-1 truncate">{text}</span>
          <span className="font-fragment text-[10px] text-white/50 uppercase">{t('landing.bentoNow')}</span>
        </li>
      ))}
    </ul>
  )
}

function LiveVault() {
  const t = useT(LANDING_LOCALE)
  const { strategies } = useStrategies()
  const totalSaved = strategies?.reduce((sum, s) => sum + s.totalAssets, 0n) ?? null
  const aprs = strategies?.map((s) => s.aprBps).filter((a) => a > 0) ?? []
  const [protocol, setProtocol] = useState<ProtocolStats | null>(null)
  useEffect(() => {
    void fetchProtocolStats().then(setProtocol, () => {})
  }, [])
  const tiles: [MessageKey, string, MessageKey][] = [
    ['landing.liveTvl', totalSaved !== null ? formatMoney(totalSaved, 'ausd', FALLBACK_RATES, LANDING_LOCALE) : '—', 'landing.liveTvlHint'],
    [
      'landing.liveApr',
      aprs.length ? `${formatApr(Math.min(...aprs))}–${formatApr(Math.max(...aprs))}` : '—',
      'landing.liveAprHint',
    ],
    // Indexed totals (Envio) when available, otherwise the network we run on.
    protocol
      ? ['landing.liveSavers', String(protocol.savers), 'landing.liveSaversHint']
      : ['landing.liveNetwork', `Monad · ${CHAIN_ID}`, 'landing.liveNetworkHint'],
  ]
  return (
    <div data-stagger className="mt-[6vh] grid gap-4 md:grid-cols-4">
      {tiles.map(([label, value, hint]) => (
        <article key={label} className="flex aspect-[4/3.4] flex-col rounded-[4px] bg-[#e8eef8] p-5">
          <span className="w-fit rounded-[2px] bg-cobalt/10 px-2 py-1 font-fragment text-[10px] uppercase">{t(label)}</span>
          <p className="mt-auto font-fragment text-[11px] text-ink/60 uppercase">{t(hint)}</p>
          <h3 className="mt-2 text-[clamp(1.4rem,1.8vw,2.2rem)] leading-tight tabular-nums">{value}</h3>
        </article>
      ))}
      <Link to="/app/link" className="group flex aspect-[4/3.4] flex-col rounded-[4px] bg-cobalt p-5 text-white">
        <span className="w-fit rounded-[2px] bg-white/15 px-2 py-1 font-fragment text-[10px] uppercase">
          {t('landing.liveCtaTag')}
        </span>
        <h3 className="mt-auto text-[clamp(1.4rem,1.6vw,2rem)] leading-tight">{t('landing.liveCtaTitle')}</h3>
        <span className="mt-5 grid size-9 place-items-center rounded-[3px] bg-white text-cobalt transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
          <ArrowUpRightIcon className="size-4" />
        </span>
      </Link>
    </div>
  )
}

export function Landing() {
  const t = useT(LANDING_LOCALE)

  return (
    <div className="bg-ink font-grotesk text-white">
      <LandingFX />
      <LandingHeader />

      {/* hero */}
      <section data-tone="dark" className="relative h-svh min-h-[620px] overflow-hidden bg-cobalt">
        <div
          data-parallax="0.45"
          className="absolute top-[7vh] left-1/2 aspect-square w-[min(66vh,40vw)] -translate-x-1/2 max-md:top-[14vh] max-md:w-[78vw]"
        >
          <NetworkCircle className="size-full" />
        </div>
        <div className="absolute inset-x-5 bottom-[9vh] md:inset-x-6">
          <h1 data-split className={`max-w-[44rem] ${H1}`}>
            {t('landing.heroTitle')}
          </h1>
          <div className="mt-7 flex items-end justify-between">
            <ArrowLink to="/app">{t('landing.cta')}</ArrowLink>
            <p className="hidden font-fragment text-xs text-white/80 uppercase md:block">{t('landing.scroll')}</p>
          </div>
        </div>
      </section>

      {/* how it works */}
      <section id="how" data-tone="dark" className="relative scroll-mt-20 overflow-hidden bg-cobalt px-5 pt-[14vh] pb-[18vh] md:px-6">
        <MonoLabel className="text-white/90">{t('landing.howLabel')}</MonoLabel>
        <h2 data-split className={`mt-8 max-w-[52rem] ${H2}`}>
          {t('landing.howTitle')}
        </h2>
        {/* the traces get their own band so they never run through text */}
        <div className="relative -mx-5 mt-[8vh] h-[26vh] md:-mx-6">
          <Traces className="inset-0 h-full text-white" />
        </div>
        <div className="relative mt-[4vh] grid md:grid-cols-12">
          <div className="md:col-span-4 md:col-start-7">
            <h3 data-split className={H3}>
              {t('landing.howSubTitle')}
            </h3>
            <p data-fade className={`mt-5 text-white/90 ${BODY}`}>
              {t('landing.howBody')}
            </p>
            <div data-fade>
              <ArrowLink to="/app/link" className="mt-8">
                {t('landing.howCta')}
              </ArrowLink>
            </div>
          </div>
        </div>

        <div className="relative mt-[26vh] text-center">
          <h2 data-split className={`mx-auto max-w-[48rem] ${H2}`}>
            {t('landing.stackTitle')}
          </h2>
          <p data-fade className={`mx-auto mt-6 max-w-[34rem] text-white/90 ${BODY}`}>
            {t('landing.stackBody')}
          </p>
        </div>
        <div data-stagger className="relative mt-[12vh] grid gap-x-4 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {STACK.map(({ group, items }) => (
            <div key={group}>
              <p className="font-fragment text-[11px] tracking-wider text-white/70 uppercase">{t(group)}</p>
              <ul className="mt-4 grid gap-2">
                {items.map(([name, role, Logo]) => (
                  <li
                    key={name}
                    className="group/row flex items-center gap-3 rounded-[6px] bg-white p-3 text-ink transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-18px_rgb(0_0_0/0.45)]"
                  >
                    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[6px] bg-[#e8eef8] transition-transform duration-300 group-hover/row:scale-105">
                      {typeof Logo === 'string' ? (
                        <img src={Logo} alt="" className="size-6 object-contain" loading="lazy" />
                      ) : (
                        <Logo className="size-5 text-cobalt" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[clamp(1rem,1.1vw,1.2rem)] leading-tight">{name}</p>
                      <p className="mt-1 truncate font-fragment text-[10px] tracking-wider text-ink/55 uppercase">{t(role)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <PixelBand seed={11} />

      {/* features: heading scrolls away, then the card track pans while the section is pinned */}
      <section id="features" data-tone="dark" className="scroll-mt-20 bg-ink">
        <div className="grid gap-10 px-5 pt-[12vh] md:grid-cols-2 md:px-6">
          <h2 data-split className="text-[clamp(3.5rem,7.5vw,9rem)] leading-[0.92] font-normal tracking-[-0.02em]">
            {t('landing.featuresTitle1')}
            <br />
            {t('landing.featuresTitle2')}
          </h2>
          <div className="max-w-[30rem] self-end md:justify-self-end">
            <p data-fade className={`text-white/90 ${BODY}`}>
              {t('landing.featuresBody')}
            </p>
            <div data-fade>
              <ArrowLink to="/app" className="mt-6">
                {t('landing.featuresCta')}
              </ArrowLink>
            </div>
          </div>
        </div>
        <div data-hscroll className="relative h-[300vh] max-md:h-auto">
          <div className="sticky top-0 flex h-svh items-center overflow-hidden max-md:static max-md:h-auto max-md:overflow-x-auto max-md:py-12">
            <div data-track className="flex items-start gap-5 pr-[10vw] pl-[14vw] will-change-transform max-md:pl-5">
              {FEATURES.map((f, i) => (
                <Link
                  key={f.title}
                  to={f.to}
                  data-drift={CARD_DRIFT[i % CARD_DRIFT.length]}
                  className={`group block w-[min(25rem,80vw)] shrink-0 rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-cyan ${CARD_OFFSET[i % CARD_OFFSET.length]}`}
                >
                  {/* gsap drives the link's transform (drift), so the hover lift lives on this inner card */}
                  <div className="flex h-[min(34rem,66vh)] flex-col rounded-[6px] bg-(--card) p-5 shadow-[0_0_0_rgb(0_0_0/0)] transition-[transform,background-color,box-shadow] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] [--card:var(--color-cobalt)] group-hover:-translate-y-2 group-hover:shadow-[0_24px_60px_-20px_rgb(6_71_179/0.7)] group-hover:[--card:#0a54cc] max-md:h-[30rem]">
                  <div className="flex items-center justify-between">
                    <span className="font-fragment text-[11px] tracking-wider text-white/60">
                      0{i + 1} / 0{FEATURES.length}
                    </span>
                    <span className="rounded-[2px] bg-white/15 px-2 py-1 font-fragment text-[10px] tracking-wider uppercase">
                      {t(f.tag)}
                    </span>
                  </div>
                  {/* the drawing sits in its own blueprint panel so it never touches the card edges */}
                  <div className="mt-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[4px] border border-white/10 bg-[linear-gradient(rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.05)_1px,transparent_1px)] bg-[size:20px_20px] transition-colors duration-500 group-hover:border-white/25">
                    <f.Figure play intensity={0.7} label={t(f.title)} className={`h-[86%] max-w-[92%] ${FIGURE_THEME}`} />
                  </div>
                  <h3 className="mt-5 text-[clamp(1.3rem,1.55vw,1.8rem)] leading-tight">{t(f.title)}</h3>
                  <p className="mt-2 text-sm leading-snug text-white/80">{t(f.body)}</p>
                  <span className="mt-5 flex items-center justify-between border-t border-white/15 pt-4 font-fragment text-[11px] tracking-wider uppercase">
                    <span className="transition-transform duration-500 group-hover:translate-x-1">{t('landing.featureOpen')}</span>
                    <span className="grid size-8 place-items-center overflow-hidden rounded-[3px] bg-white text-cobalt">
                      {/* the arrow leaves top-right and a fresh one slides in from bottom-left */}
                      <span className="relative size-4">
                        <ArrowUpRightIcon className="absolute inset-0 size-4 transition-transform duration-500 group-hover:translate-x-5 group-hover:-translate-y-5" />
                        <ArrowUpRightIcon className="absolute inset-0 size-4 -translate-x-5 translate-y-5 transition-transform duration-500 group-hover:translate-0" />
                      </span>
                    </span>
                  </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* system architecture */}
      <section id="architecture" data-tone="dark" className="scroll-mt-20 bg-ink px-5 pt-[8vh] pb-[16vh] md:px-6">
        <MonoLabel className="text-white/90">{t('landing.archLabel')}</MonoLabel>
        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <h2 data-split className={H2}>
            {t('landing.archTitle')}
          </h2>
          <p data-fade className={`max-w-[32rem] self-end text-white/90 md:justify-self-end ${BODY}`}>
            {t('landing.archBody')}
          </p>
        </div>
        <Architecture />
      </section>

      {/* use cases */}
      <section data-tone="dark" className="relative overflow-hidden bg-cobalt px-5 py-[16vh] md:px-6">
        <h2 data-split className={`max-w-[56rem] ${H2}`}>
          {t('landing.usesTitle')}
        </h2>
        <div className="relative -mx-5 mt-[6vh] h-[22vh] md:-mx-6">
          <Traces variant="b" className="inset-0 h-full text-white" />
        </div>
        <div data-stagger className="relative mt-[6vh] grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {USES.map(([title, body], i) => (
            <div key={title} className="group/use relative border-t border-white/40 pt-4">
              <span aria-hidden className="absolute -top-px left-0 h-px w-full origin-left scale-x-0 bg-white transition-transform duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover/use:scale-x-100" />
              <span className="font-fragment text-[11px] tracking-wider text-white/60">0{i + 1}</span>
              <h3 className="mt-8 text-[clamp(1.5rem,1.9vw,2.4rem)] leading-[1.05] tracking-[-0.01em] transition-transform duration-500 group-hover/use:-translate-y-1">
                {t(title)}
              </h3>
              <p className={`mt-4 text-white/85 ${BODY}`}>{t(body)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* live vault, newsroom-style */}
      <section id="live" data-tone="light" className="scroll-mt-20 bg-white px-5 pt-[14vh] pb-[8vh] text-cobalt md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h2 data-split className={H2}>
            {t('landing.liveTitle')}
          </h2>
          <p data-fade className={`max-w-[26rem] text-ink/70 ${BODY}`}>
            {t('landing.liveBody')}
          </p>
        </div>
        <LiveVault />
      </section>

      {/* CTA */}
      <section data-tone="light" className="relative overflow-hidden bg-white px-5 pt-[10vh] pb-[30vh] text-cobalt md:px-6">
        <Traces className="inset-x-0 top-[24vh] h-[40vh] text-cobalt" />
        <div className="relative grid md:grid-cols-2">
          <MonoLabel>{t('landing.ctaLabel')}</MonoLabel>
          <div className="mt-6 md:mt-0">
            <h2 data-split className={H2}>
              {t('landing.ctaTitle')}
            </h2>
            <div data-fade className="mt-8 flex flex-wrap gap-3">
              <ArrowLink to="/app" tone="solid">
                {t('landing.ctaPrimary')}
              </ArrowLink>
              <ArrowLink to="/app/faucet" tone="dark">
                {t('landing.ctaSecondary')}
              </ArrowLink>
            </div>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer data-tone="dark" className="px-5 pt-[12vh] pb-8 md:px-6">
        <div className="grid gap-12 md:grid-cols-4">
          <p className={`max-w-sm md:col-span-2 ${H3}`}>{t('landing.footerTagline')}</p>
          <nav className="grid content-start gap-2 text-sm">
            <p className="mb-1 font-fragment text-[11px] text-white/50 uppercase">{t('landing.footerProduct')}</p>
            <Link to="/app" className="hover:underline">
              {t('nav.dashboard')}
            </Link>
            <Link to="/app/link" className="hover:underline">
              {t('nav.paymentLink')}
            </Link>
            <Link to="/app/pockets" className="hover:underline">
              {t('nav.pockets')}
            </Link>
            <Link to="/app/yield" className="hover:underline">
              {t('nav.yield')}
            </Link>
            <Link to="/app/market" className="hover:underline">
              {t('nav.market')}
            </Link>
            <Link to="/app/faucet" className="hover:underline">
              {t('nav.faucet')}
            </Link>
          </nav>
          <nav className="grid content-start gap-2 text-sm">
            <p className="mb-1 font-fragment text-[11px] text-white/50 uppercase">{t('landing.footerResources')}</p>
            <a href="https://docs.monad.xyz" target="_blank" rel="noreferrer" className="hover:underline">
              Monad Docs
            </a>
            <a href="https://mera.category.xyz" target="_blank" rel="noreferrer" className="hover:underline">
              Mera
            </a>
            <a href="https://www.agora.finance" target="_blank" rel="noreferrer" className="hover:underline">
              AUSD
            </a>
            <a href="https://www.nansen.ai" target="_blank" rel="noreferrer" className="hover:underline">
              Nansen
            </a>
            <a href="https://envio.dev" target="_blank" rel="noreferrer" className="hover:underline">
              Envio
            </a>
            <a href="https://chain.link" target="_blank" rel="noreferrer" className="hover:underline">
              Chainlink
            </a>
            {MIRAI_ADDRESS && (
              <a href={EXPLORER_CONTRACT_URL} target="_blank" rel="noreferrer" className="hover:underline">
                {t('landing.footerContract')}
              </a>
            )}
          </nav>
        </div>
        <div className="mt-[14vh] flex flex-wrap items-end justify-between gap-6 border-t border-white/10 pt-8">
          <span className="inline-flex items-end gap-4">
            <MiraiMark className="h-[clamp(2.5rem,5vw,5rem)]" />
            <span className="font-fragment text-[clamp(2rem,5vw,5rem)] leading-none tracking-[0.2em] uppercase">Mirai</span>
          </span>
          <p className="font-fragment text-[11px] text-white/50 uppercase">{t('landing.footer')}</p>
        </div>
      </footer>
    </div>
  )
}
