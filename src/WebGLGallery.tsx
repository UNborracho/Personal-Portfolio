import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ForwardedRef,
} from "react"
import * as THREE from "three"
import gsap from "gsap"
import { shuffled, type WallPhoto } from "./shared"
import { WALL_SEED, INTRO_EXPLODE, bootFlags } from "./gallery-flags"
import {
  createSharedUniforms,
  makeDispTex,
  patchMaterial,
  unisOf,
} from "./gallery/shaders"
import {
  SLOT_COUNT,
  NUM_CYCLES,
  GAP,
  SIDE_MARGIN,
  FOV,
  HOVER_HOLD,
  boundW,
  ncolsFor,
  computeLayout,
  stripW,
  wrapCoordOf,
  type Layout,
} from "./gallery/layout"

/** Deterministic wall seed + intro flags live in ./gallery-flags
 *  (kept free of three imports so App can read them without pulling
 *  this chunk — it is dynamically imported only when webglOk). */

export interface GalleryHandle {
  /** RP info-exit re-enter (invoked by App when #/info closes): the
   *  info layer has already faded itself out (1s power4.out — RP's
   *  contact close). Teleport the hidden wall to top, park every plane
   *  at the return park (+1.2vw overview / +vw list), run the
   *  enter-only one-clock morph, and pop the canvas + chrome the
   *  instant the flight begins (RP home-remount semantics). */
  restoreFromInfo: (onRestored?: () => void) => void
  /** Feed the engine the ALREADY-DECODED intro images (thumb → <img>).
   *  Textures for the boot lap are built from THESE elements — no second
   *  network round trip, so the three side can never lag the curtain's
   *  preloader (Safari straggler class eliminated at the root). */
  setDecodedImages: (imgs: Map<string, HTMLImageElement>) => void
  /** RP info ENTRY (decompiled layout.js @29048, onClick "/contact"):
   *  fade the canvas out 0.5s power4.in BEFORE the route flips — App
   *  chains nav(`${base}/info`) in the promise's resolve. Takes canvas
   *  ownership up-front so the active-prop effect can't fight the fade
   *  when the route lands. (The hard-cut mount-window path in RP is a
   *  first-load special case, not the interaction path.) */
  fadeOutForInfo: () => Promise<void>
  /** RP intro entrance (decompiled lazy816.js boot + `l` timeline):
   *  the boot parked every photo dead-center as a 150px stack (parkStack)
   *  — the stack now EXPLODES outward into the lattice on RP's one clock
   *  (position 1.4s power3.inOut, sequential pop hero-first, 0.05s
   *  stagger, chained scale/uResolution), with the hero photo's liquid
   *  wobble (uAnim 0→.9→0, .45s sine.inOut ramps). Invoked by App when
   *  the loading curtain starts to clear — flight and curtain-fade run
   *  concurrently, exactly like richardprescott.com's load. */
  introFlyIn: () => void
  /** Synchronously finish every pending GPU texture upload (initTexture)
   *  — the intro beat calls this on entry so the explode flight never
   *  races a texImage2D+mipmap stall. Cost (a few ms) lands inside the
   *  1.3s still beat where nobody can see it. */
  flushTextures: () => void
  /** True when every boot-lap plane has its texture BOUND (no pending
   *  `want`). RP's equivalent is <Suspense> — a photo never mounts
   *  before its texture exists; the intro beat must not launch while
   *  any plane would fly as an empty quad (Safari: three-side loads can
   *  lag the Image preloads — stragglers rebounding mid-flight was the
   *  post-explode flicker). */
  isBootReady: () => boolean
}

interface Props {
  // view activity: false → canvas fades out + spacer collapses (scroll
  // dies) while staying MOUNTED. Live in BOTH overview and list (the
  // filmstrip is in-canvas too); false only for project/info.
  // (The INFO route is the exception — see infoOpen below: hard cut.)
  active: boolean
  // #/info is active — the canvas is hard-hidden (RP opacity:0/duration:0)
  // instead of fading, and the exit restore is glide-then-hard-pop.
  infoOpen: boolean
  // layout mode: false = vertical conveyor (overview), true = horizontal
  // filmstrip row (list). Mode flips while active trigger the RP view
  // transition (ONE clock: exits fly to the nearest edge immediately,
  // entrants revive at the right-edge park and fly in — see
  // startViewTransition).
  listMode: boolean
  // filtered photo pool for the current category (identity changes on cat
  // switch → the conveyor re-seeds without touching the WebGL context)
  pool: WallPhoto[]
  isDark: boolean
  onHover: (w: WallPhoto | null) => void
  /** position inside the current lap (1-based) → footer odometer */
  onSeq: (n: number) => void
  /** fired when an overview re-seed resets the virtual wall to top
   *  (hash cat change / re-seed) — App syncs page scroll + odometer */
  onResetScroll?: () => void
  onPick: (w: WallPhoto) => void
}

