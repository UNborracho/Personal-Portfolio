# Photography Folio — Infinite WebGL Gallery

An infinite, scroll-driven photography portfolio gallery. The works grid is rendered on a `<canvas>` as a Three.js plane mesh bent along a gentle cylinder, scrolling forever via a seamless modulo loop, with scroll-velocity-driven parallax. Smooth scrolling is handled by Lenis, motion by GSAP/ScrollTrigger.

## Photos: content pipeline

All imagery comes from your own originals in `photo/` (git-ignored, ~1.1GB):

```
photo/
  BEIJING/  SHANGHAI/  SICHUAN/  YUNNAN/  DT/   # one folder = one series
  avatar/                                        # INFO-page portrait
```

```bash
pnpm photos   # photo/ → public/photos/ (webp) + regenerate src/photo-manifest.ts
```

- **thumb**: 720px long edge · webp q75 → gallery wall / WebGL textures
- **full**: 1920px long edge · webp q78 (q85 for the `DT` live series — dark-stage gradients) → project pages
- EXIF orientation auto-corrected, output names hashed (immutable caching), stale outputs pruned, series order by shutter number.

**Adding photos later**: drop files into `photo/<SERIES>/` → `pnpm photos` → commit the new `public/photos/` files + `src/photo-manifest.ts`. Nothing else to touch — the wall, routes, footer words and project pages all read the manifest.

**New series / category**: add a folder + an entry in `SERIES` at the top of `scripts/photos.mjs`, then `pnpm photos`. Series slugs must not collide with the reserved route words `p / list / index / info` (the script enforces this).

## Routes (hash router)

```
#/                      all series · overview wall
#/street #/scenery #/live   category filter · overview
#/list, #/<cat>/list    series covers strip
#/p/<series>            project view · photo 1
#/p/<series>/<n>        project view · deep link to photo n
(+ /info on any route)  INFO overlay
```

## Features

- **WebGL infinite gallery** (Three.js) — 36 planes on a 4-column masonry mapped onto a curved surface; planes recycle by `scroll % cycleHeight` so the grid loops seamlessly and never ends.
- **Scroll-velocity motion** — per-plane rotation tilt + per-row parallax driven by the (smoothed) Lenis scroll delta, `power2.inOut` easing throughout (no linear).
- **Lenis + GSAP/ScrollTrigger** — Lenis is driven by the GSAP ticker; sub-pixel scroll (`lenis.animatedScroll`) feeds the render loop for non-steppy motion.
- **Raycast interaction** — hover a plane for a spotlight + floating info card; click to open the project. While the cursor is on the canvas the card is persistent: seam crossings between planes keep the current work; only leaving the canvas (or opening a project) hides it. Switching works uses frame-hysteresis. The info card stays mounted through its fade-out (content swaps in place, never remounts).
- **Rolling-digit odometers** — footer index counter and project counter animate as rolling digit columns (`gsap.to(numObj, { val, ease })`).
- **Split-text intro** — characters animate from `{ yPercent: 100, rotate: 7 }` with a `0.03` stagger while a `0 → 100%` counter tweens in.
- **Project view** — full-screen, per-image scroll with `ScrollTrigger` fade/scale and a scrubbed odometer.
- **View transitions (reference rhythm)** — a tiny `<Transition>` component keeps views mounted through their exit animations. The WebGL gallery stays mounted for the whole main view and fades in/out via an `active` prop (canvas opacity + scroll spacer height). Every switch follows the reference site's three-phase rhythm: the outgoing view fades, a deliberate **blank beat** where only nav/footer chrome remains, then the incoming view cascades in — list cards rise with a stagger, the info title chars slide out of a mask (`yPercent 110 / rotate 4`), blocks stagger, the portrait settles from `scale 1.5`. Timings are inline in the enter/exit choreography functions in `src/App.tsx` (list pause 0.3s, info pause 0.7s).
- **Custom blurred-dot cursor** — `mix-blend-mode: difference`, morphs to a ring over interactive elements; mouse-only (touch keeps the native cursor).
- **Light / dark theme**, full-screen grain overlay, live local-time clock. Theme colors are registered CSS custom properties (`@property --bg/--fg`); the toggle runs inside `document.startViewTransition`, so the browser cross-fades old/new snapshots on the **GPU compositor** — one style recalc on the main thread, zero per-frame repaint (previously the interpolated `--bg` forced a full-document restyle every frame → jank). `main.tsx` sets `data-theme` before mount so there's no first-paint flash. Browsers without the API snap instantly.
- **Graceful fallback** — reverts to a DOM masonry when WebGL is unavailable or `prefers-reduced-motion` is set.

## Stack

React 19 · Vite 8 · Tailwind CSS v4 · TypeScript · Lenis · GSAP + ScrollTrigger · Three.js

## Getting started

```bash
pnpm install
pnpm dev      # http://localhost:8443 (respects $PORT)
pnpm build    # production build → dist/
pnpm preview  # preview the build
```

Requires Node 22 / pnpm 10 (see `.mise.toml`).

## Project structure

```
src/
  App.tsx           # views: preloader / main / project, Lenis+GSAP wiring, chrome, view-transition choreography
  WebGLGallery.tsx  # Three.js conveyor: layout, bend, modulo loop, wrap-rebind, raycast, odometer, active fade
  Cursor.tsx        # blurred-dot custom cursor
  Transition.tsx    # mount-through-exit transition wrapper (gsap enter/exit)
  router.ts         # hash router (categories, series deep links)
  shared.ts         # wall model derived from the manifest (avoids App↔Gallery circular import)
  photo-manifest.ts # AUTO-GENERATED by scripts/photos.mjs — do not edit
  index.css         # Tailwind v4 + Lenis + cursor styles
  main.tsx          # entry
scripts/photos.mjs   # photo pipeline (sharp)
```

## Tunables

Key knobs live at the top of `src/WebGLGallery.tsx`: `CURVE` (bend depth), `VEL_TILT` / `MAX_TILT` (velocity tilt), `ROW_VEL` (per-row parallax), `NUM_CYCLES` (loop length), `HOVER_HOLD` (hover hysteresis frames). Row spacing is `colW * 1.45`, computed inside `computeLayout`.
