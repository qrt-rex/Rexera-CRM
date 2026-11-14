import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, ClipboardList, FileSignature, Lock, MessageSquareWarning, Save, Send } from 'lucide-react'
import type { FileRef, HrAnswer, HrForm, HrFormSubmission, HrSubStatus } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { fmtDate, fmtDateTime, today } from '../../lib/format'
import { discardHrFile, myForms, saveHrSubmission, uploadHrFile } from '../../lib/hrForms'
import { answerProblems, canFill, EDITABLE, isOverdue, progressOf, SENT, STATUS_LABEL, statusOf } from '../../../supabase/hr-form-rules.mjs'
import { AnswerView, FormFill } from '../../components/hrforms/HrFormFields'
import { STATUS_TONE, FormHead } from '../hr/HrForms'
import { Badge, Button, Card, cx, EmptyState, PageHeader, useRun, useSubmitting, useToast } from '../../components/ui'

/**
 * My Forms (every employee): the forms HR assigned to them — fill, upload documents, save a draft (when the form
 * allows it), submit, and follow the status (Pending → In Progress → Submitted → Under Review → Approved / Rejected,
 * or Correction requested). Their own submissions only (the database checks the same).
 */
export default function MyForms() {
  const db = useDb()
  const me = useMe()
  const [params, setParams] = useSearchParams()
  const open = params.get('open')
  const list = useMemo(() => myForms(db, me), [db, me])
  const t = today()
  const item = open ? list.find((x) => x.form.id === open) : undefined
  if (item) return <FillForm key={item.form.id} form={item.form} sub={item.sub} onBack={() => setParams({})} />
  const todo = list.filter((x) => !SENT.includes(statusOf(x.sub) as HrSubStatus) && canFill(x.form, x.sub, t))
  const rest = list.filter((x) => !todo.includes(x))
  return (
    <div>
      <PageHeader title="My Forms" icon={ClipboardList} subtitle="Forms HR asked you to fill — your answers and documents go straight to HR" />
      {!list.length ? <Card><EmptyState icon={FileSignature} title="No forms for you" text="When HR assigns you a form it appears here, and you get a notification." /></Card> : (
        <div className="grid gap-5">
          <Group title="To fill" empty="Nothing to fill right now." items={todo} onOpen={(id) => setParams({ open: id })} />
          {rest.length > 0 && <Group title="Sent and closed" items={rest} onOpen={(id) => setParams({ open: id })} />}
        </div>
      )}
    </div>
  )
}

