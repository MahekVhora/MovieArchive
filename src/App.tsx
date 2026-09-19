import { useState, useRef, useEffect, useCallback } from 'react'
import { sortItems, groupByMonth, loadPref, savePref, type SortOrder } from './lib/shelf'
import { searchTmdb, fetchCreator, hasApiKey, MY_GENRES, type MyGenre, type ContentType, type SearchResult } from './lib/tmdb'
import { TITLE_PLAIN, TITLE_ITALIC } from './config'

// ── Types ──────────────────────────────────────────────────────────────────
type Genre = 'All' | MyGenre
const GENRES: Genre[] = ['All', ...MY_GENRES]

type TypeFilter = 'all' | ContentType

// Soft fallback poster colors (used when a title has no poster image).
const GENRE_COLORS: Record<MyGenre, string> = {
  'Drama':       'linear-gradient(160deg,#e8d5c4,#c9b5a2)',
  'Comedy':      'linear-gradient(160deg,#f0e0b4,#d9c58e)',
  'Action':      'linear-gradient(160deg,#e6c4b8,#c9a293)',
  'Horror':      'linear-gradient(160deg,#c9bcd0,#a898b4)',
  'Sci-Fi':      'linear-gradient(160deg,#c4cfe6,#a2b0cf)',
  'Romance':     'linear-gradient(160deg,#ecc8d2,#d3a3b2)',
  'Thriller':    'linear-gradient(160deg,#c1c9d1,#9fa9b4)',
  'Animation':   'linear-gradient(160deg,#c4e0d5,#a2c9b9)',
  'Documentary': 'linear-gradient(160deg,#d4dbb8,#b5be96)',
}

interface Item {
  id: string
  title: string
  creator: string // Director / Creator
  type: ContentType
  genre: MyGenre
  year: string // release year (from search), shown next to the director/creator
  dateYear: string // date watched
  dateMonth: string
  dateDay: string
  rating: number
  reflection: string
  reflectionEditedAt: string
  posterUrl: string
  offset: number
  isNew?: boolean
}

type ItemData = Omit<Item, 'id' | 'offset' | 'isNew'>

const typeLabel = (t: ContentType) => (t === 'tv' ? 'TV Show' : 'Movie')

// ── Persistence (localStorage) ─────────────────────────────────────────────
// Every key starts with "movieArchive." so this site never touches the book site's data.
const ITEMS_KEY = 'movieArchive.items.v1'
const THEME_KEY = 'movieArchive.theme.v1'
const SORT_KEY = 'movieArchive.sort.v1'
const GROUP_KEY = 'movieArchive.group.v1'
const MONTH_KEY = 'movieArchive.month.v1'
const TYPE_KEY = 'movieArchive.type.v1'

function loadItems(): Item[] {
  try {
    const raw = localStorage.getItem(ITEMS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((b: Partial<Item>) => ({
      id: b.id || crypto.randomUUID(),
      title: b.title || '',
      creator: b.creator || '',
      type: b.type === 'tv' ? 'tv' : 'movie',
      genre: (MY_GENRES as readonly string[]).includes(b.genre as string) ? (b.genre as MyGenre) : 'Drama',
      year: b.year || '',
      dateYear: b.dateYear || '',
      dateMonth: b.dateMonth || '',
      dateDay: b.dateDay || '',
      rating: b.rating || 0,
      reflection: b.reflection || '',
      reflectionEditedAt: b.reflectionEditedAt || '',
      posterUrl: b.posterUrl || '',
      offset: typeof b.offset === 'number' ? b.offset : 0,
      isNew: false,
    }))
  } catch { return [] }
}

function saveItems(items: Item[]) {
  try {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items.map(({ isNew, ...rest }) => rest)))
  } catch {
    alert("Couldn't save your titles: browser storage is full (large poster images can cause this). Try smaller poster images.")
  }
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatDate(year: string, month: string, day: string) {
  if (!year) return ''
  if (!month) return year
  const m = MONTH_SHORT[parseInt(month) - 1] || ''
  if (!day) return `${m} ${year}`
  return `${m} ${day}, ${year}`
}

function todayLabel() {
  const d = new Date()
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function wordCount(s: string) {
  return s.trim() ? s.trim().split(/\s+/).length : 0
}

// Shrink an uploaded image so it fits comfortably in browser storage.
function fileToPoster(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('not an image'))
      img.onload = () => {
        const maxW = 342
        const scale = Math.min(1, maxW / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('no canvas'))
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

// True on phone-sized screens (detail panel becomes a bottom sheet).
function useIsMobile() {
  const query = '(max-width: 640px)'
  const [mobile, setMobile] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false))
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(query)
    const on = () => setMobile(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return mobile
}

// ── AnimatedCount ──────────────────────────────────────────────────────────
function AnimatedCount({ count }: { count: number }) {
  const [display, setDisplay] = useState(count)
  const [animKey, setAnimKey] = useState(0)
  useEffect(() => { setDisplay(count); setAnimKey(k => k + 1) }, [count])
  return (
    <span key={animKey} data-testid="count" style={{ display: 'inline-block', animation: 'countChange 0.3s ease forwards', color: 'var(--accent)', fontSize: 12, letterSpacing: '0.1em', fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>
      {display} {display === 1 ? 'title' : 'titles'}
    </span>
  )
}

// ── StarRating ─────────────────────────────────────────────────────────────
function StarRating({ value, onChange, size = 20 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  const [hovered, setHovered] = useState(0)
  return (
    <span style={{ display: 'flex', gap: 4 }}>
      {[1,2,3,4,5].map(s => (
        <span key={s} data-star={s} onClick={() => onChange?.(s)} onMouseEnter={() => onChange && setHovered(s)} onMouseLeave={() => onChange && setHovered(0)}
          style={{ fontSize: size, cursor: onChange ? 'pointer' : 'default', color: (hovered || value) >= s ? '#c4956a' : 'rgba(150,130,115,0.3)', transition: 'color 0.15s, transform 0.1s', transform: hovered === s ? 'scale(1.2)' : 'scale(1)', display: 'inline-block', lineHeight: 1 }}>★</span>
      ))}
    </span>
  )
}

// ── FallbackPoster ─────────────────────────────────────────────────────────
function FallbackPoster({ title, creator, genre, width, height }: { title: string; creator: string; genre: MyGenre; width: number; height: number }) {
  return (
    <div data-testid="fallback-poster" style={{ width, height, background: GENRE_COLORS[genre], borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '12px 8px', textAlign: 'center', position: 'relative', overflow: 'hidden', border: '1px solid var(--glass)', flexShrink: 0 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: 'linear-gradient(90deg,rgba(255,255,255,0.25),transparent)' }} />
      <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: width * 0.09, fontWeight: 500, color: '#3a2a22', lineHeight: 1.3, wordBreak: 'break-word' }}>{title}</span>
      {creator && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: width * 0.065, color: 'rgba(60,40,30,0.7)', marginTop: 6 }}>{creator}</span>}
    </div>
  )
}

