import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import gsap from "gsap"
import { COL_OFFSETS, shuffled, type WallPhoto } from "./shared"

// ── Layout constants (tunable) ──────────────────────────────────────────
const ROWS = 9
const SLOT_COUNT = 4 * ROWS // max planes allocated; active = ncols × ROWS
const NUM_CYCLES = 10 // scroll-spacer span (~ "endless")
const GAP = 24
const SIDE_MARGIN = 40
const FOV = 50
const CURVE = 0.06 // parabolic recede depth (cylinder bend strength)
const VEL_TILT = 0.00045 // rotation.x per px of scroll velocity
const ROW_VEL = 0.01 // per-row velocity parallax (the "loose/flowing" feel)
const MAX_TILT = 0.32
const HOVER_HOLD = 2 // frames a candidate must stay stable before hover switches

/** Deterministic wall seed — the first lap's shuffle must match the
 *  preloader's preload list (App reads the same constant via wallSequence). */
export const WALL_SEED = 20260815

interface Props {
  // view activity: false → canvas fades out + spacer collapses (scroll dies)
  // while staying MOUNTED — re-entering overview fades back in.
  active: boolean
  // filtered photo pool for the current category (identity changes on cat
  // switch → the conveyor re-seeds without touching the WebGL context)
  pool: WallPhoto[]
  // fractional, sub-pixel scroll (lenis.animatedScroll)
  getScroll: () => number
  isDark: boolean
  onHover: (w: WallPhoto | null) => void
  /** position inside the current lap (1-based) → footer odometer */
  onSeq: (n: number) => void
  /** fired when a cross-dissolve finished its fade-out — App resets scroll */
  onResetScroll?: () => void
  onPick: (w: WallPhoto) => void
}

interface Layout {
  ncols: number
  colW: number
  pitch: number
  cycleH: number
  cols: { x: number; depth: number }[]
}

// Responsive column count: 2 on phones, 3 on tablets, 4 on desktop.
function ncolsFor(vw: number) {
  return vw < 640 ? 2 : vw < 1140 ? 3 : 4
}

// Pitch must clear the tallest photo in the pool: height = colW / ar, so the
// worst case is the smallest aspect ratio (2:3 portrait → 1.5 × colW).
function computeLayout(vw: number, vh: number, minAr: number): Layout {
  const ncols = ncolsFor(vw)
  const colW = (vw - SIDE_MARGIN * 2 - GAP * (ncols - 1)) / ncols
  const pitch = colW * Math.max(1.45, (1 / Math.max(minAr, 0.5)) * 1.12)
  const cycleH = ROWS * pitch
  const halfSpread = (vw - SIDE_MARGIN * 2) / 2
  const cols = Array.from({ length: ncols }, (_, c) => {
    const x = -halfSpread + colW / 2 + c * (colW + GAP)
    const xn = x / halfSpread
    const depth = CURVE * vw * xn * xn
    return { x, depth }
  })
  return { ncols, colW, pitch, cycleH, cols }
}

