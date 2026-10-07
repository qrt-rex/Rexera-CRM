import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, ArrowRight, CheckCircle2, DatabaseZap, FileCode2, FolderOpen, ListChecks, Paperclip, Repeat, ShieldOff, Square, TriangleAlert, Upload, Users, XCircle } from 'lucide-react'
import { getDb, useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { copyLegacyFiles, importLegacy, type CopyProgress } from '../../lib/itops'
import { buildImport, parseDump, pickDumps, type DumpTables, type ImportReport } from '../../lib/legacyImport'
import { legacyFileId, planFiles, uploadsPaths, type FilePlan } from '../../lib/legacyFiles'
import { fileSize, storageRoom, storedLegacyIds } from '../../lib/files'
import { fmtDateTime } from '../../lib/format'
import { FileLink } from '../../components/FileField'
import { Badge, Button, Card, CardHeader, Checkbox, PageHeader, Progress, SearchBox, Stat, Table, Td, Th, useConfirm, usePaged, useRun } from '../../components/ui'

const LABELS: Record<string, string> = {
  clientFiles: 'Client files', payments: 'Payment instalments', users: 'New users', usersMatched: 'Users matched by email',
  services: 'New services', leads: 'Leads', notifications: 'Notifications', documents: 'Documents', invoices: 'Old invoices',
}
/** Let React paint the spinner before the heavy, synchronous work starts. */
const nextFrame = () => new Promise((r) => setTimeout(r, 30))
const gb = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : fileSize(n))

interface Picked { names: string[]; size: number; tables: DumpTables; billing?: DumpTables; billingName?: string; notes: string[] }

