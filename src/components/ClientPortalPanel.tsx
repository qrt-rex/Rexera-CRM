import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Eye, EyeOff, FileUp, Flag, Megaphone, Pencil, Plus, ShieldCheck, Trash2, UserRoundCheck, X } from 'lucide-react'
import { ADMIN_STAGES } from '../../supabase/workflow-rules.mjs'
import { CLIENT_DOC_STATUS, projectProgress, reviewSteps } from '../../supabase/portal-rules.mjs'
import type { AdminStageId, Booking, FileRef, Milestone, MilestoneTask } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { isMaster, rolesOf } from '../lib/rbac'
import {
  canRunClientPortal, clientDocState, publishClientUpdate, removeClientUpdate, removeMilestone, reviewClientDoc, saveMilestone, setClientDocInternal, setClientDocs, setMilestoneTask, userName,
} from '../lib/actions'
import { DOC_TYPES } from '../lib/files'
import { fmtDate, fmtDateTime } from '../lib/format'
import { FileField, FileLink } from './FileField'
import { Badge, Button, Card, CardHeader, Checkbox, cx, Input, Modal, Progress, Select, Textarea, Toggle, useConfirm, useRun } from './ui'

const MS_STATUS: { id: Milestone['status']; label: string; tone: 'gray' | 'amber' | 'green' }[] = [
  { id: 'PENDING', label: 'Not started', tone: 'gray' }, { id: 'IN_PROGRESS', label: 'In progress', tone: 'amber' }, { id: 'DONE', label: 'Done', tone: 'green' },
]
type MsDraft = { id?: string; title: string; due: string; status: Milestone['status']; visible: boolean; note: string; tasks: MilestoneTask[] }