export default function WebGLGallery({
  active,
  pool,
  getScroll,
  isDark,
  onHover,
  onSeq,
  onResetScroll,
  onPick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const layoutRef = useRef<Layout>(
    computeLayout(window.innerWidth, window.innerHeight, 1),
  )
  const [cycleH, setCycleH] = useState(() => layoutRef.current.cycleH)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const getScrollRef = useRef(getScroll)
  getScrollRef.current = getScroll
  const setPoolRef = useRef<
    ((p: WallPhoto[], dissolve?: boolean) => void) | null
  >(null)

  // stable callback refs (so the mount effect never re-runs)
  const cbRef = useRef({ onHover, onSeq, onPick, onResetScroll })
  cbRef.current = { onHover, onSeq, onPick, onResetScroll }

  const hoveredKeyRef = useRef<string | null>(null)
  const lastScrollRef = useRef(0)
  const velRef = useRef(0)
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

    const geo = new THREE.PlaneGeometry(1, 1)
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
      // during scroll: at most 1 upload per frame (prefetch keeps the queue
      // near-empty in steady state); when idle: 2/frame to catch up fast
      const n = scrolling ? 1 : 2
      for (let i = 0; i < n && uploadQueue.length; i++) {
        renderer.initTexture(uploadQueue.shift()!)
      }
    }

    // ── conveyor state ─────────────────────────────────────────────────
    let poolArr: WallPhoto[] = []
    let N = 1
    let seq: WallPhoto[] = []
    let nextIdx = 0 // photos handed out so far (starts at active slots)
    let lastLap = 0
    let suppressWrap = 0 // frames to ignore wrap jumps (pool/scroll resets)
    let lastNcols = ncolsFor(window.innerWidth)
    let prevPoolLen = 0 // >0 after the first seed → enables staggered fade-in
    const planes: THREE.Mesh[] = []
    for (let i = 0; i < SLOT_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: null,
        transparent: false,
        depthWrite: true,
        opacity: 0,
        color: 0xffffff,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.visible = false
      mesh.userData = { slot: i, wp: null, want: null, ar: 1, lastY: 0 }
      scene.add(mesh)
      planes.push(mesh)
    }

    const evictIfNeeded = () => {
      while (texCache.size > MAX_TEX) {
        // oldest entry that is not currently bound to a visible plane
        let oldestKey: string | null = null
        let oldestAge = Infinity
        for (const [k, t] of texCache) {
          if (!t) continue // still loading
          if (
            planes.some(
              (m) =>
                m.userData.wp &&
                (m.userData.wp as WallPhoto).photo.thumb === k,
            )
          )
            continue
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

    // prefetch upcoming conveyor photos so wraps are always cache hits
    const prefetch = () => {
      if (!seq.length) return
      for (let k = 0; k < PREFETCH; k++) {
        ensureTex(seq[(nextIdx + k) % N])
      }
    }

    const ensureTex = (wp: WallPhoto) => {
      const key = wp.photo.thumb
      if (texCache.has(key)) {
        texAge.set(key, texClock++) // LRU touch
        return
      }
      texCache.set(key, null) // loading marker
      texAge.set(key, texClock++)
      loader.load(key, (tex) => {
        if (disposedRef.current) {
          tex.dispose()
          return
        }
        tex.colorSpace = THREE.SRGBColorSpace
        tex.generateMipmaps = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
        texCache.set(key, tex)
        queueUpload(tex) // GPU upload at idle, not mid-scroll
        evictIfNeeded()
        // hand it to any plane waiting on this photo (preserve the
        // crossfade stagger it was assigned — late arrivals fade too,
        // instead of popping in fully opaque)
        for (const m of planes) {
          if (
            m.userData.want &&
            (m.userData.want as WallPhoto).photo.thumb === key
          )
            bindPlane(
              m,
              m.userData.want as WallPhoto,
              !!m.userData.wantFade,
              (m.userData.wantDelay as number) ?? 0,
            )
        }
      })
    }

    // Opaque in steady state (transparent only during the load fade-in).
    // Opaque + depthWrite gives deterministic occlusion → no transparent
    // sort flicker, even if planes momentarily overlap.
    // ── category cross-dissolve state machine ─────────────────────
    // seedPool can run in two modes: instant (first mount / column
    // breakpoint re-seed) or dissolved (category switch). A dissolved
    // switch is a PER-CELL crossfade: each plane spawns a "ghost" mesh
    // carrying its OLD texture on top (fading out) while the host binds
    // the NEW photo underneath (fading in) — cells ripple diagonally,
    // the wall is never blank.
    const CROSSFADE = 0.55 // per-photo crossfade duration
    const STAGGER = 0.055 // diagonal step between cells
    let transitioning = 0 // active fade tweens (host + ghost)
    let transitionTimer = 0
    let crossFading = false

    // ghost pool: temporary planes that carry the outgoing photo
    const ghostPool: THREE.Mesh[] = []
    const liveGhosts: THREE.Mesh[] = []
    const recycleGhost = (g: THREE.Mesh) => {
      g.visible = false
      g.userData.host = null
      const i = liveGhosts.indexOf(g)
      if (i >= 0) liveGhosts.splice(i, 1)
      ghostPool.push(g)
    }
    const killGhosts = () => {
      for (const g of liveGhosts.slice()) {
        gsap.killTweensOf(g.material as THREE.MeshBasicMaterial)
        recycleGhost(g)
      }
    }
    const spawnGhost = (
      host: THREE.Mesh,
      delay: number,
    ) => {
      const hMat = host.material as THREE.MeshBasicMaterial
      if (!hMat.map || hMat.opacity < 0.5) return // host has nothing visible to ghost
      let g = ghostPool.pop()
      if (!g) {
        g = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            color: 0xffffff,
          }),
        )
        scene.add(g)
      }
      const mat = g.material as THREE.MeshBasicMaterial
      mat.map = hMat.map
      mat.needsUpdate = true
      mat.color.setHex(hMat.color.getHex()) // preserve hover-dim tint
      mat.opacity = 1
      g.visible = true
      g.renderOrder = 1 // ghost paints above its fading-in host
      g.userData.host = host
      g.position.copy(host.position)
      g.position.z += 0.6 // clear the row z-jitter toward the camera
      g.scale.copy(host.scale)
      g.rotation.copy(host.rotation)
      liveGhosts.push(g)
      transitioning++
      gsap.to(mat, {
        opacity: 0,
        duration: CROSSFADE,
        delay,
        ease: "power2.inOut",
        onComplete: () => {
          transitioning--
          recycleGhost(g!)
        },
      })
    }
    const killTransition = () => {
      if (transitionTimer) window.clearTimeout(transitionTimer)
      transitionTimer = 0
      crossFading = false
      killGhosts()
      for (const m of planes) gsap.killTweensOf(m.material as THREE.MeshBasicMaterial)
      transitioning = 0
    }

    const bindPlane = (
      mesh: THREE.Mesh,
      wp: WallPhoto,
      fadingIn = false,
      stagger = 0,
    ) => {
      const tex = texCache.get(wp.photo.thumb)
      if (!tex) {
        mesh.userData.want = wp // try again when the texture arrives
        mesh.userData.wantFade = fadingIn ? 1 : 0
        mesh.userData.wantDelay = stagger
        ensureTex(wp)
        return
      }
      mesh.userData.want = null
      mesh.userData.wp = wp
      mesh.userData.ar = wp.photo.w / wp.photo.h
      const mat = mesh.material as THREE.MeshBasicMaterial
      const firstLoad = mat.map === null
      mat.map = tex
      mat.needsUpdate = true
      mesh.visible = true
      // keep the current hover-dim state consistent after a rebind
      mat.color.setHex(
        hoveredKeyRef.current !== null &&
          hoveredKeyRef.current !== wp.photo.thumb
          ? 0x888888
          : 0xffffff,
      )
      if (firstLoad || fadingIn) {
        // fade in on first fill and on category cross-dissolve; wrap
        // rebinds happen at the invisible screen seam — no tween there
        // (churning the render list mid-scroll hitches)
        mat.transparent = true
        mat.opacity = 0 // ghost carries the old photo — host starts hidden
        gsap.killTweensOf(mat)
        transitioning++
        gsap.to(mat, {
          opacity: 1,
          duration: fadingIn ? CROSSFADE : 0.45,
          ease: "power2.inOut",
          delay: stagger,
          onComplete: () => {
            mat.transparent = false
            transitioning--
          },
        })
      } else {
        gsap.killTweensOf(mat)
        mat.transparent = false
        mat.opacity = 1
      }
    }

    const applyLayout = (w: number, h: number) => {
      const minAr =
        poolArr.length > 0
          ? Math.min(...poolArr.map((p) => p.photo.w / p.photo.h))
          : 1
      const changed = ncolsFor(w) !== lastNcols
      lastNcols = ncolsFor(w)
      layoutRef.current = computeLayout(w, h, minAr)
      setCycleH(layoutRef.current.cycleH)
      // crossing a column breakpoint → re-seed (fresh aspect spread + the
      // planes that were hidden beyond the old slot count need binding)
      if (changed) seedPool()
    }

    // (re)bind every active slot from the lap-0 sequence
    const seedPool = (dissolve = false) => {
      killTransition()
      N = Math.max(1, poolArr.length)
      seq = shuffled(poolArr, WALL_SEED) // lap 0 — matches the preloader's list
      nextIdx = layoutRef.current.ncols * ROWS
      lastLap = 0
      suppressWrap = 3 // scroll resets to 0 → ignore the position jump
      const staggered = dissolve && prevPoolLen > 0 // per-cell crossfade path
      prevPoolLen = poolArr.length
      const ncols = layoutRef.current.ncols
      for (let i = 0; i < SLOT_COUNT; i++) {
        const wp = seq[i % N]
        const col = i % ncols
        const row = Math.floor(i / ncols)
        // diagonal ripple, one cell after another — "一个一个" fade
        const delay = staggered ? (col + row) * STAGGER : 0
        const plane = planes[i]
        if (staggered) {
          // ghost carries the OLD photo on top (fades out); host below
          // binds the NEW photo and fades in on the same clock — a true
          // per-cell crossfade, wall never blank
          spawnGhost(plane, delay)
        }
        bindPlane(plane, wp, staggered, delay)
      }
      prefetch()
      cbRef.current.onSeq(1)
      if (staggered) {
        crossFading = true
        // wrap rebinds stay suppressed until every cell finished its
        // crossfade (last start + duration), then release
        const span = (ncols - 1 + ROWS - 1) * STAGGER + CROSSFADE + 0.1
        transitionTimer = window.setTimeout(() => {
          transitionTimer = 0
          crossFading = false
        }, span * 1000)
        cbRef.current.onResetScroll?.()
      }
    }

    const setPool = (p: WallPhoto[], dissolve = false) => {
      poolArr = p
      // recompute pitch for the new pool's tallest photo — with a static
      // 1.45× pitch, tall portraits (ar < 0.69) overlap their column
      // neighbor by (height − pitch) px; equal column depths then z-fight
      // in the overlap every frame (the "sticky flicker" bug).
      if (dissolve) {
        seedPool(true)
        applyLayout(window.innerWidth, window.innerHeight)
      } else {
        seedPool()
        applyLayout(window.innerWidth, window.innerHeight)
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
    let pendingCount = 0

    const setHover = (key: string | null) => {
      if (key === hoveredKeyRef.current) return
      hoveredKeyRef.current = key
      planes.forEach((m) => {
        const wp = m.userData.wp as WallPhoto | null
        const dim = key !== null && wp !== null && wp.photo.thumb !== key
        ;(m.material as THREE.MeshBasicMaterial).color.setHex(
          dim ? 0x888888 : 0xffffff,
        )
      })
      const wp =
        key !== null
          ? poolArr.find((x) => x.photo.thumb === key) ?? null
          : null
      cbRef.current.onHover(wp)
    }

    const hitAt = (clientX: number, clientY: number) => {
      ndc.x = (clientX / window.innerWidth) * 2 - 1
      ndc.y = -(clientY / window.innerHeight) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects(planes, false)
      const hit = hits.find(
        (h) =>
          (h.object as THREE.Mesh).visible &&
          ((h.object as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity > 0.5,
      )
      return hit ? ((hit.object.userData.wp as WallPhoto) ?? null) : null
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
      if (!activeRef.current) return
      const wp = hitAt(e.clientX, e.clientY)
      if (!wp) {
        if (isCoarse) setHover(null)
        return
      }
      if (isCoarse) {
        // first tap → show the series panel; second tap on the same photo
        // → open the series deep-linked to it
        if (wp.photo.thumb === hoveredKeyRef.current) cbRef.current.onPick(wp)
        else setHover(wp.photo.thumb)
      } else {
        cbRef.current.onPick(wp)
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
    const wrapY = (y: number, half: number, ch: number) =>
      ((((y + half) % ch) + ch) % ch) - half

    // per-row z jitter: even if two planes in a column ever overlap (a
    // pool with extreme aspects), they never share an exact depth →
    // stable occlusion instead of per-frame z-fighting stripes.
    const ROW_Z_JITTER = Array.from(
      { length: ROWS },
      (_, r) => ((r % 2 === 0 ? 1 : -1) * (0.2 + (r % 3) * 0.15)),
    )

    let raf = 0
    let dirty = true // at least one render on start
    let firstFrames = 3 // texture fades need a few frames even if static
    let lastPrefetch = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const L = layoutRef.current
      const scrollY = getScrollRef.current()
      const s = ((scrollY % L.cycleH) + L.cycleH) % L.cycleH
      const inst = scrollY - lastScrollRef.current
      lastScrollRef.current = scrollY
      velRef.current += (inst - velRef.current) * 0.1
      const vel = velRef.current
      if (suppressWrap > 0) suppressWrap--
      const scrolling = Math.abs(inst) > 0.5 || Math.abs(vel) > 0.3
      if (scrolling) lastScrollActivity = performance.now()
      const recentlyScrolled =
        performance.now() - lastScrollActivity < 250 || firstFrames > 0
      // GPU uploads: throttled to 1/frame while scrolling, 2/frame at rest
      drainUploads(recentlyScrolled)

      for (const mesh of planes) {
        const i = mesh.userData.slot as number
        // responsive columns: planes beyond ncols×ROWS stay hidden
        if (i >= L.ncols * ROWS) {
          if (mesh.visible) mesh.visible = false
          continue
        }
        const col = i % L.ncols
        const row = Math.floor(i / L.ncols)
        const baseY = (row - (ROWS - 1) / 2) * L.pitch + COL_OFFSETS[col]
        let y = baseY - s
        y = wrapY(y, L.cycleH / 2, L.cycleH)
        y += (row % 3) * vel * ROW_VEL // per-row velocity parallax

        // conveyor rebind: plane scrolled off the top re-enters at the
        // bottom carrying the NEXT photo from the lap sequence.
        // Skipped while hidden (list/info): collapsing the spacer jumps
        // scroll → would mass-rebind + tick the odometer invisibly.
        const lastY = mesh.userData.lastY as number
        if (
          activeRef.current &&
          !crossFading && // no wrap swaps mid-dissolve (would tear the fade)
          suppressWrap === 0 &&
          y - lastY > L.cycleH * 0.5
        ) {
          const lap = Math.floor(nextIdx / N)
          if (lap > lastLap) {
            // new lap → reshuffle so consecutive laps differ
            lastLap = lap
            seq = shuffled(poolArr, WALL_SEED + lap * 7919)
          }
          bindPlane(mesh, seq[nextIdx % N])
          nextIdx++
          dirty = true
          cbRef.current.onSeq((nextIdx % N) + 1)
        }
        mesh.userData.lastY = y

        const py = L.cols[col].x
        const pz = L.cols[col].depth + ROW_Z_JITTER[row]
        const psx = L.colW
        const psy = L.colW / (mesh.userData.ar as number)
        const prx = Math.max(-MAX_TILT, Math.min(MAX_TILT, vel * VEL_TILT))
        if (
          mesh.position.x !== py ||
          mesh.position.y !== y ||
          mesh.position.z !== pz ||
          mesh.scale.x !== psx ||
          mesh.scale.y !== psy ||
          mesh.rotation.x !== prx
        ) {
          mesh.position.set(py, y, pz)
          mesh.scale.set(psx, psy, 1)
          mesh.rotation.x = prx
          dirty = true
        }
      }

      // ghosts track their host's transform (scroll-to-top animates the
      // wall during the crossfade — a static ghost would visibly detach)
      for (let gi = liveGhosts.length - 1; gi >= 0; gi--) {
        const g = liveGhosts[gi]
        const host = g.userData.host as THREE.Mesh | null
        if (!host || !host.visible) continue
        g.position.copy(host.position)
        g.position.z += 0.6
        g.scale.copy(host.scale)
        g.rotation.copy(host.rotation)
      }

      // render only when something actually changed: still wall = zero GPU
      // work; fades (cross-dissolve / first load) always need frames
      const settling = Math.abs(vel) > 0.05
      if (dirty || settling || firstFrames > 0 || recentlyScrolled || transitioning > 0) {
        firstFrames--
        renderer.render(scene, camera)
      }

      // hover: card stays while the cursor is on the canvas; null hits
      // (seams) are ignored — only leaving the canvas clears it.
      // Raycast only when the pointer moved (planes also move under a
      // still cursor while scrolling — covered by `dirty` below)
      let candidate: string | null = null
      if (!activeRef.current) {
        setHover(null)
      } else if (pointerInside && pointerMoved) {
        pointerMoved = false
        raycaster.setFromCamera(pointerNdc, camera)
        const hits = raycaster.intersectObjects(planes, false)
        const hit = hits.find(
          (h) =>
            (h.object as THREE.Mesh).visible &&
            ((h.object as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity > 0.5,
        )
        const wp = hit ? ((hit.object.userData.wp as WallPhoto) ?? null) : null
        candidate = wp ? wp.photo.thumb : null
      }
      if (!pointerInside && !isCoarse) {
        setHover(null)
      } else if (candidate !== null) {
        if (candidate === pendingKey) pendingCount++
        else {
          pendingKey = candidate
          pendingCount = 1
        }
        if (pendingCount >= HOVER_HOLD) setHover(pendingKey)
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

    return () => {
      disposedRef.current = true
      setPoolRef.current = null
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", onResize)
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerleave", onLeave)
      canvas.removeEventListener("click", onClick)
      if (transitionTimer) window.clearTimeout(transitionTimer)
      planes.forEach((m) => {
        gsap.killTweensOf(m.material as THREE.MeshBasicMaterial)
        ;(m.material as THREE.MeshBasicMaterial).dispose()
      })
      geo.dispose()
      killGhosts()
      ghostPool.forEach((g) => {
        gsap.killTweensOf(g.material as THREE.MeshBasicMaterial)
        ;(g.material as THREE.MeshBasicMaterial).dispose()
      })
      texCache.forEach((t) => t?.dispose())
      texCache.clear()
      renderer.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // pool / category switch → re-seed the conveyor in place.
  // First run (mount) seeds instantly; every later pool change (category
  // switch) cross-dissolves. NOTE: the boolean is mountedRef itself —
  // inverting it flipped the branches (mount dissolved, switches were
  // instant → "no animation").
  const mountedRef = useRef(false)
  useEffect(() => {
    setPoolRef.current?.(pool, mountedRef.current)
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool])

  useEffect(() => {
    rendererRef.current?.setClearColor(isDark ? 0x080808 : 0xfefefe, 1)
  }, [isDark])

  // ── active toggle → fade canvas + grow/collapse the scroll spacer ────
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
    if (active) {
      gsap.to(c, {
        opacity: 1,
        duration: 0.5,
        ease: "power2.inOut",
        delay: 0.15,
        overwrite: "auto",
      })
      gsap.to(s, {
        height: cycleH * NUM_CYCLES,
        duration: 0.5,
        ease: "power2.inOut",
        delay: 0.15,
        overwrite: "auto",
      })
    } else {
      gsap.to(c, {
        opacity: 0,
        duration: 0.35,
        ease: "power2.inOut",
        overwrite: "auto",
      })
      gsap.to(s, {
        height: 0,
        duration: 0.35,
        ease: "power2.inOut",
        overwrite: "auto",
      })
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
