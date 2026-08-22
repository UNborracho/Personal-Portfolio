import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import gsap from "gsap"

// The two odometers share their machinery (unified from App.tsx):
// the same measure()/ResizeObserver cell-height latch and the same
// masked-column DOM; only strips, cell class and positioning math differ.
// Public APIs and rendered output stay byte-identical to the originals.

/** Cell-height latch shared by both odometers: find the first matching
 *  cell, record its offsetHeight, re-position once measured. The window
 *  resize listener is kept only where the original had one. */
function useCellMeasure(
  rootRef: React.RefObject<HTMLElement | null>,
  selector: string,
  onMeasured: () => void,
  windowResize = false,
) {
  const [cellH, setCellH] = useState(0)
  const cellHRef = useRef(0)
  useLayoutEffect(() => {
    const measure = () => {
      const cell = rootRef.current?.querySelector(
        selector,
      ) as HTMLElement | null
      if (!cell) return
      const h = cell.offsetHeight
      if (h && h !== cellHRef.current) {
        cellHRef.current = h
        setCellH(h)
        onMeasured()
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (rootRef.current) ro.observe(rootRef.current)
    if (windowResize) window.addEventListener("resize", measure)
    return () => {
      ro.disconnect()
      if (windowResize) window.removeEventListener("resize", measure)
    }
  }, [])
  return { cellH, cellHRef }
}

// RP gradMask — CSS-only soft edges on the traveling columns
const SOFT_EDGE: React.CSSProperties = {
  maskImage:
    "linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)",
  WebkitMaskImage:
    "linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)",
}

/** One masked digit column: fixed-height overflow:hidden mask, the
 *  traveling strip, per-digit cells (softEdge = the RP gradMask). */
function StripColumn({
  list,
  cellClass,
  cellH,
  digitStyle,
  stripRef,
  softEdge = false,
}: {
  list: string
  cellClass: string
  cellH: number
  digitStyle: React.CSSProperties
  stripRef?: React.Ref<HTMLSpanElement>
  softEdge?: boolean
}) {
  return (
    <span
      style={{
        display: "inline-block",
        overflow: "hidden",
        height: cellH || undefined,
        verticalAlign: "top",
        ...(softEdge ? SOFT_EDGE : {}),
      }}
    >
      <span
        ref={stripRef}
        style={{ display: "block", willChange: "transform" }}
      >
        {list.split("").map((d, j) => (
          <span
            key={j}
            className={cellClass}
            style={{ display: "block", lineHeight: 1, ...digitStyle }}
          >
            {d}
          </span>
        ))}
      </span>
    </span>
  )
}

// ── Rolling-digit Odometer ───────────────────────────────────────────────
const STRIP = "01234567890"
export interface OdometerHandle {
  to: (v: number) => void
  raw: (v: number) => void
}

export const Odometer = forwardRef<OdometerHandle, {
  digits: number
  digitStyle: React.CSSProperties
}>(function Odometer({ digits, digitStyle }, ref) {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const curRef = useRef(0)

  const { cellH, cellHRef } = useCellMeasure(
    wrapRef,
    ".od-cell",
    () => position(curRef.current),
    true,
  )

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

  return (
    <span
      ref={wrapRef}
      aria-hidden
      style={{
        display: "inline-flex",
        lineHeight: 1,
        verticalAlign: "baseline",
      }}
    >
      {Array.from({ length: digits }).map((_, i) => (
        <StripColumn
          key={i}
          list={STRIP}
          cellClass="od-cell"
          cellH={cellH}
          digitStyle={digitStyle}
        />
      ))}
    </span>
  )
})

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

export interface IntroOdometerHandle {
  raw: (v: number) => void
}

export const IntroOdometer = forwardRef<IntroOdometerHandle, {
  digitStyle: React.CSSProperties
}>(function IntroOdometer({ digitStyle }, ref) {
  const rootRef = useRef<HTMLDivElement>(null)
  const hRef = useRef<HTMLSpanElement>(null)
  const tRef = useRef<HTMLSpanElement>(null)
  const oRef = useRef<HTMLSpanElement>(null)
  const curRef = useRef(0)

  const { cellH, cellHRef } = useCellMeasure(rootRef, ".iod-cell", () =>
    position(curRef.current),
  )

  const position = (v: number) => {
    const ch = cellHRef.current
    if (!ch) return // not measured yet (or column hidden — mobile uses text)
    const hi = v >= 100 ? 1 : 0
    const ti = v >= 100 ? 10 : Math.floor(v / 10)
    const oi = Math.min(100, Math.floor(v))
    if (hRef.current) hRef.current.style.transform = `translateY(${-hi * ch}px)`
    if (tRef.current) tRef.current.style.transform = `translateY(${-ti * ch}px)`
    if (oRef.current) oRef.current.style.transform = `translateY(${-oi * ch}px)`
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

  return (
    <div
      ref={rootRef}
      data-v="0"
      aria-hidden
      style={{
        display: "inline-flex",
        lineHeight: 1,
        verticalAlign: "baseline",
      }}
    >
      <StripColumn
        list={ODOM_HUNDREDS}
        cellClass="iod-cell"
        cellH={cellH}
        digitStyle={digitStyle}
        stripRef={hRef}
      />
      <StripColumn
        list={ODOM_TENS}
        cellClass="iod-cell"
        cellH={cellH}
        digitStyle={digitStyle}
        stripRef={tRef}
        softEdge
      />
      <StripColumn
        list={ODOM_ONES}
        cellClass="iod-cell"
        cellH={cellH}
        digitStyle={digitStyle}
        stripRef={oRef}
        softEdge
      />
    </div>
  )
})
