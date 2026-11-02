import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Download, ScrollText, ShieldCheck } from 'lucide-react'
import type { Audit as Entry } from '../../lib/types'
import { useDb } from '../../lib/store'
import { userName } from '../../lib/actions'
import { roleLabel } from '../../lib/rbac'
import { downloadCsv, today, ymd } from '../../lib/format'
import { FilterBar, MultiFilter, optionsFrom } from '../../components/MultiFilter'
import { Badge, Button, Card, EmptyState, PageHeader, SearchBox, Table, Td, Th, usePaged } from '../../components/ui'

/** "BOOKING_APPROVE" → "Booking approve" */
const nice = (a: string) => a.charAt(0) + a.slice(1).toLowerCase().replace(/_/g, ' ')
const exact = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const tone = (a: string) => /REJECT|DELETE|PURGE|DEACTIVATE|NO_EMAIL_CODE/.test(a) ? 'red' : /ACCESS|ROLE|PERM|PASSWORD/.test(a) ? 'violet' : /SIGN_IN|SIGN_OUT|LOGIN|LOGOUT/.test(a) ? 'gray' : /PAY|INVOICE|REFUND|BILL/.test(a) ? 'green' : /SENT_BACK|HOLD/.test(a) ? 'amber' : 'navy'

/**
 * Super Admin: every action of every person — name and role, the client (CRM ID and company), what changed (before and
 * after), date and exact time. Filter by role, person, activity type, client and dates. The log can't be edited or deleted.
 */
