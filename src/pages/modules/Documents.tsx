import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, CheckCircle2, CircleDashed, FileCheck2, FilePlus2, FileText, Globe, Save, Upload, UserRound, X } from 'lucide-react'
import type { Booking, FileRef } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { addDocuments, setDocStatus, updateClientInfo, userName, visibleBookings } from '../../lib/actions'
import { DOC_FORM, KYC_CATEGORIES } from '../../lib/workflow'
import { ago, fmtDateTime } from '../../lib/format'
import { checkFile, saveFile } from '../../lib/files'
import { Badge, Button, Card, CardHeader, cx, EmptyState, Input, PageHeader, Progress, SearchBox, Select, Table, Tabs, Td, Th, useRun, useToast } from '../../components/ui'
import { DOC_ACCEPT } from '../../components/DocUploader'
import { FileLink } from '../../components/FileField'
import { PhoneInput } from '../../components/fields'

const OTHER = 'Other'

export default function Documents() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const bookings = useMemo(() => visibleBookings(db, me).filter((b) => b.status !== 'REJECTED'), [db, me])
  const bookingId = params.get('client') ?? ''
  const b = bookings.find((x) => x.id === bookingId)
  const [tab, setTab] = useState<'all' | 'PENDING' | 'VERIFIED' | 'REJECTED'>('PENDING')
  const [q, setQ] = useState('')
  const docs = useMemo(() => bookings.flatMap((x) => x.documents.map((d) => ({ ...d, b: x }))).sort((x, y) => y.at.localeCompare(x.at)), [bookings])
  const list = docs.filter((d) => (tab === 'all' || (d.status ?? 'PENDING') === tab) && (!q || `${d.name} ${d.b.companyName} ${d.category} ${d.note ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const verifier = can('bookings.process', 'bookings.legal', 'bookings.admin')
  const missing = bookings.filter((x) => ['IN_OPERATIONS', 'PENDING_LEGAL'].includes(x.status) && !x.documents.some((d) => KYC_CATEGORIES.includes(d.category)))

  return (
    <div>
      <PageHeader title="Document Forms" subtitle="Collect, upload and verify client documents — one slot for each document, with notes" icon={FileText} />
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="Client" subtitle="Pick the client, then fill in their details and upload each document" icon={UserRound} />
          <div className="p-5">
            <Select label="Client (CRM entry)" value={bookingId} onChange={(e) => setParams(e.target.value ? { client: e.target.value } : {})}>
              <option value="">— Select —</option>{bookings.map((x) => <option key={x.id} value={x.id}>{x.bookingId} · {x.companyName}</option>)}
            </Select>
            {b && <ClientInfo key={b.id} b={b} />}
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Missing KYC" subtitle="Active files without Aadhaar, company PAN, passport / photo or KYC" icon={FileCheck2} />
          <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto">
            {missing.map((x) => <li key={x.id}><button onClick={() => setParams({ client: x.id })} className="w-full px-5 py-2.5 text-left hover:bg-card2"><span className="block text-sm font-semibold">{x.companyName}</span><span className="text-xs text-mute">{x.bookingId} · {userName(db, x.opsMemberId ?? x.createdBy)}</span></button></li>)}
            {!missing.length && <li className="p-5 text-sm text-mute">All active files have KYC. 👍</li>}
          </ul>
        </Card>
      </div>

      {b ? <DocumentForm key={b.id} b={b} /> : <Card className="mb-6"><EmptyState icon={FilePlus2} title="Pick a client to fill their document form" text="COI, GST, MSME, Aadhaar, company PAN, bank statement, ITR, pitch deck, MOU, AOA, passport / photo, CMA and other documents." /></Card>}

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'PENDING', label: 'To verify', count: docs.filter((d) => (d.status ?? 'PENDING') === 'PENDING').length }, { id: 'VERIFIED', label: 'Verified' }, { id: 'REJECTED', label: 'Rejected' }, { id: 'all', label: 'All', count: docs.length }]} />
          <SearchBox value={q} onChange={setQ} className="min-w-52 flex-1" />
        </div>
        {!list.length ? <EmptyState icon={FileText} title="No documents" /> : (
          <Table>
            <thead><tr><Th>Document</Th><Th>Client</Th><Th>Type</Th><Th>Note</Th><Th>Uploaded</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {list.slice(0, 200).map((d) => (
                <tr key={d.id}>
                  <Td>{d.file ? <FileLink file={d.file} label={d.name} /> : <span className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-info" />{d.name}</span>}</Td>
                  <Td><Link to={`/bookings/${d.b.id}`} className="hover:underline">{d.b.companyName}</Link></Td>
                  <Td className="text-xs">{d.category}</Td>
                  <Td className="max-w-56 text-xs text-mute"><span className="line-clamp-2">{d.note ?? '—'}</span></Td>
                  <Td className="text-xs text-mute">{userName(db, d.by)} · {ago(d.at)}</Td>
                  <Td><Badge tone={d.status === 'VERIFIED' ? 'green' : d.status === 'REJECTED' ? 'red' : 'amber'}>{(d.status ?? 'PENDING').toLowerCase()}</Badge></Td>
                  <Td className="text-right">{verifier && d.status !== 'VERIFIED' && <span className="inline-flex gap-1"><Button size="sm" variant="success" icon={Check} onClick={() => setDocStatus(me, d.b.id, d.id, 'VERIFIED')}>Verify</Button><Button size="sm" variant="ghost" icon={X} aria-label="Reject" onClick={() => setDocStatus(me, d.b.id, d.id, 'REJECTED')} /></span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

/** Email, number and website reference of the client (saved on the client file). */
function ClientInfo({ b }: { b: Booking }) {
  const me = useMe()
  const run = useRun()
  const [f, setF] = useState({ email: b.email, mobile: b.mobile, website: b.website ?? '' })
  const dirty = f.email !== b.email || f.mobile !== b.mobile || f.website !== (b.website ?? '')
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <PhoneInput label="Number" value={f.mobile} onChange={(v) => setF({ ...f, mobile: v })} />
      <Input label="Website reference" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="www.example.com" />
      {dirty && <div className="sm:col-span-3"><Button size="sm" icon={Save} onClick={() => run(() => updateClientInfo(me, b.id, f), 'Client details saved')}>Save details</Button></div>}
      {!dirty && b.website && <a href={/^https?:/i.test(b.website) ? b.website : `https://${b.website}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline sm:col-span-3"><Globe className="size-3.5" />Open website</a>}
    </div>
  )
}

