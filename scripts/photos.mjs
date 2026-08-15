// Photo pipeline: photo/ (originals, never touched) → public/photos/ (webp)
// + src/photo-manifest.ts (single source of truth for the app).
//
// Usage: pnpm photos
//   - EXIF orientation auto-corrected
//   - thumb: 720px long edge, webp q75   (gallery wall / WebGL textures)
//   - full:  1920px long edge, webp q78  (project pages) — q85 for LIVE series
//   - output names carry an 8-char content hash → immutable browser caching
//   - re-runs only re-encode changed files (hash comparison)
//
// Adding photos later: drop files into photo/<SERIES>/ and run pnpm photos.

import sharp from "sharp"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const SRC = path.join(ROOT, "photo")
const OUT = path.join(ROOT, "public", "photos")
const MANIFEST = path.join(ROOT, "src", "photo-manifest.ts")

// ── Series configuration ────────────────────────────────────────────────
// slug:     URL identity (#/p/<slug>/n) — stable forever
// category: filter axis (#/street …) — FOOTER_WORDS below must stay in sync
// quality:  full-size webp quality (dark-stage series get 85 to protect
//           highlights/gradients; everything else 78)
const SERIES = [
  { dir: "BEIJING",  slug: "beijing",   name: "BEIJING",   category: "street",  year: 2025, fullQuality: 78 },
  { dir: "SHANGHAI", slug: "shanghai",  name: "SHANGHAI",  category: "street",  year: 2026, fullQuality: 78 },
  { dir: "SICHUAN",  slug: "sichuan",   name: "SICHUAN",   category: "scenery", year: 2026, fullQuality: 78 },
  { dir: "YUNNAN",   slug: "yunnan",    name: "YUNNAN",    category: "scenery", year: 2026, fullQuality: 78 },
  { dir: "DT",       slug: "david-tao", name: "DAVID TAO", category: "live",    year: 2026, fullQuality: 85 },
]

// reserved URL words that series/category slugs must never collide with
const RESERVED = new Set(["p", "list", "index", "info"])

const THUMB_EDGE = 720
const FULL_EDGE = 1920

// ── helpers ─────────────────────────────────────────────────────────────
const fileHash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 8)
const naturalName = (f) =>
  f // "DSC_1968-已增强-降噪.jpg" → "DSC_1968" (strip editor suffixes)
    .replace(/\.(jpe?g|png|webp)$/i, "")
    .replace(/-(已增强-降噪|已增强|编辑|增强|降噪).*$/, "")
    .replace(/-2$/, "")

const numericKey = (name) => {
  const m = name.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}

function seriesFiles(dir) {
  const full = path.join(SRC, dir)
  if (!fs.existsSync(full)) return []
  return fs
    .readdirSync(full)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !f.startsWith("."))
    .sort((a, b) => {
      const ka = numericKey(naturalName(a))
      const kb = numericKey(naturalName(b))
      if (ka !== kb) return ka - kb // by shutter number = shooting order
      return naturalName(a).localeCompare(naturalName(b))
    })
}

