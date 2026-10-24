import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, Download, FileStack } from 'lucide-react'
import type { AdminStageId, AdminWorkItem, BDoc, Booking } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { stageFiles, userName, usersWithRole, visibleBookings } from '../lib/actions'
import { ADMIN_DONE, ADMIN_STAGES, ADMIN_WORK_STATUSES, adminStatusLabel } from '../../supabase/workflow-rules.mjs'
import { downloadCsv, fmtDate, fmtDateTime, today, ymd } from '../lib/format'
import { Badge, Button, Card, CardHeader, cx, EmptyState, Input, SearchBox, Table, Td, Th } from './ui'
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

  // per-person summary over what is shown
  const people = [...new Set(list.map((r) => r.person))]
  const summary = people.map((p) => {
    const mine = list.filter((r) => r.person === p)
    return {
      p, files: mine.length,
      stages: ADMIN_STAGES.map((s) => { const its = mine.filter((r) => r.stages.includes(s.id)).map((r) => r.b.adminWork![s.id]!).filter((w) => w.status !== 'NOT_NEEDED'); return { total: its.length, done: its.filter((w) => ADMIN_DONE.includes(w.status)).length } }),
      uploaded: mine.reduce((n, r) => n + r.stages.reduce((m, s) => m + stageFiles(r.b, s).length, 0), 0),
      submitted: mine.reduce((n, r) => n + items(r).filter((w) => w.submittedAt).length, 0),
    }
  })

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
      <Card className="overflow-hidden">
        <CardHeader title="Admin documents by person" subtitle="Pitch Deck, Finance, DPR, Certification and Submission — done / assigned, files uploaded, stages submitted" icon={FileStack} />
        {!summary.length ? <EmptyState icon={FileStack} title="No Admin documents yet" text="They appear once the Operation team assigns or forwards the Admin stages of a file." /> : (
          <Table>
            <thead><tr><Th>Person</Th><Th className="text-right">Files</Th>{ADMIN_STAGES.map((s) => <Th key={s.id} className="text-center">{s.short}</Th>)}<Th className="text-right">Files uploaded</Th><Th className="text-right">Submitted</Th></tr></thead>
            <tbody>
              {summary.map((x) => (
                <tr key={x.p || '-'} className="cursor-pointer hover:bg-card2/60" onClick={() => setPerson(x.p || '-')}>
                  <Td><b>{x.p ? userName(db, x.p) : 'Not assigned'}</b>{x.p && <span className="block text-[11px] text-mute">{db.users.find((u) => u.id === x.p)?.email}</span>}</Td>
                  <Td className="text-right tabular-nums">{x.files}</Td>
                  {x.stages.map((c, i) => <Td key={i} className="text-center tabular-nums">{c.total ? <span className={cx(c.done === c.total ? 'font-bold text-ok' : '')}>{c.done}/{c.total}</span> : <span className="text-mute">—</span>}</Td>)}
                  <Td className="text-right tabular-nums">{x.uploaded}</Td>
                  <Td className="text-right tabular-nums">{x.submitted}</Td>
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
