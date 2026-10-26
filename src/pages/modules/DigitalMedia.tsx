import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Clapperboard, Clock3, Download, Eye, FileX2, Globe2, Hourglass, Lock, PauseCircle, Pencil, Plus, Send, Trash2, Upload, X } from 'lucide-react'
import type { FileRef, MediaItem, MediaWork } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName, visibleBookings } from '../../lib/actions'
import { addMediaFiles, canManageMedia, canWorkMedia, createMedia, deleteMedia, removeMediaFile, setMediaWork, unpublishMedia, updateMedia, visibleMedia, type MediaForm } from '../../lib/media'
import { deleteFile, fileSize, openFile, saveMediaFile } from '../../lib/files'
import { ago, fmtDate, fmtDateTime } from '../../lib/format'
import {
  isLive, MEDIA_ACCEPT, MEDIA_TYPES, mediaDeadline, mediaFileProblem, mediaFileType, mediaProblems, mediaTypeLabel, UPLOAD_STATUS, uploadStatus, WORK_STATUS, workStatus, type MediaWorkShown,
} from '../../../supabase/media-rules.mjs'
import { MediaPreview } from '../../components/MediaPreview'
import {
  Badge, Button, Card, CardHeader, Checkbox, cx, EmptyState, Input, Modal, PageHeader, Progress, SearchBox, Select, Stat, Table, Td, Textarea, Th, Toggle, useConfirm, useRun, useToast,
} from '../../components/ui'

type Sort = 'serial' | 'scheme' | 'date' | 'upload' | 'work'
type Uploading = { key: string; name: string; share: number; error?: string }

/** Uploads chosen files one by one with progress; answers the stored ones (failed ones are listed with their error). */
function useUploads() {
  const [list, setList] = useState<Uploading[]>([])
  const upload = async (files: File[]) => {
    const done: FileRef[] = []
    for (const f of files) {
      const key = `${f.name}-${f.size}-${Math.random()}`
      const type = mediaFileType(f.name, f.type)
      const bad = mediaFileProblem(f.name, f.type, f.size)
      setList((l) => [...l, { key, name: f.name, share: 0, ...(bad ? { error: bad } : {}) }])
      if (bad || !type) continue
      try {
        done.push(await saveMediaFile(f, type, (share) => setList((l) => l.map((x) => (x.key === key ? { ...x, share } : x)))))
        setList((l) => l.filter((x) => x.key !== key))
      } catch (e) {
        setList((l) => l.map((x) => (x.key === key ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)))
      }
    }
    return done
  }
  const view = list.length > 0 && (
    <ul className="mt-2 space-y-1.5">
      {list.map((u) => (
        <li key={u.key} className="text-xs">
          <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-semibold">{u.name}</span>{u.error ? <button type="button" className="text-mute hover:text-ink" aria-label="Dismiss" onClick={() => setList((l) => l.filter((x) => x.key !== u.key))}><X className="size-3.5" /></button> : <span>{Math.round(u.share * 100)}%</span>}</span>
          {u.error ? <span className="text-bad">{u.error}</span> : <Progress value={u.share * 100} tone="orange" />}
        </li>
      ))}
    </ul>
  )
  return { upload, view, busy: list.some((x) => !x.error) }
}

const emptyForm = (): MediaForm => ({ schemeName: '', title: '', description: '', mediaType: 'POST', internal: true, external: false, clientBookingIds: [], assignDate: '', assignTime: '', assignedTo: '', workStatus: 'PENDING', notes: '' })
const formOf = (m: MediaItem): MediaForm => ({
  schemeName: m.schemeName, title: m.title, description: m.description, mediaType: m.mediaType, internal: m.internal, external: m.external, clientBookingIds: m.clientBookingIds ?? [],
  assignDate: m.assignDate ?? '', assignTime: m.assignTime ?? '', assignedTo: m.assignedTo ?? '', workStatus: m.workStatus, notes: m.notes ?? '',
})

