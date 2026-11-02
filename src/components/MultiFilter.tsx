import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, FilterX, SlidersHorizontal } from 'lucide-react'
import { Button, cx } from './ui'

export interface FilterOption { value: string; label: string; count: number; color?: string }

/**
 * An Excel-style column filter: a button, and a list of checkboxes with the number of matching rows, highest first
 * (the order picked for each filter can be kept with `keepOrder`). Search inside, select all / clear. No selection = all.
 */
export function MultiFilter({ label, options, value, onChange, keepOrder, width = 'w-72' }: {
  label: string; options: FilterOption[]; value: string[]; onChange: (v: string[]) => void; keepOrder?: boolean; width?: string
}) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const [q, setQ] = useState('')
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const sorted = useMemo(() => (keepOrder ? options : [...options].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))), [options, keepOrder])
  const shown = sorted.filter((o) => !q.trim() || o.label.toLowerCase().includes(q.trim().toLowerCase()))
  const open = () => {
    const r = btn.current!.getBoundingClientRect()
    setQ('')
    setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, innerWidth - 300)) })
  }
  useEffect(() => {
    if (!at) return
    const inside = (n: EventTarget | null) => !!n && (pop.current?.contains(n as Node) || btn.current?.contains(n as Node))
    const down = (e: MouseEvent) => { if (!inside(e.target)) setAt(null) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null) }
    // scrolling the page closes it; scrolling the list inside does not
    const scroll = (e: Event) => { if (!inside(e.target)) setAt(null) }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    addEventListener('scroll', scroll, true); addEventListener('resize', () => setAt(null), { once: true })
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); removeEventListener('scroll', scroll, true) }
  }, [at])
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  const picked = options.filter((o) => value.includes(o.value))

  return (
    <>
      <button ref={btn} type="button" onClick={() => (at ? setAt(null) : open())} aria-expanded={!!at} aria-haspopup="listbox"
        className={cx('inline-flex h-10 max-w-64 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition', value.length ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-card text-ink hover:bg-card2')}>
        <span className="truncate">{label}{value.length === 1 ? `: ${picked[0]?.label ?? ''}` : ''}</span>
        {value.length > 1 && <span className="rounded-full bg-brand px-1.5 text-[11px] text-white">{value.length}</span>}
        <ChevronDown className={cx('size-4 shrink-0 transition', at && 'rotate-180')} />
      </button>
      {at && createPortal(
        <div ref={pop} role="listbox" aria-multiselectable="true" aria-label={label} style={{ position: 'fixed', top: at.top, left: at.left }}
          className={cx('anim-pop z-[85] flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-pop', width)}>
          <div className="border-b border-line p-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label}`}
              className="h-9 w-full rounded-lg border border-line bg-card px-3 text-sm outline-none focus:border-brand" />
            <div className="mt-2 flex items-center justify-between px-1 text-xs">
              <button type="button" className="font-semibold text-brand-ink hover:underline" onClick={() => onChange([...new Set([...value, ...shown.map((o) => o.value)])])}>Select all{q ? ' shown' : ''}</button>
              <button type="button" className="font-semibold text-mute hover:underline" onClick={() => onChange(q ? value.filter((v) => !shown.some((o) => o.value === v)) : [])}>Clear</button>
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {shown.map((o) => (
              <li key={o.value}>
                <label className={cx('flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-card2', !o.count && !value.includes(o.value) && 'opacity-50')}>
                  <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} className="size-4 accent-[var(--brand)]" />
                  {o.color && <span className="size-2.5 shrink-0 rounded-full" style={{ background: o.color }} />}
                  <span className="min-w-0 flex-1 truncate" title={o.label}>{o.label}</span>
                  <span className="rounded-full bg-card2 px-1.5 text-[11px] font-semibold tabular-nums text-mute">{o.count}</span>
                </label>
              </li>
            ))}
            {!shown.length && <li className="px-3 py-3 text-xs text-mute">Nothing matches.</li>}
          </ul>
          <div className="border-t border-line p-2 text-right"><Button size="sm" onClick={() => setAt(null)}>Done</Button></div>
        </div>,
        document.body,
      )}
    </>
  )
}

/** A row of filters with "N filters on · Clear all". */
export function FilterBar({ active, onClear, children }: { active: number; onClear: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-mute"><SlidersHorizontal className="size-3.5" />Filters</span>
      {children}
      {active > 0 && <Button size="sm" variant="ghost" icon={FilterX} onClick={onClear}>Clear {active} filter{active === 1 ? '' : 's'}</Button>}
    </div>
  )
}

/** Options with counts from rows: `key` gives a row's value(s) for this filter. */
export function optionsFrom<T>(rows: T[], key: (r: T) => string | string[] | undefined | null, label: (v: string) => string = (v) => v, color?: (v: string) => string | undefined): FilterOption[] {
  const n = new Map<string, number>()
  for (const r of rows) for (const v of [key(r)].flat()) if (v) n.set(v, (n.get(v) ?? 0) + 1)
  return [...n].map(([value, count]) => ({ value, label: label(value), count, color: color?.(value) }))
}
