import { useEffect, useState } from 'react'

// Tiny hash router — no deps.
//
// Hash (not the history API) on purpose: the app runs inside the Figma Make
// preview iframe under FIGMA_PUBLIC_URL where no SPA fallback exists, and
// hash routes work on any static host without server rewrites.
//
// Routes:
//   #/                       main, overview (default — plain "" too)
//   #/list                   main, list
//   #/index                  main, index (reserved for the series INDEX page)
//   #/info · #/list/info     info overlay on top of a mode
//   #/p/:id                  project view for work :id
//   #/p/:id/:n               project view, photo n (1-based) — deep-link address
//
// Note: when projects become photo series, :id turns into a slug
// ("tokyo", "astro") — only parseHash's id parsing needs to change.

export type Mode = 'overview' | 'list' | 'index'

export interface Route {
  view: 'main' | 'project'
  mode: Mode
  info: boolean
  workId: number | null
  photo: number // 1-based photo inside the project
}

export function parseHash(hash: string = window.location.hash): Route {
  const seg = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (seg[0] === 'p') {
    const workId = Number.parseInt(seg[1] ?? '', 10)
    if (Number.isFinite(workId) && workId > 0) {
      const photo = Math.max(1, Number.parseInt(seg[2] ?? '1', 10) || 1)
      return { view: 'project', mode: 'overview', info: false, workId, photo }
    }
  }
  const mode: Mode = seg[0] === 'list' ? 'list' : seg[0] === 'index' ? 'index' : 'overview'
  return { view: 'main', mode, info: seg.includes('info'), workId: null, photo: 1 }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash())
  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

/** Push a route (adds a history entry → browser back works). */
export function nav(to: string) {
  const next = to.startsWith('#') ? to : `#/${to.replace(/^\/+/, '')}`
  if (window.location.hash === next) return
  window.location.hash = next
}

/** Update the address without adding a history entry (scroll scrubbing). */
export function navReplace(to: string) {
  const next = to.startsWith('#') ? to : `#/${to.replace(/^\/+/, '')}`
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`)
}
