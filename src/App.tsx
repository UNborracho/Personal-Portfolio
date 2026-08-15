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
import WebGLGallery, { WALL_SEED } from "./WebGLGallery"
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
  coverOf,
  shuffled,
  type WallPhoto,
  type Series,
  type CatFilter,
} from "./shared"

gsap.registerPlugin(ScrollTrigger)

type View = "preloader" | "main" | "project"

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
const Odometer = forwardRef<
  OdometerHandle,
  { digits: number; digitStyle: React.CSSProperties }
>(function Odometer({ digits, digitStyle }, ref) {
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
            willChange: "transform",
            ...charStyle,
          }}
        >
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </span>
  )
}

// ── View-transition choreography (reference-measured rhythm) ──────────
// NOTE: the Transition wrapper (el) must NEVER get a transform — a
// transformed ancestor becomes the containing block for fixed descendants.
// Motion lives on children only; the exit drift runs on the .list-stage.

const listEnter = (el: HTMLElement) => {
  const cards = el.querySelectorAll(".list-card")
  const stage = el.querySelector(".list-stage")
  gsap.killTweensOf([el, ...cards, ...(stage ? [stage] : [])])
  gsap.set(el, { opacity: 1 })
  if (stage) gsap.set(stage, { y: 0 })
  gsap.fromTo(
    cards,
    { opacity: 0, y: 26, scale: 1.04 },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.6,
      ease: "power2.inOut",
      stagger: 0.045,
      delay: 0.3,
    },
  )
}
const fadeExit =
  (duration: number) =>
  (el: HTMLElement, done: () => void): void => {
    gsap.killTweensOf(el)
    gsap.to(el, {
      opacity: 0,
      duration,
      ease: "power2.inOut",
      onComplete: done,
    })
  }

const listExit = (el: HTMLElement, done: () => void) => {
  const stage = el.querySelector(".list-stage")
  if (stage) {
    gsap.killTweensOf(stage)
    gsap.to(stage, { y: -10, duration: 0.25, ease: "power2.inOut" })
  }
  fadeExit(0.25)(el, done)
}

// DOM masonry fallback: cards stagger in shortly after the beat
const masonryEnter = (el: HTMLElement) => {
  const cards = el.querySelectorAll(".masonry-card")
  gsap.killTweensOf([el, ...cards])
  gsap.set(el, { opacity: 1 })
  gsap.fromTo(
    cards,
    { opacity: 0, y: 20 },
    {
      opacity: 1,
      y: 0,
      duration: 0.5,
      ease: "power2.inOut",
      stagger: 0.03,
      delay: 0.15,
    },
  )
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
  gsap.fromTo(
    chars,
    { yPercent: 110, rotate: 4 },
    {
      yPercent: 0,
      rotate: 0,
      duration: 0.7,
      ease: "power2.inOut",
      stagger: 0.03,
      delay: 0.85,
    },
  )
  gsap.fromTo(
    blocks,
    { opacity: 0, y: 14 },
    {
      opacity: 1,
      y: 0,
      duration: 0.5,
      ease: "power2.inOut",
      stagger: 0.045,
      delay: 0.95,
    },
  )
  gsap.fromTo(
    portrait,
    { scale: 1.5, opacity: 0 },
    { scale: 1, opacity: 0.82, duration: 1, ease: "power2.inOut", delay: 1 },
  )
  gsap.fromTo(
    policy,
    { opacity: 0 },
    { opacity: 1, duration: 0.5, ease: "power2.inOut", delay: 1.2 },
  )
}
const infoExit = fadeExit(0.5)

// ── Chrome components ─────────────────────────────────────────────────
// NOTE: these MUST live at module scope (see the remount bug note in git
// history) — useClock ticks would otherwise re-create them every second.

