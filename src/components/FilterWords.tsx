import { CATEGORIES, type CatFilter } from "../shared"
import { DISPLAY } from "../ui"

// ── Footer filter words ──────────────────────────────────────────────────
// static — hoisted to module scope (was rebuilt on every render)
interface WordEntry {
  slug: CatFilter
  label: string
}
const WORDS: WordEntry[] = [
  { slug: "all", label: "all" },
  ...CATEGORIES.map((c) => ({ slug: c.slug as CatFilter, label: c.slug })),
]

export default function FilterWords({
  cat,
  fg,
  onPick,
}: {
  cat: CatFilter
  fg: string
  onPick: (c: CatFilter) => void
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "clamp(8px, 1.8vw, 18px)",
        whiteSpace: "nowrap",
      }}
    >
      {WORDS.map((w, i) => (
        <span
          key={w.slug}
          style={{ display: "inline-flex", alignItems: "baseline" }}
        >
          <button
            data-cursor
            onClick={() => onPick(w.slug)}
            style={{
              ...DISPLAY,
              // user: not bold — medium weight, the 500 face above
              fontWeight: 500,
              fontSize: "clamp(22px, 4.6vw, 64px)",
              lineHeight: 0.9,
              color: fg,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              opacity: cat === w.slug ? 1 : 0.38,
              transition: "opacity 0.22s ease",
              textDecoration: cat === w.slug ? "underline" : "none",
              textDecorationThickness: 1.5,
              textUnderlineOffset: 8,
            }}
            onMouseEnter={(e) => {
              if (cat !== w.slug) e.currentTarget.style.opacity = "0.7"
            }}
            onMouseLeave={(e) => {
              if (cat !== w.slug) e.currentTarget.style.opacity = "0.38"
            }}
          >
            {/* mask wrapper — the list-enter effect rises each word out
                of its own clip (same reveal grammar as the hover card) */}
            <span
              style={{
                display: "inline-block",
                overflow: "hidden",
                verticalAlign: "bottom",
              }}
            >
              <span data-fw style={{ display: "inline-block" }}>
                {w.label}
              </span>
            </span>
          </button>
          {i < WORDS.length - 1 ? (
            <span style={{ opacity: 0.3, marginLeft: "0.45em" }} aria-hidden>
              ,
            </span>
          ) : null}
        </span>
      ))}
    </div>
  )
}
