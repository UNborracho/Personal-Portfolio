# Photography Folio — Infinite WebGL Gallery

An infinite, scroll-driven photography portfolio gallery. The works grid is rendered on a `<canvas>` as a Three.js plane mesh bent along a gentle cylinder, scrolling forever via a seamless modulo loop, with scroll-velocity-driven parallax. Smooth scrolling is handled by Lenis, motion by GSAP/ScrollTrigger.

> Brand-free template: all copy is placeholder (`YOUR NAME`, `INFO@YOURMAIL.COM`), all imagery is loaded from Unsplash. Swap in your own to ship.

## Features

- **WebGL infinite gallery** (Three.js) — 36 planes on a 4-column masonry mapped onto a curved surface; planes recycle by `scroll % cycleHeight` so the grid loops seamlessly and never ends.
- **Scroll-velocity motion** — per-plane rotation tilt + per-row parallax driven by the (smoothed) Lenis scroll delta, using `power2.inOut` / `power4.inOut` only (no linear).
- **Lenis + GSAP/ScrollTrigger** — Lenis is driven by the GSAP ticker; sub-pixel scroll (`lenis.animatedScroll`) feeds the render loop for non-steppy motion.
- **Raycast interaction** — hover a plane for a spotlight + floating info card; click to open the project. Hover uses per-frame evaluation with change-hysteresis (no flicker at plane boundaries).
- **Rolling-digit odometers** — footer index counter and project counter animate as rolling digit columns (`gsap.to(numObj, { val, ease })`).
- **Split-text intro** — characters animate from `{ yPercent: 100, rotate: 7 }` with a `0.03` stagger while a `0 → 100%` counter tweens in.
- **Project view** — full-screen, per-image scroll with `ScrollTrigger` fade/scale and a scrubbed odometer.
- **Custom blurred-dot cursor** — `mix-blend-mode: difference`, morphs to a ring over interactive elements; mouse-only (touch keeps the native cursor).
- **Light / dark theme**, full-screen grain overlay, live local-time clock.
- **Graceful fallback** — reverts to a DOM masonry when WebGL is unavailable or `prefers-reduced-motion` is set.

## Stack

React 19 · Vite 8 · Tailwind CSS v4 · TypeScript · Lenis · GSAP + ScrollTrigger · Three.js

## Getting started

```bash
pnpm install
pnpm dev      # http://localhost:5174 (set PORT to change)
pnpm build    # production build → dist/
pnpm preview  # preview the build
```

Requires Node 22 / pnpm 10 (see `.mise.toml`).

## Project structure

```
src/
  App.tsx           # views: preloader / main / project, Lenis+GSAP wiring, chrome
  WebGLGallery.tsx  # Three.js plane grid: layout, bend, modulo loop, raycast, odometer
  Cursor.tsx        # blurred-dot custom cursor
  shared.ts         # works data + shared types (avoids App↔Gallery circular import)
  index.css         # Tailwind v4 + Lenis + cursor styles
  main.tsx          # entry
```

## Tunables

Key knobs live at the top of `src/WebGLGallery.tsx`: `CURVE` (bend depth), `VEL_TILT` / `MAX_TILT` (velocity tilt), `ROW_VEL` (per-row parallax), `pitch` (row spacing), `NUM_CYCLES` (loop length), `HOVER_HOLD` (hover hysteresis frames).
