import { useState } from 'react'
import { Crown, Pencil, Plus, UserCog, UserMinus, Users } from 'lucide-react'
import type { Booking } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { addAdminMember, canManageAdmins, makeMainAdmin, reassignAdmin, removeAdminMember, usersWithRole, userName } from '../lib/actions'
import { fileAdmins } from '../lib/fileAdmins'
import { Badge, Button, Checkbox, Input, Modal, Select, Textarea, useRun } from './ui'

/**
 * A file's Admin members (main Admin first) with Manage for the file's Operations person: add members, remove them,
 * change the main Admin or make a member the main one — at any time once the file has an Admin. Every change is kept
 * in the file's timeline and the activity log, and shows at once in the CRM entry and the Admins' dashboards.
 */
export function AdminWithChange({ b, compact }: { b: Booking; compact?: boolean }) {
  const db = useDb()
  const me = useMe()
  const [open, setOpen] = useState(false)
  const may = canManageAdmins(db, me, b)
  const members = fileAdmins(b)
  return (
    <>
      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
        {members.map((id) => <span key={id} className="whitespace-nowrap">{userName(db, id)}{members.length > 1 && id === b.adminId && <span className="ml-1 text-[10px] font-bold uppercase text-mute">main</span>}{id !== members.at(-1) && ','}</span>)}
        {may && <button type="button" onClick={() => setOpen(true)} className={compact ? 'text-[11px] font-semibold text-brand-ink hover:underline' : 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-brand-ink hover:bg-brand-soft'} aria-label="Manage the Admin members">
          {!compact && <Pencil className="size-3" />}{compact ? 'Manage' : 'Edit'}
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
  const live = db.bookings.find((x) => x.id === b.id) ?? b
  const members = fileAdmins(live)
  const others = usersWithRole(db, 'admin').filter((u) => u.active && !members.includes(u.id))
  const [add, setAdd] = useState({ id: '', note: '' })
  const [change, setChange] = useState({ id: '', reason: '', keep: false })
  const [remove, setRemove] = useState<{ id: string; reason: string } | null>(null)
  const history = live.comments.filter((c) => c.kind === 'Admin assignment').slice(-8).reverse()
  const mainName = userName(db, live.adminId)
  return (
    <Modal open onClose={onClose} size="lg" title="Admin members" subtitle={`${live.bookingId} · ${live.companyName} · main Admin: ${mainName}`}
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-5">
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-mute"><Users className="size-3.5" />On this file ({members.length})</h4>
          <ul className="divide-y divide-line/70 rounded-lg border border-line">
            {members.map((id) => (
              <li key={id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 font-semibold">{userName(db, id)}</span>
                {id === live.adminId ? <Badge tone="navy"><Crown className="size-3" />Main Admin</Badge> : <>
                  <Badge tone="gray">Member</Badge>
                  <Button size="sm" variant="ghost" icon={Crown} onClick={() => run(() => makeMainAdmin(me, live.id, id), `${userName(db, id)} is now the main Admin`)}>Make main</Button>
                </>}
                <Button size="sm" variant="ghost" icon={UserMinus} className="text-bad" disabled={members.length < 2} title={members.length < 2 ? 'A file keeps at least one Admin — use Change below' : undefined}
                  onClick={() => setRemove({ id, reason: '' })}>Remove</Button>
              </li>
            ))}
          </ul>
          {remove && (
            <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-bad/30 bg-bad-soft/50 p-3">
              <Input className="min-w-56 flex-1" label={`Why remove ${userName(db, remove.id)}?`} required value={remove.reason} onChange={(e) => setRemove({ ...remove, reason: e.target.value })} placeholder="e.g. work finished, on leave" autoFocus />
              <Button variant="outline" onClick={() => setRemove(null)}>Cancel</Button>
              <Button variant="danger" icon={UserMinus} disabled={remove.reason.trim().length < 3}
                onClick={async () => { if (await run(() => removeAdminMember(me, live.id, remove.id, remove.reason), 'Admin member removed')) setRemove(null) }}>Remove</Button>
              <p className="w-full text-[11px] text-mute">Their unfinished Admin stages go to the main Admin{remove.id === live.adminId ? ' (the next member becomes the main Admin)' : ''}.</p>
            </div>
          )}
        </section>

        <section className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-mute sm:col-span-3"><Plus className="size-3.5" />Add an Admin member — everyone already on the file stays</h4>
          <Select label="Admin" value={add.id} onChange={(e) => setAdd({ ...add, id: e.target.value })}>
            <option value="">— Pick an Admin —</option>
            {others.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <Input label="Note (optional)" value={add.note} onChange={(e) => setAdd({ ...add, note: e.target.value })} placeholder="e.g. handles the DPR" />
          <Button icon={Plus} disabled={!add.id} onClick={async () => { if (await run(() => addAdminMember(me, live.id, add.id, add.note), 'Admin member added')) setAdd({ id: '', note: '' }) }}>Add</Button>
        </section>

        <section className="grid gap-3 rounded-lg border border-line p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-mute"><UserCog className="size-3.5" />Change or re-assign the main Admin</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="New main Admin" value={change.id} onChange={(e) => setChange({ ...change, id: e.target.value })}>
              <option value="">— Pick an Admin —</option>
              {usersWithRole(db, 'admin').filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === live.adminId ? ' (current — re-assign)' : members.includes(u.id) ? ' (already a member)' : ''}</option>)}
            </Select>
            <Textarea label="Reason" required rows={1} value={change.reason} onChange={(e) => setChange({ ...change, reason: e.target.value })} placeholder="Why the file moves (workload, leave, expertise…)" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {change.id !== live.adminId && <Checkbox checked={change.keep} onChange={(v) => setChange({ ...change, keep: v })} label={`Keep ${mainName} on the file as a member`} />}
            <span className="flex-1" />
            <Button icon={UserCog} disabled={!change.id || change.reason.trim().length < 3}
              onClick={async () => { if (await run(() => reassignAdmin(me, live.id, change.id, change.reason, change.keep), change.id === live.adminId ? `Re-assigned to ${mainName}` : 'Main Admin changed')) setChange({ id: '', reason: '', keep: false }) }}>{change.id === live.adminId ? 'Re-assign' : 'Change Admin'}</Button>
          </div>
          <p className="text-[11px] text-mute">{change.id === live.adminId ? `${mainName} stays the main Admin and is told again; Admin stages waiting to be forwarded go back to them.` : change.keep ? `${mainName} keeps their stages and stays on the file.` : `${mainName} leaves the file; their unfinished Admin stages move to the new main Admin.`}</p>
        </section>

        {history.length > 0 && (
          <section className="text-xs">
            <h4 className="mb-1.5 font-bold uppercase tracking-wide text-mute">Assignment history</h4>
            <ul className="space-y-1">{history.map((c) => <li key={c.id} className="rounded-md bg-card2 px-2.5 py-1.5"><b>{userName(db, c.by)}</b> · {new Date(c.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}<span className="block text-mute">{c.text}</span></li>)}</ul>
          </section>
        )}
        <p className="text-xs text-mute">Every member works the file like the main Admin and sees it on their dashboard. Changes save at once and show everywhere in the CRM; the people concerned are notified.</p>
      </div>
    </Modal>
  )
}