// A poster image, or the pastel fallback if there's no URL / the image fails to load.
function Poster({ url, title, creator, genre, width, height, imgStyle }: {
  url: string; title: string; creator: string; genre: MyGenre; width: number; height: number; imgStyle?: React.CSSProperties
}) {
  const [broken, setBroken] = useState(false)
  useEffect(() => { setBroken(false) }, [url])
  if (url && !broken) {
    return <img src={url} alt={title} onError={() => setBroken(true)} style={{ width, height, objectFit: 'cover', borderRadius: 4, display: 'block', flexShrink: 0, ...imgStyle }} />
  }
  return <FallbackPoster title={title} creator={creator} genre={genre} width={width} height={height} />
}

// ── Ruled textarea ─────────────────────────────────────────────────────────
function ReflectionTextarea({ value, onChange, minRows = 12, autoFocus }: {
  value: string; onChange: (v: string) => void; minRows?: number; autoFocus?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (autoFocus && ref.current) { ref.current.focus(); ref.current.setSelectionRange(value.length, value.length) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus])

  const grow = () => {
    if (!ref.current) return
    ref.current.style.height = 'auto'
    ref.current.style.height = ref.current.scrollHeight + 'px'
  }
  useEffect(() => { grow() }, [value])

  const words = wordCount(value)

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={ref}
        data-testid="reflection"
        value={value}
        onChange={e => { onChange(e.target.value); grow() }}
        placeholder="Start writing…"
        style={{
          width: '100%',
          minHeight: minRows * 27,
          resize: 'none',
          background: 'var(--paper)',
          border: '1px solid rgba(200,180,165,0.35)',
          borderRadius: 16,
          padding: 20,
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: 16,
          lineHeight: '27px',
          color: 'var(--text)',
          outline: 'none',
          transition: 'box-shadow 0.15s',
          backgroundImage: 'repeating-linear-gradient(transparent, transparent 26px, rgba(160,130,100,0.08) 26px, rgba(160,130,100,0.08) 27px)',
          backgroundPositionY: '20px',
          overflow: 'auto',
          boxSizing: 'border-box',
        }}
        onFocus={e => { e.target.style.boxShadow = '0 0 0 3px rgba(180,150,130,0.2)'; e.target.style.borderColor = 'rgba(180,140,110,0.5)' }}
        onBlur={e => { e.target.style.boxShadow = 'none'; e.target.style.borderColor = 'rgba(200,180,165,0.35)' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, padding: '0 2px' }}>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>Optional</span>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'var(--text-muted)' }}>{words} {words === 1 ? 'word' : 'words'}</span>
      </div>
    </div>
  )
}

// ── PosterCard ─────────────────────────────────────────────────────────────
function PosterCard({ item, onSelect, isNew }: { item: Item; onSelect: () => void; isNew?: boolean }) {
  const [hovered, setHovered] = useState(false)
  const w = 200, h = 300
  return (
    <div data-testid="card" onClick={onSelect} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', marginTop: item.offset, flexShrink: 0, animation: isNew ? 'slideLeft 0.4s ease forwards' : undefined, transition: 'transform 0.25s ease', transform: hovered ? 'translateY(-12px) scale(1.06)' : 'none', zIndex: hovered ? 10 : 1 }}>
      <div style={{ position: 'relative', width: w, height: h, borderRadius: 4, boxShadow: hovered ? '0 24px 48px rgba(0,0,0,0.3), 0 0 30px rgba(180,150,130,0.4)' : '0 10px 30px rgba(0,0,0,0.18)', transition: 'box-shadow 0.25s ease', animation: isNew ? 'glowPulse 0.8s ease 0.3s' : undefined }}>
        <Poster url={item.posterUrl} title={item.title} creator={item.creator} genre={item.genre} width={w} height={h} />
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, background: 'linear-gradient(90deg,rgba(255,255,255,0.25),transparent)', borderRadius: '4px 0 0 4px', pointerEvents: 'none' }} />
      </div>
      <div style={{ marginTop: 10, textAlign: 'center', maxWidth: w, opacity: hovered ? 1 : 0, transform: hovered ? 'translateY(0)' : 'translateY(4px)', transition: 'opacity 0.2s ease, transform 0.2s ease', pointerEvents: 'none' }}>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 14, fontWeight: 500, color: 'var(--text)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.title}</div>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{item.creator}</div>
        {item.dateYear && <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'var(--text-muted)', marginTop: 2, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{formatDate(item.dateYear, item.dateMonth, item.dateDay)}</div>}
      </div>
    </div>
  )
}

