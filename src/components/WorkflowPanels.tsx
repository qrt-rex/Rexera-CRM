import { useRef, useState } from 'react'
import { BellRing, CalendarClock, ClipboardCheck, Eye, Forward, Mail, MessageCircle, Pause, Play, RefreshCw, Send, Upload } from 'lucide-react'
import type { AdminStageId, AdminWorkStatus, Booking, Delivery, FileRef } from '../lib/types'
import { checkFile, saveFile } from '../lib/files'
import { isMaster, isStageOnlyAdmin } from '../lib/rbac'
import { DOC_ACCEPT } from './DocUploader'
import { FileLink } from './FileField'
import { useDb } from '../lib/store'
import { useAuth, useMe } from '../lib/auth'
import {
  addAdminStageFiles, addFollowUpNote, adminMayDo, canForwardAdminStages, stageFiles, canSendWelcome, canUploadAdminStage, canWorkAdminStage, forwardAdminStages, logPrecheckFollowUp, noteWhatsappOpened, requeueWelcome, setAdminWork, setFollowUpSchedule, setPrecheckInterval, userName, usersWithRole,
} from '../lib/actions'
import { deliverWelcome, welcomeContent, whatsappLink } from '../lib/welcome'
import { requestWelcomeWhatsapp } from '../lib/share'
import { CLOUD } from '../lib/cloud'
import { ADMIN_DONE, ADMIN_STAGES, ADMIN_WORK_STATUSES, ACTIVE_FILE_STATUSES, adminStatusLabel, istToday, precheckPending, workflowSettings } from '../../supabase/workflow-rules.mjs'
import { fmtDate, fmtDateTime, isEmail, isPhone } from '../lib/format'
import { Badge, Button, Card, CardHeader, cx, Input, Modal, Progress, Select, Textarea, useRun, useToast } from './ui'

const DELIVERY: Record<Delivery['status'], { label: string; tone: 'green' | 'blue' | 'red' | 'amber' | 'gray' }> = {
  SENT: { label: 'Sent', tone: 'green' }, PENDING: { label: 'Queued', tone: 'blue' }, SENDING: { label: 'Sending…', tone: 'blue' },
  FAILED: { label: 'Failed', tone: 'red' }, NOT_CONFIGURED: { label: 'Not set up', tone: 'amber' }, NO_CONTACT: { label: 'No contact', tone: 'amber' }, SKIPPED: { label: 'Not sent (manual)', tone: 'gray' },
}
const workTone = (s: AdminWorkStatus) => ADMIN_WORK_STATUSES.find((x) => x.id === s)!.tone

