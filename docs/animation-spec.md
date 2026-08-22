# Spec: RP (richardprescott.com) Animation Replication — Phases 0–6

Work under review: uncommitted working-tree changes vs HEAD (5c42da7).
Files: src/App.tsx, src/WebGLGallery.tsx, src/index.css, RULES.md (new).

## Phase 0 — Shader foundation
- Dual shader injection via onBeforeCompile on MeshBasicMaterial (all 36 planes).
- Vertex channels: curtain bend `z += cos(pos.y/uViewport.y * PI * 1.8) * uSpeed`; curl wave `z += sin(pos.y/uViewport.y*PI + uTime) * 2.0 * uCurl`; ripple `x += cos(pos.y + uTime*5.0) * 0.3 * uAnim`; idle breathing `z += cos(position.y + uTime) * uBreath`.
- Fragment: CoverUV cover-fit (aspect-safe morphing) + displacement liquid hover: two textures sampled at pos1/pos2 with rotation(±45°/-135°) * disp * 0.6, mixed by uHover; displacement = 128² code-generated value-noise DataTexture (no external asset).
- Identity at rest: all new uniforms 0 → rendering byte-identical to plain material.
- R4 shader rules: verify against three r185 chunk sources (project_vertex, map_fragment verbatim), #ifdef USE_MAP guard (map can be null at blank beats), customProgramCacheKey without program cross-contamination.
- Uniform plumbing: uImageRes on bind (photo w/h), uResolution on tick (plane scale), uViewport on resize.
- Geometry: PlaneGeometry(1,1,16,16) — photos must bend THEMSELVES (true curvature), not rigid slabs translated in z.

## Phase 2 — RP scroll stack 1:1
- Wall decoupled from page scroll: overview locks page (documentElement overflow hidden + lenis.stop()); internal virtual position drives the wall.
- Input direct: wheel `jRaw = 0.005 × pixelY` (deltaMode normalized: line×16, page×innerHeight); touch drag `(Δy/innerHeight) × 1.7` clamp ±0.15; 150ms quiet → jRaw=0 (debounce).
- Single velocity field: `A += (jRaw - A) * (1 - exp(-3*dt))` — framerate-independent damp (RP 0.05/frame @60fps).
- Displacement AND bend share A: position += A×unit (unit = colW/1.2, RP photo-scale); uSpeed = 2.5 × A × unit. NO clamp on bend (RP has none; one wheel notch ≈ full photo height bend).
- Bend axis = motion axis: vertical conveyor wraps around HORIZONTAL axis (function of y).
- Idle breathing always on: 2.7% of photo height (RP 1.5×0.09×0.2); active → render every frame (static-skip render abandoned for the live wall).
- Tilt (VEL_TILT/MAX_TILT) and per-row velocity parallax (ROW_VEL) REMOVED (RP has neither).
- |A| > 0.1 cancels hover selection (RP behavior).
- Reset-to-top on category switch: internal 1.4s power2.inOut tween on virtual position; any user input cancels (feed kills resetTween).
- Activation edge: re-entering overview resets virtual pos/A/jRaw + suppressWrap=3 (wall decoupled ⇒ must be explicit).
- Dispose removes: wheel + pointerdown/move/up/cancel listeners, jTimer, resetTween.

## Phase 1 — Intro (replaces progress-bar preloader)
- Full-screen intro layer, opaque var(--background), pointer-events none.
- Title bottom-left: chars rise from translateY(100%) rotate(7deg) → 0, stagger 0.04s each; hand-rolled splitter (no SplitText plugin, no new deps).
- Odometer bottom-right, 3 columns overflow hidden: hundreds [0,1]; tens/ones 20-digit strips (0-9 twice); progress drives translateY scrolling (0.35s power2.inOut per step); optional gradient mask; mechanical scroll, never jump.
- Optional small photo chip (150×45 first BEIJING thumb, opacity 0.009→1 late).
- Mobile ≤600px: title hidden, centered logo fade, [000%] text counter.
- REAL progress from texture preloads (device-tier 20/28/36). P=1 AND min-wait 0.8s → odometer settles 100 → 0.25s hold → intro fades 0.45s power2.inOut → display none; wall already rendered behind; no white flash.
- Fast repeat visits: smooth fast-forward single tween. Deep-link non-overview: reveal at P=1 without waiting wall first-fill. prefers-reduced-motion: static, no char/odometer tweens. Clean dispose.