/** One upload slot per document type, plus "other documents" (note required). */
function DocumentForm({ b }: { b: Booking }) {
  const done = DOC_FORM.filter((s) => b.documents.some((d) => d.category === s.cat)).length
  return (
    <Card className="overflow-hidden">
      <CardHeader title={`Document form · ${b.companyName}`} subtitle={`${done} of ${DOC_FORM.length} documents collected · ${b.bookingId}`} icon={FileText}
        action={<div className="w-40"><Progress value={(done / DOC_FORM.length) * 100} tone={done === DOC_FORM.length ? 'green' : 'orange'} /></div>} />
      <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
        {DOC_FORM.map((s) => <DocSlot key={s.cat} b={b} cat={s.cat} title={s.short} hint={s.hint} />)}
        <DocSlot b={b} cat={OTHER} title="Other documents" hint="Anything else — describe it in the note" noteRequired className="md:col-span-2 xl:col-span-3" />
      </div>
    </Card>
  )
}

function DocSlot({ b, cat, title, hint, noteRequired, className }: { b: Booking; cat: string; title: string; hint: string; noteRequired?: boolean; className?: string }) {
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const have = b.documents.filter((d) => d.category === cat)
  useEffect(() => setNote(''), [b.id])
  const upload = async (files: FileList) => {
    if (noteRequired && !note.trim()) { toast('error', 'Write a note saying what the document is.'); return }
    setBusy(true)
    try {
      const refs: FileRef[] = []
      for (const f of Array.from(files)) { checkFile(f, DOC_ACCEPT, f.name); refs.push(await saveFile(f)) }
      if (await run(() => addDocuments(me, b.id, refs.map((file) => ({ file, category: cat, note }))), `${title}: ${refs.length} file(s) uploaded`)) setNote('')
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Could not upload.') } finally { setBusy(false) }
  }
  return (
    <div className={cx('flex flex-col rounded-2xl border p-4', have.length ? 'border-ok/40 bg-ok-soft/30' : 'border-line', className)}>
      <div className="mb-2 flex items-start gap-2">
        {have.length ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-mute" />}
        <div className="min-w-0 flex-1"><p className="text-sm font-bold">{title}</p><p className="text-[11px] text-mute">{hint}</p></div>
        {have.length > 0 && <Badge tone="green">{have.length}</Badge>}
      </div>
      {have.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {have.map((d) => (
            <li key={d.id} className="rounded-lg bg-card px-2.5 py-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                {d.file ? <FileLink file={d.file} label={d.name} /> : <span className="truncate font-semibold">{d.name}</span>}
                <Badge tone={d.status === 'VERIFIED' ? 'green' : d.status === 'REJECTED' ? 'red' : 'amber'}>{(d.status ?? 'PENDING').toLowerCase()}</Badge>
              </div>
              {d.note && <p className="mt-0.5 text-mute">“{d.note}”</p>}
              <p className="text-[10px] text-mute">{fmtDateTime(d.at)}</p>
            </li>
          ))}
        </ul>
      )}
      <input ref={input} type="file" multiple accept={DOC_ACCEPT} className="hidden" onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = '' }} />
      <div className="mt-auto flex gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={noteRequired ? 'Note (required) — what is it?' : 'Note (optional)'} aria-label={`Note for ${title}`}
          className={cx('h-9 min-w-0 flex-1 rounded-lg border bg-card px-3 text-xs outline-none focus:border-brand', noteRequired && !note.trim() ? 'border-warn/50' : 'border-line')} />
        <Button size="sm" icon={Upload} loading={busy} onClick={() => input.current?.click()}>{have.length ? 'Add' : 'Upload'}</Button>
      </div>
    </div>
  )
}
