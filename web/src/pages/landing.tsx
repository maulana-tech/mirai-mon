import { useEffect, useState } from 'react'
import { ArrowUpRightIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LandingFX } from '@/components/landing/fx'
import { LandingHeader } from '@/components/landing/header'
import { ArrowLink, LineArt, MiraiMark, MonoLabel, PixelBand, Traces, type LineArtKind } from '@/components/landing/kit'
import { NetworkCircle } from '@/components/landing/network'
import { fetchProtocolStats, type ProtocolStats } from '@/lib/activity'
import { CHAIN_ID, EXPLORER_CONTRACT_URL, MIRAI_ADDRESS } from '@/lib/config'
import { FALLBACK_RATES } from '@/lib/rates'
import { formatMoney, useT, type MessageKey } from '@/lib/i18n'
import { useSettings } from '@/lib/settings'
import { formatApr } from '@/lib/strategies'
import { useStrategies } from '@/lib/use-strategies'

// Type scale follows the reference at 1920px: h1 ≈ 3.9vw, section titles ≈ 5vw, body ≈ 1vw.
const H1 = 'text-[clamp(2.6rem,3.9vw,5rem)] leading-[1] font-normal tracking-[-0.01em]'
const H2 = 'text-[clamp(3rem,5vw,6.5rem)] leading-[1] font-normal tracking-[-0.015em]'
const H3 = 'text-[clamp(1.75rem,2.4vw,3rem)] leading-[1.05] font-normal tracking-[-0.01em]'
const BODY = 'text-[clamp(1rem,1vw,1.2rem)] leading-[1.3]'

// The building blocks Mirai runs on; grid columns stagger the tiles like the reference.
const STACK: [string, MessageKey, string][] = [
  ['Monad', 'landing.stackMonad', 'md:col-start-3'],
  ['AUSD', 'landing.stackAusd', ''],
  ['Mera', 'landing.stackMera', 'md:col-start-1'],
  ['ERC-4626', 'landing.stackVault', ''],
  ['EIP-2612', 'landing.stackPermit', 'md:col-start-4'],
  ['Envio', 'landing.stackEnvio', ''],
]

const FEATURES: { tag: MessageKey; title: MessageKey; body: MessageKey; art: LineArtKind; to: string }[] = [
  { tag: 'landing.f1Tag', title: 'landing.f1Title', body: 'landing.f1Body', art: 'passkey', to: '/app' },
  { tag: 'landing.f2Tag', title: 'landing.f2Title', body: 'landing.f2Body', art: 'link', to: '/app/link' },
  { tag: 'landing.f3Tag', title: 'landing.f3Title', body: 'landing.f3Body', art: 'split', to: '/app/rules' },
  { tag: 'landing.f4Tag', title: 'landing.f4Title', body: 'landing.f4Body', art: 'vault', to: '/app/yield' },
  { tag: 'landing.f5Tag', title: 'landing.f5Title', body: 'landing.f5Body', art: 'lock', to: '/app/rules' },
  { tag: 'landing.f6Tag', title: 'landing.f6Title', body: 'landing.f6Body', art: 'withdraw', to: '/app/withdraw' },
]

const USES: [MessageKey, MessageKey, string][] = [
  ['landing.use1Title', 'landing.use1Body', 'md:col-start-4 md:col-span-4'],
  ['landing.use2Title', 'landing.use2Body', 'md:col-start-2 md:col-span-4'],
  ['landing.use3Title', 'landing.use3Body', 'md:col-start-6 md:col-span-4'],
  ['landing.use4Title', 'landing.use4Body', 'md:col-start-3 md:col-span-4'],
]

// Staggered card heights on desktop; literal classes so Tailwind generates them.
const CARD_OFFSET = ['md:mt-0', 'md:mt-[12vh]', 'md:mt-[4vh]', 'md:mt-[18vh]', 'md:mt-[8vh]']
const CARD_DRIFT = [0.05, 0.22, 0.12, 0.3, 0.16]

function LiveVault() {
  const t = useT()
  const { locale } = useSettings()
  const { strategies } = useStrategies()
  const totalSaved = strategies?.reduce((sum, s) => sum + s.totalAssets, 0n) ?? null
  const aprs = strategies?.map((s) => s.aprBps).filter((a) => a > 0) ?? []
  const [protocol, setProtocol] = useState<ProtocolStats | null>(null)
  useEffect(() => {
    void fetchProtocolStats().then(setProtocol, () => {})
  }, [])
  const tiles: [MessageKey, string, MessageKey][] = [
    ['landing.liveTvl', totalSaved !== null ? formatMoney(totalSaved, 'ausd', FALLBACK_RATES, locale) : '—', 'landing.liveTvlHint'],
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
  const t = useT()

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
        <Traces className="inset-x-0 top-[44vh] h-[46vh] text-white" />
        <div className="relative mt-[30vh] grid md:grid-cols-12">
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
        <div data-stagger className="relative mt-[12vh] grid grid-cols-2 gap-4 md:grid-cols-6">
          {STACK.map(([name, role, col]) => (
            <div
              key={name}
              className={`flex aspect-[16/10] flex-col items-center justify-center rounded-[4px] bg-white/[0.13] px-3 text-center ${col}`}
            >
              <p className="text-[clamp(1.1rem,1.4vw,1.6rem)]">{name}</p>
              <p className="mt-1 font-fragment text-[10px] tracking-wider text-white/70 uppercase">{t(role)}</p>
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
                  className={`group flex w-[min(26rem,78vw)] shrink-0 flex-col rounded-[4px] bg-cobalt p-5 transition-colors hover:bg-[#0a54cc] ${CARD_OFFSET[i % CARD_OFFSET.length]}`}
                >
                  <div className="flex items-start justify-between">
                    <span className="rounded-[2px] bg-white/15 px-2 py-1 font-fragment text-[10px] tracking-wider uppercase">
                      {t(f.tag)}
                    </span>
                    <span className="grid size-8 place-items-center rounded-[3px] bg-white text-cobalt transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                      <ArrowUpRightIcon className="size-4" />
                    </span>
                  </div>
                  <LineArt kind={f.art} className="my-[5vh] w-full" />
                  <h3 className="text-[clamp(1.25rem,1.5vw,1.75rem)] leading-tight">{t(f.title)}</h3>
                  <p className="mt-2 text-sm text-white/85">{t(f.body)}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* use cases */}
      <section data-tone="dark" className="relative overflow-hidden bg-cobalt px-5 py-[16vh] md:px-6">
        <h2 data-split className={`max-w-[56rem] ${H2}`}>
          {t('landing.usesTitle')}
        </h2>
        <Traces variant="b" className="inset-x-0 top-[34vh] h-[50vh] text-white" />
        <div className="relative mt-[16vh] grid gap-[10vh] md:grid-cols-12">
          {USES.map(([title, body, pos]) => (
            <div key={title} data-fade className={pos}>
              <h3 className={`flex items-start gap-3 ${H3}`}>
                <span className="mt-[0.45em] size-1.5 shrink-0 bg-white" aria-hidden />
                {t(title)}
              </h3>
              <p className={`mt-4 pl-[18px] text-white/90 ${BODY}`}>{t(body)}</p>
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
            <Link to="/app/yield" className="hover:underline">
              {t('nav.yield')}
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
