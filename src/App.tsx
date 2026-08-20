import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useCallback,
} from "react"
import Lenis from "lenis"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import WebGLGallery, {
  WALL_SEED,
  INTRO_EXPLODE,
  bootFlags,
  type GalleryHandle,
} from "./WebGLGallery"
import Cursor from "./Cursor"
import Transition from "./Transition"
import { useRoute, nav, navReplace, type Mode } from "./router"
import {
  SERIES,
  CATEGORIES,
  AVATAR,
  WALL,
  wallForCat,
  seriesBySlug,
  seriesNumber,
  shuffled,
  type WallPhoto,
  type Series,
  type CatFilter,
} from "./shared"

gsap.registerPlugin(ScrollTrigger)

type View = "main" | "project"

const NOISE = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/></filter><rect width='200' height='200' filter='url(%23n)'/></svg>")`

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontWeight: 500,
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
}
const DISPLAY: React.CSSProperties = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 700,
}

function useClock() {
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

// WebGL + reduced-motion capability check (decides gallery vs DOM fallback)
function useWebGLOk() {
  return useMemo(() => {
    try {
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches
      if (reduce) return false
      const c = document.createElement("canvas")
      return !!(
        window.WebGLRenderingContext &&
        (c.getContext("webgl") || c.getContext("experimental-webgl"))
      )
    } catch {
      return false
    }
  }, [])
}

// ── Rolling-digit Odometer ───────────────────────────────────────────────
const STRIP = "01234567890"
interface OdometerHandle {
  to: (v: number) => void
  raw: (v: number) => void
}
const Odometer = forwardRef<OdometerHandle, {
  digits: number
  digitStyle: React.CSSProperties
}>(function Odometer({ digits, digitStyle }, ref) {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const [cellH, setCellH] = useState(0)
  const cellHRef = useRef(0)
  const curRef = useRef(0)

  const position = (v: number) => {
    const wrap = wrapRef.current
    const ch = cellHRef.current
    if (!wrap || !ch) return
    const cols = wrap.children
    for (let pos = 0; pos < digits; pos++) {
      const col = cols[digits - 1 - pos] as HTMLElement | undefined
      const inner = col?.firstChild as HTMLElement | null
      if (!inner) continue
      const frac =
        pos === 0
          ? ((v % 10) + 10) % 10
          : ((Math.floor(v / Math.pow(10, pos)) % 10) + 10) % 10
      inner.style.transform = `translateY(${-frac * ch}px)`
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      raw(v: number) {
        curRef.current = v
        position(v)
      },
      to(v: number) {
        if (!cellHRef.current) {
          curRef.current = v
          return
        }
        const obj = { val: curRef.current }
        gsap.to(obj, {
          val: v,
          duration: 0.8,
          ease: "power2.inOut",
          onUpdate: () => {
            curRef.current = obj.val
            position(obj.val)
          },
        })
      },
    }),
    [digits],
  )

  useLayoutEffect(() => {
    const measure = () => {
      const cell = wrapRef.current?.querySelector(
        ".od-cell",
      ) as HTMLElement | null
      if (!cell) return
      const h = cell.offsetHeight
      if (h && h !== cellHRef.current) {
        cellHRef.current = h
        setCellH(h)
        position(curRef.current)
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrapRef.current) ro.observe(wrapRef.current)
    window.addEventListener("resize", measure)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [])

  return (
    <span
      ref={wrapRef}
      style={{
        display: "inline-flex",
        lineHeight: 1,
        verticalAlign: "baseline",
      }}
    >
      {Array.from({ length: digits }).map((_, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            overflow: "hidden",
            height: cellH || undefined,
            verticalAlign: "top",
          }}
        >
          <span style={{ display: "block", willChange: "transform" }}>
            {STRIP.split("").map((d, j) => (
              <span
                key={j}
                className="od-cell"
                style={{ display: "block", lineHeight: 1, ...digitStyle }}
              >
                {d}
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  )
})

// ── Masked split-text chars (intro) ──────────────────────────────────────
function Chars({
  text,
  charStyle,
}: {
  text: string
  charStyle?: React.CSSProperties
}) {
  return (
    <span
      style={{
        display: "inline-block",
        overflow: "hidden",
        verticalAlign: "top",
      }}
    >
      {text.split("").map((ch, i) => (
        <span
          key={i}
          className="intro-char"
          style={{
            display: "inline-block",
            // NOTE no willChange — ~50 intro chars each pinned a Safari
            // compositing layer through the whole load, then the layer
            // tree collapsed AT the explode (mid-animation stall). RP's
            // SplitText chars carry no willChange either.
            ...charStyle,
          }}
        >
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </span>
  )
}

// ── RP intro photo chip: the WALL'S HERO (lap-0 first photo) ──────────
// Same photo as the stack top the WebGL handoff reveals — the chip
// vanishes at the beat's end exactly where the hero plane already sits
// (150px, same spot): a seamless swap. (RP's chip is a separate portrait
// that visibly changes photo at handoff — ours swaps identities for free
// by being the SAME image; user-confirmed intent.)
const HERO_CHIP = shuffled(WALL, WALL_SEED)[0].photo.thumb

// ── RP intro odometer: 3 mechanical digit columns ──────────────────────
// Exact percentage readout 000→100 with monotonic (never-backward) strips:
//   hundreds "01"                  — flips 0→1 when progress crosses 100
//   tens     "0…9" + "0"           — 11 entries, settles on the wrap 0
//   ones     "0…9" ×10 + "0"       — 101 entries, ten decades, wraps home
// NOTE: the literal RP 20-digit double-decade strip swept by index(P)
// cannot hit the recorded real milestones (017→050→100) — decade tiling
// keeps the same mechanical wrap aesthetic with an exact readout.
// Smoothness comes from the caller's single power2.inOut value tween;
// raw() just positions the wheels (data-v mirrors the value for tests).
const ODOM_HUNDREDS = "01"
const ODOM_TENS = "01234567890"
const ODOM_ONES = "0123456789".repeat(10) + "0"

interface IntroOdometerHandle {
  raw: (v: number) => void
}

const IntroOdometer = forwardRef<
  IntroOdometerHandle,
  { digitStyle: React.CSSProperties }
>(function IntroOdometer({ digitStyle }, ref) {
  const rootRef = useRef<HTMLDivElement>(null)
  const hRef = useRef<HTMLSpanElement>(null)
  const tRef = useRef<HTMLSpanElement>(null)
  const oRef = useRef<HTMLSpanElement>(null)
  const [cellH, setCellH] = useState(0)
  const cellHRef = useRef(0)
  const curRef = useRef(0)

  const position = (v: number) => {
    const ch = cellHRef.current
    if (!ch) return // not measured yet (or column hidden — mobile uses text)
    const hi = v >= 100 ? 1 : 0
    const ti = v >= 100 ? 10 : Math.floor(v / 10)
    const oi = Math.min(100, Math.floor(v))
    if (hRef.current)
      hRef.current.style.transform = `translateY(${-hi * ch}px)`
    if (tRef.current)
      tRef.current.style.transform = `translateY(${-ti * ch}px)`
    if (oRef.current)
      oRef.current.style.transform = `translateY(${-oi * ch}px)`
    if (rootRef.current)
      rootRef.current.dataset.v = String(
        Math.round(Math.min(100, Math.max(0, v))),
      )
  }

  useImperativeHandle(
    ref,
    () => ({
      raw(v) {
        curRef.current = v
        position(v)
      },
    }),
    [],
  )

  useLayoutEffect(() => {
    const measure = () => {
      const cell = rootRef.current?.querySelector(
        ".iod-cell",
      ) as HTMLElement | null
      if (!cell) return
      const h = cell.offsetHeight
      if (h && h !== cellHRef.current) {
        cellHRef.current = h
        setCellH(h)
        position(curRef.current)
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (rootRef.current) ro.observe(rootRef.current)
    return () => ro.disconnect()
  }, [])

  // RP gradMask — CSS-only soft edges on the traveling columns
  const column = (
    list: string,
    stripRef: React.RefObject<HTMLSpanElement | null>,
    mask: boolean,
  ) => (
    <span
      style={{
        display: "inline-block",
        overflow: "hidden",
        height: cellH || undefined,
        verticalAlign: "top",
        ...(mask
          ? {
              maskImage:
                "linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)",
            }
          : {}),
      }}
    >
      <span
        ref={stripRef}
        style={{ display: "block", willChange: "transform" }}
      >
        {list.split("").map((d, j) => (
          <span
            key={j}
            className="iod-cell"
            style={{ display: "block", lineHeight: 1, ...digitStyle }}
          >
            {d}
          </span>
        ))}
      </span>
    </span>
  )

  return (
    <div
      ref={rootRef}
      data-v="0"
      style={{
        display: "inline-flex",
        lineHeight: 1,
        verticalAlign: "baseline",
      }}
    >
      {column(ODOM_HUNDREDS, hRef, false)}
      {column(ODOM_TENS, tRef, true)}
      {column(ODOM_ONES, oRef, true)}
    </div>
  )
})

// ── View-transition choreography (reference-measured rhythm) ──────────
// NOTE: the Transition wrapper (el) must NEVER get a transform — a
// transformed ancestor becomes the containing block for fixed descendants.
// Motion lives on children only; the exit drift runs on the .list-stage.

const fadeExit =
  (duration: number) => (el: HTMLElement, done: () => void): void => {
    gsap.killTweensOf(el)
    gsap.to(el, {
      opacity: 0,
      duration,
      ease: "power2.inOut",
      onComplete: done,
    })
  }

// DOM masonry fallback: cards stagger in shortly after the beat
const masonryEnter = (el: HTMLElement) => {
  const cards = el.querySelectorAll(".masonry-card")
  gsap.killTweensOf([el, ...cards])
  gsap.set(el, { opacity: 1 })
  gsap.fromTo(cards, { opacity: 0, y: 20 }, {
    opacity: 1,
    y: 0,
    duration: 0.5,
    ease: "power2.inOut",
    stagger: 0.03,
    delay: 0.15,
  })
}
const masonryExit = fadeExit(0.25)

const infoEnter = (el: HTMLElement) => {
  const chars = el.querySelectorAll(".info-title .intro-char")
  const blocks = el.querySelectorAll(".info-block")
  const portrait = el.querySelectorAll(".info-portrait")
  const policy = el.querySelectorAll(".info-policy")
  gsap.killTweensOf([el, ...chars, ...blocks, ...portrait, ...policy])
  gsap.set(el, { opacity: 0 })
  gsap.to(el, { opacity: 1, duration: 0.6, ease: "power2.inOut", delay: 0.7 })
  gsap.fromTo(chars, { yPercent: 110, rotate: 4 }, {
    yPercent: 0,
    rotate: 0,
    duration: 0.7,
    ease: "power2.inOut",
    stagger: 0.03,
    delay: 0.85,
  })
  gsap.fromTo(blocks, { opacity: 0, y: 14 }, {
    opacity: 1,
    y: 0,
    duration: 0.5,
    ease: "power2.inOut",
    stagger: 0.045,
    delay: 0.95,
  })
  gsap.fromTo(portrait, { scale: 1.5, opacity: 0 }, {
    scale: 1,
    opacity: 0.82,
    duration: 1,
    ease: "power2.inOut",
    delay: 1,
  })
  gsap.fromTo(policy, { opacity: 0 }, {
    opacity: 1,
    duration: 0.5,
    ease: "power2.inOut",
    delay: 1.2,
  })
}
const infoExit = fadeExit(0.5)

// ── Chrome components ─────────────────────────────────────────────────
// NOTE: these MUST live at module scope (see the remount bug note in git
// history) — useClock ticks would otherwise re-create them every second.

/** Hash of a category's main route (overview or list) — the single
 *  source for the INFO toggle, close buttons and filter picks (was four
 *  inline cat×mode ternary cascades that could drift apart). */
function mainHref(cat: CatFilter, mode: Mode): string {
  const parts: string[] = []
  if (cat !== "all") parts.push(cat)
  if (mode === "list") parts.push("list")
  return `#/${parts.join("/")}`
}

function NavBar({
  headerRef,
  isDark,
  fg,
  mode,
  cat,
  infoOpen,
  projectSeries,
  onClose,
  onToggleTheme,
}: {
  headerRef?: React.RefObject<HTMLElement | null>
  isDark: boolean
  fg: string
  mode: Mode
  cat: CatFilter
  infoOpen: boolean
  projectSeries?: Series | null
  onClose?: () => void
  onToggleTheme: () => void
}) {
  // blur only on fine pointers: on phones the compositor re-blurs the nav
  // every frame over the animating canvas — one of the biggest mobile costs.
  // Coarse pointers get a flat near-opaque bar (same look at rest).
  const blurNav =
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: fine)").matches
  return (
    <header
      ref={headerRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        height: 60,
        gap: 20,
        background: blurNav
          ? "color-mix(in srgb, var(--bg) 88%, transparent)"
          : "var(--bg)",
        backdropFilter: blurNav ? "blur(14px)" : undefined,
        WebkitBackdropFilter: blurNav ? "blur(14px)" : undefined,
        borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)",
      }}
    >
      <button
        onClick={() => nav("#/")}
        style={{
          ...DISPLAY,
          fontSize: 13,
          color: fg,
          background: "none",
          border: "none",
          cursor: "pointer",
          whiteSpace: "nowrap",
          letterSpacing: "0.04em",
        }}
      >
        SPIKE HU
      </button>
      {!onClose && (
        <span
          className="nav-center"
          style={{
            ...MONO,
            fontSize: 10,
            color: fg,
            opacity: 0.42,
            textAlign: "center",
            flex: 1,
          }}
        >
          PHOTOGRAPHER AVAILABLE WORLDWIDE&nbsp;|&nbsp;BASED IN SH
        </span>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          whiteSpace: "nowrap",
        }}
      >
        {onClose ? (
          <>
            {projectSeries && (
              <span style={{ ...MONO, fontSize: 10, color: fg, opacity: 0.45 }}>
                {projectSeries.category.toUpperCase()} — {projectSeries.name}
              </span>
            )}
            <button
              onClick={onClose}
              style={{
                ...MONO,
                fontSize: 11,
                color: fg,
                background: "none",
                border: "1px solid var(--fg)",
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              [CLOSE]
            </button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center" }}>
              {(["overview", "list"] as Mode[]).map((m) => (
                <span key={m} style={{ display: "flex", alignItems: "center" }}>
                  <button
                    onClick={() =>
                      nav(
                        m === "overview"
                          ? cat === "all"
                            ? "#/"
                            : `#/${cat}`
                          : cat === "all"
                            ? "#/list"
                            : `#/${cat}/list`,
                      )
                    }
                    style={{
                      ...MONO,
                      fontSize: 11,
                      color: fg,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      opacity: mode === m && !infoOpen ? 1 : 0.32,
                      padding: "0 2px",
                    }}
                  >
                    {m.toUpperCase()}
                  </button>
                  <span
                    style={{
                      ...MONO,
                      fontSize: 11,
                      color: fg,
                      opacity: 0.22,
                      padding: "0 5px",
                    }}
                  >
                    /
                  </span>
                </span>
              ))}
              <button
                onClick={() => {
                  const base = mainHref(cat, mode)
                  nav(infoOpen ? base : `${base}/info`)
                }}
                style={{
                  ...MONO,
                  fontSize: 11,
                  color: fg,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  opacity: infoOpen ? 1 : 0.32,
                  padding: "0 2px",
                }}
              >
                INFO
              </button>
            </div>
            <a
              className="nav-mail"
              href="mailto:1162844453@qq.com"
              style={{
                ...MONO,
                fontSize: 10,
                color: fg,
                opacity: 0.45,
                textDecoration: "none",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.textDecoration = "underline")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.textDecoration = "none")
              }
            >
              1162844453@QQ.COM
            </a>
            <button
              onClick={onToggleTheme}
              title="Toggle theme"
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                border:
                  "1px solid color-mix(in srgb, var(--fg) 27%, transparent)",
                background: "none",
                cursor: "pointer",
                color: fg,
                fontSize: 9,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {isDark ? "○" : "●"}
            </button>
          </>
        )}
      </div>
    </header>
  )
}

function HoverPanel({
  wp,
  panelRef,
  bg,
  fg,
}: {
  wp: WallPhoto
  panelRef: React.RefObject<HTMLDivElement | null>
  bg: string
  fg: string
}) {
  const { series, index } = wp
  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        bottom: 190,
        left: "clamp(16px, 4vw, 40px)",
        zIndex: 500,
        background: bg,
        border: "1px solid color-mix(in srgb, var(--fg) 9%, transparent)",
        padding: "18px 22px 14px",
        pointerEvents: "none",
        width: "min(292px, calc(100vw - 32px))",
        boxShadow: "0 8px 52px rgba(0,0,0,0.35)",
        opacity: 0,
        willChange: "opacity",
      }}
    >
      <div
        style={{
          ...DISPLAY,
          fontSize: 54,
          lineHeight: 1,
          color: fg,
          marginBottom: 7,
        }}
      >
        {String(seriesNumber(series)).padStart(2, "0")}
      </div>
      <div
        style={{
          ...DISPLAY,
          fontSize: 14,
          color: fg,
          marginBottom: 11,
          letterSpacing: "0.03em",
        }}
      >
        {series.name}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          marginBottom: 14,
        }}
      >
        {([
          ["CATEGORY", series.category.toUpperCase()],
          ["YEAR", String(series.year)],
          ["PHOTOS", String(series.photos.length)],
          ["FRAME", `${index + 1} / ${series.photos.length}`],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} style={{ display: "flex", gap: 10 }}>
            <span
              style={{
                ...MONO,
                fontSize: 9,
                color: fg,
                opacity: 0.36,
                minWidth: 48,
              }}
            >
              {k}
            </span>
            <span style={{ ...MONO, fontSize: 9, color: fg }}>{v}</span>
          </div>
        ))}
      </div>
      <div
        style={{
          ...MONO,
          fontSize: 10,
          color: fg,
          textAlign: "right",
          borderTop: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)",
          paddingTop: 9,
        }}
      >
        [EXPLORE]
      </div>
    </div>
  )
}

// ── Footer filter words ──────────────────────────────────────────────────
function FilterWords({
  cat,
  fg,
  onPick,
}: {
  cat: CatFilter
  fg: string
  onPick: (c: CatFilter) => void
}) {
  const words: { slug: CatFilter; label: string }[] = [
    { slug: "all", label: "all" },
    ...CATEGORIES.map((c) => ({ slug: c.slug as CatFilter, label: c.slug })),
  ]
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "clamp(8px, 1.8vw, 18px)",
        whiteSpace: "nowrap",
      }}
    >
      {words.map((w, i) => (
        <span
          key={w.slug}
          style={{ display: "inline-flex", alignItems: "baseline" }}
        >
          <button
            data-cursor
            onClick={() => onPick(w.slug)}
            style={{
              ...DISPLAY,
              fontSize: "clamp(22px, 4.6vw, 64px)",
              lineHeight: 0.9,
              color: fg,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              opacity: cat === w.slug ? 1 : 0.15,
              transition: "opacity 0.22s ease",
              textDecoration: cat === w.slug ? "underline" : "none",
              textDecorationThickness: 2,
              textUnderlineOffset: 6,
            }}
            onMouseEnter={(e) => {
              if (cat !== w.slug) e.currentTarget.style.opacity = "0.55"
            }}
            onMouseLeave={(e) => {
              if (cat !== w.slug) e.currentTarget.style.opacity = "0.15"
            }}
          >
            {w.label}
            {i < words.length - 1 ? (
              <span style={{ opacity: 0.35, marginLeft: "0.5em" }}>,</span>
            ) : null}
          </button>
        </span>
      ))}
    </div>
  )
}