export default function LegacyImport() {
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<Picked | null>(null)
  const [replaceSample, setReplaceSample] = useState(true)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState<'' | 'read' | 'import'>('')
  const [done, setDone] = useState<ImportReport | null>(null)

  const preview = (f: Picked, replaceSampleData: boolean) => buildImport(f.tables, getDb(), { replaceSampleData, billing: f.billing }).report

  const pick = async (list: File[]) => {
    setBusy('read'); setDone(null); setReport(null)
    await nextFrame()
    const ok = await run(async () => {
      const read = await Promise.all(list.map(async (f) => ({ name: f.name, size: f.size, tables: parseDump(await f.text()) })))
      const { main, billing, notes } = pickDumps(read)
      const picked: Picked = { names: read.map((x) => x.name), size: read.reduce((s, x) => s + x.size, 0), tables: main.tables, billing: billing?.tables, billingName: billing?.name, notes }
      setReport(preview(picked, replaceSample))
      setFile(picked)
    })
    if (!ok) setFile(null)
    setBusy('')
  }
  const toggleSample = async (v: boolean) => {
    setReplaceSample(v)
    if (file) { await nextFrame(); await run(() => setReport(preview(file, v))) }
  }
  const doImport = async () => {
    if (!file || !report) return
    const files = report.imported.clientFiles ?? 0
    if (!(await confirm('Import the old CRM data?', `${files.toLocaleString('en-IN')} client files, ${report.imported.users ?? 0} new users and their payments, comments and documents are added${report.imported.invoices ? `, plus ${report.imported.invoices} old invoices` : ''}${replaceSample ? ', and the sample (demo) files and users are removed' : ''}. A snapshot of today's data is saved first, so you can undo from Data Backup & Restore.`, true))) return
    setBusy('import')
    await nextFrame()
    const r = await run(() => importLegacy(me, file.tables, { replaceSampleData: replaceSample, billing: file.billing }, file.names.join(' + ')), 'Old CRM data imported')
    if (r && typeof r === 'object') { setDone(r); setReport(null); setFile(null) }
    setBusy('')
  }

  const failed = report?.checks.filter((c) => !c.ok) ?? []

  return (
    <div>
      <PageHeader title="Import from old CRM" subtitle="Bring every client file, payment, comment, user, invoice and uploaded file over from the old PHP CRM — exactly as it was" icon={DatabaseZap} />

      {done && (
        <Card className="mb-6 border-ok/40 p-5">
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid size-12 place-items-center rounded-2xl bg-ok-soft text-ok"><CheckCircle2 className="size-6" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-extrabold">Import finished — all {done.checks.length} checks matched</p>
              <p className="text-sm text-mute">{(done.imported.clientFiles ?? 0).toLocaleString('en-IN')} client files and {done.imported.users ?? 0} users are now in the CRM. Next, attach the uploaded files in step 4 below. Imported users can't sign in until IT gives them a password with “Reset a password” on the IT dashboard.</p>
            </div>
            <Link to="/bookings"><Button icon={ArrowRight}>Open client files</Button></Link>
            <Link to="/dashboard/it"><Button variant="outline" icon={Users}>Set user passwords</Button></Link>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="1 · Choose the old CRM dump" subtitle="The .sql file(s) exported from phpMyAdmin — the CRM database (u417368936_crm), and the billing database (u417368936_bill) too if you have it" icon={FileCode2} />
          <div className="space-y-4 p-5">
            <input ref={input} type="file" multiple accept=".sql,application/sql,text/plain" className="hidden" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) pick(f) }} />
            <div className="flex flex-wrap items-center gap-3">
              <Button icon={Upload} loading={busy === 'read'} onClick={() => input.current?.click()}>{file ? 'Choose different files' : 'Choose .sql file(s)'}</Button>
              {file && <span className="text-sm"><b>{file.names.join(' + ')}</b> <span className="text-mute">· {(file.size / 1048576).toFixed(1)} MB · {Object.keys(file.tables).length} tables{file.billingName ? ` · billing: ${file.billingName}` : ''}</span></span>}
            </div>
            {file?.notes.map((n) => <p key={n} className="rounded-xl bg-info-soft px-3 py-2 text-xs text-info">{n}</p>)}
            <Checkbox checked={replaceSample} onChange={toggleSample} label="Remove the sample (demo) client files and sample users — keep the real login accounts" />
            <p className="text-xs text-mute">Choose both dumps together (Ctrl-click): client files come from the newest one; the billing dump adds the old invoices. Files are read only in this browser; nothing is uploaded anywhere. Importing again updates the same records instead of making duplicates — files already attached stay attached.</p>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Never imported" icon={ShieldOff} />
          <ul className="space-y-2 p-5 text-sm text-mute">
            <li>• Passwords — the old system stored them as plain text</li>
            <li>• Login tokens, magic links, OTP codes, trusted IPs</li>
            <li>• Web-server files in the uploads folder (.htaccess, index.html)</li>
          </ul>
        </Card>
      </div>

      {report && (
        <>
          <div className="my-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Object.entries(report.imported).map(([k, v]) => <Stat key={k} label={LABELS[k] ?? k} value={v.toLocaleString('en-IN')} icon={DatabaseZap} tone={k === 'clientFiles' ? 'violet' : 'navy'} />)}
          </div>

          <Card className="mb-6 overflow-hidden">
            <CardHeader title="2 · Verification — old CRM vs. what will be imported" subtitle="Every count and rupee total is recomputed from the imported records" icon={ListChecks}
              action={failed.length ? <Badge tone="red">{failed.length} mismatch</Badge> : <Badge tone="green">All {report.checks.length} match</Badge>} />
            <Table>
              <thead><tr><Th>Check</Th><Th>Old CRM</Th><Th>After import</Th><Th className="w-24">Result</Th></tr></thead>
              <tbody>
                {report.checks.map((c) => (
                  <tr key={c.label}>
                    <Td className="font-semibold">{c.label}</Td><Td>{c.legacy}</Td><Td>{c.imported}</Td>
                    <Td>{c.ok ? <Badge tone="green"><CheckCircle2 className="size-3" />Match</Badge> : <Badge tone="red"><XCircle className="size-3" />Differs</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader title="How old statuses are read" subtitle="The original text is always kept on the file" icon={Repeat} />
              <ul className="max-h-80 divide-y divide-line/70 overflow-y-auto text-sm">
                {report.statusMap.map((s) => (
                  <li key={s.legacy + s.becomes} className="flex items-center gap-3 px-5 py-2">
                    <span className="w-14 text-right font-bold tabular-nums">{s.count.toLocaleString('en-IN')}</span>
                    <span className="min-w-0 flex-1 truncate">{s.legacy || <i className="text-mute">(empty)</i>}</span>
                    <ArrowRight className="size-3.5 text-mute" /><span className="font-semibold">{s.becomes}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="overflow-hidden">
              <CardHeader title="How old roles are read" icon={Users} />
              <ul className="divide-y divide-line/70 text-sm">
                {report.roleMap.map((r) => (
                  <li key={r.legacy} className="flex items-center gap-3 px-5 py-2">
                    <span className="w-14 text-right font-bold tabular-nums">{r.count}</span>
                    <span className="min-w-0 flex-1 truncate">{r.legacy}</span>
                    <ArrowRight className="size-3.5 text-mute" /><span className="font-semibold">{r.becomes}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {(report.notes.length > 0 || report.skipped.length > 0) && (
            <Card className="mb-6 overflow-hidden">
              <CardHeader title="Notes" icon={TriangleAlert} />
              <ul className="space-y-1.5 p-5 text-sm">
                {report.notes.map((n) => <li key={n}>• {n}</li>)}
                {report.skipped.map((n) => <li key={n} className="text-mute">• Skipped: {n}</li>)}
              </ul>
            </Card>
          )}

          <Card className="mb-6 flex flex-wrap items-center gap-4 p-5">
            <div className="min-w-0 flex-1">
              <p className="font-bold">3 · Import</p>
              <p className="text-sm text-mute">{failed.length ? 'Import is blocked until every check matches.' : 'A snapshot of today’s data is saved first. The checks run again during the import; if anything differs, nothing changes.'}</p>
            </div>
            <Button size="lg" icon={DatabaseZap} loading={busy === 'import'} disabled={!!failed.length || !!busy} onClick={doImport}>Import now</Button>
          </Card>
        </>
      )}

      <AttachFiles />
      <UnlinkedFiles />
      {confirmNode}
    </div>
  )
}

/** Step 4: the old uploads folder → payment proofs, documents and agreements on the imported client files. */
function AttachFiles() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const folder = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'' | 'read' | 'copy'>('')
  const [picked, setPicked] = useState<{ name: string; plan: FilePlan; source: Map<string, File>; stored: number; storedBytes: number; free: number | null } | null>(null)
  const [progress, setProgress] = useState<CopyProgress | null>(null)
  const [result, setResult] = useState<Awaited<ReturnType<typeof copyLegacyFiles>> | null>(null)
  const stop = useRef<AbortController | null>(null)
  const imported = db.bookings.filter((b) => b.id.startsWith('lg-')).length

  const choose = async (files: File[]) => {
    setBusy('read'); setResult(null); setProgress(null)
    await nextFrame()
    await run(async () => {
      const paths = uploadsPaths(files.map((f) => f.webkitRelativePath || f.name))
      const disk = files.map((f, i) => ({ path: paths[i]!, size: f.size, lastModified: f.lastModified, f })).filter((x) => x.path)
      if (!disk.length) throw new Error('No uploaded files found in that folder. Choose the export folder (scarp_data), its all_uploads_raw folder, or the old server’s uploads folder.')
      const plan = planFiles(getDb(), disk)
      const source = new Map(disk.map((x) => [legacyFileId(x.path), x.f]))
      const have = await storedLegacyIds()
      const already = plan.files.filter((f) => have.has(f.id))
      const room = await storageRoom()
      setPicked({ name: files[0]?.webkitRelativePath.split('/')[0] ?? 'folder', plan, source, stored: already.length, storedBytes: already.reduce((s, f) => s + f.size, 0), free: room.free })
    })
    setBusy('')
  }
  const copy = async () => {
    if (!picked) return
    const left = picked.plan.stats.bytes - picked.storedBytes
    if (!(await confirm('Copy the old CRM files into the CRM?', `${(picked.plan.files.length - picked.stored).toLocaleString('en-IN')} files (${gb(left)}) are copied into this browser and attached to the client files. It can take several minutes — keep this tab open. You can stop and continue later; nothing is copied twice.`))) return
    setBusy('copy')
    stop.current = new AbortController()
    const r = await run(() => copyLegacyFiles(me, picked.plan, picked.source, setProgress, stop.current!.signal))
    if (r && typeof r === 'object') { setResult(r); setPicked(null) }
    setBusy(''); stop.current = null
  }

  const s = picked?.plan.stats
  const pct = progress && progress.totalBytes ? Math.round((progress.bytes / progress.totalBytes) * 100) : 0
  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader title="4 · Attach the uploaded files" subtitle="Payment screenshots, client documents and signed agreements from the old CRM’s uploads folder — each goes to its client file" icon={Paperclip} />
      <div className="space-y-4 p-5">
        <input ref={(el) => { folder.current = el; el?.setAttribute('webkitdirectory', '') }} type="file" multiple className="hidden"
          onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) choose(f) }} />
        {!imported ? (
          <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">Import the client files first (steps 1–3); the files are matched to them.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={FolderOpen} loading={busy === 'read'} disabled={busy === 'copy'} onClick={() => folder.current?.click()}>{picked ? 'Choose a different folder' : 'Choose the export folder'}</Button>
            <span className="text-xs text-mute">The whole export folder (e.g. <b>scarp_data</b>), its <b>all_uploads_raw</b> folder, or the old server’s <b>uploads</b> folder. The browser asks you to confirm the upload — files are only copied into this browser.</span>
          </div>
        )}

        {s && picked && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="Payment proofs" value={s.proofs.toLocaleString('en-IN')} sub={`${s.shotDocs.toLocaleString('en-IN')} more as receipt documents`} icon={Paperclip} tone="green" />
              <Stat label="Client documents" value={`${s.docs} / ${s.docsExpected}`} sub={s.uploads ? `+${s.uploads} from client folders` : 'into their Document Forms slot'} icon={Paperclip} tone="navy" />
              <Stat label="Signed agreements" value={s.agreements.toLocaleString('en-IN')} sub={`on ${s.agreementLinks.toLocaleString('en-IN')} client files`} icon={Paperclip} tone="violet" />
              <Stat label="Kept as unlinked" value={s.archived.toLocaleString('en-IN')} sub={gb(s.archivedBytes)} icon={Archive} tone="orange" />
              <Stat label="To copy" value={gb(s.bytes - picked.storedBytes)} sub={`${(picked.plan.files.length - picked.stored).toLocaleString('en-IN')} files${picked.stored ? ` · ${picked.stored.toLocaleString('en-IN')} already copied` : ''}`} icon={FolderOpen} tone="navy" />
            </div>
            <ul className="space-y-1 text-sm">
              {picked.plan.notes.map((n) => <li key={n}>• {n}</li>)}
              {picked.plan.missing.length > 0 && <li className="text-warn">• {picked.plan.missing.length} file(s) the client files refer to are not in this folder (e.g. {picked.plan.missing.slice(0, 3).map((m) => m.ref).join(', ')}) — their names stay on the files.</li>}
              {picked.free != null && <li className={picked.free < s.bytes - picked.storedBytes ? 'font-semibold text-bad' : 'text-mute'}>• This browser can still store {gb(picked.free)}{picked.free < s.bytes - picked.storedBytes ? ' — not enough: free disk space on this computer first' : ''}.</li>}
            </ul>
          </>
        )}

        {busy === 'copy' && progress && (
          <div className="space-y-2 rounded-2xl border border-line p-4">
            <div className="flex items-center justify-between text-sm"><b>Copying… {progress.done.toLocaleString('en-IN')} of {progress.total.toLocaleString('en-IN')} files</b><span className="text-mute">{gb(progress.bytes)} of {gb(progress.totalBytes)} · {pct}%</span></div>
            <Progress value={pct} tone="green" />
            <p className="text-xs text-mute">Keep this tab open. Stopping keeps what is copied and attaches it; choose the folder again later to continue.</p>
          </div>
        )}

        {picked && (
          <div className="flex flex-wrap gap-3">
            <Button size="lg" icon={Paperclip} loading={busy === 'copy'} disabled={!!busy || (picked.free != null && picked.free < (s!.bytes - picked.storedBytes))} onClick={copy}>
              {picked.stored ? 'Continue copying & attach' : 'Copy & attach files'}
            </Button>
            {busy === 'copy' && <Button size="lg" variant="outline" icon={Square} onClick={() => stop.current?.abort()}>Stop</Button>}
          </div>
        )}

        {result && (
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-ok/40 bg-ok-soft/40 p-4">
            <CheckCircle2 className="size-6 text-ok" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-bold">{result.stopped ? 'Stopped' : 'Done'} — {result.done.toLocaleString('en-IN')} files copied ({gb(result.bytes)}){result.skipped ? `, ${result.skipped.toLocaleString('en-IN')} were already there` : ''}</p>
              <p className="text-mute">{result.linked.toLocaleString('en-IN')} attachments on client files · {result.archived.toLocaleString('en-IN')} kept as unlinked{result.stopped ? ' · choose the folder again to copy the rest' : ''}</p>
            </div>
            <Link to="/bookings"><Button variant="outline" icon={ArrowRight}>Open client files</Button></Link>
          </div>
        )}
      </div>
      {confirmNode}
    </Card>
  )
}

/** Old uploads no client file refers to — kept so nothing is lost. */
function UnlinkedFiles() {
  const db = useDb()
  const [q, setQ] = useState('')
  const all = db.legacyFiles ?? []
  const list = useMemo(() => all.filter((f) => !q || `${f.path} ${f.kind}`.toLowerCase().includes(q.toLowerCase())), [all, q])
  const { slice, pager } = usePaged(list, 25, [q])
  if (!all.length) return null
  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader title="Unlinked old CRM files" subtitle={`${all.length.toLocaleString('en-IN')} uploads no client file refers to (replaced screenshots, deleted entries) — kept so nothing is lost`} icon={Archive}
        action={<SearchBox value={q} onChange={setQ} placeholder="Search file name…" className="w-56" />} />
      <Table>
        <thead><tr><Th>File</Th><Th>What it looks like</Th><Th>Uploaded</Th><Th className="text-right">Size</Th></tr></thead>
        <tbody>
          {slice.map((f) => (
            <tr key={f.path}>
              <Td><FileLink file={f.file} label={f.path} /></Td>
              <Td className="text-xs text-mute">{f.kind}</Td>
              <Td className="text-xs">{fmtDateTime(f.file.at)}</Td>
              <Td className="text-right text-xs">{fileSize(f.file.size)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {pager}
    </Card>
  )
}
