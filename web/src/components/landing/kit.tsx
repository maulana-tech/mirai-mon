// Landing design primitives: flat cobalt/ink blocks, mono eyebrows, thin line art.
import { ArrowUpRightIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

export { MiraiMark } from '@/components/brand/logo'

/** Mono eyebrow with a square bullet. */
export function MonoLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-center gap-2 font-fragment text-[11px] tracking-wider uppercase', className)}>
      <span className="size-1.5 bg-current" aria-hidden />
      {children}
    </p>
  )
}

/** Primary CTA: flat block with the arrow in its own square. */
export function ArrowLink({
  tone = 'light',
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & { tone?: 'light' | 'solid' | 'dark' }) {
  const shell = { light: 'bg-white text-cobalt', solid: 'bg-cobalt text-white', dark: 'bg-ink text-white' }[tone]
  const box = { light: 'bg-cobalt text-white', solid: 'bg-white text-cobalt', dark: 'bg-white text-ink' }[tone]
  return (
    <Link
      className={cn(
        'group inline-flex h-11 items-center justify-between gap-8 rounded-[4px] py-1 pr-1 pl-4 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan',
        shell,
        className,
      )}
      {...props}
    >
      {children}
      <span
        className={cn(
          'grid size-9 place-items-center rounded-[3px] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5',
          box,
        )}
      >
        <ArrowUpRightIcon className="size-4" />
      </span>
    </Link>
  )
}

/** Deterministic pixel pattern: chance of `to` grows row by row, rare cyan accents. */
function pixelCells(cols: number, rows: number, seed: number) {
  let x = seed
  const rand = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648
  const out: { c: number; r: number; fill: 'to' | 'cyan' }[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const v = rand()
      if (v < (r + 1) / (rows + 1)) out.push({ c, r, fill: 'to' })
      else if (v > 0.965) out.push({ c, r, fill: 'cyan' })
    }
  return out
}

/** Blocky band between sections: `from` colour on top dissolving into `to`. */
export function PixelBand({
  from = 'var(--color-cobalt)',
  to = 'var(--color-ink)',
  cols = 24,
  rows = 5,
  seed = 7,
}: {
  from?: string
  to?: string
  cols?: number
  rows?: number
  seed?: number
}) {
  return (
    <svg
      data-pixels
      viewBox={`0 0 ${cols} ${rows}`}
      className="block w-full"
      style={{ background: from }}
      aria-hidden
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
    >
      {pixelCells(cols, rows, seed).map(({ c, r, fill }) => (
        <rect
          data-cell
          key={`${r}-${c}`}
          x={c}
          y={r}
          width="1.01"
          height="1.01"
          fill={fill === 'to' ? to : 'var(--color-cyan)'}
        />
      ))}
      <rect x="0" y={rows - 0.01} width={cols} height="0.02" fill={to} />
    </svg>
  )
}

export type LineArtKind = 'passkey' | 'link' | 'split' | 'vault' | 'lock' | 'withdraw' | 'pockets' | 'invest'

/** Thin line drawings for the cobalt feature cards. */
export function LineArt({ kind, className }: { kind: LineArtKind; className?: string }) {
  const g = { fill: 'none', stroke: 'currentColor', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const }
  const bus = (y: number, x1: number, x2: number, n = 3, gap = 4) =>
    Array.from({ length: n }, (_, i) => <path key={`${y}-${i}`} d={`M${x1} ${y + i * gap}H${x2}`} />)
  const art: Record<LineArtKind, ReactNode> = {
    // fingerprint arcs inside a device frame
    passkey: (
      <>
        <rect x={70} y={14} width={60} height={92} rx={8} />
        {[10, 16, 22, 28].map((r) => (
          <path key={r} d={`M${100 - r} 64a${r} ${r} 0 0 1 ${2 * r} 0v8`} />
        ))}
        <path d="M100 64v18" />
        {bus(40, 0, 70)}
        {bus(72, 130, 200)}
      </>
    ),
    // one link fanning in from several payers
    link: (
      <>
        {[18, 46, 74].map((y) => (
          <rect key={y} x={14} y={y} width={22} height={18} />
        ))}
        <path d="M36 27h30a8 8 0 0 1 8 8v16M36 55h38M36 83h30a8 8 0 0 0 8-8V63" />
        <rect x={74} y={44} width={30} height={30} />
        {bus(55, 104, 200)}
      </>
    ),
    // one stream splitting into spend + save
    split: (
      <>
        {bus(52, 0, 70, 4)}
        <path d="M70 52h20a10 10 0 0 0 10-10V30a10 10 0 0 1 10-10h50" />
        <path d="M70 64h20a10 10 0 0 1 10 10v12a10 10 0 0 0 10 10h50" />
        <rect x={160} y={10} width={22} height={20} />
        <rect x={160} y={86} width={22} height={20} />
      </>
    ),
    // nested squares: shares growing inside the vault
    vault: (
      <>
        {[0, 6, 12, 18, 24, 30].map((d) => (
          <rect key={d} x={70 + d} y={14 + d} width={88 - 2 * d} height={88 - 2 * d} />
        ))}
        {bus(54, 0, 70)}
      </>
    ),
    // concentric seal with a lock shackle
    lock: (
      <>
        {[0, 6, 12].map((d) => (
          <circle key={d} cx={100} cy={60} r={40 - d} />
        ))}
        <rect x={88} y={56} width={24} height={18} />
        <path d="M92 56v-6a8 8 0 0 1 16 0v6" />
        {bus(30, 0, 60, 2)}
        {bus(84, 140, 200, 2)}
      </>
    ),
    // one stream fanning out into several pockets of different sizes
    pockets: (
      <>
        {bus(56, 0, 56, 3)}
        <path d="M56 60h12M68 24v72M68 24h20M68 60h20M68 96h20" />
        {[24, 60, 96].map((y, i) => (
          <g key={y}>
            <rect x={88} y={y - 11} width={72} height={22} />
            <path d={`M94 ${y}h${[44, 24, 58][i]}`} strokeWidth={3} />
          </g>
        ))}
        {bus(58, 160, 200, 2)}
      </>
    ),
    // a price line climbing over a basket of coins
    invest: (
      <>
        {[40, 72, 104].map((x) => (
          <circle key={x} cx={x} cy={92} r={12} />
        ))}
        <path d="M14 70l30-14 22 8 30-26 24 10 30-28 30 4" />
        {[44, 66, 96, 120, 150].map((x, i) => (
          <circle key={x} cx={x} cy={[56, 64, 38, 48, 20][i]} r={2.5} />
        ))}
        {bus(94, 140, 200, 2)}
      </>
    ),
    // pocket emptying out to the right
    withdraw: (
      <>
        <rect x={20} y={30} width={60} height={60} />
        {[44, 54, 64, 74].map((y) => (
          <path key={y} d={`M28 ${y}h44`} opacity={0.6} />
        ))}
        {bus(52, 80, 140, 4)}
        <path d="M140 52h20a8 8 0 0 1 8 8v4a8 8 0 0 0 8 8h24" />
      </>
    ),
  }
  return (
    <svg viewBox="0 0 200 120" className={cn('text-white/80', className)} aria-hidden>
      <g {...g}>{art[kind]}</g>
    </svg>
  )
}

/** Thin rounded traces across a section: drawn in on scroll, with a light pulse running along them. */
export function Traces({ className, variant = 'a' }: { className?: string; variant?: 'a' | 'b' }) {
  const d =
    variant === 'a'
      ? ['M0 300H520a24 24 0 0 0 24-24V120a24 24 0 0 1 24-24H1000', 'M0 316H536a24 24 0 0 0 24-24V136a24 24 0 0 1 24-24H1000']
      : ['M1000 40H700a24 24 0 0 0-24 24v180a24 24 0 0 1-24 24H0', 'M1000 56H716a24 24 0 0 0-24 24v180a24 24 0 0 1-24 24H0']
  return (
    <svg
      viewBox="0 0 1000 340"
      preserveAspectRatio="none"
      className={cn('pointer-events-none absolute w-full', className)}
      aria-hidden
    >
      <g data-draw>
        {d.map((p, i) => (
          <path
            key={p}
            d={p}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            opacity={i ? 0.3 : 0.5}
          />
        ))}
      </g>
      {d.map((p, i) => (
        <path
          key={`pulse-${p}`}
          d={p}
          pathLength={1000}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          className="trace-pulse"
          style={{ animationDelay: `${i * -3.2}s` }}
        />
      ))}
    </svg>
  )
}
