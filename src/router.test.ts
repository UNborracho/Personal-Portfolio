import { describe, expect, it } from "vitest"
import { parseHash, routeHash } from "./router"
import { CATEGORIES } from "./photo-manifest"

// parseHash is pure (hash passed explicitly — the default param reads
// window.location, which node env lacks). routeHash must be its exact
// inverse for every documented route shape.

const main = (over: Partial<ReturnType<typeof parseHash>> = {}) =>
  ({
    view: "main",
    mode: "overview",
    cat: "all",
    info: false,
    series: null,
    photo: 1,
    ...over,
  }) as const

describe("parseHash", () => {
  it("parses the root route", () => {
    expect(parseHash("#/")).toEqual(main())
    expect(parseHash("")).toEqual(main())
    expect(parseHash("#")).toEqual(main())
  })

  it("parses list mode", () => {
    expect(parseHash("#/list")).toEqual(main({ mode: "list" }))
  })

  it("parses every manifest category slug", () => {
    for (const c of CATEGORIES) {
      expect(parseHash(`#/${c.slug}`)).toEqual(main({ cat: c.slug }))
      expect(parseHash(`#/${c.slug}/list`)).toEqual(
        main({ cat: c.slug, mode: "list" }),
      )
    }
  })

  it("falls back to all-overview for unknown categories", () => {
    expect(parseHash("#/bogus")).toEqual(main())
    expect(parseHash("#/bogus/list")).toEqual(main({ mode: "list" }))
  })

  it("parses project routes with 1-based photo", () => {
    expect(parseHash("#/p/foo")).toEqual(
      main({ view: "project", series: "foo" }),
    )
    expect(parseHash("#/p/foo/3")).toEqual(
      main({ view: "project", series: "foo", photo: 3 }),
    )
  })

  it("clamps/defaults bad photo numbers to 1", () => {
    expect(parseHash("#/p/foo/abc")).toEqual(
      main({ view: "project", series: "foo" }),
    )
    expect(parseHash("#/p/foo/0")).toEqual(
      main({ view: "project", series: "foo" }),
    )
    expect(parseHash("#/p/foo/-2")).toEqual(
      main({ view: "project", series: "foo" }),
    )
  })

  it("falls back to main when p has no slug", () => {
    expect(parseHash("#/p")).toEqual(main())
  })

  it("detects the info suffix on every route shape", () => {
    expect(parseHash("#/info")).toEqual(main({ info: true }))
    expect(parseHash("#/street/info")).toEqual(main({ cat: "street", info: true }))
    expect(parseHash("#/p/foo/info")).toEqual(
      main({ view: "project", series: "foo", info: true }),
    )
  })
})

describe("routeHash ∘ parseHash", () => {
  it("round-trips every documented route", () => {
    const hashes = [
      "#/",
      "#/list",
      ...CATEGORIES.flatMap((c) => [`#/${c.slug}`, `#/${c.slug}/list`]),
      "#/p/foo",
      "#/p/foo/3",
      "#/street/info",
      "#/p/foo/info",
      "#/list/info",
    ]
    for (const h of hashes) expect(routeHash(parseHash(h))).toBe(h)
  })
})