// ── EmptyShelf ─────────────────────────────────────────────────────────────
function EmptyShelf({ totalCount, genre, type, onAdd }: { totalCount: number; genre: Genre; type: TypeFilter; onAdd: () => void }) {
  // First-run message only when nothing has been added yet (and no genre chip is chosen).
  const firstRun = totalCount === 0 && genre === 'All'
  const what = genre !== 'All' ? `a ${genre} title` : type === 'tv' ? 'a TV show' : type === 'movie' ? 'a movie' : 'a title'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', flex: 1, paddingBottom: 40 }}>
      {firstRun && (
        <>
          <div style={{ display: 'flex', gap: 20, marginBottom: 32, alignItems: 'flex-end' }}>
            {[1,2,3].map(i => <div key={i} style={{ width: 120, height: 180, borderRadius: 4, border: '2px dashed rgba(150,130,120,0.25)', opacity: 0.35 + i * 0.07, marginTop: i === 2 ? -12 : i === 1 ? 8 : 0 }} />)}
          </div>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 400, color: 'var(--text)', marginBottom: 8, fontStyle: 'italic' }}>Your screen is waiting.</div>
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'var(--text-muted)', marginBottom: 28 }}>Add the first title you've watched.</div>
          <button onClick={onAdd} style={pillBtnStyle('dark')}>+ Add your first title</button>
        </>
      )}
      {!firstRun && (
        <div style={{ textAlign: 'center', paddingBottom: 60, paddingLeft: 24, paddingRight: 24 }}>
          <div data-testid="filtered-empty" style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 12 }}>Nothing here yet — add {what}.</div>
          <button onClick={onAdd} style={{ ...pillBtnStyle('ghost'), fontSize: 13 }}>+ Add a title</button>
        </div>
      )}
    </div>
  )
}

// ── Shared styles ──────────────────────────────────────────────────────────
function pillBtnStyle(variant: 'dark' | 'ghost' | 'glass'): React.CSSProperties {
  const base: React.CSSProperties = { borderRadius: 100, cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' as const, fontWeight: 500, transition: 'all 0.2s ease', border: 'none', outline: 'none' }
  if (variant === 'dark') return { ...base, background: 'var(--chip-active-bg)', color: 'var(--chip-active-text)', padding: '12px 28px' }
  if (variant === 'ghost') return { ...base, background: 'transparent', color: 'var(--text)', padding: '10px 22px', border: '1px solid var(--border)' }
  return { ...base, background: 'var(--glass)', color: 'var(--text)', padding: '10px 22px', border: '1px solid rgba(200,180,165,0.3)', backdropFilter: 'blur(8px)' }
}
const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--field)', border: '1px solid rgba(200,180,165,0.35)', borderRadius: 10, padding: '9px 13px', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'var(--text)', outline: 'none' }
const labelStyle: React.CSSProperties = { display: 'block', fontFamily: 'Inter, sans-serif', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 5 }
const serifLabelStyle: React.CSSProperties = { display: 'block', fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }
const linkBtnStyle: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'var(--accent)', textDecoration: 'underline', padding: 0 }

// ── Segmented control (small glass pill with active dark segment) ──────────
function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', background: 'var(--glass)', border: '1px solid rgba(200,180,165,0.3)', borderRadius: 100, height: 36, padding: 3, gap: 2, backdropFilter: 'blur(8px)', flexShrink: 0, alignSelf: 'flex-start' }}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} style={{ height: '100%', padding: '0 14px', borderRadius: 100, border: 'none', cursor: 'pointer', background: value === o.value ? 'var(--chip-active-bg)' : 'transparent', color: value === o.value ? 'var(--chip-active-text)' : 'var(--text-muted)', fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── DateTripleDropdown ─────────────────────────────────────────────────────
const MONTHS = MONTH_SHORT
const YEARS = Array.from({ length: new Date().getFullYear() - 1949 }, (_, i) => String(new Date().getFullYear() - i))

function daysInMonth(year: string, month: string) {
  if (!year || !month) return 31
  return new Date(parseInt(year), parseInt(month), 0).getDate()
}

