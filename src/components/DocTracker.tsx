import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, Download, FileStack } from 'lucide-react'
import type { AdminStageId, AdminWorkItem, BDoc, Booking } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { stageFiles, userName, usersWithRole, visibleBookings } from '../lib/actions'
import { ADMIN_DONE, ADMIN_STAGES, ADMIN_WORK_STATUSES, adminStatusLabel, workflowSettings } from '../../supabase/workflow-rules.mjs'
import { downloadCsv, fmtDate, fmtDateTime, today, ymd } from '../lib/format'
import { Badge, Button, Card, CardHeader, cx, EmptyState, Input, SearchBox, Stat, Table, Td, Th } from './ui'
import { FileLink } from './FileField'

const tone = (s: AdminWorkItem['status']) => ADMIN_WORK_STATUSES.find((x) => x.id === s)!.tone
type Row = { person: string; b: Booking; stages: AdminStageId[] }
const latest = (docs: BDoc[]) => docs.reduce<string>((m, d) => (d.at > m ? d.at : m), '')
/** Verified / rejected / waiting, from the stage's uploaded files (the newest file decides). */
const review = (docs: BDoc[]) => { const d = [...docs].sort((a, b) => b.at.localeCompare(a.at))[0]; return d ? (d.status ?? 'PENDING') : null }

/**
 * Admin documents report: the five documents (Pitch Deck, Finance, DPR, Certification, Submission) per person and
 * file — status, assignment number, upload and submission dates, the file's review and its links, plus the history.
 * Everything comes straight from the CRM entries (no separate counts to drift).
 */
