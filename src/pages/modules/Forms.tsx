import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Archive, ArrowDown, ArrowUp, Copy, Eye, FilePlus2, FileSignature, Link2, Mail, MessageCircle, Pencil, Plus, RefreshCw, Send, Share2, Trash2, XCircle } from 'lucide-react'
import type { DocForm, FormField, FormSubmission } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { canEmailClient, logClientEmail, userName, visibleBookings } from '../../lib/actions'
import { attachSubmissionFiles, formLink, newField, renewFormLink, reviewSubmission, saveForm, setFormStatus, type FormInput } from '../../lib/forms'
import { FIELD_TYPES, formOpen, formProblems } from '../../../supabase/form-rules.mjs'
import { istToday, workflowSettings } from '../../../supabase/workflow-rules.mjs'
import { sendFormWhatsapp } from '../../lib/share'
import { sendClientEmailClient } from '../../lib/emailClient'
import { whatsappLink } from '../../lib/welcome'
import { DOC_TYPES, RESUME_TYPES } from '../../lib/files'
import { CLOUD } from '../../lib/cloud'
import { fmtDate, fmtDateTime, isEmail, isPhone } from '../../lib/format'
import { Badge, Button, Card, Checkbox, cx, EmptyState, Input, Modal, PageHeader, SearchBox, Select, Table, Tabs, Td, Textarea, Th, useConfirm, useRun, useToast } from '../../components/ui'
import { FileField, FileLink } from '../../components/FileField'
import { FormRenderer, type FormFiles, type FormValues } from '../../components/FormRenderer'

const STATUS = { DRAFT: { label: 'Draft', tone: 'gray' }, PUBLISHED: { label: 'Published', tone: 'green' }, CLOSED: { label: 'Closed', tone: 'amber' }, ARCHIVED: { label: 'Archived', tone: 'gray' } } as const
const SUB = { NEW: { label: 'New', tone: 'blue' }, REVIEWED: { label: 'Reviewed', tone: 'violet' }, ACCEPTED: { label: 'Accepted', tone: 'green' }, REJECTED: { label: 'Rejected', tone: 'red' } } as const
const blank: FormInput = { name: '', description: '', instructions: '', kind: 'ONLINE', fields: [], verify: 'NONE' }

/** Document Form Builder: forms and documents sent to clients by secure link, and the responses that come back. */
export default function Forms() {
  const db = useDb()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'responses' ? 'responses' : 'forms'
  const forms = db.docForms ?? []
  const subs = db.formSubmissions ?? []
  return (
    <div>
      <PageHeader title="Document Form Builder" subtitle="Build a form or share a document, send the secure link by email or WhatsApp, and review what clients send back" icon={FileSignature}
        actions={<Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ id: 'forms', label: 'Forms', count: forms.filter((f) => f.status !== 'ARCHIVED').length }, { id: 'responses', label: 'Responses', count: subs.filter((s) => s.status === 'NEW').length }]} />} />
      {!CLOUD && <p className="mb-4 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">Client links work on the live site (connected to Supabase). Here you can build and preview forms.</p>}
      {tab === 'forms' ? <FormsTab /> : <ResponsesTab />}
    </div>
  )
}

