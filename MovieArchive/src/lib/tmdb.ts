// TMDB (The Movie Database) search: movies + TV in one request.
import { TMDB_API_KEY } from '../config'

export type ContentType = 'movie' | 'tv'

export const MY_GENRES = ['Drama', 'Comedy', 'Action', 'Horror', 'Sci-Fi', 'Romance', 'Thriller', 'Animation', 'Documentary'] as const
export type MyGenre = (typeof MY_GENRES)[number]

export interface SearchResult {
  key: string
  id: number
  type: ContentType
  title: string
  originalTitle: string // only filled when it differs from `title`
  year: string
  posterUrl: string
  genre: MyGenre
}

const API = 'https://api.themoviedb.org/3'
const POSTER_BASE = 'https://image.tmdb.org/t/p/w342'

export const hasApiKey = () => TMDB_API_KEY.trim() !== '' && !TMDB_API_KEY.includes('PASTE_YOUR')

// TMDB genre id → one of my 9 genres.
// The first matching rule wins, so e.g. "Animation" beats "Comedy".
// Anything unmatched (War, History, Western, Music, ...) becomes Drama.
const GENRE_RULES: [MyGenre, number[]][] = [
  ['Animation',   [16]],
  ['Documentary', [99, 10763]],           // Documentary, News
  ['Horror',      [27]],
  ['Sci-Fi',      [878, 14, 10765]],      // Science Fiction, Fantasy, TV "Sci-Fi & Fantasy"
  ['Thriller',    [53, 80, 9648]],        // Thriller, Crime, Mystery
  ['Action',      [28, 12, 10759]],       // Action, Adventure, TV "Action & Adventure"
  ['Romance',     [10749]],
  ['Comedy',      [35, 10751, 10762]],    // Comedy, Family, Kids
  ['Drama',       [18]],
]

export function mapGenre(ids: number[] | undefined): MyGenre {
  const set = new Set(ids || [])
  for (const [genre, tmdbIds] of GENRE_RULES) {
    if (tmdbIds.some(id => set.has(id))) return genre
  }
  return 'Drama'
}

// Multi-search: movies + TV, no language filter, adult content off.
export async function searchTmdb(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const url = `${API}/search/multi?api_key=${encodeURIComponent(TMDB_API_KEY)}&query=${encodeURIComponent(query)}&include_adult=false&page=1`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`TMDB ${res.status}`)
  const data = await res.json()
  const rows: any[] = Array.isArray(data.results) ? data.results : []
  return rows
    .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
    .slice(0, 6)
    .map((r): SearchResult => {
      const type: ContentType = r.media_type
      const title: string = (type === 'movie' ? r.title : r.name) || ''
      const original: string = (type === 'movie' ? r.original_title : r.original_name) || ''
      const date: string = (type === 'movie' ? r.release_date : r.first_air_date) || ''
      return {
        key: `${type}-${r.id}`,
        id: r.id,
        type,
        title,
        originalTitle: original && original.trim().toLowerCase() !== title.trim().toLowerCase() ? original : '',
        year: date.slice(0, 4),
        posterUrl: r.poster_path ? `${POSTER_BASE}${r.poster_path}` : '',
        genre: mapGenre(r.genre_ids),
      }
    })
}

// Optional extra call, made only when you pick a result:
// movie → director(s), TV show → creator(s). Returns '' if not available.
export async function fetchCreator(type: ContentType, id: number, signal: AbortSignal): Promise<string> {
  const key = encodeURIComponent(TMDB_API_KEY)
  if (type === 'movie') {
    const res = await fetch(`${API}/movie/${id}/credits?api_key=${key}`, { signal })
    if (!res.ok) return ''
    const data = await res.json()
    const names: string[] = (data.crew || []).filter((c: any) => c.job === 'Director').map((c: any) => c.name)
    return Array.from(new Set(names)).slice(0, 2).join(', ')
  }
  const res = await fetch(`${API}/tv/${id}?api_key=${key}`, { signal })
  if (!res.ok) return ''
  const data = await res.json()
  const names: string[] = (data.created_by || []).map((c: any) => c.name)
  return Array.from(new Set(names)).slice(0, 2).join(', ')
}