/** Client welcome message: what was sent, what failed (with Retry); WhatsApp through Interakt, or by hand from a phone. */
export function WelcomeCard({ b }: { b: Booking }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const [preview, setPreview] = useState(false)
  const w = b.welcome
  const can = canSendWelcome(db, me, b)
  const c = welcomeContent(db, b)
  const waTemplate = workflowSettings(db.settings.workflow).whatsapp.welcomeTemplate
  const send = async () => {
    if (!(await run(() => requeueWelcome(me, b.id)))) return
    const r = await deliverWelcome(me, b.id)
    if (r) toast(r.status === 'SENT' ? 'success' : 'error', r.status === 'SENT' ? `Welcome email sent to ${r.to}` : `Not sent: ${r.error ?? r.status}`)
  }
  const sendWhatsapp = async () => {
    if (!(await run(() => requeueWelcome(me, b.id, 'whatsapp')))) return
    try {
      const r = await requestWelcomeWhatsapp(b.id)
      if (r) toast(r.status === 'SENT' ? 'success' : 'error', r.status === 'SENT' ? `Welcome WhatsApp sent to ${r.to}` : `Not sent: ${r.error ?? r.status}`)
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Not sent') }
  }
  const waNote = !w ? '' : w.whatsapp.status === 'SENT' ? `Sent ${fmtDateTime(w.whatsapp.sentAt)} through Interakt (delivery and read receipts aren’t tracked).`
    : w.whatsapp.error ? w.whatsapp.error
    : w.whatsapp.status === 'PENDING' || w.whatsapp.status === 'SENDING' ? 'Going out through Interakt — within a few minutes.'
    : w.whatsapp.status === 'NO_CONTACT' ? 'Add the client’s mobile number on the file.'
    : w.whatsapp.status === 'SKIPPED' ? 'Automatic sending is off (Workflow settings) — send it yourself.'
    : 'WhatsApp isn’t set up (Interakt key on the live server and a welcome template in Workflow settings) — open the chat to send it from your phone.'
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Client welcome message" subtitle="Sent once when Legal approves the file and it moves to Operations" icon={Send}
        action={<Button size="sm" variant="ghost" icon={Eye} onClick={() => setPreview(true)}>Preview</Button>} />
      {!w ? <p className="px-5 py-4 text-sm text-mute">Starts when Legal approves the file.</p> : (
        <div className="divide-y divide-line/70 text-sm">
          <div className="flex flex-wrap items-center gap-3 px-5 py-3">
            <Mail className="size-4 text-mute" />
            <span className="min-w-0 flex-1"><b>Email</b> <span className="text-mute">to {w.email.to || b.email || '—'}</span>
              <span className="block text-[11px] text-mute">
                {w.email.status === 'SENT' ? `Sent ${fmtDateTime(w.email.sentAt)}` : w.email.error ? w.email.error : w.email.status === 'NO_CONTACT' ? 'Add the client’s email on the file, then send.' : w.email.status === 'SKIPPED' ? 'Automatic sending is off (Workflow settings) — send it yourself.' : w.email.status === 'NOT_CONFIGURED' ? 'The mail server isn’t set up on the live server (SMTP).' : ''}
                {w.email.attempts > 0 && ` · ${w.email.attempts} attempt${w.email.attempts === 1 ? '' : 's'}`}
              </span></span>
            <Badge tone={DELIVERY[w.email.status].tone}>{DELIVERY[w.email.status].label}</Badge>
            {can && !['SENT', 'SENDING'].includes(w.email.status) && <Button size="sm" variant={w.email.status === 'FAILED' ? 'danger' : 'primary'} icon={RefreshCw} disabled={!isEmail(b.email)} onClick={send}>{w.email.status === 'FAILED' || w.email.status === 'NOT_CONFIGURED' ? 'Retry' : 'Send'}</Button>}
          </div>
          <div className="flex flex-wrap items-center gap-3 px-5 py-3">
            <MessageCircle className="size-4 text-mute" />
            <span className="min-w-0 flex-1"><b>WhatsApp</b> <span className="text-mute">to {w.whatsapp.to || b.mobile || '—'}</span>
              <span className="block text-[11px] text-mute">{waNote}{w.whatsapp.attempts > 0 && ` · ${w.whatsapp.attempts} attempt${w.whatsapp.attempts === 1 ? '' : 's'}`}{w.whatsapp.manualAt ? ` · Chat opened by ${userName(db, w.whatsapp.manualBy)} ${fmtDateTime(w.whatsapp.manualAt)}.` : ''}</span></span>
            <Badge tone={DELIVERY[w.whatsapp.status].tone}>{DELIVERY[w.whatsapp.status].label}</Badge>
            {can && CLOUD && waTemplate && isPhone(b.mobile) && !['SENT', 'SENDING'].includes(w.whatsapp.status) && <Button size="sm" variant={w.whatsapp.status === 'FAILED' ? 'danger' : 'primary'} icon={RefreshCw} onClick={sendWhatsapp}>{w.whatsapp.status === 'FAILED' ? 'Retry' : 'Send'}</Button>}
            {can && w.whatsapp.status !== 'NO_CONTACT' && w.whatsapp.status !== 'SENT' && <a href={whatsappLink(b.mobile, c.whatsapp)} target="_blank" rel="noreferrer" onClick={() => noteWhatsappOpened(me, b.id)}><Button size="sm" variant="outline" icon={MessageCircle}>Open in WhatsApp</Button></a>}
          </div>
        </div>
      )}
      <Modal open={preview} onClose={() => setPreview(false)} title="Welcome message preview" size="lg" subtitle="Edit the wording in Workflow settings (Admin)." footer={<Button onClick={() => setPreview(false)}>Close</Button>}>
        <div className="space-y-4 text-sm">
          <div><p className="text-[11px] font-semibold uppercase text-mute">Email subject</p><p className="font-semibold">{c.subject}</p></div>
          <div><p className="text-[11px] font-semibold uppercase text-mute">Email</p><pre className="whitespace-pre-wrap rounded-xl bg-card2 p-3 font-sans">{c.message}</pre></div>
          <div><p className="text-[11px] font-semibold uppercase text-mute">WhatsApp</p><pre className="whitespace-pre-wrap rounded-xl bg-card2 p-3 font-sans">{c.whatsapp}</pre></div>
        </div>
      </Modal>
    </Card>
  )
}

