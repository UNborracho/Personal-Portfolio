import { useEffect, useState } from "react"
import gsap from "gsap"
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin"

// Shared UI primitives, split verbatim out of App.tsx: capability probes,
// RP hover scramble, type/style tokens, the isolated clock, the shared
// view-transition fade and the meta label/value row.

gsap.registerPlugin(ScrambleTextPlugin)

// ── Static capability probes (module scope — never re-probed per render) ──
export const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
export const FINE_POINTER =
  typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches

// ── RP hover scramble (decompiled layout.js): ScrambleText, duration
// 1.2, chars "upperCase", speed 0.1 — letters roll through uppercase
// noise and re-lock into the original text. Reduced motion: skip.
const scrambleOK = !REDUCED_MOTION

export function scrambleIn(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget
  if (!scrambleOK) return
  const original = el.dataset.orig ?? el.textContent ?? ""
  el.dataset.orig = original
  gsap.to(el, {
    duration: 1.2,
    ease: "none",
    overwrite: true,
    scrambleText: { text: original, chars: "upperCase", speed: 0.1 },
  })
}

export type View = "main" | "project"

export const NOISE = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/></filter><rect width='200' height='200' filter='url(%23n)'/></svg>")`

export const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontWeight: 500,
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
}
export const DISPLAY: React.CSSProperties = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 700,
}

export function useClock() {
  const [time, setTime] = useState("")
  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    setTime(fmt())
    const id = setInterval(() => setTime(fmt()), 1000)
    return () => clearInterval(id)
  }, [])
  return time
}

/** Isolated clock — the 1 Hz tick re-renders only this text node
 *  instead of the whole App tree (INFO overlay is its only consumer). */
export function LocalTime() {
  const time = useClock()
  return <>{time}</>
}

// ── View-transition choreography (reference-measured rhythm) ──────────
// NOTE: the Transition wrapper (el) must NEVER get a transform — a
// transformed ancestor becomes the containing block for fixed descendants.
// Motion lives on children only; the exit drift runs on the .list-stage.

export const fadeExit =
  (duration: number) => (el: HTMLElement, done: () => void): void => {
    gsap.killTweensOf(el)
    gsap.to(el, {
      opacity: 0,
      duration,
      ease: "power2.inOut",
      onComplete: done,
    })
  }

/** MONO 9px label/value row — the shared meta-line grammar of the hover
 *  card rows and the project-view info column (callers tune gap/dim/
 *  minWidth; hover rows carry data-hp for the cascade effect). */
export function MetaRow({
  rows,
  fg,
  gap = 10,
  dim = 0.36,
  minWidth = 48,
  rowStyle,
  rowAttr,
}: {
  rows: [string, string][]
  fg: string
  gap?: number
  dim?: number
  minWidth?: number
  rowStyle?: React.CSSProperties
  rowAttr?: Record<string, string>
}) {
  return (
    <>
      {rows.map(([k, v]) => (
        <div key={k} {...rowAttr} style={{ display: "flex", gap, ...rowStyle }}>
          <span
            style={{
              ...MONO,
              fontSize: 9,
              color: fg,
              opacity: dim,
              minWidth,
            }}
          >
            {k}
          </span>
          <span style={{ ...MONO, fontSize: 9, color: fg }}>{v}</span>
        </div>
      ))}
    </>
  )
}
