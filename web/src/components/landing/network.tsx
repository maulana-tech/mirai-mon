import { useEffect, useRef } from 'react'

/**
 * Hero visual: a ring of nodes (payments arriving from anywhere) all wired to one moving focus
 * (your savings). Canvas 2D, follows the pointer, pauses off-screen, static frame under reduced motion.
 */
export function NetworkCircle({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const N = 150
    // fixed per-node curve bend, so the drawing is stable frame to frame
    const bend = Array.from({ length: N }, (_, i) => Math.sin(i * 12.9898) * 0.5)
    let w = 0
    let h = 0
    let raf = 0
    let visible = true
    const target = { x: 0, y: 0, active: false }
    const focus = { x: 0, y: 0 }

    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      focus.x = w / 2
      focus.y = h / 2
    }

    const draw = (t: number) => {
      const cx = w / 2
      const cy = h / 2
      const R = Math.min(w, h) * 0.46
      // focus: pointer when hovering, otherwise a slow drift around the centre
      const tx = target.active ? target.x : cx + Math.cos(t / 2600) * R * 0.28
      const ty = target.active ? target.y : cy + Math.sin(t / 3400) * R * 0.22
      const dx = tx - cx
      const dy = ty - cy
      const d = Math.hypot(dx, dy)
      const k = d > R * 0.85 ? (R * 0.85) / d : 1
      focus.x += (cx + dx * k - focus.x) * 0.06
      focus.y += (cy + dy * k - focus.y) * 0.06

      ctx.clearRect(0, 0, w, h)
      const rot = reduce ? 0 : t / 60000
      ctx.lineWidth = 0.6
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + rot
        const x = cx + Math.cos(a) * R
        const y = cy + Math.sin(a) * R
        const mx = (focus.x + x) / 2 + (y - focus.y) * bend[i]
        const my = (focus.y + y) / 2 - (x - focus.x) * bend[i]
        ctx.strokeStyle = `rgba(255,255,255,${0.12 + 0.18 * Math.abs(bend[i])})`
        ctx.beginPath()
        ctx.moveTo(focus.x, focus.y)
        ctx.quadraticCurveTo(mx, my, x, y)
        ctx.stroke()
        ctx.fillStyle = '#fff'
        ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4)
      }
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(focus.x, focus.y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }

    const loop = (t: number) => {
      if (visible) draw(t)
      raf = requestAnimationFrame(loop)
    }

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      target.x = e.clientX - r.left
      target.y = e.clientY - r.top
      target.active = target.x > 0 && target.y > 0 && target.x < r.width && target.y < r.height
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
    io.observe(canvas)
    if (reduce) draw(0)
    else {
      window.addEventListener('pointermove', onMove, { passive: true })
      raf = requestAnimationFrame(loop)
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      window.removeEventListener('pointermove', onMove)
    }
  }, [])

  return <canvas ref={ref} className={className} aria-hidden />
}
