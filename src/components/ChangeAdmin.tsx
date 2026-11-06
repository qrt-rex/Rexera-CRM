import { useState } from 'react'
import { Pencil, UserCog } from 'lucide-react'
import type { Booking } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { adminStageAccess, canReassignAdmin, reassignAdmin, usersWithRole, userName } from '../lib/actions'
import { ADMIN_STAGES } from '../../supabase/workflow-rules.mjs'
import { Button, Modal, Select, Textarea, useRun } from './ui'

/**
 * The file's Admin with an Edit (Change) button for the file's Operations person: picks another Admin and a reason;
 * the file and its unfinished Admin stages move over, and the change is kept in the file's timeline.
 */
export function AdminWithChange({ b, compact }: { b: Booking; compact?: boolean }) {
  const db = useDb()
  const me = useMe()
  const [open, setOpen] = useState(false)
  const may = canReassignAdmin(db, me, b)
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <span>{userName(db, b.adminId)}</span>
        {may && <button type="button" onClick={() => setOpen(true)} className={compact ? 'text-[11px] font-semibold text-brand-ink hover:underline' : 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-brand-ink hover:bg-brand-soft'} aria-label="Change the Admin">
          {!compact && <Pencil className="size-3" />}Change
        </button>}
      </span>
      {open && <ChangeAdminModal b={b} onClose={() => setOpen(false)} />}
    </>
  )
}

export function ChangeAdminModal({ b, onClose }: { b: Booking; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const admins = usersWithRole(db, 'admin').filter((u) => u.active && u.id !== b.adminId)
  // what the new Admin may do (Operations Dashboard → Team), so it is clear which stages move with the file
  const open = ADMIN_STAGES.filter((s) => { const w = b.adminWork?.[s.id]; return w && w.assignee === b.adminId && !['APPROVED', 'COMPLETED', 'NOT_NEEDED'].includes(w.status) })
  const may = to ? adminStageAccess(db, to) : []
  const history = b.comments.filter((c) => c.kind === 'Admin assignment').slice(-5).reverse()
  const save = async () => { if (await run(() => reassignAdmin(me, b.id, to, reason), 'Admin changed')) onClose() }
  return (
    <Modal open onClose={onClose} size="md" title="Change the Admin" subtitle={`${b.bookingId} · ${b.companyName} · now with ${userName(db, b.adminId)}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon={UserCog} disabled={!to || reason.trim().length < 3} onClick={save}>Change Admin</Button></>}>
      <div className="space-y-4">
        <Select label="New Admin" required value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">— Pick an Admin —</option>
          {admins.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Textarea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the file moves (e.g. workload, leave, expertise)…" />
        {open.length > 0 && (
          <div className="rounded-lg border border-line bg-card2/50 p-3 text-xs">
            <p className="mb-1 font-semibold">Unfinished Admin stages that move with the file</p>
            <ul className="space-y-0.5">
              {open.map((s) => <li key={s.id} className="flex justify-between gap-2"><span>{s.label}</span><span className="text-mute">{!to ? '' : may.includes(s.id) ? '→ new Admin' : '→ an Admin who does it (or waits to be forwarded)'}</span></li>)}
            </ul>
          </div>
        )}
        {history.length > 0 && (
          <div className="text-xs">
            <p className="mb-1 font-semibold text-mute">Earlier Admin changes</p>
            <ul className="space-y-1">{history.map((c) => <li key={c.id} className="rounded-md bg-card2 px-2.5 py-1.5"><b>{userName(db, c.by)}</b> · {new Date(c.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })}<span className="block text-mute">{c.text}</span></li>)}</ul>
          </div>
        )}
        <p className="text-xs text-mute">The new Admin and the old one are notified. The change, the reason and your name stay in the file's timeline and the activity log.</p>
      </div>
    </Modal>
  )
}