function WebGLGallery(
  {
    active,
    infoOpen,
    listMode,
    pool,
    isDark,
    onHover,
    onSeq,
    onResetScroll,
    onPick,
  }: Props,
  ref: ForwardedRef<GalleryHandle>,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const listModeRef = useRef(listMode)
  listModeRef.current = listMode
  const layoutRef = useRef<Layout>(
    computeLayout(window.innerWidth, window.innerHeight),
  )
  const [cycleH, setCycleH] = useState(() => layoutRef.current.cycleH)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const setPoolRef = useRef<((p: WallPhoto[]) => void) | null>(null)

  // stable callback refs (so the mount effect never re-runs)
  const cbRef = useRef({ onHover, onSeq, onPick, onResetScroll })
  cbRef.current = { onHover, onSeq, onPick, onResetScroll }

  // ── info transition state (RP replication) ──────────────────────────
  // infoCanvas: the info choreography owns the canvas opacity (hard cut
  //   in, glide-then-pop out) — the generic active fade stands aside.
  // hiddenGlide: an info-exit wallY glide is in flight (canvas hidden);
  //   user input is dead and the activation-edge reset must not stomp it.
  const infoCanvasRef = useRef(false)
  const hiddenGlideRef = useRef(false)
  const restoreImplRef = useRef<((onRestored?: () => void) => void) | null>(
    null,
  )
  const introFlyImplRef = useRef<(() => void) | null>(null)
  const flushTexturesImplRef = useRef<(() => void) | null>(null)
  const isBootReadyImplRef = useRef<(() => boolean) | null>(null)
  const setDecodedImagesImplRef = useRef<((
    imgs: Map<string, HTMLImageElement>,
  ) => void) | null>(null)
  const cancelImplRef = useRef<(() => void) | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      restoreFromInfo: (onRestored) => {
        const impl = restoreImplRef.current
        if (impl) impl(onRestored)
        else onRestored?.() // engine not up yet — nothing to glide
      },
      fadeOutForInfo: () =>
        new Promise<void>((resolve) => {
          const c = canvasRef.current
          if (!c || !activeRef.current) {
            resolve() // engine not up / canvas already hidden — flip now
            return
          }
          infoCanvasRef.current = true
          gsap.killTweensOf(c)
          gsap.to(c, {
            opacity: 0,
            duration: 0.5,
            ease: "power4.in",
            onComplete: () => resolve(),
          })
        }),
      introFlyIn: () => {
        // engine not up yet → the wall is still blank; App's curtain fade
        // alone reveals it (photos then bind with their own first-load
        // fades — the pre-engine fallback)
        introFlyImplRef.current?.()
      },
      flushTextures: () => {
        flushTexturesImplRef.current?.()
      },
      isBootReady: () =>
        // engine not up / masonry fallback → nothing to wait for
        isBootReadyImplRef.current?.() ?? true,
      setDecodedImages: (imgs) => {
        setDecodedImagesImplRef.current?.(imgs)
      },
    }),
    [],
  )

  const hoveredKeyRef = useRef<string | null>(null)
  const disposedRef = useRef(false)

  // ── Mount: set up Three.js + RAF (runs once) ─────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!
    disposedRef.current = false

    const vw = window.innerWidth
    // touch detection lives up here — renderer/DPR and the texture cache
    // both branch on it (declared later would be a TDZ error)
    const isCoarse = window.matchMedia("(pointer: coarse)").matches
    // conveyor prefetch window: photos the wall will bind within the next
    // ~2 wraps — kept warm so scroll-time binds are always cache hits
    const PREFETCH = 12
    const vh = window.innerHeight

    const renderer = new THREE.WebGLRenderer({
      canvas,
      // no MSAA: the wall is axis-aligned photo quads — there are no
      // geometric edges to alias, but the MSAA buffer costs real bandwidth
      // at DPR2 (and it did not survive the perf budget on mobile)
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    })
    // Photos ARE the content — DPR 1.5 was visibly soft on 3× phones
    // (compositor upscale 2×). DPR 3 fills 23M px/frame on mid-range GPUs
    // and re-introduced scroll jank. 2 is the balance: 1.5× upscale of
    // natural photos is near-invisible, fill rate stays sane. Bump to 3
    // only on flagships if sharpness still feels short.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(vw, vh)
    renderer.setClearColor(isDark ? 0x080808 : 0xfefefe, 1)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(FOV, vw / vh, 1, 10000)
    const setCam = (w: number, h: number) => {
      camera.aspect = w / h
      camera.position.z = h / 2 / Math.tan((FOV / 2) * (Math.PI / 180))
      camera.updateProjectionMatrix()
    }
    setCam(vw, vh)

    // 16×16 segments: the bend/curl/breath displacements live in the
    // vertex shader, so each photo needs a real vertex GRID — a 1-segment
    // plane (4 verts) can only linearly interpolate the cos() profile,
    // which reads as rigid slabs sliding in z ("长方体形变"), not as a
    // curved surface. 289 verts × 36 planes ≈ 10k verts — negligible.
    const geo = new THREE.PlaneGeometry(1, 1, 16, 16)
    const loader = new THREE.TextureLoader()
    // thumb URL → texture (null while loading). Survives pool switches.
    const texCache = new Map<string, THREE.Texture | null>()

    // ── texture cache: LRU with idle-time GPU pre-upload ──────────────
    // Textures lazy-upload to the GPU on first draw; letting that happen
    // mid-scroll (wrap rebinds) caused periodic hitches (960px textures =
    // 2.4MB + mipmaps per upload). We (a) cap residency so mobile unified
    // memory stays bounded, (b) pre-upload new textures at idle, (c)
    // prefetch the photos the conveyor will need next — so binding
    // mid-scroll is always a cache hit.
    const MAX_TEX = isCoarse ? 40 : 64
    const texAge = new Map<string, number>()
    let texClock = 0
    const warnedTex = new Set<string>() // dedupe per-key load warnings
    // GPU upload scheduler — drains INSIDE the render loop, throttled by
    // scroll activity. (The previous idle-callback approach fell back to
    // setTimeout(0) in WeChat/iOS webviews without requestIdleCallback,
    // firing 3MB uploads mid-scroll — that was the mobile jank.)
    const uploadQueue: THREE.Texture[] = []
    let lastScrollActivity = performance.now()
    const queueUpload = (tex: THREE.Texture) => {
      if (disposedRef.current || uploadQueue.includes(tex)) return
      uploadQueue.push(tex)
    }
    const drainUploads = (scrolling: boolean) => {
      if (disposedRef.current || !uploadQueue.length) return
      // mid-transition (view morph / requeue / intro explode): uploads
      // WAIT — a multi-ms texImage2D stall inside a flight is a dropped
      // frame; late textures drain after the landing (the plane keeps
      // its old photo meanwhile — no visual hole)
      if (transitioning > 0) return
      // during scroll: at most 1 upload per frame (prefetch keeps the queue
      // near-empty in steady state); when idle: 2/frame to catch up fast
      const n = scrolling ? 1 : 2
      for (let i = 0; i < n && uploadQueue.length; i++) {
        renderer.initTexture(uploadQueue.shift()!)
      }
    }

    // ── conveyor state ─────────────────────────────────────────────────
    let poolArr: WallPhoto[] = []
    let pendingPool: WallPhoto[] | null = null // deferred across mode edges
    let N = 1
    let seq: WallPhoto[] = []
    let nextIdx = 0 // photos handed out so far (starts at active slots)
    let lastLap = 0
    let suppressWrap = 0 // frames to ignore wrap jumps (pool/scroll resets)
    let lastNcols = ncolsFor(window.innerWidth)

    // ── RP-replication shader foundation ─────────────────────────────
    // (types + GLSL patch live in ./gallery/shaders — shared material
    //  pipeline, per-plane uniform bundle, displacement texture)
    const shared = createSharedUniforms(vw, vh)
    const dispTex = makeDispTex()
    shared.uDispMap.value = dispTex
    const planes: THREE.Mesh[] = []
    for (let i = 0; i < SLOT_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: null,
        transparent: false,
        // RP EXACT (decompiled lazy816.js shaderMaterial args): depth
        // writes OFF + polygonOffset -5 — occlusion is draw-order, never
        // depth. With depthWrite:true, a flying plane whose z sweeps
        // through a stack plane's z (0.01 apart) while x/y overlap hits
        // exact coplanarity for a frame or two → z-fight shimmer (the
        // per-pop 轻微闪烁, visible in Safari). This flag pair makes the
        // class structurally impossible — same reason RP never flickers.
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        opacity: 0,
        color: 0xffffff,
      })
      patchMaterial(mat, shared)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.visible = false
      mesh.userData = {
        slot: i,
        wp: null,
        want: null,
        ar: 1,
        lastY: 0,
        lastX: 0,
      }
      scene.add(mesh)
      planes.push(mesh)
    }

    const evictIfNeeded = () => {
      while (texCache.size > MAX_TEX) {
        // bound keys, as a Set, built once per call (was a
        // planes.some(...) probe per candidate — O(P×planes) per sweep)
        const bound = new Set<string>()
        for (const m of planes) {
          const w = m.userData.wp as WallPhoto | null
          if (w) bound.add(w.photo.thumb)
        }
        // oldest entry that is not currently bound to a visible plane
        let oldestKey: string | null = null
        let oldestAge = Infinity
        for (const [k, t] of texCache) {
          if (!t) continue // still loading
          if (bound.has(k)) continue
          const age = texAge.get(k) ?? Infinity
          if (age < oldestAge) {
            oldestAge = age
            oldestKey = k
          }
        }
        if (oldestKey === null) break // all resident are in use
        texCache.get(oldestKey)?.dispose()
        texCache.delete(oldestKey)
        texAge.delete(oldestKey)
      }
    }

    // prefetch upcoming conveyor photos so wraps are always cache hits.
    // Throttled while the intro curtain owns the pipe: the boot lap's
    // preload list is still downloading, and 12 parallel engine fetches
    // steal bandwidth from exactly the photos the counter waits on
    // (adds seconds to the curtain on slow links). introLocked lifts at
    // explode+2s / first input — same gate, same window.
    const prefetch = () => {
      if (introLocked) return
      if (!seq.length) return
      for (let k = 0; k < PREFETCH; k++) {
        ensureTex(seq[(nextIdx + k) % N])
      }
    }

    // ── intro anti-flicker architecture (plan A) ─────────────────
    // 1) imgCache: the curtain preloader's ALREADY-DECODED <img> elements.
    //    Boot-lap textures are built from these directly — no second
    //    fetch, so three can never lag the preloader (Safari stragglers
    //    were the post-explode flicker; the whole class dies here).
    // 2) introLocked: from mount until the explode lands +2s (or first
    //    user input) a VISIBLE plane may never swap its photo — swap
    //    requests are DROPPED (the wall keeps whatever it is showing).
    //    Fills (map===null → photo) still pass: a fill cannot flash.
    //    This holds even for code paths nobody has found yet.
    const imgCache = new Map<string, HTMLImageElement>()
    let introLocked = true
    // texture config quartet shared by both load paths (decoded-
    // source <img> and TextureLoader network loads) — sRGB + mips +
    // anisotropy so every photo on the wall samples identically
    const configureTex = (tex: THREE.Texture) => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.generateMipmaps = true
      tex.minFilter = THREE.LinearMipmapLinearFilter
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
    }
    const texFromImage = (img: HTMLImageElement) => {
      const tex = new THREE.Texture(img)
      configureTex(tex)
      tex.needsUpdate = true
      return tex
    }
    setDecodedImagesImplRef.current = (imgs) => {
      for (const [k, img] of imgs) if (!imgCache.has(k)) imgCache.set(k, img)
      // satisfy every pending want that now has a decoded source —
      // synchronously, before any beat can launch
      for (const m of planes) {
        const wpt = m.userData.want as WallPhoto | null
        if (wpt && imgCache.has(wpt.photo.thumb)) ensureTex(wpt)
      }
    }

    // straggler handoff: a texture just arrived for `key` — bind every
    // plane waiting on it (preserve the crossfade stagger it was
    // assigned — late arrivals fade too, instead of popping in fully
    // opaque). Boot-stack case: the texture arrived while the intro
    // curtain is still up — the plane joins the center stack (150px
    // square) instead of popping in at its lattice slot.
    const handoff = (key: string) => {
      for (const m of planes) {
        if (
          m.userData.want &&
          (m.userData.want as WallPhoto).photo.thumb === key
        ) {
          bindPlane(m, m.userData.want as WallPhoto)
          if (bootParked) parkOne(m)
        }
      }
    }
    const ensureTex = (wp: WallPhoto) => {
      const key = wp.photo.thumb
      if (texCache.has(key)) {
        texAge.set(key, texClock++) // LRU touch
        return
      }
      // decoded-source path (no network at all — see imgCache above)
      const img = imgCache.get(key)
      if (img && img.complete && img.naturalWidth > 0) {
        const tex = texFromImage(img)
        texCache.set(key, tex)
        texAge.set(key, texClock++)
        queueUpload(tex)
        evictIfNeeded()
        handoff(key)
        return
      }
      texCache.set(key, null) // loading marker
      texAge.set(key, texClock++)
      loader.load(
        key,
        (tex) => {
          if (disposedRef.current) {
            tex.dispose()
            return
          }
          configureTex(tex)
          texCache.set(key, tex)
          queueUpload(tex) // GPU upload at idle, not mid-scroll
          evictIfNeeded()
          handoff(key)
        },
        undefined,
        (err) => {
          // failed thumb: drop the loading marker so a later rebind can
          // retry (transient network blips recover); the plane keeps its
          // previous photo meanwhile. Warn once per key (R4: failures must
          // surface — a permanently-blank slot with a silent console is
          // how the intro-blank bug hid for a whole afternoon).
          texCache.delete(key)
          texAge.delete(key)
          if (!warnedTex.has(key)) {
            warnedTex.add(key)
            console.warn("[wall] thumb failed:", key, err)
          }
        },
      )
    }

    // Opaque in steady state (transparent only during the load fade-in).
    // Occlusion is DRAW ORDER (renderOrder), not depth: materials use
    // RP's depthWrite:false + polygonOffset:-5 — coplanar moments during
    // flights can never z-fight (the Safari per-pop shimmer fix).
    // ── transition state machine ──────────────────────────────
    // `transitioning` counts in-flight texture fade-ins (first fill);
    // it gates the render loop. The per-cell dissolve (fade-out → blank
    // → fade-in) was RETIRED in Phase 4 — list filter switches are now a
    // spatial requeue and overview hash-switches re-seed instantly (RP's
    // overview has no filter UI; the dissolve was dead code).
    let transitioning = 0 // active fade tweens
    // ── Phase 4: spatial requeue state (list filter switch) ─────
    // requeuing: a requeue wave owns plane transforms; the tick loop,
    // wrap rebinds, hover raycast and input all stand aside.
    let requeuing = false
    // generation counter: invalidates stale delayedCalls (leaver parks,
    // borrowed-carrier parks) when a newer wave supersedes — a stale park
    // could hide/rebind a plane the new wave already reclassified
    let requeueGen = 0
    let requeueTimer = 0
    // strip roster: rowPlanes[i] is the plane currently carrying row slot
    // i (requeue swaps carriers in — membership ≠ plane index). rowWp[i]
    // is the photo DEFINING slot i's size; frozen through wraps (slot
    // geometry is constant, CoverUV crops incoming photos into it).
    let rowPlanes: THREE.Mesh[] = []
    let rowWp: (WallPhoto | null)[] = []
    let rowSeeded = false // row live once → later pool changes requeue
    const killRequeue = () => {
      if (requeueTimer) {
        window.clearTimeout(requeueTimer)
        requeueTimer = 0
      }
      if (!requeuing) return
      requeuing = false
      requeueGen++ // stale parks from THIS wave must not fire
      for (const m of planes) {
        gsap.killTweensOf(m.position)
        gsap.killTweensOf(m.scale)
        const mat = m.material as THREE.MeshBasicMaterial
        // opacity fade tweens (RP filter-switch fade-out): kill them too,
        // then restore hygiene — a killed mid-fade leaves a translucent
        // plane forever. ONSCREEN planes keep their partial opacity (a
        // fresh requeue refades from there — continuous, no pop); only
        // parked-invisible planes snap back to opaque 1 so their next
        // reuse renders fully (bindPlane's same-tex path touches nothing)
        gsap.killTweensOf(mat)
        if (!m.visible && mat.opacity !== 1) {
          mat.opacity = 1
          mat.transparent = false
        }
        const unis = unisOf(m)
        gsap.killTweensOf(unis.uResolution.value)
        // ripple breath tween: killed mid-wave it would freeze uAnim at
        // its half-value (planes stuck mid-ripple) — kill AND zero
        gsap.killTweensOf(unis.uAnim)
        unis.uAnim.value = 0
      }
    }
    const killTransition = () => {
      killRequeue()
      for (const m of planes)
        gsap.killTweensOf(m.material as THREE.MeshBasicMaterial)
      transitioning = 0
    }

    // ── RP hover liquid-melt (Phase 6) ──────────────────────────
    // uHover ramps 0→1 over 1.2s expo.out on hover, 1→0 on leave — one
    // tween per hovered PLANE (never a broadcast); a kill restarts from
    // the CURRENT mid-value, so re-hovering continues smoothly in either
    // direction. The old hover-dim (0x888888) was removed: the melt IS
    // the hover feedback now.
    // NOTE prefers-reduced-motion: unreachable here in practice — App's
    // useWebGLOk falls back to DOM masonry under reduce — but pinned to 0
    // as belt-and-braces (no melt, panel-only feedback).
    const REDUCED = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches
    let hoverPlane: THREE.Mesh | null = null
    const meltTo = (m: THREE.Mesh, v: number) => {
      if (REDUCED) return snapMelt(m)
      const unis = unisOf(m)
      gsap.killTweensOf(unis.uHover) // new tween starts from current value
      gsap.to(unis.uHover, { value: v, duration: 1.2, ease: "expo.out" })
    }
    const snapMelt = (m: THREE.Mesh) => {
      const unis = unisOf(m)
      gsap.killTweensOf(unis.uHover)
      unis.uHover.value = 0
    }

    // load fade-in tween shared by both bindPlane fade paths (first
    // fill + swap fuse): starts fully hidden, fades to opaque on the
    // given clock, then hands the plane back to opaque draw state.
    // `transitioning` counts these in-flight fades — it gates the
    // render loop's idle path.
    const fadeIn = (
      mat: THREE.MeshBasicMaterial,
      dur: number,
      ease: string,
    ) => {
      gsap.killTweensOf(mat)
      mat.transparent = true
      mat.opacity = 0 // cell was blank / mid-swap — start fully hidden
      transitioning++
      gsap.to(mat, {
        opacity: 1,
        duration: dur,
        ease,
        onComplete: () => {
          mat.transparent = false
          transitioning--
        },
      })
    }

    const bindPlane = (
      mesh: THREE.Mesh,
      wp: WallPhoto,
      instant = false, // offscreen rebinds (requeue/view-transition parks):
      // skip every fade — RP revives photos at full opacity instantly
    ) => {
      const tex = texCache.get(wp.photo.thumb)
      if (!tex) {
        mesh.userData.want = wp // try again when the texture arrives
        ensureTex(wp)
        return
      }
      mesh.userData.want = null
      mesh.userData.wp = wp
      mesh.userData.ar = wp.photo.w / wp.photo.h
      // cache the overview slot's bound width for this photo (boundW is
      // pure per-slot math that only changes on rebind / relayout — the
      // tick reads mesh.userData.bw instead of recomputing per frame)
      const slCur = layoutRef.current.slots[(mesh.userData.slot as number)]
      mesh.userData.bw =
        slCur !== undefined
          ? boundW(slCur.w, wp.photo.w / wp.photo.h, layoutRef.current.pitch)
          : undefined
      const mat = mesh.material as THREE.MeshBasicMaterial
      const prevMap = mat.map // BEFORE the swap — the fuse below compares it
      const firstLoad = prevMap === null
      // intro anti-flicker invariant: while introLocked, a VISIBLE plane
      // never swaps photos (fills pass — an empty→photo bind can't flash;
      // visible swaps are DROPPED so the wall keeps what it shows). Even
      // an unknown rebind path cannot change photos in the window.
      if (introLocked && !firstLoad && mesh.visible) {
        mesh.userData.want = null // drop the swap entirely
        return
      }
      mat.map = tex
      mat.needsUpdate = true
      mesh.visible = true
      // cover-fit math needs the texture's own aspect ratio
      const unis = unisOf(mesh)
      unis.uImageRes.value.x = wp.photo.w
      unis.uImageRes.value.y = wp.photo.h
      // hover-melt hygiene on rebind: the hovered plane keeps its melt
      // only if the SAME photo lands back on it (requeue survivor /
      // duplicate-key wrap); anything else hands the melt back — and a
      // non-hovered plane can never inherit a stale mid-melt value
      if (mesh === hoverPlane) {
        if (wp.photo.thumb !== hoveredKeyRef.current) setHover(null, null)
      } else {
        snapMelt(mesh)
      }
      if (instant) {
        // offscreen park: no fade, no fuse — uOpacity 1 the moment it
        // revives (RP: `visible=true, uOpacity.value=1` is instantaneous)
        gsap.killTweensOf(mat)
        mat.transparent = false
        mat.opacity = 1
      } else if (firstLoad) {
        // fade in on first fill only; wrap/requeue rebinds keep full
        // opacity (the spatial choreography owns the transition)
        fadeIn(mat, 0.45, "power2.inOut")
      } else if (prevMap !== tex) {
        // texture SWAP (rebind to a different photo while visible):
        // micro crossfade as a timing-hole fuse — even if a future path
        // rebinds onscreen, the photo morphs softly instead of flashing
        // (the 残影 bug class). Invisible in the choreographed paths:
        // those rebind offscreen, where a 0.15s fade is imperceptible.
        fadeIn(mat, 0.15, "power1.inOut")
      } else {
        gsap.killTweensOf(mat)
        mat.transparent = false
        mat.opacity = 1
      }
    }

    const applyLayout = (w: number, h: number) => {
      // resize mid-requeue: kill the wave and snap to the target layout
      // (spec: never re-fly after a resize)
      if (listModeRef.current && requeuing) {
        killRequeue()
        seedRow()
      }
      const changed = ncolsFor(w) !== lastNcols
      lastNcols = ncolsFor(w)
      layoutRef.current = computeLayout(w, h)
      setCycleH(layoutRef.current.cycleH)
      // slot widths / pitch changed → the per-plane boundW cache is stale
      for (const m of planes) m.userData.bw = undefined
      // curtain bend math is normalized by the viewport size in world units
      shared.uViewport.value.x = w
      shared.uViewport.value.y = h
      // crossing a column breakpoint → re-seed (fresh aspect spread + the
      // planes that were hidden beyond the old slot count need binding)
      if (changed) {
        if (listModeRef.current) seedRow()
        else seedPool()
      } else if (listModeRef.current) {
        // resize inside the strip: widths follow the new colW, positions
        // re-place; no wrap-state corruption (re-capture next frames)
        computeListLayout()
        suppressWrap = 3
      }
    }

    // (re)bind every active slot from the lap-0 sequence — INSTANT.
    // (The per-cell dissolve was removed in Phase 4: RP's overview has
    // no filter UI, so a cat change here only ever comes from the hash —
    // an instant re-seed is the honest response.)
    // ── RP boot stack (desktop overview intro) ──────────────────
    // During load every photo sits dead-center as a ~150px square
    // (decompiled boot branch: set position (0,0) + scale 150px +
    // uProgress .2, hero renderOrder 1 on top). introFlown flips on
    // the first view morph (intro fly-in OR an early route change);
    // bootParked gates the tick so it doesn't snap the stack back to
    // the lattice while the loader is up.
    let bootParked = false
    let introFlown = false
    // stack ONE plane at the center (shared by parkStack and the
    // late-texture straggler path in ensureTex)
    // scale + cover-fit ratio move TOGETHER (uResolution must mirror the
    // plane's onscreen size or CoverUV crops wrong) — one invariant, one
    // helper, every site that sizes a plane
    const setSize = (m: THREE.Mesh, w: number, h: number) => {
      m.scale.set(w, h, 1)
      const res = unisOf(m).uResolution.value
      res.x = w
      res.y = h
    }

    // NaN sentinels force the wrap detection to re-capture cleanly when
    // layout resumes (NaN never compares true → no phantom rebind) —
    // shared by wave completions and parks
    const nanXY = (m: THREE.Mesh) => {
      m.userData.lastX = NaN
      m.userData.lastY = NaN
    }

    const parkOne = (m: THREE.Mesh) => {
      const count = layoutRef.current.count
      const i = planes.indexOf(m)
      if (i < 0 || i >= count) return
      // RP's stack square is 150 SCREEN PIXELS (150/v.factor in drei
      // viewport units). Our world units ARE pixel-scaled — so 150, not
      // 0.15 (an earlier misread made the whole stack sub-pixel DUST:
      // the handoff showed a blank center — the 闪烁 root cause).
      // z flips per-index so index 0 (hero) is CLOSEST to the camera —
      // the visible stack top (i*0.001 put seq[35] on top instead).
      // renderOrder mirrors it (higher = drawn later = on top): with
      // depthWrite:false occlusion IS draw order — deterministic stack
      m.position.set(0, 0, (count - i) * 0.01)
      m.renderOrder = count - i
      setSize(m, 150, 150)
      nanXY(m)
    }
    const parkStack = () => {
      const L = layoutRef.current
      for (let i = 0; i < L.count; i++) {
        const m = planes[i]
        if (m.visible) parkOne(m)
      }
      bootParked = true
    }

    // RP return-mount park (lazy816.js @14393, started!=0 branch):
    // every plane parks at +1.2×viewport RIGHT (offscreen) — the
    // activation edge then flies the lattice in on the enter-only one
    // clock. Parks at the slot's OWN size (bindPlane already set ar):
    // the morph then flies position only. bootParked gates the tick
    // until the transition takes over, exactly like the intro stack.
    const parkReturnMount = () => {
      const L = layoutRef.current
      for (let i = 0; i < L.count; i++) {
        const m = planes[i]
        if (!m.visible) continue
        const sl = L.slots[i]
        const arv = m.userData.ar as number
        const w = boundW(sl.w, arv, L.pitch)
        m.position.set(1.2 * window.innerWidth, 0, 0)
        setSize(m, w, w / arv)
        nanXY(m)
      }
      bootParked = true
    }

    const seedPool = () => {
      killTransition()
      viewTrans?.kill()
      N = Math.max(1, poolArr.length)
      seq = shuffled(poolArr, WALL_SEED) // lap 0 — matches the preloader's list
      const L = layoutRef.current
      nextIdx = L.count
      lastLap = 0
      suppressWrap = 3 // scroll resets to 0 → ignore the position jump
      wallY = 0
      killResetTween()
      for (let i = 0; i < SLOT_COUNT; i++) {
        // collage lattice: only `count` slots exist — planes beyond stay
        // hidden (mobile keeps its texture-LRU headroom)
        if (i < L.count) bindPlane(planes[i], seq[i % N])
        else planes[i].visible = false
      }
      rowWp = seq.slice(0, L.count)
      planes.forEach((m) => {
        m.userData.inRow = false
        m.userData.rowIdx = undefined
      })
      // desktop overview boot: first load parks the center stack (the
      // intro reveal explodes it); a REMOUNT (project close / reload
      // into #/p/…) takes RP's return-visit branch instead — park at
      // +1.2vw right and let the activation edge fly the wall in. The
      // curtain only fires once per page load (bootFlags, module scope).
      if (INTRO_EXPLODE && !introFlown && !listModeRef.current) {
        if (bootFlags.curtainFlown) {
          parkReturnMount()
          pendingOverviewEnter = true
        } else {
          parkStack()
        }
      }
      prefetch()
      cbRef.current.onSeq(1)
      cbRef.current.onResetScroll?.()
    }

    // ── list (filmstrip) layout — one horizontal row, same planes ────
    // Slot i's center: leftEdge + w/2 + Σ widths[0..i-1] + GAP·i (RP
    // cumulative). Slot SIZES are layout constants — a wrap rebind swaps
    // the texture and CoverUV crops it into the existing plane size, so
    // the big–small rhythm and spacing never re-place the row.
    // Size rule (RP): landscape (ar ≥ 1.1) → colW×0.96, row-shaped →
    // colW×0.77 (colW = unit, already PHOTO_SCALEd); height = width/ar;
    // every photo shares the y=0 center line.
    // one strip slot: center x + cover-fit w/h on the y=0 center line
    interface ListSlot {
      x: number
      w: number
      h: number
    }
    let listSlots: ListSlot[] = []
    let listTW = 0 // one lap of the strip (Σ widths + GAP×count)
    // the strip geometry itself, from a photo list (shared by the live
    // layout and the requeue's target row — ONE cumulative-widths loop).
    // Sizes come from the photo DEFINING the slot (rowWp — set at seed /
    // requeue; frozen through wraps so slot geometry never moves under a
    // conveyor rebind).
    const stripSlots = (photos: (WallPhoto | null)[]): WaveTarget[] => {
      const L = layoutRef.current
      const left = -window.innerWidth / 2 + SIDE_MARGIN
      let sum = 0
      const out: WaveTarget[] = []
      for (let i = 0; i < photos.length; i++) {
        const wpt = photos[i] ?? null
        const ar = wpt ? wpt.photo.w / wpt.photo.h : 1
        const w = stripW(ar, L.colW)
        out.push({
          wp: wpt as WallPhoto,
          x: left + w / 2 + sum + GAP * i,
          w,
          h: w / ar,
        })
        sum += w
      }
      listTW = sum + GAP * photos.length
      return out
    }
    const computeListLayout = () => {
      listSlots = stripSlots(rowWp.slice(0, layoutRef.current.count))
    }

    // list-mode seed: build a fresh strip roster from the lap-0
    // sequence, reset cursors + virtual position. Runs on first mount
    // into list, deep links, resize-snaps and breakpoint changes —
    // NEVER for a filter switch (that is the requeue below).
    const seedRow = () => {
      killTransition()
      viewTrans?.kill()
      const firstBuild = !rowSeeded
      N = Math.max(1, poolArr.length)
      seq = shuffled(poolArr, WALL_SEED)
      lastLap = 0
      suppressWrap = 3
      const count = layoutRef.current.count
      rowPlanes = planes.slice(0, count)
      rowWp = []
      planes.forEach((m) => {
        m.userData.inRow = false
        m.userData.rowIdx = undefined
      })
      for (let i = 0; i < count; i++) {
        const wp = seq[i % N]
        rowWp.push(wp)
        rowPlanes[i].userData.inRow = true
        rowPlanes[i].userData.rowIdx = i
        bindPlane(rowPlanes[i], wp)
      }
      nextIdx = count
      prevIdx = -1
      wallX = 0
      rowSeeded = true
      computeListLayout()
      prefetch()
      cbRef.current.onSeq(1)
      // fresh mount INTO list (deep link / back from project): the gallery
      // remounts, so no activation edge will fire — flag the shortened
      // enter-only fly-in for the tick loop (RP activation behavior)
      if (firstBuild) {
        pendingListEnter = true
        // …and PLACE the row where the reveal will find it. Planes are
        // born at position (0,0,0) — screen CENTER — and bindPlane never
        // touches position, so without this the enter morph unfolds the
        // strip out of a centered stack (the #/list-refresh display bug:
        // curtain lifts → ONE stacked photo → planes fan out for 1.4s).
        //   curtain still up (fresh load): park AT the slots — the
        //     curtain fade is the whole reveal (RP non-home boot);
        //   curtain long gone (project-close remount): park at +vw so
        //     the morph flies the strip in (RP return-visit activation,
        //     same entrant park restoreImplRef uses for list).
        for (let i = 0; i < count; i++) {
          const m = rowPlanes[i]
          const s = listSlots[i]
          setSize(m, s.w, s.h)
          m.position.set(bootFlags.curtainFlown ? window.innerWidth : s.x, 0, 0)
          m.userData.lastX = NaN
        }
      }
    }

    // ── shared wave grammar (requeue + view transition) ──────────────
    // Both waves speak RP's ONE-clock grammar (decompiled lazy816.js —
    // full rationale banners at each call site). These helpers are the
    // single implementation of the three blocks the waves used to
    // duplicate: the roster classifier, the position/scale/uResolution
    // flight triple, and the exits + offscreen-probe + entrant-revival
    // block. The waves differ ONLY in parameters (delays, hero clocks,
    // tracking), never in grammar — parameterize, never erase.
    const RP_DUR = 1.4
    const RP_EASE = "power3.inOut"
    // RP chains scale/uResolution AFTER position (timeline "<" +
    // per-tween delay), each 0.618s = gsap's global 1/φ default — the
    // CoverUV reframe TRAILS the position landing
    const RP_SUB_DUR = 0.618

    // flight target: list waves omit y/z (strip center line, park is
    // preset to y=z=0); overview morphs fly the full triple
    interface WaveTarget {
      wp: WallPhoto
      x: number
      w: number
      h: number
      y?: number
      z?: number
    }
    // one chained tween clock: duration + delay (+ optional ease
    // override — VT's hero chain; everything else is RP_EASE)
    interface Clock {
      dur: number
      delay: number
      ease?: string
    }
    const ck = (dur: number, delay: number, ease?: string): Clock => ({
      dur,
      delay,
      ease,
    })

    // (a) roster classifier — planes are classified by stable photo key
    // (thumb), never by slot index; mid-flight states classify against
    // the TARGET so rapid clicks converge. `sources` = planes that may
    // already hold a target photo. Hidden non-matching sources become
    // idle carriers (view transition); requeue instead passes the
    // hidden NON-ROW planes as a separate idlePool (its sources are the
    // whole current row — hidden row planes still exit, not idle).
    const classifyRoster = (
      sources: THREE.Mesh[],
      keys: string[],
      idlePool: THREE.Mesh[] | null,
    ) => {
      const usedT = new Set<number>()
      const newRoster: (THREE.Mesh | null)[] = new Array(keys.length).fill(null)
      const nonSurvivors: THREE.Mesh[] = []
      const idle: THREE.Mesh[] = []
      for (const m of sources) {
        const wpt = (m.userData.want ?? m.userData.wp) as WallPhoto | null
        const key = wpt?.photo.thumb ?? null
        const ti = key ? keys.indexOf(key) : -1
        if (ti >= 0 && !usedT.has(ti)) {
          usedT.add(ti)
          newRoster[ti] = m
        } else if (idlePool === null && !m.visible) idle.push(m)
        else nonSurvivors.push(m)
      }
      if (idlePool) idle.push(...idlePool)
      // carriers for entering photos: hidden surplus planes first, then
      // re-purposed ex-leavers; any surplus left flies out as leavers
      const open = keys.map((_, ti) => ti).filter((ti) => !usedT.has(ti))
      const carriers = idle.slice(0, open.length)
      const rePurposed = nonSurvivors.slice(
        0,
        Math.max(0, open.length - carriers.length),
      )
      open.forEach((ti, k) => {
        const m = carriers[k] ?? rePurposed[k - carriers.length]
        if (m) newRoster[ti] = m
      })
      return { usedT, newRoster, nonSurvivors, carriers, rePurposed }
    }

    // (b) flight triple — position on the wave clock, then the chained
    // scale/uResolution clocks. `xOnly` animates x alone (entrant
    // flights start from the y=z=0 right-edge park — position was
    // preset). `track` collects tweens for a wave's kill() (view
    // transition); null = untracked (requeue waves die by generation
    // counter + killTweensOf).
    const flyTo = (
      track: gsap.core.Tween[] | null,
      m: THREE.Mesh,
      t: WaveTarget,
      pos: Clock & { xOnly?: boolean },
      size: Clock,
      res: Clock,
    ) => {
      const posTween = gsap.to(
        m.position,
        pos.xOnly
          ? { x: t.x, duration: pos.dur, ease: RP_EASE, delay: pos.delay }
          : {
              x: t.x,
              y: t.y ?? 0,
              z: t.z ?? 0,
              duration: pos.dur,
              ease: RP_EASE,
              delay: pos.delay,
            },
      )
      const sizeTween = gsap.to(m.scale, {
        x: t.w,
        y: t.h,
        duration: size.dur,
        ease: size.ease ?? RP_EASE,
        delay: size.delay,
      })
      const resTween = gsap.to(unisOf(m).uResolution.value, {
        x: t.w,
        y: t.h,
        duration: res.dur,
        ease: res.ease ?? RP_EASE,
        delay: res.delay,
      })
      if (track) track.push(posTween, sizeTween, resTween)
    }

    // (c) exits + offscreen probe + entrant revival. Leavers AND
    // borrowed carriers share the leaver flight — nearest edge by x
    // sign (RP: `x<=0 ? -I.width : I.width`), immediate, one clock.
    // Borrowed carriers carry an OFFSCREEN PROBE: the moment a carrier
    // passes fully invisible (center beyond the screen edge by half
    // its width), its exit freezes, it teleports to the RIGHT-edge
    // park (+vw — RP's universal entrant start; the teleport happens
    // while invisible, zero artifact risk), rebinds instantly opaque,
    // and flies to its slot with ALL remaining time — same path, same
    // easing, same ~1.9s landing as RP's parked-mesh entrants. `alive`
    // guards stale callbacks (requeue generation counter / VT killed
    // flag). `exitClearsRow`: requeue leavers drop inRow/rowIdx;
    // view-transition ownership was settled at wave start. `enterFull`:
    // view-transition entrants fly the full x/y/z triple (overview
    // morph), requeue entrants x-only (strip center line).
    const flyExits = (o: {
      nonSurvivors: THREE.Mesh[]
      newRoster: (THREE.Mesh | null)[]
      usedT: Set<number>
      targetAt: (ti: number) => WaveTarget
      moveDelay: number
      sDel: number
      rDel: number
      alive: () => boolean
      track: gsap.core.Tween[] | null
      exitClearsRow: boolean
      enterFull: boolean
    }) => {
      const vw = window.innerWidth
      const waveT0 = performance.now() / 1000
      const enterAt = (m: THREE.Mesh, ti: number) => {
        if (!o.alive()) return // superseded — new wave owns m
        const t = o.targetAt(ti)
        m.position.set(vw, 0, 0) // RP's universal entrant park (+I.width)
        bindPlane(m, t.wp, true) // offscreen: instant opaque rebind
        m.visible = true
        const elapsed = performance.now() / 1000 - waveT0
        // land with everyone: moveDelay + RP_DUR from wave start; chained
        // clocks absolute when still in the future, ASAP once passed
        // (the plane was invisible)
        flyTo(
          o.track,
          m,
          t,
          {
            dur: Math.max(0.35, o.moveDelay + RP_DUR - elapsed),
            delay: 0,
            xOnly: !o.enterFull,
          },
          ck(RP_SUB_DUR, Math.max(0.05, o.sDel - elapsed)),
          ck(RP_SUB_DUR, Math.max(0.1, o.rDel - elapsed)),
        )
      }
      for (const m of o.nonSurvivors) {
        const dir = m.position.x <= 0 ? -1 : 1
        const ti = o.newRoster.indexOf(m)
        const borrowedEnterer = ti >= 0 && !o.usedT.has(ti)
        // fully-invisible threshold: near edge past the screen edge
        const offAt = dir * (vw / 2 + Math.abs(m.scale.x) / 2 + 4)
        const state = { crossed: false }
        const tw = gsap.to(m.position, {
          x: dir * vw, // RP: ±I.width (the edge — no 1.5× overshoot)
          duration: RP_DUR,
          ease: RP_EASE,
          onComplete: () => {
            if (!o.alive()) return
            if (borrowedEnterer) {
              // belt: the target lies beyond the threshold, so the
              // probe always fires first — kept for safety only
              if (!state.crossed) enterAt(m, ti)
              return
            }
            if (o.exitClearsRow) {
              m.userData.inRow = false
              m.userData.rowIdx = undefined
            }
            m.visible = false
            snapMelt(m) // never flash a melted edge (spec §5)
            m.position.x = vw // RP parks hidden photos at the right
            // edge — the next wave's entrants all emerge from the right
          },
        })
        tw.eventCallback("onUpdate", () => {
          if (!borrowedEnterer || state.crossed) return
          if (dir * m.position.x < dir * offAt) return // still partly visible
          state.crossed = true
          tw.kill() // freeze the exit at the invisible threshold
          enterAt(m, ti)
        })
        if (o.track) o.track.push(tw)
      }
    }

    // ── Phase 4: filter requeue — RP's DECOMPILED list-switch grammar ──
    // (lazy816.js “function w”, verified 2026-08-18): ONE clock — every
    // flight 1.4s power3.inOut. Leavers fly to the nearest edge
    // (±I.width) immediately, then hide and park at the RIGHT edge;
    // kept photos and entrants move on the same clock +0.5s; entrants
    // revive fully opaque at the right-edge park (all fly in right→
    // left). No ripple, no stagger, no fade, no grow — none in source.
    // Groups are classified by stable photo key (thumb), never by slot
    // index. Plane-pool artifact: the row uses every plane on desktop,
    // so entrants re-purpose ex-leaver planes — their exit carries an
    // offscreen probe: rebind the instant they turn invisible, teleport
    // to the right-edge park, fly the remaining clock (~1.9s landing).
    const requeue = () => {
      killRequeue()
      viewTrans?.kill()
      wasListMode = true // absorb a simultaneous mode edge (cat+list hash)
      const myGen = ++requeueGen
      const L = layoutRef.current
      const vw = window.innerWidth
      const count = L.count
      N = Math.max(1, poolArr.length)
      seq = shuffled(poolArr, WALL_SEED) // the NEW filter's lap-0 order
      lastLap = 0
      suppressWrap = 3
      // hand any live hover melt back; RP's filter switch has no
      // hover-specific delay — the kept-clock +0.5s is flat
      setHover(null, null)

      // target row: cumulative widths, 0.96/0.77 size rhythm (Phase 3 §2)
      // — same stripSlots math the live layout uses, so wave targets and
      // the tick's exact-slot writes can never diverge
      const targets = stripSlots(
        Array.from({ length: count }, (_, i) => seq[i % N]),
      )

      // classify the CURRENT roster by photo key (mid-flight states
      // classify against the target — rapid clicks converge); carriers:
      // hidden surplus NON-ROW planes first, then re-purposed ex-leavers
      const { usedT, newRoster, nonSurvivors, rePurposed } = classifyRoster(
        rowPlanes,
        targets.map((t) => t.wp.photo.thumb),
        planes.filter((m) => !rowPlanes.includes(m) && !m.visible),
      )

      // ── RP filter-switch grammar (DECOMPILED from richardprescott.com
      // lazy816.js “function w”, 2026-08-18 — supersedes both the earlier
      // crossfire design AND the fade design): ONE clock — every flight
      // is 1.4s power3.inOut, no stagger, no ripple, no grow, no fade.
      // Leavers fly to the nearest horizontal edge (±I.width = ±vw)
      // IMMEDIATELY, then hide and park at the RIGHT edge. Kept photos
      // AND entrants move on the same clock delayed 0.5s (RP:
      // `-1!==v ? .5 : 0`); entrants revive fully opaque at the RIGHT-
      // edge park (RP parks every hidden photo at +I.width) — all of
      // them fly in right→left with the conveyor. Everything lands
      // together at ~1.9s. Plane-pool probe: borrowed carriers rebind
      // the instant they pass fully offscreen (flyExits), so their
      // entry keeps the longest possible flight.
      const MOVE_DELAY = 0.5 // RP: `-1!==v ? .5 : 0`
      const S_DEL = MOVE_DELAY + 0.5 // scale @1.0
      const R_DEL = MOVE_DELAY + 1.0 // uResolution @1.5
      newRoster.forEach((m, ti) => {
        if (!m) return
        const t = targets[ti]
        m.userData.inRow = true
        m.userData.rowIdx = ti
        if (usedT.has(ti)) {
          // survivor: slide to the closing-rank slot on the kept clock
          // (scale/uResolution ride the same clock — CoverUV reframes)
          m.visible = true // parked leavers reclassified as survivors
          flyTo(
            null,
            m,
            t,
            ck(RP_DUR, MOVE_DELAY),
            ck(RP_SUB_DUR, S_DEL),
            ck(RP_SUB_DUR, R_DEL),
          )
        } else {
          // entrant: RP parks EVERY hidden photo at the right edge
          // (+I.width) — entrants always fly in right→left with the
          // conveyor, never alternating sides. Borrowed carriers are
          // ONSCREEN (desktop: the row uses every plane but one): the
          // offscreen probe on their exit flight (flyExits) owns their
          // park+rebind+entry. RP has one mesh per photo, parked and
          // waiting — no borrowing, no probe needed there.
          const borrowed = rePurposed.includes(m)
          if (!borrowed) {
            // idle carrier: park at the right edge NOW (it is invisible),
            // rebind instantly opaque, revive, fly on the kept clock —
            // RP's exact `visible=true, uOpacity=1` + delayed flight.
            // Scale/uResolution keep their OLD values until the chained
            // clocks (RP parks hidden photos with their last size)
            m.position.set(vw, 0, 0)
            bindPlane(m, t.wp, true)
            m.visible = true
            flyTo(
              null,
              m,
              t,
              { ...ck(RP_DUR, MOVE_DELAY), xOnly: true },
              ck(RP_SUB_DUR, S_DEL),
              ck(RP_SUB_DUR, R_DEL),
            )
          }
          // borrowed: nothing to schedule here — the probe below owns it
        }
      })
      // exits + offscreen probe: leavers AND borrowed carriers share the
      // leaver flight (grammar + rationale on flyExits)
      flyExits({
        nonSurvivors,
        newRoster,
        usedT,
        targetAt: (ti) => targets[ti],
        moveDelay: MOVE_DELAY,
        sDel: S_DEL,
        rDel: R_DEL,
        alive: () => requeueGen === myGen,
        track: null,
        exitClearsRow: true,
        enterFull: false,
      })
      rowPlanes = newRoster.filter((m): m is THREE.Mesh => !!m)
      rowWp = targets.map((t) => t.wp)
      requeuing = true
      requeueTimer = window.setTimeout(
        () => {
          requeueTimer = 0
          requeuing = false
          // wrap bookkeeping continues from the new row's tail
          wallX = 0
          nextIdx = count
          prevIdx = -1
          suppressWrap = 3
          computeListLayout()
          planes.forEach(nanXY)
          cbRef.current.onSeq(1)
        },
        // resume after the trailing uResolution clock too (exact-slot
        // writes would otherwise snap the mid-tween CoverUV reframe)
        (Math.max(MOVE_DELAY + RP_DUR, R_DEL + RP_SUB_DUR) + 0.12) * 1000,
      )
    }

    const setPool = (p: WallPhoto[]) => {
      // cat+mode change in the same hash (e.g. #/street/list → #/): the
      // pool effect fires with listModeRef ALREADY flipped, so seeding
      // here would instantly rebind every plane mid-list — the visible
      // "闪烁" — before the mode-edge view transition even starts next
      // frame. Defer the handoff: the transition's completion callback
      // re-invokes setPool with the new pool (fly-in rebinds anyway),
      // so textures swap exactly once, inside the choreography.
      const modeEdge =
        listModeRef.current !== wasListMode && activeRef.current && !viewTrans
      if (modeEdge || viewTrans) {
        // transition in flight (launched by this same edge, or a later
        // cat change landed mid-choreography): park the newest pool —
        // the completion callback (or kill) hands it over exactly once
        pendingPool = p
        return
      }
      poolArr = p
      pendingPool = null
      // recompute pitch for the new pool's tallest photo (overview z-fight
      // guard — the "sticky flicker" note) BEFORE re-seeding/requeueing
      applyLayout(window.innerWidth, window.innerHeight)
      if (listModeRef.current) {
        if (rowSeeded)
          requeue() // filter switch in list — spatial requeue
        else seedRow() // first build (mount / deep link)
      } else {
        seedPool() // overview: instant re-seed (dissolve retired)
      }
    }

    setPoolRef.current = setPool

    // ── raycasting ────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const pointerNdc = new THREE.Vector2(-2, -2)
    let pointerInside = false
    let pointerMoved = false // hover raycast only runs on pointer movement
    let pendingKey: string | null = null
    let pendingMesh: THREE.Mesh | null = null
    let pendingCount = 0

    const setHover = (
      m: THREE.Mesh | null,
      key: string | null,
      snap = false,
    ) => {
      // pair identity: same photo on a DIFFERENT plane instance (small
      // pools render duplicate keys) retargets the melt to the plane
      // actually under the cursor
      if (m === hoverPlane && key === hoveredKeyRef.current) return
      const prev = hoverPlane
      hoverPlane = m
      hoveredKeyRef.current = key
      if (prev && prev !== m) {
        if (snap)
          snapMelt(prev) // view exits reset presentation state
        else meltTo(prev, 0)
      }
      if (m && m !== prev) {
        if (snap) snapMelt(m)
        else meltTo(m, 1)
      }
      const wp =
        key !== null
          ? (poolArr.find((x) => x.photo.thumb === key) ?? null)
          : null
      cbRef.current.onHover(wp)
    }

    // pick predicate shared by click + hover raycasts: a hit counts only
    // if the plane is VISIBLE and effectively opaque (mid-fade planes
    // are ghosts — clicking through them must reach the photo behind)
    const pickPlane = (ndcVec: THREE.Vector2) => {
      raycaster.setFromCamera(ndcVec, camera)
      const hits = raycaster.intersectObjects(planes, false)
      const hit = hits.find(
        (h) =>
          (h.object as THREE.Mesh).visible &&
          ((h.object as THREE.Mesh).material as THREE.MeshBasicMaterial)
            .opacity > 0.5,
      )
      if (!hit) return null
      const wp = hit.object.userData.wp as WallPhoto ?? null
      return wp ? { wp, mesh: hit.object as THREE.Mesh } : null
    }

    const hitAt = (clientX: number, clientY: number) => {
      ndc.x = (clientX / window.innerWidth) * 2 - 1
      ndc.y = -(clientY / window.innerHeight) * 2 + 1
      return pickPlane(ndc)
    }

    const onMove = (e: PointerEvent) => {
      pointerInside = true
      pointerMoved = true // raycast only when the pointer actually moved
      pointerNdc.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      )
    }
    const onLeave = () => {
      pointerInside = false
    }
    const onClick = (e: PointerEvent) => {
      if (!activeRef.current || hiddenGlideRef.current) return
      const hit = hitAt(e.clientX, e.clientY)
      if (!hit) {
        if (isCoarse) setHover(null, null)
        return
      }
      if (isCoarse) {
        // first tap → melt + panel (the melt is the tap feedback);
        // second tap on the same photo → open the series deep-linked to it
        if (hit.wp.photo.thumb === hoveredKeyRef.current)
          cbRef.current.onPick(hit.wp)
        else setHover(hit.mesh, hit.wp.photo.thumb)
      } else {
        cbRef.current.onPick(hit.wp)
      }
    }
    canvas.addEventListener("pointermove", onMove)
    canvas.addEventListener("pointerleave", onLeave)
    canvas.addEventListener("click", onClick)

    const onResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      renderer.setSize(w, h)
      setCam(w, h)
      applyLayout(w, h)
    }
    window.addEventListener("resize", onResize)

    // ── render loop ───────────────────────────────────────────────────
    const wrapCoord = wrapCoordOf
    // photo at a conveyor cursor (forward or negative/backward): reshuffles
    // the lap deterministically when the cursor crosses into a new one —
    // the one shared shape behind every wrap rebind (was triplicated)
    const photoAt = (idx: number) => {
      const lap = Math.floor(idx / N)
      if (lap !== lastLap) {
        lastLap = lap
        seq = shuffled(poolArr, WALL_SEED + lap * 7919)
      }
      return seq[((idx % N) + N) % N]
    }

    // conveyor ADVANCE (shared by the list + overview wrap paths): the
    // plane that scrolled off re-enters carrying the NEXT photo, and the
    // odometer reads the new conveyor head
    const advance = (mesh: THREE.Mesh) => {
      bindPlane(mesh, photoAt(nextIdx))
      nextIdx++
      dirty = true
      cbRef.current.onSeq((((nextIdx % N) + N) % N) + 1)
    }

    let raf = 0
    let dirty = true // at least one render on start
    let firstFrames = 3 // texture fades need a few frames even if static
    let lastPrefetch = 0

    // ── RP direct-input scroll stack ──────────────────────────────
    // 1:1 replication of RP's model — the wall does NOT read page scroll.
    //   input (wheel/drag) → jRaw (units, ±~0.5/notch)  --debounce 150ms→ 0
    //   per frame: A ← damp(A, jRaw, .05)  (~330ms attack/release)
    //   wallY += A×UNIT px · uSpeed = 2.5×A×UNIT px · breathing always on
    // Displacement and curvature share A → the glide and the drum-wrap
    // decay on the SAME curve (the signature "butter" feel).
    const UNIT = () => layoutRef.current.colW / 1.2 // px per RP unit
    let jRaw = 0
    let A = 0 // damped velocity in RP units
    let wallY = 0 // virtual scroll position (px), replaces window.scrollY
    let wallX = 0 // list-mode virtual position (px) — SAME velocity field A
    let prevIdx = 0 // backward conveyor cursor (photos entering from the left)
    let wasListMode = listModeRef.current
    // RP view-transition state (overview ↔ list). While non-null, GSAP owns
    // plane transforms and the tick loop stands aside (positions, wrap,
    // hover); input is dead. Declared here so early fns (seedRow) can kill.
    let viewTrans: { kill: () => void } | null = null
    // idle z-wave gate (RP uProgress semantics): 1 = wave ON in list
    // (uProgress 0), 0 = flat overview (uProgress .2). Toggled 1s linear
    // at view edges by startViewTransition; the tick multiplies it in.
    const breathState = { v: 0 } // site boots into overview = flat
    let pendingListEnter = false // mount-into-list fly-in (see seedRow)
    let pendingOverviewEnter = false // remount fly-in (see seedPool)
    let jTimer = 0 // 150ms quiet → jRaw = 0
    let resetTween: gsap.core.Tween | null = null
    let lastT = performance.now()
    let lastInputAt = 0
    let wasActive = activeRef.current
    const killResetTween = () => {
      if (resetTween) {
        resetTween.kill()
        resetTween = null
      }
    }
    // 1.4s power2.inOut glide back to the top — the RP window
    // scrollTo:{y:0} equivalent. Shared by the category-switch path
    // (canvas visible, cancellable by user input via feed) and the
    // info-exit path (canvas hidden, restore fires onComplete).
    const startResetGlide = (onComplete?: () => void) => {
      killResetTween()
      const proxy = { v: wallY }
      resetTween = gsap.to(proxy, {
        v: 0,
        duration: 1.4,
        ease: "power2.inOut",
        onUpdate: () => {
          wallY = proxy.v
        },
        onComplete: () => {
          resetTween = null
          onComplete?.()
        },
      })
    }
    // ── info-exit re-enter (App-invoked via the imperative handle) ────
    // RP contact close (layout.js @29048, decompiled): the contact page
    // itself fades 1s power4.out (0.5s <800px) and ONLY THEN the route
    // pops — home remounts FRESH: scroll resets instantly (no glide) and
    // every plane, parked at the return park, flies back into the wall
    // (the return-visit activation entrance). Overlay parity: the canvas
    // is still hidden, so teleport wallY/wallX to top, park every visible
    // plane at the return park, run the enter-only morph, and pop the
    // canvas the instant the flight begins (RP's fresh home renders the
    // canvas+nav+footer at full opacity with the wall still offscreen).
    restoreImplRef.current = (onRestored?: () => void) => {
      gsap.killTweensOf(canvas)
      gsap.set(canvas, { opacity: 0, pointerEvents: "none" })
      hiddenGlideRef.current = false
      infoCanvasRef.current = false
      wallY = 0
      wallX = 0
      killResetTween()
      const lm = listModeRef.current
      if (lm) {
        // strip: park the row at +vw (the list entrant park)
        for (const m of planes) {
          if (m.userData.inRow) m.position.set(window.innerWidth, 0, 0)
        }
      } else {
        parkReturnMount()
      }
      startViewTransition(lm, true)
      gsap.set(canvas, { opacity: 1, pointerEvents: "auto" })
      onRestored?.()
    }
    cancelImplRef.current = () => {
      killResetTween()
    }
    // drain the ENTIRE upload queue synchronously (intro beat entry):
    // texImage2D+mipmap stalls must all land inside the 1.3s still beat,
    // never inside the explode flight
    flushTexturesImplRef.current = () => {
      while (uploadQueue.length) {
        renderer.initTexture(uploadQueue.shift()!)
      }
    }
    // boot-lap planes all bound (RP <Suspense> parity — see handle doc)
    isBootReadyImplRef.current = () => {
      const cnt = layoutRef.current.count
      for (let i = 0; i < cnt; i++) {
        if (planes[i].userData.want) return false
      }
      return true
    }
    // ── RP intro entrance (App-invoked at the beat's end) ─────
    // Decompuled boot + `l` timeline. The branch is WHERE the planes
    // are parked, not the viewport width:
    //   OVERVIEW boot (any width — parkStack parked everyone dead-center
    //   as 150px squares): startViewTransition(false, true, intro) —
    //   the stack EXPLODES outward into the lattice on RP's one clock
    //   (position 1.4s power3.inOut @0, chained scale/uResolution, hero
    //   on its own grow clocks .6s sine.inOut @.1). The hero runs the
    //   liquid wobble (uAnim 0→.9→0, .45s sine.inOut, return at +.7)
    //   and every other photo a micro-ripple (uAnim 0→.15→0).
    //   LIST boot (deep link — seedRow laid the strip out at its slots,
    //   visible through the transparent curtain all along): NO flight —
    //   an enter-only morph with no repositioning (the curtain fade is
    //   the whole reveal, RP's non-home route is a plain fade too).
    //   (The former +1.2vw teleport branch is GONE: it hard-teleported
    //   the VISIBLE deep-linked strip offscreen — a onscreen snap.)
    introFlyImplRef.current = () => {
      bootFlags.curtainFlown = true // remounts after this take the return path
      if (!INTRO_EXPLODE) return // plan B: no explode — the fade reveals
      if (viewTrans || requeuing) return // never fight a live wave
      const listBoot = wasListMode
      startViewTransition(wasListMode, true, !listBoot)
      if (listBoot) return
      planes.forEach((m, i) => {
        if (!m.visible || i >= layoutRef.current.count) return
        const u = unisOf(m).uAnim
        gsap.killTweensOf(u)
        // ripple rides EACH photo's own pop moment (sequential emergence)
        gsap.to(u, {
          value: i === 0 ? 0.9 : 0.15,
          duration: 0.45,
          ease: "sine.inOut",
          delay: i * 0.05,
        })
        gsap.to(u, {
          value: 0,
          duration: 0.45,
          delay: i * 0.05 + 0.7,
          ease: "sine.inOut",
        })
      })
    }

    // ── overview ↔ list view transition (RP decompiled choreography —
    // same ONE-clock grammar as the requeue banner above): exits fly to
    // the nearest horizontal edge immediately, entrants revive at the
    // right-edge park and fly in, kept photos follow after a 0.5s flat.
    // On completion the tick loop resumes ownership — fly-in targets
    // equal the layout math exactly, so the handoff is seamless.
    // absorb a pool deferred across a mode edge (cat+mode same-hash
    // change) into the CURRENT build — rebinds happen offscreen inside
    // the choreography, never on the settled visible wall (残影 class)
    const absorbPendingPool = () => {
      if (!pendingPool) return
      poolArr = pendingPool
      pendingPool = null
      applyLayout(window.innerWidth, window.innerHeight)
    }

    const startViewTransition = (
      toList: boolean,
      enterOnly = false,
      intro = false,
    ) => {
      viewTrans?.kill() // supersede any in-flight choreography
      killRequeue() // and any in-flight requeue (mutual supersede)
      introFlown = true // the boot stack's wait is over — morph from it
      bootParked = false
      const L = layoutRef.current
      const vw = window.innerWidth
      const count = L.count
      const row = planes.slice(0, count)
      const tweens: gsap.core.Tween[] = []
      const timers: number[] = []
      let killed = false
      transitioning++
      // absorb a pool deferred across this mode edge NOW (cat+mode in
      // the same hash): the fly-in rebinds to the NEW pool's photos
      // offscreen, in BOTH directions. Deferring the handoff to the
      // completion timer (an earlier fix) rebound every plane AFTER they
      // had settled onscreen — a full-wall texture flash (残影 class).
      absorbPendingPool()
      {
        // lap-0 roster for the DESTINATION view — both directions now:
        // list flies in its strip, overview flies in the (possibly new
        // pool's) lap-0 wall. Fly-outs keep the OLD photos until each
        // plane parks offscreen (crossfire preserved).
        N = Math.max(1, poolArr.length)
        seq = shuffled(poolArr, WALL_SEED)
        lastLap = 0
        nextIdx = count // wrap bookkeeping continues from lap-0's tail
        rowWp = Array.from({ length: count }, (_, i) => seq[i % N])
        if (toList) computeListLayout()
      }

      const finishT = (i: number): WaveTarget => {
        const wp = rowWp[i] as WallPhoto
        if (toList) {
          const s = listSlots[i]
          return { wp, x: s.x, y: 0, z: 0, w: s.w, h: s.h }
        }
        const sl = L.slots[i]
        // target photo's OWN aspect: the plane rebinds to rowWp[i] at its
        // offscreen park — sizing by the OLD photo's ar would leave a
        // scale jump when the tick resumes with the new ar
        const ar = wp ? wp.photo.w / wp.photo.h : 1
        const w = boundW(sl.w, ar, L.pitch)
        return {
          wp,
          x: sl.x,
          // y0/depth are computeLayout-precomputed (row baseline + seeded
          // stagger; curve recede + z jitter) — same values the tick reads
          y: sl.y0,
          z: sl.depth,
          w,
          h: w / ar,
        }
      }

      // ── RP view-switch grammar (DECOMPILED, lazy816.js main effect,
      // verified 2026-08-18): DIRECT SPATIAL MORPH — the same one clock
      // as the filter requeue (RP_DUR/RP_EASE/RP_SUB_DUR, shared). No
      // ripple, no fly-out-and-return, no grow, no stagger: kept photos
      // fly straight from wherever they are to their new slot; hidden
      // entrants revive at the +vw right park and fly in. Position 1.4s
      // power3.inOut, delayed 0.5s entering list only (RP
      // `-1!==v?.5:0`; the activation edge ≈ v:-1 → no delay).
      // scale/uResolution ride SHORTER CHAINED clocks (timeline "<" +
      // per-tween delay): list → position @.5, scale @1.0, uRes @1.5
      // (0.618s = gsap's global 1/φ default); overview → position @0
      // (1.4s), scale @0 (1s), uRes @.5 (0.618s).
      // intro: SEQUENTIAL POP (user-directed) — the hero (= the chip's
      // own photo) emerges first from the center stack, then every plane
      // pops in stack order, one at a time. Only ONE photo is ever in
      // motion, so any residual flicker source can affect at most one
      // photo and is pinpointable. Non-intro switches keep RP's one clock.
      const STAG_INTRO = 0.05
      const myStag = (ti: number) => (intro ? ti * STAG_INTRO : 0)
      const MOVE_DELAY = enterOnly ? 0 : toList ? 0.5 : 0
      const S_DEL = MOVE_DELAY + (toList ? 0.5 : 0)
      const S_DUR = toList ? RP_SUB_DUR : 1
      const R_DEL = MOVE_DELAY + (toList ? 1.0 : 0.5)
      // intro hero chain (RP `l` timeline): the stack's top photo GROWS
      // out of its 150px square on its own clocks — scale .6s sine.inOut
      // @.1, uResolution .618s sine.inOut @.1 — instead of the wall-wide
      // scale clock. Everyone else uses the standard chained clocks.
      const heroS = (m: THREE.Mesh, ti: number) =>
        intro && ti === 0 && m === planes[0]
      const heroSdel = 0.1
      const heroSdur = 0.6
      const heroEase = "sine.inOut"
      // idle z-wave toggles WITH the view (RP uProgress: 0 in list =
      // wave on, .2 in overview = flat; 1s linear)
      tweens.push(
        gsap.to(breathState, {
          v: toList ? 1 : 0,
          duration: 1,
          ease: "linear",
        }),
      )
      shared.uAxis.value = toList ? 1 : 0

      // classify EVERY plane by photo key against the destination roster
      // (same classifier as requeue — rapid edges converge). A HIDDEN
      // plane holding a target key counts as a survivor: it morphs in
      // from its +vw park (RP's entrant path, visible false→true).
      // Hidden non-matching planes become idle carriers (idlePool null).
      const { usedT, newRoster, nonSurvivors, rePurposed } = classifyRoster(
        planes,
        rowWp.map((r) => r?.photo.thumb ?? ""),
        null,
      )
      // slot ownership settles NOW (membership checks sleep while the
      // transition runs; the tick that resumes at completion reads
      // these). Surplus planes take overflow slots — overview hides by
      // count, list by the inRow flag
      let overflow = count
      for (const m of planes) {
        const ti = newRoster.indexOf(m)
        m.userData.slot = ti >= 0 ? ti : overflow++
        m.userData.bw = undefined // slot moved → boundW cache is stale
        m.userData.inRow = toList && ti >= 0
        m.userData.rowIdx = ti >= 0 ? ti : undefined
      }

      newRoster.forEach((m, ti) => {
        if (!m) return
        const t = finishT(ti)
        if (usedT.has(ti)) {
          // survivor: fly straight from the current position (onscreen
          // wall photo or +vw park) to the new slot — RP's morph.
          // intro: planes whose texture somehow never landed (4s-cap
          // degrade) do NOT fly (an empty quad would flash) — they hide
          // and let the tick's fill path place them (fills can't flash)
          if (
            intro &&
            (m.userData.want ||
              (m.material as THREE.MeshBasicMaterial).map === null)
          ) {
            m.visible = false
            return
          }
          m.visible = true
          const hero = heroS(m, ti)
          flyTo(
            tweens,
            m,
            t,
            ck(RP_DUR, MOVE_DELAY + myStag(ti)),
            ck(
              hero ? heroSdur : S_DUR,
              (hero ? heroSdel : S_DEL) + myStag(ti),
              hero ? heroEase : undefined,
            ),
            ck(
              RP_SUB_DUR,
              (hero ? heroSdel : R_DEL) + myStag(ti),
              hero ? heroEase : undefined,
            ),
          )
        } else {
          const borrowed = rePurposed.includes(m)
          if (!borrowed) {
            // idle carrier: park at +vw (right, invisible), rebind
            // instantly opaque, revive, morph in — RP's entrant path
            // (full x/y/z triple — overview morphs fly the lattice too)
            m.position.set(vw, 0, 0)
            bindPlane(m, t.wp, true)
            m.visible = true
            const hero = heroS(m, ti)
            flyTo(
              tweens,
              m,
              t,
              ck(RP_DUR, MOVE_DELAY),
              ck(
                hero ? heroSdur : S_DUR,
                hero ? heroSdel : S_DEL,
                hero ? heroEase : undefined,
              ),
              ck(
                RP_SUB_DUR,
                hero ? heroSdel : R_DEL,
                hero ? heroEase : undefined,
              ),
            )
          }
          // borrowed: the offscreen probe below owns park+rebind+entry
        }
      })
      // exits: visible non-matching planes (re-purposed carriers + true
      // leavers) fly to the nearest edge (±vw, RP ±I.width) immediately,
      // one clock — borrowed carriers carry the requeue's offscreen
      // probe (rebind the instant they turn fully invisible). VT
      // entrants fly the FULL x/y/z triple (enterFull) and tweens are
      // tracked for the wave kill().
      flyExits({
        nonSurvivors,
        newRoster,
        usedT,
        targetAt: finishT,
        moveDelay: MOVE_DELAY,
        sDel: S_DEL,
        rDel: R_DEL,
        alive: () => !killed,
        track: tweens,
        exitClearsRow: false,
        enterFull: true,
      })
      timers.push(
        window.setTimeout(
          () => {
            // layout resumes ownership (targets == tick math)
            viewTrans = null
            transitioning--
            if (toList) {
              wallX = 0
              prevIdx = nextIdx - count - 1
              rowPlanes = newRoster.filter((m): m is THREE.Mesh => !!m)
              rowSeeded = true
              // (inRow/rowIdx/visibility settled at transition start by
              // the slot-ownership loop)
            } else {
              wallY = 0
            }
            suppressWrap = 3
            // intro photo-lock lifts 2s after landing (fills kept the
            // wall complete; any queued-then-dropped swaps stay dropped —
            // the first conveyor wrap re-syncs naturally)
            window.setTimeout(() => {
              introLocked = false
            }, 2000)
            row.forEach(nanXY)
            // every completed view transition lands the wall at lap-0
            // TOP — the same visual state as boot, so the odometer reads
            // 01 (never the conveyor-head value: a fresh landing showing
            // [35] was the #/list-refresh display bug). Scrolling resumes
            // the head convention from the first wrap.
            cbRef.current.onSeq(1)
            // NOTE: deferred pools were absorbed at transition START
            // (offscreen rebind in the fly-in) — handling them here
            // rebound the settled, visible wall (残影). Keep this timer
            // pure bookkeeping.
          },
          // resume only after EVERYTHING lands — the position clock AND
          // the trailing uResolution clock (R_DEL + 0.618) — else the
          // tick's exact-slot writes snap the mid-tween CoverUV reframe;
          // intro: + the sequential-pop sweep (the LAST photo to land)
          (Math.max(MOVE_DELAY + RP_DUR, R_DEL + RP_SUB_DUR) +
            (intro ? (count - 1) * STAG_INTRO : 0) +
            0.12) *
            1000,
        ),
      )
      viewTrans = {
        kill: () => {
          if (killed) return
          killed = true
          timers.forEach((t) => window.clearTimeout(t))
          tweens.forEach((tw) => tw.kill())
          viewTrans = null
          // guard: killTransition() may already have zeroed the counter
          // (seedPool/seedRow order) — a bare decrement would underflow to
          // -1 and let the transitioning>0 render gate skip fade frames
          if (transitioning > 0) transitioning--
          row.forEach(nanXY)
          // a deferred pool (cat+mode same-hash change) must not strand:
          // the killer (seedPool/seedRow/startViewTransition) is about to
          // rebuild with SOME pool — make sure it's the newest one
          absorbPendingPool()
        },
      }
    }

    const feed = (j: number) => {
      introLocked = false // user input = live conveyor, lock's job is done
      // a hidden info-exit glide must never be cancelled by input — the
      // chrome restore depends on its onComplete (input is dead while the
      // wall is invisible anyway)
      if (hiddenGlideRef.current) return
      // view transitions / requeues own the choreography — input waits
      if (viewTrans || requeuing) return
      killResetTween() // user input cancels any reset glide
      jRaw = j
      lastInputAt = performance.now()
      if (jTimer) window.clearTimeout(jTimer)
      // RP: 150ms without input → velocity source is zero (A then decays)
      jTimer = window.setTimeout(() => {
        jRaw = 0
        jTimer = 0
      }, 150)
    }
    const onWheel = (e: WheelEvent) => {
      if (!activeRef.current) return
      // normalize-wheel semantics: pixelY; line mode ≈ ×16, page ≈ viewport
      const px =
        e.deltaMode === 1
          ? e.deltaY * 16
          : e.deltaMode === 2
            ? e.deltaY * window.innerHeight
            : e.deltaY
      feed(0.005 * px)
    }
    // touch drag: sustained velocity ∝ drag offset (RP onDrag ×1.7, mobile
    // clamp ±0.15). Natural direction: drag up → view photos below.
    let dragId: number | null = null
    let dragY0 = 0
    const onDragDown = (e: PointerEvent) => {
      if (!activeRef.current || e.pointerType === "mouse") return
      dragId = e.pointerId
      dragY0 = e.clientY
    }
    const onDragMove = (e: PointerEvent) => {
      if (dragId !== e.pointerId) return
      const dy = e.clientY - dragY0
      feed(Math.max(-0.15, Math.min(0.15, (-dy / window.innerHeight) * 1.7)))
    }
    const onDragUp = () => {
      dragId = null
    }
    window.addEventListener("wheel", onWheel, { passive: true })
    window.addEventListener("pointerdown", onDragDown, { passive: true })
    window.addEventListener("pointermove", onDragMove, { passive: true })
    window.addEventListener("pointerup", onDragUp, { passive: true })
    window.addEventListener("pointercancel", onDragUp, { passive: true })

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000))
      lastT = now
      const L = layoutRef.current
      const lm = listModeRef.current
      // activation edge (re-entering from hidden: project/info). The
      // virtual position resets; entering straight INTO list replays the
      // shortened fly-in (skip the overview pass — RP activation).
      // Skipped while an info-exit glide owns the position.
      if (activeRef.current && !wasActive && !hiddenGlideRef.current) {
        A = 0
        jRaw = 0
        suppressWrap = 3
        if (lm && !viewTrans) {
          wallX = 0
          startViewTransition(true, true)
        } else if (!lm) {
          wallY = 0
        }
      }
      wasActive = activeRef.current
      // layout-mode edge while live (overview ↔ list route change) → the
      // full RP one-clock choreography (nearest-edge exits → right-park
      // revival fly-in). No !viewTrans
      // guard: an edge DURING a transition supersedes it (startView-
      // Transition kills the in-flight one first and absorbs any pending
      // pool) — the old guard swallowed the edge but still flipped
      // wasListMode, stranding the wall in the wrong content.
      if (lm !== wasListMode && activeRef.current) startViewTransition(lm)
      wasListMode = lm
      // bend axis follows the layout (transitions set it at fly-in; deep
      // links / seeded mounts never run one, so sync it here too)
      if (!viewTrans) shared.uAxis.value = lm ? 1 : 0
      // mount-into-list fly-in (gallery remounts on project visits, so the
      // activation edge cannot cover it — seedRow flagged it)
      if (
        pendingListEnter &&
        lm &&
        listSlots.length &&
        activeRef.current &&
        !viewTrans
      ) {
        pendingListEnter = false
        startViewTransition(true, true)
      }
      // remount-into-overview fly-in (project close: the gallery unmounted
      // and re-seeded — the curtain is long gone, seedPool parked the
      // lattice at +1.2vw for RP's return-visit activation entrance)
      if (pendingOverviewEnter && !lm && activeRef.current && !viewTrans) {
        pendingOverviewEnter = false
        wallY = 0
        startViewTransition(false, true)
      }
      // damp per RP: per-frame 1-exp(-0.05) at 60fps → rate 3/s
      A += (jRaw - A) * (1 - Math.exp(-3 * dt))
      const unit = UNIT()
      // axis swap: list drives wallX (scroll-down pushes the strip LEFT,
      // natural), overview keeps wallY — same damped velocity field A,
      // same input pipeline. Frozen during view transitions (GSAP owns
      // the transforms; input is dead at feed()).
      if (!viewTrans && !requeuing) {
        if (lm) wallX -= A * unit * dt * 60
        else wallY += A * unit * dt * 60
      }
      const s = ((wallY % L.cycleH) + L.cycleH) % L.cycleH
      // shared uniforms — bend & breathing (1:1 constants from RP source)
      shared.uTime.value = now / 1000
      shared.uSpeed.value = 2.5 * A * unit
      shared.uBreath.value = activeRef.current
        ? 0.027 * unit * breathState.v
        : 0
      if (suppressWrap > 0) suppressWrap--
      const scrolling = Math.abs(A) > 0.003 || jRaw !== 0
      if (scrolling) lastScrollActivity = now
      const recentlyScrolled = now - lastScrollActivity < 250 || firstFrames > 0
      // GPU uploads: throttled to 1/frame while scrolling, 2/frame at rest
      drainUploads(recentlyScrolled)
      // RP: |velocity| > 0.1 auto-cancels hover selection — the photo
      // un-melts while the wall glides (RP: b(-1))
      if (Math.abs(A) > 0.1 && hoveredKeyRef.current !== null)
        setHover(null, null)

      // idle early-out (perf): when the gallery is INACTIVE, nothing
      // changed since the last render (dirty), the boot fades are done
      // (firstFrames/transitioning) and no wave owns the planes — the
      // whole 36-plane math loop is skipped, not just the render.
      // Everything that must keep draining while hidden stays OUTSIDE
      // this gate: upload-queue drain, hover reset, prefetch, the
      // activation/mode-edge checks above (they all require active /
      // dirty anyway). A decaying A (post-deactivation glide) keeps the
      // loop alive: moving planes re-dirty every frame until the
      // damped velocity settles; bootParked forces the loop (it sets
      // dirty) so the parked stack never freezes mid-intro.
      const idleHidden =
        !activeRef.current &&
        !dirty &&
        firstFrames === 0 &&
        transitioning === 0 &&
        !viewTrans &&
        !requeuing
      if (!idleHidden) {
        for (const mesh of planes) {
          const i = mesh.userData.slot as number
          if (viewTrans || requeuing || bootParked) {
            // transition/requeue tweens own transforms AND visibility (the
            // membership flags below only settle at completion — checking
            // them mid-transition hid every plane through an overview→list
            // switch and nothing re-showed them: the "list has no images"
            // bug). NaN sentinels force the wrap detection to re-capture
            // cleanly when layout resumes (NaN never compares true → no
            // phantom rebind)
            mesh.userData.lastX = NaN
            mesh.userData.lastY = NaN
            dirty = true
            continue
          }
          // responsive: overview hides planes beyond the lattice count;
          // list membership is the roster flag (requeue swaps carriers in)
          if (lm ? !mesh.userData.inRow : i >= L.count) {
            if (mesh.visible) mesh.visible = false
            continue
          }
          if (lm) {
            // ── LIST: horizontal filmstrip row (y=0, z=0, slot sizes) ──
            const slot = listSlots[mesh.userData.rowIdx as number ?? i]
            if (!slot) continue
            const x = wrapCoord(slot.x + wallX, listTW / 2, listTW)
            const lastX = mesh.userData.lastX as number
            // horizontal conveyor: a plane that jumped right→entered from
            // the right edge carries the NEXT photo; jumped left→entered
            // from the left edge pulls the PREVIOUS photo (bidirectional)
            if (
              activeRef.current &&
              suppressWrap === 0 &&
              x - lastX > listTW * 0.5
            ) {
              advance(mesh)
            } else if (
              activeRef.current &&
              suppressWrap === 0 &&
              x - lastX < -listTW * 0.5
            ) {
              const k = prevIdx
              bindPlane(mesh, photoAt(k))
              prevIdx--
              dirty = true
              cbRef.current.onSeq((((k % N) + N) % N) + 1)
            }
            mesh.userData.lastX = x
            if (
              mesh.position.x !== x ||
              mesh.position.y !== 0 ||
              mesh.position.z !== 0 ||
              mesh.scale.x !== slot.w ||
              mesh.scale.y !== slot.h
            ) {
              mesh.position.set(x, 0, 0)
              setSize(mesh, slot.w, slot.h)
              dirty = true
            }
            continue
          }

          // ── OVERVIEW: vertical conveyor (collage lattice) ──
          const sl = L.slots[i]
          // y0/depth precomputed by computeLayout (row baseline + stagger /
          // curve + z-jitter) — no per-frame lattice math here
          let y = sl.y0 - s
          y = wrapCoord(y, L.cycleH / 2, L.cycleH)

          // conveyor rebind: plane scrolled off the top re-enters at the
          // bottom carrying the NEXT photo from the lap sequence.
          // Skipped while hidden (list/info).
          const lastY = mesh.userData.lastY as number
          if (
            activeRef.current &&
            suppressWrap === 0 &&
            y - lastY > L.cycleH * 0.5
          ) {
            advance(mesh)
          }
          mesh.userData.lastY = y

          const py = sl.x
          const arv = mesh.userData.ar as number
          // boundW is pure per-slot math — cached at bind time (invalidated
          // on relayout / slot reassignment); compute lazily as a fallback
          let psx = mesh.userData.bw as number | undefined
          if (psx === undefined) {
            psx = mesh.userData.bw = boundW(sl.w, arv, L.pitch)
          }
          const psy = psx / arv
          const pz = sl.depth
          if (
            mesh.position.x !== py ||
            mesh.position.y !== y ||
            mesh.position.z !== pz ||
            mesh.scale.x !== psx ||
            mesh.scale.y !== psy
          ) {
            mesh.position.set(py, y, pz)
            setSize(mesh, psx, psy)
            dirty = true
          }
        }
      }

      // breathing keeps the live wall rendering every frame; when the
      // wall is hidden (list/info) we only render on real changes
      // (dirty was never cleared before — the gate's documented intent
      // only holds if the render CONSUMES the flag)
      if (activeRef.current || dirty || firstFrames > 0 || transitioning > 0) {
        if (firstFrames > 0) firstFrames--
        renderer.render(scene, camera)
        dirty = false
      }

      // hover: card stays while the cursor is on the canvas; null hits
      // (seams) are ignored — only leaving the canvas clears it.
      // Raycast only when the pointer moved (planes also move under a
      // still cursor while scrolling — covered by `dirty` below)
    interface HoverCand {
      key: string
      mesh: THREE.Mesh
    }
      let candidate: HoverCand | null = null
      if (!activeRef.current || viewTrans || requeuing) {
        setHover(null, null, true) // view transitions reset presentation
      } else if (pointerInside && pointerMoved) {
        pointerMoved = false
        const hit = pickPlane(pointerNdc)
        if (hit) candidate = { key: hit.wp.photo.thumb, mesh: hit.mesh }
      }
      if (!pointerInside && !isCoarse) {
        setHover(null, null)
      } else if (candidate !== null) {
        if (candidate.key === pendingKey) pendingCount++
        else {
          pendingKey = candidate.key
          pendingCount = 1
        }
        pendingMesh = candidate.mesh
        if (pendingCount >= HOVER_HOLD) setHover(pendingMesh, pendingKey)
      }

      // prefetch check once per second of runtime (cheap; keeps the wrap
      // window warm without doing map lookups every frame)
      if (performance.now() - lastPrefetch > 1000) {
        lastPrefetch = performance.now()
        prefetch()
      }
    }
    raf = requestAnimationFrame(tick)

    rendererRef.current = renderer

    // DEV-only introspection for local verification (layout math, wrap
    // cursors) — never present in production builds.
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__rpWall = {
        list: () => listModeRef.current,
        uAxis: () => shared.uAxis.value,
        wallX: () => wallX,
        wallY: () => wallY,
        nextIdx: () => nextIdx,
        prevIdx: () => prevIdx,
        tw: () => listTW,
        slots: () => listSlots.map((sl) => ({ ...sl })),
        planes: () =>
          planes.map((m) => ({
            slot: m.userData.slot,
            x: m.position.x,
            y: m.position.y,
            z: m.position.z,
            w: m.scale.x,
            h: m.scale.y,
            ar: m.userData.ar,
          })),
        busy: () => requeuing,
        transitioning: () => transitioning,
        hover: () => ({
          key: hoveredKeyRef.current,
          melts: planes.map((m) => unisOf(m).uHover.value),
          colors: planes.map((m) =>
            (m.material as THREE.MeshBasicMaterial).color.getHexString(),
          ),
        }),
        roster: () =>
          rowPlanes.map((m) => ({
            rowIdx: m.userData.rowIdx,
            key:
              ((m.userData.want ?? m.userData.wp) as WallPhoto | null)?.photo
                .thumb ?? null,
            x: m.position.x,
            visible: m.visible,
          })),
      }
    }

    return () => {
      disposedRef.current = true
      setPoolRef.current = null
      restoreImplRef.current = null
      introFlyImplRef.current = null
      flushTexturesImplRef.current = null
      isBootReadyImplRef.current = null
      setDecodedImagesImplRef.current = null
      cancelImplRef.current = null
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("wheel", onWheel)
      window.removeEventListener("pointerdown", onDragDown)
      window.removeEventListener("pointermove", onDragMove)
      window.removeEventListener("pointerup", onDragUp)
      window.removeEventListener("pointercancel", onDragUp)
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerleave", onLeave)
      canvas.removeEventListener("click", onClick)
      if (jTimer) window.clearTimeout(jTimer)
      killResetTween()
      viewTrans?.kill() // kill view-transition tweens/timers, reset counter
      killRequeue() // + any requeue wave (timer + transform tweens)
      planes.forEach((m) => {
        gsap.killTweensOf(m.position)
        gsap.killTweensOf(m.scale)
        gsap.killTweensOf(m.material as THREE.MeshBasicMaterial)
        gsap.killTweensOf(unisOf(m).uHover)
        ;(m.material as THREE.MeshBasicMaterial).dispose()
      })
      geo.dispose()
      dispTex.dispose()
      texCache.forEach((t) => t?.dispose())
      texCache.clear()
      renderer.dispose()
      // NOTE: no renderer.forceContextLoss() here — React StrictMode
      // remounts this effect on the SAME canvas within milliseconds; a
      // force-lost context makes the second WebGLRenderer constructor
      // crash (getShaderPrecisionFormat returns null on a lost context),
      // unmounting the whole tree. Dead canvases release their context
      // via GC anyway; revisit only if profiling shows live-context caps.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // pool / category switch → dispatch inside the gallery:
  // list = spatial requeue (Phase 4), overview = instant re-seed.
  useEffect(() => {
    setPoolRef.current?.(pool)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool])

  useEffect(() => {
    rendererRef.current?.setClearColor(isDark ? 0x080808 : 0xfefefe, 1)
  }, [isDark])

  // ── info enter: RP hard cut (opacity 0, duration 0 — no fade) ────────
  // Layout effect so the canvas is hidden in the FIRST paint of the
  // #/info route change, together with App hiding nav/footer. Exit is
  // NOT handled here: App → restoreFromInfo re-enters the wall (return
  // park + enter-only fly-in); info→list releases ownership so the next
  // list→overview falls back to the generic fade-in.
  useLayoutEffect(() => {
    const c = canvasRef.current
    if (infoOpen) {
      // rapid re-open cancels a pending exit glide: wallY freezes where
      // it is and the next exit glides from there (the restore callback
      // dies with the tween — App's chrome simply stays hidden, correct)
      hiddenGlideRef.current = false
      cancelImplRef.current?.()
      infoCanvasRef.current = true
      if (c) {
        gsap.killTweensOf(c)
        gsap.set(c, { opacity: 0, pointerEvents: "none" })
      }
    } else if (listModeRef.current || !activeRef.current) {
      // info→list (or unmount): no restoreFromInfo will run — release the
      // canvas so the generic active fade-in takes over. Runs as a LAYOUT
      // effect, before the passive active-toggle effect → ordering safe.
      // info→overview keeps ownership until App's restoreFromInfo pops it.
      infoCanvasRef.current = false
    }
  }, [infoOpen])

  // ── active toggle → fade canvas + grow/collapse the scroll spacer ────
  // The canvas fade is skipped while the info choreography owns the
  // canvas (hard cut on enter; glide-then-hard-pop on exit). The spacer
  // always follows `active`.
  const firstRunRef = useRef(true)
  useEffect(() => {
    const c = canvasRef.current
    const s = spacerRef.current
    if (!c || !s) return
    if (firstRunRef.current) {
      firstRunRef.current = false
      gsap.set(c, { opacity: active ? 1 : 0 })
      gsap.set(s, { height: active ? cycleH * NUM_CYCLES : 0 })
      return
    }
    // canvas fade + spacer grow/collapse always tween together on one
    // clock (canvas skips the tween while the info choreography owns it)
    const chromeTo = (
      t: gsap.TweenTarget,
      vars: gsap.TweenVars,
      dur: number,
      delay = 0,
    ) =>
      gsap.to(t, {
        duration: dur,
        ease: "power2.inOut",
        overwrite: "auto",
        delay,
        ...vars,
      })
    const infoOwnsCanvas = infoCanvasRef.current
    if (active) {
      if (!infoOwnsCanvas) chromeTo(c, { opacity: 1 }, 0.5, 0.15)
      chromeTo(s, { height: cycleH * NUM_CYCLES }, 0.5, 0.15)
    } else {
      if (!infoOwnsCanvas) chromeTo(c, { opacity: 0 }, 0.35)
      chromeTo(s, { height: 0 }, 0.35)
    }
  }, [active, cycleH])

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
          zIndex: 1,
          display: "block",
          pointerEvents: active ? "auto" : "none",
        }}
      />
      {/* transparent spacer creates the scrollable document height */}
      <div ref={spacerRef} style={{ width: "100%", pointerEvents: "none" }} />
    </>
  )
}

export default forwardRef(WebGLGallery)
