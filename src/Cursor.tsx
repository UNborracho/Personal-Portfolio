import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'

// Global blurred-dot custom cursor.
//  - only on fine pointers (mouse); touch keeps the native cursor
//  - white dot + mix-blend-mode: difference → always visible over any bg/photo
//  - follow via gsap.quickTo (power2.out) for a soft trailing feel
//  - morphs to a ring over interactive elements (a/button/canvas/[data-cursor])
export default function Cursor() {
  const dotRef = useRef<HTMLDivElement>(null)
  const [enabled, setEnabled] = useState(false)

  // detect fine pointer once
  useEffect(() => {
    setEnabled(typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const dot = dotRef.current
    if (!dot) return

    // hide the native cursor everywhere
    document.documentElement.classList.add('cursor-none')

    const xTo = gsap.quickTo(dot, 'x', { duration: 0.5, ease: 'power2.out' })
    const yTo = gsap.quickTo(dot, 'y', { duration: 0.5, ease: 'power2.out' })

    let first = true
    let hovering = false
    const onMove = (e: PointerEvent) => {
      if (first) {
        gsap.set(dot, { x: e.clientX, y: e.clientY, opacity: 1 })
        first = false
      }
      xTo(e.clientX)
      yTo(e.clientY)
      const el = e.target as HTMLElement | null
      const interactive = !!el?.closest('a, button, canvas, [data-cursor]')
      if (interactive !== hovering) {
        hovering = interactive
        dot.classList.toggle('cursor-hover', interactive)
      }
    }
    const onLeave = () => gsap.to(dot, { opacity: 0, duration: 0.25, ease: 'power2.inOut' })
    const onEnter = () => gsap.to(dot, { opacity: 1, duration: 0.25, ease: 'power2.inOut' })

    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    document.addEventListener('pointerenter', onEnter)

    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('pointerenter', onEnter)
      document.documentElement.classList.remove('cursor-none')
    }
  }, [enabled])

  if (!enabled) return null
  return <div ref={dotRef} className="cursor-dot" aria-hidden />
}