/** The booking's client portal side: who has portal access, the documents asked from the client, milestones and updates. */
export function ClientPortalCard({ b }: { b: Booking }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const may = canRunClientPortal(me, b)
  const acct = (db.clientAccounts ?? []).find((a) => a.bookingIds.includes(b.id))
  const [pick, setPick] = useState<AdminStageId[] | null>(null)
  const [review, setReview] = useState<{ cat: AdminStageId; step: 'APPROVE' | 'REJECT' | 'REOPEN'; remark: string } | null>(null)
  const [internal, setInternal] = useState<{ cat: AdminStageId; assignee: string; note: string } | null>(null)
  const [ms, setMs] = useState<MsDraft | null>(null)
  const [upd, setUpd] = useState<{ title: string; text: string; file?: FileRef } | null>(null)
  const staff = db.users.filter((u) => u.active)
  const asked = ADMIN_STAGES.filter((s) => b.clientDocs?.[s.id] && !b.clientDocs[s.id]!.removed)
  const progress = projectProgress(b.milestones)
  const shown = projectProgress(b.milestones, true)
  const uploadsOf = (cat: AdminStageId) => (b.clientUploads ?? []).filter((u) => u.category === cat).sort((x, y) => y.at.localeCompare(x.at))

  return (
    <Card className="overflow-hidden xl:col-span-2">
      <CardHeader title="Client portal" icon={UserRoundCheck}
        subtitle={acct ? `${acct.email} · ${acct.status === 'ACTIVE' ? `active${acct.lastLoginAt ? `, last signed in ${fmtDateTime(acct.lastLoginAt)}` : ''}` : acct.status === 'INVITED' ? 'invited, not signed in yet' : 'access switched off'}` : 'The client has no portal access yet'}
        action={acct ? <Badge tone={acct.status === 'ACTIVE' ? 'green' : acct.status === 'INVITED' ? 'amber' : 'red'}>{acct.status === 'ACTIVE' ? 'Portal active' : acct.status === 'INVITED' ? 'Invited' : 'Deactivated'}</Badge>
          : (isMaster(me) || rolesOf(me).includes('superadmin')) && <Link to={`/client-portal?invite=${b.id}`}><Button size="sm" variant="outline">Invite to portal</Button></Link>} />

      {/* ---------------------------------------------------------------- documents asked from the client */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        <p className="mr-auto text-sm font-bold">Documents from the client <span className="font-normal text-mute">· {asked.length} requested</span></p>
        {may && <Button size="sm" variant="outline" icon={FileUp} onClick={() => setPick(asked.map((s) => s.id))}>Choose documents</Button>}
      </div>
      {!asked.length ? <p className="px-5 pb-4 text-sm text-mute">No documents requested.{may && ' Tick the ones the client must upload in the portal.'}</p> : (
        <ul className="divide-y divide-line/70 border-t border-line/70">
          {asked.map((s) => {
            const w = b.clientDocs![s.id]!, st = clientDocState(b, s.id)!, info = CLIENT_DOC_STATUS[st], ups = uploadsOf(s.id)
            const mayReview = may || w.assignee === me.id
            return (
              <li key={s.id} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <b>{s.short}</b>
                  <span className="block text-[11px] text-mute">Requested {fmtDate(w.assignedAt)} by {userName(db, w.assignedBy)}{w.assignee ? ` · handled by ${userName(db, w.assignee)}` : ''}{w.reviewedAt ? ` · reviewed ${fmtDateTime(w.reviewedAt)} by ${userName(db, w.reviewedBy)}` : ''}</span>
                  {ups.length > 0 && <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">{ups.map((u, i) => <span key={u.id} className="inline-flex items-center gap-1"><FileLink file={u.file} label={u.file.name} /><span className="text-mute">{fmtDateTime(u.at)}{i === 0 && ups.length > 1 ? ' · latest' : ''}</span></span>)}</span>}
                  {w.clientRemark && <span className="mt-1 block text-[11px]"><b>To the client:</b> {w.clientRemark}</span>}
                  {w.internalNote && <span className="mt-0.5 block text-[11px] text-warn"><b>Internal:</b> {w.internalNote}</span>}
                </span>
                <Badge tone={info.tone}>{info.label}</Badge>
                {mayReview && reviewSteps(st).includes('START') && <Button size="sm" onClick={() => run(() => reviewClientDoc(me, b.id, s.id, 'START'), 'Review started')}>Start review</Button>}
                {mayReview && reviewSteps(st).includes('APPROVE') && <>
                  <Button size="sm" icon={CheckCircle2} onClick={() => setReview({ cat: s.id, step: 'APPROVE', remark: '' })}>Approve</Button>
                  <Button size="sm" variant="outline" icon={X} onClick={() => setReview({ cat: s.id, step: 'REJECT', remark: '' })}>Reject</Button>
                </>}
                {st === 'APPROVED' && rolesOf(me).includes('superadmin') && <Button size="sm" variant="ghost" onClick={() => setReview({ cat: s.id, step: 'REOPEN', remark: '' })}>Reopen</Button>}
                {may && <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Handler and internal note for ${s.short}`} onClick={() => setInternal({ cat: s.id, assignee: w.assignee ?? '', note: w.internalNote ?? '' })} />}
              </li>
            )
          })}
        </ul>
      )}

      {/* ---------------------------------------------------------------- milestones */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        <p className="mr-auto text-sm font-bold">Milestones <span className="font-normal text-mute">· {progress == null ? 'none yet' : `${progress}% done${shown != null && shown !== progress ? ` (client sees ${shown}%)` : ''}`}</span></p>
        {may && <Button size="sm" variant="outline" icon={Plus} onClick={() => setMs({ title: '', due: '', status: 'PENDING', visible: true, note: '', tasks: [] })}>Add milestone</Button>}
      </div>
      {progress != null && <div className="px-5 pb-2"><Progress value={progress} tone={progress === 100 ? 'green' : 'orange'} /></div>}
      {(b.milestones ?? []).length > 0 && (
        <ul className="divide-y divide-line/70 border-t border-line/70">
          {b.milestones!.map((m) => {
            const s = MS_STATUS.find((x) => x.id === m.status)!
            return (
              <li key={m.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Flag className={cx('size-4', m.status === 'DONE' ? 'text-ok' : 'text-mute')} />
                  <b className="min-w-0 flex-1">{m.title}</b>
                  {m.visible ? <Badge tone="blue"><Eye className="size-3" />Client sees it</Badge> : <Badge tone="gray"><EyeOff className="size-3" />Internal</Badge>}
                  {m.due && <span className={cx('text-xs', m.status !== 'DONE' && m.due < new Date().toISOString().slice(0, 10) ? 'font-semibold text-bad' : 'text-mute')}>due {fmtDate(m.due)}</span>}
                  <Badge tone={s.tone}>{s.label}{m.doneAt ? ` · ${fmtDate(m.doneAt)}` : ''}</Badge>
                  {may && <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${m.title}`} onClick={() => setMs({ id: m.id, title: m.title, due: m.due ?? '', status: m.status, visible: m.visible, note: m.note ?? '', tasks: m.tasks ?? [] })} />}
                  {may && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${m.title}`} onClick={async () => { if (await confirm('Remove milestone?', `“${m.title}” and its tasks will be removed.`, true)) run(() => removeMilestone(me, b.id, m.id), 'Milestone removed') }} />}
                </div>
                {m.note && <p className="mt-1 pl-6 text-xs text-mute">{m.note}</p>}
                {(m.tasks ?? []).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pl-6">
                    {m.tasks!.map((t) => <Checkbox key={t.id} checked={t.done} disabled={!may} label={<span className={cx('text-xs', t.done && 'text-mute line-through')}>{t.title}</span>} onChange={(v) => run(() => setMilestoneTask(me, b.id, m.id, t.id, v))} />)}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* ---------------------------------------------------------------- updates published to the client */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        <p className="mr-auto text-sm font-bold">Updates to the client <span className="font-normal text-mute">· shown in their portal</span></p>
        {may && <Button size="sm" variant="outline" icon={Megaphone} onClick={() => setUpd({ title: '', text: '' })}>Publish update</Button>}
      </div>
      {(b.clientUpdates ?? []).length > 0 && (
        <ul className="divide-y divide-line/70 border-t border-line/70">
          {[...b.clientUpdates!].reverse().map((u) => (
            <li key={u.id} className="flex items-start gap-3 px-5 py-3 text-sm">
              <span className="min-w-0 flex-1"><b>{u.title}</b><span className="block whitespace-pre-line text-xs text-ink/80">{u.text}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-mute">{fmtDateTime(u.at)} · {userName(db, u.by)}{u.file && <FileLink file={u.file} />}</span></span>
              {may && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove update ${u.title}`} onClick={async () => { if (await confirm('Remove update?', 'The client will no longer see it.', true)) run(() => removeClientUpdate(me, b.id, u.id), 'Update removed') }} />}
            </li>
          ))}
        </ul>
      )}

      {/* ---------------------------------------------------------------- modals */}
      <Modal open={!!pick} onClose={() => setPick(null)} title="Documents the client must upload" subtitle="Ticked ones appear in the client’s portal. Taking one off keeps its record." size="sm"
        footer={<><Button variant="outline" onClick={() => setPick(null)}>Cancel</Button><Button onClick={async () => { if (pick && await run(() => setClientDocs(me, b.id, pick), 'Saved')) setPick(null) }}>Save</Button></>}>
        {pick && <div className="grid gap-2">
          <div className="flex gap-3 text-xs"><button className="font-semibold text-brand-ink hover:underline" onClick={() => setPick(ADMIN_STAGES.map((s) => s.id))}>All</button><button className="font-semibold text-brand-ink hover:underline" onClick={() => setPick([])}>None</button></div>
          {ADMIN_STAGES.map((s) => <Checkbox key={s.id} checked={pick.includes(s.id)} label={s.short} onChange={(v) => setPick(v ? [...pick, s.id] : pick.filter((x) => x !== s.id))} />)}
        </div>}
      </Modal>

      <Modal open={!!review} onClose={() => setReview(null)} size="sm"
        title={review ? `${review.step === 'APPROVE' ? 'Approve' : review.step === 'REJECT' ? 'Ask for a new file' : 'Reopen'}: ${ADMIN_STAGES.find((s) => s.id === review.cat)!.short}` : ''}
        footer={<><Button variant="outline" onClick={() => setReview(null)}>Cancel</Button><Button onClick={async () => { if (review && await run(() => reviewClientDoc(me, b.id, review.cat, review.step, review.remark), 'Saved')) setReview(null) }}>{review?.step === 'REJECT' ? 'Send back' : 'Confirm'}</Button></>}>
        {review && <Textarea label={review.step === 'REJECT' ? 'What should the client change?' : 'Remark for the client (optional)'} required={review.step === 'REJECT'} rows={3} value={review.remark} onChange={(e) => setReview({ ...review, remark: e.target.value })} hint="The client sees this in the portal. Internal notes go in the pencil button." />}
      </Modal>

      <Modal open={!!internal} onClose={() => setInternal(null)} title="Handling (internal)" subtitle="Never shown to the client" size="sm"
        footer={<><Button variant="outline" onClick={() => setInternal(null)}>Cancel</Button><Button onClick={async () => { if (internal && await run(() => setClientDocInternal(me, b.id, internal.cat, { assignee: internal.assignee || null, internalNote: internal.note }), 'Saved')) setInternal(null) }}>Save</Button></>}>
        {internal && <div className="grid gap-3">
          <Select label="Who reviews it" value={internal.assignee} onChange={(e) => setInternal({ ...internal, assignee: e.target.value })}>
            <option value="">— Operation team member of the entry —</option>
            {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <Textarea label="Internal note" rows={3} value={internal.note} onChange={(e) => setInternal({ ...internal, note: e.target.value })} />
        </div>}
      </Modal>

      <Modal open={!!ms} onClose={() => setMs(null)} title={ms?.id ? 'Edit milestone' : 'Add milestone'} size="md"
        footer={<><Button variant="outline" onClick={() => setMs(null)}>Cancel</Button><Button onClick={async () => { if (ms && await run(() => saveMilestone(me, b.id, { ...ms, due: ms.due || undefined }), 'Milestone saved')) setMs(null) }}>Save</Button></>}>
        {ms && <div className="grid gap-3">
          <Input label="Milestone" required value={ms.title} onChange={(e) => setMs({ ...ms, title: e.target.value })} placeholder="e.g. DPR submitted to the bank" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Status" value={ms.status} onChange={(e) => setMs({ ...ms, status: e.target.value as Milestone['status'] })}>{MS_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
            <Input label="Due date" type="date" value={ms.due} onChange={(e) => setMs({ ...ms, due: e.target.value })} />
          </div>
          <label className="flex items-center gap-3 text-sm"><Toggle checked={ms.visible} onChange={(v) => setMs({ ...ms, visible: v })} label="Show to the client" />Show in the client portal</label>
          <Textarea label="Note" rows={2} value={ms.note} onChange={(e) => setMs({ ...ms, note: e.target.value })} hint={ms.visible ? 'Internal — the client sees the title, status and due date only' : undefined} />
          <div>
            <p className="mb-1.5 text-sm font-semibold">Tasks <span className="font-normal text-mute">· progress counts the done tasks until the milestone is done</span></p>
            <div className="grid gap-2">
              {ms.tasks.map((t, i) => (
                <div key={t.id || i} className="flex items-center gap-2">
                  <Checkbox checked={t.done} onChange={(v) => setMs({ ...ms, tasks: ms.tasks.map((x, j) => (j === i ? { ...x, done: v } : x)) })} />
                  <Input aria-label="Task" value={t.title} onChange={(e) => setMs({ ...ms, tasks: ms.tasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} className="flex-1" />
                  <Button size="sm" variant="ghost" icon={X} aria-label="Remove task" onClick={() => setMs({ ...ms, tasks: ms.tasks.filter((_, j) => j !== i) })} />
                </div>
              ))}
              <Button size="sm" variant="ghost" icon={Plus} className="w-fit" onClick={() => setMs({ ...ms, tasks: [...ms.tasks, { id: '', title: '', done: false }] })}>Add task</Button>
            </div>
          </div>
        </div>}
      </Modal>

      <Modal open={!!upd} onClose={() => setUpd(null)} title="Publish an update to the client" subtitle="It appears in their portal straight away" size="md"
        footer={<><Button variant="outline" onClick={() => setUpd(null)}>Cancel</Button><Button icon={ShieldCheck} onClick={async () => { if (upd && await run(() => publishClientUpdate(me, b.id, upd), 'Published to the client')) setUpd(null) }}>Publish</Button></>}>
        {upd && <div className="grid gap-3">
          <Input label="Title" required value={upd.title} onChange={(e) => setUpd({ ...upd, title: e.target.value })} placeholder="e.g. Application submitted" />
          <Textarea label="Update" required rows={5} value={upd.text} onChange={(e) => setUpd({ ...upd, text: e.target.value })} />
          <FileField label="File (optional)" accept={DOC_TYPES} acceptLabel="PDF or image, up to 5 MB" value={upd.file} onChange={(f) => setUpd({ ...upd, file: f })} />
        </div>}
      </Modal>
      {confirmNode}
    </Card>
  )
}
