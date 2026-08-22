import { nav, type Mode } from "../router"
import type { CatFilter, Series } from "../shared"
import { DISPLAY, FINE_POINTER, MONO, scrambleIn } from "../ui"

// ── Chrome components ─────────────────────────────────────────────────
// NOTE: these MUST live at module scope (see the remount bug note in git
// history) — useClock ticks would otherwise re-create them every second.

/** Hash of a category's main route (overview or list) — the single
 *  source for the INFO toggle, close buttons and filter picks (was four
 *  inline cat×mode ternary cascades that could drift apart). */
export function mainHref(cat: CatFilter, mode: Mode): string {
  const parts: string[] = []
  if (cat !== "all") parts.push(cat)
  if (mode === "list") parts.push("list")
  return `#/${parts.join("/")}`
}

export default function NavBar({
  headerRef,
  isDark,
  fg,
  mode,
  cat,
  infoOpen,
  projectSeries,
  onClose,
  onToggleTheme,
  onOpenInfo,
}: {
  headerRef?: React.RefObject<HTMLElement | null>
  isDark: boolean
  fg: string
  mode: Mode
  cat: CatFilter
  infoOpen: boolean
  projectSeries?: Series | null
  onClose?: () => void
  onToggleTheme: () => void
  onOpenInfo?: () => void
}) {
  // blur only on fine pointers: on phones the compositor re-blurs the nav
  // every frame over the animating canvas — one of the biggest mobile costs.
  // Coarse pointers get a flat near-opaque bar (same look at rest).
  const blurNav = FINE_POINTER
  return (
    <header
      ref={headerRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        height: 60,
        gap: 20,
        // RP nav: static veil (31% white fading down through 60%) over
        // the 4-layer navBlur frost (see .nav-frost in index.css). No
        // border — the frost is the seam. Coarse pointers keep the flat
        // near-opaque bar (4 backdrop layers over the animating canvas
        // is one of the biggest mobile compositor costs).
        background: blurNav
          ? "linear-gradient(180deg, color-mix(in srgb, var(--bg) 31%, transparent) 60%, transparent)"
          : "var(--bg)",
        borderBottom: blurNav
          ? undefined
          : "1px solid color-mix(in srgb, var(--fg) 8%, transparent)",
      }}
    >
      {blurNav && (
        <div className="nav-frost" aria-hidden="true">
          <div />
          <div />
          <div />
          <div />
        </div>
      )}
      <button
        onClick={() => nav("#/")}
        onMouseEnter={scrambleIn}
        style={{
          ...DISPLAY,
          fontSize: 13,
          color: fg,
          background: "none",
          border: "none",
          cursor: "pointer",
          whiteSpace: "nowrap",
          letterSpacing: "0.04em",
          position: "relative",
          zIndex: 1,
        }}
      >
        SPIKE HU
      </button>
      {!onClose && (
        <span
          className="nav-availability"
          style={{
            ...MONO,
            fontSize: 10,
            color: fg,
            opacity: 0.42,
            lineHeight: 1.5,
            whiteSpace: "nowrap",
            zIndex: 1,
          }}
        >
          PHOTOGRAPHER
          <br />
          AVAILABLE WORLDWIDE&nbsp;|&nbsp;BASED IN SH
        </span>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          whiteSpace: "nowrap",
          position: "relative",
          zIndex: 1,
        }}
      >
        {onClose ? (
          <>
            {projectSeries && (
              <span style={{ ...MONO, fontSize: 10, color: fg, opacity: 0.45 }}>
                {projectSeries.category.toUpperCase()} — {projectSeries.name}
              </span>
            )}
            <button
              onClick={onClose}
              style={{
                ...MONO,
                fontSize: 11,
                color: fg,
                background: "none",
                border: "1px solid var(--fg)",
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              [CLOSE]
            </button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center" }}>
              {(["overview", "list"] as Mode[]).map((m) => (
                <span key={m} style={{ display: "flex", alignItems: "center" }}>
                  <button
                    onClick={() => nav(mainHref(cat, m))}
                    onMouseEnter={scrambleIn}
                    style={{
                      ...MONO,
                      fontSize: 11,
                      color: fg,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      opacity: mode === m && !infoOpen ? 1 : 0.32,
                      padding: "0 2px",
                    }}
                  >
                    {m.toUpperCase()}
                  </button>
                  <span
                    style={{
                      ...MONO,
                      fontSize: 11,
                      color: fg,
                      opacity: 0.22,
                      padding: "0 5px",
                    }}
                  >
                    /
                  </span>
                </span>
              ))}
              <button
                onClick={() => {
                  const base = mainHref(cat, mode)
                  // RP layout.js @29048: canvas fades 0.5s power4.in
                  // BEFORE the route flips (App's openInfo chains nav)
                  if (infoOpen) nav(base)
                  else if (onOpenInfo) onOpenInfo()
                  else nav(`${base}/info`)
                }}
                onMouseEnter={scrambleIn}
                style={{
                  ...MONO,
                  fontSize: 11,
                  color: fg,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  opacity: infoOpen ? 1 : 0.32,
                  padding: "0 2px",
                }}
              >
                INFO
              </button>
            </div>
            <a
              className="nav-mail"
              href="mailto:1162844453@qq.com"
              onMouseEnter={scrambleIn}
              style={{
                ...MONO,
                fontSize: 10,
                color: fg,
                opacity: 0.45,
                textDecoration: "none",
              }}
            >
              1162844453@QQ.COM
            </a>
            <button
              onClick={onToggleTheme}
              title="Toggle theme"
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                border:
                  "1px solid color-mix(in srgb, var(--fg) 27%, transparent)",
                background: "none",
                cursor: "pointer",
                color: fg,
                fontSize: 9,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {isDark ? "○" : "●"}
            </button>
          </>
        )}
      </div>
    </header>
  )
}