/** Every-15-days follow-up: next date, notes from Operations / Admin, and Admin's pause / resume / reschedule. */
export function FollowUpCard({ b }: { b: Booking }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [note, setNote] = useState('')
  const [sched, setSched] = useState<{ nextOn: string; everyDays: number } | null>(null)
  const f = b.followUp
  const t = istToday()
  const active = ACTIVE_FILE_STATUSES.includes(b.status)
  const mayNote = can('followup.manage') || b.opsMemberId === me.id || b.adminId === me.id || me.role === 'superadmin' || me.role === 'it'
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Follow-up reminder" subtitle={f ? `Every ${f.everyDays} days · started ${fmtDate(f.startedOn)}` : 'Every 15 days while Operations works the file'} icon={CalendarClock}
        action={f && can('followup.manage') && <span className="flex gap-1">
          <Button size="sm" variant="ghost" icon={f.paused ? Play : Pause} onClick={() => run(() => setFollowUpSchedule(me, b.id, { paused: !f.paused }), f.paused ? 'Follow-ups resumed' : 'Follow-ups paused')}>{f.paused ? 'Resume' : 'Pause'}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSched({ nextOn: f.nextOn < t ? t : f.nextOn, everyDays: f.everyDays })}>Change</Button>
        </span>} />
      {!f ? <p className="px-5 py-4 text-sm text-mute">Starts when Legal approves the file.</p> : (
        <div className="space-y-3 p-5 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>Next reminder: <b className={cx(active && !f.paused && f.nextOn < t && 'text-bad')}>{!active ? 'stopped (file closed)' : f.paused ? 'paused' : fmtDate(f.nextOn)}</b>{active && !f.paused && f.nextOn < t && <Badge tone="red" className="ml-2">Overdue</Badge>}</span>
            <span className="text-mute">Last follow-up: <b className="text-ink">{f.lastOn ? fmtDate(f.lastOn) : '—'}</b></span>
          </div>
          {mayNote && active && (
            <div className="flex flex-wrap items-end gap-2">
              <Textarea label="Record a follow-up" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Called the client — documents promised by Friday…" className="min-w-60 flex-1" />
              <Button icon={BellRing} onClick={async () => { if (await run(() => addFollowUpNote(me, b.id, note), 'Follow-up recorded')) setNote('') }}>Save</Button>
            </div>
          )}
          {f.log.length > 0 && (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto border-t border-line pt-3 text-xs">
              {f.log.slice(0, 20).map((x, i) => <li key={i}><span className="text-mute">{fmtDateTime(x.at)} · {x.by ? userName(db, x.by) : 'Reminder'} · {x.kind.toLowerCase()}</span>{x.note ? ` — ${x.note}` : ''}</li>)}
            </ul>
          )}
        </div>
      )}
      <Modal open={!!sched} onClose={() => setSched(null)} title="Change the follow-up schedule" size="sm"
        footer={<><Button variant="outline" onClick={() => setSched(null)}>Cancel</Button><Button onClick={async () => { if (sched && await run(() => setFollowUpSchedule(me, b.id, sched), 'Schedule changed')) setSched(null) }}>Save</Button></>}>
        {sched && <div className="grid gap-3">
          <Input label="Next reminder" type="date" min={t} value={sched.nextOn} onChange={(e) => setSched({ ...sched, nextOn: e.target.value })} />
          <Input label="Repeat every (days)" type="number" min={1} max={90} value={sched.everyDays} onChange={(e) => setSched({ ...sched, everyDays: Number(e.target.value) })} />
        </div>}
      </Modal>
    </Card>
  )
}

