import { describe, expect, it } from "vitest"
import {
  boundW,
  computeLayout,
  ncolsFor,
  stripW,
  wrapCoordOf,
  SLOT_COUNT,
  SIDE_MARGIN,
} from "./layout"

// computeLayout is a pure function of (vw, vh, WALL_SEED): same input,
// byte-identical lattice — the wall renders the same every visit. These
// tests pin the structural invariants the tick loop silently assumes.

describe("ncolsFor", () => {
  it("buckets 2 / 3 / 4 columns", () => {
    expect(ncolsFor(320)).toBe(2)
    expect(ncolsFor(639)).toBe(2)
    expect(ncolsFor(640)).toBe(3)
    expect(ncolsFor(1139)).toBe(3)
    expect(ncolsFor(1140)).toBe(4)
    expect(ncolsFor(1920)).toBe(4)
  })
})

describe("stripW", () => {
  it("sizes landscape ≥1.1 at 0.96, row-shaped below at 0.77", () => {
    expect(stripW(1.1, 100)).toBe(96)
    expect(stripW(2, 100)).toBe(96)
    expect(stripW(1.09, 100)).toBeCloseTo(77)
    expect(stripW(0.5, 100)).toBeCloseTo(77)
  })
})

describe("boundW", () => {
  it("keeps natural width when under the height cap", () => {
    expect(boundW(50, 2, 100)).toBe(50)
  })

  it("clamps portrait width to the cap and floors ar at 0.4", () => {
    expect(boundW(300, 0.5, 100)).toBeCloseTo(38) // 0.76×100×0.5
    expect(boundW(300, 0.2, 100)).toBeCloseTo(0.76 * 100 * 0.4)
  })
})

describe("wrapCoordOf", () => {
  it("always lands in [-half, ch-half)", () => {
    for (let i = 0; i < 500; i++) {
      const v = (Math.sin(i * 12.9898) * 43758.5453) % 5000
      const r = wrapCoordOf(v, 100, 240)
      expect(r).toBeGreaterThanOrEqual(-100)
      expect(r).toBeLessThan(140)
    }
  })

  it("is idempotent", () => {
    const v = 1234.5
    expect(wrapCoordOf(wrapCoordOf(v, 100, 240), 100, 240)).toBeCloseTo(
      wrapCoordOf(v, 100, 240),
    )
  })
})

describe("computeLayout", () => {
  const L = computeLayout(1440, 900)
  const halfSpread = (1440 - SIDE_MARGIN * 2) / 2

  it("is deterministic (seeded)", () => {
    expect(computeLayout(1440, 900)).toEqual(L)
  })

  it("cuts at the last complete row within the plane budget", () => {
    expect(L.count).toBeLessThanOrEqual(SLOT_COUNT)
    expect(L.slots).toHaveLength(L.count)
    expect(L.rowN).toBe(L.slots[L.count - 1].row + 1)
    const rows = new Set(L.slots.map((s) => s.row))
    for (let r = 0; r < L.rowN; r++) expect(rows.has(r)).toBe(true)
  })

  it("keeps every slot inside the side margins", () => {
    for (const s of L.slots) {
      expect(s.x - s.w / 2).toBeGreaterThanOrEqual(-halfSpread - 1)
      expect(s.x + s.w / 2).toBeLessThanOrEqual(halfSpread + 1)
    }
  })

  it("gives each row one shared baseline with pitch-rhythmed rows", () => {
    const byRow = new Map<number, Set<number>>()
    for (const s of L.slots) {
      const set = byRow.get(s.row) ?? new Set<number>()
      set.add(s.y0)
      byRow.set(s.row, set)
    }
    const baselines: number[] = []
    for (const [row, set] of byRow) {
      expect(set.size).toBe(1) // one shared y0 per row
      baselines[row] = [...set][0]
    }
    for (let r = 1; r < L.rowN; r++) {
      // stagger is ±8% of pitch → gap within pitch ± 2×8%
      const gap = baselines[r] - baselines[r - 1]
      expect(Math.abs(gap - L.pitch)).toBeLessThanOrEqual(0.16 * L.pitch + 1e-9)
    }
  })

  it("derives cycleH from rowN × pitch", () => {
    expect(L.cycleH).toBeCloseTo(L.rowN * L.pitch)
  })

  it("keeps mobile within its smaller budget", () => {
    const M = computeLayout(375, 700)
    expect(M.ncols).toBe(2)
    expect(M.count).toBeLessThanOrEqual(20)
    expect(Number.isFinite(M.slots[0].depth)).toBe(true)
  })
})
