import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useStatusBlocksLabels } from '@/components/ui/status-bar-utils/status-i18n'
import type {
  StatusBarData,
  StatusEventType,
  StatusReportImpact,
  StatusType,
} from '@/components/ui/status-bar-utils/status.types'
import { statusColors } from '@/components/ui/status-bar-utils/status.utils'
import { useMediaQuery } from '@/components/ui/status-bar-utils/use-media-query'
import { cn } from '@/lib/utils'

interface StatusBarProps {
  data: StatusBarData[]
  renderCard?: (data: StatusBarData['card'][number], index: number) => React.ReactNode
  renderBar?: (data: StatusBarData['bar'][number], index: number) => React.ReactNode
  renderEvent?: (data: StatusBarData['events'][number], index: number) => React.ReactNode
  /** Optional Radix Portal container for the day hover-card. Defaults to `document.body`. */
  container?: HTMLElement | null
}

interface UseStatusBarProps {
  dataLength: number
  isTouch: boolean
}

type InteractionType = 'pin' | 'hover' | 'focus' | null

/**
 * Headless interaction state for StatusBar: hover (desktop preview), pin (click; click again or Esc
 * closes) and focus (keyboard). Arrow keys move between days (left/right) and between stacked bars
 * (up/down); touch devices skip hover.
 */
function useStatusBar({ dataLength, isTouch }: UseStatusBarProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [interactionType, setInteractionType] = useState<InteractionType>(null)
  const buttonRefs = useRef<(HTMLElement | null)[]>([])
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    }
  }, [])

  // A pinned card closes on any click outside the bar.
  useEffect(() => {
    if (interactionType !== 'pin' || activeIndex === null) return
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActiveIndex(null)
        setInteractionType(null)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [interactionType, activeIndex])

  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
  }, [])

  const interactionTypeRef = useRef<InteractionType>(null)
  useEffect(() => {
    interactionTypeRef.current = interactionType
  }, [interactionType])

  const handleClick = useCallback(
    (index: number) => {
      clearHoverTimeout()
      setActiveIndex((prev) => {
        if (prev === index && interactionTypeRef.current === 'pin') {
          setInteractionType(null)
          return null
        }
        setInteractionType('pin')
        return index
      })
    },
    [clearHoverTimeout],
  )

  const handleHoverStart = useCallback(
    (index: number) => {
      if (isTouch) return
      clearHoverTimeout()
      setActiveIndex(index)
      setInteractionType('hover')
    },
    [isTouch, clearHoverTimeout],
  )

  const handleHoverEnd = useCallback(() => {
    if (interactionType !== 'hover') return
    hoverTimeoutRef.current = setTimeout(() => {
      setActiveIndex(null)
      setInteractionType(null)
    }, 100)
  }, [interactionType])

  const handleFocus = useCallback((index: number) => {
    setActiveIndex(index)
    setInteractionType('focus')
  }, [])

  const handleBlur = useCallback((e: React.FocusEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement
    const isMovingToAnotherBar =
      relatedTarget &&
      relatedTarget.closest('[role="toolbar"]') === containerRef.current &&
      relatedTarget.getAttribute('role') === 'button'
    if (!isMovingToAnotherBar) {
      setActiveIndex(null)
      setInteractionType(null)
    }
  }, [])

  const focusSibling = (direction: 'previousElementSibling' | 'nextElementSibling', index: number) => {
    const sibling = containerRef.current?.closest('[data-slot="status-component"]')?.[direction]
    const buttons = sibling?.querySelector('[role="toolbar"]')?.querySelectorAll('[role="button"]')
    ;(buttons?.[index] as HTMLElement | undefined)?.focus()
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, currentIndex: number) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          setActiveIndex(null)
          setInteractionType(null)
          clearHoverTimeout()
          buttonRefs.current[currentIndex]?.blur()
          break
        case 'ArrowLeft':
          e.preventDefault()
          buttonRefs.current[currentIndex > 0 ? currentIndex - 1 : dataLength - 1]?.focus()
          break
        case 'ArrowRight':
          e.preventDefault()
          buttonRefs.current[currentIndex < dataLength - 1 ? currentIndex + 1 : 0]?.focus()
          break
        case 'ArrowUp':
          e.preventDefault()
          focusSibling('previousElementSibling', currentIndex)
          break
        case 'ArrowDown':
          e.preventDefault()
          focusSibling('nextElementSibling', currentIndex)
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          handleClick(currentIndex)
          break
      }
    },
    [dataLength, clearHoverTimeout, handleClick],
  )

  const setButtonRef = useCallback((index: number, el: HTMLElement | null) => {
    buttonRefs.current[index] = el
  }, [])

  return {
    activeIndex,
    isOpen: activeIndex !== null,
    interactionType,
    containerRef,
    handlers: {
      onClick: handleClick,
      onHoverStart: handleHoverStart,
      onHoverEnd: handleHoverEnd,
      onHoverCardEnter: clearHoverTimeout,
      onHoverCardLeave: () => {
        setActiveIndex(null)
        setInteractionType(null)
      },
      onFocus: handleFocus,
      onBlur: handleBlur,
      onKeyDown: handleKeyDown,
    },
    setButtonRef,
  }
}

