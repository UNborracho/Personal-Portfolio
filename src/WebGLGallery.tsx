import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import gsap from 'gsap'
import { WORKS, COL_OFFSETS, type Work, type Shape } from './shared'

// ── Layout constants (tunable) ──────────────────────────────────────────
const NCOLS = 4
const ROWS = 9
export const SLOT_COUNT = NCOLS * ROWS // 36
const NUM_CYCLES = 10 // how many cycles the scroll spacer spans (~ "endless")
const GAP = 24
const SIDE_MARGIN = 40
const FOV = 50
const CURVE = 0.06 // parabolic recede depth (cylinder bend strength)
const VEL_TILT = 0.00045 // rotation.x per px of scroll velocity
const ROW_VEL = 0.010 // per-row velocity parallax (the "loose/flowing" feel)
const MAX_TILT = 0.32
const HOVER_HOLD = 2 // frames a candidate must stay stable before hover switches

const SIZE_FACTOR: Record<Shape, number> = { portrait: 4 / 3, landscape: 3 / 4, square: 1 }

interface Props {
  // fractional, sub-pixel scroll (lenis.animatedScroll) — reading window.scrollY
  // (an integer) made plane motion steppy. See App for the source.
  getScroll: () => number
  isDark: boolean
  onHover: (w: Work | null) => void
  onSlotIndex: (i: number) => void
  onPick: (w: Work) => void
}

interface Layout {
  colW: number
  pitch: number
  cycleH: number
  cols: { x: number; depth: number }[]
}

