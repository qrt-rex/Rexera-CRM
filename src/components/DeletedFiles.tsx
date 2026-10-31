import { useMemo, useState } from 'react'
import { Braces, FileSpreadsheet, FileText, Paperclip, Trash2, Trash } from 'lucide-react'
import type { DeletedItem } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { userName } from '../lib/actions'
import { BACKUP_FORMATS, backupRows, downloadBackup, mayReviewDeleted, purgeDeleted, type BackupFormat } from '../lib/recycle'
import { FileLink } from './FileField'
import { fmtDateTime } from '../lib/format'
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, Modal, SearchBox, Select, Table, Td, Th, useConfirm, usePaged, useRun, useToast } from './ui'

const FORMAT: Record<BackupFormat, { label: string; icon: typeof FileText }> = { CSV: { label: 'CSV', icon: FileText }, EXCEL: { label: 'Excel', icon: FileSpreadsheet }, JSON: { label: 'JSON', icon: Braces } }

/**
 * IT Support dashboard → Deleted files: a backup of everything anyone deleted, in every module, downloadable as CSV,
 * Excel or JSON. Nothing is gone for good until IT Support deletes the backup here.
 */
export function DeletedFiles({ compact = false }: { compact?: boolean }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const [confirm, confirmNode] = useConfirm()
  const [q, setQ] = useState('')
  const [mod, setMod] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [view, setView] = useState<DeletedItem | null>(null)
  const items = db.deletedItems ?? []
  const modules = useMemo(() => [...new Set(items.map((x) => x.module))].sort(), [items])
  const ql = q.trim().toLowerCase()
  const list = items.filter((x) => (!mod || x.module === mod) && (!ql || `${x.label} ${x.kind} ${x.module} ${userName(db, x.deletedBy)}`.toLowerCase().includes(ql)))
  const { slice, pager } = usePaged(list, compact ? 8 : 25, [q, mod])
  if (!mayReviewDeleted(me)) return null

  const download = (x: DeletedItem, f: BackupFormat) => downloadBackup(x, f).catch((e: Error) => toast('error', e.message))
  const purge = async (ids: string[]) => {
    const one = ids.length === 1 ? items.find((x) => x.id === ids[0]) : undefined
    if (!await confirm(ids.length === 1 ? 'Delete this backup for good?' : `Delete ${ids.length} backups for good?`, `${one ? `${one.kind}: ${one.label}. ` : ''}The copy and its stored files are removed permanently and can’t be brought back. Download it first if it may be needed.`, true)) return false
    await run(() => purgeDeleted(me, ids), ids.length === 1 ? 'Deleted for good' : `${ids.length} backups deleted for good`)
    setPicked((p) => p.filter((id) => !ids.includes(id)))
    return true
  }

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader title="Deleted files" icon={Trash2}
        subtitle={`${items.length} backup${items.length === 1 ? '' : 's'} waiting for review — kept with their files until you delete them here`}
        action={picked.length > 0 && <Button size="sm" variant="danger" icon={Trash} onClick={() => purge(picked)}>Delete {picked.length} for good</Button>} />
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <SearchBox value={q} onChange={setQ} placeholder="Search name, type, module, person…" className="min-w-56 flex-1" />
          <Select aria-label="Module" value={mod} onChange={(e) => setMod(e.target.value)} className="w-48"><option value="">All modules</option>{modules.map((m) => <option key={m} value={m}>{m}</option>)}</Select>
        </div>
      )}
      {!list.length ? <EmptyState icon={Trash2} title={items.length ? 'Nothing matches' : 'Nothing deleted yet'} text={items.length ? undefined : 'When anyone deletes a document, lead, refund, task, asset or any other record, a backup appears here.'} /> : (
        <Table>
          <thead><tr>
            <Th className="w-10"><Checkbox label={<span className="sr-only">Select all shown</span>} checked={slice.length > 0 && slice.every((x) => picked.includes(x.id))} onChange={(on) => setPicked((p) => on ? [...new Set([...p, ...slice.map((x) => x.id)])] : p.filter((id) => !slice.some((x) => x.id === id)))} /></Th>
            <Th>File name</Th><Th>Module · type</Th><Th>Deleted by</Th><Th>Deletion date</Th><Th>Backup format</Th><Th className="text-right">Review</Th>
          </tr></thead>
          <tbody>
            {slice.map((x) => (
              <tr key={x.id}>
                <Td><Checkbox label={<span className="sr-only">Select {x.label}</span>} checked={picked.includes(x.id)} onChange={(on) => setPicked((p) => on ? [...p, x.id] : p.filter((id) => id !== x.id))} /></Td>
                <Td className="max-w-72"><button className="block max-w-full truncate text-left text-sm font-semibold hover:underline" onClick={() => setView(x)}>{x.label}</button>
                  <span className="text-[11px] text-mute">{x.rows} record{x.rows === 1 ? '' : 's'}{x.files?.length ? ` · ${x.files.length} file${x.files.length === 1 ? '' : 's'} kept` : ''}</span></Td>
                <Td className="text-xs"><Badge tone="gray">{x.module}</Badge> <span className="text-mute">{x.kind}</span></Td>
                <Td className="text-sm">{userName(db, x.deletedBy)}</Td>
                <Td className="whitespace-nowrap text-xs">{fmtDateTime(x.deletedAt)}</Td>
                <Td><div className="flex flex-wrap gap-1">{BACKUP_FORMATS.map((f) => <Button key={f} size="sm" variant="soft" icon={FORMAT[f].icon} onClick={() => download(x, f)}>{FORMAT[f].label}</Button>)}</div></Td>
                <Td className="text-right"><Button size="sm" variant="ghost" icon={Trash} className="text-bad" onClick={() => purge([x.id])}>Delete for good</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {pager}

      <Modal open={!!view} onClose={() => setView(null)} size="lg" title={view ? `${view.kind}: ${view.label}` : ''} subtitle={view && `${view.module} · deleted by ${userName(db, view.deletedBy)} on ${fmtDateTime(view.deletedAt)}`}
        footer={view && <>{BACKUP_FORMATS.map((f) => <Button key={f} variant="outline" icon={FORMAT[f].icon} onClick={() => download(view, f)}>{FORMAT[f].label}</Button>)}<Button variant="danger" icon={Trash} onClick={async () => { if (await purge([view.id])) setView(null) }}>Delete for good</Button></>}>
        {view && <div className="grid gap-3">
          {!!view.files?.length && <div className="rounded-xl border border-line p-3"><p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-mute"><Paperclip className="size-3.5" />Stored files kept with this backup</p><div className="flex flex-wrap gap-2">{view.files.map((f) => <FileLink key={f.id} file={f} />)}</div></div>}
          <div className="max-h-[50vh] overflow-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <tbody>{backupRows(view).slice(0, 50).flatMap((r, i) => Object.entries(r).map(([k, v], j) => (
                <tr key={`${i}-${k}`} className={j === 0 && i > 0 ? 'border-t-2 border-line' : 'border-t border-line/50'}><td className="w-40 bg-card2 px-3 py-1.5 align-top font-semibold text-mute">{k}</td><td className="break-all px-3 py-1.5">{String(v)}</td></tr>
              )))}</tbody>
            </table>
            {view.rows > 50 && <p className="px-3 py-2 text-xs text-mute">Showing 50 of {view.rows} records — download the backup for all of them.</p>}
          </div>
        </div>}
      </Modal>
      {confirmNode}
    </Card>
  )
}
