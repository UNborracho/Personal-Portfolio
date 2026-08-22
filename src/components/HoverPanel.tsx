import { seriesNumber, type WallPhoto } from "../shared"
import { DISPLAY, MONO, MetaRow } from "../ui"

export default function HoverPanel({
  wp,
  panelRef,
  fg,
  isDark,
}: {
  wp: WallPhoto
  panelRef: React.RefObject<HTMLDivElement | null>
  fg: string
  isDark: boolean
}) {
  const { series, index } = wp
  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        bottom: 190,
        left: "clamp(16px, 4vw, 40px)",
        zIndex: 500,
        // (C) theme-aware surface: dark keeps the solid card + heavy
        // drop; light drops the shadow weight and lets 4% of the wall
        // breathe through — the old one-size black fog read as dirt on
        // the light theme
        background: `color-mix(in srgb, var(--bg) ${
          isDark ? "100" : "96"
        }%, transparent)`,
        border: "1px solid color-mix(in srgb, var(--fg) 9%, transparent)",
        padding: "18px 22px 14px",
        pointerEvents: "none",
        width: "min(292px, calc(100vw - 32px))",
        boxShadow: isDark
          ? "0 8px 52px rgba(0,0,0,0.35)"
          : "0 6px 32px rgba(0,0,0,0.14)",
        opacity: 0,
        willChange: "opacity, transform",
      }}
    >
      {/* (A) RP mask reveal: each line rises out of an overflow:hidden
          mask (translateY 110% + rotate 4° → 0, staggered) — the same
          grammar as the INFO title / list cards / footer numbers */}
      <div style={{ overflow: "hidden", marginBottom: 7 }}>
        <div
          data-hp="line"
          style={{
            ...DISPLAY,
            fontSize: 54,
            lineHeight: 1,
            color: fg,
          }}
        >
          {String(seriesNumber(series)).padStart(2, "0")}
        </div>
      </div>
      <div style={{ overflow: "hidden", marginBottom: 11 }}>
        <div
          data-hp="line"
          style={{
            ...DISPLAY,
            fontSize: 14,
            color: fg,
            letterSpacing: "0.03em",
          }}
        >
          {series.name}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          marginBottom: 14,
        }}
      >
        <MetaRow
          rowAttr={{ "data-hp": "row" }}
          rows={[
            ["CATEGORY", series.category.toUpperCase()],
            ["YEAR", String(series.year)],
            ["PHOTOS", String(series.photos.length)],
            ["FRAME", `${index + 1} / ${series.photos.length}`],
          ]}
          fg={fg}
        />
      </div>
      <div
        data-hp="fin"
        style={{
          ...MONO,
          fontSize: 10,
          color: fg,
          textAlign: "right",
          borderTop: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)",
          paddingTop: 9,
        }}
      >
        [EXPLORE]
      </div>
    </div>
  )
}