export function DocTracker() {
  const db = useDb()
  const me = useMe()
  const [person, setPerson] = useState('')
  const [state, setState] = useState<'all' | 'pending' | 'submitted' | 'done'>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => visibleBookings(db, me).filter((b) => b.adminWork).flatMap((b) => {
    const byPerson = new Map<string, AdminStageId[]>()
    for (const s of ADMIN_STAGES) { const w = b.adminWork![s.id]; if (w) byPerson.set(w.assignee ?? '', [...(byPerson.get(w.assignee ?? '') ?? []), s.id]) }
    return [...byPerson].map(([p, stages]) => ({ person: p, b, stages }))
  }), [db, me])
  const items = (r: Row) => r.stages.map((s) => r.b.adminWork![s]!)
  const list = rows.filter((r) => {
    if (person && r.person !== (person === '-' ? '' : person)) return false
    const its = items(r)
    if (state === 'pending' && !its.some((w) => !ADMIN_DONE.includes(w.status) && w.status !== 'NOT_NEEDED')) return false
    if (state === 'submitted' && !its.some((w) => w.status === 'SUBMITTED')) return false
    if (state === 'done' && !its.every((w) => ADMIN_DONE.includes(w.status) || w.status === 'NOT_NEEDED')) return false
    const last = its.reduce((m, w) => (w.updatedAt > m ? w.updatedAt : m), '')
    if (from && ymd(last) < from) return false
    if (to && ymd(last) > to) return false
    return !q || `${r.b.companyName} ${r.b.bookingId} ${userName(db, r.person)} ${its.map((w) => w.ref ?? '').join(' ')}`.toLowerCase().includes(q.toLowerCase())
  }).sort((a, b) => userName(db, a.person).localeCompare(userName(db, b.person)) || b.b.updatedAt.localeCompare(a.b.updatedAt))

  // ---------------------------------------------------------------- admin-wise counts (every Admin, from the CRM entries)
  // assigned = a document stage given to the Admin (not "not needed"); uploaded = it has a file; completed = approved /
  // completed; pending = assigned − completed
  const books = useMemo(() => visibleBookings(db, me).filter((b) => b.adminWork), [db, me])
  const access = workflowSettings(db.settings.workflow).adminStageAccess ?? {}
  const adminRows = useMemo(() => usersWithRole(db, 'admin').map((u) => {
    const per = ADMIN_STAGES.map((s) => {
      const its = books.map((b) => ({ b, w: b.adminWork![s.id] })).filter((x) => x.w?.assignee === u.id && x.w.status !== 'NOT_NEEDED')
      return { allowed: !access[u.id] || access[u.id]!.includes(s.id), assigned: its.length, uploaded: its.filter((x) => stageFiles(x.b, s.id).length).length, done: its.filter((x) => ADMIN_DONE.includes(x.w!.status)).length }
    })
    const sum = (k: 'assigned' | 'uploaded' | 'done') => per.reduce((n, x) => n + x[k], 0)
    return { u, per, assigned: sum('assigned'), uploaded: sum('uploaded'), completed: sum('done'), pending: sum('assigned') - sum('done'), types: per.filter((x) => x.allowed).length }
  }), [db, books, access])
  const [aq, setAq] = useState('')
  const [docType, setDocType] = useState<'' | AdminStageId>('')
  const [onlyPending, setOnlyPending] = useState(false)
  const [sortBy, setSortBy] = useState<'name' | 'assigned' | 'uploaded' | 'pending' | 'completed'>('pending')
  const adminList = adminRows
    .filter((r) => !aq || `${r.u.name} ${r.u.email}`.toLowerCase().includes(aq.toLowerCase()))
    .filter((r) => !docType || r.per[ADMIN_STAGES.findIndex((s) => s.id === docType)]!.allowed)
    .filter((r) => !onlyPending || r.pending > 0)
    .sort((a, b) => (sortBy === 'name' ? a.u.name.localeCompare(b.u.name) : b[sortBy] - a[sortBy] || a.u.name.localeCompare(b.u.name)))
  const tot = (k: 'assigned' | 'uploaded' | 'completed' | 'pending') => adminList.reduce((n, r) => n + r[k], 0)
  const totType = (i: number) => adminList.reduce((n, r) => n + r.per[i]!.assigned, 0)

  const csv = () => downloadCsv(`admin-documents-${today()}.csv`, list.flatMap((r) => r.stages.map((s) => {
    const w = r.b.adminWork![s]!, docs = stageFiles(r.b, s)
    return {
      person: userName(db, r.person) || 'Not assigned', crm_entry: r.b.bookingId, client: r.b.companyName, document: ADMIN_STAGES.find((x) => x.id === s)!.label, assignment: w.ref ?? '',
      status: adminStatusLabel(w.status), assigned_on: w.assignedAt ? ymd(w.assignedAt) : '', assigned_by: userName(db, w.assignedBy), uploaded_on: latest(docs) ? ymd(latest(docs)) : '',
      files: docs.length, file_review: review(docs)?.toLowerCase() ?? '', submitted_on: w.submittedAt ? ymd(w.submittedAt) : '', done_on: w.doneAt ? ymd(w.doneAt) : '', due: w.due ?? '',
    }
  })))

  return (
    <div className="space-y-6">
      {/* report cards: totals over the Admins listed below */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Total documents assigned" value={tot('assigned')} icon={FileStack} tone="navy" />
        {ADMIN_STAGES.map((s, i) => <Stat key={s.id} label={s.short} value={totType(i)} icon={FileStack} tone="violet" sub="assigned" />)}
        <Stat label="Files uploaded" value={tot('uploaded')} icon={FileStack} tone="blue" />
        <Stat label="Pending" value={tot('pending')} icon={FileStack} tone="amber" />
        <Stat label="Submitted / completed" value={tot('completed')} icon={FileStack} tone="green" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Admin-wise documents" subtitle="Each cell: done / assigned · files uploaded — ✓ the document is assigned to this Admin, — it isn't" icon={FileStack} />
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <SearchBox value={aq} onChange={setAq} placeholder="Search Admin…" className="min-w-52 flex-1" />
          <select value={docType} onChange={(e) => setDocType(e.target.value as '' | AdminStageId)} aria-label="Document" className="h-10 rounded-xl border border-line bg-card px-3 text-sm">
            <option value="">Any document</option>{ADMIN_STAGES.map((s) => <option key={s.id} value={s.id}>Assigned {s.short}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} className="size-4 accent-[#2E3A8C]" />With pending only</label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} aria-label="Sort" className="h-10 rounded-xl border border-line bg-card px-3 text-sm">
            <option value="pending">Most pending</option><option value="assigned">Most assigned</option><option value="uploaded">Most uploaded</option><option value="completed">Most completed</option><option value="name">Name</option>
          </select>
        </div>
        {!adminList.length ? <EmptyState icon={FileStack} title="No Admins match" text="Try another search or filter." /> : (
          <Table>
            <thead><tr><Th>Admin</Th>{ADMIN_STAGES.map((s) => <Th key={s.id} className="text-center">{s.short}</Th>)}<Th className="text-right">Total assigned</Th><Th className="text-right">Uploaded</Th><Th className="text-right">Pending</Th><Th className="text-right">Completed</Th></tr></thead>
            <tbody>
              {adminList.map((r) => (
                <tr key={r.u.id} className="cursor-pointer hover:bg-card2/60" onClick={() => setPerson(r.u.id)} title="Show this Admin's files below">
                  <Td><b>{r.u.name}</b><span className="block text-[11px] text-mute">{r.types} of 5 documents assigned</span></Td>
                  {r.per.map((c, i) => (
                    <Td key={i} className="text-center text-xs tabular-nums">
                      <span className={cx('block font-bold', c.allowed ? 'text-ok' : 'text-mute')}>{c.allowed ? '✓' : '—'}</span>
                      {c.assigned ? <span className={cx(c.done === c.assigned && 'font-bold text-ok')}>{c.done}/{c.assigned}</span> : <span className="text-mute">0</span>}
                      {c.assigned > 0 && <span className="block text-[10px] text-mute">{c.uploaded} uploaded</span>}
                    </Td>
                  ))}
                  <Td className="text-right font-bold tabular-nums">{r.assigned}</Td>
                  <Td className="text-right tabular-nums">{r.uploaded}</Td>
                  <Td className={cx('text-right tabular-nums', r.pending > 0 && 'font-bold text-warn')}>{r.pending}</Td>
                  <Td className="text-right tabular-nums text-ok">{r.completed}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person" className="h-10 rounded-xl border border-line bg-card px-3 text-sm">
            <option value="">Everyone</option>
            {usersWithRole(db, 'admin').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            <option value="-">Not assigned</option>
          </select>
          <select value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label="Status" className="h-10 rounded-xl border border-line bg-card px-3 text-sm">
            <option value="all">All statuses</option><option value="pending">Pending (not done)</option><option value="submitted">Submitted</option><option value="done">All done</option>
          </select>
          <Input label="Updated from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          <Input label="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          <SearchBox value={q} onChange={setQ} placeholder="Client, CRM ID, assignment no…" className="min-w-52 flex-1" />
          <Button variant="outline" icon={Download} disabled={!list.length} onClick={csv}>CSV</Button>
        </div>
        {!list.length ? <EmptyState icon={FileStack} title="Nothing matches" text="Try another person, status or date." /> : (
          <Table>
            <thead><tr><Th>Person · file</Th>{ADMIN_STAGES.map((s) => <Th key={s.id}>{s.short}</Th>)}<Th /></tr></thead>
            <tbody>
              {list.map((r) => {
                const key = `${r.b.id}|${r.person}`, isOpen = open === key
                return (
                  <Fragment key={key}>
                    <tr className="align-top hover:bg-card2/40">
                      <Td><b className="text-sm">{r.person ? userName(db, r.person) : 'Not assigned'}</b>
                        <Link to={`/bookings/${r.b.id}?tab=workflow`} className="block text-xs font-semibold text-brand-ink hover:underline">{r.b.companyName}</Link>
                        <span className="font-mono text-[11px] text-mute">{r.b.bookingId}</span></Td>
                      {ADMIN_STAGES.map((s) => {
                        if (!r.stages.includes(s.id)) { const other = r.b.adminWork?.[s.id]; return <Td key={s.id} className="text-[11px] text-mute">{!other ? '—' : other.assignee ? `with ${userName(db, other.assignee)}` : 'not assigned'}</Td> }
                        const w = r.b.adminWork![s.id]!, docs = stageFiles(r.b, s.id), rv = review(docs)
                        return (
                          <Td key={s.id} className="min-w-36 text-[11px]">
                            <Badge tone={tone(w.status)}>{adminStatusLabel(w.status)}</Badge>
                            {w.ref && <span className="mt-1 block font-mono font-semibold">{w.ref}</span>}
                            <span className="block text-mute">{latest(docs) ? `Uploaded ${fmtDate(latest(docs))}` : 'No file yet'}</span>
                            {w.submittedAt && <span className="block text-mute">Submitted {fmtDate(w.submittedAt)}</span>}
                            {rv && <span className={cx('block font-semibold', rv === 'VERIFIED' ? 'text-ok' : rv === 'REJECTED' ? 'text-bad' : 'text-warn')}>File {rv === 'PENDING' ? 'awaiting check' : rv.toLowerCase()}</span>}
                            {docs.slice(-2).map((d) => d.file && <FileLink key={d.id} file={d.file} label={docs.length > 1 ? `File (${fmtDate(d.at)})` : 'Open file'} />)}
                          </Td>
                        )
                      })}
                      <Td><Button size="sm" variant="ghost" icon={isOpen ? ChevronUp : ChevronDown} aria-label="History" onClick={() => setOpen(isOpen ? null : key)} /></Td>
                    </tr>
                    {isOpen && (
                      <tr><Td colSpan={7} className="bg-card2/40">
                        <ul className="space-y-1 text-xs">
                          {r.stages.flatMap((s) => r.b.adminWork![s]!.history.map((h) => ({ s, h })))
                            .sort((x, y) => y.h.at.localeCompare(x.h.at))
                            .map(({ s, h }, i) => (
                              <li key={i}><span className="text-mute">{fmtDateTime(h.at)}</span> · <b>{ADMIN_STAGES.find((x) => x.id === s)!.short}</b> · {adminStatusLabel(h.status)}{h.ref ? ` · ${h.ref}` : ''} · {userName(db, h.by) || 'Reminder'}{h.note ? ` — ${h.note}` : ''}</li>
                            ))}
                        </ul>
                      </Td></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
