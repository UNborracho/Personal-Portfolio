import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
  lazy,
  Suspense,
} from "react"
import Lenis from "lenis"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { WALL_SEED, INTRO_EXPLODE, bootFlags } from "./gallery-flags"
import type { GalleryHandle } from "./WebGLGallery"

// The WebGL engine (three ≈ 500KB raw) rides in its OWN async chunk,
// fetched only when the device will actually mount it — DOM-fallback
// devices (mobile/reduced-motion) never download it. The intro beat's
// existing isBootReady poll (60ms retry, 4s cap) absorbs the chunk's
// parallel load; the curtain covers the gap.
const WebGLGallery = lazy(() => import("./WebGLGallery"))
import Cursor from "./Cursor"
import Transition from "./Transition"
import { useRoute, nav, navReplace, type Mode } from "./router"
import {
  WALL,
  wallForCat,
  seriesBySlug,
  shuffled,
  type WallPhoto,
  type CatFilter,
} from "./shared"
import {
  REDUCED_MOTION,
  fadeExit,
  MONO,
  DISPLAY,
  NOISE,
  type View,
} from "./ui"
import { Chars } from "./components/Chars"
import {
  Odometer,
  IntroOdometer,
  type OdometerHandle,
  type IntroOdometerHandle,
} from "./components/Odometer"
import NavBar, { mainHref } from "./components/NavBar"
import HoverPanel from "./components/HoverPanel"
import FilterWords from "./components/FilterWords"
import InfoOverlay from "./views/InfoOverlay"
import ProjectView from "./views/ProjectView"

gsap.registerPlugin(ScrollTrigger)

// App shell after the module split: intro orchestration, main view
// (overview/list, gallery mount, footer, intro curtain), routing effects
// and view-transition wiring. Chrome components live in ./components,
// the INFO/project views in ./views, shared primitives in ./ui.

// WebGL + reduced-motion capability check (decides gallery vs DOM
// fallback) — module scope: one probe per page, no throwaway canvas
// per mount (StrictMode mounts twice).
const WEBGL_OK = (() => {
  try {
    if (REDUCED_MOTION) return false
    const c = document.createElement("canvas")
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext("webgl") || c.getContext("experimental-webgl"))
    )
  } catch {
    return false
  }
})()