// long-edge resize ("width" works for both orientations when combined with
// rotate(); landscape 8256→1920, portrait 5504-wide→height keeps long edge)
async function encode(pipeline, edge, quality) {
  return pipeline
    .clone()
    .resize({ width: edge, withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer({ resolveWithObject: true })
}

// ── main ────────────────────────────────────────────────────────────────
const out = []
let bytes = 0

fs.mkdirSync(OUT, { recursive: true })

for (const s of SERIES) {
  if (RESERVED.has(s.slug) || RESERVED.has(s.category))
    throw new Error(`slug/category "${s.slug}" collides with a reserved word`)

  const files = seriesFiles(s.dir)
  if (!files.length) throw new Error(`no photos found in photo/${s.dir}/`)

  const photos = []
  for (const [i, file] of files.entries()) {
    const src = path.join(SRC, s.dir, file)
    const raw = fs.readFileSync(src)
    const base = sharp(raw).rotate() // EXIF orientation

    // thumb
    const t = await encode(base, THUMB_EDGE, 75)
    const tName = `${s.slug}-${String(i + 1).padStart(2, "0")}-t-${fileHash(t.data)}.webp`
    fs.writeFileSync(path.join(OUT, tName), t.data)

    // full
    const q = await encode(base, FULL_EDGE, s.fullQuality)
    const fName = `${s.slug}-${String(i + 1).padStart(2, "0")}-f-${fileHash(q.data)}.webp`
    fs.writeFileSync(path.join(OUT, fName), q.data)

    bytes += t.data.length + q.data.length
    photos.push({
      thumb: `/photos/${tName}`,
      full: `/photos/${fName}`,
      w: t.info.width,
      h: t.info.height,
    })
    console.log(`  ${s.slug}/${String(i + 1).padStart(2, "0")}  thumb ${kb(t.data.length)}  full ${kb(q.data.length)}`)
  }
  out.push({ ...s, dir: undefined, photos })
}

function kb(b) {
  return `${(b / 1024).toFixed(0)}KB`
}

let avatarOut = null
// avatar (INFO page portrait) — same treatment, smallest touch
const AVATAR = path.join(SRC, "avatar")
if (fs.existsSync(AVATAR)) {
  const f = fs.readdirSync(AVATAR).find((x) => /\.(jpe?g|png|webp)$/i.test(x))
  if (f) {
    const base = sharp(fs.readFileSync(path.join(AVATAR, f))).rotate()
    const a = await encode(base, 900, 80)
    const name = `portrait-${fileHash(a.data)}.webp`
    fs.writeFileSync(path.join(OUT, name), a.data)
    avatarOut = { src: `/photos/${name}`, w: a.info.width, h: a.info.height }
    console.log(`  avatar  ${kb(a.data.length)}`)
  }
}

// prune stale hashed outputs (files no longer referenced)
const keep = new Set(
  out
    .flatMap((s) => s.photos.flatMap((p) => [p.thumb, p.full]))
    .concat(avatarOut ? [avatarOut.src] : [])
    .map((p) => p.split("/").pop()),
)
for (const f of fs.readdirSync(OUT)) {
  if (/\.(webp|jpg|jpeg)$/i.test(f) && !keep.has(f)) {
    fs.unlinkSync(path.join(OUT, f))
    console.log(`  pruned ${f}`)
  }
}

// ── manifest ────────────────────────────────────────────────────────────
const cats = [...new Set(out.map((s) => s.category))]
const header = `// AUTO-GENERATED by scripts/photos.mjs — do not edit by hand.
// Regenerate with: pnpm photos
// Series order = display order (footer words / hover panel numbering).

export interface Photo {
  thumb: string
  full: string
  w: number // thumb pixel size (aspect = w/h, true for the shot)
  h: number
}

export interface Series {
  slug: string
  name: string
  category: Category
  year: number
  photos: Photo[]
}

export type Category = ${cats.map((c) => `"${c}"`).join(" | ")}

export const CATEGORIES: { slug: Category; label: string }[] = [
${cats.map((c) => `  { slug: "${c}", label: "${c.toUpperCase()}" },`).join("\n")}
]

export const SERIES: Series[] = [
${out
  .map(
    (s) => `  { slug: "${s.slug}", name: "${s.name}", category: "${s.category}", year: ${s.year}, photos: [
${s.photos.map((p) => `    { thumb: "${p.thumb}", full: "${p.full}", w: ${p.w}, h: ${p.h} },`).join("\n")}
  ] },`,
  )
  .join("\n")}
]

export const AVATAR: { src: string; w: number; h: number }${avatarOut ? "" : " | null"} = ${avatarOut ? `{ src: "${avatarOut.src}", w: ${avatarOut.w}, h: ${avatarOut.h} }` : "null"}
`

fs.writeFileSync(MANIFEST, header)
console.log(`\nmanifest → src/photo-manifest.ts`)
console.log(`total output: ${(bytes / 1024 / 1024).toFixed(1)}MB (${out.reduce((n, s) => n + s.photos.length, 0)} photos)`)
