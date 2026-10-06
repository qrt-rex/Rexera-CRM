import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Briefcase, Clock, CornerDownLeft, LayoutDashboard, Phone, Plus, Search, User as UserIcon, UserPlus, X } from 'lucide-react'
import { useDb } from '../lib/store'
import { useAuth, useMe } from '../lib/auth'
import { MODULES, canSee } from '../lib/modules'
import { visibleBookings, visibleLeads } from '../lib/actions'
import { isMaster, roleLabel, rolesOf, ROLES } from '../lib/rbac'
import { BOOKING_STATUS } from '../lib/workflow'
import { cx } from '../components/ui'

type Group = 'Clients' | 'Leads' | 'People' | 'Pages'
type Item = { id: string; label: string; sub: string; icon: typeof Search; to: string; group: Group | 'Actions' | 'Recent'; score: number; badge?: string }
const FILTERS: ('All' | Group)[] = ['All', 'Clients', 'Leads', 'People', 'Pages']
const PER_GROUP = 6
const RECENT_KEY = 'rexera-search-recent'

const readRecent = (): Item[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] } }
const saveRecent = (it: Item) => {
  try {
    const list = [{ ...it, group: 'Recent' as const, icon: undefined }, ...readRecent().filter((x) => x.to !== it.to)].slice(0, 6)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch { /* storage off */ }
}
const RECENT_ICON: Record<string, typeof Search> = { '/bookings': Briefcase, '/leads': UserPlus, '/employees': UserIcon }
const iconFor = (to: string) => RECENT_ICON[Object.keys(RECENT_ICON).find((k) => to.startsWith(k)) ?? ''] ?? ArrowRight

/** 3 = starts with the query, 2 = a word starts with it, 1 = contains it, 0 = no match. Phone numbers match digits only. */
function scoreOf(q: string, digits: string, ...fields: (string | undefined)[]) {
  let best = 0
  for (const f of fields) {
    if (!f) continue
    const v = f.toLowerCase()
    if (v.startsWith(q)) return 3
    if (new RegExp(`(^|[\\s·\\-_.@/(])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(v)) best = Math.max(best, 2)
    else if (v.includes(q)) best = Math.max(best, 1)
    if (digits.length >= 3 && f.replace(/\D/g, '').includes(digits)) best = Math.max(best, 2)
  }
  return best
}

function Highlight({ text, q }: { text: string; q: string }): ReactNode {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return text
  return <>{text.slice(0, i)}<mark className="rounded bg-accent-soft px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'All' | Group>('All')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) { setQ(''); setFilter('All'); setSel(0); setTimeout(() => input.current?.focus(), 10) } }, [open])
  const s = q.trim().toLowerCase()
  const digits = s.replace(/\D/g, '')

  const { items, counts } = useMemo(() => {
    const counts: Record<Group, number> = { Clients: 0, Leads: 0, People: 0, Pages: 0 }
    if (!s) {
      const actions: Item[] = [
        ...(can('leads.own', 'leads.manage') ? [{ id: 'a-lead', label: 'CRM Leads', sub: 'Open your leads', icon: UserPlus, to: '/leads', group: 'Actions' as const, score: 0 }] : []),
        ...(can('bookings.create') ? [{ id: 'a-entry', label: 'New CRM entry', sub: 'Book a client with advance', icon: Plus, to: '/bookings/new', group: 'Actions' as const, score: 0 }] : []),
        ...(can('dialer.use') ? [{ id: 'a-dial', label: 'Dialer', sub: 'Call your queue', icon: Phone, to: '/dialer', group: 'Actions' as const, score: 0 }] : []),
        { id: 'a-dash', label: 'My dashboard', sub: roleLabel(me.role), icon: LayoutDashboard, to: `/dashboard/${me.role}`, group: 'Actions' as const, score: 0 },
      ]
      const recent = readRecent().map((r) => ({ ...r, icon: iconFor(r.to) }))
      return { items: [...recent, ...actions], counts }
    }
    const all: Item[] = []
    const dashRoles = isMaster(me) ? ROLES.map((r) => r.id) : rolesOf(me)
    for (const r of dashRoles) { const sc = scoreOf(s, '', roleLabel(r), 'dashboard'); if (sc) all.push({ id: 'd-' + r, label: `${roleLabel(r)} Dashboard`, sub: 'Dashboard', icon: LayoutDashboard, to: `/dashboard/${r}`, group: 'Pages', score: sc }) }
    for (const m of MODULES) { if (!canSee(m, can)) continue; const sc = scoreOf(s, '', m.label, m.desc); if (sc) all.push({ id: m.key, label: m.label, sub: m.desc, icon: m.icon, to: m.path, group: 'Pages', score: sc }) }
    if (s.length >= 2 || digits.length >= 3) {
      for (const b of visibleBookings(db, me)) { const sc = scoreOf(s, digits, b.companyName, b.bookingId, b.contactPerson, b.mobile, b.serviceName, b.email, b.pan, b.gstin); if (sc) all.push({ id: b.id, label: b.companyName, sub: `${b.bookingId} · ${b.contactPerson} · ${b.mobile}`, icon: Briefcase, to: `/bookings/${b.id}`, group: 'Clients', score: sc, badge: BOOKING_STATUS[b.status]?.label }) }
      for (const l of visibleLeads(db, me)) { const sc = scoreOf(s, digits, l.name, l.company, l.phone, l.code, l.email); if (sc) all.push({ id: l.id, label: l.name + (l.company ? ` · ${l.company}` : ''), sub: `${l.code} · ${l.phone}`, icon: UserPlus, to: `/leads?open=${l.id}`, group: 'Leads', score: sc, badge: l.status.replace('_', ' ').toLowerCase() }) }
      if (can('employees.view', 'access.manage', 'employees.manage')) for (const u of db.users) { const sc = scoreOf(s, digits, u.name, u.username, u.email, u.phone); if (sc) all.push({ id: u.id, label: u.name, sub: `${roleLabel(u.role)} · ${u.email}`, icon: UserIcon, to: `/employees?open=${u.id}`, group: 'People', score: sc }) }
    }
    for (const it of all) counts[it.group as Group]++
    const order: Group[] = ['Clients', 'Leads', 'People', 'Pages']
    const out: Item[] = []
    for (const g of order) {
      if (filter !== 'All' && filter !== g) continue
      out.push(...all.filter((x) => x.group === g).sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, filter === 'All' ? PER_GROUP : 40))
    }
    return { items: out, counts }
  }, [s, digits, db, me, can, filter])

  useEffect(() => setSel(0), [q, filter])
  useEffect(() => { listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' }) }, [sel])
  if (!open) return null
  const go = (it?: Item) => { if (!it) return; saveRecent(it); nav(it.to); onClose() }
  const seeAll: Partial<Record<Group, string>> = { Clients: `/bookings`, Leads: `/leads` }
  let lastGroup = ''

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-[#0b1020]/45 p-3 pt-[8vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="anim-pop flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-pop" role="dialog" aria-label="Search">
        <div className="flex items-center gap-3 px-4 pt-3">
          <Search className="size-5 shrink-0 text-brand-ink" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients, leads, people, pages…" aria-label="Search"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(items.length - 1, x + 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)) }
              if (e.key === 'Enter') go(items[sel])
              if (e.key === 'Tab' && s) { e.preventDefault(); setFilter((f) => FILTERS[(FILTERS.indexOf(f) + (e.shiftKey ? FILTERS.length - 1 : 1)) % FILTERS.length]!) }
            }}
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-mute" />
          {q && <button aria-label="Clear search" onClick={() => { setQ(''); input.current?.focus() }} className="grid size-8 place-items-center rounded-lg text-mute hover:bg-card2 hover:text-ink"><X className="size-4" /></button>}
          <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[10px] text-mute sm:inline">ESC</kbd>
        </div>
        {s && (
          <div className="flex gap-1.5 overflow-x-auto border-b border-line px-4 pb-3 pt-1">
            {FILTERS.map((f) => {
              const n = f === 'All' ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[f]
              return (
                <button key={f} onClick={() => setFilter(f)} className={cx('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition', filter === f ? 'border-brand bg-brand text-white' : 'border-line text-mute hover:text-ink')}>
                  {f}<span className={cx('rounded-full px-1.5 text-[10px]', filter === f ? 'bg-white/20' : 'bg-card2')}>{n}</span>
                </button>
              )
            })}
          </div>
        )}
        {!s && <div className="border-b border-line" />}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {s && !items.length && (
            <div className="px-4 py-12 text-center">
              <p className="text-sm font-semibold">No results for “{q}”</p>
              <p className="mt-1 text-xs text-mute">Try a company name, mobile number, booking ID or person.</p>
            </div>
          )}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? (lastGroup = it.group) : null
            const g = it.group as Group
            return (
              <div key={it.group + it.id + it.to}>
                {header && (
                  <div className="flex items-center justify-between px-3 pb-1 pt-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-mute">{header === 'Recent' ? <span className="inline-flex items-center gap-1"><Clock className="size-3" />Recently opened</span> : header === 'Actions' ? 'Quick actions' : header}</p>
                    {s && filter === 'All' && counts[g] > PER_GROUP && <button onClick={() => setFilter(g)} className="text-[11px] font-semibold text-brand-ink hover:underline">See all {counts[g]}</button>}
                    {s && filter === g && seeAll[g] && <button onClick={() => { nav(seeAll[g]!); onClose() }} className="text-[11px] font-semibold text-brand-ink hover:underline">Open {g.toLowerCase()} page</button>}
                  </div>
                )}
                <button data-i={i} onMouseMove={() => sel !== i && setSel(i)} onClick={() => go(it)}
                  className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition', sel === i ? 'bg-brand-soft' : 'hover:bg-card2')}>
                  <span className={cx('grid size-9 shrink-0 place-items-center rounded-lg', sel === i ? 'bg-brand text-white' : 'bg-card2 text-brand-ink')}><it.icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold"><Highlight text={it.label} q={s} /></span>
                    <span className="block truncate text-xs text-mute"><Highlight text={it.sub} q={s} /></span>
                  </span>
                  {it.badge && <span className="hidden shrink-0 rounded-full bg-card2 px-2 py-0.5 text-[10px] font-semibold capitalize text-mute sm:inline">{it.badge}</span>}
                  {sel === i && <CornerDownLeft className="size-4 shrink-0 text-mute" />}
                </button>
              </div>
            )
          })}
        </div>
        <div className="hidden items-center gap-4 border-t border-line bg-card2/60 px-4 py-2 text-[11px] text-mute sm:flex">
          <span><kbd className="rounded border border-line bg-card px-1">↑</kbd> <kbd className="rounded border border-line bg-card px-1">↓</kbd> move</span>
          <span><kbd className="rounded border border-line bg-card px-1">Enter</kbd> open</span>
          {s && <span><kbd className="rounded border border-line bg-card px-1">Tab</kbd> next filter</span>}
          <span className="ml-auto">Tip: type a mobile number or booking ID</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
