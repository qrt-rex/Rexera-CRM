import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Briefcase, CornerDownLeft, LayoutDashboard, Search, User as UserIcon, UserPlus } from 'lucide-react'
import { useDb } from '../lib/store'
import { useAuth, useMe } from '../lib/auth'
import { MODULES, canSee } from '../lib/modules'
import { visibleBookings, visibleLeads } from '../lib/actions'
import { isMaster, roleLabel, rolesOf, ROLES } from '../lib/rbac'
import { cx } from '../components/ui'

type Item = { id: string; label: string; sub: string; icon: typeof Search; to: string; group: string }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 10) } }, [open])

  const items = useMemo<Item[]>(() => {
    const s = q.trim().toLowerCase()
    const match = (...f: (string | undefined)[]) => !s || f.some((x) => x?.toLowerCase().includes(s))
    const out: Item[] = []
    const dashRoles = isMaster(me) ? ROLES.map((r) => r.id) : rolesOf(me)
    for (const r of dashRoles) if (match(roleLabel(r), 'dashboard')) out.push({ id: 'd-' + r, label: `${roleLabel(r)} Dashboard`, sub: 'Dashboard', icon: LayoutDashboard, to: `/dashboard/${r}`, group: 'Dashboards' })
    for (const m of MODULES) if (canSee(m, can) && match(m.label, m.desc)) out.push({ id: m.key, label: m.label, sub: m.desc, icon: m.icon, to: m.path, group: 'Pages' })
    if (s.length >= 2) {
      for (const b of visibleBookings(db, me)) if (match(b.bookingId, b.companyName, b.contactPerson, b.mobile, b.serviceName)) out.push({ id: b.id, label: `${b.bookingId} · ${b.companyName}`, sub: b.serviceName, icon: Briefcase, to: `/bookings/${b.id}`, group: 'CRM entries' })
      for (const l of visibleLeads(db, me)) if (match(l.name, l.company, l.phone, l.code)) out.push({ id: l.id, label: `${l.name} · ${l.company}`, sub: `${l.code} · ${l.phone}`, icon: UserPlus, to: `/leads?open=${l.id}`, group: 'Leads' })
      if (can('employees.view', 'access.manage', 'employees.manage')) for (const u of db.users) if (match(u.name, u.username, u.email)) out.push({ id: u.id, label: u.name, sub: `${roleLabel(u.role)} · ${u.email}`, icon: UserIcon, to: `/employees?open=${u.id}`, group: 'People' })
    }
    return out.slice(0, 40)
  }, [q, db, me, can])

  useEffect(() => setSel(0), [q])
  if (!open) return null
  const go = (it?: Item) => { if (!it) return; nav(it.to); onClose() }
  let lastGroup = ''

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-[#0b1020]/50 p-4 pt-[10vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="anim-pop w-full max-w-xl overflow-hidden rounded-3xl border border-line bg-card shadow-pop" role="dialog" aria-label="Search">
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Search className="size-5 text-mute" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages, clients, leads, people…"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(items.length - 1, x + 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)) }
              if (e.key === 'Enter') go(items[sel])
            }}
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-mute" />
          <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-mute">ESC</kbd>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {!items.length && <p className="px-4 py-10 text-center text-sm text-mute">No results for “{q}”.</p>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? (lastGroup = it.group) : null
            return (
              <div key={it.group + it.id}>
                {header && <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-mute">{header}</p>}
                <button onMouseEnter={() => setSel(i)} onClick={() => go(it)}
                  className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', sel === i ? 'bg-brand-soft' : '')}>
                  <span className="grid size-9 place-items-center rounded-lg bg-card2 text-brand-ink"><it.icon className="size-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{it.label}</span><span className="block truncate text-xs text-mute">{it.sub}</span></span>
                  {sel === i && <CornerDownLeft className="size-4 text-mute" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
