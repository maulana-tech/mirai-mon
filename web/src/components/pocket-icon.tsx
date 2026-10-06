import {
  CarIcon,
  GamepadIcon,
  GemIcon,
  GiftIcon,
  GraduationCapIcon,
  HeartPulseIcon,
  HouseIcon,
  LaptopIcon,
  PiggyBankIcon,
  PlaneIcon,
  SproutIcon,
  TrendingUpIcon,
  UtensilsIcon,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/** Icons a pocket can wear; the key is what goes (encrypted) on-chain. */
export const POCKET_ICONS: Record<string, LucideIcon> = {
  piggy: PiggyBankIcon,
  laptop: LaptopIcon,
  gamepad: GamepadIcon,
  food: UtensilsIcon,
  car: CarIcon,
  home: HouseIcon,
  travel: PlaneIcon,
  study: GraduationCapIcon,
  wedding: GemIcon,
  health: HeartPulseIcon,
  gift: GiftIcon,
  sprout: SproutIcon,
  invest: TrendingUpIcon,
}

export function PocketIcon({ icon, size = 'md', className }: { icon: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const Icon = POCKET_ICONS[icon] ?? PiggyBankIcon
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary-ink',
        size === 'sm' ? 'size-9' : size === 'md' ? 'size-11' : 'size-14 rounded-2xl',
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'size-4' : size === 'md' ? 'size-5' : 'size-7'} />
    </span>
  )
}
