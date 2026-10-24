import { useState } from 'react'
import { Lock } from 'lucide-react'
import type { AdminStageId } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { canSetAdminStageAccess, setAdminStageAccess, usersWithRole } from '../lib/actions'
import { ADMIN_DONE, ADMIN_STAGES, workflowSettings } from '../../supabase/workflow-rules.mjs'
import { Avatar, Badge, Checkbox, Select, useRun, useToast } from './ui'

/**
 * Operations Dashboard → Team: pick an Admin and tick the documents they do (Pitch Deck, Finance, DPR, Certification,
 * Submission). Each tick takes effect at once: the open stages of that document go to them, new files send it straight
 * to them, and from then on they see only the files and stages assigned to them.
 */
export function AdminTeamAssign() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const admins = usersWithRole(db, 'admin')
  const access = workflowSettings(db.settings.workflow).adminStageAccess ?? {}
  const may = canSetAdminStageAccess(me)
  const [sel, setSel] = useState('')
  if (!admins.length) return null
  const ticked = (sel && access[sel]) || []
  const openOf = (uid: string) => db.bookings.reduce((n, b) => n + Object.values(b.adminWork ?? {}).filter((w) => w?.assignee === uid && !ADMIN_DONE.includes(w.status) && w.status !== 'NOT_NEEDED').length, 0)
  const save = async (stages: AdminStageId[] | null, what: string) => {
    const r = await run(() => setAdminStageAccess(me, sel, stages))
    if (r && typeof r === 'object') toast('success', `${what}${r.given ? ` · ${r.given} open stage(s) assigned` : ''}${r.released ? ` · ${r.released} handed on` : ''}`)
  }
  const name = admins.find((u) => u.id === sel)?.name ?? ''

  return (
    <div className="border-t border-line p-4">
      <p className="text-sm font-bold">Admins — what each one does</p>
      <p className="mb-3 text-xs text-mute">Pick an Admin and tick their documents. The work goes to them at once, and they then see only the files and stages assigned to them.</p>
      {may && <>
        <Select aria-label="Admin" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">— Select an Admin —</option>
          {admins.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        {sel && (
          <div className="mt-3 rounded-xl border border-line p-3">
            <div className="grid gap-2">
              {ADMIN_STAGES.map((s) => {
                const others = admins.filter((u) => u.id !== sel && access[u.id]?.includes(s.id)).map((u) => u.name)
                return (
                  <Checkbox key={s.id} checked={ticked.includes(s.id)}
                    label={<span>{s.short}{others.length > 0 && <span className="ml-1 text-[11px] text-mute">· also {others.join(', ')}</span>}</span>}
                    onChange={(on) => save(ADMIN_STAGES.map((x) => x.id).filter((x) => (x === s.id ? on : ticked.includes(x))), `${s.short} ${on ? 'assigned to' : 'taken from'} ${name}`)} />
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-mute">{access[sel] ? <>Limited to these documents. <button type="button" className="font-semibold text-brand-ink hover:underline" onClick={() => save(null, `${name} sees every file again`)}>Remove the limit</button></> : 'Not set up yet — this Admin still sees every file.'}</p>
          </div>
        )}
      </>}
      <ul className="mt-3 divide-y divide-line/70">
        {admins.map((u) => (
          <li key={u.id} className="flex items-center gap-2 py-2">
            <Avatar name={u.name} photo={u.photo} size={24} />
            <button type="button" disabled={!may} onClick={() => setSel(u.id)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-semibold">{u.name}</span>
              <span className="flex flex-wrap gap-1">{access[u.id] ? (access[u.id]!.length ? access[u.id]!.map((s) => <Badge key={s} tone="blue">{ADMIN_STAGES.find((x) => x.id === s)!.short}</Badge>) : <Badge tone="red">Nothing assigned</Badge>) : <span className="text-[11px] text-mute">Not set up · sees every file</span>}</span>
            </button>
            {access[u.id] && <Lock className="size-3.5 text-mute" aria-label="Sees only their own work" />}
            <span className="text-xs text-mute">{openOf(u.id)} open</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
