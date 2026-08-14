import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useCallback,
} from 'react'
import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import WebGLGallery from './WebGLGallery'
import Cursor from './Cursor'
import {
  WORKS,
  getProjectImages,
  COL_OFFSETS,
  CSS_AR,
  UB,
  type Work,
} from './shared'

gsap.registerPlugin(ScrollTrigger)

type View = 'preloader' | 'main' | 'project'
type Mode = 'overview' | 'list'

const NOISE = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/></filter><rect width='200' height='200' filter='url(%23n)'/></svg>")`

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontWeight: 500,
  letterSpacing: '0.1em',
  textTransform: 'uppercase' as const,
}
const DISPLAY: React.CSSProperties = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 700,
}

function useClock() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduce) return false
      const c = document.createElement('canvas')
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')))
    } catch {
      return false
    }
  }, [])
}

// ── Rolling-digit Odometer ───────────────────────────────────────────────
const STRIP = '01234567890'
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
          ease: 'power2.inOut',
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
      const cell = wrapRef.current?.querySelector('.od-cell') as HTMLElement | null
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
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return (
    <span ref={wrapRef} style={{ display: 'inline-flex', lineHeight: 1, verticalAlign: 'baseline' }}>
      {Array.from({ length: digits }).map((_, i) => (
        <span key={i} style={{ display: 'inline-block', overflow: 'hidden', height: cellH || undefined, verticalAlign: 'top' }}>
          <span style={{ display: 'block', willChange: 'transform' }}>
            {STRIP.split('').map((d, j) => (
              <span key={j} className="od-cell" style={{ display: 'block', lineHeight: 1, ...digitStyle }}>
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
function Chars({ text, charStyle }: { text: string; charStyle?: React.CSSProperties }) {
  return (
    <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top' }}>
      {text.split('').map((ch, i) => (
        <span key={i} className="intro-char" style={{ display: 'inline-block', willChange: 'transform', ...charStyle }}>
          {ch === ' ' ? '\u00A0' : ch}
        </span>
      ))}
    </span>
  )
}

export default function App() {
  const [view, setView] = useState<View>('preloader')
  const [mode, setMode] = useState<Mode>('overview')
  const [infoOpen, setInfoOpen] = useState(false)
  const [hoveredWork, setHoveredWork] = useState<Work | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    (typeof localStorage !== 'undefined' && (localStorage.getItem('theme') as 'light' | 'dark')) || 'light',
  )
  const [projectWork, setProjectWork] = useState<Work | null>(null)
  const [projectIndex, setProjectIndex] = useState(0)

  const lenisRef = useRef<Lenis | null>(null)
  const preloaderRef = useRef<HTMLDivElement>(null)
  const counterRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const projectRef = useRef<HTMLDivElement>(null)
  const footerOdomRef = useRef<OdometerHandle>(null)
  const projectOdomRef = useRef<OdometerHandle>(null)
  const projectIdxRef = useRef(0)
  const clock = useClock()
  const webglOk = useWebGLOk()

  // sub-pixel scroll from Lenis (fractional) — falls back to integer window.scrollY
  const getScroll = useCallback(
    () => (lenisRef.current ? lenisRef.current.animatedScroll : window.scrollY),
    [],
  )

  const isDark = theme === 'dark'
  const bg = isDark ? '#080808' : '#FEFEFE'
  const fg = isDark ? '#FEFEFE' : '#080808'

  function toggleTheme() {
    const next: 'light' | 'dark' = isDark ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('theme', next)
  }

  const columns = Array.from({ length: 4 }, (_, ci) => WORKS.filter((_, i) => i % 4 === ci))
  const projectImages = projectWork ? getProjectImages(projectWork) : []
  const currentProjectImg = projectImages[projectIndex]

  // ── Lenis + GSAP/ScrollTrigger wiring (once) ─────────────────────────
  useEffect(() => {
    const lenis = new Lenis({ normalizeWheel: false, smoothTouch: false })
    lenisRef.current = lenis
    lenis.on('scroll', ScrollTrigger.update)
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

  // Reset scroll + odometer whenever the (WebGL) overview is entered
  useEffect(() => {
    if (view === 'main' && mode === 'overview') {
      lenisRef.current?.scrollTo(0, { immediate: true })
      footerOdomRef.current?.to(1)
    }
  }, [view, mode])

  // ── Intro ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (view !== 'preloader') return
    const ctx = gsap.context(() => {
      gsap.to(
        { val: 0 },
        {
          val: 100,
          duration: 2.6,
          ease: 'power2.inOut',
          onUpdate: function () {
            const v = Math.round(this.targets()[0].val)
            if (counterRef.current) counterRef.current.textContent = `${String(v).padStart(3, '0')}%`
          },
          onComplete: () => setTimeout(() => setView('main'), 350),
        },
      )
      gsap.from('.intro-char', {
        yPercent: 100,
        rotate: 7,
        duration: 0.7,
        ease: 'power2.inOut',
        stagger: 0.03,
        delay: 0.05,
      })
      gsap.fromTo(
        barRef.current,
        { scaleX: 0 },
        { scaleX: 1, duration: 2.6, ease: 'power2.inOut', transformOrigin: 'left center' },
      )
    }, preloaderRef)
    return () => ctx.revert()
  }, [view])

  // ── Project: per-image fade/scale + scrubbed odometer ────────────────
  useEffect(() => {
    if (view !== 'project' || !projectWork) return
    const lenis = lenisRef.current
    lenis?.scrollTo(0, { immediate: true })
    projectIdxRef.current = 0
    setProjectIndex(0)
    projectOdomRef.current?.raw(1)
    const imgs = projectImages

    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('.project-img').forEach((img) => {
        gsap.fromTo(
          img,
          { opacity: 0, scale: 1.08 },
          {
            opacity: 1,
            scale: 1,
            duration: 0.9,
            ease: 'power2.inOut',
            scrollTrigger: { trigger: img, start: 'top 80%', toggleActions: 'play none none reverse' },
          },
        )
      })
      ScrollTrigger.create({
        trigger: projectRef.current,
        start: 'top top',
        end: 'bottom bottom',
        onUpdate: (self) => {
          const v = 1 + self.progress * (imgs.length - 1)
          projectOdomRef.current?.raw(v)
          const intIdx = Math.round(self.progress * (imgs.length - 1))
          if (intIdx !== projectIdxRef.current) {
            projectIdxRef.current = intIdx
            setProjectIndex(intIdx)
          }
        },
      })
      const id = window.setTimeout(() => ScrollTrigger.refresh(), 350)
      return () => window.clearTimeout(id)
    }, projectRef)
    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, projectWork, projectImages.length])

  function openProject(work: Work) {
    setHoveredWork(null)
    setProjectWork(work)
    setInfoOpen(false)
    setView('project')
  }
  function closeProject() {
    setProjectWork(null)
    setView('main')
  }
  function goToProjectImage(i: number) {
    setProjectIndex(i)
    projectIdxRef.current = i
    lenisRef.current?.scrollTo(i * window.innerHeight, { duration: 1.2 })
  }

  // ── Nav bar ──────────────────────────────────────────────────────────
  function NavBar({ onClose }: { onClose?: () => void }) {
    return (
      <header
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px', height: 60, gap: 20,
          background: isDark ? 'rgba(8,8,8,0.88)' : 'rgba(254,254,254,0.88)',
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          borderBottom: `1px solid ${fg}14`,
        }}
      >
        <button
          onClick={() => { setView('main'); setInfoOpen(false) }}
          style={{ ...DISPLAY, fontSize: 13, color: fg, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.04em' }}
        >
          YOUR NAME
        </button>
        {!onClose && (
          <span className="nav-center" style={{ ...MONO, fontSize: 10, color: fg, opacity: 0.42, textAlign: 'center', flex: 1 }}>
            PHOTOGRAPHER AVAILABLE WORLDWIDE&nbsp;|&nbsp;BASED IN UK
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, whiteSpace: 'nowrap' }}>
          {onClose ? (
            <>
              {currentProjectImg && (
                <span style={{ ...MONO, fontSize: 10, color: fg, opacity: 0.45 }}>
                  {currentProjectImg.category.toUpperCase()} — {currentProjectImg.title}
                </span>
              )}
              <button onClick={onClose} style={{ ...MONO, fontSize: 11, color: fg, background: 'none', border: `1px solid ${fg}`, padding: '4px 10px', cursor: 'pointer' }}>[CLOSE]</button>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {(['overview', 'list'] as Mode[]).map((m) => (
                  <span key={m} style={{ display: 'flex', alignItems: 'center' }}>
                    <button onClick={() => { setMode(m); setInfoOpen(false) }} style={{ ...MONO, fontSize: 11, color: fg, background: 'none', border: 'none', cursor: 'pointer', opacity: mode === m && !infoOpen ? 1 : 0.32, padding: '0 2px' }}>{m.toUpperCase()}</button>
                    <span style={{ ...MONO, fontSize: 11, color: fg, opacity: 0.22, padding: '0 5px' }}>/</span>
                  </span>
                ))}
                <button onClick={() => setInfoOpen((v) => !v)} style={{ ...MONO, fontSize: 11, color: fg, background: 'none', border: 'none', cursor: 'pointer', opacity: infoOpen ? 1 : 0.32, padding: '0 2px' }}>INFO</button>
              </div>
              <a href="mailto:info@yourmail.com" style={{ ...MONO, fontSize: 10, color: fg, opacity: 0.45, textDecoration: 'none' }} onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')} onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}>INFO@YOURMAIL.COM</a>
              <button onClick={toggleTheme} title="Toggle theme" style={{ width: 22, height: 22, borderRadius: '50%', border: `1px solid ${fg}45`, background: 'none', cursor: 'pointer', color: fg, fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{isDark ? '○' : '●'}</button>
            </>
          )}
        </div>
      </header>
    )
  }

  function HoverPanel({ work }: { work: Work }) {
    const idx = WORKS.findIndex((w) => w.id === work.id) + 1
    return (
      <div style={{ position: 'fixed', bottom: 190, left: 40, zIndex: 500, background: bg, border: `1px solid ${fg}16`, padding: '18px 22px 14px', pointerEvents: 'none', width: 292, boxShadow: isDark ? '0 8px 52px rgba(0,0,0,0.75)' : '0 8px 52px rgba(0,0,0,0.10)', animation: 'panelIn 0.22s ease forwards' }}>
        <div style={{ ...DISPLAY, fontSize: 54, lineHeight: 1, color: fg, marginBottom: 7 }}>{String(idx).padStart(2, '0')}</div>
        <div style={{ ...DISPLAY, fontSize: 14, color: fg, marginBottom: 11, letterSpacing: '0.03em' }}>{work.title}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 14 }}>
          {([['AGENCY', work.agency], ['CLIENT', work.client], ['TYPE', work.type], ['YEAR', String(work.year)]] as [string, string][]).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 10 }}>
              <span style={{ ...MONO, fontSize: 9, color: fg, opacity: 0.36, minWidth: 48 }}>{k}</span>
              <span style={{ ...MONO, fontSize: 9, color: fg }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ ...MONO, fontSize: 10, color: fg, textAlign: 'right', borderTop: `1px solid ${fg}14`, paddingTop: 9 }}>[EXPLORE]</div>
      </div>
    )
  }

  return (
    <div style={{ background: bg, color: fg, minHeight: '100vh', transition: 'background 0.35s ease, color 0.35s ease' }}>
      <style>{`
        @keyframes panelIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .nav-center { display: flex !important; }
        @media (max-width: 1139px) { .nav-center { display: none !important; } }
      `}</style>

      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none', backgroundImage: NOISE, backgroundRepeat: 'repeat', backgroundSize: '200px 200px', opacity: 0.05 }} />

      <Cursor />

      {/* ── PRELOADER ─────────────────────────────────────────────────── */}
      {view === 'preloader' && (
        <div ref={preloaderRef} style={{ position: 'fixed', inset: 0, background: bg, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 20px 36px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ marginBottom: 4 }}><Chars text="YOUR NAME" charStyle={{ ...MONO, fontSize: 11, color: fg, opacity: 0.44 }} /></div>
              <div style={{ marginBottom: 4, whiteSpace: 'nowrap' }}><Chars text="PORTRAIT / STREET / TRAVEL" charStyle={{ ...MONO, fontSize: 11, color: fg, opacity: 0.44 }} /></div>
              <div style={{ marginBottom: 14, whiteSpace: 'nowrap' }}><Chars text="PHOTOGRAPHY / FOLIO '26" charStyle={{ ...MONO, fontSize: 11, color: fg, opacity: 0.44 }} /></div>
              <div style={{ overflow: 'hidden' }}><Chars text="YOUR NAME /" charStyle={{ ...DISPLAY, fontSize: 'clamp(44px, 6.8vw, 98px)', lineHeight: 0.9, color: fg }} /></div>
            </div>
            <div ref={counterRef} style={{ ...DISPLAY, fontSize: 'clamp(56px, 6.6vw, 95px)', lineHeight: 1, color: fg, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>000%</div>
          </div>
          <div ref={barRef} style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 1, background: fg, opacity: 0.22, transform: 'scaleX(0)', transformOrigin: 'left center' }} />
        </div>
      )}

      {/* ── MAIN ─────────────────────────────────────────────────────── */}
      {view === 'main' && (
        <>
          <NavBar />
          {hoveredWork && <HoverPanel work={hoveredWork} />}

          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 70, zIndex: 350, pointerEvents: 'none', background: `linear-gradient(to bottom, ${bg}, transparent)` }} />
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 220, zIndex: 350, pointerEvents: 'none', background: `linear-gradient(to top, ${bg} 45%, transparent)` }} />

          {mode === 'overview' &&
            (webglOk ? (
              <WebGLGallery
                getScroll={getScroll}
                isDark={isDark}
                onHover={setHoveredWork}
                onSlotIndex={(i) => footerOdomRef.current?.to(i)}
                onPick={openProject}
              />
            ) : (
              /* DOM masonry fallback (no WebGL / reduced motion) */
              <section style={{ paddingTop: 80, paddingBottom: 200, paddingLeft: 40, paddingRight: 40 }}>
                <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
                  {columns.map((colWorks, ci) => (
                    <div key={ci} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 28, marginTop: COL_OFFSETS[ci] }}>
                      {colWorks.map((work) => (
                        <div data-cursor key={work.id} style={{ aspectRatio: CSS_AR[work.shape], overflow: 'hidden', cursor: 'pointer', background: isDark ? '#141414' : '#e6e6e6', position: 'relative' }} onMouseEnter={() => setHoveredWork(work)} onMouseLeave={() => setHoveredWork(null)} onClick={() => openProject(work)}>
                          <img src={work.src} alt={work.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            ))}

          {mode === 'list' && (
            <div style={{ position: 'fixed', top: 60, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
              <div data-lenis-prevent style={{ display: 'flex', gap: 28, padding: '0 40px', overflowX: 'auto', height: '52vh' }}>
                {WORKS.map((work) => (
                  <div data-cursor key={work.id} style={{ flexShrink: 0, height: '100%', aspectRatio: '3 / 2', overflow: 'hidden', cursor: 'pointer', background: isDark ? '#141414' : '#e6e6e6', position: 'relative' }} onMouseEnter={() => setHoveredWork(work)} onMouseLeave={() => setHoveredWork(null)} onClick={() => openProject(work)}>
                    <img src={work.src} alt={work.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <div style={{ position: 'absolute', bottom: 8, left: 10, ...MONO, fontSize: 9, color: '#FEFEFE' }}>{String(WORKS.findIndex((w) => w.id === work.id) + 1).padStart(2, '0')}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Footer ───────────────────────────────────────────────── */}
          <footer style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 400, padding: '0 20px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <span style={{ ...MONO, fontSize: 12, color: fg, opacity: 0.38, paddingBottom: 6 }}>©2026</span>
              <span style={{ ...MONO, fontSize: 12, color: fg, opacity: 0.38, paddingBottom: 6, display: 'inline-flex', alignItems: 'flex-end' }}>
                [<Odometer ref={footerOdomRef} digits={2} digitStyle={{ ...MONO, fontSize: 12, color: fg, opacity: 1 }} />]
              </span>
            </div>
          </footer>

          {/* ── INFO overlay ──────────────────────────────────────────── */}
          {infoOpen && (
            <div data-lenis-prevent style={{ position: 'fixed', inset: 0, zIndex: 550, background: isDark ? 'rgba(8,8,8,0.97)' : 'rgba(254,254,254,0.97)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', padding: '80px 40px 200px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 52 }}>
                <div style={{ ...DISPLAY, fontSize: 'clamp(48px, 6.8vw, 98px)', lineHeight: 0.9, color: fg }}>Info</div>
                <button onClick={() => setInfoOpen(false)} style={{ ...MONO, fontSize: 11, color: fg, background: 'none', border: `1px solid ${fg}`, padding: '4px 10px', cursor: 'pointer', marginTop: 10 }}>[CLOSE]</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, maxWidth: 860 }}>
                <div>
                  <div style={{ ...MONO, fontSize: 10, color: fg, opacity: 0.4, marginBottom: 5 }}>LOCAL TIME</div>
                  <div style={{ ...DISPLAY, fontSize: 28, color: fg, marginBottom: 36, fontVariantNumeric: 'tabular-nums' }}>{clock}</div>
                  <div style={{ ...MONO, fontSize: 10, color: fg, opacity: 0.4, marginBottom: 5 }}>CONTACT</div>
                  <a href="mailto:info@yourmail.com" style={{ ...DISPLAY, fontSize: 20, color: fg, textDecoration: 'none', display: 'block', marginBottom: 36, borderBottom: `1px solid ${fg}`, paddingBottom: 8 }}>INFO@YOURMAIL.COM</a>
                  <div style={{ ...MONO, fontSize: 10, color: fg, opacity: 0.4, marginBottom: 6 }}>BASED IN</div>
                  <div style={{ ...MONO, fontSize: 12, color: fg, marginBottom: 36 }}>LONDON, UK</div>
                  <div style={{ display: 'flex', gap: 24 }}>
                    {['INSTAGRAM', 'TWITTER', 'LINKEDIN'].map((s) => (<span key={s} data-cursor style={{ ...MONO, fontSize: 10, color: fg, opacity: 0.38, cursor: 'pointer' }}>{s}</span>))}
                  </div>
                </div>
                <div style={{ width: '100%', aspectRatio: '3/4', background: isDark ? '#181818' : '#efefef', overflow: 'hidden' }}>
                  <img src={`${UB}/photo-1633381521050-26bb467d9d5a?w=600&h=800&fit=crop&auto=format`} alt="Photographer portrait" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.82 }} />
                </div>
              </div>
              <div style={{ position: 'absolute', bottom: 20, left: 40, display: 'flex', gap: 24 }}>
                {['PRIVACY POLICY', 'COOKIE POLICY'].map((l) => (<span key={l} style={{ ...MONO, fontSize: 9, color: fg, opacity: 0.28, cursor: 'pointer' }}>{l}</span>))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── PROJECT ──────────────────────────────────────────────────── */}
      {view === 'project' && projectWork && (
        <>
          <NavBar onClose={closeProject} />
          <div style={{ position: 'fixed', top: 76, left: 20, zIndex: 500 }}>
            {([['CATEGORY', projectWork.category.toUpperCase()], ['AGENCY', projectWork.agency], ['CLIENT', projectWork.client], ['TYPE', projectWork.type], ['YEAR', String(projectWork.year)]] as [string, string][]).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 14, marginBottom: 3 }}>
                <span style={{ ...MONO, fontSize: 9, color: fg, opacity: 0.38, minWidth: 68 }}>{k}</span>
                <span style={{ ...MONO, fontSize: 9, color: fg }}>{v}</span>
              </div>
            ))}
          </div>
          <div ref={projectRef}>
            {projectImages.map((img) => (
              <div key={img.id} style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', background: bg }}>
                <img className="project-img" src={img.src} alt={img.title} style={{ maxWidth: '85vw', maxHeight: '82vh', objectFit: 'contain', display: 'block', background: isDark ? '#111' : '#efefef' }} />
                <div style={{ position: 'absolute', bottom: 24, left: 24, ...MONO, fontSize: 9, color: fg, opacity: 0.38 }}>{img.title} — {img.year}</div>
              </div>
            ))}
          </div>
          <div style={{ position: 'fixed', right: 20, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 7, zIndex: 700 }}>
            {projectImages.map((_, i) => (
              <button key={i} onClick={() => goToProjectImage(i)} style={{ width: i === projectIndex ? 20 : 10, height: 1, background: fg, border: 'none', padding: 0, cursor: 'pointer', opacity: i === projectIndex ? 1 : 0.22, transition: 'width 0.22s ease, opacity 0.22s ease', display: 'block' }} />
            ))}
          </div>
          <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 700, ...DISPLAY, fontSize: 'clamp(48px, 6vw, 90px)', lineHeight: 1, color: fg, fontVariantNumeric: 'tabular-nums' }}>
            <Odometer ref={projectOdomRef} digits={3} digitStyle={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 'clamp(48px, 6vw, 90px)', lineHeight: 1, color: fg }} />
          </div>
        </>
      )}
    </div>
  )
}