/**
 * Digital Media Dashboard → Media Function: every post, flyer, poster, video… with its scheme, files, where it is
 * published (Internal = company dashboards, External = client portals), assignment and work status.
 */
export default function DigitalMedia() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const manage = canManageMedia(me)
  const items = visibleMedia(db, me)
  const now = new Date()
  const [q, setQ] = useState('')
  const [up, setUp] = useState<'' | 'UPLOADED' | 'NOT_UPLOADED'>('')
  const [work, setWork] = useState<'' | MediaWorkShown>('')
  const [pub, setPub] = useState<'' | 'internal' | 'external' | 'draft'>('')
  const [date, setDate] = useState('')
  const [sort, setSort] = useState<{ by: Sort; asc: boolean }>({ by: 'serial', asc: false })
  const [form, setForm] = useState<{ id?: string; data: MediaForm; files: FileRef[]; submitted?: boolean } | null>(null)
  const [detail, setDetail] = useState<string | null>(params.get('open'))
  useEffect(() => { if (params.get('open')) setDetail(params.get('open')) }, [params])

  const ql = q.trim().toLowerCase()
  const shown = useMemo(() => items
    .filter((m) => (!ql || `${m.schemeName} ${m.title}`.toLowerCase().includes(ql)) && (!up || uploadStatus(m) === up) && (!work || workStatus(m, now) === work)
      && (!pub || (pub === 'draft' ? !m.submitted : m.submitted && m[pub])) && (!date || m.assignDate === date))
    .sort((a, b) => {
      const v = sort.by === 'serial' ? a.serial - b.serial : sort.by === 'scheme' ? a.schemeName.localeCompare(b.schemeName) : sort.by === 'date' ? (a.assignDate ?? '9999').localeCompare(b.assignDate ?? '9999') || (a.assignTime ?? '').localeCompare(b.assignTime ?? '')
        : sort.by === 'upload' ? uploadStatus(a).localeCompare(uploadStatus(b)) : workStatus(a, now).localeCompare(workStatus(b, now))
      return (sort.asc ? v : -v) || b.serial - a.serial
    }), [items, ql, up, work, pub, date, sort]) // eslint-disable-line react-hooks/exhaustive-deps
  const count = (f: (m: MediaItem) => boolean) => items.filter(f).length
  const th = (by: Sort, label: string, className?: string) => <Th className={className} sorted={sort.by === by ? (sort.asc ? 'asc' : 'desc') : false} onClick={() => setSort((s) => ({ by, asc: s.by === by ? !s.asc : true }))}>{label}</Th>
  const open = items.find((m) => m.id === detail) ?? null
  const closeDetail = () => { setDetail(null); if (params.has('open')) setParams({}) }

  return (
    <div>
      <PageHeader title="Digital Media Dashboard" subtitle="Media Function — posts, flyers, posters and videos: assign, upload and publish to the company and to clients" icon={Clapperboard}
        actions={manage && <Button icon={Plus} onClick={() => setForm({ data: emptyForm(), files: [] })}>Create Media</Button>} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="All media" value={items.length} icon={Clapperboard} onClick={() => { setUp(''); setWork(''); setPub('') }} />
        <Stat label="Uploaded" value={count((m) => uploadStatus(m) === 'UPLOADED')} icon={Upload} tone="green" onClick={() => setUp('UPLOADED')} />
        <Stat label="Not uploaded" value={count((m) => uploadStatus(m) === 'NOT_UPLOADED')} icon={FileX2} tone="gray" onClick={() => setUp('NOT_UPLOADED')} />
        <Stat label="Pending" value={count((m) => workStatus(m, now) === 'PENDING')} icon={Hourglass} tone="amber" onClick={() => setWork('PENDING')} />
        <Stat label="Late" value={count((m) => workStatus(m, now) === 'LATE')} icon={Clock3} tone="red" onClick={() => setWork('LATE')} />
        <Stat label="On hold" value={count((m) => m.workStatus === 'ON_HOLD')} icon={PauseCircle} tone="violet" onClick={() => setWork('ON_HOLD')} />
        <Stat label="Completed" value={count((m) => m.workStatus === 'COMPLETED')} icon={CheckCircle2} tone="green" onClick={() => setWork('COMPLETED')} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Media Function" icon={Clapperboard} subtitle={manage ? 'Every media record — click a column title to sort' : 'Media assigned to you, and company media'} />
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <SearchBox value={q} onChange={setQ} placeholder="Search scheme or media title…" className="min-w-56 flex-1" />
          <Select aria-label="Upload status" value={up} onChange={(e) => setUp(e.target.value as typeof up)} className="w-40"><option value="">Any upload status</option><option value="UPLOADED">Uploaded</option><option value="NOT_UPLOADED">Not uploaded</option></Select>
          <Select aria-label="Work status" value={work} onChange={(e) => setWork(e.target.value as typeof work)} className="w-40"><option value="">Any work status</option>{(Object.keys(WORK_STATUS) as MediaWorkShown[]).map((k) => <option key={k} value={k}>{WORK_STATUS[k].label}</option>)}</Select>
          <Select aria-label="Publication" value={pub} onChange={(e) => setPub(e.target.value as typeof pub)} className="w-44"><option value="">Internal or external</option><option value="internal">Internal (company)</option><option value="external">External (clients)</option><option value="draft">Not published (draft)</option></Select>
          <Input aria-label="Assignment date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          {(q || up || work || pub || date) && <Button size="sm" variant="ghost" icon={X} onClick={() => { setQ(''); setUp(''); setWork(''); setPub(''); setDate('') }}>Clear</Button>}
        </div>
        {!shown.length ? <EmptyState icon={Clapperboard} title={items.length ? 'Nothing matches' : 'No media yet'} text={items.length ? 'Change the search or filters.' : manage ? 'Click Create Media to add the first post or flyer.' : 'Media assigned to you appears here.'} /> : (
          <Table className="[&_table]:min-w-[1200px]">
            <thead><tr>
              {th('serial', 'S. No.', 'w-16')}{th('scheme', 'Scheme name')}<Th>Content</Th>{th('upload', 'Status')}<Th>Upload</Th><Th className="text-center">Internal (company)</Th><Th className="text-center">External (client)</Th><Th>Details</Th>{th('date', 'Assignment date')}<Th>Time</Th>{th('work', 'Work status')}
            </tr></thead>
            <tbody>{shown.map((m) => <Row key={m.id} m={m} now={now} onDetails={() => setDetail(m.id)} />)}</tbody>
          </Table>
        )}
      </Card>

      {form && <MediaFormModal form={form} onClose={async (stored) => {
        // files uploaded for a record that was never saved are removed again
        for (const f of stored) await deleteFile(f.id).catch(() => undefined)
        setForm(null)
      }} onSaved={(id) => { setForm(null); setDetail(id) }} />}
      {open && <DetailsModal m={open} onClose={closeDetail} onEdit={() => { setForm({ id: open.id, data: formOf(open), files: [], submitted: open.submitted }); closeDetail() }} run={run} toast={toast} />}
    </div>
  )
}

