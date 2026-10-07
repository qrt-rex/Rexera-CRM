import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, FilePlus2, FileText, Upload } from 'lucide-react'
import type { Booking, FileRef } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { addDocuments, canMoveStage, moveStage, setStageOutcome, userName } from '../lib/actions'
import { STAGE_OUTCOMES, STAGES, stageLabel } from '../lib/workflow'
import { fmtDateTime } from '../lib/format'
import { checkFile, saveFile } from '../lib/files'
import { Button, cx, Modal, useRun, useToast } from './ui'
import { BookingStatusBadge, DecisionButtons, StageTrack } from './booking'
import { DOC_ACCEPT, DocUploader, type PendingDoc } from './DocUploader'
import { FileLink } from './FileField'

/** The documents Admin adds while doing the client's work. */
const WORK_DOCS = [
  { cat: 'Pitch deck', label: 'Pitch deck' },
  { cat: 'F.R (Financial report)', label: 'F.R' },
  { cat: 'D.P.R (Detailed project report)', label: 'D.P.R' },
]

/** Admin / Operations work row: stage track, move to the next stage, step / result, add documents, and the file's decisions. */
export function ClientWorkRow({ b, showDocs = false }: { b: Booking; showDocs?: boolean }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [docsOpen, setDocsOpen] = useState(false)
  const [pending, setPending] = useState<PendingDoc[]>([])
  const movable = canMoveStage(db, me, b)
  const next = STAGES.map((s, i) => ({ s, n: i + 1 })).filter((x) => x.n > b.stage && (x.n <= b.maxStage || me.role === 'superadmin'))
  const outcomes = STAGE_OUTCOMES[b.stage]
  return (
    <li className="px-5 py-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Link to={`/bookings/${b.id}`} className="font-bold hover:underline">{b.companyName}</Link>
        <BookingStatusBadge b={b} />
        <span className="ml-auto text-xs font-semibold text-mute">Stage {stageLabel(b.stage, b.stageOutcome)} <span className="font-normal">of {STAGES.length}</span></span>
      </div>
      <StageTrack b={b} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-mute">{b.serviceName} · Ops {userName(db, b.opsMemberId)}{b.adminId ? ` · Admin ${userName(db, b.adminId)}` : ''}</span>
        {movable && outcomes && (
          <select aria-label={`${b.stage === 3 ? 'Step' : 'Result'} for ${b.companyName}`} value={b.stageOutcome ?? ''}
            onChange={(e) => e.target.value && run(() => setStageOutcome(me, b.id, e.target.value), stageLabel(b.stage, e.target.value))}
            className={cx('h-8 rounded-lg border px-2 text-xs font-semibold', b.stageOutcome ? 'border-line bg-card' : 'border-warn/50 bg-warn-soft text-warn')}>
            {!b.stageOutcome && <option value="">{b.stage === 3 ? 'Pick step…' : 'Pick result…'}</option>}
            {outcomes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
        {movable && next.length > 0 && (
          <select aria-label={`Move ${b.companyName} to stage`} value="" onChange={(e) => e.target.value && run(() => moveStage(me, b.id, Number(e.target.value), ''), `Moved to ${stageLabel(Number(e.target.value))}`)}
            className="h-8 rounded-lg border border-line bg-card px-2 text-xs font-semibold">
            <option value="">Move to stage…</option>
            {next.map((x) => <option key={x.n} value={x.n}>{x.n}. {x.s}</option>)}
          </select>
        )}
        <Button size="sm" variant="outline" icon={FilePlus2} onClick={() => setDocsOpen(true)}>Add documents</Button>
        <span className="inline-flex items-center gap-1 text-xs text-mute"><FileText className="size-3.5" />{b.documents.length}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {WORK_DOCS.map((w) => <QuickDoc key={w.cat} b={b} cat={w.cat} label={w.label} />)}
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

/** One-click upload for pitch deck / F.R / D.P.R — ticked once the file has one. */
function QuickDoc({ b, cat, label }: { b: Booking; cat: string; label: string }) {
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const have = b.documents.filter((d) => d.category === cat)
  const upload = async (list: FileList) => {
    setBusy(true)
    try {
      const refs: FileRef[] = []
      for (const f of Array.from(list)) { checkFile(f, DOC_ACCEPT, f.name); refs.push(await saveFile(f)) }
      await run(() => addDocuments(me, b.id, refs.map((file) => ({ file, category: cat }))), `${label} added`)
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Could not upload.') } finally { setBusy(false) }
  }
  return (
    <>
      <input ref={ref} type="file" multiple accept={DOC_ACCEPT} className="hidden" onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = '' }} />
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} title={have.length ? `${have.length} ${label} file(s) — click to add another` : `Upload ${label}`}
        className={cx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition', have.length ? 'border-ok/40 bg-ok-soft text-ok' : 'border-dashed border-line text-mute hover:border-brand hover:text-ink')}>
        {have.length ? <CheckCircle2 className="size-3.5" /> : <Upload className="size-3.5" />}{busy ? 'Uploading…' : label}{have.length > 1 ? ` · ${have.length}` : ''}
      </button>
    </>
  )
}
