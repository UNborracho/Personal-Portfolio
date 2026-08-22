import { WALL_SEED } from "../gallery-flags"

// Pure layout math for the WebGL photo wall — NO three.js dependency
// (types aside): deterministic collage lattice, responsive column
// buckets, and the filmstrip size rule. Everything here is a pure
// function of (vw, vh, seed) so the wall renders identically every
// visit.

// ── Layout constants (tunable) ──────────────────────────────────────────
const ROWS = 9
export const SLOT_COUNT = 4 * ROWS // max planes allocated; active = ncols × ROWS
export const NUM_CYCLES = 10 // scroll-spacer span (~ "endless")
export const GAP = 24
export const SIDE_MARGIN = 28
export const FOV = 50
const CURVE = 0.06 // parabolic recede depth (cylinder bend strength)
export const HOVER_HOLD = 2 // frames a candidate must stay stable before hover switches

export interface Layout {
  ncols: number // list strip sizing (responsive bucket)
  colW: number // list slot width base (≈ collage unit)
  pitch: number // overview row rhythm
  cycleH: number // overview wrap modulus = rowN × pitch
  count: number // overview lattice slots (planes beyond stay hidden)
  rowN: number
  /** slots are fully precomputed: x/w/row + y0 (row baseline incl. the
   * seeded stagger) + depth (curve recede + per-row z jitter) — the tick
   * loop reads these without recomputing per plane per frame */
  slots: Slot[]
}

export interface Slot {
  x: number
  y0: number
  w: number
  row: number
  depth: number
}

// ── RP collage lattice (overview) ────────────────────────────────────────
// Greedy row-packing of seeded-width slots replaces the fixed column
// grid: rows naturally hold 3–5 photos of differing widths (RP overview
// look — measured from the reference screenshot: mixed 19–32% widths,
// ~50px vertical rhythm, interleaved rows, no overlap). The lattice is
// STATIC (slots own x/w/row; photos flow through them on wrap) so the
// conveyor semantics are untouched.
const COL_H_GAP = 0.14 // ×unit horizontal gap between slots in a row
const ROW_PITCH = 1.62 // ×unit vertical row rhythm (user: breathe more)
const ROW_STAGGER = 0.08 // ×pitch seeded per-row vertical offset (±)
const SLOT_H_CAP = 0.76 // ×pitch max photo height (overlap-safe bound)
const PHOTO_SCALE = 0.8 // global photo size ≈ ×unit/list-slot width (user: −20%)
const ROW_BUDGET_LO = 0.88 // per-row width budget floor (×budget)
const ROW_BUDGET_SWING = 0.2 // seeded budget swing above the floor
const TAIL_ABSORB_MAX = 0.65 // ×unit max extra width the last slot absorbs

// deterministic lattice rng — same wall, same collage, every visit
const latHash = (n: number) => {
  let t = (n + WALL_SEED * 374761393) | 0
  t = Math.imul(t ^ (t >>> 13), 1274126177)
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296
}
// seeded per-row vertical offset (the lattice's ragged rhythm)
const rowOffsetOf = (row: number, pitch: number) =>
  (latHash(row * 7919 + 11) - 0.5) * 2 * ROW_STAGGER * pitch
// per-row z jitter: overlapping planes never share an exact depth →
// stable occlusion instead of z-fighting stripes (folded into slot.depth
// by computeLayout — the tick reads the precomputed value)
const zJitterOf = (row: number) =>
  (row % 2 === 0 ? 1 : -1) * (0.2 + (row % 3) * 0.15)
// bound a photo's width for its slot: natural width unless the photo's
// height would exceed the cap (portrait in a wide slot renders smaller,
// natural aspect preserved — RP never crops in overview)
export const boundW = (slotW: number, ar: number, pitch: number) =>
  Math.min(slotW, SLOT_H_CAP * pitch * Math.max(ar, 0.4))

// list strip slot size rule (RP): landscape (ar ≥ 1.1) → colW×0.96,
// row-shaped → colW×0.77 (colW = unit, already PHOTO_SCALEd).
export const stripW = (ar: number, colW: number) =>
  ar >= 1.1 ? colW * 0.96 : colW * 0.77

// Responsive column count: 2 on phones, 3 on tablets, 4 on desktop.
export function ncolsFor(vw: number) {
  return vw < 640 ? 2 : vw < 1140 ? 3 : 4
}

// wrap a coordinate into [-half, ch-half) — the conveyor modulus used
// by BOTH axes (overview rows cycle on y, filmstrip slots cycle on x)
export const wrapCoordOf = (v: number, half: number, ch: number) =>
  ((((v + half) % ch) + ch) % ch) - half

