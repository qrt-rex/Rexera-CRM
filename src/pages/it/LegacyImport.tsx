import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, DatabaseZap, FileCode2, ListChecks, Repeat, ShieldOff, TriangleAlert, Upload, Users, XCircle } from 'lucide-react'
import { getDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { importLegacy } from '../../lib/itops'
import { buildImport, parseDump, type DumpTables, type ImportReport } from '../../lib/legacyImport'
import { Badge, Button, Card, CardHeader, Checkbox, PageHeader, Stat, Table, Td, Th, useConfirm, useRun } from '../../components/ui'

const LABELS: Record<string, string> = {
  clientFiles: 'Client files', payments: 'Payment instalments', users: 'New users', usersMatched: 'Users matched by email',
  services: 'New services', leads: 'Leads', notifications: 'Notifications', documents: 'Documents',
}
/** Let React paint the spinner before the heavy, synchronous work starts. */
const nextFrame = () => new Promise((r) => setTimeout(r, 30))

export default function LegacyImport() {
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; size: number; tables: DumpTables } | null>(null)
  const [replaceSample, setReplaceSample] = useState(true)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState<'' | 'read' | 'import'>('')
  const [done, setDone] = useState<ImportReport | null>(null)

  const preview = (tables: DumpTables, replaceSampleData: boolean) => buildImport(tables, getDb(), { replaceSampleData }).report

  const pick = async (f: File) => {
    setBusy('read'); setDone(null); setReport(null)
    await nextFrame()
    const ok = await run(async () => {
      const tables = parseDump(await f.text())
      setReport(preview(tables, replaceSample))
      setFile({ name: f.name, size: f.size, tables })
    })
    if (!ok) setFile(null)
    setBusy('')
  }
  const toggleSample = async (v: boolean) => {
    setReplaceSample(v)
    if (file) { await nextFrame(); await run(() => setReport(preview(file.tables, v))) }
  }
  const doImport = async () => {
    if (!file || !report) return
    const files = report.imported.clientFiles ?? 0
    if (!(await confirm('Import the old CRM data?', `${files.toLocaleString('en-IN')} client files, ${report.imported.users ?? 0} new users and their payments, comments and documents are added${replaceSample ? ', and the sample (demo) files and users are removed' : ''}. A snapshot of today's data is saved first, so you can undo from Data Backup & Restore.`, true))) return
    setBusy('import')
    await nextFrame()
    const r = await run(() => importLegacy(me, file.tables, { replaceSampleData: replaceSample }, file.name), 'Old CRM data imported')
    if (r && typeof r === 'object') { setDone(r); setReport(null); setFile(null) }
    setBusy('')
  }

  const failed = report?.checks.filter((c) => !c.ok) ?? []

  return (
    <div>
      <PageHeader title="Import from old CRM" subtitle="Bring every client file, payment, comment and user over from the old PHP CRM — exactly as it was" icon={DatabaseZap} />

      {done && (
        <Card className="mb-6 border-ok/40 p-5">
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid size-12 place-items-center rounded-2xl bg-ok-soft text-ok"><CheckCircle2 className="size-6" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-extrabold">Import finished — all {done.checks.length} checks matched</p>
              <p className="text-sm text-mute">{(done.imported.clientFiles ?? 0).toLocaleString('en-IN')} client files and {done.imported.users ?? 0} users are now in the CRM. Imported users can't sign in until IT gives them a password with “Reset a password” on the IT dashboard; they should change it in Settings → Security right after.</p>
            </div>
            <Link to="/bookings"><Button icon={ArrowRight}>Open client files</Button></Link>
            <Link to="/dashboard/it"><Button variant="outline" icon={Users}>Set user passwords</Button></Link>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="1 · Choose the old CRM dump" subtitle="The .sql file exported from phpMyAdmin (database u417368936_crm)" icon={FileCode2} />
          <div className="space-y-4 p-5">
            <input ref={input} type="file" accept=".sql,application/sql,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f) }} />
            <div className="flex flex-wrap items-center gap-3">
              <Button icon={Upload} loading={busy === 'read'} onClick={() => input.current?.click()}>{file ? 'Choose a different file' : 'Choose .sql file'}</Button>
              {file && <span className="text-sm"><b>{file.name}</b> <span className="text-mute">· {(file.size / 1048576).toFixed(1)} MB · {Object.keys(file.tables).length} tables</span></span>}
            </div>
            <Checkbox checked={replaceSample} onChange={toggleSample} label="Remove the sample (demo) client files and sample users — keep the real login accounts" />
            <p className="text-xs text-mute">The file is read only in this browser; nothing is uploaded anywhere. Importing the same dump again updates the same records instead of making duplicates.</p>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Never imported" icon={ShieldOff} />
          <ul className="space-y-2 p-5 text-sm text-mute">
            <li>• Passwords — the old system stored them as plain text</li>
            <li>• Login tokens, magic links, OTP codes, trusted IPs</li>
            <li>• Uploaded files themselves — their names and old paths are kept on each file</li>
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

          <Card className="flex flex-wrap items-center gap-4 p-5">
            <div className="min-w-0 flex-1">
              <p className="font-bold">3 · Import</p>
              <p className="text-sm text-mute">{failed.length ? 'Import is blocked until every check matches.' : 'A snapshot of today’s data is saved first. The checks run again during the import; if anything differs, nothing changes.'}</p>
            </div>
            <Button size="lg" icon={DatabaseZap} loading={busy === 'import'} disabled={!!failed.length || !!busy} onClick={doImport}>Import now</Button>
          </Card>
        </>
      )}
      {confirmNode}
    </div>
  )
}
