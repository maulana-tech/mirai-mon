import { cn } from '@/lib/utils'

/** Mirai mark (cup over dome, split down the middle) drawn in currentColor so it can recolor. */
export function MiraiMark({ className = 'h-5' }: { className?: string }) {
  return (
    <svg viewBox="300 215 1332 1501" className={className} aria-hidden>
      <defs>
        <clipPath id="mirai-left">
          <rect x="300" y="215" width="646" height="1501" />
        </clipPath>
        <clipPath id="mirai-right">
          <rect x="986" y="215" width="646" height="1501" />
        </clipPath>
      </defs>
      {['mirai-left', 'mirai-right'].map((id) => (
        <g key={id} clipPath={`url(#${id})`} fill="currentColor">
          <path d="M300 215H1632C1632 500 1334 730 966 730C598 730 300 500 300 215Z" />
          <path d="M300 1716V1260C300 968 598 730 966 730C1334 730 1632 968 1632 1260V1716Z" />
        </g>
      ))}
    </svg>
  )
}

/** App logo: the Mirai mark in the primary (cobalt) colour. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center text-primary', className)} style={{ width: size, height: size }}>
      <MiraiMark className="h-[85%]" />
    </span>
  )
}

export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark size={22} />
      <span className="text-lg font-semibold tracking-tight">Mirai</span>
    </span>
  )
}