/**
 * Interactive day-by-day timeline: one bar per day with colour-coded segments, and a hover / tap /
 * keyboard card with that day's breakdown and events.
 */
export function StatusBar({ data, renderCard, renderBar, renderEvent, container }: StatusBarProps) {
  const labels = useStatusBlocksLabels()
  const isTouch = useMediaQuery('(hover: none)')
  const { activeIndex, interactionType, containerRef, handlers, setButtonRef } = useStatusBar({
    dataLength: data.length,
    isTouch,
  })

  return (
    <div
      ref={containerRef}
      className="flex h-[50px] w-full items-end gap-px"
      data-slot="status-bar"
      role="toolbar"
      aria-label={labels.ariaStatusTracker}
    >
      {data.map((item, index) => {
        const isActive = activeIndex === index
        return (
          <StatusBarItem
            key={item.day}
            ref={(el) => setButtonRef(index, el)}
            index={index}
            item={item}
            isActive={isActive}
            isPinned={isActive && interactionType === 'pin'}
            isTouch={isTouch}
            isLastItem={index === data.length - 1}
            handlers={handlers}
            renderCard={renderCard}
            renderBar={renderBar}
            renderEvent={renderEvent}
            container={container}
          />
        )
      })}
    </div>
  )
}
StatusBar.displayName = 'StatusBar'

interface StatusBarItemProps {
  index: number
  item: StatusBarData
  isActive: boolean
  isPinned: boolean
  isTouch: boolean
  isLastItem: boolean
  handlers: ReturnType<typeof useStatusBar>['handlers']
  renderCard?: StatusBarProps['renderCard']
  renderBar?: StatusBarProps['renderBar']
  renderEvent?: StatusBarProps['renderEvent']
  container?: StatusBarProps['container']
}

const StatusBarItem = forwardRef<HTMLDivElement, StatusBarItemProps>(
  (
    { index, item, isActive, isPinned, isTouch, isLastItem, handlers, renderCard, renderBar, renderEvent, container },
    ref,
  ) => {
    const labels = useStatusBlocksLabels()
    return (
      <HoverCard openDelay={0} closeDelay={0} open={isActive}>
        <HoverCardTrigger asChild>
          <div
            ref={ref}
            className="group relative flex h-full flex-1 cursor-pointer flex-col rounded-lg outline-none hover:opacity-80 focus-visible:opacity-80 focus-visible:ring-[2px] focus-visible:ring-ring/50 aria-pressed:opacity-80"
            onClick={() => handlers.onClick(index)}
            onFocus={() => handlers.onFocus(index)}
            onBlur={handlers.onBlur}
            onMouseEnter={() => handlers.onHoverStart(index)}
            onMouseLeave={handlers.onHoverEnd}
            onKeyDown={(e) => handlers.onKeyDown(e, index)}
            tabIndex={isLastItem && !isActive ? 0 : isActive ? 0 : -1}
            role="button"
            aria-label={labels.ariaDayStatus(index + 1)}
            aria-pressed={isPinned}
            aria-expanded={isActive}
            data-slot="status-bar-item"
          >
            <div className="flex h-full w-full flex-col overflow-hidden rounded-lg">
              {item.bar.map((segment, segmentIndex) =>
                renderBar ? (
                  renderBar(segment, segmentIndex)
                ) : (
                  <div
                    key={`${item.day}-${segment.status}-${segmentIndex}`}
                    className="w-full transition-all"
                    style={{ height: `${segment.height}%`, backgroundColor: statusColors[segment.status] }}
                  />
                ),
              )}
            </div>
          </div>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="center"
          className="w-auto min-w-40 p-0"
          container={container}
          onMouseEnter={handlers.onHoverCardEnter}
          onMouseLeave={handlers.onHoverCardLeave}
          onPointerDownOutside={(e) => {
            if (isTouch) e.preventDefault()
          }}
        >
          <StatusBarCard
            item={item}
            isPinned={isPinned}
            isTouch={isTouch}
            renderCard={renderCard}
            renderEvent={renderEvent}
          />
        </HoverCardContent>
      </HoverCard>
    )
  },
)
StatusBarItem.displayName = 'StatusBarItem'

export interface StatusBarCardProps {
  item: StatusBarData
  isPinned?: boolean
  isTouch?: boolean
  renderCard?: StatusBarProps['renderCard']
  renderEvent?: StatusBarProps['renderEvent']
}

