import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Trash2, Upload } from 'lucide-react'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { deleteLeadUpload, importLeadBatch, userName } from '../lib/actions'
import { ACCEPT, MAX_FILE_BYTES, parseFile, type Dataset } from '../lib/imports'
import { autoMap, checkRows, LEAD_FIELDS, type LeadField, type Mapping, type RowCheck } from '../lib/leadUpload'
import { fileSize } from '../lib/files'
import { fmtDateTime } from '../lib/format'
import { Badge, Button, Card, cx, EmptyState, Modal, Select, Table, Td, Th, Tabs, useConfirm, useRun, useToast } from './ui'

type Step = 'file' | 'map' | 'check'
const TONE = { Valid: 'green', Invalid: 'red', Duplicate: 'amber' } as const

/**
 * Upload leads from an Excel / CSV sheet (Super Admin), like the old CRM: choose the file → match its columns to lead
 * fields (done for you, change anything) → see every row as valid, invalid or duplicate → import the valid ones as one
 * batch. Leads arrive unassigned, ready to hand out.
 */
export function LeadUploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('file')
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<{ name: string; size: number } | null>(null)
  const [sheets, setSheets] = useState<Dataset[]>([])
  const [sheet, setSheet] = useState(0)
  const [map, setMap] = useState<Mapping>({})
  const [show, setShow] = useState<'all' | RowCheck['status']>('all')

  const ds = sheets[sheet]
  const rows = useMemo(() => (ds ? ds.rows.map((r) => Object.fromEntries(ds.columns.map((c, i) => [c, r[i] ?? '']))) : []), [ds])
  const checked = useMemo(() => {
    if (step !== 'check' || !file) return []
    const phones = new Set(db.leads.map((l) => l.phone)), emails = new Set(db.leads.map((l) => l.email.toLowerCase()).filter(Boolean))
    return checkRows(rows, map, { phones, emails }, file.name)
  }, [step, rows, map, db.leads, file])
  const count = (s: RowCheck['status']) => checked.filter((r) => r.status === s).length

  const reset = () => { setStep('file'); setFile(null); setSheets([]); setSheet(0); setMap({}); setShow('all') }
  const close = () => { reset(); onClose() }
  const choose = async (f: File) => {
    if (f.size > MAX_FILE_BYTES) return toast('error', `${f.name} is larger than 25 MB.`)
    setBusy(true)
    try {
      const list = (await parseFile(f, me.id)).filter((d) => d.rows.length)
      if (!list.length) throw new Error('The file has no rows under its header.')
      setFile({ name: f.name, size: f.size }); setSheets(list); setSheet(0)
      const first = list[0]!
      setMap(autoMap(first.columns, first.rows.map((r) => Object.fromEntries(first.columns.map((c, i) => [c, r[i] ?? ''])))))
      setStep('map')
    } catch (e) { toast('error', e instanceof Error ? e.message : 'The file could not be read.') } finally { setBusy(false) }
  }
  const pickSheet = (i: number) => {
    const d = sheets[i]!
    setSheet(i)
    setMap(autoMap(d.columns, d.rows.map((r) => Object.fromEntries(d.columns.map((c, j) => [c, r[j] ?? ''])))))
  }
  const importValid = async () => {
    const valid = checked.filter((r) => r.status === 'Valid').map((r) => r.lead)
    const n = await run(() => importLeadBatch(me, { name: file!.name, size: file!.size, totalRows: rows.length }, valid))
    if (typeof n === 'number') { toast('success', `${n} lead(s) imported from ${file!.name} — they're unassigned, ready to hand out.`); close() }
  }

  const missing = LEAD_FIELDS.filter((f) => f.required && !map[f.id])
  return (
    <Modal open={open} onClose={close} size="xl" title="Upload leads"
      subtitle={file ? `${file.name} · ${fileSize(file.size)} · ${rows.length} row(s)` : 'Excel (.xlsx, .xls) or CSV — the first row is the header'}
      footer={step === 'file' ? <Button variant="outline" onClick={close}>Cancel</Button>
        : step === 'map' ? <><Button variant="outline" icon={ArrowLeft} onClick={reset}>Another file</Button><Button disabled={!!missing.length} onClick={() => setStep('check')}>Check rows</Button></>
          : <><Button variant="outline" icon={ArrowLeft} onClick={() => setStep('map')}>Back to columns</Button><Button icon={Upload} disabled={!count('Valid')} onClick={importValid}>Import {count('Valid')} valid lead(s)</Button></>}>
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) choose(f) }} />

      {step === 'file' && (
        <div className="grid place-items-center rounded-2xl border-2 border-dashed border-line px-6 py-12 text-center">
          <FileSpreadsheet className="mb-3 size-10 text-ok" />
          <p className="font-semibold">Choose a lead sheet</p>
          <p className="mt-1 max-w-md text-sm text-mute">Columns such as Name, Phone / Mobile, Company, Email, City, State, Source, Industry, Turnover, Funding amount and Timestamp are matched for you. Every other column is kept on the lead.</p>
          <Button className="mt-5" icon={Upload} loading={busy} onClick={() => input.current?.click()}>Choose file</Button>
        </div>
      )}

      {step === 'map' && ds && (
        <div className="space-y-4">
          {sheets.length > 1 && (
            <Select label="Sheet" value={sheet} onChange={(e) => pickSheet(Number(e.target.value))}>
              {sheets.map((d, i) => <option key={d.id} value={i}>{d.sheet ?? d.name} · {d.rows.length} rows</option>)}
            </Select>
          )}
          <p className="text-sm text-mute">Each lead field takes one column of the file. Columns you leave out are still kept on the lead (as “more details”).</p>
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {LEAD_FIELDS.map((f) => (
              <Select key={f.id} label={`${f.label}${f.required ? ' *' : ''}`} value={map[f.id] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [f.id]: e.target.value || undefined }))}
                hint={map[f.id] && rows[0]?.[map[f.id]!] ? `e.g. ${rows[0][map[f.id]!]!.slice(0, 40)}` : undefined}>
                <option value="">— Not in this file —</option>
                {ds.columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            ))}
          </div>
          {missing.length > 0 && <p className="text-sm font-semibold text-bad">Pick the column for: {missing.map((f) => f.label).join(', ')}.</p>}
        </div>
      )}

      {step === 'check' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {(['Valid', 'Duplicate', 'Invalid'] as const).map((s) => (
              <Card key={s} className="p-3"><p className="text-xs text-mute">{s}</p><p className={cx('text-2xl font-extrabold', s === 'Valid' ? 'text-ok' : s === 'Duplicate' ? 'text-warn' : 'text-bad')}>{count(s)}</p></Card>
            ))}
          </div>
          <Tabs value={show} onChange={setShow} tabs={[{ id: 'all', label: 'All', count: checked.length }, { id: 'Valid', label: 'Valid', count: count('Valid') }, { id: 'Duplicate', label: 'Duplicates', count: count('Duplicate') }, { id: 'Invalid', label: 'Invalid', count: count('Invalid') }]} />
          <div className="max-h-[45vh] overflow-auto rounded-xl border border-line">
            <Table>
              <thead><tr><Th>#</Th><Th>Check</Th><Th>Name</Th><Th>Phone</Th><Th>Company</Th><Th>Email</Th><Th>Source</Th></tr></thead>
              <tbody>
                {checked.map((r, i) => ({ r, i })).filter(({ r }) => show === 'all' || r.status === show).slice(0, 300).map(({ r, i }) => (
                  <tr key={i}>
                    <Td className="text-xs text-mute">{i + 2}</Td>
                    <Td><Badge tone={TONE[r.status]}>{r.status}</Badge>{r.reason && <span className="block text-[11px] text-mute">{r.reason}</span>}</Td>
                    <Td className="font-semibold">{r.lead.name || '—'}</Td>
                    <Td className="font-mono text-xs">{r.lead.phone || '—'}</Td>
                    <Td className="text-xs">{r.lead.company || '—'}</Td>
                    <Td className="text-xs">{r.lead.email || '—'}</Td>
                    <Td className="text-xs">{r.lead.source}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p className="text-xs text-mute">Row numbers match the sheet (row 1 is the header). Only valid rows are imported; duplicates and invalid rows are skipped.</p>
        </div>
      )}
    </Modal>
  )
}