export default function Audit() {
  const db = useDb()
  const [q, setQ] = useState('')
  const [client, setClient] = useState('')
  const [roles, setRoles] = useState<string[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [kinds, setKinds] = useState<string[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const bookingById = useMemo(() => new Map(db.bookings.map((b) => [b.id, b])), [db.bookings])
  const userById = useMemo(() => new Map(db.users.map((u) => [u.id, u])), [db.users])
  /** the role(s) at the time (stamped), else the person's role now */
  const rolesOf = (a: Entry) => (a.role ? a.role.split(',') : userById.get(a.by) ? [userById.get(a.by)!.role] : ['system'])
  const clientOf = (a: Entry) => (a.ref ? bookingById.get(a.ref) : undefined)
  const roleName = (r: string) => (r === 'system' ? 'System' : roleLabel(r as never))

  const cl = client.trim().toLowerCase(), ql = q.trim().toLowerCase()
  const base = db.audit.filter((a) => (!from || ymd(a.at) >= from) && (!to || ymd(a.at) <= to)
    && (!cl || (() => { const b = clientOf(a); return `${b?.bookingId ?? ''} ${b?.companyName ?? ''} ${a.detail}`.toLowerCase().includes(cl) })())
    && (!ql || `${a.detail} ${a.action} ${userName(db, a.by)} ${a.before ?? ''} ${a.after ?? ''}`.toLowerCase().includes(ql)))
  const pass = (a: Entry, skip?: 'role' | 'person' | 'kind') => (skip === 'role' || !roles.length || rolesOf(a).some((r) => roles.includes(r)))
    && (skip === 'person' || !people.length || people.includes(a.by)) && (skip === 'kind' || !kinds.length || kinds.includes(a.action))
  const list = base.filter((a) => pass(a))
  const { slice, pager } = usePaged(list, 50, [q, client, roles, people, kinds, from, to])
  const active = [roles, people, kinds].filter((x) => x.length).length + (from || to ? 1 : 0)
  const roleCounts = optionsFrom(base.filter((a) => pass(a, 'role')), rolesOf, roleName).sort((x, y) => y.count - x.count)

  const exportCsv = () => downloadCsv(`activity-log-${today()}.csv`, list.map((a) => {
    const b = clientOf(a)
    return { date_time: exact(a.at), user_id: a.by, user: userName(db, a.by), role: rolesOf(a).map(roleName).join(' + '), activity: nice(a.action), client_id: b?.bookingId ?? '', client_name: b?.companyName ?? '', detail: a.detail, before: a.before ?? '', after: a.after ?? '' }
  }))

  return (
    <div>
      <PageHeader title="Activity Log" icon={ScrollText} subtitle="Every action by every person — role, client, what changed and the exact time · Super Admin only, nothing here can be edited or deleted"
        actions={<Button variant="outline" icon={Download} disabled={!list.length} onClick={exportCsv}>Export</Button>} />

      {/* role-wise: how much each team did in the period shown (highest first) */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setRoles([])} className={`rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${!roles.length ? 'border-brand bg-brand text-white' : 'border-line bg-card hover:bg-card2'}`}>All roles · {base.filter((a) => pass(a, 'role')).length}</button>
        {roleCounts.map((r) => (
          <button key={r.value} onClick={() => setRoles([r.value])} className={`rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${roles.length === 1 && roles[0] === r.value ? 'border-brand bg-brand text-white' : 'border-line bg-card hover:bg-card2'}`}>{r.label} · {r.count}</button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="grid gap-3 border-b border-line p-4">
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox value={q} onChange={setQ} placeholder="Search action, detail, value…" className="min-w-56 flex-1" />
            <SearchBox value={client} onChange={setClient} placeholder="Client: CRM ID or company…" className="min-w-56 flex-1" />
            <span className="flex items-center gap-1.5 text-xs text-mute">From
              <input type="date" value={from} max={to || today()} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-2 text-sm text-ink" aria-label="From date" />to
              <input type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-2 text-sm text-ink" aria-label="To date" />
            </span>
          </div>
          <FilterBar active={active} onClear={() => { setRoles([]); setPeople([]); setKinds([]); setFrom(''); setTo('') }}>
            <MultiFilter label="Role" value={roles} onChange={setRoles} options={roleCounts} />
            <MultiFilter label="User" value={people} onChange={setPeople} options={optionsFrom(base.filter((a) => pass(a, 'person')), (a) => a.by, (v) => userName(db, v))} />
            <MultiFilter label="Activity type" value={kinds} onChange={setKinds} options={optionsFrom(base.filter((a) => pass(a, 'kind')), (a) => a.action, nice)} width="w-80" />
          </FilterBar>
        </div>
        {!list.length ? <EmptyState icon={ScrollText} title="No activity" text="Nothing matches these filters." /> : (
          <Table>
            <thead><tr><Th>Date &amp; time</Th><Th>User · role</Th><Th>Activity</Th><Th>Client</Th><Th>Details</Th><Th>Before → after</Th></tr></thead>
            <tbody>{slice.map((a) => {
              const b = clientOf(a)
              return (
                <tr key={a.id} className="align-top">
                  <Td className="whitespace-nowrap text-xs tabular-nums text-mute">{exact(a.at)}</Td>
                  <Td><button type="button" className="block text-left font-semibold hover:text-brand-ink hover:underline" onClick={() => setPeople([a.by])} title="Show only this person">{userName(db, a.by)}</button>
                    <span className="mt-0.5 flex flex-wrap gap-1">{rolesOf(a).map((r) => <Badge key={r} tone="gray">{roleName(r)}</Badge>)}</span></Td>
                  <Td><Badge tone={tone(a.action)}>{nice(a.action)}</Badge></Td>
                  <Td className="text-xs">{b ? <Link to={`/bookings/${b.id}`} className="block max-w-48 hover:text-brand-ink hover:underline"><span className="font-mono font-semibold">{b.bookingId}</span><span className="block truncate">{b.companyName}</span></Link> : <span className="text-mute">—</span>}</Td>
                  <Td className="max-w-md text-sm">{a.detail}</Td>
                  <Td className="max-w-xs text-xs">{a.before != null || a.after != null ? <span className="flex flex-wrap items-center gap-1"><span className="rounded bg-bad-soft px-1.5 py-0.5 text-bad line-through decoration-bad/40">{a.before || '—'}</span><ArrowRight className="size-3 text-mute" /><span className="rounded bg-ok-soft px-1.5 py-0.5 text-ok">{a.after || '—'}</span></span> : <span className="text-mute">—</span>}</Td>
                </tr>
              )
            })}</tbody>
          </Table>
        )}
        {pager}
        <p className="flex items-center gap-1.5 border-t border-line px-4 py-2.5 text-xs text-mute"><ShieldCheck className="size-3.5" />Written automatically by the CRM as people work; no one can change or delete an entry. The newest {db.audit.length} entries are shown here — older ones stay in the database.</p>
      </Card>
    </div>
  )
}
