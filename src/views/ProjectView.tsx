import { useEffect } from "react"
import type { Mode } from "../router"
import type { CatFilter, Series } from "../shared"
import NavBar from "../components/NavBar"
import { Odometer, type OdometerHandle } from "../components/Odometer"
import { DISPLAY, MONO, MetaRow } from "../ui"

// Project view — extracted from App.tsx with explicit props; scroll /
// odometer effects stay in App (they own lenis + route state).
export default function ProjectView({
  projectSeries,
  projectIndex,
  projectRef,
  projectOdomRef,
  fg,
  bg,
  isDark,
  cat,
  mode,
  infoOpen,
  onClose,
  onGoToImage,
  onToggleTheme,
}: {
  projectSeries: Series
  projectIndex: number
  projectRef: React.RefObject<HTMLDivElement | null>
  projectOdomRef: React.RefObject<OdometerHandle | null>
  fg: string
  bg: string
  isDark: boolean
  cat: CatFilter
  mode: Mode
  infoOpen: boolean
  onClose: () => void
  onGoToImage: (i: number) => void
  onToggleTheme: () => void
}) {
  const projectImages = projectSeries.photos
  // Escape goes back to the wall — mirrors the nav [ CLOSE ] button.
  // When INFO is open on top, ITS Escape handler owns the close.
  useEffect(() => {
    if (infoOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, infoOpen])
  return (
    <>
      <NavBar
        isDark={isDark}
        fg={fg}
        mode={mode}
        cat={cat}
        infoOpen={infoOpen}
        projectSeries={projectSeries}
        onClose={onClose}
        onToggleTheme={onToggleTheme}
      />
      <div style={{ position: "fixed", top: 76, left: 20, zIndex: 500 }}>
        <MetaRow
          rows={[
            ["SERIES", projectSeries.name],
            ["CATEGORY", projectSeries.category.toUpperCase()],
            ["YEAR", String(projectSeries.year)],
            ["PHOTOS", String(projectSeries.photos.length)],
          ]}
          fg={fg}
          gap={14}
          dim={0.38}
          minWidth={68}
          rowStyle={{ marginBottom: 3 }}
        />
      </div>
      <div ref={projectRef}>
        {projectImages.map((photo, i) => (
          <div
            key={photo.full}
            style={{
              height: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              background: bg,
            }}
          >
            <img
              className="project-img"
              src={photo.full}
              alt={`${projectSeries.name} ${i + 1}`}
              loading="lazy"
              style={{
                maxWidth: "85vw",
                maxHeight: "82vh",
                objectFit: "contain",
                display: "block",
                background: "var(--bg-soft)",
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: 24,
                left: 24,
                ...MONO,
                fontSize: 9,
                color: fg,
                opacity: 0.38,
              }}
            >
              {projectSeries.name} — {projectSeries.year} · {i + 1} /{" "}
              {projectImages.length}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          position: "fixed",
          right: 20,
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 7,
          zIndex: 700,
        }}
      >
        {projectImages.map((_, i) => (
          <button
            key={i}
            onClick={() => onGoToImage(i)}
            aria-label={`Go to photo ${i + 1}`}
            style={{
              border: "none",
              background: "none",
              padding: "12px 6px", // 44px-class touch target
              cursor: "pointer",
              display: "block",
            }}
          >
            <span
              style={{
                display: "block",
                width: i === projectIndex ? 20 : 10,
                height: 1,
                background: fg,
                opacity: i === projectIndex ? 1 : 0.22,
                transition: "width 0.22s ease, opacity 0.22s ease",
              }}
            />
          </button>
        ))}
      </div>
      <div
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 700,
          ...DISPLAY,
          fontSize: "clamp(48px, 6vw, 90px)",
          lineHeight: 1,
          color: fg,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <Odometer
          ref={projectOdomRef}
          digits={3}
          digitStyle={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: "clamp(48px, 6vw, 90px)",
            lineHeight: 1,
            color: fg,
          }}
        />
      </div>
    </>
  )
}