function FormsTab() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const [confirm, node] = useConfirm()
  const [q, setQ] = useState('')
  const [show, setShow] = useState<'active' | 'ARCHIVED'>('active')
  const [edit, setEdit] = useState<{ id?: string; f: FormInput } | null>(null)
  const [preview, setPreview] = useState<DocForm | null>(null)
  const t = istToday()
  const subs = db.formSubmissions ?? []
  const list = (db.docForms ?? []).filter((f) => (show === 'ARCHIVED' ? f.status === 'ARCHIVED' : f.status !== 'ARCHIVED') && (!q || `${f.name} ${f.description}`.toLowerCase().includes(q.toLowerCase())))
  const client = (f: DocForm) => db.bookings.find((b) => b.id === f.bookingId)

  const [sharing, setSharing] = useState<DocForm | null>(null)

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search forms…" className="min-w-52 flex-1" />
        <Tabs value={show} onChange={setShow} tabs={[{ id: 'active', label: 'Current' }, { id: 'ARCHIVED', label: 'Archived' }]} />
        <Button variant="accent" icon={Plus} onClick={() => setEdit({ f: { ...blank, fields: [{ ...newField('text'), label: 'Full name', required: true }] } })}>New form</Button>
      </div>
      {!list.length ? <EmptyState icon={FileSignature} title="No forms yet" text="Create a form for clients to fill in, or upload a document for them to download and return." /> : (
        <Table>
          <thead><tr><Th>Form</Th><Th>Client file</Th><Th>Status</Th><Th className="text-right">Responses</Th><Th>Link</Th><Th className="text-right">Actions</Th></tr></thead>
          <tbody>
            {list.map((f) => {
              const b = client(f), n = subs.filter((s) => s.formId === f.id).length, open = formOpen(f, t)
              return (
                <tr key={f.id} className="hover:bg-card2/60">
                  <Td><span className="block font-semibold">{f.name}</span><span className="text-[11px] text-mute">{f.kind === 'UPLOAD' ? 'Document to return' : `${f.fields.length} field(s)`} · v{f.version} · {userName(db, f.createdBy)} · updated {fmtDate(f.updatedAt)}</span></Td>
                  <Td className="text-xs">{b ? <><b>{b.bookingId}</b><span className="block text-mute">{b.companyName}</span></> : <span className="text-mute">—</span>}</Td>
                  <Td><Badge tone={STATUS[f.status].tone}>{STATUS[f.status].label}</Badge>{f.expiresOn && <span className={cx('block text-[11px]', f.expiresOn < t ? 'text-bad' : 'text-mute')}>{f.expiresOn < t ? 'expired' : 'until'} {fmtDate(f.expiresOn)}</span>}{f.verify === 'MOBILE' && <span className="block text-[11px] text-mute">mobile check</span>}</Td>
                  <Td className="text-right tabular-nums">{n}<span className="block text-[11px] text-mute">{f.views} view{f.views === 1 ? '' : 's'}</span></Td>
                  <Td>{open ? <span className="flex gap-1">
                    <Button size="sm" icon={Share2} onClick={() => setSharing(f)}>Share</Button>
                    <Button size="sm" variant="ghost" icon={Copy} aria-label="Copy link" title="Copy link" onClick={() => { void navigator.clipboard?.writeText(formLink(f)); toast('success', 'Link copied') }} />
                  </span> : <span className="text-xs text-mute">{f.status === 'PUBLISHED' ? 'expired — make a new link' : 'publish it to share'}</span>}</Td>
                  <Td className="text-right"><span className="inline-flex flex-wrap justify-end gap-1">
                    <Button size="sm" variant="ghost" icon={Eye} aria-label="Preview" onClick={() => setPreview(f)} />
                    {f.status !== 'ARCHIVED' && <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setEdit({ id: f.id, f: { name: f.name, description: f.description, instructions: f.instructions, kind: f.kind, fields: f.fields, verify: f.verify, bookingId: f.bookingId, expiresOn: f.expiresOn, document: f.document } })} />}
                    {(f.status === 'DRAFT' || f.status === 'CLOSED') && <Button size="sm" variant="success" icon={Send} onClick={() => run(() => setFormStatus(me, f.id, 'PUBLISHED'), 'Published — the link works now')}>Publish</Button>}
                    {f.status === 'PUBLISHED' && <Button size="sm" variant="ghost" icon={XCircle} onClick={() => run(() => setFormStatus(me, f.id, 'CLOSED'), 'Closed — the link stops working')}>Close</Button>}
                    {f.status !== 'ARCHIVED' && f.status !== 'DRAFT' && <Button size="sm" variant="ghost" icon={RefreshCw} aria-label="New link" title="New link (the old one stops working)" onClick={async () => { if (await confirm('Make a new link?', 'The current link stops working at once — send the new one to the client.')) run(() => renewFormLink(me, f.id), 'New link made') }} />}
                    {f.status !== 'ARCHIVED' && <Button size="sm" variant="ghost" icon={Archive} aria-label="Archive" onClick={async () => { if (await confirm('Archive this form?', 'The link stops working; the form and its responses are kept.', true)) run(() => setFormStatus(me, f.id, 'ARCHIVED'), 'Archived') }} />}
                  </span></Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
      {edit && <FormBuilder init={edit.f} id={edit.id} onClose={() => setEdit(null)} />}
      {preview && <PreviewModal form={preview} onClose={() => setPreview(null)} />}
      {sharing && <ShareModal f={sharing} onClose={() => setSharing(null)} />}
      {node}
    </Card>
  )
}

/**
 * Send a live form's secure link to the client by email (branded, from the server) and / or WhatsApp — through
 * Interakt when the form-link template is set (Workflow settings), otherwise by opening WhatsApp with the text.
 */
function ShareModal({ f, onClose }: { f: DocForm; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const toast = useToast()
  const b = db.bookings.find((x) => x.id === f.bookingId)
  const [name, setName] = useState(b?.contactPerson ?? '')
  const [email, setEmail] = useState(b?.email ?? '')
  const [phone, setPhone] = useState(b?.mobile ?? '')
  const [busy, setBusy] = useState<'' | 'email' | 'wa'>('')
  const waAuto = CLOUD && !!workflowSettings(db.settings.workflow).whatsapp.formTemplate
  const what = f.kind === 'UPLOAD' ? 'download the document and send it back completed' : 'fill in the form'
  const text = `Dear ${name || 'Sir / Madam'}, please open this secure link to ${what} (${f.name})${f.expiresOn ? ` before ${fmtDate(f.expiresOn)}` : ''}: ${formLink(f)}`
  const sendEmail = async () => {
    setBusy('email')
    try {
      const req = {
        to: email.trim(), subject: `${f.name}${b ? ` — ${b.bookingId}` : ''}`, heading: f.name, company: db.settings.companyName || 'Rexera',
        message: `Dear ${name || 'Sir / Madam'},\n\nPlease open the secure link below to ${what}${f.expiresOn ? ` before ${fmtDate(f.expiresOn)}` : ''}.\n\n${formLink(f)}${f.verify === 'MOBILE' ? '\n\nYou will be asked for the mobile number registered with us.' : ''}\n\nThank you.`,
        sender: { name: me.name, role: 'Operations', phone: me.phone || undefined, email: isEmail(me.email) ? me.email : undefined }, replyTo: isEmail(me.email) ? me.email : undefined,
      }
      const r = await sendClientEmailClient(req)
      if (b && canEmailClient(db, me, b)) logClientEmail(me, b.id, { to: req.to, cc: [], subject: req.subject, template: 'form-link', status: r.delivered ? 'SENT' : 'FAILED', ...(r.delivered ? {} : { error: r.message }) })
      toast(r.delivered ? 'success' : 'error', r.delivered ? `Link emailed to ${req.to}` : `Not sent: ${r.message}`)
    } finally { setBusy('') }
  }
  const sendWhatsapp = async () => {
    if (!waAuto) { window.open(whatsappLink(phone, text), '_blank', 'noopener'); return }
    setBusy('wa')
    try {
      const r = await sendFormWhatsapp(f.id, phone, name)
      toast(r.status === 'SENT' ? 'success' : 'error', r.status === 'SENT' ? `Link sent on WhatsApp to ${r.to}` : `Not sent: ${r.error ?? r.status}`)
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Not sent') } finally { setBusy('') }
  }
  return (
    <Modal open onClose={onClose} title={`Share “${f.name}”`} subtitle={b ? `${b.bookingId} · ${b.companyName}` : 'Not linked to a client file'} size="md" footer={<Button variant="outline" onClick={onClose}>Done</Button>}>
      <div className="grid gap-4">
        <Input label="Client name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="rounded-xl border border-line p-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold"><Mail className="size-4" />Email</p>
          <div className="flex flex-wrap items-end gap-2">
            <Input label="Client email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-56 flex-1" />
            <Button icon={Send} loading={busy === 'email'} disabled={!isEmail(email) || !!busy} onClick={sendEmail}>Send email</Button>
          </div>
        </div>
        <div className="rounded-xl border border-line p-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold"><MessageCircle className="size-4" />WhatsApp</p>
          <div className="flex flex-wrap items-end gap-2">
            <Input label="Client WhatsApp number" value={phone} onChange={(e) => setPhone(e.target.value)} className="min-w-56 flex-1" />
            <Button variant="success" icon={MessageCircle} loading={busy === 'wa'} disabled={!isPhone(phone) || !!busy} onClick={sendWhatsapp}>{waAuto ? 'Send on WhatsApp' : 'Open WhatsApp'}</Button>
          </div>
          <p className="mt-1.5 text-[11px] text-mute">{waAuto ? 'Sent from the company WhatsApp number (Interakt).' : 'Opens WhatsApp with the message ready — send it from your phone or WhatsApp Web. (Set a form-link template in Workflow settings to send it automatically.)'}</p>
        </div>
        <p className="break-all rounded-xl bg-card2 p-3 text-[12px] text-mute">{text}</p>
      </div>
    </Modal>
  )
}

function PreviewModal({ form, onClose, fields }: { form: Pick<DocForm, 'name' | 'description' | 'instructions' | 'kind' | 'document'>; fields?: FormField[]; onClose: () => void }) {
  const [values, setValues] = useState<FormValues>({})
  const [files, setFiles] = useState<FormFiles>({})
  const fl = fields ?? (form as DocForm).fields ?? []
  return (
    <Modal open onClose={onClose} title="What the client sees" size="lg" footer={<Button onClick={onClose}>Close</Button>}>
      <div className="rounded-2xl bg-[#F5F7FB] p-5 text-[#111827]">
        <div className="rounded-2xl bg-white p-5">
          <h2 className="text-xl font-extrabold">{form.name || 'Untitled form'}</h2>
          {form.description && <p className="mt-1 text-sm text-[#4B5563]">{form.description}</p>}
          {form.instructions && <div className="mt-3 whitespace-pre-line rounded-xl bg-[#EEF2FB] p-3 text-sm">{form.instructions}</div>}
          {form.kind === 'UPLOAD' && <p className="mt-3 rounded-xl border border-[#E5E7EB] p-3 text-sm font-semibold text-[#2E3A8C]">Download: {form.document?.name ?? '(no document yet)'}</p>}
          <div className="mt-5"><FormRenderer fields={fl} values={values} files={files} onValue={(id, v) => setValues((x) => ({ ...x, [id]: v }))} onFiles={(id, f) => setFiles((x) => ({ ...x, [id]: f }))} /></div>
          <button disabled className="mt-5 h-11 w-full rounded-xl bg-[#F47B20] font-bold text-white opacity-70">Submit (preview)</button>
        </div>
      </div>
    </Modal>
  )
}

/** Name, instructions, the client file it is for, expiry, mobile check, and the fields (or the document to return). */
function FormBuilder({ init, id, onClose }: { init: FormInput; id?: string; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [f, setF] = useState<FormInput>(init)
  const [preview, setPreview] = useState(false)
  const set = (p: Partial<FormInput>) => setF((x) => ({ ...x, ...p }))
  const setField = (i: number, p: Partial<FormField>) => set({ fields: f.fields.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  const move = (i: number, by: number) => { const a = [...f.fields]; const [x] = a.splice(i, 1); a.splice(i + by, 0, x!); set({ fields: a }) }
  const files = useMemo(() => visibleBookings(db, me).filter((b) => b.status !== 'REJECTED').sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db, me])
  const existing = id ? db.docForms?.find((x) => x.id === id) : undefined
  const problems = formProblems(f)
  return (
    <Modal open onClose={onClose} title={id ? `Edit · ${init.name}` : 'New form'} size="xl"
      subtitle={existing && existing.status !== 'DRAFT' ? `Live form (v${existing.version}): changing the fields makes version ${existing.version + 1}; earlier responses keep theirs.` : 'Saved as a draft — publish it when it is ready.'}
      footer={<><Button variant="ghost" icon={Eye} className="mr-auto" onClick={() => setPreview(true)}>Preview</Button><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button icon={FilePlus2} onClick={async () => { if (await run(() => saveForm(me, f, id), 'Form saved')) onClose() }}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Form / document name" required value={f.name} onChange={(e) => set({ name: e.target.value })} className="sm:col-span-2" />
        <Select label="Type" value={f.kind} onChange={(e) => set({ kind: e.target.value as FormInput['kind'] })}>
          <option value="ONLINE">Online form — the client fills in fields</option><option value="UPLOAD">Document — the client downloads it and sends it back</option>
        </Select>
        <Select label="Client file (optional)" value={f.bookingId ?? ''} onChange={(e) => set({ bookingId: e.target.value || undefined, ...(e.target.value ? {} : { verify: 'NONE' as const }) })}>
          <option value="">— Any client —</option>{files.slice(0, 300).map((b) => <option key={b.id} value={b.id}>{b.bookingId} · {b.companyName}</option>)}
        </Select>
        <Textarea label="Description" rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} className="sm:col-span-2" />
        <Textarea label="Instructions for the client" rows={3} value={f.instructions} onChange={(e) => set({ instructions: e.target.value })} className="sm:col-span-2" placeholder="What to fill in, which documents to attach, the deadline…" />
        <Input label="Link expires after" type="date" min={istToday()} value={f.expiresOn ?? ''} onChange={(e) => set({ expiresOn: e.target.value || undefined })} hint="Leave empty: until you close it" />
        <div className="flex items-end pb-2"><Checkbox label="Ask for the client’s registered mobile before showing it" disabled={!f.bookingId} checked={f.verify === 'MOBILE'} onChange={(v) => set({ verify: v ? 'MOBILE' : 'NONE' })} /></div>
        {f.kind === 'UPLOAD' && <div className="sm:col-span-2"><FileField label="Document the client downloads" required accept={`${DOC_TYPES},${RESUME_TYPES}`} acceptLabel="PDF, image or Word" value={f.document} onChange={(document) => set({ document })} /></div>}
      </div>

      <div className="mt-6">
        <p className="mb-2 text-sm font-bold">Fields {f.kind === 'UPLOAD' && <span className="font-normal text-mute">— a “Completed document” upload is added automatically</span>}</p>
        <div className="space-y-2">
          {f.fields.map((x, i) => (
            <div key={x.id} className="grid grid-cols-[minmax(0,1fr)_150px_auto] gap-2 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,1fr)_160px_110px_auto]">
              <Input aria-label={`Field ${i + 1} label`} placeholder="Label (e.g. Company PAN)" value={x.label} onChange={(e) => setField(i, { label: e.target.value })} />
              <Select aria-label={`Field ${i + 1} type`} value={x.type} onChange={(e) => setField(i, { type: e.target.value as FormField['type'], ...(e.target.value === 'select' && !x.options?.length ? { options: [''] } : {}) })}>
                {FIELD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
              <div className="flex items-center"><Checkbox label="Required" checked={x.required} onChange={(v) => setField(i, { required: v })} /></div>
              <span className="flex items-center gap-0.5">
                <Button size="sm" variant="ghost" icon={ArrowUp} aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                <Button size="sm" variant="ghost" icon={ArrowDown} aria-label="Move down" disabled={i === f.fields.length - 1} onClick={() => move(i, 1)} />
                <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove field" onClick={() => set({ fields: f.fields.filter((_, j) => j !== i) })} />
              </span>
              {x.type === 'select' && <Input className="col-span-full" aria-label="Choices" placeholder="Choices, separated by commas" value={(x.options ?? []).join(', ')} onChange={(e) => setField(i, { options: e.target.value.split(',').map((o) => o.trimStart()) })} />}
              <Input className="col-span-full" aria-label="Help text" placeholder="Help text (optional)" value={x.help ?? ''} onChange={(e) => setField(i, { help: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(['text', 'email', 'phone', 'date', 'select', 'checkbox', 'number', 'file', 'textarea'] as const).map((t) => (
            <Button key={t} size="sm" variant="soft" icon={Plus} onClick={() => set({ fields: [...f.fields, newField(t)] })}>{FIELD_TYPES.find((x) => x.id === t)!.label}</Button>
          ))}
        </div>
        {problems.length > 0 && <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">Before publishing: {problems.join(' ')}</p>}
      </div>
      {preview && <PreviewModal form={f} fields={f.fields} onClose={() => setPreview(false)} />}
    </Modal>
  )
}

function ResponsesTab() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [params, setParams] = useSearchParams()
  const formId = params.get('form') ?? ''
  const [status, setStatus] = useState<FormSubmission['status'] | ''>('NEW')
  const [open, setOpen] = useState<FormSubmission | null>(null)
  const [note, setNote] = useState('')
  const forms = db.docForms ?? []
  const list = (db.formSubmissions ?? []).filter((s) => (!formId || s.formId === formId) && (!status || s.status === status)).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  const formName = (id: string) => forms.find((f) => f.id === id)?.name ?? '—'
  const cur = open ? db.formSubmissions?.find((s) => s.id === open.id) ?? open : null
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <select value={formId} onChange={(e) => setParams({ tab: 'responses', ...(e.target.value ? { form: e.target.value } : {}) })} aria-label="Form" className="h-10 rounded-xl border border-line bg-card px-3 text-sm">
          <option value="">All forms</option>{forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <Tabs value={status} onChange={setStatus} tabs={[{ id: 'NEW', label: 'New' }, { id: 'REVIEWED', label: 'Reviewed' }, { id: 'ACCEPTED', label: 'Accepted' }, { id: 'REJECTED', label: 'Rejected' }, { id: '', label: 'All' }]} />
      </div>
      {!list.length ? <EmptyState icon={Link2} title="No responses here" text="Responses arrive here when clients submit a form from its link." /> : (
        <Table>
          <thead><tr><Th>Received</Th><Th>Form</Th><Th>Client file</Th><Th className="text-right">Files</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {list.map((s) => {
              const b = db.bookings.find((x) => x.id === s.bookingId)
              return (
                <tr key={s.id} className="cursor-pointer hover:bg-card2/60" onClick={() => { setOpen(s); setNote('') }}>
                  <Td className="text-xs">{fmtDateTime(s.submittedAt)}</Td>
                  <Td><b>{formName(s.formId)}</b><span className="block text-[11px] text-mute">v{s.formVersion}</span></Td>
                  <Td className="text-xs">{b ? `${b.bookingId} · ${b.companyName}` : '—'}</Td>
                  <Td className="text-right tabular-nums">{s.files.length}</Td>
                  <Td><Badge tone={SUB[s.status].tone}>{SUB[s.status].label}</Badge></Td>
                  <Td className="text-right"><Button size="sm" variant="ghost" icon={Eye}>Open</Button></Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
      <Modal open={!!cur} onClose={() => setOpen(null)} title={cur ? `${formName(cur.formId)} · response` : ''} size="lg"
        subtitle={cur ? `Received ${fmtDateTime(cur.submittedAt)} · form version ${cur.formVersion}${cur.reviewedBy ? ` · ${SUB[cur.status].label.toLowerCase()} by ${userName(db, cur.reviewedBy)}` : ''}` : undefined}
        footer={cur && <>
          {cur.bookingId && cur.files.length > 0 && <Button variant="ghost" className="mr-auto" onClick={() => run(() => { const n = attachSubmissionFiles(me, cur.id); if (!n) throw new Error('These files are already on the client file.') }, 'Files added to the client file')}>Add files to client file</Button>}
          <Button variant="outline" onClick={() => run(() => reviewSubmission(me, cur.id, 'REVIEWED', note), 'Marked reviewed')}>Reviewed</Button>
          <Button variant="danger" onClick={() => run(() => reviewSubmission(me, cur.id, 'REJECTED', note), 'Rejected')}>Reject</Button>
          <Button variant="success" onClick={() => run(() => reviewSubmission(me, cur.id, 'ACCEPTED', note), 'Accepted')}>Accept</Button>
        </>}>
        {cur && <div className="space-y-4">
          <dl className="divide-y divide-line/70 rounded-xl border border-line text-sm">
            {cur.fields.map((fl) => (
              <div key={fl.id} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="shrink-0 text-mute">{fl.label}</dt>
                <dd className="min-w-0 break-words text-right font-medium">{fl.type === 'file'
                  ? cur.files.filter((x) => x.fieldId === fl.id).map((x) => <span key={x.file.id} className="block"><FileLink file={x.file} label={x.file.name} /></span>)
                  : fl.type === 'checkbox' ? (cur.answers[fl.id] ? 'Yes' : 'No') : String(cur.answers[fl.id] ?? '—')}</dd>
              </div>
            ))}
          </dl>
          <Textarea label="Note (needed to reject)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          {cur.note && <p className="text-xs text-mute">Earlier note: {cur.note}</p>}
        </div>}
      </Modal>
    </Card>
  )
}