export default function App() {
  const route = useRoute()
  const [introDone, setIntroDone] = useState(false)
  const [hoveredWP, setHoveredWP] = useState<WallPhoto | null>(null)
  // panel content lingers after hover clears → no mount/unmount blink
  const [panelWP, setPanelWP] = useState<WallPhoto | null>(null)
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    (() => {
      try {
        return localStorage.getItem("theme") as "light" | "dark" || "light"
      } catch {
        return "light"
      }
    })(),
  )
  const [projectIndex, setProjectIndex] = useState(0)

  const lenisRef = useRef<Lenis | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const introRef = useRef<HTMLDivElement>(null)
  const introOdomRef = useRef<IntroOdometerHandle>(null)
  const mobileCounterRef = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLImageElement>(null)
  const projectRef = useRef<HTMLDivElement>(null)
  const footerOdomRef = useRef<OdometerHandle>(null)
  const projectOdomRef = useRef<OdometerHandle>(null)
  const projectIdxRef = useRef(0)
  const routePhotoRef = useRef(route.photo)
  const lastMainModeRef = useRef<Mode>("overview")
  const clock = useClock()
  const webglOk = useWebGLOk()

  // RP info transition: refs to the hard-cut chrome elements (nav, footer;
  // the canvas lives inside WebGLGallery and hides via its infoOpen prop)
  const navRef = useRef<HTMLElement | null>(null)
  const footerRef = useRef<HTMLElement | null>(null)
  const wordsRef = useRef<HTMLDivElement>(null)
  const galleryRef = useRef<GalleryHandle>(null)
  const wasInfoOpenRef = useRef(false)
  const infoLayerRef = useRef<HTMLDivElement | null>(null)

  // ── Route → view state ─────────────────────────────────────────────
  // The hash is the single source of truth from t=0 — the intro is a pure
  // overlay curtain; the view beneath it (wall included) lives from mount,
  // exactly like RP where the WebGL canvas renders behind the loader.
  const projectSeries =
    route.view === "project" ? seriesBySlug(route.series ?? "") : null
  const view: View =
    route.view === "project" && projectSeries ? "project" : "main"
  const mode: Mode = view === "project" ? "overview" : route.mode
  const infoOpen = view === "main" && route.info
  const pool = useMemo(() => wallForCat(route.cat), [route.cat])
  routePhotoRef.current = route.photo

  const isDark = theme === "dark"
  const bg = "var(--bg)"
  const fg = "var(--fg)"

  function toggleTheme() {
    const next: "light" | "dark" = isDark ? "light" : "dark"
    try {
      localStorage.setItem("theme", next)
    } catch {
      /* private mode — theme just won't persist */
    }
    const apply = () => {
      document.documentElement.dataset.theme = next
      setTheme(next)
    }
    if (document.startViewTransition) {
      document.startViewTransition(apply)
    } else {
      apply()
    }
  }

  const projectImages = projectSeries ? projectSeries.photos : []
  const currentProjectPhoto = projectImages[projectIndex]

  // ── Lenis + GSAP/ScrollTrigger wiring (once) ─────────────────────────
  useEffect(() => {
    const lenis = new Lenis()
    lenisRef.current = lenis
    lenis.on("scroll", ScrollTrigger.update)
    const tickerFn = (t: number) => lenis.raf(t * 1000)
    gsap.ticker.add(tickerFn)
    // RP (716.js): lagSmoothing(1000, 16) — frame spikes up to 1s are
    // absorbed (elapsed folds to 16ms), so the explode/morph timelines
    // glide through main-thread spikes instead of JUMPING. (0) passed
    // every spike straight into gsap time — the 爆开卡顿's primary cause.
    gsap.ticker.lagSmoothing(1000, 16)
    return () => {
      gsap.ticker.remove(tickerFn)
      lenis.destroy()
      lenisRef.current = null
    }
  }, [])

  useEffect(() => {
    const lenis = lenisRef.current
    if (!lenis) return
    // overview owns input (RP stack inside WebGLGallery): lock page scroll;
    // the list filmstrip is equally input-driven, and info is a DOM overlay
    // page — all three lock. Only the project view scrolls.
    const lock = infoOpen || view === "main"
    document.documentElement.style.overflow = lock ? "hidden" : ""
    if (lock) lenis.stop()
    else lenis.start()
  }, [infoOpen, view])

  // Reset scroll + odometer whenever the (WebGL) overview is entered.
  // (Hash category changes reset the wall's own virtual position inside
  // WebGLGallery — instantly — and call onResetScroll synchronously; the
  // 1.4s glide tween is the info-exit path only.)
  useEffect(() => {
    if (view === "main" && mode === "overview") {
      lenisRef.current?.scrollTo(0, { immediate: true })
      footerOdomRef.current?.to(1)
    }
  }, [view, mode])

  // remember the last main mode so closing a project returns to it
  useEffect(() => {
    if (view === "main" && (mode === "overview" || mode === "list"))
      lastMainModeRef.current = mode
  }, [view, mode])

  // leaving the overview must drop any lingering hover
  useEffect(() => {
    if (view !== "main" || mode !== "overview") setHoveredWP(null)
  }, [view, mode])

  // ── RP filter-words relocation: list-only footer chrome ────────────
  // Overview is a pure wall (no words). They fade IN at the overview→list
  // transition midpoint (~0.7s in, matching the fly-in) and fade OUT the
  // instant list exits.
  useLayoutEffect(() => {
    const el = wordsRef.current
    if (!el) return
    gsap.killTweensOf(el)
    el.style.pointerEvents = mode === "list" ? "auto" : "none"
    if (mode === "list") {
      gsap.to(el, {
        opacity: 1,
        duration: 0.4,
        ease: "power2.inOut",
        delay: 0.7,
      })
    } else {
      gsap.to(el, { opacity: 0, duration: 0.25, ease: "power2.inOut" })
    }
  }, [mode])

  // ── RP info transition (hard cut in · fade-then-fly out) ───────
  // Enter #/info: canvas (gallery, via its infoOpen prop), nav and footer
  // all go opacity:0 in the same instant — RP gsap.set(..., { opacity: 0,
  // duration: 0 }): a hard cut, not a fade. Layout effect → lands in the
  // route change's first paint. Exit: the [CLOSE] button first fades the
  // info layer itself (RP layout.js @29048: contact 1s power4.out, 0.5s
  // <800px — the route pops in the fade's onComplete), THEN this effect
  // runs restoreFromInfo: the wall re-enters from the return park
  // (+1.2vw → enter-only fly-in, RP home-remount) with canvas/nav/footer
  // popping the instant the flight begins.
  const restoreChrome = useCallback(() => {
    const els = [navRef.current, footerRef.current].filter(
      (el): el is HTMLElement => !!el,
    )
    if (els.length) {
      gsap.killTweensOf(els)
      gsap.set(els, { opacity: 1, pointerEvents: "auto" })
    }
    // back-at-top state, same as onResetScroll (page is locked in
    // overview — instant, zero visual impact; odometer reads 01)
    lenisRef.current?.scrollTo(0, { immediate: true })
    footerOdomRef.current?.to(1)
  }, [])

  useLayoutEffect(() => {
    if (infoOpen) {
      const els = [navRef.current, footerRef.current].filter(
        (el): el is HTMLElement => !!el,
      )
      if (els.length) {
        gsap.killTweensOf(els)
        gsap.set(els, { opacity: 0, pointerEvents: "none" })
      }
    } else if (wasInfoOpenRef.current) {
      if (view === "main") {
        // re-enter the wall from the return park — BOTH modes now (the
        // info layer has already faded itself out on the click path; on
        // a hash-back close the layer's own exit fade runs concurrently)
        if (webglOk && galleryRef.current)
          galleryRef.current.restoreFromInfo(restoreChrome)
        else restoreChrome() // DOM fallback / missing ref — instant
      }
      // leaving to a project route: the main nav/footer unmounted with
      // the view — a fresh pair renders there, nothing to restore
    }
    wasInfoOpenRef.current = infoOpen
  }, [infoOpen])

  // ── Hover panel: stays mounted through its fade-out ─────────────────
  useEffect(() => {
    if (hoveredWP) {
      setPanelWP(hoveredWP)
      return
    }
    const t = window.setTimeout(() => setPanelWP(null), 320)
    return () => window.clearTimeout(t)
  }, [hoveredWP])

  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    gsap.killTweensOf(el)
    gsap.to(el, {
      opacity: hoveredWP ? 1 : 0,
      duration: hoveredWP ? 0.22 : 0.18,
      ease: "power2.inOut",
    })
  }, [hoveredWP, panelWP])

  // ── Intro: RP-style loading curtain ──────────────────────────────
  // Real progress (first-lap thumbs, the exact photos the wall binds
  // first) drives a mechanical odometer. When every byte is in AND the
  // 0.8s legibility wait has elapsed: odometer settles → 0.25s hold →
  // 0.45s curtain fade — off an ALREADY-LIVING wall (the gallery mounts
  // at t=0 behind the opaque layer; this preload list shares the browser
  // cache with its texture loads, zero double-fetching).
  // LAYOUT effect on purpose: the chars' hidden initial state and the
  // odometer's 000 position land before the first paint (zero flash), and
  // gsap fully owns the transforms (no inline % to fight with).
  useLayoutEffect(() => {
    if (introDone) return

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches
    const t0 = performance.now()
    const MIN_WAIT = 800 // RP shows the counter even on instant (cached) loads

    // StrictMode double-run / unmount latch: image onloads keep firing
    // after cleanup — without this, an orphaned milestone() would re-arm
    // tweens+timers and fight the successor instance for the DOM.
    let dead = false

    let finishTimer = 0
    const shown = { v: 0 }
    let chipShown = false

    const setV = (v: number) => {
      if (dead) return
      introOdomRef.current?.raw(v)
      if (mobileCounterRef.current)
        mobileCounterRef.current.textContent = `[${String(
          Math.round(Math.min(100, Math.max(0, v))),
        ).padStart(3, "0")}%]`
    }
    // one mechanical tween to the new milestone: small steps tick at
    // 0.35s; a cached 0→100 jump becomes a single longer sweep
    // (fast-forward smoothly, never skipped frames)
    const tweenTo = (v: number): number => {
      const delta = Math.abs(v - shown.v)
      if (dead || reduced || delta === 0) {
        shown.v = v
        setV(v)
        return 0
      }
      const dur = Math.min(0.35 + Math.max(0, delta - 8) * 0.005, 1.1)
      gsap.killTweensOf(shown)
      gsap.to(shown, {
        v,
        duration: dur,
        ease: "power2.inOut",
        onUpdate: () => setV(shown.v),
      })
      return dur
    }

    // curtain choreography (pre-paint: chars rise from below their line
    // mask — SplitText hand-rolled, GSAP core only)
    const ctx = gsap.context(() => {
      if (reduced) {
        gsap.set(".intro-logo", { opacity: 1 })
        return
      }
      gsap.fromTo(
        ".intro-title .intro-char",
        { yPercent: 100, rotate: 7 },
        {
          yPercent: 0,
          rotate: 0,
          duration: 0.8,
          ease: "power2.out",
          stagger: 0.04,
        },
      )
      // RP introText lines: pure VISIBILITY stagger (.045, delay .5 —
      // no y movement), small uppercase lines above the title (C)
      gsap.fromTo(
        ".intro-sub .intro-char",
        { visibility: "hidden" },
        {
          visibility: "visible",
          stagger: 0.045,
          delay: 0.5,
          ease: "none",
        },
      )
      gsap.fromTo(
        ".intro-logo",
        { opacity: 0 },
        { opacity: 1, duration: 0.4, ease: "power2.inOut" },
      )
    }, introRef)

    // RP's beat (layout.js `f` timeline, decompiled): counter locks at
    // 100 → loader TEXTS fade (delay .15, 0.7s power2.out) while the CHIP
    // GLIDES to screen center (position:fixed, 0.7s power2.out, landing
    // as a 150×150 square exactly where the WebGL stack is parked) —
    // then the explode fires at the beat's end: introFlyIn + curtain
    // unmount in the SAME frame (RP: setStarted(1) + loader.remove();
    // the stack's top photo replaces the chip at the same spot).
    let beatTimer = 0
    let beatRaf = 0
    let readyTimer = 0
    const reveal = () => {
      if (dead) return
      // hand the engine the decoded bitmaps FIRST — pending wants are
      // satisfied synchronously from them, so isBootReady() converges
      // without a single network round trip
      galleryRef.current?.setDecodedImages(imgMap)
      // plan B (INTRO_EXPLODE=false): no beat, no explode — the wall has
      // been laid out behind the curtain all along; just reveal it
      if (!INTRO_EXPLODE) {
        gsap.set(introRef.current, { display: "none" })
        setIntroDone(true)
        return
      }
      // RP <Suspense> parity: the beat must not launch until EVERY boot
      // plane has its texture bound. The curtain's P≥1 only waited on
      // Image() preloads — Safari's three-side TextureLoader loads can
      // lag behind (Chrome shares the HTTP cache instantly, hiding the
      // gap): straggler planes then flew the explode as empty quads and
      // rebound mid-flight = the post-explode flicker. Poll briefly;
      // 4s cap so a stuck texture can never hang the intro.
      if (!galleryRef.current?.isBootReady()) {
        if (performance.now() - t0 < 4000 + MIN_WAIT) {
          readyTimer = window.setTimeout(reveal, 60)
          return
        } // else fall through — degrade rather than hang
      }
      const el = introRef.current
      if (!el || reduced) {
        setIntroDone(true)
        return
      }
      // finish every pending GPU texture upload NOW — the cost lands
      // inside the 1.3s still beat, so the explode flight never races a
      // multi-ms texImage2D+mipmap stall (the curtain's P≥1 only waited
      // on Image decodes; the THREE uploads were uncoordinated)
      galleryRef.current?.flushTextures()
      // targeted text fade (NOT the root — the chip must stay visible
      // for its flight; the opaque curtain itself never fades)
      gsap.to(
        el.querySelectorAll(
          ".intro-title, .intro-sub, .intro-odometer-wrap, .intro-mobile",
        ),
        { opacity: 0, duration: 0.7, ease: "power2.out", delay: 0.15 },
      )
      // chip → screen center (RP: `.to(j.children, {position:"fixed",
      // height:"150px", x:"+="…, y:"+="…, .7s power2.out})` — gsap x/y
      // are TRANSFORMS. The previous version animated left/top/width/
      // height — LAYOUT properties: Safari re-runs layout+paint every
      // frame of the flight (Chrome hides this cost). Size is set once
      // at take-off (RP sets height inside the tween the same way);
      // only x/y animate per frame.
      const chip = chipRef.current
      if (chip) {
        const r = chip.getBoundingClientRect()
        gsap.killTweensOf(chip)
        gsap.set(chip, {
          position: "fixed",
          left: 0,
          top: 0,
          x: r.left,
          y: r.top,
          width: 150,
          height: 150,
          margin: 0,
          marginBottom: 0,
          opacity: 1, // even if its P≥.8 fade-in never fired
        })
        gsap.to(chip, {
          x: window.innerWidth / 2 - 75,
          y: window.innerHeight / 2 - 75,
          duration: 0.7,
          ease: "power2.out",
          delay: 0.15,
        })
      }
      // the explode fires at the beat's end: introFlyIn + curtain
      // removal in the same frame
      beatTimer = window.setTimeout(() => {
        if (dead) return
        // the curtain has flown — later gallery remounts (project close)
        // must take the RETURN-VISIT path, never the first-load stack
        bootFlags.curtainFlown = true
        // tween creation FIRST — the morph's take-off frame stays clean
        galleryRef.current?.introFlyIn()
        // Hide the curtain with ONE style write (display:none = RP's
        // instant `loader.remove()` semantics; zero React work on the
        // take-off frame — Safari stays smooth). The node itself stays
        // React-owned: natively stealing it made React's commit crash
        // with NotFoundError on removeChild (the 白屏 regression — RP
        // can remove() because ITS loader is refs+vanilla, never React).
        gsap.set(introRef.current, { display: "none" })
        // React unmount deferred until the explode (1.4s) has fully
        // landed — the commit's teardown cost lands when nobody is
        // animating (imperceptible), not mid-flight (Safari stall)
        beatRaf = window.setTimeout(() => {
          if (!dead) setIntroDone(true)
        }, 1600)
      }, 1300)
    }

    const milestone = () => {
      if (dead) return
      const P = Math.min(1, loadState.loaded / firstLap.length)
      const settle = tweenTo(P * 100)
      if (!chipShown && P >= 0.8) {
        chipShown = true
        if (chipRef.current)
          gsap.to(chipRef.current, {
            opacity: 1,
            duration: reduced ? 0 : 0.4,
            ease: "power2.inOut",
          })
      }
      if (P >= 1) {
        // settle (0.35s tick) → 0.25s hold → fade, never sooner than the
        // minimum legibility wait (settle is in gsap SECONDS — ms here)
        const minLeft = Math.max(0, MIN_WAIT - (performance.now() - t0))
        finishTimer = window.setTimeout(reveal, minLeft + settle * 1000 + 250)
      }
    }

    // first lap of the wall — the exact photos the gallery binds first
    // (same seed as WebGLGallery lap 0 → shared cache, zero double-loading)
    // preload only what THIS device's wall shows first (2-col phones: 20,
    // 3-col tablets: 28, desktop: 36).
    const vw0 = window.innerWidth
    const preloadN = vw0 < 640 ? 20 : vw0 < 1140 ? 28 : 36
    const firstLap = shuffled(WALL, WALL_SEED).slice(0, preloadN)
    const loadState = { loaded: 0 }
    // decoded intro images, handed to the engine so boot-lap textures are
    // built from the SAME bitmaps the counter waited on (no second fetch;
    // Safari's three side can never lag the preloader again)
    const imgMap = new Map<string, HTMLImageElement>()
    firstLap.forEach((wp) => {
      const img = new Image()
      const done = () => {
        imgMap.set(wp.photo.thumb, img)
        loadState.loaded++
        milestone()
      }
      img.onload = done
      img.onerror = done
      img.src = wp.photo.thumb
    })
    milestone() // paint the initial 000 state (cached hits arrive async)

    return () => {
      dead = true
      window.clearTimeout(finishTimer)
      window.clearTimeout(beatTimer)
      window.clearTimeout(readyTimer)
      window.clearTimeout(beatRaf) // (now a timeout — defers the React unmount)
      gsap.killTweensOf(shown)
      ctx.revert()
    }
  }, [introDone])

  // ── Project: per-image fade/scale + scrubbed odometer ────────────────
  useEffect(() => {
    if (view !== "project" || !projectSeries) return
    const lenis = lenisRef.current
    const imgs = projectImages
    const slug = projectSeries.slug
    // deep link (#/p/:series/:n) → land on the routed photo, clamped
    const startIdx = Math.min(
      Math.max(0, routePhotoRef.current - 1),
      imgs.length - 1,
    )
    lenis?.scrollTo(startIdx * window.innerHeight, { immediate: true })
    projectIdxRef.current = startIdx
    setProjectIndex(startIdx)
    projectOdomRef.current?.raw(startIdx + 1)

    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>(".project-img").forEach((img) => {
        gsap.fromTo(img, { opacity: 0, scale: 1.08 }, {
          opacity: 1,
          scale: 1,
          duration: 0.9,
          ease: "power2.inOut",
          scrollTrigger: {
            trigger: img,
            start: "top 80%",
            toggleActions: "play none none reverse",
          },
        })
      })
      ScrollTrigger.create({
        trigger: projectRef.current,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => {
          const v = 1 + self.progress * (imgs.length - 1)
          projectOdomRef.current?.raw(v)
          const intIdx = Math.round(self.progress * (imgs.length - 1))
          if (intIdx !== projectIdxRef.current) {
            projectIdxRef.current = intIdx
            setProjectIndex(intIdx)
            // keep the address in sync without spamming history
            navReplace(`#/p/${slug}/${intIdx + 1}`)
          }
        },
      })
      const id = window.setTimeout(() => ScrollTrigger.refresh(), 350)
      return () => window.clearTimeout(id)
    }, projectRef)
    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, projectSeries, projectImages.length])

  // hash → scroll: tick clicks / back / forward land on the routed photo
  useEffect(() => {
    if (view !== "project" || !projectSeries || !projectImages.length) return
    const idx = Math.min(Math.max(0, route.photo - 1), projectImages.length - 1)
    if (idx !== projectIdxRef.current) {
      projectIdxRef.current = idx
      setProjectIndex(idx)
      lenisRef.current?.scrollTo(idx * window.innerHeight, { duration: 1.2 })
    }
  }, [route.photo, view, projectSeries, projectImages.length])

  function openProject(wp: WallPhoto) {
    setHoveredWP(null)
    nav(`#/p/${wp.series.slug}/${wp.index + 1}`)
  }
  function closeProject() {
    nav(mainHref(route.cat, lastMainModeRef.current))
  }
  function goToProjectImage(i: number) {
    if (projectSeries) nav(`#/p/${projectSeries.slug}/${i + 1}`)
  }
  function pickCat(c: CatFilter) {
    nav(mainHref(c, mode))
  }

  return (
    <div
      style={{
        background: bg,
        color: fg,
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          pointerEvents: "none",
          backgroundImage: NOISE,
          backgroundRepeat: "repeat",
          backgroundSize: "200px 200px",
          opacity: 0.05,
        }}
      />

      <Cursor />

      {/* ── INTRO · RP loading curtain ─────────────────────────────── */}
      {!introDone && (
        <div
          ref={introRef}
          className="intro-curtain"
          style={{
            position: "fixed",
            inset: 0,
            // OPAQUE (reverted): RP's introWrapper has a solid bg — the
            // nav/footer text must NOT bleed through during load (the
            // transparent experiment showed them static and uninvited).
            // The center photo during the beat is the DOM chip's flight,
            // not the WebGL stack peeking through (RP: same — the WebGL
            // stack only appears at the explode frame).
            background: bg,
            zIndex: 99999999999,
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          {/* desktop ≥601px — title bottom-left, odometer bottom-right */}
          <div
            className="intro-desktop"
            style={{
              position: "absolute",
              inset: 0,
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 24,
              padding: "0 20px 36px",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 14,
                minWidth: 0,
              }}
            >
              {/* RP introText (layout.js): small uppercase lines above the
                title, chars revealed by pure visibility stagger (.045,
                delay .5 — no y movement) — added per user request (C) */}
              <div className="intro-sub">
                <Chars
                  text="STREET — SCENERY — LIVE"
                  charStyle={{
                    ...DISPLAY,
                    fontSize: "clamp(11px, 1.1vw, 14px)",
                    letterSpacing: "0.14em",
                    lineHeight: 1.4,
                    color: fg,
                  }}
                />
                <Chars
                  text="PHOTOGRAPHY PORTFOLIO 2026"
                  charStyle={{
                    ...DISPLAY,
                    fontSize: "clamp(11px, 1.1vw, 14px)",
                    letterSpacing: "0.14em",
                    lineHeight: 1.4,
                    color: fg,
                  }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 18,
                }}
              >
                <div className="intro-title" style={{ overflow: "hidden" }}>
                  <Chars
                    text="SPIKE HU /"
                    charStyle={{
                      ...DISPLAY,
                      fontSize: "clamp(40px, 6.4vw, 96px)",
                      lineHeight: 0.9,
                      color: fg,
                    }}
                  />
                </div>
                {/* RP photo chip — first BEIJING thumb, wakes up late; the
                  beat flies it to screen center (RP's intro_richard.jpeg
                  position:fixed glide — the 顿感's focus point) */}
                <img
                  ref={chipRef}
                  src={HERO_CHIP}
                  alt=""
                  style={{
                    width: 150,
                    height: 45,
                    objectFit: "cover",
                    display: "block",
                    opacity: 0.009,
                    marginBottom: 8,
                  }}
                />
              </div>
            </div>
            <div className="intro-odometer-wrap">
              <IntroOdometer
                ref={introOdomRef}
                digitStyle={{
                  ...DISPLAY,
                  fontSize: "clamp(56px, 6.6vw, 92px)",
                  color: fg,
                  fontVariantNumeric: "tabular-nums",
                }}
              />
            </div>
          </div>

          {/* mobile ≤600px — centered logo mark, text counter */}
          <div
            className="intro-mobile"
            style={{
              position: "absolute",
              inset: 0,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              className="intro-logo"
              style={{
                ...DISPLAY,
                fontSize: 18,
                letterSpacing: "0.3em",
                color: fg,
                opacity: 0,
              }}
            >
              SPIKE HU
            </div>
            <div
              ref={mobileCounterRef}
              style={{
                position: "absolute",
                bottom: 36,
                right: 20,
                ...MONO,
                fontSize: 12,
                color: fg,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              [000%]
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN ─────────────────────────────────────────────────────── */}
      {view === "main" && (
        <>
          <NavBar
            headerRef={navRef}
            isDark={isDark}
            fg={fg}
            mode={mode}
            cat={route.cat}
            infoOpen={infoOpen}
            projectSeries={null}
            onToggleTheme={toggleTheme}
          />
          {panelWP && (
            <HoverPanel wp={panelWP} panelRef={panelRef} bg={bg} fg={fg} />
          )}

          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              height: 70,
              zIndex: 350,
              pointerEvents: "none",
              background: "linear-gradient(to bottom, var(--bg), transparent)",
            }}
          />
          <div
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              height: 220,
              zIndex: 350,
              pointerEvents: "none",
              background: "linear-gradient(to top, var(--bg) 45%, transparent)",
            }}
          />

          {/* Gallery stays mounted for the whole main view — overview AND
              list now (the filmstrip is in-canvas). `active` is false only
              for project/info; list↔overview mode flips trigger the RP view
              transition inside the gallery. */}
          {webglOk ? (
            <WebGLGallery
              ref={galleryRef}
              active={view === "main" && !infoOpen}
              infoOpen={infoOpen}
              listMode={mode === "list"}
              pool={pool}
              isDark={isDark}
              onHover={setHoveredWP}
              onSeq={(n) => footerOdomRef.current?.to(n)}
              onResetScroll={() => {
                // the wall already reset its own virtual position to top
                // (instant, at re-seed) — sync the window scroll to match
                // (page is locked; zero visual impact) + odometer back to 1
                lenisRef.current?.scrollTo(0, { immediate: true })
                footerOdomRef.current?.to(1)
              }}
              onPick={openProject}
            />
          ) : (
            /* DOM masonry fallback (no WebGL / reduced motion) */
            <Transition
              show={(mode === "overview" || mode === "list") && !infoOpen}
              enter={masonryEnter}
              exit={masonryExit}
            >
              <section
                style={{
                  paddingTop: 80,
                  paddingBottom: 260,
                  paddingLeft: "clamp(16px, 4vw, 40px)",
                  paddingRight: "clamp(16px, 4vw, 40px)",
                }}
                onMouseLeave={() => setHoveredWP(null)}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(min(240px, 44vw), 1fr))",
                    gap: 28,
                    alignItems: "start",
                  }}
                >
                  {pool.map((wp) => (
                    <div
                      data-cursor
                      className="masonry-card"
                      key={`${wp.series.slug}-${wp.index}`}
                      style={{
                        aspectRatio: `${wp.photo.w} / ${wp.photo.h}`,
                        overflow: "hidden",
                        cursor: "pointer",
                        background: "var(--bg-soft)",
                        position: "relative",
                      }}
                      onMouseEnter={() => setHoveredWP(wp)}
                      onClick={() => openProject(wp)}
                    >
                      <img
                        src={wp.photo.thumb}
                        alt={`${wp.series.name} ${wp.index + 1}`}
                        loading="lazy"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    </div>
                  ))}
                </div>
              </section>
            </Transition>
          )}

          {/* ── Footer ───────────────────────────────────────────────── */}
          <footer
            ref={footerRef}
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 400,
              padding: "0 20px calc(18px + env(safe-area-inset-bottom, 0px))",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                position: "relative",
                minHeight: 64,
              }}
            >
              <span
                style={{
                  ...MONO,
                  fontSize: 12,
                  color: fg,
                  opacity: 0.38,
                  paddingBottom: 6,
                }}
              >
                ©2026
              </span>
              {/* RP: the giant filter words live in LIST only — fade in
                  at the overview→list transition midpoint, out on exit */}
              <div
                ref={wordsRef}
                style={{
                  position: "absolute",
                  left: "50%",
                  transform: "translateX(-50%)",
                  bottom: 6,
                  opacity: 0,
                  pointerEvents: "none",
                }}
              >
                <FilterWords cat={route.cat} fg={fg} onPick={pickCat} />
              </div>
              <span
                style={{
                  ...MONO,
                  fontSize: 12,
                  color: fg,
                  opacity: 0.38,
                  paddingBottom: 6,
                  display: "inline-flex",
                  alignItems: "flex-end",
                }}
              >
                [
                <Odometer
                  ref={footerOdomRef}
                  digits={2}
                  digitStyle={{ ...MONO, fontSize: 12, color: fg, opacity: 1 }}
                />
                ]
              </span>
            </div>
          </footer>

          {/* ── INFO overlay ──────────────────────────────────────────── */}
          <Transition show={infoOpen} enter={infoEnter} exit={infoExit}>
            <div
              ref={infoLayerRef}
              data-lenis-prevent
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 550,
                background: isDark
                  ? "rgba(8,8,8,0.97)"
                  : "rgba(254,254,254,0.97)",
                backdropFilter: "blur(4px)",
                display: "flex",
                flexDirection: "column",
                padding: "80px clamp(20px, 5vw, 40px) 200px",
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 52,
                }}
              >
                <div
                  className="info-title"
                  style={{
                    ...DISPLAY,
                    fontSize: "clamp(48px, 6.8vw, 98px)",
                    lineHeight: 0.9,
                    color: fg,
                  }}
                >
                  <Chars
                    text="Info"
                    charStyle={{
                      ...DISPLAY,
                      fontSize: "clamp(48px, 6.8vw, 98px)",
                      lineHeight: 0.9,
                      color: fg,
                    }}
                  />
                </div>
                <button
                  className="info-block"
                  onClick={() => {
                    // RP contact close (layout.js @29048): the contact page
                    // fades ITSELF out — 1s power4.out (0.5s <800px) — and
                    // the route pops in the fade's onComplete. The wall's
                    // return-park fly-in then follows via restoreFromInfo.
                    const el = infoLayerRef.current
                    if (!el) {
                      nav(mainHref(route.cat, mode))
                      return
                    }
                    gsap.killTweensOf(el)
                    gsap.to(el, {
                      opacity: 0,
                      duration: window.innerWidth >= 800 ? 1 : 0.5,
                      ease: "power4.out",
                      onComplete: () => nav(mainHref(route.cat, mode)),
                    })
                  }}
                  style={{
                    ...MONO,
                    fontSize: 11,
                    color: fg,
                    background: "none",
                    border: "1px solid var(--fg)",
                    padding: "4px 10px",
                    cursor: "pointer",
                    marginTop: 10,
                  }}
                >
                  [CLOSE]
                </button>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
                  gap: 48,
                  maxWidth: 860,
                }}
              >
                <div>
                  <div className="info-block" style={{ marginBottom: 36 }}>
                    <div
                      style={{
                        ...MONO,
                        fontSize: 10,
                        color: fg,
                        opacity: 0.4,
                        marginBottom: 5,
                      }}
                    >
                      LOCAL TIME
                    </div>
                    <div
                      style={{
                        ...DISPLAY,
                        fontSize: 28,
                        color: fg,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {clock}
                    </div>
                  </div>
                  <div className="info-block" style={{ marginBottom: 36 }}>
                    <div
                      style={{
                        ...MONO,
                        fontSize: 10,
                        color: fg,
                        opacity: 0.4,
                        marginBottom: 5,
                      }}
                    >
                      CONTACT
                    </div>
                    <a
                      href="mailto:1162844453@qq.com"
                      style={{
                        ...DISPLAY,
                        fontSize: 20,
                        color: fg,
                        textDecoration: "none",
                        display: "block",
                        borderBottom: "1px solid var(--fg)",
                        paddingBottom: 8,
                      }}
                    >
                      1162844453@QQ.COM
                    </a>
                  </div>
                  <div className="info-block" style={{ marginBottom: 36 }}>
                    <div
                      style={{
                        ...MONO,
                        fontSize: 10,
                        color: fg,
                        opacity: 0.4,
                        marginBottom: 6,
                      }}
                    >
                      BASED IN
                    </div>
                    <div style={{ ...MONO, fontSize: 12, color: fg }}>
                      SHANGHAI, CHINA
                    </div>
                  </div>
                  <div
                    className="info-block"
                    style={{ display: "flex", gap: 24 }}
                  >
                    {[
                      ["GITHUB", "https://github.com/UNborracho"],
                      ["UNSPLASH", "https://unsplash.com/@_vag4b0nd_"],
                      ["REDNOTE", "https://xhslink.cn/m/5autIUSsSVM"],
                    ].map(([label, href]) => (
                      <a
                        key={label}
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        data-cursor
                        style={{
                          ...MONO,
                          fontSize: 10,
                          color: fg,
                          opacity: 0.38,
                          textDecoration: "none",
                        }}
                      >
                        {label}
                      </a>
                    ))}
                  </div>
                </div>
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "3/4",
                    background: "var(--bg-soft)",
                    overflow: "hidden",
                  }}
                >
                  <img
                    className="info-portrait"
                    src={AVATAR?.src ?? ""}
                    alt="Photographer portrait"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                      opacity: 0.82,
                      willChange: "transform",
                    }}
                  />
                </div>
              </div>
              {/* policy pages pending — re-enable (display:flex) when URLs exist */}
              <div
                className="info-policy"
                style={{
                  position: "absolute",
                  bottom: 20,
                  left: 40,
                  display: "none",
                  gap: 24,
                }}
              >
                {["PRIVACY POLICY", "COOKIE POLICY"].map((l) => (
                  <span
                    key={l}
                    style={{
                      ...MONO,
                      fontSize: 9,
                      color: fg,
                      opacity: 0.28,
                      cursor: "pointer",
                    }}
                  >
                    {l}
                  </span>
                ))}
              </div>
            </div>
          </Transition>
        </>
      )}

      {/* ── PROJECT ──────────────────────────────────────────────────── */}
      {view === "project" && projectSeries && (
        <>
          <NavBar
            isDark={isDark}
            fg={fg}
            mode={mode}
            cat={route.cat}
            infoOpen={infoOpen}
            projectSeries={projectSeries}
            onClose={closeProject}
            onToggleTheme={toggleTheme}
          />
          <div style={{ position: "fixed", top: 76, left: 20, zIndex: 500 }}>
            {([
              ["SERIES", projectSeries.name],
              ["CATEGORY", projectSeries.category.toUpperCase()],
              ["YEAR", String(projectSeries.year)],
              ["PHOTOS", String(projectSeries.photos.length)],
            ] as [string, string][]).map(([k, v]) => (
              <div
                key={k}
                style={{ display: "flex", gap: 14, marginBottom: 3 }}
              >
                <span
                  style={{
                    ...MONO,
                    fontSize: 9,
                    color: fg,
                    opacity: 0.38,
                    minWidth: 68,
                  }}
                >
                  {k}
                </span>
                <span style={{ ...MONO, fontSize: 9, color: fg }}>{v}</span>
              </div>
            ))}
          </div>
          <div ref={projectRef}>
            {projectImages.map((photo, i) => (
              <div
                key={photo.full}
                style={{
                  height: "100vh",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                  background: bg,
                }}
              >
                <img
                  className="project-img"
                  src={photo.full}
                  alt={`${projectSeries.name} ${i + 1}`}
                  loading="lazy"
                  style={{
                    maxWidth: "85vw",
                    maxHeight: "82vh",
                    objectFit: "contain",
                    display: "block",
                    background: "var(--bg-soft)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    bottom: 24,
                    left: 24,
                    ...MONO,
                    fontSize: 9,
                    color: fg,
                    opacity: 0.38,
                  }}
                >
                  {projectSeries.name} — {projectSeries.year} · {i + 1} /{" "}
                  {projectImages.length}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              position: "fixed",
              right: 20,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              flexDirection: "column",
              gap: 7,
              zIndex: 700,
            }}
          >
            {projectImages.map((_, i) => (
              <button
                key={i}
                onClick={() => goToProjectImage(i)}
                aria-label={`Go to photo ${i + 1}`}
                style={{
                  border: "none",
                  background: "none",
                  padding: "12px 6px", // 44px-class touch target
                  cursor: "pointer",
                  display: "block",
                }}
              >
                <span
                  style={{
                    display: "block",
                    width: i === projectIndex ? 20 : 10,
                    height: 1,
                    background: fg,
                    opacity: i === projectIndex ? 1 : 0.22,
                    transition: "width 0.22s ease, opacity 0.22s ease",
                  }}
                />
              </button>
            ))}
          </div>
          <div
            style={{
              position: "fixed",
              bottom: 24,
              right: 24,
              zIndex: 700,
              ...DISPLAY,
              fontSize: "clamp(48px, 6vw, 90px)",
              lineHeight: 1,
              color: fg,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <Odometer
              ref={projectOdomRef}
              digits={3}
              digitStyle={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
                fontSize: "clamp(48px, 6vw, 90px)",
                lineHeight: 1,
                color: fg,
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
