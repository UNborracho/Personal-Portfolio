// Shared data & types — imported by both App.tsx and WebGLGallery.tsx
// to avoid a circular dependency between them.

export type Shape = 'portrait' | 'landscape' | 'square'

export interface Work {
  id: number
  src: string
  title: string
  agency: string
  client: string
  type: string
  year: number
  category: 'commissioned' | 'personal'
  shape: Shape
}

export const UB = 'https://images.unsplash.com'

const AR: Record<Shape, string> = {
  portrait: 'w=450&h=600',
  landscape: 'w=600&h=450',
  square: 'w=600&h=600',
}
export const CSS_AR: Record<Shape, string> = {
  portrait: '3 / 4',
  landscape: '4 / 3',
  square: '1 / 1',
}

function url(id: string, shape: Shape) {
  return `${UB}/${id}?${AR[shape]}&fit=crop&auto=format`
}

export const WORKS: Work[] = [
  { id: 1, src: url('photo-1618418721668-0d1f72aa4bab', 'landscape'), title: 'STEALTH / DARK', agency: 'ACCENTURE SONG', client: 'MERCEDES', type: 'COMMISSIONED', year: 2024, category: 'commissioned', shape: 'landscape' },
  { id: 2, src: url('photo-1609007647726-d49243581398', 'portrait'), title: 'SHADOW / FORM', agency: 'WIEDEN+KENNEDY', client: 'JAGUAR', type: 'COMMISSIONED', year: 2024, category: 'commissioned', shape: 'portrait' },
  { id: 3, src: url('photo-1557053910-d9eadeed1c58', 'portrait'), title: 'RED EDIT', agency: 'UNIT CMA', client: 'VALENTINO', type: 'COMMISSIONED', year: 2023, category: 'commissioned', shape: 'portrait' },
  { id: 4, src: url('photo-1524504388940-b1c1722653e1', 'portrait'), title: 'BLONDE NOIR', agency: 'AGENCY B', client: 'SELF SERVICE', type: 'COMMISSIONED', year: 2023, category: 'commissioned', shape: 'portrait' },
  { id: 5, src: url('photo-1629820408206-e9fc918abf63', 'landscape'), title: 'COCKPIT', agency: 'STINK STUDIOS', client: 'BENTLEY', type: 'COMMISSIONED', year: 2023, category: 'commissioned', shape: 'landscape' },
  { id: 6, src: url('photo-1610478920626-fb94a144840b', 'square'), title: 'CHROME ICON', agency: 'OMNICOM', client: 'ROLLS-ROYCE', type: 'COMMISSIONED', year: 2022, category: 'commissioned', shape: 'square' },
  { id: 7, src: url('photo-1687634366070-c06d3f037154', 'portrait'), title: 'INTERIOR', agency: 'SAATCHI & SAATCHI', client: 'BMW', type: 'COMMISSIONED', year: 2022, category: 'commissioned', shape: 'portrait' },
  { id: 8, src: url('photo-1606143412458-acc5f86de897', 'portrait'), title: 'PRESENCE', agency: 'WIEDEN+KENNEDY', client: 'DIOR', type: 'COMMISSIONED', year: 2022, category: 'commissioned', shape: 'portrait' },
  { id: 9, src: url('photo-1506863530036-1efeddceb993', 'portrait'), title: 'UNTITLED I', agency: '—', client: '—', type: 'PERSONAL', year: 2024, category: 'personal', shape: 'portrait' },
  { id: 10, src: url('photo-1633381521050-26bb467d9d5a', 'square'), title: 'UNTITLED II', agency: '—', client: '—', type: 'PERSONAL', year: 2024, category: 'personal', shape: 'square' },
  { id: 11, src: url('photo-1439792675105-701e6a4ab6f0', 'landscape'), title: 'RANGE', agency: '—', client: '—', type: 'PERSONAL', year: 2024, category: 'personal', shape: 'landscape' },
  { id: 12, src: url('photo-1488034976201-ffbaa99cbf5c', 'square'), title: 'RAIN', agency: '—', client: '—', type: 'PERSONAL', year: 2024, category: 'personal', shape: 'square' },
  { id: 13, src: url('photo-1500534314209-a25ddb2bd429', 'landscape'), title: 'MIST', agency: '—', client: '—', type: 'PERSONAL', year: 2023, category: 'personal', shape: 'landscape' },
  { id: 14, src: url('photo-1429292394373-ddbcc6bb7468', 'portrait'), title: 'PASSAGE', agency: '—', client: '—', type: 'PERSONAL', year: 2023, category: 'personal', shape: 'portrait' },
  { id: 15, src: url('photo-1570587726545-494e2bcc2f9f', 'square'), title: 'MOTION', agency: '—', client: '—', type: 'PERSONAL', year: 2023, category: 'personal', shape: 'square' },
]

export function getProjectImages(work: Work): Work[] {
  const same = WORKS.filter((w) => w.category === work.category)
  const idx = same.findIndex((w) => w.id === work.id)
  return [...same.slice(idx), ...same.slice(0, idx)]
}

// Per-column vertical stagger (px) — organic "not on the same baseline" feel
export const COL_OFFSETS = [0, 18, -14, 9]