// ── RP intro photo chip: the WALL'S HERO (lap-0 first photo) ──────────
// Same photo as the stack top the WebGL handoff reveals — the chip
// vanishes at the beat's end exactly where the hero plane already sits
// (150px, same spot): a seamless swap. (RP's chip is a separate portrait
// that visibly changes photo at handoff — ours swaps identities for free
// by being the SAME image; user-confirmed intent.)
// LAP0 is the module-level first lap of the wall — one shuffle shared by
// the hero chip and the preloader so both agree on photo order.
const LAP0 = shuffled(WALL, WALL_SEED)
const HERO_CHIP = LAP0[0].photo.thumb

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
  const webglOk = WEBGL_OK

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
  useEffect(() => {
    routePhotoRef.current = route.photo
  }, [route.photo])

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
      // per-word mask rise on the same clock start (the hover-card
      // reveal grammar); skip under reduced motion
      const inners = el.querySelectorAll("[data-fw]")
      if (!REDUCED_MOTION) {
        gsap.set(inners, { yPercent: 110 })
        gsap.to(inners, {
          yPercent: 0,
          duration: 0.5,
          ease: "power2.out",
          stagger: 0.045,
          delay: 0.7,
        })
      }
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
  // ── RP info entry (layout.js @29048): canvas fades out 0.5s
  // power4.in BEFORE the route flips — replaces the old hard cut.
  // The info layer's own entrance runs after the flip; exit stays the
  // verified 1s power4.out close → restoreFromInfo path.
  const openInfo = useCallback(() => {
    if (infoOpen) return
    const base = mainHref(route.cat, mode)
    const go = () => nav(`${base}/info`)
    if (galleryRef.current) galleryRef.current.fadeOutForInfo().then(go)
    else go() // DOM fallback / gallery not mounted — flip immediately
  }, [infoOpen, route.cat, mode])

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

  // cascade state: first show vs in-card replay (B)
  const panelShownRef = useRef(false)

  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    gsap.killTweensOf(el)
    if (!hoveredWP) {
      panelShownRef.current = false
      gsap.to(el, { opacity: 0, y: 10, duration: 0.18, ease: "power2.inOut" })
      return
    }
    // stale commit (hover already moved on, panelWP lags one commit
    // behind): the card stays put — the latch's commit re-runs this
    // with the new content and replays the cascade there
    if (panelWP !== hoveredWP) return
    const lines = el.querySelectorAll<HTMLElement>('[data-hp="line"]')
    const rows = el.querySelectorAll<HTMLElement>('[data-hp="row"]')
    const fins = el.querySelectorAll<HTMLElement>('[data-hp="fin"]')
    gsap.killTweensOf([...lines, ...rows, ...fins])
    if (REDUCED_MOTION) {
      gsap.set([lines, rows, fins], { clearProps: "all" })
      gsap.set(el, { opacity: 1, y: 0 })
      panelShownRef.current = true
      return
    }
    const firstShow = !panelShownRef.current
    panelShownRef.current = true
    // children hidden states (React already rendered the NEW text)
    gsap.set(lines, { yPercent: 110, rotate: 4 })
    gsap.set(rows, { y: 8, opacity: 0 })
    gsap.set(fins, { opacity: 0 })
    const tl = gsap.timeline()
    if (firstShow) {
      gsap.set(el, { y: 14 })
      tl.to(el, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" }, 0)
    } // replay (B): the card is already on screen — children only
    tl.to(
      lines,
      {
        yPercent: 0,
        rotate: 0,
        duration: 0.5,
        ease: "power2.out",
        stagger: 0.05,
      },
      0.05,
    )
    tl.to(
      rows,
      { y: 0, opacity: 1, duration: 0.3, ease: "power2.out", stagger: 0.03 },
      0.18,
    )
    tl.to(fins, { opacity: 1, duration: 0.25, ease: "power2.out" }, 0.42)
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

    const reduced = REDUCED_MOTION
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
      gsap.fromTo(".intro-title .intro-char", { yPercent: 100, rotate: 7 }, {
        yPercent: 0,
        rotate: 0,
        duration: 0.8,
        ease: "power2.out",
        stagger: 0.04,
      })
      // RP introText lines: pure VISIBILITY stagger (.045, delay .5 —
      // no y movement), small uppercase lines above the title (C)
      gsap.fromTo(".intro-sub .intro-char", { visibility: "hidden" }, {
        visibility: "visible",
        stagger: 0.045,
        delay: 0.5,
        ease: "none",
      })
      gsap.fromTo(".intro-logo", { opacity: 0 }, {
        opacity: 1,
        duration: 0.4,
        ease: "power2.inOut",
      })
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
    const firstLap = LAP0.slice(0, preloadN)
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
            onOpenInfo={openInfo}
          />
          {panelWP && (
            <HoverPanel wp={panelWP} panelRef={panelRef} fg={fg} isDark={isDark} />
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
            <Suspense fallback={null}>
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
            </Suspense>
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
          <InfoOverlay
            infoOpen={infoOpen}
            infoLayerRef={infoLayerRef}
            isDark={isDark}
            fg={fg}
            cat={route.cat}
            mode={mode}
          />
        </>
      )}

      {/* ── PROJECT ──────────────────────────────────────────── */}
      {view === "project" && projectSeries && (
        <ProjectView
          projectSeries={projectSeries}
          projectIndex={projectIndex}
          projectRef={projectRef}
          projectOdomRef={projectOdomRef}
          fg={fg}
          bg={bg}
          isDark={isDark}
          cat={route.cat}
          mode={mode}
          infoOpen={infoOpen}
          onClose={closeProject}
          onGoToImage={goToProjectImage}
          onToggleTheme={toggleTheme}
        />
      )}
    </div>
  )
}