function Row({ m, now, onDetails }: { m: MediaItem; now: Date; onDetails: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const manage = canManageMedia(me)
  const mayWork = canWorkMedia(me, m)
  const input = useRef<HTMLInputElement>(null)
  const { upload, view, busy } = useUploads()
  const u = UPLOAD_STATUS[uploadStatus(m)], w = WORK_STATUS[workStatus(m, now)]
  const toggle = (k: 'internal' | 'external', v: boolean) => run(() => updateMedia(me, m.id, { ...formOf(m), [k]: v }, false), v ? `Marked ${k}` : `No longer ${k}`)
  return (
    <tr className="align-top">
      <Td className="font-mono font-semibold">{m.serial}</Td>
      <Td className="font-semibold">{m.schemeName}</Td>
      <Td className="max-w-80">
        <span className="flex items-start gap-2">
          {m.files[0] && <MediaPreview file={m.files[0]} compact className="size-10 shrink-0" />}
          <span className="min-w-0">
            <b className="block truncate">{m.title}</b>
            <span className="block text-[11px] text-mute">{mediaTypeLabel(m.mediaType)}{m.submitted ? isLive(m) ? ' · published' : ' · published once uploaded' : ' · draft'}</span>
            {m.description && <span className="line-clamp-2 block text-xs text-ink/80">{m.description}</span>}
            <span className="block text-[11px] text-mute">{m.assignedTo ? `Assigned: ${userName(db, m.assignedTo)} · ` : ''}updated {ago(m.updatedAt)} by {userName(db, m.updatedBy)}</span>
          </span>
        </span>
      </Td>
      <Td><Badge tone={u.tone}>{u.label}</Badge>{m.files.length > 1 && <span className="mt-0.5 block text-[11px] text-mute">{m.files.length} files</span>}</Td>
      <Td>
        {mayWork ? <>
          <input ref={input} type="file" multiple accept={MEDIA_ACCEPT} className="hidden" onChange={async (e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; const done = await upload(fs); if (done.length) await run(() => addMediaFiles(me, m.id, done), `${done.length} file(s) uploaded`) }} />
          <Button size="sm" variant="outline" icon={Upload} loading={busy} onClick={() => input.current?.click()}>Upload</Button>
          {view}
        </> : <span className="text-xs text-mute">—</span>}
      </Td>
      <Td className="text-center">{manage ? <span className="inline-flex"><Toggle checked={m.internal} onChange={(v) => toggle('internal', v)} label={`Internal: ${m.title}`} /></span> : m.internal ? <Lock className="mx-auto size-4 text-ok" aria-label="Internal" /> : '—'}</Td>
      <Td className="text-center">{manage ? <span className="inline-flex"><Toggle checked={m.external} onChange={(v) => toggle('external', v)} label={`External: ${m.title}`} /></span> : m.external ? <Globe2 className="mx-auto size-4 text-ok" aria-label="External" /> : '—'}</Td>
      <Td><Button size="sm" variant="ghost" icon={Eye} onClick={onDetails}>Show details</Button></Td>
      <Td className="whitespace-nowrap">{m.assignDate ? fmtDate(m.assignDate) : <span className="text-mute">—</span>}</Td>
      <Td className="whitespace-nowrap">{m.assignTime || <span className="text-mute">—</span>}</Td>
      <Td>
        {mayWork ? (
          <select aria-label={`Work status of ${m.title}`} value={m.workStatus} onChange={(e) => run(() => setMediaWork(me, m.id, e.target.value as MediaWork), 'Work status updated')}
            className={cx('h-8 rounded-lg border px-2 text-xs font-semibold', workStatus(m, now) === 'LATE' ? 'border-bad/40 text-bad' : 'border-line')}>
            <option value="PENDING">{workStatus(m, now) === 'LATE' ? 'Late (pending)' : 'Pending'}</option>
            {(manage || m.workStatus === 'ON_HOLD') && <option value="ON_HOLD" disabled={!manage}>On hold</option>}
            <option value="COMPLETED">Completed</option>
          </select>
        ) : <Badge tone={w.tone}>{w.label}</Badge>}
      </Td>
    </tr>
  )
}

function MediaFormModal({ form, onClose, onSaved }: {
  form: { id?: string; data: MediaForm; files: FileRef[]; submitted?: boolean }; onClose: (unsaved: FileRef[]) => void; onSaved: (id: string) => void
}) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [d, setD] = useState(form.data)
  const [files, setFiles] = useState<FileRef[]>(form.files)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [clientQ, setClientQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const { upload, view, busy } = useUploads()
  const set = <K extends keyof MediaForm>(k: K, v: MediaForm[K]) => { setD((x) => ({ ...x, [k]: v })); setErrors((x) => ({ ...x, [k]: '', ...(k === 'internal' || k === 'external' ? { publication: '' } : {}) })) }
  const schemes = [...new Set([...db.schemes.map((s) => s.title), ...(db.salesKit ?? []).map((s) => s.name)].filter(Boolean))].sort()
  const staff = db.users.filter((u) => u.active)
  const bookings = visibleBookings(db, me)
  const cq = clientQ.trim().toLowerCase()
  const save = async (submit: boolean) => {
    const e = mediaProblems({ ...d, assignDate: d.assignDate || undefined, assignTime: d.assignTime || undefined }, { submit: submit || !!form.submitted })
    setErrors(e)
    if (Object.keys(e).length) return
    const ok = await run(() => (form.id ? (updateMedia(me, form.id, d, submit), form.id) : createMedia(me, d, files, submit)),
      submit ? (files.length || (form.id && db.mediaItems?.find((x) => x.id === form.id)?.files.length) ? 'Submitted — now showing on the chosen dashboards' : 'Submitted — it shows on the chosen dashboards once a file is uploaded') : form.id ? 'Saved' : 'Saved as a draft')
    if (ok) onSaved(typeof ok === 'string' ? ok : form.id!)
  }
  return (
    <Modal open onClose={() => onClose(form.id ? [] : files)} size="lg" title={form.id ? 'Edit media' : 'Create Media'} subtitle={form.id ? undefined : 'Save keeps it as a draft; Submit publishes it to where you choose'}
      footer={<>
        <Button variant="outline" onClick={() => onClose(form.id ? [] : files)}>Cancel</Button>
        <Button variant="outline" disabled={busy} onClick={() => save(false)}>{form.id ? 'Save changes' : 'Save'}</Button>
        {!form.submitted && <Button icon={Send} disabled={busy} onClick={() => save(true)}>Submit</Button>}
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Input label="Scheme name" required list="media-schemes" value={d.schemeName} onChange={(e) => set('schemeName', e.target.value)} error={errors.schemeName} placeholder="Type or pick a scheme" />
          <datalist id="media-schemes">{schemes.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <Select label="Media type" required value={d.mediaType} onChange={(e) => set('mediaType', e.target.value as MediaForm['mediaType'])} error={errors.mediaType}>{MEDIA_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
        <Input label="Media title" required value={d.title} onChange={(e) => set('title', e.target.value)} error={errors.title} className="sm:col-span-2" />
        <Textarea label="Content description" rows={3} value={d.description} onChange={(e) => set('description', e.target.value)} error={errors.description} className="sm:col-span-2" />
        {!form.id && (
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-semibold">Upload media file <span className="font-normal text-mute">· images, videos, PDF, Word, PowerPoint · up to 50 MB each</span></p>
            <input ref={input} type="file" multiple accept={MEDIA_ACCEPT} className="hidden" onChange={async (e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; const done = await upload(fs); setFiles((x) => [...x, ...done]) }} />
            <Button size="sm" variant="outline" icon={Upload} onClick={() => input.current?.click()}>Choose files</Button>
            {files.length > 0 && <ul className="mt-2 flex flex-wrap gap-2">{files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-xl border border-line px-2 py-1 text-xs"><MediaPreview file={f} compact className="size-8" /><span className="max-w-40 truncate">{f.name}</span><span className="text-mute">{fileSize(f.size)}</span>
                <button type="button" aria-label={`Remove ${f.name}`} className="text-mute hover:text-bad" onClick={() => { setFiles((x) => x.filter((y) => y.id !== f.id)); void deleteFile(f.id) }}><X className="size-3.5" /></button></li>
            ))}</ul>}
            {view}
          </div>
        )}
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-semibold">Publication type {errors.publication && <span className="ml-1 font-normal text-bad">{errors.publication}</span>}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-line px-4 py-2.5">
            <Checkbox checked={d.internal} onChange={(v) => set('internal', v)} label={<span>Internal — for company <span className="text-[11px] text-mute">(staff dashboards)</span></span>} />
            <Checkbox checked={d.external} onChange={(v) => set('external', v)} label={<span>External — for clients <span className="text-[11px] text-mute">(client portal)</span></span>} />
          </div>
          {d.external && (
            <div className="mt-2 rounded-xl border border-line p-3">
              <p className="text-xs font-semibold">Which clients see it? <span className="font-normal text-mute">{d.clientBookingIds.length ? `${d.clientBookingIds.length} selected` : 'All clients with portal access'}</span></p>
              <SearchBox value={clientQ} onChange={setClientQ} placeholder="Limit to some clients: find a CRM entry…" className="mt-2" />
              <div className="mt-2 max-h-36 overflow-y-auto">
                {bookings.filter((b) => d.clientBookingIds.includes(b.id) || (cq && `${b.bookingId} ${b.companyName}`.toLowerCase().includes(cq))).slice(0, 40).map((b) => (
                  <Checkbox key={b.id} checked={d.clientBookingIds.includes(b.id)} onChange={(v) => set('clientBookingIds', v ? [...d.clientBookingIds, b.id] : d.clientBookingIds.filter((x) => x !== b.id))} label={<span className="text-xs">{b.bookingId} · {b.companyName}</span>} />
                ))}
              </div>
            </div>
          )}
        </div>
        <Input label="Assignment date" type="date" value={d.assignDate} onChange={(e) => set('assignDate', e.target.value)} error={errors.assignDate} />
        <Input label="Assignment time" type="time" value={d.assignTime} onChange={(e) => set('assignTime', e.target.value)} error={errors.assignTime} />
        <Select label="Assign to" value={d.assignedTo} onChange={(e) => set('assignedTo', e.target.value)}><option value="">— Nobody —</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        <Select label="Work status" value={d.workStatus} onChange={(e) => set('workStatus', e.target.value as MediaWork)} error={errors.workStatus}><option value="PENDING">Pending</option><option value="ON_HOLD">On hold</option><option value="COMPLETED">Completed</option></Select>
        <Textarea label="Additional notes" rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} error={errors.notes} hint="Company only — never shown to clients" className="sm:col-span-2" />
      </div>
    </Modal>
  )
}

function DetailsModal({ m, onClose, onEdit, run, toast }: { m: MediaItem; onClose: () => void; onEdit: () => void; run: ReturnType<typeof useRun>; toast: ReturnType<typeof useToast> }) {
  const db = useDb()
  const me = useMe()
  const [confirm, confirmNode] = useConfirm()
  const manage = canManageMedia(me), mayWork = canWorkMedia(me, m)
  const now = new Date(), w = WORK_STATUS[workStatus(m, now)], u = UPLOAD_STATUS[uploadStatus(m)]
  const due = mediaDeadline(m)
  const clients = (m.clientBookingIds ?? []).map((id) => db.bookings.find((b) => b.id === id)).filter(Boolean)
  const where = m.submitted ? [m.internal && 'company dashboards', m.external && (clients.length ? `${clients.length} client portal(s)` : 'every client portal')].filter(Boolean).join(' and ') : ''
  return (
    <Modal open onClose={onClose} size="xl" title={`#${m.serial} · ${m.title}`} subtitle={`${m.schemeName} · ${mediaTypeLabel(m.mediaType)}`}
      footer={<>
        {manage && <Button variant="ghost" icon={Trash2} onClick={async () => { if (await confirm('Delete this media?', `#${m.serial} “${m.title}” and its files are deleted for everyone.`, true) && await run(() => deleteMedia(me, m.id), 'Deleted')) onClose() }}>Delete</Button>}
        <span className="flex-1" />
        {manage && m.submitted && <Button variant="outline" onClick={() => run(() => unpublishMedia(me, m.id), 'Unpublished — back to draft')}>Unpublish</Button>}
        {manage && !m.submitted && <Button variant="outline" icon={Send} onClick={() => run(() => updateMedia(me, m.id, formOf(m), true), 'Submitted (published)')}>Submit</Button>}
        {manage && <Button icon={Pencil} onClick={onEdit}>Edit</Button>}
      </>}>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          {!m.files.length ? <div className="grid h-48 place-items-center rounded-xl border border-dashed border-line text-sm text-mute">No file uploaded yet</div> : (
            <div className="space-y-3">
              {m.files.map((f) => (
                <div key={f.id}>
                  <MediaPreview file={f} className="max-h-[420px] w-full" />
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs"><b className="min-w-0 truncate">{f.name}</b><span className="text-mute">{fileSize(f.size)} · {fmtDateTime(f.at)}</span>
                    <button type="button" className="font-semibold text-brand-ink hover:underline" onClick={() => openFile(f).catch((e) => toast('error', e.message))}>Open</button>
                    <button type="button" className="inline-flex items-center gap-1 font-semibold text-brand-ink hover:underline" onClick={() => openFile(f, true).catch((e) => toast('error', e.message))}><Download className="size-3" />Download</button>
                    {mayWork && <button type="button" className="ml-auto text-mute hover:text-bad" onClick={async () => { if (await confirm('Remove this file?', f.name, true)) run(() => removeMediaFile(me, m.id, f.id), 'File removed') }}>Remove</button>}</p>
                </div>
              ))}
            </div>
          )}
          {m.description && <div><p className="text-xs font-semibold text-mute">Content</p><p className="whitespace-pre-line text-sm">{m.description}</p></div>}
          {m.notes && <div className="rounded-xl bg-warn-soft px-3 py-2 text-sm"><p className="text-xs font-semibold text-warn">Company notes (never shown to clients)</p><p className="whitespace-pre-line">{m.notes}</p></div>}
        </div>
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 rounded-xl border border-line p-3">
            <dt className="text-mute">Upload</dt><dd><Badge tone={u.tone}>{u.label}</Badge></dd>
            <dt className="text-mute">Work</dt><dd><Badge tone={w.tone}>{w.label}</Badge>{m.completedAt && <span className="ml-1 text-[11px] text-mute">{fmtDateTime(m.completedAt)}</span>}</dd>
            <dt className="text-mute">Published</dt><dd>{m.submitted ? <>{where}{!isLive(m) && <span className="block text-[11px] text-warn">Shows once a file is uploaded</span>}<span className="block text-[11px] text-mute">{fmtDateTime(m.submittedAt!)} by {userName(db, m.submittedBy)}</span></> : <span className="text-mute">Not yet (draft)</span>}</dd>
            {clients.length > 0 && <><dt className="text-mute">Clients</dt><dd className="text-xs">{clients.map((b) => `${b!.bookingId} · ${b!.companyName}`).join(', ')}</dd></>}
            <dt className="text-mute">Assigned to</dt><dd>{m.assignedTo ? userName(db, m.assignedTo) : '—'}</dd>
            <dt className="text-mute">Due</dt><dd>{due ? `${fmtDate(m.assignDate!)}${m.assignTime ? ` · ${m.assignTime}` : ''}` : '—'}</dd>
            <dt className="text-mute">Created</dt><dd>{fmtDateTime(m.createdAt)}<span className="block text-[11px] text-mute">by {userName(db, m.createdBy)}</span></dd>
            <dt className="text-mute">Last update</dt><dd>{fmtDateTime(m.updatedAt)}<span className="block text-[11px] text-mute">by {userName(db, m.updatedBy)}</span></dd>
          </dl>
          {mayWork && m.workStatus !== 'COMPLETED' && <Button className="w-full" variant="outline" icon={CheckCircle2} onClick={() => run(() => setMediaWork(me, m.id, 'COMPLETED'), 'Marked completed')}>Mark completed</Button>}
          <div>
            <p className="mb-1 text-xs font-semibold text-mute">History</p>
            <ol className="max-h-64 space-y-1.5 overflow-y-auto">{[...m.history].reverse().map((h, i) => <li key={i} className="text-xs"><b>{h.action}</b>{h.note && <span className="text-mute"> — {h.note}</span>}<span className="block text-[11px] text-mute">{fmtDateTime(h.at)} · {userName(db, h.by)}</span></li>)}</ol>
          </div>
        </div>
      </div>
      {confirmNode}
    </Modal>
  )
}