function Group({ title, items, empty, onOpen }: { title: string; items: { form: HrForm; sub?: HrFormSubmission }[]; empty?: string; onOpen: (id: string) => void }) {
  const t = today()
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-mute">{title} <span className="text-mute/70">({items.length})</span></h2>
      {!items.length ? <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-mute">{empty}</p> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map(({ form, sub }) => {
            const st = statusOf(sub)
            const late = isOverdue(form, sub, t)
            const pct = sub ? progressOf(sub.fields, sub.answers) : 0
            return (
              <button key={form.id} onClick={() => onOpen(form.id)} className="group rounded-2xl border border-line bg-card p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-pop">
                <div className="flex items-start gap-3">
                  <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', st === 'CHANGES_REQUESTED' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand-ink')}>{st === 'CHANGES_REQUESTED' ? <MessageSquareWarning className="size-5" /> : <FileSignature className="size-5" />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-bold">{form.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5"><Badge tone={STATUS_TONE[st]} dot>{STATUS_LABEL[st]}</Badge>{late && <Badge tone="red">Overdue</Badge>}</span></span>
                </div>
                {form.description && <p className="mt-2 line-clamp-2 text-sm text-mute">{form.description}</p>}
                {st === 'IN_PROGRESS' && <div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-card2"><div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></div><p className="mt-1 text-[11px] text-mute">{pct}% filled</p></div>}
                <p className="mt-3 flex flex-wrap gap-x-3 text-[11px] text-mute">
                  {form.deadline && <span className={cx('inline-flex items-center gap-1', late && 'font-semibold text-bad')}><CalendarClock className="size-3.5" />Due {fmtDate(form.deadline)}</span>}
                  {sub?.submittedAt && <span>Sent {fmtDateTime(sub.submittedAt)}</span>}
                </p>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function FillForm({ form, sub, onBack }: { form: HrForm; sub?: HrFormSubmission; onBack: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const [busy, submit] = useSubmitting()
  const t = today()
  const editable = canFill(form, sub, t)
  const fields = sub && (sub.status === 'CHANGES_REQUESTED' || !editable) ? sub.fields : form.fields
  const [vals, setVals] = useState<Record<string, HrAnswer>>(() => ({ ...(sub?.answers ?? {}) }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [done, setDone] = useState(false)
  const saved = JSON.stringify(vals) === JSON.stringify(sub?.answers ?? {})
  // leaving with unsaved answers: the browser asks first
  useEffect(() => {
    if (saved || !editable) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saved, editable])
  const st = statusOf(sub)

  const send = (final: boolean) => submit(async () => {
    if (final) {
      const p = answerProblems(fields, vals, { users: db.users })
      setErrors(p)
      if (Object.keys(p).length) { toast('error', `${Object.keys(p).length} field${Object.keys(p).length === 1 ? ' needs' : 's need'} attention.`); document.getElementById(`hf-${Object.keys(p)[0]}-l`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return }
    }
    const r = await run(() => saveHrSubmission(me, form.id, vals, final), final ? undefined : 'Draft saved — you can come back to it')
    if (r && final) setDone(true)
  })

  if (done) return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      <span className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-ok-soft text-ok"><CheckCircle2 className="size-9" /></span>
      <h2 className="text-xl font-extrabold">Submitted — thank you!</h2>
      <p className="mt-2 text-sm text-mute">Your answers to <b>{form.title}</b> are with HR. You'll get a notification when they review it, and you can follow its status in My Forms.</p>
      <Button className="mt-6" icon={ArrowLeft} onClick={onBack}>Back to My Forms</Button>
    </Card>
  )

  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack} className="mb-3">My Forms</Button>
      <Card className="p-5 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[st]} dot>{STATUS_LABEL[st]}</Badge>{isOverdue(form, sub, t) && <Badge tone="red">Overdue</Badge>}{sub?.submittedAt && <span className="text-xs text-mute">Sent {fmtDateTime(sub.submittedAt)}</span>}</div>
        <FormHead form={form} />
        {sub?.reviewNote && (st === 'CHANGES_REQUESTED' || st === 'REJECTED') && (
          <p className={cx('mb-5 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm', st === 'REJECTED' ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn')}>
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /><span><b>{st === 'REJECTED' ? 'HR rejected it:' : 'HR asked for a correction:'}</b> {sub.reviewNote}</span>
          </p>
        )}
        {sub?.reviewNote && st === 'APPROVED' && <p className="mb-5 rounded-xl bg-ok-soft px-3 py-2.5 text-sm text-ok"><b>HR:</b> {sub.reviewNote}</p>}
        {editable ? (
          <>
            <FormFill fields={fields} values={vals} errors={errors} users={db.users}
              onChange={(id, v) => { setVals((x) => ({ ...x, [id]: v })); if (errors[id]) setErrors((e) => { const n = { ...e }; delete n[id]; return n }) }}
              uploader={(f, file) => uploadHrFile(me, f, file)}
              onDiscard={(ref: FileRef) => { void discardHrFile(me, ref, form.id) }} />
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
              {!saved && <span className="mr-auto text-xs font-semibold text-warn">Not saved yet</span>}
              {(form.allowDraft || st === 'CHANGES_REQUESTED') && <Button variant="outline" icon={Save} loading={busy} onClick={() => send(false)}>Save draft</Button>}
              <Button icon={Send} loading={busy} onClick={() => send(true)}>{st === 'CHANGES_REQUESTED' ? 'Send corrections' : 'Submit'}</Button>
            </div>
          </>
        ) : sub && !EDITABLE.includes(sub.status) ? (
          <>
            <p className="mb-2 flex items-center gap-2 text-xs text-mute"><Lock className="size-3.5" />Sent to HR — it can't be changed now{st === 'APPROVED' || st === 'REJECTED' ? '' : ' (HR can send it back if something needs correcting)'}.</p>
            <AnswerView fields={sub.fields} answers={sub.answers} users={db.users} />
          </>
        ) : (
          <EmptyState icon={Lock} title="This form is closed" text={form.deadline && form.deadline < t ? `The deadline was ${fmtDate(form.deadline)}. Ask HR if you still need to send it.` : 'HR has closed this form.'} />
        )}
      </Card>
    </div>
  )
}
