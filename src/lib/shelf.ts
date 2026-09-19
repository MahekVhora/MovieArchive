// Sorting, grouping and saved preferences for the shelf.

export type SortOrder = 'newest' | 'oldest'

interface Dated {
  dateYear: string
  dateMonth: string
  dateDay: string
}

export interface MonthGroup<T> {
  key: string
  label: string
  items: T[]
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const num = (s: string) => {
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : 0
}

// Sort by date watched. Undated titles always go last.
// Titles with the same date keep their current order.
export function sortItems<T extends Dated>(items: T[], order: SortOrder): T[] {
  const dir = order === 'newest' ? -1 : 1
  return items
    .map((item, i) => ({ item, i, y: num(item.dateYear), m: num(item.dateMonth), d: num(item.dateDay) }))
    .sort((a, b) => {
      if (!a.y && !b.y) return a.i - b.i
      if (!a.y) return 1
      if (!b.y) return -1
      return dir * (a.y - b.y || a.m - b.m || a.d - b.d) || a.i - b.i
    })
    .map(x => x.item)
}

// Group an already-sorted list into sections like "March 2024".
// Year-only titles go under "2024 · month not set".
export function groupByMonth<T extends Dated>(sortedItems: T[]): MonthGroup<T>[] {
  const groups = new Map<string, MonthGroup<T>>()
  for (const item of sortedItems) {
    const y = num(item.dateYear)
    const m = num(item.dateMonth)
    const hasMonth = y > 0 && m >= 1 && m <= 12
    const key = !y ? 'undated' : hasMonth ? `${y}-${String(m).padStart(2, '0')}` : `${y}-none`
    const label = !y ? 'Date not set' : hasMonth ? `${MONTHS[m - 1]} ${y}` : `${y} · month not set`
    let group = groups.get(key)
    if (!group) {
      group = { key, label, items: [] }
      groups.set(key, group)
    }
    group.items.push(item)
  }
  return Array.from(groups.values())
}

// Remember choices between visits (localStorage).
export function loadPref(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

export function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}