function GlassSelect({ value, onChange, options, placeholder, widthPct }: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder: string; widthPct: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && value && listRef.current) {
      const idx = options.indexOf(value)
      if (idx > -1) listRef.current.scrollTop = idx * 40 - 80
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const displayValue = value ? (placeholder === 'Month' ? MONTHS[parseInt(value)-1] : value) : ''

  return (
    <div ref={ref} style={{ position: 'relative', width: widthPct, flexShrink: 0 }}>
      <button type="button" data-select={placeholder} onClick={() => setOpen(o => !o)} style={{ width: '100%', height: 44, background: 'var(--field)', border: `1px solid ${open ? 'rgba(180,140,110,0.5)' : 'rgba(200,180,165,0.35)'}`, borderRadius: 12, padding: '0 36px 0 13px', fontFamily: 'Inter, sans-serif', fontSize: 13, color: displayValue ? 'var(--text)' : 'var(--text-muted)', cursor: 'pointer', textAlign: 'left', boxShadow: open ? '0 0 0 3px rgba(180,150,130,0.18)' : 'none', transition: 'box-shadow 0.15s, border-color 0.15s', outline: 'none' }}>
        {displayValue || placeholder}
      </button>
      <span style={{ position: 'absolute', right: 12, top: '50%', transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`, transition: 'transform 0.2s', fontSize: 10, color: 'var(--text-muted)', pointerEvents: 'none' }}>▾</span>
      {open && (
        <div ref={listRef} style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50, background: 'var(--panel)', backdropFilter: 'blur(20px)', border: '1px solid rgba(200,180,165,0.3)', borderRadius: 12, maxHeight: 220, overflowY: 'auto', boxShadow: '0 12px 32px rgba(0,0,0,0.12)', scrollbarWidth: 'thin' }}>
          {options.map((opt, i) => {
            const label = placeholder === 'Month' ? MONTHS[parseInt(opt)-1] : opt
            const isSel = opt === value
            return (
              <div key={i} data-option={opt} onClick={() => { onChange(opt); setOpen(false) }}
                style={{ padding: '10px 14px', fontFamily: 'Inter, sans-serif', fontSize: 13, cursor: 'pointer', background: isSel ? 'rgba(180,140,110,0.15)' : 'transparent', color: isSel ? 'var(--accent)' : 'var(--text)', fontWeight: isSel ? 500 : 400, transition: 'background 0.1s' }}
                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = 'rgba(200,180,165,0.12)' }}
                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >{label}</div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DateTripleDropdown({ year, month, day, onYearChange, onMonthChange, onDayChange }: {
  year: string; month: string; day: string
  onYearChange: (v: string) => void; onMonthChange: (v: string) => void; onDayChange: (v: string) => void
}) {
  const maxDay = daysInMonth(year, month)
  const dayOptions = Array.from({ length: maxDay }, (_, i) => String(i + 1))
  const monthOptions = Array.from({ length: 12 }, (_, i) => String(i + 1))
  const setToday = () => { const n = new Date(); onYearChange(String(n.getFullYear())); onMonthChange(String(n.getMonth() + 1)); onDayChange(String(n.getDate())) }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <label style={labelStyle}>Date Watched</label>
        <button type="button" onClick={setToday} style={{ ...linkBtnStyle, marginBottom: 5 }}>Today</button>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <GlassSelect value={year} onChange={onYearChange} options={YEARS} placeholder="Year" widthPct="calc(45% - 4px)" />
        <GlassSelect value={month} onChange={onMonthChange} options={monthOptions} placeholder="Month" widthPct="calc(30% - 4px)" />
        <GlassSelect value={day} onChange={onDayChange} options={dayOptions} placeholder="Day" widthPct="calc(25% - 4px)" />
      </div>
      <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'var(--text-muted)', marginTop: 5 }}>Month and day are optional.</div>
    </div>
  )
}

// ── AddItemModal ───────────────────────────────────────────────────────────
function AddItemModal({ onClose, onAdd, initialItem }: {
  onClose: () => void
  onAdd: (data: ItemData) => void
  initialItem?: Item
}) {
  const isMobile = useIsMobile()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [manual, setManual] = useState(!!initialItem)

  const now = new Date()
  const [title, setTitle] = useState(initialItem?.title || '')
  const [creator, setCreator] = useState(initialItem?.creator || '')
  const [type, setType] = useState<ContentType>(initialItem?.type || 'movie')
  const [genre, setGenre] = useState<MyGenre>(initialItem?.genre || 'Drama')
  const [releaseYear, setReleaseYear] = useState(initialItem?.year || '')
  const [dateYear, setDateYear] = useState(initialItem?.dateYear || String(now.getFullYear()))
  const [dateMonth, setDateMonth] = useState(initialItem?.dateMonth || String(now.getMonth() + 1))
  const [dateDay, setDateDay] = useState(initialItem?.dateDay || '')
  const [rating, setRating] = useState(initialItem?.rating || 0)
  const [reflection, setReflection] = useState(initialItem?.reflection || '')
  const [posterUrl, setPosterUrl] = useState(initialItem?.posterUrl || '')
  const [uploadError, setUploadError] = useState(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const searchCtrl = useRef<AbortController | null>(null)
  const creatorCtrl = useRef<AbortController | null>(null)
  const pickToken = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Stop any pending search when the window closes.
  useEffect(() => () => {
    clearTimeout(searchTimer.current)
    searchCtrl.current?.abort()
    creatorCtrl.current?.abort()
  }, [])

  const handleQueryChange = (q: string) => {
    setQuery(q)
    clearTimeout(searchTimer.current)
    searchCtrl.current?.abort() // cancel the previous (now stale) request
    setSearchError(false)
    if (!q.trim()) { setResults([]); setShowResults(false); setSearching(false); return }
    setSearching(true); setShowResults(true)
    searchTimer.current = setTimeout(async () => {
      if (!hasApiKey()) { setResults([]); setSearchError(true); setSearching(false); return }
      const ctrl = new AbortController()
      searchCtrl.current = ctrl
      try {
        const r = await searchTmdb(q.trim(), ctrl.signal)
        if (ctrl.signal.aborted) return
        setResults(r); setSearching(false)
      } catch {
        if (ctrl.signal.aborted) return
        setResults([]); setSearchError(true); setSearching(false)
      }
    }, 400)
  }

  const pickResult = (r: SearchResult) => {
    clearTimeout(searchTimer.current)
    searchCtrl.current?.abort()
    setTitle(r.title); setType(r.type); setPosterUrl(r.posterUrl); setGenre(r.genre)
    setReleaseYear(r.year); setCreator('')
    setShowResults(false); setQuery(''); setSearching(false); setSearchError(false); setManual(true)
    // One optional extra lookup: director (movie) or creator (TV). Fills in quietly if found.
    const token = ++pickToken.current
    creatorCtrl.current?.abort()
    const ctrl = new AbortController()
    creatorCtrl.current = ctrl
    fetchCreator(r.type, r.id, ctrl.signal)
      .then(name => { if (token === pickToken.current && name) setCreator(c => c || name) })
      .catch(() => { /* leave it blank */ })
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setUploadError(false)
    try { setPosterUrl(await fileToPoster(file)) } catch { setUploadError(true) }
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleSubmit = () => {
    if (!title.trim()) return
    const keepStamp = initialItem && reflection === initialItem.reflection
    onAdd({
      title: title.trim(), creator: creator.trim(), type, genre, year: releaseYear,
      dateYear, dateMonth, dateDay, rating, reflection,
      reflectionEditedAt: !reflection ? '' : keepStamp ? initialItem!.reflectionEditedAt : todayLabel(),
      posterUrl: posterUrl.trim(),
    })
  }

  const previewW = 140, previewH = 210
  const posterIsUpload = posterUrl.startsWith('data:')
  const padX = isMobile ? 20 : 36

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(30,20,15,0.4)', backdropFilter: 'blur(6px)' }}>
      <div data-testid="modal" onClick={e => e.stopPropagation()} style={{ background: 'var(--panel)', backdropFilter: 'blur(24px)', borderRadius: 24, width: 'min(640px, calc(100vw - 24px))', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,0.22)', position: 'relative', animation: 'modalIn 0.28s ease' }}>

        {/* Pinned header */}
        <div style={{ padding: `${isMobile ? 26 : 32}px ${padX}px 0`, flexShrink: 0 }}>
          <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 20, right: 20, background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 500, marginBottom: 24, color: 'var(--text)' }}>{initialItem ? 'Edit title' : 'Add a title'}</div>
        </div>

        {/* Scrollable body */}
        <div ref={bodyRef} style={{ overflowY: 'auto', padding: `0 ${padX}px`, flex: 1, scrollbarWidth: 'thin' }}>
          <div style={{ display: 'flex', gap: 24, flexDirection: isMobile ? 'column' : 'row' }}>
            {/* Preview */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <Poster url={posterUrl} title={title} creator={creator} genre={genre} width={previewW} height={previewH} imgStyle={{ boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }} />
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Preview</span>
            </div>

            {/* Fields */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {!manual && (
                <div style={{ position: 'relative' }}>
                  <input data-testid="search" placeholder="Search movies & TV shows" value={query} onChange={e => handleQueryChange(e.target.value)} style={inputStyle} autoFocus />
                  {showResults && (
                    <div data-testid="results" style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, zIndex: 10, overflow: 'hidden', marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
                      {searching && <div style={{ padding: '12px 14px', fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'var(--text-muted)' }}>Searching…</div>}
                      {!searching && searchError && <div style={{ padding: '12px 14px', fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'var(--text-muted)' }}>Search unavailable, enter it manually.</div>}
                      {!searching && !searchError && results.length === 0 && <div style={{ padding: '12px 14px', fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'var(--text-muted)' }}>No matches. Try another spelling, or enter it manually.</div>}
                      {!searching && !searchError && results.map(r => (
                        <div key={r.key} data-result={r.key} onClick={() => pickResult(r)} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(200,180,165,0.15)', transition: 'background 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.background='rgba(200,180,165,0.15)')}
                          onMouseLeave={e => (e.currentTarget.style.background='transparent')}>
                          {r.posterUrl ? <img src={r.posterUrl} alt="" style={{ width: 30, height: 45, objectFit: 'cover', borderRadius: 2, flexShrink: 0 }} /> : <div style={{ width: 30, height: 45, background: 'rgba(180,160,145,0.2)', borderRadius: 2, flexShrink: 0 }} />}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{r.title}</div>
                            {r.originalTitle && <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'var(--text-muted)' }}>{r.originalTitle}</div>}
                            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'var(--text-muted)' }}>{r.year}</div>
                          </div>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', background: 'rgba(180,100,80,0.1)', padding: '3px 9px', borderRadius: 100, flexShrink: 0 }}>{typeLabel(r.type)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setManual(true)} style={{ ...linkBtnStyle, marginTop: 6, display: 'block' }}>Can't find it? Enter it manually.</button>
                </div>
              )}
              {manual && (
                <>
                  <div><label style={labelStyle}>Title *</label><input data-testid="title-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Movie or show title" style={inputStyle} autoFocus={!initialItem} /></div>
                  <div><label style={labelStyle}>Director / Creator</label><input data-testid="creator-input" value={creator} onChange={e => setCreator(e.target.value)} placeholder="Director or creator name" style={inputStyle} /></div>
                </>
              )}
              <div>
                <label style={labelStyle}>Type</label>
                <Segmented<ContentType> label="Type" value={type} onChange={setType} options={[{ value: 'movie', label: 'Movie' }, { value: 'tv', label: 'TV Show' }]} />
              </div>
              <div>
                <label style={labelStyle}>Genre</label>
                <select data-testid="genre-select" value={genre} onChange={e => setGenre(e.target.value as MyGenre)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {MY_GENRES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <DateTripleDropdown year={dateYear} month={dateMonth} day={dateDay} onYearChange={setDateYear} onMonthChange={setDateMonth} onDayChange={setDateDay} />
              <div><label style={labelStyle}>Rating</label><StarRating value={rating} onChange={setRating} size={22} /></div>
              <div>
                <label style={labelStyle}>Poster URL (optional)</label>
                <input data-testid="poster-input" value={posterIsUpload ? '' : posterUrl} onChange={e => setPosterUrl(e.target.value)} placeholder={posterIsUpload ? 'Uploaded image (type a URL to replace it)' : 'https://…'} style={inputStyle} />
                <div style={{ display: 'flex', gap: 14, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => fileRef.current?.click()} style={linkBtnStyle}>or upload an image</button>
                  {posterIsUpload && <button type="button" onClick={() => setPosterUrl('')} style={linkBtnStyle}>Remove uploaded image</button>}
                  {uploadError && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#b05050' }}>Couldn't read that image.</span>}
                </div>
                <input ref={fileRef} data-testid="poster-file" type="file" accept="image/*" onChange={e => handleFile(e.target.files?.[0])} style={{ display: 'none' }} />
              </div>
            </div>
          </div>

          {/* Reflection — full width, below the two-column section */}
          <div style={{ marginTop: 28, marginBottom: 8 }}>
            <label style={serifLabelStyle}>Your reflection</label>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>Your thoughts, what stayed with you, favorite moments, how it made you feel. Take as much space as you need.</div>
            <ReflectionTextarea value={reflection} onChange={setReflection} minRows={12} />
          </div>
        </div>

        {/* Pinned footer */}
        <div style={{ padding: `20px ${padX}px 28px`, flexShrink: 0, display: 'flex', gap: 12, justifyContent: 'flex-end', borderTop: '1px solid rgba(200,180,165,0.15)' }}>
          <button onClick={onClose} style={{ ...pillBtnStyle('ghost'), padding: '11px 24px' }}>Cancel</button>
          <button data-testid="submit" onClick={handleSubmit} disabled={!title.trim()} style={{ ...pillBtnStyle('dark'), padding: '11px 28px', opacity: title.trim() ? 1 : 0.4, cursor: title.trim() ? 'pointer' : 'not-allowed' }}>
            {initialItem ? 'Save changes' : 'Add to archive'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── SavedToast ─────────────────────────────────────────────────────────────
function SavedToast({ visible }: { visible: boolean }) {
  return (
    <div style={{
      position: 'fixed', bottom: 32, left: '50%', transform: `translateX(-50%) translateY(${visible ? 0 : 16}px)`,
      opacity: visible ? 1 : 0, transition: 'opacity 0.3s ease, transform 0.3s ease',
      background: 'rgba(50,35,25,0.92)', color: '#f5f0eb', borderRadius: 100,
      padding: '10px 20px', fontFamily: 'Inter, sans-serif', fontSize: 12, letterSpacing: '0.06em',
      display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none', zIndex: 500,
      boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
    }}>
      <span style={{ fontSize: 14 }}>✓</span> Saved
    </div>
  )
}

// ── ItemDetailPanel (side panel on desktop, bottom sheet on phones) ────────
function ItemDetailPanel({ item, onClose, onRemove, onEditDetails, onSaveReflection }: {
  item: Item
  onClose: () => void
  onRemove: () => void
  onEditDetails: () => void
  onSaveReflection: (text: string, editedAt: string) => void
}) {
  const isMobile = useIsMobile()
  const [reflExpanded, setReflExpanded] = useState(false)
  const [reflEditMode, setReflEditMode] = useState(false)
  const [reflDraft, setReflDraft] = useState(item.reflection)
  const [reflEditedAt, setReflEditedAt] = useState(item.reflectionEditedAt)
  const [showToast, setShowToast] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { requestAnimationFrame(() => setMounted(true)) }, [])

  const saveReflection = () => {
    const today = todayLabel()
    setReflEditedAt(today)
    setReflEditMode(false)
    setReflExpanded(true)
    setShowToast(true)
    onSaveReflection(reflDraft, today)
    setTimeout(() => setShowToast(false), 2500)
  }

  const cancelEdit = () => { setReflDraft(item.reflection); setReflEditMode(false) }

  const cw = 140, ch = 210
  const COLLAPSED_LINES = 5
  const lineH = 27
  const collapsedH = COLLAPSED_LINES * lineH

  const panelPos: React.CSSProperties = isMobile
    ? { left: 0, right: 0, bottom: 0, maxHeight: '88vh', borderRadius: '24px 24px 0 0', boxShadow: '0 -8px 48px rgba(0,0,0,0.18)', transform: mounted ? 'translateY(0)' : 'translateY(100%)' }
    : { top: 0, right: 0, bottom: 0, width: 560, borderRadius: '24px 0 0 24px', boxShadow: '-8px 0 48px rgba(0,0,0,0.18)', transform: mounted ? 'translateX(0)' : 'translateX(100%)' }
  const padX = isMobile ? 22 : 36

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(20,12,8,0.28)', backdropFilter: 'blur(2px)', transition: 'opacity 0.3s' }} />

      {/* Panel */}
      <div data-testid="detail" style={{
        position: 'fixed', zIndex: 101,
        background: 'var(--panel)', backdropFilter: 'blur(28px)',
        display: 'flex', flexDirection: 'column',
        transition: 'transform 0.35s cubic-bezier(0.32,0,0.1,1)',
        overflowY: 'auto', scrollbarWidth: 'thin',
        ...panelPos,
      }}>
        {/* Close */}
        <button onClick={onClose} aria-label="Close" style={{ position: 'sticky', top: 16, left: 'calc(100% - 52px)', display: 'block', marginLeft: 'auto', marginRight: 20, background: 'rgba(200,185,170,0.25)', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', width: 32, height: 32, borderRadius: 100, lineHeight: '32px', textAlign: 'center', flexShrink: 0, zIndex: 10 }}>×</button>

        <div style={{ padding: `0 ${padX}px 40px`, marginTop: -32 }}>
          {/* ── Top: poster + meta ── */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', paddingTop: 40 }}>
            <Poster url={item.posterUrl} title={item.title} creator={item.creator} genre={item.genre} width={cw} height={ch} imgStyle={{ boxShadow: '0 12px 28px rgba(0,0,0,0.2)' }} />
            <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 500, color: 'var(--text)', lineHeight: 1.2, marginBottom: 8 }}>{item.title}</div>
              {(item.creator || item.year) && <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>{[item.creator, item.year].filter(Boolean).join(' · ')}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                <span data-testid="type-tag" style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text)', background: 'var(--glass)', border: '1px solid var(--border)', padding: '3px 12px', borderRadius: 100, display: 'inline-block' }}>{typeLabel(item.type)}</span>
                <span data-testid="genre-tag" style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', background: 'rgba(180,100,80,0.1)', padding: '4px 12px', borderRadius: 100, display: 'inline-block' }}>{item.genre}</span>
              </div>
              {item.dateYear && <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>{formatDate(item.dateYear, item.dateMonth, item.dateDay)}</div>}
              {item.rating > 0 && <StarRating value={item.rating} size={18} />}
            </div>
          </div>

          {/* ── Divider ── */}
          <div style={{ height: 1, background: 'rgba(200,180,165,0.3)', margin: '28px 0' }} />

          {/* ── Reflection section ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 500 }}>My Reflection</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {reflEditedAt && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'var(--text-muted)' }}>Last edited {reflEditedAt}</span>}
                {reflExpanded && !reflEditMode && item.reflection && (
                  <button onClick={() => setReflEditMode(true)} style={{ ...pillBtnStyle('glass'), padding: '6px 14px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6.5 1.5l2 2L3 9H1V7L6.5 1.5z"/></svg>
                    Edit
                  </button>
                )}
              </div>
            </div>

            {/* No reflection yet */}
            {!item.reflection && !reflEditMode && (
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 16, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                No reflection yet.{' '}
                <button onClick={() => { setReflEditMode(true); setReflExpanded(true) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Cormorant Garamond, serif', fontStyle: 'italic', fontSize: 16, color: 'var(--accent)', textDecoration: 'underline' }}>Write one</button>
              </div>
            )}

            {/* Reflection text — collapsed or expanded */}
            {item.reflection && !reflEditMode && (
              <div>
                <div
                  onClick={() => setReflExpanded(e => !e)}
                  style={{
                    position: 'relative',
                    maxHeight: reflExpanded ? 'none' : collapsedH,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    transition: 'max-height 0.3s ease',
                  }}
                >
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, lineHeight: '27px', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {item.reflection}
                  </div>
                  {!reflExpanded && (
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, background: 'linear-gradient(transparent, var(--panel))', pointerEvents: 'none' }} />
                  )}
                </div>
                <button onClick={() => setReflExpanded(e => !e)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'var(--accent)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'underline' }}>
                  {reflExpanded ? 'Show less ↑' : 'Read more ↓'}
                </button>
              </div>
            )}

            {/* Edit mode */}
            {reflEditMode && (
              <div>
                <ReflectionTextarea value={reflDraft} onChange={setReflDraft} minRows={12} autoFocus />
                <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
                  <button onClick={cancelEdit} style={{ ...pillBtnStyle('ghost'), padding: '9px 20px', fontSize: 11 }}>Cancel</button>
                  <button onClick={saveReflection} style={{ ...pillBtnStyle('dark'), padding: '9px 22px', fontSize: 11 }}>Save</button>
                </div>
              </div>
            )}
          </div>

          {/* ── Divider ── */}
          <div style={{ height: 1, background: 'rgba(200,180,165,0.3)', margin: '28px 0' }} />

          {/* ── Footer actions ── */}
          {!confirmRemove ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onEditDetails} style={{ ...pillBtnStyle('ghost'), padding: '10px 20px', fontSize: 11 }}>Edit details</button>
              <button onClick={() => setConfirmRemove(true)} style={{ ...pillBtnStyle('ghost'), padding: '10px 20px', fontSize: 11, color: '#b05050', borderColor: 'rgba(180,80,80,0.25)' }}>Remove</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'var(--text-muted)' }}>Remove this title from your archive?</span>
              <button data-testid="confirm-remove" onClick={onRemove} style={{ ...pillBtnStyle('dark'), padding: '8px 18px', fontSize: 11, background: '#b05050' }}>Remove</button>
              <button onClick={() => setConfirmRemove(false)} style={{ ...pillBtnStyle('ghost'), padding: '8px 14px', fontSize: 11 }}>Cancel</button>
            </div>
          )}
        </div>
      </div>

      <SavedToast visible={showToast} />
    </>
  )
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const isMobile = useIsMobile()
  const [items, setItems] = useState<Item[]>(loadItems)
  const [activeGenre, setActiveGenre] = useState<Genre>('All')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(() => {
    const v = loadPref(TYPE_KEY, 'all')
    return v === 'movie' || v === 'tv' ? v : 'all'
  })
  const [showModal, setShowModal] = useState(false)
  const [selectedItem, setSelectedItem] = useState<Item | null>(null)
  const [editItem, setEditItem] = useState<Item | null>(null)
  const shelfRef = useRef<HTMLDivElement>(null)
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = loadPref(THEME_KEY, '')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => { document.title = `${TITLE_PLAIN} ${TITLE_ITALIC}` }, [])
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    savePref(THEME_KEY, next)
  }
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => loadPref(SORT_KEY, 'newest') === 'oldest' ? 'oldest' : 'newest')
  const [groupMode, setGroupMode] = useState<'shelf' | 'month'>(() => loadPref(GROUP_KEY, 'shelf') === 'month' ? 'month' : 'shelf')
  const [monthKey, setMonthKey] = useState<string>(() => loadPref(MONTH_KEY, ''))
  useEffect(() => { saveItems(items) }, [items])
  useEffect(() => { savePref(TYPE_KEY, typeFilter) }, [typeFilter])
  useEffect(() => { savePref(SORT_KEY, sortOrder) }, [sortOrder])
  useEffect(() => { savePref(GROUP_KEY, groupMode) }, [groupMode])
  useEffect(() => { savePref(MONTH_KEY, monthKey) }, [monthKey])

  const filteredItems = sortItems(
    items.filter(i => (activeGenre === 'All' || i.genre === activeGenre) && (typeFilter === 'all' || i.type === typeFilter)),
    sortOrder,
  )
  const groups = groupByMonth(filteredItems)

  const scrollToGroup = (key: string, smooth = true) => {
    groupRefs.current[key]?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  }
  const jumpToMonth = (key: string) => { setMonthKey(key); if (key) scrollToGroup(key) }

  // Return to the saved month when the By month view opens
  useEffect(() => {
    if (groupMode !== 'month' || !monthKey) return
    const t = setTimeout(() => scrollToGroup(monthKey, false), 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupMode])

  const addItem = useCallback((data: ItemData) => {
    const newItem: Item = {
      ...data, id: crypto.randomUUID(),
      offset: Math.round(Math.random() * 16 - 8),
      isNew: true,
    }
    setItems(prev => [newItem, ...prev])
    setShowModal(false)
    setTimeout(() => setItems(prev => prev.map(b => b.id === newItem.id ? { ...b, isNew: false } : b)), 1000)
    setTimeout(() => shelfRef.current?.scrollTo({ left: 0, behavior: 'smooth' }), 100)
  }, [])

  const removeItem = (id: string) => { setItems(prev => prev.filter(b => b.id !== id)); setSelectedItem(null) }

  const updateItem = (data: ItemData) => {
    if (!editItem) return
    setItems(prev => prev.map(b => b.id === editItem.id ? { ...b, ...data } : b))
    setEditItem(null); setSelectedItem(null)
  }

  const saveReflection = (id: string, text: string, editedAt: string) => {
    setItems(prev => prev.map(b => b.id === id ? { ...b, reflection: text, reflectionEditedAt: editedAt } : b))
    setSelectedItem(prev => prev?.id === id ? { ...prev, reflection: text, reflectionEditedAt: editedAt } : prev)
  }

  const shelfOverflows = filteredItems.length * 228 > (typeof window !== 'undefined' ? window.innerWidth : 1200) || groupMode === 'month'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>
      {/* Radial glows */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '20%', left: '30%', width: 600, height: 400, background: 'radial-gradient(ellipse,rgba(210,190,175,0.35),transparent 70%)', transform: 'translate(-50%,-50%)' }} />
        <div style={{ position: 'absolute', top: '60%', right: '20%', width: 500, height: 350, background: 'radial-gradient(ellipse,rgba(180,190,210,0.25),transparent 70%)' }} />
        <div style={{ position: 'absolute', bottom: '10%', left: '50%', width: 800, height: 300, background: 'radial-gradient(ellipse,rgba(200,180,165,0.2),transparent 70%)', transform: 'translateX(-50%)' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* ── Header ── */}
        <header style={{ padding: 'clamp(32px,4vw,48px) clamp(24px,5vw,64px) 28px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>A Personal Archive</div>
            <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 'clamp(28px,3.5vw,44px)', fontWeight: 400, color: 'var(--text)', lineHeight: 1.1, marginBottom: 10 }}>
              {TITLE_PLAIN} <em style={{ fontStyle: 'italic' }}>{TITLE_ITALIC}</em>
            </h1>
            <AnimatedCount count={items.length} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexShrink: 0 }}>
            <button onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)' }}>
              {theme === 'dark'
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>}
            </button>
            <button data-testid="add-btn" onClick={() => setShowModal(true)} style={{ ...pillBtnStyle('glass'), whiteSpace: 'nowrap', flexShrink: 0 }}>+ Add a title</button>
          </div>
        </header>

        {/* ── Filter chips + type filter ── */}
        <div style={{ padding: '0 clamp(24px,5vw,64px) 28px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <div style={{ overflowX: 'auto', display: 'flex', gap: 8, scrollbarWidth: 'none', flex: 1, minWidth: isMobile ? '100%' : 0 }}>
            {GENRES.map(g => (
              <button key={g} data-chip={g} onClick={() => setActiveGenre(g)} style={{ ...pillBtnStyle(activeGenre === g ? 'dark' : 'glass'), padding: '8px 18px', flexShrink: 0, opacity: items.length === 0 ? 0.4 : 1, background: activeGenre === g ? 'var(--chip-active-bg)' : 'var(--glass)', color: activeGenre === g ? 'var(--chip-active-text)' : 'var(--text)' }}>{g}</button>
            ))}
          </div>
          <div data-testid="type-filter" style={{ display: 'flex' }}>
            <Segmented<TypeFilter> label="Filter by type" value={typeFilter} onChange={setTypeFilter} options={[{ value: 'all', label: 'All' }, { value: 'movie', label: 'Movies' }, { value: 'tv', label: 'TV Shows' }]} />
          </div>
        </div>

        {/* ── Sort + By month ── */}
        {items.length > 0 && (
          <div style={{ padding: '0 clamp(24px,5vw,64px) 20px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button data-testid="sort-btn" onClick={() => setSortOrder(o => o === 'newest' ? 'oldest' : 'newest')} style={{ ...pillBtnStyle('glass'), padding: '6px 14px', fontSize: 12 }}>
              {sortOrder === 'newest' ? 'Newest first ↓' : 'Oldest first ↑'}
            </button>
            <button data-testid="month-btn" onClick={() => setGroupMode(m => m === 'month' ? 'shelf' : 'month')} style={{ ...pillBtnStyle(groupMode === 'month' ? 'dark' : 'glass'), padding: '6px 14px', fontSize: 12 }}>
              By month
            </button>
            {groupMode === 'month' && (
              <select
                data-testid="jump"
                value={groups.some(g => g.key === monthKey) ? monthKey : ''}
                onChange={e => jumpToMonth(e.target.value)}
                style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'var(--text)', background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 999, padding: '6px 14px', outline: 'none' }}
              >
                <option value="">Jump to month…</option>
                {groups.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
              </select>
            )}
          </div>
        )}

        {/* ── Shelf ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          {filteredItems.length === 0 ? (
            <EmptyShelf totalCount={items.length} genre={activeGenre} type={typeFilter} onAdd={() => setShowModal(true)} />
          ) : (
            <div ref={shelfRef} style={{ overflowX: groupMode === 'month' ? 'visible' : shelfOverflows ? 'auto' : 'visible', display: 'flex', flexDirection: groupMode === 'month' ? 'column' : 'row', gap: groupMode === 'month' ? 56 : 28, alignItems: groupMode === 'month' ? 'stretch' : 'flex-end', padding: '0 clamp(24px,5vw,64px) 0', scrollbarWidth: 'thin' }}>
              {(groupMode === 'month' ? groups : [{ key: 'all', label: '', items: filteredItems }]).map(g => (
                <div key={g.key} data-group={g.key} ref={el => { groupRefs.current[g.key] = el }} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, scrollMarginTop: 24 }}>
                  {groupMode === 'month' && (
                    <div data-testid="group-label" style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 16, whiteSpace: 'nowrap' }}>{g.label}</div>
                  )}
                  <div style={{ display: 'flex', flexWrap: groupMode === 'month' ? 'wrap' : 'nowrap', columnGap: 28, rowGap: groupMode === 'month' ? 32 : 0, alignItems: 'flex-end' }}>
                    {g.items.map(item => (
                      <PosterCard key={item.id} item={item} isNew={item.isNew} onSelect={() => setSelectedItem(item)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Shelf line */}
          <div style={{ position: 'relative', marginTop: 20, height: 36 }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'var(--shelf-line)' }} />
            <div style={{ position: 'absolute', top: 0, left: '10%', right: '10%', height: 20, background: 'linear-gradient(180deg, rgba(180,155,135,0.3), transparent)', filter: 'blur(6px)' }} />
            <div style={{ position: 'absolute', top: 2, left: 0, right: 0, height: 24, background: 'linear-gradient(180deg,rgba(200,185,170,0.12),transparent)', filter: 'blur(2px)' }} />
          </div>
        </div>

        {/* ── TMDB attribution (required) ── */}
        <footer style={{ padding: '0 24px 22px', textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 10, letterSpacing: '0.04em', color: 'var(--text-muted)', opacity: 0.8 }}>
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </footer>
      </div>

      {/* ── Overlays ── */}
      {showModal && <AddItemModal onClose={() => setShowModal(false)} onAdd={addItem} />}
      {editItem && <AddItemModal onClose={() => setEditItem(null)} onAdd={updateItem} initialItem={editItem} />}
      {selectedItem && !editItem && (
        <ItemDetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onRemove={() => removeItem(selectedItem.id)}
          onEditDetails={() => { setEditItem(selectedItem); setSelectedItem(null) }}
          onSaveReflection={(text, editedAt) => saveReflection(selectedItem.id, text, editedAt)}
        />
      )}
    </div>
  )
}