function NavBar({
  isDark,
  fg,
  mode,
  cat,
  infoOpen,
  projectSeries,
  onClose,
  onToggleTheme,
}: {
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
                  const base =
                    cat === "all"
                      ? mode === "list"
                        ? "#/list"
                        : "#/"
                      : mode === "list"
                        ? `#/${cat}/list`
                        : `#/${cat}`
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
        {(
          [
            ["CATEGORY", series.category.toUpperCase()],
            ["YEAR", String(series.year)],
            ["PHOTOS", String(series.photos.length)],
            ["FRAME", `${index + 1} / ${series.photos.length}`],
          ] as [string, string][]
        ).map(([k, v]) => (
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
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: 6,
        display: "flex",
        alignItems: "baseline",
        gap: "clamp(8px, 1.8vw, 18px)",
        whiteSpace: "nowrap",
      }}
    >
      {words.map((w, i) => (
        <span key={w.slug} style={{ display: "inline-flex", alignItems: "baseline" }}>
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
              textDecoration:
                cat === w.slug ? "underline" : "none",
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
        return (localStorage.getItem("theme") as "light" | "dark") || "light"
      } catch {
        return "light"
      }
    })(),
  )
  const [projectIndex, setProjectIndex] = useState(0)

  const lenisRef = useRef<Lenis | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const preloaderRef = useRef<HTMLDivElement>(null)
  const counterRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const projectRef = useRef<HTMLDivElement>(null)
  const footerOdomRef = useRef<OdometerHandle>(null)
  const projectOdomRef = useRef<OdometerHandle>(null)
  const projectIdxRef = useRef(0)
  const routePhotoRef = useRef(route.photo)
  const lastMainModeRef = useRef<Mode>("overview")
  const clock = useClock()
  const webglOk = useWebGLOk()

  // sub-pixel scroll from Lenis (fractional) — falls back to integer window.scrollY
  const getScroll = useCallback(
    () => (lenisRef.current ? lenisRef.current.animatedScroll : window.scrollY),
    [],
  )

  // ── Route → view state ─────────────────────────────────────────────
  // The hash is the single source of truth once the intro has played.
  const projectSeries =
    route.view === "project" ? seriesBySlug(route.series ?? "") : null
  const view: View = !introDone
    ? "preloader"
    : route.view === "project" && projectSeries
      ? "project"
      : "main"
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
    gsap.ticker.lagSmoothing(0)
    return () => {
      gsap.ticker.remove(tickerFn)
      lenis.destroy()
      lenisRef.current = null
    }
  }, [])

  useEffect(() => {
    const lenis = lenisRef.current
    if (!lenis) return
    if (infoOpen) lenis.stop()
    else lenis.start()
  }, [infoOpen])

  // Reset scroll + odometer whenever the (WebGL) overview is entered, or
  // the category filter switches (conveyor re-seeds → start from the top)
  useEffect(() => {
    if (view === "main" && mode === "overview") {
      lenisRef.current?.scrollTo(0, { immediate: true })
      footerOdomRef.current?.to(1)
    }
  }, [view, mode, route.cat])

  // remember the last main mode so closing a project returns to it
  useEffect(() => {
    if (view === "main" && (mode === "overview" || mode === "list"))
      lastMainModeRef.current = mode
  }, [view, mode])

  // leaving the overview must drop any lingering hover
  useEffect(() => {
    if (view !== "main" || mode !== "overview") setHoveredWP(null)
  }, [view, mode])

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

  // ── Intro: REAL loading progress ─────────────────────────────────────
  // The counter/bar can never outrun the actual bytes: displayed % is
  // clamped to (loaded thumbs / first-lap 36). The char animation keeps
  // its choreography; the gate opens when both finish.
  useEffect(() => {
    if (view !== "preloader") return

    // first lap of the wall — the exact photos the gallery binds first
    // (same seed as WebGLGallery lap 0 → zero double-loading)
    // preload only what THIS device's wall shows first (2-col phones: 18,
    // 3-col tablets: 27, desktop: 36). Waiting for all 36 on a phone stalled
    // the counter at ~50% for seconds on cellular/WeChat webview.
    const vw0 = window.innerWidth
    const preloadN = vw0 < 640 ? 20 : vw0 < 1140 ? 28 : 36
    const firstLap = shuffled(WALL, WALL_SEED).slice(0, preloadN)
    const loadState = { loaded: 0 }
    firstLap.forEach((wp) => {
      const img = new Image()
      const done = () => {
        loadState.loaded++
      }
      img.onload = done
      img.onerror = done
      img.src = wp.photo.thumb
    })

    let finishTimer = 0
    let poller = 0
    const ctx = gsap.context(() => {
      const prog = { shown: 0 }
      gsap.to(prog, {
        shown: 100,
        duration: 2.8,
        ease: "power2.inOut",
        onUpdate: () => {
          const real = (loadState.loaded / firstLap.length) * 100
          const v = Math.min(prog.shown, real)
          if (counterRef.current)
            counterRef.current.textContent = `${String(Math.round(v)).padStart(3, "0")}%`
          if (barRef.current)
            barRef.current.style.transform = `scaleX(${v / 100})`
        },
        onComplete: () => {
          const finish = () => {
            finishTimer = window.setTimeout(() => setIntroDone(true), 350)
          }
          if (loadState.loaded >= firstLap.length) finish()
          else
            poller = window.setInterval(() => {
              if (loadState.loaded >= firstLap.length) {
                window.clearInterval(poller)
                // push the counter to the real 100 before leaving
                if (counterRef.current) counterRef.current.textContent = "100%"
                if (barRef.current)
                  barRef.current.style.transform = "scaleX(1)"
                finish()
              }
            }, 80)
        },
      })
      gsap.from(".intro-char", {
        yPercent: 100,
        rotate: 7,
        duration: 0.7,
        ease: "power2.inOut",
        stagger: 0.03,
        delay: 0.05,
      })
    }, preloaderRef)
    return () => {
      window.clearTimeout(finishTimer)
      window.clearInterval(poller)
      ctx.revert()
    }
  }, [view])

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
        gsap.fromTo(
          img,
          { opacity: 0, scale: 1.08 },
          {
            opacity: 1,
            scale: 1,
            duration: 0.9,
            ease: "power2.inOut",
            scrollTrigger: {
              trigger: img,
              start: "top 80%",
              toggleActions: "play none none reverse",
            },
          },
        )
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
    const idx = Math.min(
      Math.max(0, route.photo - 1),
      projectImages.length - 1,
    )
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
  function openSeries(series: Series) {
    setHoveredWP(null)
    nav(`#/p/${series.slug}`)
  }
  function closeProject() {
    const cat = route.cat === "all" ? "" : `${route.cat}/`
    nav(lastMainModeRef.current === "list" ? `#/${cat}list` : `#/${cat || ""}`)
  }
  function goToProjectImage(i: number) {
    if (projectSeries) nav(`#/p/${projectSeries.slug}/${i + 1}`)
  }
  function pickCat(c: CatFilter) {
    const base = c === "all" ? "" : `/${c}`
    nav(mode === "list" ? `#${base}/list`.replace("//", "/") : `#${base || "/"}`)
  }

  return (
    <div
      style={{
        background: bg,
        color: fg,
        minHeight: "100vh",
      }}
    >
      <style>{`
        .nav-center { display: flex !important; }
        @media (max-width: 1139px) { .nav-center { display: none !important; } }
        @media (max-width: 639px) { .nav-mail { display: none !important; } }
      `}</style>

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

      {/* ── PRELOADER ─────────────────────────────────────────────────── */}
      {view === "preloader" && (
        <div
          ref={preloaderRef}
          style={{
            position: "fixed",
            inset: 0,
            background: bg,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            padding: "0 20px 36px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <div>
              <div style={{ marginBottom: 4 }}>
                <Chars
                  text="SPIKE HU"
                  charStyle={{
                    ...MONO,
                    fontSize: 11,
                    color: fg,
                    opacity: 0.44,
                  }}
                />
              </div>
              <div style={{ marginBottom: 4, whiteSpace: "nowrap" }}>
                <Chars
                  text="STREET / SCENERY / LIVE"
                  charStyle={{
                    ...MONO,
                    fontSize: 11,
                    color: fg,
                    opacity: 0.44,
                  }}
                />
              </div>
              <div style={{ marginBottom: 14, whiteSpace: "nowrap" }}>
                <Chars
                  text="PHOTOGRAPHY / FOLIO '26"
                  charStyle={{
                    ...MONO,
                    fontSize: 11,
                    color: fg,
                    opacity: 0.44,
                  }}
                />
              </div>
              <div style={{ overflow: "hidden" }}>
                <Chars
                  text="SPIKE HU /"
                  charStyle={{
                    ...DISPLAY,
                    fontSize: "clamp(36px, 6.8vw, 98px)",
                    lineHeight: 0.9,
                    color: fg,
                  }}
                />
              </div>
            </div>
            <div
              ref={counterRef}
              style={{
                ...DISPLAY,
                fontSize: "clamp(40px, 6.6vw, 95px)",
                lineHeight: 1,
                color: fg,
                fontVariantNumeric: "tabular-nums",
                textAlign: "right",
              }}
            >
              000%
            </div>
          </div>
          <div
            ref={barRef}
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              width: "100%",
              height: 1,
              background: fg,
              opacity: 0.22,
              transform: "scaleX(0)",
              transformOrigin: "left center",
            }}
          />
        </div>
      )}

      {/* ── MAIN ─────────────────────────────────────────────────────── */}
      {view === "main" && (
        <>
          <NavBar
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

          {/* Gallery stays mounted for the whole main view; `active` fades it
              out/in (canvas + spacer) when switching to list/info. */}
          {webglOk ? (
            <WebGLGallery
              active={mode === "overview" && !infoOpen}
              pool={pool}
              getScroll={getScroll}
              isDark={isDark}
              onHover={setHoveredWP}
              onSeq={(n) => footerOdomRef.current?.to(n)}
              onPick={openProject}
            />
          ) : (
            /* DOM masonry fallback (no WebGL / reduced motion) */
            <Transition
              show={mode === "overview" && !infoOpen}
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

          <Transition show={mode === "list"} enter={listEnter} exit={listExit}>
            <div
              className="list-stage"
              style={{
                position: "fixed",
                top: 60,
                left: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                overflow: "hidden",
              }}
            >
              <div
                data-lenis-prevent
                style={{
                  display: "flex",
                  gap: 28,
                  padding: "0 clamp(20px, 4vw, 40px)",
                  overflowX: "auto",
                  height: "52vh",
                }}
                onMouseLeave={() => setHoveredWP(null)}
              >
                {SERIES.map((s) => {
                  const cover = coverOf(s)
                  const coverWP: WallPhoto = { series: s, index: 0, photo: cover }
                  return (
                    <div
                      data-cursor
                      className="list-card"
                      key={s.slug}
                      style={{
                        flexShrink: 0,
                        height: "100%",
                        aspectRatio: "3 / 2",
                        overflow: "hidden",
                        cursor: "pointer",
                        background: "var(--bg-soft)",
                        position: "relative",
                      }}
                      onMouseEnter={() => setHoveredWP(coverWP)}
                      onClick={() => openSeries(s)}
                    >
                      <img
                        src={cover.thumb}
                        alt={s.name}
                        loading="lazy"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          bottom: 8,
                          left: 10,
                          ...MONO,
                          fontSize: 9,
                          color: "#FEFEFE",
                        }}
                      >
                        {String(seriesNumber(s)).padStart(2, "0")}
                      </div>
                      <div
                        style={{
                          position: "absolute",
                          bottom: 8,
                          right: 10,
                          ...MONO,
                          fontSize: 9,
                          color: "#FEFEFE",
                        }}
                      >
                        {s.name}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </Transition>

          {/* ── Footer ───────────────────────────────────────────────── */}
          <footer
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 400,
              padding:
                "0 20px calc(18px + env(safe-area-inset-bottom, 0px))",
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
              <FilterWords cat={route.cat} fg={fg} onPick={pickCat} />
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
                    const base =
                      route.cat === "all"
                        ? mode === "list"
                          ? "#/list"
                          : "#/"
                        : mode === "list"
                          ? `#/${route.cat}/list`
                          : `#/${route.cat}`
                    nav(base)
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
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
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
            {(
              [
                ["SERIES", projectSeries.name],
                ["CATEGORY", projectSeries.category.toUpperCase()],
                ["YEAR", String(projectSeries.year)],
                ["PHOTOS", String(projectSeries.photos.length)],
              ] as [string, string][]
            ).map(([k, v]) => (
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
