# SPIKE HU — Photography Folio

[English](README.md) | [简体中文](README.zh-CN.md)

[![React](https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite_8-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Three.js](https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=white)](https://threejs.org)
[![GSAP](https://img.shields.io/badge/GSAP_3-88CE02?style=for-the-badge&logo=greensock&logoColor=white)](https://gsap.com)

## What is this

An infinite, scroll-driven photography portfolio. The gallery is a Three.js plane conveyor bent along a gentle cylinder — scrolling forever, every wrapped plane carrying the next photo from a shuffled lap sequence. One lap = every photo, no repeats; the next lap reshuffles. Lenis drives the smooth scroll, GSAP the choreography, and every animation is a 1:1 recreation of the reference site's decompiled timing. Live at **[portfolio.vagab0nd.site](https://portfolio.vagab0nd.site)**.

| Overview wall | List · film strip |
| --- | --- |
| ![overview wall](docs/02-wall.png) | ![list view](docs/03-list.png) |
| **Project · series page** | **Hover · series card** |
| ![project view](docs/04-project.png) | ![hover card](docs/06-hover.png) |
| **Preloader · real progress** | **INFO overlay** |
| ![preloader](docs/01-preloader.png) | ![info overlay](docs/05-info.png) |

## Features

- **Conveyor gallery** — 36 planes on a 4-column curved layout with true aspect ratios (no distortion, no overlap); planes scrolling off re-enter bound to the next photo of the lap.
- **RP-faithful motion system** — intro chip → sequential stack pop, overview/list spatial morphs, filter switches with one 1.4s clock (all timing decompiled from the reference; spec in `docs/animation-spec.md`).
- **Real-progress preloader** — the counter can never outrun actual bytes: progress is clamped to the first-lap thumbs the wall itself will bind.
- **Raycast interaction** — hover for a floating series card; click deep-links into the series at that exact photo.
- **View transitions** — the WebGL gallery stays alive across mode switches; every transition follows the reference rhythm.
- **The details** — rolling-digit odometers, custom difference-blend cursor, GPU theme flip inside `startViewTransition`, film grain, live clock, DOM-masonry fallback when WebGL is unavailable.

## Photos: one command

Originals live in `photo/` (git-ignored). `pnpm photos` → optimized WebP (`public/photos/`) + a regenerated manifest — wall, routes, project pages all read the manifest, nothing else to touch.

```
photo/
  BEIJING/  SHANGHAI/  SICHUAN/  YUNNAN/  DT/   # one folder per series
  avatar/                                        # INFO-page portrait
```

- **thumb** — 960px long edge · q78 → gallery wall
- **full** — 2560px long edge · q80 (q85 for the dark-stage live series) → project pages
- EXIF orientation corrected, content-hashed names (immutable caching), stale outputs pruned

## Quick start

```bash
pnpm install
pnpm dev      # http://localhost:8443 (respects $PORT)
pnpm build    # production build → dist/
pnpm photos   # regenerate web derivatives + manifest from photo/
```

Requires Node ≥ 22.12 / pnpm (`.mise.toml`).

## Structure

```
src/
  App.tsx           # views: preloader / main / project, transitions, chrome
  WebGLGallery.tsx  # Three.js conveyor: layout, bend, wrap-rebind, raycast
  router.ts         # hash router (category filters, series deep links)
  shared.ts         # wall model derived from the manifest
  photo-manifest.ts # AUTO-GENERATED — do not edit
scripts/photos.mjs  # photo pipeline (sharp)
docs/
  animation-spec.md # animation spec, decompiled grammar records (Chinese)
```

Key knobs live at the top of `src/WebGLGallery.tsx`: `CURVE`, `VEL_TILT`, `MAX_TILT`, `ROW_VEL`, `NUM_CYCLES`, `INTRO_EXPLODE`.

## Deploying

Push to `main` → Vercel builds → custom domain. Hash routing keeps every deep link (`#/p/david-tao/9`) working on any static host, zero server config.

## License

All photographs are the photographer's own work — © 2026 Spike Hu, all rights reserved. Code is private.
