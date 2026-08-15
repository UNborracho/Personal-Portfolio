import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import gsap from "gsap"

// Delays unmounting children until their exit animation finishes:
//   show=true  → mount (if needed) + enter(el) before paint
//   show=false → exit(el, done) → unmount when done() fires
//
// A generation counter guards rapid toggling: a superseded exit cycle can
// never unmount a newer mount (the exit tween gets killed by the next
// enter; its onComplete simply never fires). exit() must eventually call
// done() — pass it to gsap as onComplete.
//
// enter/exit are stored in a ref, so re-rendering the parent with fresh
// closures does NOT re-trigger them; they run only on show transitions.

interface Props {
  show: boolean
  enter: (el: HTMLElement) => void
  exit: (el: HTMLElement, done: () => void) => void
  children: ReactNode
}

export default function Transition({ show, enter, exit, children }: Props) {
  const [mounted, setMounted] = useState(show)
  const ref = useRef<HTMLDivElement>(null)
  const genRef = useRef(0)
  const cbRef = useRef({ enter, exit })
  cbRef.current = { enter, exit }

  useEffect(() => {
    if (show) {
      // supersede any in-flight exit cycle
      ++genRef.current
      setMounted(true)
      return
    }
    const gen = ++genRef.current
    const el = ref.current
    if (!el) {
      setMounted(false)
      return
    }
    let finished = false
    el.style.pointerEvents = "none" // exiting layer must not catch clicks
    gsap.killTweensOf(el)
    cbRef.current.exit(el, () => {
      finished = true
      if (genRef.current === gen) setMounted(false)
    })
    // if this effect is cleaned up (show flipped back) before the exit
    // finished, and no newer cycle started, unmount right away
    return () => {
      if (!finished && genRef.current === gen) setMounted(false)
    }
  }, [show])

  // play enter right after (re)mount, before first paint
  useLayoutEffect(() => {
    if (!mounted || !show) return
    const el = ref.current
    if (!el) return
    el.style.pointerEvents = ""
    // insurance: this wrapper must stay transform-free — a transformed
    // ancestor becomes the containing block for fixed descendants (the
    // collapsed-list bug). Scrub any leftover transform from an older
    // animation cycle, then run the enter.
    gsap.killTweensOf(el)
    gsap.set(el, { clearProps: "transform" })
    cbRef.current.enter(el)
  }, [mounted, show])

  if (!mounted) return null
  return <div ref={ref}>{children}</div>
}
