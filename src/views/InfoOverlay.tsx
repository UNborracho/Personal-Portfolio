import gsap from "gsap"
import Transition from "../Transition"
import { nav, type Mode } from "../router"
import { AVATAR, type CatFilter } from "../shared"
import { mainHref } from "../components/NavBar"
import { Chars } from "../components/Chars"
import { DISPLAY, MONO, LocalTime, fadeExit } from "../ui"

const infoEnter = (el: HTMLElement) => {
  const chars = el.querySelectorAll(".info-title .intro-char")
  const blocks = el.querySelectorAll(".info-block")
  const portrait = el.querySelectorAll(".info-portrait")
  const policy = el.querySelectorAll(".info-policy")
  gsap.killTweensOf([el, ...chars, ...blocks, ...portrait, ...policy])
  gsap.set(el, { opacity: 0 })
  gsap.to(el, { opacity: 1, duration: 0.6, ease: "power2.inOut", delay: 0.7 })
  gsap.fromTo(chars, { yPercent: 110, rotate: 4 }, {
    yPercent: 0,
    rotate: 0,
    duration: 0.7,
    ease: "power2.inOut",
    stagger: 0.03,
    delay: 0.85,
  })
  gsap.fromTo(blocks, { opacity: 0, y: 14 }, {
    opacity: 1,
    y: 0,
    duration: 0.5,
    ease: "power2.inOut",
    stagger: 0.045,
    delay: 0.95,
  })
  gsap.fromTo(portrait, { scale: 1.5, opacity: 0 }, {
    scale: 1,
    opacity: 0.82,
    duration: 1,
    ease: "power2.inOut",
    delay: 1,
  })
  gsap.fromTo(policy, { opacity: 0 }, {
    opacity: 1,
    duration: 0.5,
    ease: "power2.inOut",
    delay: 1.2,
  })
}
const infoExit = fadeExit(0.5)

// INFO overlay view — extracted from App.tsx with explicit props; the
// Transition wrapper and its enter/exit choreography moved with the JSX.
export default function InfoOverlay({
  infoOpen,
  infoLayerRef,
  isDark,
  fg,
  cat,
  mode,
}: {
  infoOpen: boolean
  infoLayerRef: React.RefObject<HTMLDivElement | null>
  isDark: boolean
  fg: string
  cat: CatFilter
  mode: Mode
}) {
  return (
    <Transition show={infoOpen} enter={infoEnter} exit={infoExit}>
      <div
        ref={infoLayerRef}
        data-lenis-prevent
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 550,
          background: isDark ? "rgba(8,8,8,0.97)" : "rgba(254,254,254,0.97)",
          backdropFilter: "blur(4px)",
          display: "flex",
          flexDirection: "column",
          padding: "80px clamp(20px, 5vw, 40px) 200px",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 52,
          }}
        >
          <div
            className="info-title"
            style={{
              ...DISPLAY,
              fontSize: "clamp(48px, 6.8vw, 98px)",
              lineHeight: 0.9,
              color: fg,
            }}
          >
            <Chars
              text="Info"
              charStyle={{
                ...DISPLAY,
                fontSize: "clamp(48px, 6.8vw, 98px)",
                lineHeight: 0.9,
                color: fg,
              }}
            />
          </div>
          <button
            className="info-block"
            onClick={() => {
              // RP contact close (layout.js @29048): the contact page
              // fades ITSELF out — 1s power4.out (0.5s <800px) — and
              // the route pops in the fade's onComplete. The wall's
              // return-park fly-in then follows via restoreFromInfo.
              const el = infoLayerRef.current
              if (!el) {
                nav(mainHref(cat, mode))
                return
              }
              gsap.killTweensOf(el)
              gsap.to(el, {
                opacity: 0,
                duration: window.innerWidth >= 800 ? 1 : 0.5,
                ease: "power4.out",
                onComplete: () => nav(mainHref(cat, mode)),
              })
            }}
            style={{
              ...MONO,
              fontSize: 11,
              color: fg,
              background: "none",
              border: "1px solid var(--fg)",
              padding: "4px 10px",
              cursor: "pointer",
              marginTop: 10,
            }}
          >
            [CLOSE]
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
            gap: 48,
            maxWidth: 860,
          }}
        >
          <div>
            <div className="info-block" style={{ marginBottom: 36 }}>
              <div
                style={{
                  ...MONO,
                  fontSize: 10,
                  color: fg,
                  opacity: 0.4,
                  marginBottom: 5,
                }}
              >
                LOCAL TIME
              </div>
              <div
                style={{
                  ...DISPLAY,
                  fontSize: 28,
                  color: fg,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <LocalTime />
              </div>
            </div>
            <div className="info-block" style={{ marginBottom: 36 }}>
              <div
                style={{
                  ...MONO,
                  fontSize: 10,
                  color: fg,
                  opacity: 0.4,
                  marginBottom: 5,
                }}
              >
                CONTACT
              </div>
              <a
                href="mailto:1162844453@qq.com"
                style={{
                  ...DISPLAY,
                  fontSize: 20,
                  color: fg,
                  textDecoration: "none",
                  display: "block",
                  borderBottom: "1px solid var(--fg)",
                  paddingBottom: 8,
                }}
              >
                1162844453@QQ.COM
              </a>
            </div>
            <div className="info-block" style={{ marginBottom: 36 }}>
              <div
                style={{
                  ...MONO,
                  fontSize: 10,
                  color: fg,
                  opacity: 0.4,
                  marginBottom: 6,
                }}
              >
                BASED IN
              </div>
              <div style={{ ...MONO, fontSize: 12, color: fg }}>
                SHANGHAI, CHINA
              </div>
            </div>
            <div className="info-block" style={{ display: "flex", gap: 24 }}>
              {[
                ["GITHUB", "https://github.com/UNborracho"],
                ["UNSPLASH", "https://unsplash.com/@_vag4b0nd_"],
                ["REDNOTE", "https://xhslink.cn/m/5autIUSsSVM"],
              ].map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  data-cursor
                  style={{
                    ...MONO,
                    fontSize: 10,
                    color: fg,
                    opacity: 0.38,
                    textDecoration: "none",
                  }}
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
          <div
            style={{
              width: "100%",
              aspectRatio: "3/4",
              background: "var(--bg-soft)",
              overflow: "hidden",
            }}
          >
            <img
              className="info-portrait"
              src={AVATAR?.src ?? ""}
              alt="Photographer portrait"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                opacity: 0.82,
                willChange: "transform",
              }}
            />
          </div>
        </div>
        {/* policy pages pending — re-enable (display:flex) when URLs exist */}
        <div
          className="info-policy"
          style={{
            position: "absolute",
            bottom: 20,
            left: 40,
            display: "none",
            gap: 24,
          }}
        >
          {["PRIVACY POLICY", "COOKIE POLICY"].map((l) => (
            <span
              key={l}
              style={{
                ...MONO,
                fontSize: 9,
                color: fg,
                opacity: 0.28,
                cursor: "pointer",
              }}
            >
              {l}
            </span>
          ))}
        </div>
      </div>
    </Transition>
  )
}
