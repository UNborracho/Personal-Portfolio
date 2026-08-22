/** Light flags module — NO three.js import.
 *
 *  App.tsx reads these constants at module scope (wall shuffle seed,
 *  intro choreography switch, curtain latch) even on devices that never
 *  mount the WebGL engine (DOM masonry fallback). Keeping them here lets
 *  App import them without pulling the ~500KB three chunk, which is
 *  dynamically imported from ./WebGLGallery only when webglOk. */

/** Deterministic wall seed — the first lap's shuffle must match the
 *  preloader's preload list (App reads the same constant via wallSequence). */
export const WALL_SEED = 20260815

// Plan B fallback: set false to skip the explode entirely (wall renders
// laid-out behind the curtain; the fade alone reveals it — RP's
// non-home-route form). One-line kill switch if the explode ever acts up.
export const INTRO_EXPLODE = true

// Module scope on purpose: survives gallery remounts (project routes
// unmount the whole main block). RP's `started` state parity — the
// loading curtain runs ONCE per page load, so a remounted gallery must
// take the RETURN-VISIT boot path, never the first-load stack park.
// Set by App at the intro beat (and inside introFlyImpl) — even when
// the gallery is unmounted at that moment (reload straight into #/p/…).
export const bootFlags = { curtainFlown: false }
