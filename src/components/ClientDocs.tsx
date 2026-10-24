import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ClipboardList, Clock3, Download, FileClock, FileUp, RotateCcw, Search, UserRoundCheck, Users } from 'lucide-react'
import type { AdminStageId, Booking } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { clientDocState, visibleBookings } from '../lib/actions'
import { ADMIN_STAGES } from '../../supabase/workflow-rules.mjs'
import { CLIENT_DOC_STATUS, projectProgress, type ClientDocState } from '../../supabase/portal-rules.mjs'
import { downloadCsv } from '../lib/format'
import { Badge, Button, Card, CardHeader, cx, EmptyState, Progress, SearchBox, Select, Stat, Table, Td, Th } from './ui'

type Row = { b: Booking; portal: 'ACTIVE' | 'INVITED' | 'DISABLED' | null; st: Partial<Record<AdminStageId, ClientDocState>>; requested: number; uploaded: number; pending: number; review: number; approved: number; resubmit: number; progress: number | null }
type Sort = 'pending' | 'review' | 'requested' | 'approved' | 'progress' | 'name'

/** Reports → Client documents: per-client counts of documents requested, uploaded, waiting, approved and progress. */
export function ClientDocReport() {
  const db = useDb()
  const me = useMe()
  const [q, setQ] = useState('')
  const [doc, setDoc] = useState<AdminStageId | ''>('')
  const [state, setState] = useState<'' | 'action' | 'review' | 'done' | 'portal' | 'noportal'>('')
  const [sort, setSort] = useState<Sort>('pending')
  const rows = useMemo<Row[]>(() => visibleBookings(db, me).flatMap((b) => {
    const st: Row['st'] = {}
    for (const s of ADMIN_STAGES) { const x = clientDocState(b, s.id); if (x) st[s.id] = x }
    const list = Object.entries(st) as [AdminStageId, ClientDocState][]
    const acct = (db.clientAccounts ?? []).find((a) => a.bookingIds.includes(b.id))
    if (!list.length && !acct && !(b.milestones ?? []).length) return []
    return [{
      b, st, portal: acct?.status ?? null, requested: list.length,
      uploaded: list.filter(([s]) => (b.clientUploads ?? []).some((u) => u.category === s)).length,
      pending: list.filter(([, x]) => x === 'PENDING_UPLOAD' || x === 'RESUBMISSION').length,
      review: list.filter(([, x]) => x === 'SUBMITTED' || x === 'UNDER_REVIEW').length,
      approved: list.filter(([, x]) => x === 'APPROVED').length,
      resubmit: list.filter(([, x]) => x === 'RESUBMISSION').length,
      progress: projectProgress(b.milestones),
    }]
  }), [db, me])
  const sum = (k: 'requested' | 'uploaded' | 'pending' | 'review' | 'approved' | 'resubmit') => rows.reduce((n, r) => n + r[k], 0)
  const ql = q.trim().toLowerCase()
  const shown = rows.filter((r) => {
    if (ql && !`${r.b.bookingId} ${r.b.companyName} ${r.b.contactPerson}`.toLowerCase().includes(ql)) return false
    if (doc && !r.st[doc]) return false
    if (state === 'action' && !r.pending) return false
    if (state === 'review' && !r.review) return false
    if (state === 'done' && !(r.requested && r.approved === r.requested)) return false
    if (state === 'portal' && !r.portal) return false
    if (state === 'noportal' && r.portal) return false
    return true
  }).sort((x, y) => (sort === 'name' ? x.b.companyName.localeCompare(y.b.companyName) : sort === 'progress' ? (y.progress ?? -1) - (x.progress ?? -1) : y[sort] - x[sort]) || x.b.companyName.localeCompare(y.b.companyName))
  const exportCsv = () => downloadCsv('client-documents.csv', shown.map((r) => ({
    Entry: r.b.bookingId, Client: r.b.companyName, Portal: r.portal ?? 'No access',
    ...Object.fromEntries(ADMIN_STAGES.map((s) => [s.short, r.st[s.id] ? CLIENT_DOC_STATUS[r.st[s.id]!].label : ''])),
    Requested: r.requested, Uploaded: r.uploaded, 'Pending upload': r.pending, 'Awaiting review': r.review, Approved: r.approved, 'Progress %': r.progress ?? '',
  })))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Clients" value={rows.length} icon={Users} sub={`${rows.filter((r) => r.portal === 'ACTIVE').length} with portal`} onClick={() => setState('')} />
        <Stat label="Requested" value={sum('requested')} icon={ClipboardList} tone="blue" />
        <Stat label="Uploaded" value={sum('uploaded')} icon={FileUp} tone="cyan" />
        <Stat label="Pending upload" value={sum('pending')} icon={Clock3} tone="amber" onClick={() => setState('action')} />
        <Stat label="Awaiting review" value={sum('review')} icon={FileClock} tone="violet" onClick={() => setState('review')} />
        <Stat label="Approved" value={sum('approved')} icon={CheckCircle2} tone="green" onClick={() => setState('done')} />
        <Stat label="Resubmission" value={sum('resubmit')} icon={RotateCcw} tone="red" onClick={() => setState('action')} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader title="Client-wise documents" icon={UserRoundCheck} subtitle="Documents asked from each client in the portal, and where they are"
          action={<Button size="sm" variant="outline" icon={Download} onClick={exportCsv} disabled={!shown.length}>CSV</Button>} />
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <SearchBox value={q} onChange={setQ} placeholder="Search client or entry…" className="min-w-56 flex-1" />
          <Select aria-label="Document" value={doc} onChange={(e) => setDoc(e.target.value as AdminStageId | '')} className="w-44"><option value="">All documents</option>{ADMIN_STAGES.map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}</Select>
          <Select aria-label="Show" value={state} onChange={(e) => setState(e.target.value as typeof state)} className="w-48">
            <option value="">All clients</option><option value="action">Waiting for the client</option><option value="review">Waiting for our review</option><option value="done">All approved</option><option value="portal">With portal access</option><option value="noportal">No portal access</option>
          </Select>
          <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-44">
            <option value="pending">Most pending</option><option value="review">Most to review</option><option value="requested">Most requested</option><option value="approved">Most approved</option><option value="progress">Highest progress</option><option value="name">Name</option>
          </Select>
        </div>
        {!shown.length ? <EmptyState icon={Search} title={rows.length ? 'No client matches' : 'No client documents yet'} text={rows.length ? 'Change the search or filters.' : 'Ask a client for documents on their CRM entry (Workflow tab → Client portal).'} /> : (
          <Table>
            <thead><tr><Th>Client</Th><Th>Portal</Th>{ADMIN_STAGES.map((s) => <Th key={s.id} className="text-center">{s.short}</Th>)}<Th className="text-right">Requested</Th><Th className="text-right">Uploaded</Th><Th className="text-right">Pending</Th><Th className="text-right">Approved</Th><Th className="w-32">Progress</Th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.b.id}>
                  <Td><Link to={`/bookings/${r.b.id}?tab=workflow`} className="font-semibold hover:underline">{r.b.companyName}</Link><span className="block font-mono text-[11px] text-mute">{r.b.bookingId}</span></Td>
                  <Td>{r.portal ? <Badge tone={r.portal === 'ACTIVE' ? 'green' : r.portal === 'INVITED' ? 'amber' : 'red'}>{r.portal === 'ACTIVE' ? 'Active' : r.portal === 'INVITED' ? 'Invited' : 'Off'}</Badge> : <span className="text-xs text-mute">—</span>}</Td>
                  {ADMIN_STAGES.map((s) => { const x = r.st[s.id]; return <Td key={s.id} className="text-center">{x ? <Badge tone={CLIENT_DOC_STATUS[x].tone}>{CLIENT_DOC_STATUS[x].label}</Badge> : <span className="text-mute">—</span>}</Td> })}
                  <Td className="text-right">{r.requested}</Td><Td className="text-right">{r.uploaded}</Td>
                  <Td className={cx('text-right', r.pending > 0 && 'font-semibold text-warn')}>{r.pending}{r.review > 0 && <span className="block text-[11px] font-normal text-violet-600">{r.review} to review</span>}</Td>
                  <Td className="text-right">{r.approved}</Td>
                  <Td>{r.progress == null ? <span className="text-xs text-mute">No milestones</span> : <span className="flex items-center gap-2"><Progress value={r.progress} tone={r.progress === 100 ? 'green' : 'orange'} /><span className="text-xs font-semibold">{r.progress}%</span></span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