## Phase 3 — WebGL list (horizontal filmstrip)
- Same canvas, same 36 planes; list = single horizontal row, y=0 centered, cumulative x by width + GAP; first photo flush to −viewportW/2 + SIDE_MARGIN.
- Size rhythm: 0.96×colW landscape (ar≥1.1) / 0.77×colW row photos — big–small–big (RP 0.79/0.66 desktop); z=0, no ROW_Z_JITTER/COL_OFFSETS in list.
- Scroll: SAME input pipeline + A field; wallX -= A×unit; bidirectional wrap re-append carrying next lap photo (horizontal conveyor); momentum inherent.
- Bend axis swap in list: vertical axis — function of x/uViewport.x (RP original); single uniform switch, no material rebuild.
- Transitions (REWRITTEN 2026-08-18 from decompiled lazy816.js main effect — supersedes the ripple→fly-out→fly-in design): DIRECT SPATIAL MORPH, same one clock as the filter requeue. Kept photos fly straight from current position to new slot: position 1.4s power3.inOut (+0.5s delay entering list only, RP `-1!==v?.5:0`; activation edge ≈ v:-1 → 0). CHAINED sub-clocks (timeline "<" + per-tween delay): list → scale @1.0, uResolution @1.5 (0.618s = gsap 1/φ default); overview → scale @0 (1s), uResolution @.5 (0.618s) — CoverUV reframe TRAILS the landing. Hidden entrants revive instantly opaque at the +vw right park (RP parks every hidden photo at +I.width) and morph in. Exits: nearest edge ±vw, immediate, one clock; borrowed carriers carry the offscreen probe. Idle z-wave (uBreath) TOGGLES with the view: list ON / overview OFF, 1s linear (RP uProgress 0↔.2) — overview is flat in RP. No ripple, no grow, no stagger, no alternating edges (all removed — none in source).
- transitioning counter gates render/wrap/hover during transitions.
- Footer filter words ONLY in list (overview = pure wall); fade at transition midpoint ~0.7s.
- DOM list view RETIRED (Transition block + cover-row components removed). List also locks page scroll. Photo click → openProject unchanged.
- Edge: resize mid-list re-places + suppressWrap=3; enter-from-project shortened fly-in 0.8s; deep-link seeds row directly (first-fill fade); prefetch direction-aware.

## Phase 4 — Filter switch = RP's DECOMPILED requeue (re-verified 2026-08-18)
- Source: richardprescott.com lazy816.js `function w` (parked copy: `.scratch/lazy816.js`; the 6fps “fade-out” reading was a visual hallucination — see RULES.md R4).
- ONE clock: every flight 1.4s power3.inOut. No stagger, no ripple, no fade, no grow — none in source.
- Leavers: nearest edge by x sign (`x<=0 ? -I.width : +I.width` = our ±vw), immediate, no delay; on complete hide + park at the RIGHT edge.
- Kept photos AND entrants: same clock, +0.5s delay flat (RP `-1!==v?.5:0`; no hover-specific delay).
- Entrants revive INSTANTLY opaque (`visible=true, uOpacity=1`) at the right-edge park — RP parks every hidden photo at +I.width; all entrants fly in right→left with the conveyor.
- `uProgress→0` (1s linear) = idle z-wave ramp (amplitude 0.027 — our permanently-on uBreath equivalent); NO extra shader motion in the filter switch.
- Slot-size modulation when filter≠all (f(.66/.79) vs .77–.96, `w` prop unresolved) — found in source, NOT yet replicated (open item).
- Plane-pool artifact (desktop: 35/36 planes in row): borrowed carriers exit with an OFFSCREEN PROBE — freeze at the fully-invisible threshold, teleport to +vw park, instant rebind, entry with all remaining time; lands with everyone at ~1.9s.
- Rapid clicks: killRequeue (position/scale/uResolution/uAnim/material tweens; invisible planes opacity-restored; requeueGen++ invalidates stale probe callbacks), reclassify vs CURRENT want/wp, re-run.
- `bindPlane(mesh, wp, instant)` — instant skips the firstLoad fade + swap fuse (offscreen rebinds opaque instantly, RP parity). prevMap captured BEFORE assignment — the swap fuse is now actually reachable (was dead code: it compared mat.map after overwriting it).

