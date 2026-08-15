import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import gsap from "gsap"
import { COL_OFFSETS, shuffled, type WallPhoto } from "./shared"

// ── Layout constants (tunable) ──────────────────────────────────────────
const NCOLS = 4
const ROWS = 9
const SLOT_COUNT = NCOLS * ROWS // 36 planes on the conveyor
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
  onPick: (w: WallPhoto) => void
}

interface Layout {
  colW: number
  pitch: number
  cycleH: number
  cols: { x: number; depth: number }[]
}

// Pitch must clear the tallest photo in the pool: height = colW / ar, so the
// worst case is the smallest aspect ratio (2:3 portrait → 1.5 × colW).
function computeLayout(vw: number, vh: number, minAr: number): Layout {
  const colW = (vw - SIDE_MARGIN * 2 - GAP * (NCOLS - 1)) / NCOLS
  const pitch = colW * Math.max(1.45, (1 / Math.max(minAr, 0.5)) * 1.12)
  const cycleH = ROWS * pitch
  const halfSpread = (vw - SIDE_MARGIN * 2) / 2
  const cols = Array.from({ length: NCOLS }, (_, c) => {
    const x = -halfSpread + colW / 2 + c * (colW + GAP)
    const xn = x / halfSpread
    const depth = CURVE * vw * xn * xn
    return { x, depth }
  })
  return { colW, pitch, cycleH, cols }
}

export default function WebGLGallery({
  active,
  pool,
  getScroll,
  isDark,
  onHover,
  onSeq,
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
  const setPoolRef = useRef<((p: WallPhoto[]) => void) | null>(null)

  // stable callback refs (so the mount effect never re-runs)
  const cbRef = useRef({ onHover, onSeq, onPick })
  cbRef.current = { onHover, onSeq, onPick }

  const hoveredKeyRef = useRef<string | null>(null)
  const lastScrollRef = useRef(0)
  const velRef = useRef(0)
  const disposedRef = useRef(false)

  // ── Mount: set up Three.js + RAF (runs once) ─────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!
    disposedRef.current = false

    const vw = window.innerWidth
    const vh = window.innerHeight

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    })
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

    // ── conveyor state ─────────────────────────────────────────────────
    let poolArr: WallPhoto[] = []
    let N = 1
    let seq: WallPhoto[] = []
    let nextIdx = 0 // photos handed out so far (starts at SLOT_COUNT)
    let lastLap = 0
    let suppressWrap = 0 // frames to ignore wrap jumps (pool/scroll resets)

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

    const ensureTex = (wp: WallPhoto) => {
      const key = wp.photo.thumb
      if (texCache.has(key)) return
      texCache.set(key, null) // loading marker
      loader.load(key, (tex) => {
        if (disposedRef.current) return
        tex.colorSpace = THREE.SRGBColorSpace
        tex.generateMipmaps = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
        texCache.set(key, tex)
        // hand it to any plane waiting on this photo
        for (const m of planes) {
          if (m.userData.want && m.userData.want.photo.thumb === key)
            bindPlane(m, m.userData.want)
        }
      })
    }

    // Opaque in steady state (transparent only during the load fade-in).
    // Opaque + depthWrite gives deterministic occlusion → no transparent
    // sort flicker, even if planes momentarily overlap.
    const bindPlane = (mesh: THREE.Mesh, wp: WallPhoto) => {
      const tex = texCache.get(wp.photo.thumb)
      if (!tex) {
        mesh.userData.want = wp // try again when the texture arrives
        ensureTex(wp)
        return
      }
      mesh.userData.want = null
      mesh.userData.wp = wp
      mesh.userData.ar = wp.photo.w / wp.photo.h
      const mat = mesh.material as THREE.MeshBasicMaterial
      const fresh = mat.map !== tex
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
      if (fresh && mat.opacity < 0.99) {
        mat.transparent = true
        gsap.to(mat, {
          opacity: 1,
          duration: 0.6,
          ease: "power2.inOut",
          onComplete: () => {
            mat.transparent = false
          },
        })
      } else {
        mat.transparent = false
        mat.opacity = 1
      }
    }

    const applyLayout = (w: number, h: number) => {
      const minAr =
        poolArr.length > 0
          ? Math.min(...poolArr.map((p) => p.photo.w / p.photo.h))
          : 1
      layoutRef.current = computeLayout(w, h, minAr)
      setCycleH(layoutRef.current.cycleH)
    }

    const setPool = (p: WallPhoto[]) => {
      poolArr = p
      N = Math.max(1, p.length)
      seq = shuffled(p, WALL_SEED) // lap 0 — matches the preloader's list
      nextIdx = SLOT_COUNT
      lastLap = 0
      suppressWrap = 3 // scroll resets to 0 → ignore the position jump
      // recompute pitch for the new pool's tallest photo — with a static
      // 1.45× pitch, tall portraits (ar < 0.69) overlap their column
      // neighbor by (height − pitch) px; equal column depths then z-fight
      // in the overlap every frame (the "sticky flicker" bug).
      applyLayout(window.innerWidth, window.innerHeight)
      for (let i = 0; i < SLOT_COUNT; i++) {
        const wp = seq[i % N] // small pools repeat within the first screen
        bindPlane(planes[i], wp)
      }
      cbRef.current.onSeq(1)
    }

    setPoolRef.current = setPool

    // ── raycasting ────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const pointerNdc = new THREE.Vector2(-2, -2)
    let pointerInside = false
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
      if (wp) cbRef.current.onPick(wp)
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

      for (const mesh of planes) {
        const i = mesh.userData.slot as number
        const col = i % NCOLS
        const row = Math.floor(i / NCOLS)
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
          cbRef.current.onSeq((nextIdx % N) + 1)
        }
        mesh.userData.lastY = y

        mesh.position.set(
          L.cols[col].x,
          y,
          L.cols[col].depth + ROW_Z_JITTER[row],
        )
        mesh.scale.set(L.colW, L.colW / (mesh.userData.ar as number), 1)
        mesh.rotation.x = Math.max(
          -MAX_TILT,
          Math.min(MAX_TILT, vel * VEL_TILT),
        )
      }
      renderer.render(scene, camera)

      // hover: card stays while the cursor is on the canvas; null hits
      // (seams) are ignored — only leaving the canvas clears it
      let candidate: string | null = null
      if (!activeRef.current) {
        setHover(null)
      } else if (pointerInside) {
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
      if (!pointerInside) {
        setHover(null)
      } else if (candidate !== null) {
        if (candidate === pendingKey) pendingCount++
        else {
          pendingKey = candidate
          pendingCount = 1
        }
        if (pendingCount >= HOVER_HOLD) setHover(pendingKey)
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
      planes.forEach((m) => {
        gsap.killTweensOf(m.material as THREE.MeshBasicMaterial)
        ;(m.material as THREE.MeshBasicMaterial).dispose()
      })
      geo.dispose()
      texCache.forEach((t) => t?.dispose())
      texCache.clear()
      renderer.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // pool / category switch → re-seed the conveyor in place
  useEffect(() => {
    setPoolRef.current?.(pool)
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
