// Masked split-text chars (intro / INFO title) — moved verbatim from
// App.tsx; no imports needed (JSX automatic runtime).

// ── Masked split-text chars (intro) ──────────────────────────────────────
export function Chars({
  text,
  charStyle,
}: {
  text: string
  charStyle?: React.CSSProperties
}) {
  return (
    <span
      style={{
        display: "inline-block",
        overflow: "hidden",
        verticalAlign: "top",
      }}
    >
      {text.split("").map((ch, i) => (
        <span
          key={i}
          className="intro-char"
          style={{
            display: "inline-block",
            // NOTE no willChange — ~50 intro chars each pinned a Safari
            // compositing layer through the whole load, then the layer
            // tree collapsed AT the explode (mid-animation stall). RP's
            // SplitText chars carry no willChange either.
            ...charStyle,
          }}
        >
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </span>
  )
}
