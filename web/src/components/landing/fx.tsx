import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { useLenis } from 'lenis/react'
import { useEffect } from 'react'

/**
 * Landing motion, driven by data attributes so the page markup stays declarative:
 *  data-split        headline lines slide up out of a mask when they enter
 *  data-fade         block fades/rises in (children of data-stagger animate one after another)
 *  data-pixels       pixel band: squares appear while the band scrolls through
 *  data-draw         svg paths draw themselves in
 *  data-parallax=N   element drifts by N × viewport while its section scrolls
 *  data-hscroll      tall section whose sticky track ([data-track]) pans sideways; cards drift by data-drift
 *  data-tone         section tone under the fixed header ("light" turns the header cobalt)
 * Smooth scrolling comes from the app-wide ReactLenis root; ScrollTrigger just follows it.
 */
export function LandingFX() {
  useLenis(() => ScrollTrigger.update())

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    gsap.registerPlugin(ScrollTrigger, SplitText)

    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-split]').forEach((el) => {
        const split = SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'pb-[0.08em]' })
        gsap.from(split.lines, {
          yPercent: 110,
          duration: 1.1,
          ease: 'expo.out',
          stagger: 0.09,
          scrollTrigger: { trigger: el, start: 'top 88%' },
        })
      })

      gsap.utils.toArray<HTMLElement>('[data-fade]').forEach((el) => {
        gsap.from(el, { y: 40, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 90%' } })
      })

      gsap.utils.toArray<HTMLElement>('[data-stagger]').forEach((el) => {
        gsap.from(el.children, {
          y: 50,
          opacity: 0,
          duration: 0.9,
          ease: 'power3.out',
          stagger: 0.08,
          scrollTrigger: { trigger: el, start: 'top 85%' },
        })
      })

      gsap.utils.toArray<SVGElement>('[data-pixels]').forEach((svg) => {
        const cells = gsap.utils.shuffle(Array.from(svg.querySelectorAll('rect[data-cell]')))
        gsap.from(cells, {
          opacity: 0,
          ease: 'none',
          stagger: { each: 0.02 },
          scrollTrigger: { trigger: svg, start: 'top bottom', end: 'bottom 55%', scrub: true },
        })
      })

      gsap.utils.toArray<SVGPathElement>('[data-draw] path').forEach((p) => {
        // The traces use non-scaling-stroke on a stretched viewBox, so dashes are measured in screen
        // pixels while getTotalLength() is in viewBox units. Scale it up, or the dash ends before the
        // line does and the trace looks cut into pieces.
        const screenLen = () => {
          const svg = p.ownerSVGElement!
          const vb = svg.viewBox.baseVal
          return p.getTotalLength() * Math.max(svg.clientWidth / vb.width, svg.clientHeight / vb.height)
        }
        gsap.fromTo(
          p,
          { strokeDasharray: screenLen, strokeDashoffset: screenLen },
          {
            strokeDashoffset: 0,
            ease: 'none',
            immediateRender: true,
            scrollTrigger: {
              trigger: p.closest('section') ?? p,
              start: 'top 75%',
              end: 'center 40%',
              scrub: 1,
              invalidateOnRefresh: true,
            },
          },
        )
      })

      gsap.utils.toArray<HTMLElement>('[data-parallax]').forEach((el) => {
        const k = Number(el.dataset.parallax)
        gsap.to(el, {
          y: () => -k * innerHeight,
          ease: 'none',
          scrollTrigger: { trigger: el.closest('section') ?? el, start: 'top top', end: 'bottom top', scrub: true },
        })
      })

      gsap.utils.toArray<HTMLElement>('[data-hscroll]').forEach((section) => {
        // mobile lays the track out as a native horizontal scroller instead
        if (!matchMedia('(min-width: 768px)').matches) return
        const track = section.querySelector<HTMLElement>('[data-track]')!
        const st = { trigger: section, start: 'top top', end: 'bottom bottom', scrub: 0.6 }
        gsap.to(track, { x: () => -(track.scrollWidth - innerWidth), ease: 'none', scrollTrigger: st })
        track.querySelectorAll<HTMLElement>('[data-drift]').forEach((card) => {
          gsap.to(card, { y: () => -Number(card.dataset.drift) * innerHeight, ease: 'none', scrollTrigger: st })
        })
      })

      // header tone: whatever section sits under the header decides its colours
      const header = document.querySelector<HTMLElement>('[data-site-header]')
      gsap.utils.toArray<HTMLElement>('[data-tone]').forEach((section) => {
        ScrollTrigger.create({
          trigger: section,
          start: 'top 40px',
          end: 'bottom 40px',
          onToggle: (self) => {
            if (self.isActive && header) header.dataset.tone = section.dataset.tone
          },
        })
      })
    })

    // fonts change line breaks; re-measure once they are in
    void document.fonts.ready.then(() => ScrollTrigger.refresh())
    return () => ctx.revert()
  }, [])

  return null
}
