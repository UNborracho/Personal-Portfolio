import * as THREE from "three"

// ── RP-replication shader foundation ─────────────────────────────────
// Every animated channel is injected ONCE into the shared material
// pipeline (R4: verified against three r185 chunk sources —
// project_vertex & map_fragment reproduced verbatim with additions;
// every channel is 0 at rest → identity transform, rendering
// byte-identical to the plain material).
//  - vertex: curtain bend (uSpeed, scroll velocity),
//    horizontal ripple (uAnim, pulses)
//  - fragment: cover-fit UV (aspect-safe morphing) + displacement
//    liquid swirl on hover (uHover)
export type Uni1 = { value: number }
export interface XYPair {
  x: number
  y: number
}
export type Uni2 = { value: XYPair }
export type PlaneUnis = {
  uAnim: Uni1
  uHover: Uni1
  uResolution: Uni2
  uImageRes: Uni2
}
export type SharedUniforms = {
  uTime: Uni1
  uSpeed: Uni1
  uBreath: Uni1
  uAxis: Uni1
  uViewport: Uni2
  uDispMap: { value: THREE.Texture | null }
}

// single accessor for the per-plane shader uniform bundle (was an
// 8-site `material as … userData.unis as PlaneUnis` cast chain)
export const unisOf = (m: THREE.Mesh) =>
  (m.material as THREE.MeshBasicMaterial).userData.unis as PlaneUnis

export const createSharedUniforms = (
  vw: number,
  vh: number,
): SharedUniforms => ({
  uTime: { value: 0 },
  uSpeed: { value: 0 },
  uBreath: { value: 0 },
  // 0 = vertical conveyor bend (fn of y), 1 = filmstrip bend (fn of x)
  uAxis: { value: 0 },
  uViewport: { value: { x: vw, y: vh } },
  uDispMap: { value: null as THREE.Texture | null },
})

// displacement field for the hover swirl — code-generated value
// noise (no asset): r/g = displacement vector, sampled by the shader
export const makeDispTex = (): THREE.DataTexture => {
  const DISP_N = 128
  const dispData = new Uint8Array(DISP_N * DISP_N * 4)
  const hash2 = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
    return n - Math.floor(n)
  }
  const vnoise = (x: number, y: number, cells: number) => {
    const gx = (x / DISP_N) * cells
    const gy = (y / DISP_N) * cells
    const ix = Math.floor(gx)
    const iy = Math.floor(gy)
    const fx = gx - ix
    const fy = gy - iy
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const a = hash2(ix, iy)
    const b = hash2(ix + 1, iy)
    const c = hash2(ix, iy + 1)
    const d = hash2(ix + 1, iy + 1)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }
  for (let y = 0; y < DISP_N; y++) {
    for (let x = 0; x < DISP_N; x++) {
      const v = (vnoise(x, y, 6) * 2 + vnoise(x, y, 13)) / 3
      const o = (y * DISP_N + x) * 4
      dispData[o] = dispData[o + 1] = v * 255
      dispData[o + 2] = 128
      dispData[o + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(dispData, DISP_N, DISP_N)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

export const patchMaterial = (
  mat: THREE.MeshBasicMaterial,
  shared: SharedUniforms,
) => {
  const unis: PlaneUnis = {
    uAnim: { value: 0 },
    uHover: { value: 0 },
    uResolution: { value: { x: 1, y: 1 } },
    uImageRes: { value: { x: 1, y: 1 } },
  }
  mat.userData.unis = unis
  mat.customProgramCacheKey = () => "rp-v1"
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, unis)
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform float uSpeed;
        uniform float uBreath;
        uniform vec2 uViewport;
        uniform float uAnim;
        uniform float uAxis;`,
      )
      .replace(
        "#include <project_vertex>",
        // r185 project_vertex VERBATIM (batching/instancing guards kept)
        // with the RP additions inserted BEFORE gl_Position — after the
        // include would be a no-op (mvPosition already consumed).
        `vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_BATCHING
          mvPosition = batchingMatrix * mvPosition;
        #endif
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        // RP curtain bend + curl wave, re-axed for our VERTICAL
        // conveyor: RP scrolls horizontally and wraps around a
        // VERTICAL axis (function of x); we scroll vertically so the
        // drum wraps around a HORIZONTAL axis (function of y).
        // Pure function of position → wrap-seam photos at the same y
        // get the same z (no pop at the recycling seam).
        // RP curtain bend: the drum wraps around a horizontal axis in
        // overview (function of y) and RP's original vertical axis in
        // list (function of x) — uAxis mixes the coordinate, mix(a,b,0)
        // is exactly a, so overview stays byte-identical.
        float rpBendCoord = mix( mvPosition.y / uViewport.y, mvPosition.x / uViewport.x, uAxis );
        mvPosition.z += cos( rpBendCoord * PI * 1.8 ) * uSpeed;
        mvPosition.x += cos( mvPosition.y + uTime * 5.0 ) * 0.3 * uAnim;
        // RP idle breathing: every photo bobs on cos(localY + t)
        // (their term: cos(p.y+t)*1.5*0.09*0.2 ≈ 2.7% of a photo)
        mvPosition.z += cos( position.y + uTime ) * uBreath;
        gl_Position = projectionMatrix * mvPosition;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uHover;
        uniform vec2 uResolution;
        uniform vec2 uImageRes;
        uniform sampler2D uDispMap;
        mat2 rot2( float a ) { float s = sin( a ); float c = cos( a ); return mat2( c, -s, s, c ); }
        // cover-fit UV (rs==ri → identity): a plane can morph to any
        // target size without stretching the photo (RP CoverUV)
        vec2 coverUv( vec2 u, vec2 s, vec2 i ) {
          float rs = s.x / s.y;
          float ri = i.x / i.y;
          vec2 st = rs < ri ? vec2( i.x * s.y / i.y, s.y ) : vec2( s.x, i.y * s.x / i.x );
          vec2 o = ( rs < ri ? vec2( ( st.x - s.x ) / 2.0, 0.0 ) : vec2( 0.0, ( st.y - s.y ) / 2.0 ) ) / st;
          return u * s / st + o;
        }`,
      )
      .replace(
        "#include <map_fragment>",
        // r185 map_fragment restructured: CoverUV + ±45°/-135°
        // displacement samples crossfaded by uHover (RP liquid
        // hover; amplitude 0.6 = RP's 0.4 × 1.5 — user-directed
        // strengthening 2026-08-20; the two rotations are RP
        // constants). RP semantics: pos1 ramps WITH uHover, pos2
        // ramps with (1 - uHover) and the mix crossfades — at BOTH
        // endpoints the SHOWN sample is undistorted, so the liquid
        // wave is TRANSIENT: it peaks mid-transition and a HELD
        // hover settles crisp. (An earlier build made both amplitudes
        // follow uHover — a held hover froze at full melt: the
        // “扭曲后不恢复原样” bug. Do not “fix” this back.)
        // uHover=0 or 1 → shown sample = texture(map, cuv) exactly.
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = vec4( 0.0 );
          vec2 cuv = coverUv( vMapUv, uResolution, uImageRes );
          vec2 disp = texture2D( uDispMap, cuv ).rg;
          vec2 pos1 = cuv + rot2( PI * 0.25 ) * disp * 0.6 * uHover;
          vec2 pos2 = cuv + rot2( -PI * 0.75 ) * disp * 0.6 * ( 1.0 - uHover );
          sampledDiffuseColor = mix( texture2D( map, pos1 ), texture2D( map, pos2 ), uHover );
          #ifdef DECODE_VIDEO_TEXTURE
            sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
          #endif
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      )
  }
}
