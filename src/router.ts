import { useEffect, useState } from "react"
import { CATEGORIES } from "./photo-manifest"

// Tiny hash router — no deps.
//
// Hash (not the history API) on purpose: works on any static host (Vercel)
// and inside the Figma Make preview iframe without SPA fallback rewrites.
//
// Routes:
//   #/                        main · overview · all series
//   #/list                    main · list (series covers) · all
//   #/:cat                    main · overview · filtered (street/scenery/live)
//   #/:cat/list               main · list · filtered
//   #/p/:series               project view for a series · photo 1
//   #/p/:series/:n            project view · photo n (1-based, deep-linkable)
//   (any of the above) + /info   INFO overlay
//
// #/p/... and #/:cat/... are validated against the manifest; anything
// unknown falls back to the all-overview route (parse result cat='all',
// series=null — App normalizes the address with replaceState).

export type Mode = "overview" | "list"

export type Cat = (typeof CATEGORIES)[number]["slug"] | "all"

export interface Route {
  view: "main" | "project"
  mode: Mode
  cat: Cat
  info: boolean
  series: string | null
  photo: number // 1-based photo inside the series
}

const CAT_SLUGS = new Set<string>(CATEGORIES.map((c) => c.slug))

export function parseHash(hash: string = window.location.hash): Route {
  const seg = hash.replace(/^#\/?/, "").split("/").filter(Boolean)
  const info = seg.includes("info")
  const body = seg.filter((s) => s !== "info")

  if (body[0] === "p") {
    const slug = body[1]
    if (slug) {
      const photo = Math.max(1, Number.parseInt(body[2] ?? "1", 10) || 1)
      return { view: "project", mode: "overview", cat: "all", info, series: slug, photo }
    }
  }

  const mode: Mode = body.includes("list") ? "list" : "overview"
  const maybeCat = body.find((s) => CAT_SLUGS.has(s)) as Cat | undefined
  return {
    view: "main",
    mode,
    cat: maybeCat ?? "all",
    info,
    series: null,
    photo: 1,
  }
}

export function routeHash(route: Route): string {
  if (route.view === "project" && route.series) {
    return `#/p/${route.series}${route.photo > 1 ? `/${route.photo}` : ""}`
  }
  const parts: string[] = []
  if (route.cat !== "all") parts.push(route.cat)
  if (route.mode === "list") parts.push("list")
  if (route.info) parts.push("info")
  return `#/${parts.join("/")}`
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash())
  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])
  return route
}

/** Push a route (adds a history entry → browser back works). */
export function nav(to: string) {
  const next = to.startsWith("#") ? to : `#/${to.replace(/^\/+/, "")}`
  if (window.location.hash === next) return
  window.location.hash = next
}

/** Update the address without adding a history entry (scroll scrubbing). */
export function navReplace(to: string) {
  const next = to.startsWith("#") ? to : `#/${to.replace(/^\/+/, "")}`
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${next}`,
  )
}
