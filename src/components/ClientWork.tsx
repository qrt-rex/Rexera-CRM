import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FilePlus2, FileText } from 'lucide-react'
import type { Booking } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { addDocuments, canMoveStage, moveStage, userName } from '../lib/actions'
import { STAGES } from '../lib/workflow'
import { fmtDateTime } from '../lib/format'
import { Button, Modal, useRun } from './ui'
import { BookingStatusBadge, DecisionButtons, StageTrack } from './booking'
import { DocUploader, type PendingDoc } from './DocUploader'
import { FileLink } from './FileField'

/** Admin / Operations work row: stage track, move to the next stage, add documents, and the file's decisions. */
export function ClientWorkRow({ b, showDocs = false }: { b: Booking; showDocs?: boolean }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [docsOpen, setDocsOpen] = useState(false)
  const [pending, setPending] = useState<PendingDoc[]>([])
  const movable = canMoveStage(db, me, b)
  const next = STAGES.map((s, i) => ({ s, n: i + 1 })).filter((x) => x.n > b.stage && (x.n <= b.maxStage || me.role === 'superadmin'))
  return (
    <li className="px-5 py-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Link to={`/bookings/${b.id}`} className="font-bold hover:underline">{b.companyName}</Link>
        <BookingStatusBadge b={b} />
        <span className="ml-auto text-xs text-mute">Stage {b.stage}/{STAGES.length} · {STAGES[b.stage - 1]}</span>
      </div>
      <StageTrack b={b} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-mute">{b.serviceName} · Ops {userName(db, b.opsMemberId)}{b.adminId ? ` · Admin ${userName(db, b.adminId)}` : ''}</span>
        {movable && next.length > 0 && (
          <select aria-label={`Move ${b.companyName} to stage`} value="" onChange={(e) => e.target.value && run(() => moveStage(me, b.id, Number(e.target.value), ''), `Moved to ${STAGES[Number(e.target.value) - 1]}`)}
            className="h-8 rounded-lg border border-line bg-card px-2 text-xs font-semibold">
            <option value="">Move to stage…</option>
            {next.map((x) => <option key={x.n} value={x.n}>{x.n}. {x.s}</option>)}
          </select>
        )}
        <Button size="sm" variant="outline" icon={FilePlus2} onClick={() => setDocsOpen(true)}>Add documents</Button>
        <span className="inline-flex items-center gap-1 text-xs text-mute"><FileText className="size-3.5" />{b.documents.length}</span>
      </div>
      {showDocs && b.documents.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {b.documents.slice(-6).map((d) => <li key={d.id} className="text-xs">{d.file ? <FileLink file={d.file} label={`${d.category}: ${d.name}`} /> : <span className="text-mute">{d.category}: {d.name}</span>}</li>)}
        </ul>
      )}
      <div className="mt-3"><DecisionButtons b={b} size="sm" /></div>
      <Modal open={docsOpen} onClose={() => setDocsOpen(false)} title="Add documents" subtitle={`${b.bookingId} · ${b.companyName}`}>
        <DocUploader value={pending} onChange={setPending} onUpload={async (docs) => { const ok = await run(() => addDocuments(me, b.id, docs), `${docs.length} document(s) added`); if (ok) setDocsOpen(false); return !!ok }} />
        {b.documents.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold text-mute">Already on this file</p>
            <ul className="space-y-1">{b.documents.map((d) => <li key={d.id} className="flex items-center justify-between gap-3 text-sm">{d.file ? <FileLink file={d.file} label={d.name} /> : <span>{d.name}</span>}<span className="text-[11px] text-mute">{d.category} · {fmtDateTime(d.at)}</span></li>)}</ul>
          </div>
        )}
      </Modal>
    </li>
  )
}
