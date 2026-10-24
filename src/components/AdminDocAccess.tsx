import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileStack, KeyRound, Pencil, Save } from 'lucide-react'
import type { AdminStageId } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { canSetAdminStageAccess, setAdminStageAccess, usersWithRole } from '../lib/actions'
import { ADMIN_STAGES, workflowSettings } from '../../supabase/workflow-rules.mjs'
import { Avatar, Badge, Button, Card, CardHeader, Checkbox, EmptyState, Select, Table, Td, Th, useRun } from './ui'

/**
 * Admin document assignment: pick an Admin, tick the documents (Pitch Deck, Finance, DPR, Certification, Submission)
 * they handle, Save. A stage can only be forwarded to — and uploaded by — an Admin assigned that document. The table
 * shows every Admin's assignment; a person never saved here may handle all five.
 */
export function AdminDocAccess() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const admins = usersWithRole(db, 'admin')
  const access = workflowSettings(db.settings.workflow).adminStageAccess ?? {}
  const may = canSetAdminStageAccess(me)
  const all = ADMIN_STAGES.map((s) => s.id)
  const [sel, setSel] = useState('')
  const [picks, setPicks] = useState<AdminStageId[]>([])
  // reopening an Admin shows what is saved for them
  useEffect(() => { setPicks(sel ? access[sel] ?? all : []) }, [sel]) // eslint-disable-line react-hooks/exhaustive-deps
  const saved = sel ? access[sel] ?? all : []
  const dirty = sel && (picks.length !== saved.length || picks.some((p) => !saved.includes(p)))

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader title="Admin document assignment" icon={KeyRound} action={<Link to="/reports?tab=docs"><Button size="sm" variant="outline" icon={FileStack}>Documents report</Button></Link>}
        subtitle={may ? 'Choose an Admin, tick the documents they handle, and save — only those can be forwarded to and uploaded by them' : 'Documents each Admin handles (assigned by Admin managers / Super Admin)'} />
      {!admins.length ? <EmptyState icon={KeyRound} title="No Admins yet" text="Add people with the Admin role in Employee details." /> : <>
        {may && (
          <div className="grid gap-4 border-b border-line p-5 lg:grid-cols-[260px_1fr_auto] lg:items-end">
            <Select label="Admin" value={sel} onChange={(e) => setSel(e.target.value)}>
              <option value="">— Select an Admin —</option>
              {admins.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
            <div>
              <p className="mb-1.5 flex items-center gap-3 text-xs font-semibold text-mute">Documents
                {sel && <><button type="button" className="font-semibold text-brand-ink hover:underline" onClick={() => setPicks(all)}>All</button><button type="button" className="font-semibold text-mute hover:underline" onClick={() => setPicks([])}>None</button></>}</p>
              <div className={`flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-line px-4 py-2.5 ${sel ? '' : 'opacity-50'}`}>
                {ADMIN_STAGES.map((s) => (
                  <Checkbox key={s.id} label={s.short} disabled={!sel} checked={picks.includes(s.id)}
                    onChange={(on) => setPicks((p) => (on ? [...p, s.id] : p.filter((x) => x !== s.id)))} />
                ))}
              </div>
            </div>
            <Button icon={Save} disabled={!sel || !dirty} onClick={() => run(() => setAdminStageAccess(me, sel, all.filter((s) => picks.includes(s))), 'Documents assigned')}>Save</Button>
          </div>
        )}
        <Table>
          <thead><tr><Th>Admin</Th>{ADMIN_STAGES.map((s) => <Th key={s.id} className="text-center">{s.short}</Th>)}<Th className="text-right">Assigned</Th></tr></thead>
          <tbody>
            {admins.map((u) => {
              const own = access[u.id]
              return (
                <tr key={u.id} className={sel === u.id ? 'bg-brand-soft/40' : undefined}>
                  <Td><span className="flex items-center gap-2"><Avatar name={u.name} photo={u.photo} size={28} /><span><b className="text-sm">{u.name}</b><span className="block text-[11px] text-mute">{u.designation || 'Admin'}{u.branchId ? ` · ${db.settings.branches?.find((b) => b.id === u.branchId)?.name ?? ''}` : ''}</span></span></span></Td>
                  {ADMIN_STAGES.map((s) => <Td key={s.id} className="text-center">{!own || own.includes(s.id) ? <span className="font-bold text-ok" aria-label="assigned">✓</span> : <span className="text-mute" aria-label="not assigned">—</span>}</Td>)}
                  <Td className="text-right">
                    {!own ? <Badge tone="gray">All 5 (not set)</Badge> : own.length ? <Badge tone="blue">{own.length} of 5</Badge> : <Badge tone="red">None</Badge>}
                    {may && <Button size="sm" variant="ghost" icon={Pencil} className="ml-1" aria-label={`Edit ${u.name}`} onClick={() => setSel(u.id)} />}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </>}
    </Card>
  )
}
