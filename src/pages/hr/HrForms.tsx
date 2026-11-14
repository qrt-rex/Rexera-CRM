import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlarmClock, Archive, ArrowDown, ArrowUp, BarChart3, BellRing, CalendarClock, Check, CheckCircle2, ClipboardList, Copy, Eye, FileDown, FileSignature, FileSpreadsheet,
  GripVertical, Inbox, LayoutList, ListChecks, MessageSquarePlus, MoreHorizontal, Pencil, Plus, RotateCcw, Save, Search, Send, Settings2, ShieldCheck, Trash2, Undo2, Users, XCircle,
} from 'lucide-react'
import type { HrAnswer, HrForm, HrFormField, HrFieldType, HrSubStatus, Role } from '../../lib/types'
import { getDb, useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { ROLES, roleLabel } from '../../lib/rbac'
import { branchList, branchName } from '../../lib/branches'
import { fmtDate, fmtDateTime, today } from '../../lib/format'
import {
  addHrNote, canManageHrForms, duplicateHrForm, emptyHrForm, exportResponsesPdf, exportResponsesXlsx, hrManagers, newHrField, remindHrForm, reviewersOf, reviewHrSubmission,
  saveHrForm, setHrFormStatus, type HrFormInput,
} from '../../lib/hrForms'
import {
  analytics, assignees, canStep, CHOICE_TYPES, FIELD_TYPES, FILE_TYPES, filterRows, FORMATS, formProblems, MAX_FILE_MB, MAX_FILES, MULTI_TYPES, responseRows, SENT, STATUS_LABEL, TYPE_LABEL,
  type ResponseRow, type ViewStatus,
} from '../../../supabase/hr-form-rules.mjs'
import { AnswerView, FormFill } from '../../components/hrforms/HrFormFields'
import {
  Avatar, Badge, Button, Card, CardHeader, Checkbox, cx, Drawer, EmptyState, Input, Menu, MenuItem, Modal, PageHeader, SearchBox, Select, Stat, Table, Tabs, Td, Textarea, Th, Toggle,
  usePaged, useConfirm, useRun,
} from '../../components/ui'

/**
 * HR Dashboard → HR Form Builder: forms (build with drag and drop, preview, publish, assign, duplicate, archive),
 * Form Responses (every employee's submission: filter, review, approve / reject / ask for corrections, internal
 * comments, export) and Analytics. Rules: supabase/hr-form-rules.mjs · actions: src/lib/hrForms.ts.
 */
type Tab = 'forms' | 'responses' | 'analytics'
export const STATUS_TONE: Record<ViewStatus, 'gray' | 'blue' | 'violet' | 'amber' | 'orange' | 'green' | 'red'> = {
  PENDING: 'gray', IN_PROGRESS: 'blue', SUBMITTED: 'violet', UNDER_REVIEW: 'amber', CHANGES_REQUESTED: 'orange', APPROVED: 'green', REJECTED: 'red',
}
const FORM_TONE: Record<HrForm['status'], 'gray' | 'green' | 'amber' | 'red'> = { DRAFT: 'gray', PUBLISHED: 'green', UNPUBLISHED: 'amber', ARCHIVED: 'red' }
const FORM_LABEL: Record<HrForm['status'], string> = { DRAFT: 'Draft', PUBLISHED: 'Published', UNPUBLISHED: 'Unpublished', ARCHIVED: 'Archived' }

function useHrData() {
  const db = useDb()
  return useMemo(() => {
    const forms = db.hrForms ?? [], subs = db.hrFormSubmissions ?? []
    const rows = responseRows({ forms, subs, users: db.users, today: today() })
    return { forms, subs, rows, stats: analytics({ forms, rows }) }
  }, [db.hrForms, db.hrFormSubmissions, db.users])
}

export default function HrForms() {
  const db = useDb()
  const me = useMe()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'forms'
  const edit = params.get('edit')
  const { stats, rows } = useHrData()
  if (!canManageHrForms(db, me)) return <Card><EmptyState icon={ShieldCheck} title="HR only" text="The HR Form Builder is for HR, Super Admin and IT Support. Your own forms are in My Forms." /></Card>
  if (edit) return <Builder key={edit} id={edit === 'new' ? undefined : edit} onClose={() => setParams({ tab: 'forms' })} onSaved={(id) => setParams({ edit: id }, { replace: true })} />
  const set = (t: Tab) => setParams({ tab: t })
  return (
    <div>
      <PageHeader title="HR Form Builder" icon={FileSignature} subtitle="Make any employee form, publish it to the people who should fill it, and review every response here"
        actions={<Button icon={Plus} onClick={() => setParams({ edit: 'new' })}>New form</Button>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat icon={FileSignature} tone="navy" label="Forms created" value={stats.totalForms} onClick={() => set('forms')} />
        <Stat icon={Send} tone="green" label="Active forms" value={stats.activeForms} sub="published" onClick={() => set('forms')} />
        <Stat icon={Users} tone="violet" label="Total assigned" value={stats.assigned} sub="employee × form" onClick={() => set('responses')} />
        <Stat icon={AlarmClock} tone="amber" label="Pending" value={stats.pending} sub={stats.overdue ? `${stats.overdue} overdue` : 'not sent yet'} onClick={() => setParams({ tab: 'responses', status: 'OPEN' })} />
        <Stat icon={Inbox} tone="blue" label="Completed" value={stats.completed} sub={`${stats.underReview} to review`} onClick={() => setParams({ tab: 'responses', status: 'DONE' })} />
        <Stat icon={CheckCircle2} tone="green" label="Approved" value={stats.approved} onClick={() => setParams({ tab: 'responses', status: 'APPROVED' })} />
        <Stat icon={XCircle} tone="red" label="Rejected" value={stats.rejected} onClick={() => setParams({ tab: 'responses', status: 'REJECTED' })} />
      </div>
      <Tabs className="mb-4" value={tab} onChange={set} tabs={[
        { id: 'forms', label: 'Forms', icon: LayoutList, count: stats.totalForms },
        { id: 'responses', label: 'Form Responses', icon: Inbox, count: rows.filter((r) => r.status === 'SUBMITTED').length || undefined },
        { id: 'analytics', label: 'Analytics', icon: BarChart3 },
      ]} />
      {tab === 'forms' ? <FormsTab /> : tab === 'responses' ? <ResponsesTab /> : <AnalyticsTab />}
    </div>
  )
}

// ================================================================== forms list
function FormsTab() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const [, setParams] = useSearchParams()
  const { forms, rows } = useHrData()
  const [q, setQ] = useState('')
  const [st, setSt] = useState<'' | HrForm['status']>('')
  const [preview, setPreview] = useState<HrForm | null>(null)
  const shown = forms.filter((f) => (!st ? f.status !== 'ARCHIVED' : f.status === st) && (!q.trim() || f.title.toLowerCase().includes(q.trim().toLowerCase())))
  const t = today()
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search forms…" className="w-64 max-w-full" />
        <div className="flex flex-wrap rounded-lg border border-line p-0.5 text-xs font-semibold">
          {([['', 'Active & drafts'], ['DRAFT', 'Drafts'], ['PUBLISHED', 'Published'], ['UNPUBLISHED', 'Unpublished'], ['ARCHIVED', 'Archived']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setSt(v)} className={cx('rounded-md px-2.5 py-1', st === v ? 'bg-brand-soft text-brand-ink' : 'text-mute hover:text-ink')}>{l}</button>
          ))}
        </div>
      </div>
      {!shown.length ? (
        <Card><EmptyState icon={FileSignature} title={forms.length ? 'No forms match' : 'No forms yet'} text="Create a form, add fields by dragging them in, preview it and publish it to employees."
          action={<Button icon={Plus} onClick={() => setParams({ edit: 'new' })}>New form</Button>} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((f) => {
            const mine = rows.filter((r) => r.form.id === f.id)
            const sent = mine.filter((r) => SENT.includes(r.status as HrSubStatus)).length
            const toReview = mine.filter((r) => r.status === 'SUBMITTED').length
            const assignedNow = f.status === 'DRAFT' ? assignees(f, db.users).length : mine.length
            const late = f.deadline && f.deadline < t
            return (
              <Card key={f.id} className="flex flex-col p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink"><FileSignature className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <button onClick={() => setParams({ edit: f.id })} className="block max-w-full truncate text-left font-bold hover:underline">{f.title}</button>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-mute">
                      <Badge tone={FORM_TONE[f.status]} dot>{FORM_LABEL[f.status]}</Badge><span>v{f.version}</span><span>· {f.fields.length} field{f.fields.length === 1 ? '' : 's'}</span>
                      {f.fields.some((x) => FILE_TYPES.includes(x.type)) && <span>· uploads</span>}
                    </p>
                  </div>
                  <Menu trigger={() => <span className="grid size-8 place-items-center rounded-lg text-mute hover:bg-card2"><MoreHorizontal className="size-4" /></span>}>
                    {(close) => (
                      <>
                        <MenuItem icon={Pencil} onClick={() => { close(); setParams({ edit: f.id }) }}>{f.status === 'ARCHIVED' ? 'Open' : 'Edit'}</MenuItem>
                        <MenuItem icon={Eye} onClick={() => { close(); setPreview(f) }}>Preview</MenuItem>
                        <MenuItem icon={Copy} onClick={async () => { close(); const id = await run(() => duplicateHrForm(me, f.id), 'Copied as a new draft'); if (typeof id === 'string') setParams({ edit: id }) }}>Duplicate</MenuItem>
                        <MenuItem icon={Inbox} onClick={() => { close(); setParams({ tab: 'responses', form: f.id }) }}>Responses</MenuItem>
                        {f.status === 'PUBLISHED' && <MenuItem icon={Undo2} onClick={() => { close(); run(() => setHrFormStatus(me, f.id, 'UNPUBLISHED'), 'Unpublished — employees no longer see it (answers are kept)') }}>Unpublish</MenuItem>}
                        {f.status === 'ARCHIVED' && <MenuItem icon={RotateCcw} onClick={() => { close(); run(() => setHrFormStatus(me, f.id, 'UNPUBLISHED'), 'Restored (unpublished)') }}>Restore</MenuItem>}
                        {f.status !== 'ARCHIVED' && <MenuItem icon={Archive} danger onClick={async () => { close(); if (await confirm('Archive this form?', 'Employees stop seeing it. Every submission and file is kept, and you can restore it later.')) run(() => setHrFormStatus(me, f.id, 'ARCHIVED'), 'Archived') }}>Archive</MenuItem>}
                      </>
                    )}
                  </Menu>
                </div>
                {f.description && <p className="mt-2 line-clamp-2 text-sm text-mute">{f.description}</p>}
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-card2 px-2 py-1.5"><b className="block text-base tabular-nums">{assignedNow}</b>assigned</div>
                  <div className="rounded-lg bg-card2 px-2 py-1.5"><b className="block text-base tabular-nums">{sent}</b>sent</div>
                  <div className={cx('rounded-lg px-2 py-1.5', toReview ? 'bg-violet-500/12 text-violet-700 dark:text-violet-300' : 'bg-card2')}><b className="block text-base tabular-nums">{toReview}</b>to review</div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-card2"><div className="h-full rounded-full bg-ok transition-all" style={{ width: `${assignedNow ? (sent / assignedNow) * 100 : 0}%` }} /></div>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mute">
                  <span className={cx('inline-flex items-center gap-1', late && f.status === 'PUBLISHED' && 'font-semibold text-bad')}><CalendarClock className="size-3.5" />{f.deadline ? `Due ${fmtDate(f.deadline)}` : 'No deadline'}</span>
                  <span>Updated {fmtDateTime(f.updatedAt ?? f.createdAt)}</span>
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  {f.status !== 'ARCHIVED' && <Button size="sm" variant="outline" icon={Pencil} onClick={() => setParams({ edit: f.id })}>Edit</Button>}
                  <Button size="sm" variant="outline" icon={Eye} onClick={() => setPreview(f)}>Preview</Button>
                  {(f.status === 'DRAFT' || f.status === 'UNPUBLISHED') && <Button size="sm" icon={Send} onClick={async () => {
                    const n = assignees(f, db.users).length
                    if (await confirm('Publish this form?', `${n} employee${n === 1 ? '' : 's'} will see it in My Forms and get a notification.`)) run(() => setHrFormStatus(me, f.id, 'PUBLISHED'), 'Published — employees have been notified')
                  }}>Publish</Button>}
                  {f.status === 'PUBLISHED' && <Button size="sm" variant="soft" icon={Inbox} onClick={() => setParams({ tab: 'responses', form: f.id })}>Responses</Button>}
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {preview && <PreviewModal form={preview} onClose={() => setPreview(null)} />}
      {confirmNode}
    </>
  )
}

function PreviewModal({ form, onClose }: { form: Pick<HrForm, 'title' | 'description' | 'fields' | 'deadline'>; onClose: () => void }) {
  const db = useDb()
  const [vals, setVals] = useState<Record<string, HrAnswer>>({})
  return (
    <Modal open onClose={onClose} size="lg" title={`Preview · ${form.title || 'Untitled form'}`} subtitle="What employees see — answers here are not saved"
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      <FormHead form={form} />
      <FormFill fields={form.fields} values={vals} onChange={(id, v) => setVals({ ...vals, [id]: v })} users={db.users} />
    </Modal>
  )
}
export function FormHead({ form }: { form: Pick<HrForm, 'title' | 'description' | 'deadline'> }) {
  return (
    <div className="mb-5 rounded-xl border border-line bg-gradient-to-br from-brand-soft/70 to-transparent p-4">
      <h3 className="text-lg font-extrabold">{form.title || 'Untitled form'}</h3>
      {form.description && <p className="mt-1 whitespace-pre-wrap text-sm text-mute">{form.description}</p>}
      {form.deadline && <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-warn"><CalendarClock className="size-3.5" />Submit by {fmtDate(form.deadline)}</p>}
    </div>
  )
}

// ================================================================== builder
const GROUPS = ['Text', 'Choice', 'Files', 'People'] as const
const PATTERNS: [string, string, string][] = [
  ['Digits only', '[0-9]+', 'Use digits only.'], ['PAN (ABCDE1234F)', '[A-Z]{5}[0-9]{4}[A-Z]', 'Enter a valid PAN (e.g. ABCDE1234F).'],
  ['Aadhaar (12 digits)', '[0-9]{12}', 'Enter the 12-digit Aadhaar number.'], ['IFSC (SBIN0001234)', '[A-Z]{4}0[A-Z0-9]{6}', 'Enter a valid IFSC code.'],
  ['PIN code (6 digits)', '[1-9][0-9]{5}', 'Enter a 6-digit PIN code.'], ['Letters and spaces', "[A-Za-z .'-]+", 'Use letters only.'],
]

function Builder({ id, onClose, onSaved }: { id?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const form = id ? db.hrForms?.find((f) => f.id === id) : undefined
  const initial: HrFormInput = form ? { title: form.title, description: form.description ?? '', fields: form.fields, assign: form.assign, deadline: form.deadline ?? '', allowDraft: form.allowDraft, reviewerIds: form.reviewerIds } : emptyHrForm()
  const [f, setF] = useState<HrFormInput>(initial)
  const [sel, setSel] = useState<string | null>(initial.fields[0]?.id ?? null)
  const [mode, setMode] = useState<'build' | 'preview'>('build')
  const [panel, setPanel] = useState<'field' | 'settings' | 'assign'>(initial.fields.length ? 'field' : 'settings')
  const [drop, setDrop] = useState<number | null>(null)
  const [vals, setVals] = useState<Record<string, HrAnswer>>({})
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)
  const readOnly = form?.status === 'ARCHIVED'
  const selected = f.fields.find((x) => x.id === sel)
  const count = useMemo(() => assignees({ assign: f.assign }, db.users).length, [f.assign, db.users])
  const problems = formProblems({ ...f, deadline: f.deadline || undefined }, { today: today() })

  const setFields = (fields: HrFormField[]) => setF((x) => ({ ...x, fields }))
  const insert = (type: HrFieldType, at?: number) => {
    const nf = newHrField(type)
    nf.label = TYPE_LABEL[type]
    const i = at ?? (sel ? f.fields.findIndex((x) => x.id === sel) + 1 : f.fields.length)
    const next = [...f.fields]; next.splice(i, 0, nf)
    setFields(next); setSel(nf.id); setPanel('field'); setMode('build')
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= f.fields.length || from === to) return
    const next = [...f.fields]; const [x] = next.splice(from, 1); next.splice(to > from ? to - 1 : to, 0, x!)
    setFields(next)
  }
  const step = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= f.fields.length) return; const next = [...f.fields]; [next[i], next[j]] = [next[j]!, next[i]!]; setFields(next) }
  const patch = (fid: string, p: Partial<HrFormField>) => setFields(f.fields.map((x) => (x.id === fid ? { ...x, ...p } : x)))
  const remove = (fid: string) => { const i = f.fields.findIndex((x) => x.id === fid); const next = f.fields.filter((x) => x.id !== fid); setFields(next); setSel(next[Math.min(i, next.length - 1)]?.id ?? null) }
  const dup = (fid: string) => { const i = f.fields.findIndex((x) => x.id === fid); const c = { ...f.fields[i]!, id: newHrField().id, label: `${f.fields[i]!.label} (copy)` }; const next = [...f.fields]; next.splice(i + 1, 0, c); setFields(next); setSel(c.id) }

  const onDragOverItem = (e: DragEvent, i: number) => {
    e.preventDefault()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDrop(e.clientY < r.top + r.height / 2 ? i : i + 1)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const at = drop ?? f.fields.length
    const type = e.dataTransfer.getData('application/x-hr-new') as HrFieldType
    const from = e.dataTransfer.getData('application/x-hr-move')
    if (type) insert(type, at)
    else if (from !== '') move(Number(from), at)
    setDrop(null)
  }

  const save = async (publish = false) => {
    setBusy(true)
    const sid = await run(() => saveHrForm(me, f, id), publish ? undefined : form && form.status !== 'DRAFT' ? 'Saved — employees see the new version' : 'Draft saved')
    if (typeof sid === 'string' && publish) {
      const n = assignees({ assign: f.assign }, db.users).length
      if (await confirm('Publish this form?', `${n} employee${n === 1 ? '' : 's'} will see it in My Forms and get a notification.`)) await run(() => setHrFormStatus(me, sid, 'PUBLISHED'), 'Published — employees have been notified')
    }
    setBusy(false)
    if (typeof sid === 'string' && !id) onSaved(sid)
  }
  const close = async () => { if (!dirty || await confirm('Leave without saving?', 'Your changes to this form will be lost.')) onClose() }

  return (
    <div>
      {/* top bar */}
      <div className="sticky top-14 z-20 -mx-3 mb-4 flex flex-wrap items-center gap-2 border-b border-line bg-bg/95 px-3 py-2.5 backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6">
        <Button variant="ghost" size="sm" icon={Undo2} onClick={close}>Forms</Button>
        <input value={f.title} disabled={readOnly} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Form name, e.g. Bank details update" aria-label="Form name"
          className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-lg font-extrabold outline-none hover:border-line focus:border-brand" />
        {form && <Badge tone={FORM_TONE[form.status]} dot>{FORM_LABEL[form.status]} · v{form.version}</Badge>}
        {dirty && <span className="text-xs font-semibold text-warn">Unsaved changes</span>}
        <div className="flex rounded-lg border border-line p-0.5 text-xs font-semibold">
          <button onClick={() => setMode('build')} className={cx('rounded-md px-2.5 py-1', mode === 'build' ? 'bg-brand-soft text-brand-ink' : 'text-mute')}><Pencil className="mr-1 inline size-3.5" />Build</button>
          <button onClick={() => setMode('preview')} className={cx('rounded-md px-2.5 py-1', mode === 'preview' ? 'bg-brand-soft text-brand-ink' : 'text-mute')}><Eye className="mr-1 inline size-3.5" />Live preview</button>
        </div>
        {!readOnly && <Button variant="outline" icon={Save} loading={busy} disabled={!dirty && !!id} onClick={() => save(false)}>{form && form.status !== 'DRAFT' ? 'Save changes' : 'Save draft'}</Button>}
        {!readOnly && (!form || form.status === 'DRAFT' || form.status === 'UNPUBLISHED') && <Button icon={Send} loading={busy} disabled={problems.length > 0} title={problems[0]} onClick={() => save(true)}>Publish</Button>}
      </div>
      {form && form.status !== 'DRAFT' && !readOnly && <p className="mb-3 rounded-xl bg-info-soft px-3 py-2 text-xs text-info">This form is {FORM_LABEL[form.status].toLowerCase()}. Changing its fields saves a new version (v{form.version + 1}); submissions already made keep the fields they were filled with.</p>}
      {readOnly && <p className="mb-3 rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">This form is archived — restore it from the Forms list (⋯ → Restore) to change it, or duplicate it.</p>}

      <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)_340px]">
        {/* palette */}
        <Card className="h-fit p-3 lg:sticky lg:top-32">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-mute">Fields · drag or click</p>
          {GROUPS.map((g) => (
            <div key={g} className="mb-2">
              <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wider text-mute/80">{g}</p>
              <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
                {FIELD_TYPES.filter((t) => t[2] === g).map(([type, label]) => (
                  <button key={type} disabled={readOnly} draggable={!readOnly} onDragStart={(e) => { e.dataTransfer.setData('application/x-hr-new', type); e.dataTransfer.effectAllowed = 'copy' }}
                    onClick={() => insert(type)} className="flex items-center gap-2 rounded-lg border border-line bg-card px-2.5 py-1.5 text-left text-xs font-semibold transition hover:border-brand hover:bg-brand-soft/50 disabled:opacity-50">
                    <GripVertical className="size-3.5 shrink-0 text-mute" />{label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>

        {/* canvas / live preview */}
        <Card className="min-h-[420px] p-4">
          {mode === 'preview' ? (
            <>
              <FormHead form={{ ...f, deadline: f.deadline || undefined }} />
              <FormFill fields={f.fields.map((x) => x)} values={vals} onChange={(fid, v) => setVals({ ...vals, [fid]: v })} users={db.users} />
              {f.fields.length > 0 && <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">{f.allowDraft && <Button variant="outline" disabled>Save draft</Button>}<Button disabled>Submit</Button></div>}
            </>
          ) : (
            <div onDragOver={(e) => { e.preventDefault(); if (!f.fields.length) setDrop(0) }} onDrop={readOnly ? undefined : onDrop} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null) }}
              className="min-h-[380px]">
              {!f.fields.length && (
                <div className={cx('grid h-[360px] place-items-center rounded-2xl border-2 border-dashed text-center', drop === 0 ? 'border-brand bg-brand-soft/40' : 'border-line')}>
                  <div><ListChecks className="mx-auto mb-2 size-8 text-mute" /><p className="font-semibold">Drag fields here</p><p className="text-sm text-mute">or click a field type on the left</p></div>
                </div>
              )}
              <ul className="grid gap-2">
                {f.fields.map((x, i) => (
                  <li key={x.id} onDragOver={(e) => onDragOverItem(e, i)}>
                    {drop === i && <div className="mb-2 h-1 rounded-full bg-brand" />}
                    <div draggable={!readOnly} onDragStart={(e) => { e.dataTransfer.setData('application/x-hr-move', String(i)); e.dataTransfer.effectAllowed = 'move' }}
                      onClick={() => { setSel(x.id); setPanel('field') }}
                      className={cx('group flex cursor-pointer items-start gap-2 rounded-xl border bg-card p-3 transition', sel === x.id ? 'border-brand ring-3 ring-brand/12' : 'border-line hover:border-mute/40')}>
                      <GripVertical className="mt-1 size-4 shrink-0 cursor-grab text-mute" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">{x.label || <span className="text-mute">Untitled field</span>}{x.required && <span className="text-bad">*</span>}<Badge tone="gray">{TYPE_LABEL[x.type]}</Badge></p>
                        {(x.help || x.placeholder) && <p className="mt-0.5 truncate text-xs text-mute">{x.help || x.placeholder}</p>}
                        {CHOICE_TYPES.includes(x.type) && <p className="mt-1 truncate text-xs text-mute">{(x.options ?? []).join(' · ')}</p>}
                      </div>
                      {!readOnly && (
                        <span className="flex shrink-0 items-center gap-0.5 opacity-60 transition group-hover:opacity-100">
                          <IconBtn label="Move up" onClick={() => step(i, -1)} disabled={i === 0}><ArrowUp className="size-4" /></IconBtn>
                          <IconBtn label="Move down" onClick={() => step(i, 1)} disabled={i === f.fields.length - 1}><ArrowDown className="size-4" /></IconBtn>
                          <IconBtn label="Duplicate field" onClick={() => dup(x.id)}><Copy className="size-4" /></IconBtn>
                          <IconBtn label="Delete field" danger onClick={() => remove(x.id)}><Trash2 className="size-4" /></IconBtn>
                        </span>
                      )}
                    </div>
                    {drop === i + 1 && i === f.fields.length - 1 && <div className="mt-2 h-1 rounded-full bg-brand" />}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* configuration */}
        <Card className="h-fit lg:sticky lg:top-32">
          <div className="flex border-b border-line text-xs font-semibold">
            {([['field', 'Field', Settings2], ['settings', 'Form', ClipboardList], ['assign', `Assign (${count})`, Users]] as const).map(([k, l, Icon]) => (
              <button key={k} onClick={() => setPanel(k)} className={cx('flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5', panel === k ? 'border-brand text-brand-ink' : 'border-transparent text-mute hover:text-ink')}><Icon className="size-3.5" />{l}</button>
            ))}
          </div>
          <div className="max-h-[calc(100dvh-14rem)] overflow-y-auto p-4">
            <fieldset disabled={readOnly} className="grid gap-3">
              {panel === 'field' && (selected ? <FieldConfig f={selected} onChange={(p) => patch(selected.id, p)} /> : <p className="py-6 text-center text-sm text-mute">Select a field to set it up.</p>)}
              {panel === 'settings' && <FormSettings f={f} setF={setF} />}
              {panel === 'assign' && <AssignPanel f={f} setF={setF} count={count} />}
            </fieldset>
          </div>
          {problems.length > 0 && (
            <div className="border-t border-line px-4 py-3 text-xs">
              <p className="mb-1 font-bold text-warn">Before publishing</p>
              <ul className="list-disc space-y-0.5 pl-4 text-mute">{problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
        </Card>
      </div>
      {confirmNode}
    </div>
  )
}
/** an on / off switch with its label beside it */
const Switch = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2"><span className="text-sm font-semibold">{label}</span><Toggle checked={checked} onChange={onChange} label={label} /></div>
)
const IconBtn = ({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) => (
  <button type="button" aria-label={label} title={label} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick() }}
    className={cx('grid size-7 place-items-center rounded-md text-mute disabled:opacity-30', danger ? 'hover:bg-bad-soft hover:text-bad' : 'hover:bg-card2 hover:text-ink')}>{children}</button>
)

function FieldConfig({ f, onChange }: { f: HrFormField; onChange: (p: Partial<HrFormField>) => void }) {
  const numOrUndef = (v: string) => (v === '' ? undefined : Number(v))
  const textLike = ['text', 'textarea', 'email', 'phone'].includes(f.type)
  return (
    <>
      <Input label="Field name" required value={f.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="e.g. Bank account number" />
      <Select label="Field type" value={f.type} onChange={(e) => {
        const type = e.target.value as HrFieldType
        onChange({ type, ...(CHOICE_TYPES.includes(type) && !f.options?.length ? { options: ['Option 1', 'Option 2'] } : {}), ...(FILE_TYPES.includes(type) && !f.maxSizeMb ? { maxSizeMb: 10 } : {}), ...(type === 'files' && !f.maxFiles ? { maxFiles: 5 } : {}) })
      }}>
        {FIELD_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}
      </Select>
      {!FILE_TYPES.includes(f.type) && !['checkbox', 'radio', 'multiselect', 'date'].includes(f.type) && (
        <Input label="Placeholder" value={f.placeholder ?? ''} onChange={(e) => onChange({ placeholder: e.target.value })} placeholder="Shown inside the empty box" />
      )}
      <Textarea label="Help text" value={f.help ?? ''} onChange={(e) => onChange({ help: e.target.value })} placeholder="A short hint under the field" rows={2} />
      <Switch checked={f.required} onChange={(v) => onChange({ required: v })} label="Required" />

      {CHOICE_TYPES.includes(f.type) && <OptionsEditor options={f.options ?? []} onChange={(options) => onChange({ options })} />}

      {(textLike || MULTI_TYPES.includes(f.type)) && (
        <div className="grid grid-cols-2 gap-2">
          <Input label={MULTI_TYPES.includes(f.type) ? 'Min choices' : 'Min length'} type="number" min={0} value={f.minLength ?? ''} onChange={(e) => onChange({ minLength: numOrUndef(e.target.value) })} />
          <Input label={MULTI_TYPES.includes(f.type) ? 'Max choices' : 'Max length'} type="number" min={0} value={f.maxLength ?? ''} onChange={(e) => onChange({ maxLength: numOrUndef(e.target.value) })} />
        </div>
      )}
      {f.type === 'number' && (
        <div className="grid grid-cols-2 gap-2">
          <Input label="Minimum value" type="number" value={f.min ?? ''} onChange={(e) => onChange({ min: numOrUndef(e.target.value) })} />
          <Input label="Maximum value" type="number" value={f.max ?? ''} onChange={(e) => onChange({ max: numOrUndef(e.target.value) })} />
        </div>
      )}
      {(f.type === 'text' || f.type === 'textarea') && (
        <div className="rounded-xl border border-line p-3">
          <p className="mb-2 text-xs font-bold">Validation</p>
          <Select aria-label="Validation preset" value={PATTERNS.find((p) => p[1] === f.pattern)?.[1] ?? (f.pattern ? '__custom' : '')}
            onChange={(e) => { const p = PATTERNS.find((x) => x[1] === e.target.value); onChange(e.target.value === '' ? { pattern: undefined, patternMessage: undefined } : p ? { pattern: p[1], patternMessage: p[2] } : { pattern: f.pattern || '.+' }) }}>
            <option value="">Any text</option>{PATTERNS.map(([l, p]) => <option key={p} value={p}>{l}</option>)}<option value="__custom">Custom pattern…</option>
          </Select>
          {f.pattern != null && (
            <div className="mt-2 grid gap-2">
              <Input label="Pattern (regular expression)" value={f.pattern} onChange={(e) => onChange({ pattern: e.target.value })} className="font-mono" />
              <Input label="Message when it doesn't match" value={f.patternMessage ?? ''} onChange={(e) => onChange({ patternMessage: e.target.value })} />
            </div>
          )}
        </div>
      )}
      {f.type === 'email' && <p className="text-xs text-mute">Checked as an email address.</p>}
      {f.type === 'phone' && <p className="text-xs text-mute">Checked as a phone number (10–15 digits, + allowed).</p>}
      {f.type === 'employee' && <p className="text-xs text-mute">The employee picks someone from the CRM's employee list (active people).</p>}

      {FILE_TYPES.includes(f.type) && (
        <div className="rounded-xl border border-line p-3">
          <p className="mb-2 text-xs font-bold">Uploads</p>
          {f.type !== 'image' ? (
            <div className="mb-2 grid gap-1.5">
              <p className="text-xs text-mute">Allowed formats (none ticked = all)</p>
              {FORMATS.map(([k, l]) => <Checkbox key={k} label={l} checked={(f.accept ?? []).includes(k)} onChange={(v) => onChange({ accept: v ? [...(f.accept ?? []), k] : (f.accept ?? []).filter((x) => x !== k) })} />)}
            </div>
          ) : <p className="mb-2 text-xs text-mute">Images only: JPG, PNG, WebP.</p>}
          <div className="grid grid-cols-2 gap-2">
            <Input label="Max size (MB)" type="number" min={1} max={MAX_FILE_MB} value={f.maxSizeMb ?? 10} onChange={(e) => onChange({ maxSizeMb: Math.min(MAX_FILE_MB, Math.max(1, Number(e.target.value) || 1)) })} />
            {f.type === 'files' && <Input label="Max files" type="number" min={1} max={MAX_FILES} value={f.maxFiles ?? 5} onChange={(e) => onChange({ maxFiles: Math.min(MAX_FILES, Math.max(1, Number(e.target.value) || 1)) })} />}
          </div>
        </div>
      )}
    </>
  )
}

function OptionsEditor({ options, onChange }: { options: string[]; onChange: (o: string[]) => void }) {
  const [bulk, setBulk] = useState(false)
  const [text, setText] = useState('')
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between"><p className="text-xs font-bold">Options</p>
        <button type="button" onClick={() => { setText(options.join('\n')); setBulk(!bulk) }} className="text-[11px] font-semibold text-brand hover:underline">{bulk ? 'One by one' : 'Paste a list'}</button></div>
      {bulk ? (
        <>
          <Textarea aria-label="Options, one per line" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="One option per line" />
          <Button size="sm" className="mt-2" onClick={() => { onChange(text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)); setBulk(false) }}>Use these</Button>
        </>
      ) : (
        <ul className="grid gap-1.5">
          {options.map((o, i) => (
            <li key={i} className="flex items-center gap-1">
              <input value={o} onChange={(e) => onChange(options.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Option ${i + 1}`}
                className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-card px-2 text-sm outline-none focus:border-brand" />
              <IconBtn label="Move option up" disabled={i === 0} onClick={() => { const n = [...options]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; onChange(n) }}><ArrowUp className="size-3.5" /></IconBtn>
              <IconBtn label="Remove option" danger onClick={() => onChange(options.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></IconBtn>
            </li>
          ))}
          <li><Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange([...options, `Option ${options.length + 1}`])}>Add option</Button></li>
        </ul>
      )}
    </div>
  )
}

function FormSettings({ f, setF }: { f: HrFormInput; setF: (x: HrFormInput) => void }) {
  const db = useDb()
  const hr = hrManagers(db)
  return (
    <>
      <Input label="Form name" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <Textarea label="Description / instructions" rows={3} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Shown at the top of the form" />
      <Input label="Submission deadline" type="date" min={today()} value={f.deadline ?? ''} onChange={(e) => setF({ ...f, deadline: e.target.value })} hint="Reminders go out 2 days before; after it only corrections can be sent" />
      <Switch checked={f.allowDraft} onChange={(v) => setF({ ...f, allowDraft: v })} label="Employees can save a draft and come back" />
      <div>
        <p className="mb-1 text-sm font-semibold">Assigned HR (reviewers)</p>
        <p className="mb-2 text-xs text-mute">They are notified of each submission. None ticked = everyone in HR.</p>
        <div className="grid max-h-44 gap-1 overflow-y-auto rounded-xl border border-line p-2">
          {hr.map((u) => <Checkbox key={u.id} label={u.name} checked={f.reviewerIds.includes(u.id)} onChange={(v) => setF({ ...f, reviewerIds: v ? [...f.reviewerIds, u.id] : f.reviewerIds.filter((x) => x !== u.id) })} />)}
        </div>
      </div>
    </>
  )
}

function AssignPanel({ f, setF, count }: { f: HrFormInput; setF: (x: HrFormInput) => void; count: number }) {
  const db = useDb()
  const [q, setQ] = useState('')
  const a = f.assign
  const set = (p: Partial<HrFormInput['assign']>) => setF({ ...f, assign: { ...a, ...p } })
  const active = db.users.filter((u) => u.active && !u.deletedAt)
  const depts = [...new Set(active.map((u) => u.department).filter(Boolean))].sort()
  const toggle = <T,>(list: T[] | undefined, v: T, on: boolean) => (on ? [...(list ?? []), v] : (list ?? []).filter((x) => x !== v))
  const people = active.filter((u) => !q.trim() || `${u.name} ${u.username} ${u.department}`.toLowerCase().includes(q.trim().toLowerCase())).sort((x, y) => x.name.localeCompare(y.name))
  return (
    <>
      <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm font-semibold text-brand-ink"><Users className="mr-1.5 inline size-4" />{count} employee{count === 1 ? '' : 's'} will get this form</p>
      <Switch checked={!!a.everyone} onChange={(v) => set({ everyone: v })} label="Everyone in the company" />
      {!a.everyone && (
        <>
          <Chips title="Departments" items={depts.map((d) => [d, d])} on={a.departments ?? []} onToggle={(v, on) => set({ departments: toggle(a.departments, v, on) })} />
          <Chips title="Branches" items={branchList(db).map((b) => [b.id, b.name])} on={a.branchIds ?? []} onToggle={(v, on) => set({ branchIds: toggle(a.branchIds, v, on) })} />
          <Chips title="Groups (roles)" items={ROLES.map((r) => [r.id, r.label])} on={a.roles ?? []} onToggle={(v, on) => set({ roles: toggle(a.roles, v as Role, on) })} />
          <div>
            <p className="mb-1 text-sm font-semibold">Specific employees {a.userIds?.length ? <span className="text-mute">({a.userIds.length})</span> : null}</p>
            <SearchBox value={q} onChange={setQ} placeholder="Search name or employee ID…" />
            <div className="mt-2 grid max-h-56 gap-0.5 overflow-y-auto rounded-xl border border-line p-1.5">
              {people.slice(0, 300).map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-card2">
                  <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={!!a.userIds?.includes(u.id)} onChange={(e) => set({ userIds: toggle(a.userIds, u.id, e.target.checked) })} />
                  <span className="min-w-0 flex-1 truncate">{u.name} <span className="text-xs text-mute">· {u.username}</span></span>
                </label>
              ))}
            </div>
          </div>
          <p className="text-xs text-mute">Anyone matching any of these gets the form. People who join a chosen department or branch later get it too.</p>
        </>
      )}
    </>
  )
}
function Chips({ title, items, on, onToggle }: { title: string; items: [string, string][]; on: string[]; onToggle: (v: string, on: boolean) => void }) {
  if (!items.length) return null
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map(([v, l]) => { const sel = on.includes(v); return <button key={v} type="button" onClick={() => onToggle(v, !sel)} className={cx('rounded-full border px-2.5 py-1 text-xs font-semibold transition', sel ? 'border-brand bg-brand text-white' : 'border-line hover:bg-card2')}>{sel && <Check className="mr-1 inline size-3" />}{l}</button> })}
      </div>
    </div>
  )
}

// ================================================================== responses
const STATUS_FILTERS: [string, string][] = [
  ['', 'All statuses'], ['OPEN', 'Not sent yet (pending / in progress)'], ['DONE', 'Sent'], ['OVERDUE', 'Overdue'],
  ...(Object.entries(STATUS_LABEL) as [string, string][]),
]
function ResponsesTab() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [params, setParams] = useSearchParams()
  const { forms, rows } = useHrData()
  const p = (k: string) => params.get(k) ?? ''
  const setP = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); n.set('tab', 'responses'); setParams(n, { replace: true }) }
  const [mineOnly, setMineOnly] = useState(false)
  const filters = { q: p('q'), formId: p('form'), department: p('dept'), branchId: p('branch'), status: p('status'), from: p('from'), to: p('to'), sort: (p('sort') || 'new') as 'new' | 'old' }
  const list = useMemo(() => filterRows(rows, filters).filter((r) => !mineOnly || reviewersOf(getDb(), r.form).includes(me.id)), [rows, JSON.stringify(filters), mineOnly, me.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const { slice, pager } = usePaged(list, 50, [JSON.stringify(filters), mineOnly])
  const depts = [...new Set(db.users.filter((u) => u.active).map((u) => u.department).filter(Boolean))].sort()
  const open = params.get('open')
  const current = open ? rows.find((r) => r.sub?.id === open || r.key === open) : undefined
  const any = Object.entries(filters).some(([k, v]) => v && !(k === 'sort' && v === 'new'))
  return (
    <>
      <Card className="mb-4 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <div className="relative sm:col-span-2"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mute" />
            <input value={filters.q} onChange={(e) => setP('q', e.target.value)} placeholder="Employee name or ID…" aria-label="Search employee name or ID" className="h-9 w-full rounded-lg border border-line bg-card pl-9 pr-3 text-sm outline-none focus:border-brand" /></div>
          <Select aria-label="Form" value={filters.formId} onChange={(e) => setP('form', e.target.value)}><option value="">All forms</option>{forms.filter((f) => f.status !== 'DRAFT').map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</Select>
          <Select aria-label="Department" value={filters.department} onChange={(e) => setP('dept', e.target.value)}><option value="">All departments</option>{depts.map((d) => <option key={d}>{d}</option>)}</Select>
          <Select aria-label="Branch" value={filters.branchId} onChange={(e) => setP('branch', e.target.value)}><option value="">All branches</option>{branchList(db).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          <Select aria-label="Status" value={filters.status} onChange={(e) => setP('status', e.target.value)}>{STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          <Input aria-label="Submitted from" type="date" value={filters.from} onChange={(e) => setP('from', e.target.value)} title="Submitted from" />
          <Input aria-label="Submitted to" type="date" value={filters.to} onChange={(e) => setP('to', e.target.value)} title="Submitted to" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select aria-label="Sort" value={filters.sort} onChange={(e) => setP('sort', e.target.value)} className="!h-8 !w-auto text-xs"><option value="new">Newest first</option><option value="old">Oldest first</option></Select>
          <Checkbox label="Assigned to me" checked={mineOnly} onChange={setMineOnly} />
          {any && <Button size="sm" variant="ghost" onClick={() => setParams({ tab: 'responses' })}>Clear filters</Button>}
          <span className="ml-auto text-xs text-mute">{list.length.toLocaleString('en-IN')} result{list.length === 1 ? '' : 's'}</span>
          <Button size="sm" variant="outline" icon={FileSpreadsheet} disabled={!list.length} onClick={() => run(() => exportResponsesXlsx(list), 'Excel file downloaded')}>Export Excel</Button>
          <Button size="sm" variant="outline" icon={FileDown} disabled={!list.length} onClick={() => run(() => exportResponsesPdf(list), 'PDF downloaded')}>Export PDF</Button>
        </div>
      </Card>
      <Card className="overflow-hidden">
        {!list.length ? <EmptyState icon={Inbox} title="No responses" text={rows.length ? 'Nothing matches these filters.' : 'Publish a form — employees’ submissions appear here.'} /> : (
          <>
            <Table>
              <thead><tr><Th>Form</Th><Th>Employee</Th><Th>Department</Th><Th>Branch</Th><Th>Submitted</Th><Th>Status</Th><Th>Assigned HR</Th><Th className="text-right">Files</Th><Th /></tr></thead>
              <tbody>
                {slice.map((r) => (
                  <tr key={r.key} className="cursor-pointer hover:bg-card2/60" onClick={() => setP('open', r.sub?.id ?? r.key)}>
                    <Td><span className="block max-w-[220px] truncate font-semibold">{r.form.title}</span><span className="text-[11px] text-mute">v{r.sub?.formVersion ?? r.form.version}{r.form.deadline ? ` · due ${fmtDate(r.form.deadline)}` : ''}</span></Td>
                    <Td><span className="flex items-center gap-2"><Avatar name={r.user.name} photo={r.user.photo} size={28} /><span className="min-w-0"><span className="block truncate font-semibold">{r.user.name}</span><span className="block text-[11px] text-mute">{r.user.username}</span></span></span></Td>
                    <Td className="text-xs">{r.user.department || '—'}</Td>
                    <Td className="text-xs">{r.user.branchId ? branchName(db, r.user.branchId) : '—'}</Td>
                    <Td className="whitespace-nowrap text-xs">{r.sub?.submittedAt ? fmtDateTime(r.sub.submittedAt) : '—'}</Td>
                    <Td><Badge tone={STATUS_TONE[r.status]} dot>{STATUS_LABEL[r.status]}</Badge>{r.overdue && <span className="ml-1 text-[11px] font-semibold text-bad">overdue</span>}</Td>
                    <Td className="max-w-[160px] truncate text-xs">{reviewersOf(db, r.form).map((id) => db.users.find((u) => u.id === id)?.name.split(' ')[0]).filter(Boolean).join(', ') || '—'}</Td>
                    <Td className="text-right tabular-nums">{r.files || '—'}</Td>
                    <Td className="text-right">
                      {!SENT.includes(r.status as HrSubStatus) && r.form.status === 'PUBLISHED'
                        ? <Button size="sm" variant="ghost" icon={BellRing} onClick={(e) => { e.stopPropagation(); run(() => remindHrForm(me, r.form.id, [r.user.id]), `Reminder sent to ${r.user.name}`) }}>Remind</Button>
                        : <Button size="sm" variant="ghost" icon={Eye}>Open</Button>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {pager}
          </>
        )}
      </Card>
      {current && <ResponseDrawer row={current} onClose={() => setP('open', '')} />}
    </>
  )
}

function ResponseDrawer({ row: r, onClose }: { row: ResponseRow; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [ask, setAsk] = useState<null | 'REJECTED' | 'CHANGES_REQUESTED'>(null)
  const [why, setWhy] = useState('')
  const [note, setNote] = useState('')
  const s = r.sub
  const notes = s ? (db.hrFormNotes ?? []).filter((n) => n.submissionId === s.id).sort((a, b) => a.at.localeCompare(b.at)) : []
  const name = (id?: string) => db.users.find((u) => u.id === id)?.name ?? '—'
  const go = (to: HrSubStatus, text: string) => s && run(() => reviewHrSubmission(me, s.id, to, why), text)
  const can = (to: HrSubStatus) => !!s && canStep(s.status, to, true)
  return (
    <Drawer open onClose={onClose} width="max-w-3xl" title={r.form.title}
      subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[r.status]} dot>{STATUS_LABEL[r.status]}</Badge>{r.overdue && <Badge tone="red">Overdue</Badge>}<span>{r.user.name} · {r.user.username}</span></span>}
      footer={s ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" icon={FileDown} onClick={() => run(() => exportResponsesPdf([r]), 'PDF downloaded')}>Download PDF</Button>
          <span className="flex-1" />
          {can('UNDER_REVIEW') && <Button variant="outline" icon={Eye} onClick={() => go('UNDER_REVIEW', 'Marked under review')}>Under review</Button>}
          {can('CHANGES_REQUESTED') && <Button variant="outline" icon={MessageSquarePlus} onClick={() => { setWhy(''); setAsk('CHANGES_REQUESTED') }}>Request correction</Button>}
          {can('REJECTED') && <Button variant="danger" icon={XCircle} onClick={() => { setWhy(''); setAsk('REJECTED') }}>Reject</Button>}
          {can('APPROVED') && <Button variant="success" icon={CheckCircle2} onClick={() => go('APPROVED', 'Approved — the employee has been notified')}>Approve</Button>}
        </div>
      ) : r.form.status === 'PUBLISHED' ? <Button icon={BellRing} onClick={() => run(() => remindHrForm(me, r.form.id, [r.user.id]), `Reminder sent to ${r.user.name}`)}>Remind {r.user.name.split(' ')[0]}</Button> : undefined}>
      <div className="grid gap-4">
        <div className="grid gap-2 rounded-xl border border-line p-3 text-sm sm:grid-cols-2">
          {([['Employee', `${r.user.name} (${r.user.username})`], ['Department', r.user.department || '—'], ['Branch', r.user.branchId ? branchName(db, r.user.branchId) : '—'], ['Designation', r.user.designation || '—'],
            ['Submitted', s?.submittedAt ? fmtDateTime(s.submittedAt) : '—'], ['Form version', `v${s?.formVersion ?? r.form.version}`], ['Assigned HR', reviewersOf(db, r.form).map((id) => name(id)).join(', ') || '—'],
            ['Reviewed', s?.reviewedBy ? `${name(s.reviewedBy)} · ${fmtDateTime(s.reviewedAt)}` : '—']] as [string, string][]).map(([k, v]) => (
            <p key={k} className="min-w-0"><span className="block text-[11px] text-mute">{k}</span><span className="block truncate font-semibold">{v}</span></p>
          ))}
        </div>
        {s?.reviewNote && <p className={cx('rounded-xl px-3 py-2 text-sm', s.status === 'REJECTED' ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn')}><b>Note to the employee:</b> {s.reviewNote}</p>}
        {!s ? <EmptyState icon={AlarmClock} title={r.status === 'PENDING' ? 'Not started yet' : 'Nothing sent yet'} text={r.form.deadline ? `Due ${fmtDate(r.form.deadline)}.` : 'They haven’t opened this form yet.'} />
          : s.status === 'IN_PROGRESS' ? <EmptyState icon={Pencil} title="Being filled" text="The employee saved a draft — the answers show here once they submit." />
            : <Card className="px-4"><AnswerView fields={s.fields} answers={s.answers} users={db.users} /></Card>}
        {s && (
          <Card>
            <CardHeader title="Internal comments" subtitle="HR only — never shown to the employee" icon={MessageSquarePlus} />
            <ul className="divide-y divide-line/70">
              {notes.map((n) => <li key={n.id} className="px-4 py-2.5 text-sm"><p className="whitespace-pre-wrap">{n.text}</p><p className="mt-0.5 text-[11px] text-mute">{name(n.by)} · {fmtDateTime(n.at)}</p></li>)}
              {!notes.length && <li className="px-4 py-3 text-sm text-mute">No comments yet.</li>}
            </ul>
            <div className="flex gap-2 border-t border-line p-3">
              <Textarea aria-label="Internal comment" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a comment for HR…" className="flex-1" />
              <Button icon={Send} disabled={!note.trim()} onClick={async () => { if (await run(() => addHrNote(me, s.id, note), 'Comment added')) setNote('') }}>Add</Button>
            </div>
          </Card>
        )}
        {s && s.history.length > 0 && (
          <Card>
            <CardHeader title="History" icon={ClipboardList} />
            <ol className="space-y-2 px-4 pb-4">
              {[...s.history].reverse().map((h, i) => <li key={i} className="text-sm"><b>{h.action}</b> <span className="text-mute">· {name(h.by)} · {fmtDateTime(h.at)}</span>{h.note && <p className="text-xs text-mute">“{h.note}”</p>}</li>)}
            </ol>
          </Card>
        )}
      </div>
      <Modal open={!!ask} onClose={() => setAsk(null)} size="sm" title={ask === 'REJECTED' ? 'Reject this submission' : 'Ask for a correction'}
        footer={<><Button variant="outline" onClick={() => setAsk(null)}>Cancel</Button><Button variant={ask === 'REJECTED' ? 'danger' : 'primary'} disabled={why.trim().length < 3}
          onClick={async () => { if (await go(ask!, ask === 'REJECTED' ? 'Rejected — the employee has been notified' : 'Sent back for correction — the employee has been notified')) setAsk(null) }}>{ask === 'REJECTED' ? 'Reject' : 'Send back'}</Button></>}>
        <Textarea label={ask === 'REJECTED' ? 'Reason (the employee sees it)' : 'What should be corrected? (the employee sees it)'} required rows={4} value={why} onChange={(e) => setWhy(e.target.value)} />
        {ask === 'CHANGES_REQUESTED' && <p className="mt-2 text-xs text-mute">The form opens again for {r.user.name.split(' ')[0]} (even after the deadline) until they send it back.</p>}
      </Modal>
    </Drawer>
  )
}

// ================================================================== analytics
function AnalyticsTab() {
  const db = useDb()
  const { stats, forms, rows } = useHrData()
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
  const Bars = ({ data, label }: { data: { key: string; assigned: number; sent: number; approved: number }[]; label: (k: string) => string }) => (
    <ul className="space-y-3 p-4">
      {data.map((g) => (
        <li key={g.key}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs"><span className="truncate font-semibold">{label(g.key)}</span><span className="tabular-nums text-mute">{g.sent}/{g.assigned} sent · {g.approved} approved · <b className="text-ink">{pct(g.sent, g.assigned)}%</b></span></div>
          <div className="relative h-3 overflow-hidden rounded-full bg-card2" role="img" aria-label={`${label(g.key)}: ${pct(g.sent, g.assigned)}% sent, ${pct(g.approved, g.assigned)}% approved`}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-violet-400/70" style={{ width: `${pct(g.sent, g.assigned)}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-ok" style={{ width: `${pct(g.approved, g.assigned)}%` }} />
          </div>
        </li>
      ))}
      {!data.length && <li className="py-6 text-center text-sm text-mute">No assigned forms yet.</li>}
    </ul>
  )
  const legend = <span className="flex items-center gap-3 text-[11px] text-mute"><span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-full bg-ok" />approved</span><span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-full bg-violet-400/70" />sent</span></span>
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader title="Department-wise progress" icon={Users} action={legend} /><Bars data={stats.byDepartment} label={(k) => k} /></Card>
      <Card><CardHeader title="Branch-wise progress" icon={BarChart3} action={legend} /><Bars data={stats.byBranch} label={(k) => (k === '—' ? 'No branch set' : branchName(db, k))} /></Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Form-wise progress" icon={FileSignature} />
        <Table>
          <thead><tr><Th>Form</Th><Th>Status</Th><Th className="text-right">Assigned</Th><Th className="text-right">Pending</Th><Th className="text-right">Sent</Th><Th className="text-right">Approved</Th><Th className="text-right">Rejected</Th><Th>Deadline</Th></tr></thead>
          <tbody>
            {forms.filter((f) => f.status !== 'DRAFT').map((f) => {
              const m = rows.filter((r) => r.form.id === f.id)
              const sent = m.filter((r) => SENT.includes(r.status as HrSubStatus)).length
              return (
                <tr key={f.id}>
                  <Td className="font-semibold">{f.title}</Td><Td><Badge tone={FORM_TONE[f.status]} dot>{FORM_LABEL[f.status]}</Badge></Td>
                  <Td className="text-right tabular-nums">{m.length}</Td><Td className="text-right tabular-nums">{m.length - sent}</Td><Td className="text-right tabular-nums">{sent}</Td>
                  <Td className="text-right tabular-nums">{m.filter((r) => r.status === 'APPROVED').length}</Td><Td className="text-right tabular-nums">{m.filter((r) => r.status === 'REJECTED').length}</Td>
                  <Td className="text-xs">{f.deadline ? fmtDate(f.deadline) : '—'}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </Card>
      <p className="text-xs text-mute lg:col-span-2">Employees are counted by their department and branch in Employee Details. {roleLabel('hr')} sees every response; IT Support can give the HR Form Builder to others in Access Control (permission “HR Form Builder”).</p>
    </div>
  )
}
