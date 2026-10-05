import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, DatabaseBackup, Download, History, Lock, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { createSnapshot, deleteSnapshot, downloadBackup, listSnapshots, readBackupFile, restoreBackup, restoreSnapshot, type SnapshotInfo } from '../../lib/itops'
import { fmtDateTime } from '../../lib/format'
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, Input, Modal, PageHeader, useConfirm, useRun } from '../../components/ui'

const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export function useSnapshots() {
  const [list, setList] = useState<SnapshotInfo[]>([])
  const reload = useCallback(() => { listSnapshots().then(setList, () => setList([])) }, [])
  useEffect(() => { reload() }, [reload])
  return { list, reload }
}

export default function Backup() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const snaps = useSnapshots()
  const [encrypt, setEncrypt] = useState(true)
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState('')
  const [pending, setPending] = useState<{ file: File; needsPass: boolean } | null>(null)
  const [restorePass, setRestorePass] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const doDownload = async () => {
    setBusy('download')
    await run(() => downloadBackup(me, encrypt ? pass : undefined), 'Backup downloaded')
    setBusy('')
  }
  const doSnapshot = async () => { setBusy('snap'); await run(() => createSnapshot(me, 'Manual snapshot'), 'Snapshot saved'); snaps.reload(); setBusy('') }

  const pickFile = async (file: File) => {
    const r = await run(() => readBackupFile(file))
    if (r === 'needs-passphrase') { setPending({ file, needsPass: true }); setRestorePass('') }
    else if (r && typeof r === 'object') { setPending({ file, needsPass: false }) }
  }
  const doRestore = async () => {
    if (!pending) return
    const b = await run(() => readBackupFile(pending.file, pending.needsPass ? restorePass : undefined))
    if (!b || typeof b !== 'object') return
    if (!(await confirm('Replace all data with this backup?', `Everything in the CRM is replaced by “${pending.file.name}” (exported ${new Date(b.exportedAt).toLocaleString('en-IN')} by ${b.exportedBy}). A snapshot of the current data is taken first so you can undo.`, true))) return
    setBusy('restore')
    if (await run(() => restoreBackup(me, b, pending.file.name), 'Backup restored')) { setPending(null); snaps.reload() }
    setBusy('')
  }

  return (
    <div>
      <PageHeader title="Data Backup & Restore" subtitle="Everything in the CRM plus imported recruitment tables, in one file" icon={DatabaseBackup} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden">
          <CardHeader title="Download a backup" icon={Download} />
          <div className="space-y-4 p-5">
            <Checkbox checked={encrypt} onChange={setEncrypt} label={<span className="flex items-center gap-1.5"><Lock className="size-3.5" />Encrypt with a passphrase (recommended)</span>} />
            {encrypt && <Input label="Passphrase" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} hint="At least 8 characters. Without it the backup can't be opened — keep it safe." />}
            <p className="text-xs text-mute">Backups contain password hashes and client data. Encrypted files use AES-256.</p>
            <Button className="w-full" icon={Download} loading={busy === 'download'} disabled={encrypt && pass.length < 8} onClick={doDownload}>Download backup</Button>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Restore from a file" icon={Upload} />
          <div className="space-y-4 p-5">
            <input ref={input} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickFile(f) }} />
            <p className="text-sm text-mute">Pick a Rexera backup (.json). The file is checked before anything changes, and a snapshot of today's data is saved first.</p>
            <Button className="w-full" variant="outline" icon={Upload} onClick={() => input.current?.click()}>Choose backup file</Button>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Snapshots in this browser" subtitle="Last 10 kept · one automatic snapshot a day" icon={Camera} />
          <div className="p-5"><Button className="w-full" variant="soft" icon={Camera} loading={busy === 'snap'} onClick={doSnapshot}>Take snapshot now</Button></div>
          <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto border-t border-line">
            {!snaps.list.length && <li className="p-5 text-sm text-mute">No snapshots yet.</li>}
            {snaps.list.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-5 py-2.5">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{s.label}</p><p className="text-[11px] text-mute">{fmtDateTime(s.at)} · {kb(s.bytes)}</p></div>
                <Button size="sm" variant="ghost" icon={RotateCcw} aria-label="Restore snapshot" title="Restore" onClick={async () => {
                  if (await confirm('Restore this snapshot?', `All data goes back to “${s.label}” (${fmtDateTime(s.at)}). Today's data is snapshotted first.`, true)) {
                    if (await run(() => restoreSnapshot(me, s.id), 'Snapshot restored')) snaps.reload()
                  }
                }} />
                <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete snapshot" className="text-bad" onClick={async () => { if (await confirm('Delete snapshot?', s.label, true)) { await run(() => deleteSnapshot(me, s.id)); snaps.reload() } }} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <CardHeader title="Backup history" icon={History} />
        {!db.backupLog.length ? <EmptyState icon={History} title="No backups yet" /> : (
          <ul className="divide-y divide-line/70 text-sm">
            {db.backupLog.slice(0, 30).map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <Badge tone={b.kind === 'RESTORE' ? 'red' : b.kind === 'DOWNLOAD' ? 'navy' : 'green'}>{b.kind.toLowerCase().replace('_', ' ')}</Badge>
                {b.encrypted && <Badge tone="violet"><Lock className="size-3" />encrypted</Badge>}
                <span className="min-w-0 flex-1 truncate">{b.note}</span>
                <span className="text-xs text-mute">{kb(b.bytes)} · {userName(db, b.by)} · {fmtDateTime(b.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!pending} onClose={() => setPending(null)} title="Restore backup" subtitle={pending?.file.name}
        footer={<><Button variant="outline" onClick={() => setPending(null)}>Cancel</Button><Button variant="danger" icon={RotateCcw} loading={busy === 'restore'} disabled={!!pending?.needsPass && restorePass.length < 8} onClick={doRestore}>Restore</Button></>}>
        {pending?.needsPass
          ? <Input label="This backup is encrypted — passphrase" type="password" autoComplete="off" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} autoFocus />
          : <p className="text-sm text-mute">The file is a valid Rexera backup. Restoring replaces all current data; a snapshot of today's data is taken first.</p>}
      </Modal>
      {confirmNode}
    </div>
  )
}
