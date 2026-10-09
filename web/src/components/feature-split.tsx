import type { ReactNode } from 'react'
import { LineArt, MonoLabel, Traces, type LineArtKind } from '@/components/landing/kit'

type FeaturePanelProps = {
  art: LineArtKind
  label: string
  title: string
  body: string
}

/** Two-column action layout: a glass panel (on the cobalt app backdrop) explaining the action, the action card beside it. */
export function FeatureSplit({ panel, children }: { panel: FeaturePanelProps; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="relative isolate flex min-h-56 flex-col justify-between overflow-hidden rounded-2xl bg-white/10 p-6 text-white backdrop-blur-xl ring-1 ring-white/20 ring-inset lg:min-h-[440px] dark:bg-cobalt dark:ring-0">
        <Traces className="inset-x-0 top-[6%] -z-10 h-[34%] text-white" />
        <LineArt kind={panel.art} className="mx-auto w-full max-w-[18rem] text-white/80" />
        <div>
          <MonoLabel className="text-white/70">{panel.label}</MonoLabel>
          <p className="mt-3 text-2xl leading-tight font-normal tracking-tight">{panel.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-white/80">{panel.body}</p>
        </div>
      </div>
      <div className="rounded-2xl border bg-card p-5 sm:p-6">{children}</div>
    </div>
  )
}