## Phase 3.5 — Intro entrance (RP decompiled boot + `l` timeline, re-verified 2026-08-19)
- DESKTOP = THE CENTER-STACK EXPLODE (user-confirmed reading; the earlier "+1.2vw fly-in" was the MOBILE branch — corrected):
- Boot (transparent curtain — RP's loader floats over the LIVE canvas): seedPool parks every photo dead-center as a 150px square (parkOne: pos (0,0, i×.001 micro-z), scale .15, uResolution .15 cover-fit, hero renderOrder 1 on top) — what shows during load is the whole wall STACKED, hero visible. Late textures join the stack via ensureTex's straggler path. tick yields while bootParked.
- Loader completes → THE BEAT (RP layout.js `f` timeline, added 2026-08-19): counter locks at 100 → loader texts fade (delay .1, 0.5s power2.out; curtain root fade — bg already transparent) → 0.2s pure stillness (only the center stack waits) → at 0.8s total: `introFlyIn()` + curtain unmount SAME frame (RP: setStarted(1) + loader.remove() in f.onComplete; the DOM portrait's center landing mirrors our stack's park — no portrait flight needed). Kept (per user): REAL progress counter (RP's is a fixed ~4.7s choreography clock), MIN_WAIT 800ms.
- introFlyIn branches on WHERE the planes are (not viewport width): OVERVIEW boot (any width, parkStack'd center stack) → startViewTransition(false, true, intro=true) explode + hero wobble uAnim 0→.9→0 & others 0→.15→0 (.45s sine.inOut, return +.7). LIST boot (deep link, strip at slots behind the transparent curtain) → enter-only morph only, NO flight (the curtain fade is the reveal — RP's non-home route is a plain fade too; the former +1.2vw teleport hard-snapped the visible strip and is deleted).
- Guards: viewTrans||requeuing no-op; reduced-motion skipped (App); engine-down no-op; dispose nulls impl. Intro-time pool change: seedPool re-parks (stack swaps photos invisibly). Intro-time route change: startViewTransition clears the flags and morphs from wherever the stack is.
- Smoothness (the 爆开卡顿 fix, 2026-08-19, all four RP-aligned): ① `gsap.ticker.lagSmoothing(1000, 16)` — RP's exact value (716.js), spikes ≤1s fold to 16ms so morph timelines never jump ((0) forwarded every spike); ② `flushTextures()` handle — reveal() drains the whole GPU upload queue at beat ENTRY (cost hidden in the still beat; curtain's P≥1 only waited Image decodes); ③ drainUploads returns early while `transitioning>0` — no texImage2D stall ever lands inside a flight, late stragglers drain post-landing; ④ curtain hidden with ONE `gsap.set(display:none)` at the explode, React unmount deferred +1.6s (after landing) — NEVER natively remove() React-owned nodes (the 白屏 regression: React commit NotFoundError on removeChild).
- Safari straggler flicker (2026-08-19, frame-diff diagnosed: bursts at +4.2–5.1s post-explode, growing bbox): planes whose texture lagged at seed flew the explode as EMPTY quads (want??wp classifies them survivors, visible=true, map=null) and rebound mid-flight when three's loader landed — Image()-preloads ≠ three-side loads in Safari (Chrome shares HTTP cache instantly, hiding the gap). FIX = RP <Suspense> parity: `isBootReady()` handle (no boot plane has `want`); reveal() polls it (60ms, 4s cap) before the beat — no empty quad can ever fly. Safari DOM perf trio also landed: chip flight on gsap x/y TRANSFORMS (never left/top/width/height), no per-char willChange (3 strip-level ones stay).
- Texture guarantee: curtain preload = wall's first lap (shared cache), reveal only at P≥1.
- FINAL FORM (user-accepted 2026-08-19): SEQUENTIAL POP (user's own design — replaces the all-at-once explode): hero (= the chip's photo) pops from the center stack first, then each plane in stack order at 0.05s intervals, 1.4s power3.inOut per flight + own ripple at its own pop moment. One photo in motion at a time → any residual flicker is single-photo & pinpointable. Material flags = RP exact: depthWrite:false + polygonOffset:-5 + parkOne renderOrder=count-i (occlusion is draw order — the per-pop z-fight shimmer, Safari-visible, is structurally impossible now). Straggler planes (texture missing at 4s cap) never fly (hide; tick fills later — fills can't flash). Anti-flicker architecture stays: imgCache (textures built from the curtain's decoded images — no second fetch), introLocked photo-lock (visible planes never swap photos until landing+2s or first input), flushTextures at beat entry, drainUploads gated on transitioning.

## Phase 5 — Info transitions (RP contact grammar, re-verified 2026-08-20)
- Enter info: canvas + nav + footer simultaneous INSTANT opacity:0 (duration 0, gsap.set) — hard cut, NOT a fade. (RP layout.js @25517 insertion effect — mount-window path only; our overlay enter keeps the hard cut.)
- Leave info (RP layout.js @29048 link onClick, decompiled): the info layer fades ITSELF OUT — 1s power4.out desktop, 0.5s <800px — and the route pops in the fade's onComplete (NOT before). Home then re-enters FRESH (RP home remounts): overlay parity = restoreFromInfo re-enter — teleport wallY/wallX to top (instant, no glide — RP resets scroll at remount), park every visible plane at the RETURN PARK (+1.2vw overview / +vw list), run the enter-only one-clock morph, and pop canvas + nav + footer the instant the flight begins. Hash-back close (no click): the layer's own Transition fade runs concurrently with the re-enter (acceptable cross-fade — RP has no such path).
- The old 1.4s power2.inOut hidden glide-then-pop is DELETED (it animated invisibly then popped — a misreading of "visibility restored after scrollTo"; RP's contact close never glides).
- Elements stay hidden the whole time info is open (no mid-anim flash); pointer-events synced with opacity; rapid toggles no flicker; console clean.

## Phase 3.6 — Return-visit entrance (remount fly-in, RP `started!=0` boot)
- lazy816.js @14393 M mount effect branches on `started` (persisted across route changes — RP never unmounts home; OUR gallery remounts on project routes, so the flag lives at module scope: `bootFlags.curtainFlown`, set by App at the intro beat + inside introFlyImpl — covers reload-straight-into-#/p/… where the gallery is unmounted at beat time).
- First boot (curtain not yet flown): center stack (Phase 3.5 explode). REMOUNT (project close): parkReturnMount() — every plane at +1.2×viewport right, slot-sized (position-only flight), bootParked gates the tick; `pendingOverviewEnter` (mirrors pendingListEnter) fires the enter-only morph at the activation edge. Same machinery serves restoreFromInfo (Phase 5) — one grammar, three doors.

## Phase 6 — Hover liquid distortion
- Stable hover → gsap.to(uHover, value 1, duration 1.2, ease expo.out); leave → mirrored value 0.
- Re-hover same photo: tween continues from current value (no restart from 0).
- Scroll cancel (|A|>0.1) fires the leave tween.
- Wrap rebind mid-hover: same key carries hover; different → leave-tween on old plane BEFORE rebind (no stuck melted plane).
- Mobile: first tap = melt (replaces dim), second tap = open.
- Per-plane tween only; killTweensOf(uHover) on rebind/dispose; never assume value 0 after kill.
- Hover DIM logic (color.setHex 0x888888) REMOVED — melt is the only hover feedback.
- HoverPanel DOM timing unchanged. Rapid adjacent hovers overlap concurrently (correct). View exit mid-melt: kill + snap 0. Requeue leavers: kill + zero on visible=false. prefers-reduced-motion: pinned 0.
- Displacement amplitude 0.6 (RP 0.4 × 1.5, user-directed strengthening 2026-08-20); rotation angles are RP constants. Endpoint semantics preserved: held hover still settles crisp.
- Performance: double texture fetch per fragment; short-circuit if (uHover < 0.001) ONLY if profiling shows cost.

## Cross-phase constraints
- No new dependencies (GSAP core + three only; hand-rolled char splitter).
- All UI copy English / uppercase display style.
- R1: tsc --noEmit + pnpm build green + real behavior verified in dev before git.
- R4 for any shader change (chunk-source verification, macro two-state check, console sweep).
- Performance check: 36×289 verts + liquid fragment + always-on render on mobile; downgrade paths if needed.

## Phase 7 — RP header (nav) grammar (decompiled layout.js + CSS module, 2026-08-22)
- Source: layout.js（线上 md5 与 .scratch 存档一致 — site unchanged; fresh initial chunks archived .scratch/fresh-20260821/, local only; 138-*.js ≠ wall chunk）
- Structure: `<nav>` fixed, padding 20, top 0, full-width, z-index 999999999, flex space-between, min-height 70px; bg = static white scrim `linear-gradient(180deg, hsla(0,0%,100%,.314) 60%, transparent)` (≤600px: .216@50%, padding 15, min-height 65; ≤1023px: transparent; ≤1140px: availability hidden)
- navBlur (gradient frost): 4 stacked inset divs, height 75px, escalating `backdrop-filter: blur(1/2/4/8px)` + staircase masks (each layer's alpha band one step higher: 12.5% steps) → blur grows toward strip bottom. CSS declares `transition: transform/height 1s cubic-bezier(.55,0,.1,1)` but NO JS ever writes it (dead/GPU hint `translateZ(0)`).
- Layout: left navBio "RICHARD PRESCOTT" (click → overview + filter all; not on "/" → push "/" first); availability absolute left 33.3333% (PHOTOGRAPHER / AVAILABLE WORLDWIDE | BASED IN UK, stacked); right navActions = navMenu two masked rows "OVERVIEW / LIST" + "/ INFO" + navContact `margin-left:100px` mailto link. Mobile ≤600px: navBio/navBlur/navContact display:none, navMenu→navMobile column.
- Email underline: `::before` height 1.5px background var(--foreground), `transform:scaleX(0)`, origin left, `transition:all .4s ease`, hover → `transform:none` (=scaleX(1) slide-in from left).
- Chars reveal (mount, "/" only): [split] elements → SplitText; paused timeline `delay: nav?0.8:0`; `to(chars, visibility:"visible", stagger:.05)`; `.textMask{overflow:hidden}` + spans `opacity:0` initial.
- Nav fade on selection: state effect [active, isSingle] — `active!==-1` (wall photo selected) → chars of navActions+navContact+availability+navBio `opacity:0, duration:.7` then visibility hidden; deselected && !isSingle → chars opacity 1 + replay stagger reveal. Inline `style opacity:0` on navActions/navContact when `pathname!="/contact" && isSingle` (project view hides actions; contact always shows).
- View switch m(e): off-home → `router.push("/")` then setView(e); <1024px first `gsap.to(body,{scrollTo:0, duration: scrollTop>2?1.2:0, ease:"power2.inOut", onComplete: setView(e=="list"?"overview":"list")})` (mobile scrolls top then toggles — the inverted ternary is in the source, documented as-is).
- **Link hover = ScrambleText**: `onMouseEnter → to(chars, {duration:1.2, stagger:.04, scrambleText:{text:"{original}", chars:"upperCase", speed:.1}})` (gsap ScrambleTextPlugin — per-char decode/滚译).
- **Link click to /contact** (layout.js @29048 Link component): canvas `webglWrapper opacity:0, .5s power4.in` → `router.push` + callback → contactPage `opacity:1, .5s power4.in` (chained, total ~1s). ⚠️ CORRECTION vs our Phase 5 enter hard-cut: the interactive path FADES the canvas out .5s (hard cut was only the ≤350ms mount-window insertion effect). Candidate fix for our info enter.
- No scroll-linked nav behavior (no hide-on-scroll); nav permanently present under static gradient + frost.