/** Hover-card body: date, the day's breakdown, its events, and the unpin hint when pinned. */
export function StatusBarCard({ item, isPinned = false, isTouch = false, renderCard, renderEvent }: StatusBarCardProps) {
  const labels = useStatusBlocksLabels()
  return (
    <div data-slot="status-bar-card">
      <div className="p-2 text-xs">{labels.formatDateShort(new Date(item.day))}</div>
      {item.card.length > 0 && (
        <>
          <Separator />
          <div className="space-y-1 p-2 text-sm">
            {item.card.map((cardItem, cardIndex) =>
              renderCard ? (
                renderCard(cardItem, cardIndex)
              ) : (
                <StatusBarContent
                  key={`${item.day}-card-${cardIndex}`}
                  status={cardItem.status}
                  value={cardItem.value}
                  label={cardItem.label}
                  impact={cardItem.impact}
                />
              ),
            )}
          </div>
        </>
      )}
      {item.events.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2 p-2">
            {item.events.map((event, eventIndex) =>
              renderEvent ? (
                renderEvent(event, eventIndex)
              ) : (
                <StatusBarEvent
                  key={`${event.id}-${event.type}`}
                  type={event.type}
                  name={event.name}
                  from={event.from}
                  to={event.to}
                  isAggregated={event.isAggregated}
                  status={event.status}
                />
              ),
            )}
          </div>
        </>
      )}
      {isPinned && !isTouch && (
        <>
          <Separator />
          <div className="flex cursor-pointer items-center p-2 text-xs text-muted-foreground">
            <span>{labels.clickAgainToUnpin}</span>
            <kbd className="ml-auto inline-flex h-5 max-h-5 min-w-5 items-center justify-center rounded-sm border border-input bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              Esc
            </kbd>
          </div>
        </>
      )}
    </div>
  )
}
StatusBarCard.displayName = 'StatusBarCard'

export function StatusBarSkeleton({ className, ...props }: React.ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn('h-[50px] w-full rounded-none bg-muted', className)} {...props} />
}
StatusBarSkeleton.displayName = 'StatusBarSkeleton'

/** One breakdown row: colour dot, label (explicit, impact or status name) and value. */
function StatusBarContent({
  status,
  value,
  label,
  impact,
}: {
  status: StatusType
  value: string
  label?: string
  impact?: StatusReportImpact
}) {
  const labels = useStatusBlocksLabels()
  return (
    <div className="flex items-baseline gap-4" data-slot="status-bar-content">
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-2.5 rounded-lg" style={{ backgroundColor: statusColors[status] }} />
        <div className="text-sm">{label ?? (impact ? labels.componentImpact[impact] : labels.requestStatus[status])}</div>
      </div>
      <div className="ml-auto font-mono text-xs tracking-tight text-muted-foreground">{value}</div>
    </div>
  )
}
StatusBarContent.displayName = 'StatusBarContent'

/** An event in the day card: colour dot, name, time range and duration. */
export function StatusBarEvent({
  name,
  from,
  to,
  type,
  isAggregated,
  status: statusProp,
}: {
  name: string
  from?: Date | null
  to?: Date | null
  type: StatusEventType
  isAggregated?: boolean
  /** Overrides the type-derived dot colour. */
  status?: Exclude<StatusType, 'empty'>
}) {
  const labels = useStatusBlocksLabels()
  if (!from) return null
  const status = statusProp ?? (type === 'incident' ? 'error' : type === 'report' ? 'degraded' : 'info')
  const duration = !to ? labels.ongoing : to.getTime() > from.getTime() ? formatDuration(from, to) : null

  return (
    <div className="group relative text-sm" data-slot="status-bar-event">
      {/* the spacer gives the absolutely positioned name a width to truncate against */}
      <div className="h-4 w-full" />
      <div className="absolute inset-0 text-muted-foreground hover:text-foreground">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 shrink-0 rounded-lg" style={{ backgroundColor: statusColors[status] }} />
          <div className="truncate">{name}</div>
        </div>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {labels.formatDateRange(from, to ?? undefined)}
        {duration && (
          <span className="ml-1.5 font-mono text-muted-foreground/70">
            {isAggregated ? labels.durationAcross(duration) : duration}
          </span>
        )}
      </div>
    </div>
  )
}
StatusBarEvent.displayName = 'StatusBarEvent'

/** "2 hours" style duration via Intl, instead of pulling in date-fns for one helper. */
function formatDuration(from: Date, to: Date): string {
  const s = (to.getTime() - from.getTime()) / 1000
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    s < 3600 ? [Math.round(s / 60), 'minute'] : s < 86400 ? [Math.round(s / 3600), 'hour'] : [Math.round(s / 86400), 'day']
  return new Intl.NumberFormat(undefined, { style: 'unit', unit, unitDisplay: 'long' }).format(value)
}

export default StatusBar
