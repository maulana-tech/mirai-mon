import { cn } from '@/lib/utils'

/**
 * Mirai mark (the cloud mascot). Colours are baked into the PNG, so it is sized by
 * height only — `className` carries the size (default `h-5`). Decorative: callers
 * always put it next to the "Mirai" wordmark, hence `alt=""`.
 */
export function MiraiMark({ className = 'h-5' }: { className?: string }) {
  return <img src="/mirai-mark.png" alt="" aria-hidden className={cn('w-auto shrink-0', className)} />
}

/** App logo: the Mirai mark on a fixed-size box. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }}>
      <MiraiMark className="h-auto w-[85%] object-contain" />
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