/** Every uploaded sheet: how many of its leads are still in the CRM; a whole batch can be deleted. */
export function LeadUploadHistory() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const ups = db.leadUploads ?? []
  const inDb = useMemo(() => { const m = new Map<string, number>(); for (const l of db.leads) if (l.uploadId) m.set(l.uploadId, (m.get(l.uploadId) ?? 0) + 1); return m }, [db.leads])
  if (!ups.length) return <EmptyState icon={FileSpreadsheet} title="No uploads yet" text="Sheets you upload appear here, with their leads." />
  return (
    <>
      <Table>
        <thead><tr><Th>File</Th><Th className="text-right">Rows</Th><Th className="text-right">Imported</Th><Th className="text-right">Leads in CRM</Th><Th>Size</Th><Th>Uploaded by</Th><Th>Uploaded</Th><Th className="text-right">Action</Th></tr></thead>
        <tbody>
          {ups.map((u) => (
            <tr key={u.id}>
              <Td className="font-semibold"><FileSpreadsheet className="mr-1.5 inline size-4 text-ok" />{u.fileName}</Td>
              <Td className="text-right tabular-nums">{u.totalRows}</Td>
              <Td className="text-right tabular-nums">{u.imported}</Td>
              <Td className="text-right tabular-nums">{inDb.get(u.id) ?? 0}</Td>
              <Td className="text-xs">{fileSize(u.size)}</Td>
              <Td className="text-xs">{userName(db, u.by)}</Td>
              <Td className="text-xs">{fmtDateTime(u.at)}</Td>
              <Td className="text-right">
                <Button size="sm" variant="ghost" icon={Trash2} className="text-bad" onClick={async () => {
                  if (await confirm(`Delete ${u.fileName}?`, `The ${inDb.get(u.id) ?? 0} lead(s) from this upload are deleted with it, with their calls and history.`, true)) run(() => deleteLeadUpload(me, u.id), 'Upload deleted')
                }}>Delete batch</Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {confirmNode}
      <p className="flex items-center gap-1.5 p-3 text-xs text-mute"><CheckCircle2 className="size-3.5 text-ok" />Uploaded leads start unassigned — hand them out from the Unassigned tab.</p>
    </>
  )
}

export type { LeadField }
