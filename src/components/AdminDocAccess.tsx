import { Link } from 'react-router-dom'
import { FileStack, KeyRound } from 'lucide-react'
import type { AdminStageId } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { canSetAdminStageAccess, setAdminStageAccess, usersWithRole } from '../lib/actions'
import { ADMIN_STAGES, workflowSettings } from '../../supabase/workflow-rules.mjs'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Table, Td, Th, useRun } from './ui'

/**
 * Admin document permissions: which of the five document types (Pitch Deck, Finance, DPR, Certification, Submission)
 * each Admin may handle and upload. A stage can only be forwarded to — and uploaded by — an Admin allowed that type.
 */
export function AdminDocAccess() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const admins = usersWithRole(db, 'admin')
  const access = workflowSettings(db.settings.workflow).adminStageAccess ?? {}
  const may = canSetAdminStageAccess(me)
  const toggle = (uid: string, stage: AdminStageId) => {
    const cur = access[uid] ?? ADMIN_STAGES.map((s) => s.id)
    const next = cur.includes(stage) ? cur.filter((s) => s !== stage) : [...cur, stage]
    run(() => setAdminStageAccess(me, uid, next), 'Permissions saved')
  }
  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader title="Admin document permissions" icon={KeyRound} action={<Link to="/reports?tab=docs"><Button size="sm" variant="outline" icon={FileStack}>Documents report</Button></Link>}
        subtitle={may ? 'Tick the documents each Admin may handle and upload — stages are forwarded only to Admins allowed that document' : 'Which documents each Admin may handle and upload (set by Admin managers / Super Admin)'} />
      {!admins.length ? <EmptyState icon={KeyRound} title="No Admins yet" text="Add people with the Admin role in Employee details." /> : (
        <Table>
          <thead><tr><Th>Admin</Th>{ADMIN_STAGES.map((s) => <Th key={s.id} className="text-center">{s.short}</Th>)}<Th className="text-right">Access</Th></tr></thead>
          <tbody>
            {admins.map((u) => {
              const own = access[u.id]
              return (
                <tr key={u.id}>
                  <Td><span className="flex items-center gap-2"><Avatar name={u.name} photo={u.photo} size={28} /><span><b className="text-sm">{u.name}</b><span className="block text-[11px] text-mute">{u.designation || 'Admin'}{u.branchId ? ` · ${db.settings.branches?.find((b) => b.id === u.branchId)?.name ?? ''}` : ''}</span></span></span></Td>
                  {ADMIN_STAGES.map((s) => {
                    const on = !own || own.includes(s.id)
                    return (
                      <Td key={s.id} className="text-center">
                        <input type="checkbox" checked={on} disabled={!may} onChange={() => toggle(u.id, s.id)} aria-label={`${u.name}: ${s.label}`} className="size-4 accent-[#2E3A8C]" />
                      </Td>
                    )
                  })}
                  <Td className="text-right">{!own ? <Badge tone="gray">All documents</Badge> : own.length ? <Badge tone="blue">{own.length} of 5</Badge> : <Badge tone="red">None</Badge>}
                    {may && own && <Button size="sm" variant="ghost" className="ml-1" onClick={() => run(() => setAdminStageAccess(me, u.id, null), 'Access reset to all documents')}>Allow all</Button>}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Card>
  )
}