function computeLayout(vw: number, vh: number): Layout {
  const colW = (vw - SIDE_MARGIN * 2 - GAP * (NCOLS - 1)) / NCOLS
  // > portrait (4/3) so same-column planes never overlap (overlap + transparent
  // sorting was the source of the scroll flicker).
  const pitch = colW * 1.45
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

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Build slot→work mapping: 36 slots filled by repeating the (shuffled) work set
function buildSlotWork(works: Work[]): Work[] {
  const order = shuffle(works.map((_, i) => i))
  return Array.from({ length: SLOT_COUNT }, (_, i) => works[order[i % works.length]])
}

export default function WebGLGallery({ getScroll, isDark, onHover, onSlotIndex, onPick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layoutRef = useRef<Layout>(computeLayout(window.innerWidth, window.innerHeight))
  const [cycleH, setCycleH] = useState(() => layoutRef.current.cycleH)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const getScrollRef = useRef(getScroll)
  getScrollRef.current = getScroll

  // stable callback refs (so the mount effect never re-runs)
  const cbRef = useRef({ onHover, onSlotIndex, onPick })
  cbRef.current = { onHover, onSlotIndex, onPick }

  // mutable gallery state
  const slotWorkRef = useRef<Work[]>(buildSlotWork(WORKS))
  const hoveredIdRef = useRef<number | null>(null)
  const lastScrollRef = useRef(0)
  const velRef = useRef(0)
  const lastIdxRef = useRef(-1)
  const disposedRef = useRef(false)

  // ── Mount: set up Three.js + RAF (runs once) ─────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!
    disposedRef.current = false

    const vw = window.innerWidth
    const vh = window.innerHeight

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
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

    // shared unit plane geometry (per-plane Mesh + own material)
    const geo = new THREE.PlaneGeometry(1, 1)

    // textures — one per work id, loaded async
    const loader = new THREE.TextureLoader()
    const texByWorkId = new Map<number, THREE.Texture>()
    const planesByWorkId = new Map<number, THREE.Mesh[]>()

    const planes: THREE.Mesh[] = []
    const slotWork = slotWorkRef.current

    slotWork.forEach((w, i) => {
      // Opaque in steady state (transparent only during the load fade-in).
      // Opaque + depthWrite gives deterministic occlusion → no transparent
      // sort flicker, even if planes momentarily overlap.
      const mat = new THREE.MeshBasicMaterial({
        map: null,
        transparent: false,
        depthWrite: true,
        opacity: 0,
        color: 0xffffff,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.visible = false // hidden until its texture loads
      mesh.userData = { slot: i, workId: w.id, shape: w.shape }
      scene.add(mesh)
      planes.push(mesh)
      const arr = planesByWorkId.get(w.id) ?? []
      arr.push(mesh)
      planesByWorkId.set(w.id, arr)
    })

    // kick off texture loads for every work
    WORKS.forEach((w) => {
      loader.load(w.src, (tex) => {
        if (disposedRef.current) return
        tex.colorSpace = THREE.SRGBColorSpace
        tex.generateMipmaps = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
        texByWorkId.set(w.id, tex)
        // show + fade in any plane currently bound to this work, then settle
        // to opaque so steady-state rendering is depth-stable.
        planesByWorkId.get(w.id)?.forEach((m) => {
          if (m.userData.workId === w.id) {
            const mat = m.material as THREE.MeshBasicMaterial
            mat.map = tex
            mat.transparent = true
            mat.needsUpdate = true
            m.visible = true
            if (mat.opacity < 0.99) {
              gsap.to(mat, {
                opacity: 1,
                duration: 0.6,
                ease: 'power2.inOut',
                onComplete: () => {
                  mat.transparent = false
                },
              })
            } else {
              mat.transparent = false
            }
          }
        })
      })
    })

    // ── raycasting ────────────────────────────────────────────────────
    // Hover is evaluated every frame (in the render loop) against the last
    // known pointer position, with change-hysteresis — so a still cursor
    // tracks planes scrolling under it, and boundary crossings don't toggle
    // the hover (which was the info-card flicker).
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const pointerNdc = new THREE.Vector2(-2, -2) // off-screen until pointer moves
    let pointerInside = false
    let pendingId: number | null = null
    let pendingCount = 0

    const setHover = (id: number | null) => {
      if (id === hoveredIdRef.current) return
      hoveredIdRef.current = id
      planes.forEach((m) => {
        const dim = id !== null && m.userData.workId !== id
        ;(m.material as THREE.MeshBasicMaterial).color.setHex(dim ? 0x888888 : 0xffffff)
      })
      const w = id !== null ? WORKS.find((x) => x.id === id) ?? null : null
      cbRef.current.onHover(w)
    }

    const hitAt = (clientX: number, clientY: number) => {
      ndc.x = (clientX / window.innerWidth) * 2 - 1
      ndc.y = -(clientY / window.innerHeight) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects(planes, false)
      const hit = hits.find((h) => h.object.visible && (h.object.material as THREE.MeshBasicMaterial).opacity > 0.5)
      return hit ? (hit.object.userData.workId as number) : null
    }

    const onMove = (e: PointerEvent) => {
      pointerInside = true
      pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
    }
    const onLeave = () => {
      pointerInside = false
    }
    const onClick = (e: PointerEvent) => {
      const id = hitAt(e.clientX, e.clientY)
      if (id !== null) {
        const w = WORKS.find((x) => x.id === id)
        if (w) cbRef.current.onPick(w)
      }
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('click', onClick)

    // resize
    const onResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      renderer.setSize(w, h)
      setCam(w, h)
      layoutRef.current = computeLayout(w, h)
      setCycleH(layoutRef.current.cycleH)
    }
    window.addEventListener('resize', onResize)

    // ── render loop ───────────────────────────────────────────────────
    const wrapY = (y: number, half: number, cycleH: number) =>
      (((y + half) % cycleH) + cycleH) % cycleH - half

    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const L = layoutRef.current
      // sub-pixel scroll from Lenis (window.scrollY is integer → steppy)
      const scrollY = getScrollRef.current()
      const s = ((scrollY % L.cycleH) + L.cycleH) % L.cycleH
      const inst = scrollY - lastScrollRef.current
      lastScrollRef.current = scrollY
      velRef.current += (inst - velRef.current) * 0.1
      const vel = velRef.current

      for (const mesh of planes) {
        const i = mesh.userData.slot as number
        const shape = mesh.userData.shape as Shape
        const col = i % NCOLS
        const row = Math.floor(i / NCOLS)
        const baseY = (row - (ROWS - 1) / 2) * L.pitch + COL_OFFSETS[col]
        let y = baseY - s
        y = wrapY(y, L.cycleH / 2, L.cycleH)
        y += (row % 3) * vel * ROW_VEL // per-row velocity parallax
        mesh.position.set(L.cols[col].x, y, L.cols[col].depth)
        const h = L.colW * SIZE_FACTOR[shape]
        mesh.scale.set(L.colW, h, 1)
        mesh.rotation.x = Math.max(-MAX_TILT, Math.min(MAX_TILT, vel * VEL_TILT))
      }
      renderer.render(scene, camera)

      // hover: raycast last pointer pos every frame + change-hysteresis
      let candidate: number | null = null
      if (pointerInside) {
        raycaster.setFromCamera(pointerNdc, camera)
        const hits = raycaster.intersectObjects(planes, false)
        const hit = hits.find((h) => h.object.visible && (h.object.material as THREE.MeshBasicMaterial).opacity > 0.5)
        candidate = hit ? (hit.object.userData.workId as number) : null
      }
      if (candidate === pendingId) pendingCount++
      else {
        pendingId = candidate
        pendingCount = 1
      }
      if (pendingCount >= HOVER_HOLD) setHover(pendingId)

      // odometer: scroll progress through the cycle → 1..SLOT_COUNT
      const idx = 1 + Math.min(SLOT_COUNT - 1, Math.floor((s / L.cycleH) * SLOT_COUNT))
      if (idx !== lastIdxRef.current) {
        lastIdxRef.current = idx
        cbRef.current.onSlotIndex(idx)
      }
    }
    raf = requestAnimationFrame(tick)

    rendererRef.current = renderer

    return () => {
      disposedRef.current = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('click', onClick)
      planes.forEach((m) => (m.material as THREE.MeshBasicMaterial).dispose())
      geo.dispose()
      texByWorkId.forEach((t) => t.dispose())
      renderer.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── theme change → clear color ───────────────────────────────────────
  useEffect(() => {
    rendererRef.current?.setClearColor(isDark ? 0x080808 : 0xfefefe, 1)
  }, [isDark])

  const spacerHeight = cycleH * NUM_CYCLES

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', zIndex: 1, display: 'block' }}
      />
      {/* transparent spacer creates the scrollable document height */}
      <div style={{ height: spacerHeight, width: '100%', pointerEvents: 'none' }} />
    </>
  )
}