/** Upload button for a stage's file — shown only to the Admin the Operation team assigned the stage to. */
function StageUpload({ b, stage, label = 'Upload file' }: { b: Booking; stage: AdminStageId; label?: string }) {
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  if (!canUploadAdminStage(me, b, stage)) return null
  const upload = async (files: FileList) => {
    setBusy(true)
    try {
      const refs: FileRef[] = []
      for (const f of Array.from(files)) { checkFile(f, DOC_ACCEPT, f.name); refs.push(await saveFile(f)) }
      await run(() => addAdminStageFiles(me, b.id, stage, refs), `${refs.length} file(s) uploaded`)
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Could not upload.') } finally { setBusy(false) }
  }
  return <>
    <input ref={input} type="file" multiple accept={DOC_ACCEPT} className="hidden" onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = '' }} />
    <Button size="sm" variant="outline" icon={Upload} loading={busy} onClick={() => input.current?.click()}>{label}</Button>
  </>
}

/** The five Admin stages on this file, each with its own status, person and due date; Pitch Deck has its reminder. */
export function AdminChecklist({ b }: { b: Booking }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [edit, setEdit] = useState<{ stage: AdminStageId; status: AdminWorkStatus; note: string; due: string; assignee: string } | null>(null)
  const [fwd, setFwd] = useState<{ to: Partial<Record<AdminStageId, string>>; note: string } | null>(null)
  const [fu, setFu] = useState('')
  const work = b.adminWork
  // the Pitch Deck reminder: its Admin and the file's Operations person
  const mayWork = canWorkAdminStage(db, me, b, 'PRECHECK')
  const mayForward = canForwardAdminStages(db, me, b)
  const admins = usersWithRole(db, 'admin')
  const t = istToday()
  // an Admin set up in Operations Dashboard → Team sees only the stages assigned to them
  const limited = isStageOnlyAdmin(db, me)
  const stages = ADMIN_STAGES.filter((s) => !limited || work?.[s.id]?.assignee === me.id)
  const eligible = work ? stages.filter((s) => work[s.id] && work[s.id]!.status !== 'NOT_NEEDED') : []
  const done = eligible.filter((s) => ADMIN_DONE.includes(work![s.id]!.status)).length
  const pc = !limited || work?.PRECHECK?.assignee === me.id ? work?.PRECHECK : undefined
  const filesOf = (s: (typeof ADMIN_STAGES)[number]) => b.documents.filter((d) => d.category === s.label)
  const openForward = () => setFwd({ to: Object.fromEntries(ADMIN_STAGES.map((s) => [s.id, work?.[s.id]?.assignee ?? ''])), note: '' })
  return (
    <Card className="overflow-hidden xl:col-span-2">
      <CardHeader title={limited ? 'My Admin stages' : 'Admin checklist'} subtitle={limited ? `${done} of ${eligible.length} of your stages done` : work ? `${done} of ${eligible.length} stages done · each stage can go to a different Admin` : 'Starts when Operations assigns the file to an Admin'} icon={ClipboardCheck}
        action={mayForward && <Button size="sm" variant="outline" icon={Forward} onClick={openForward}>Forward stages</Button>} />
      {!work ? <p className="px-5 py-4 text-sm text-mute">No Admin yet.{mayForward && ' Forward the stages to Admins one by one, or assign the whole file with “Assign to Admin”.'}</p> : (
        <>
          <div className="px-5 pt-4"><Progress value={eligible.length ? (done / eligible.length) * 100 : 0} tone={done === eligible.length && eligible.length ? 'green' : 'orange'} /></div>
          <ul className="divide-y divide-line/70">
            {stages.map((s) => {
              const w = work[s.id]
              if (!w) return null
              const overdue = !!w.due && w.due < t && !ADMIN_DONE.includes(w.status) && w.status !== 'NOT_NEEDED'
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0 flex-1"><b>{s.label}</b>{w.ref && <span className="ml-2 rounded-md bg-card2 px-1.5 py-0.5 font-mono text-[11px] font-semibold">{w.ref}</span>}
                    <span className="block text-[11px] text-mute">{w.assignee ? userName(db, w.assignee) : <b className="text-warn">Not assigned — forward it</b>}{w.assignedBy ? ` (assigned by ${userName(db, w.assignedBy)})` : ''} · updated {fmtDateTime(w.updatedAt)}{w.submittedAt ? ` · submitted ${fmtDateTime(w.submittedAt)}` : ''}{w.due ? ` · due ${fmtDate(w.due)}` : ''}{w.history.at(-1)?.note ? ` · ${w.history.at(-1)!.note}` : ''}</span>
                    {filesOf(s).length > 0 && <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">{filesOf(s).map((d) => d.file ? <FileLink key={d.id} file={d.file} label={d.name} /> : <span key={d.id}>{d.name}</span>)}</span>}</span>
                  {overdue && <Badge tone="red">Overdue</Badge>}
                  <Badge tone={workTone(w.status)}>{adminStatusLabel(w.status)}</Badge>
                  <StageUpload b={b} stage={s.id} />
                  {canWorkAdminStage(db, me, b, s.id) && <Button size="sm" variant="ghost" onClick={() => setEdit({ stage: s.id, status: w.status, note: '', due: w.due ?? '', assignee: w.assignee ?? b.adminId ?? '' })}>Update</Button>}
                </li>
              )
            })}
          </ul>
          {pc && (
            <div className="border-t border-line bg-card2/40 px-5 py-3 text-sm">
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1"><b>Pitch Deck reminder</b>
                {precheckPending(b) ? <>
                  <span>Next: <b className={cx(pc.nextRemindOn && pc.nextRemindOn < t && 'text-bad')}>{pc.nextRemindOn ? fmtDate(pc.nextRemindOn) : '—'}</b>{pc.nextRemindOn && pc.nextRemindOn < t && <Badge tone="red" className="ml-1">Overdue</Badge>}</span>
                  <span className="text-mute">Last follow-up: {pc.lastFollowUpOn ? fmtDate(pc.lastFollowUpOn) : '—'}</span>
                  <span className="flex items-center gap-1 text-mute">Every
                    <select aria-label="Pitch Deck reminder interval" disabled={!mayWork} value={pc.remindEveryDays ?? 3} onChange={(e) => run(() => setPrecheckInterval(me, b.id, Number(e.target.value)), 'Reminder interval changed')} className="h-8 rounded-lg border border-line bg-card px-2 text-xs">
                      <option value={3}>3</option><option value={4}>4</option>
                    </select> days</span>
                </> : <span className="text-mute">Stopped — {adminStatusLabel(pc.status).toLowerCase()}</span>}
              </p>
              {mayWork && precheckPending(b) && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Input aria-label="Pitch Deck follow-up" value={fu} onChange={(e) => setFu(e.target.value)} placeholder="What was followed up (deck sent, client reminded…)" className="min-w-60 flex-1" />
                  <Button size="sm" icon={BellRing} onClick={async () => { if (await run(() => logPrecheckFollowUp(me, b.id, fu), 'Follow-up recorded — next reminder moved')) setFu('') }}>Record follow-up</Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? ADMIN_STAGES.find((s) => s.id === edit.stage)!.label : ''} size="sm"
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={async () => {
          if (!edit) return
          const cur = work?.[edit.stage]
          const ok = await run(() => setAdminWork(me, b.id, edit.stage, { status: edit.status !== cur?.status ? edit.status : undefined, note: edit.note, due: (edit.due || null) !== (cur?.due ?? null) ? edit.due || null : undefined, assignee: edit.assignee && edit.assignee !== cur?.assignee ? edit.assignee : undefined }), 'Stage updated')
          if (ok) setEdit(null)
        }}>Save</Button></>}>
        {edit && <div className="grid gap-3">
          <Select label="Status" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as AdminWorkStatus })}>{ADMIN_WORK_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
          {canUploadAdminStage(me, b, edit.stage) && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line p-3 text-xs text-mute">
              <StageUpload b={b} stage={edit.stage} label="Upload the file for this stage" />
              <span>Saved on this CRM entry as {work?.[edit.stage]?.ref ?? b.bookingId} · {ADMIN_STAGES.find((s) => s.id === edit.stage)!.short}</span>
            </div>
          )}
          {['SUBMITTED', 'APPROVED', 'COMPLETED'].includes(edit.status) && !stageFiles(b, edit.stage).length && (
            <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">Upload the file for this stage first — it can be marked {adminStatusLabel(edit.status).toLowerCase()} only once its file is on the CRM entry.</p>
          )}
          <Select label="Admin doing it" value={edit.assignee} onChange={(e) => setEdit({ ...edit, assignee: e.target.value })} hint="Only Admins allowed this document are listed">
            {!edit.assignee && <option value="">— Not assigned —</option>}
            {admins.filter((u) => adminMayDo(db, u.id, edit.stage) || u.id === edit.assignee).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <Input label="Due date" type="date" value={edit.due} onChange={(e) => setEdit({ ...edit, due: e.target.value })} />
          <Textarea label="Note" rows={2} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} hint="Needed when a stage is returned, not needed, or a finished stage is re-opened" />
        </div>}
      </Modal>
      <Modal open={!!fwd} onClose={() => setFwd(null)} title="Forward Admin stages" subtitle={`Each stage can go to a different Admin. Every new person gets the next number: ${b.bookingId}/1, /2, /3 …`} size="md"
        footer={<><Button variant="outline" onClick={() => setFwd(null)}>Cancel</Button><Button icon={Forward} onClick={async () => {
          if (!fwd) return
          const changed = Object.fromEntries(Object.entries(fwd.to).filter(([s, uid]) => uid && uid !== work?.[s as AdminStageId]?.assignee))
          if (await run(() => forwardAdminStages(me, b.id, changed, fwd.note), 'Stages forwarded')) setFwd(null)
        }}>Forward</Button></>}>
        {fwd && <div className="grid gap-3">
          {ADMIN_STAGES.map((s) => {
            const w = work?.[s.id], finished = !!w && ADMIN_DONE.includes(w.status)
            return (
              <Select key={s.id} label={`${s.label}${w?.ref ? ` · now ${w.ref}` : ''}${finished ? ' · done' : ''}`} value={fwd.to[s.id] ?? ''} disabled={finished && !isMaster(me)}
                onChange={(e) => setFwd({ ...fwd, to: { ...fwd.to, [s.id]: e.target.value } })}>
                <option value="">— Not forwarded —</option>
                {admins.filter((u) => adminMayDo(db, u.id, s.id) || u.id === fwd.to[s.id]).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            )
          })}
          <Textarea label="Note for the Admins (optional)" rows={2} value={fwd.note} onChange={(e) => setFwd({ ...fwd, note: e.target.value })} />
        </div>}
      </Modal>
    </Card>
  )
}