export function computeLayout(vw: number, vh: number): Layout {
  const ncols = ncolsFor(vw)
  // unit ≈ average photo width → ~4.2 slots per row desktop (RP mix);
  // PHOTO_SCALE shrinks photos ~20% → more slots per row (denser, fuller)
  const unit = ((vw - SIDE_MARGIN * 2) / (ncols + 0.35)) * PHOTO_SCALE
  const pitch = unit * ROW_PITCH
  const halfSpread = (vw - SIDE_MARGIN * 2) / 2
  const budget = vw - SIDE_MARGIN * 2
  const hGap = Math.max(10, unit * COL_H_GAP)
  const maxCount = ncols <= 2 ? 20 : 36 // mobile keeps the LRU headroom
  // seeded per-row budget factor → rows hold a varying 4–5 (RP rhythm);
  // phones clamp the floor so a row never degrades to a lone photo
  const rowBudget = (r: number) =>
    budget *
    ((ncols <= 2 ? 0.92 : ROW_BUDGET_LO) +
      ROW_BUDGET_SWING * latHash(r * 31 + 5))
  // pack generously, then cut at the last COMPLETE row that fits the
  // plane budget — no orphan half-rows in the lattice
  const all: Slot[] = []
  let cursor = 0
  let row = 0
  // row-closure normalization: ragged LEFT edge, FLUSH right edge (RP).
  // 1) overshoot (budget factor >1 can push past the edge) → trim tail;
  // 2) leftover → tail absorbs up to TAIL_ABSORB_MAX;
  // 3) remainder → spread equally across the row (a few px each — the
  //    ragged rhythm survives, the dead right margin does not).
  const closeRow = (rowStart: number) => {
    const n = all.length - rowStart
    if (n <= 0) return
    let last = all[all.length - 1]
    let right = last.x + last.w / 2
    if (right > halfSpread) {
      const shrink = Math.min(right - halfSpread, last.w - 0.5 * unit)
      last.w -= shrink
      last.x -= shrink / 2
      right -= shrink
    }
    let leftover = halfSpread - right
    if (leftover > 0.5) {
      const absorb = Math.min(leftover, TAIL_ABSORB_MAX * unit)
      last.w += absorb
      last.x += absorb / 2
      leftover -= absorb
      if (leftover > 0.5) {
        const d = leftover / n
        for (let k = rowStart; k < all.length; k++) all[k].w += d
        let cx = -halfSpread
        for (let k = rowStart; k < all.length; k++) {
          all[k].x = cx + all[k].w / 2
          cx += all[k].w + hGap
        }
      }
    }
  }
  for (let i = 0; i < maxCount * 2; i++) {
    // ~25% portrait-class slots; width jitter ±~17% → ragged organic mix
    const portrait = latHash(i * 131 + 7) < 0.25
    const jit = 0.85 + 0.35 * latHash(i * 977 + 3)
    const w = (portrait ? 0.72 : 1.0) * unit * jit
    if (cursor > 0 && cursor + w > rowBudget(row)) {
      closeRow(all.findIndex((s) => s.row === row))
      cursor = 0
      row++ // row full → interleave the next one
    }
    const x = -halfSpread + cursor + w / 2
    const xn = x / halfSpread
    // depth = curve recede + per-row z jitter, folded here so the tick
    // never recomputes it per plane per frame
    all.push({
      x,
      y0: 0,
      w,
      row,
      depth: CURVE * vw * xn * xn + zJitterOf(row),
    })
    cursor += w + hGap
  }
  // complete-row cut ≤ maxCount
  const rowTotals = new Map<number, number>()
  for (const s of all) rowTotals.set(s.row, (rowTotals.get(s.row) ?? 0) + 1)
  let acc = 0
  let count = 0
  let rowN = 0
  for (let r = 0; r <= row; r++) {
    acc += rowTotals.get(r) ?? 0
    if (acc > maxCount) break
    count = acc
    rowN = r + 1
  }
  const slots = all.slice(0, count)
  // y0 = centered row baseline + seeded stagger (needs rowN, so it is
  // folded in AFTER the complete-row cut — the tick and the fly-in
  // finish math read the same precomputed value)
  for (const s of slots)
    s.y0 = (s.row - (rowN - 1) / 2) * pitch + rowOffsetOf(s.row, pitch)
  return {
    ncols,
    colW: unit,
    pitch,
    cycleH: rowN * pitch,
    count,
    rowN,
    slots,
  }
}
