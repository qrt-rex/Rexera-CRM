import { useState } from 'react'
import { CheckCheck, Eye, Megaphone, Send } from 'lucide-react'
import type { Role } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { ackBroadcast, publishBroadcast, userName, usersWithRole } from '../../lib/actions'
import { ROLES, roleLabel } from '../../lib/rbac'
import { ago } from '../../lib/format'
import { Badge, Button, Card, Checkbox, EmptyState, Input, Modal, PageHeader, Progress, Select, Textarea, useRun } from '../../components/ui'

export default function Broadcasts() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const manage = can('broadcasts.manage')
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ title: '', body: '', priority: 'NORMAL' as 'NORMAL' | 'HIGH' | 'URGENT', all: true, roles: [] as Role[] })
  const list = db.broadcasts.filter((b) => manage || b.audience === 'ALL' || b.audience.some((r) => r === me.role || me.extraRoles.includes(r)))
  const audienceSize = (a: Role[] | 'ALL') => (a === 'ALL' ? db.users.filter((u) => u.active).length : usersWithRole(db, ...a).length)

  return (
    <div>
      <PageHeader title="Broadcasts" subtitle="Company updates. Acknowledge to let the sender know you've read it." icon={Megaphone}
        actions={<>{!manage && <Badge tone="gray"><Eye className="size-3" />View only</Badge>}{manage && <Button variant="accent" icon={Send} onClick={() => setOpen(true)}>New update</Button>}</>} />
      {!list.length ? <Card><EmptyState icon={Megaphone} title="No broadcasts" /></Card> : (
        <div className="space-y-4">
          {list.map((b) => {
            const acked = b.acks.includes(me.id)
            const size = audienceSize(b.audience)
            return (
              <Card key={b.id} className={`overflow-hidden border-l-4 ${b.priority === 'URGENT' ? 'border-l-bad' : b.priority === 'HIGH' ? 'border-l-accent' : 'border-l-brand'}`}>
                <div className="flex flex-wrap items-start gap-4 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold">{b.title}</h3>
                      <Badge tone={b.priority === 'URGENT' ? 'red' : b.priority === 'HIGH' ? 'orange' : 'navy'}>{b.priority.toLowerCase()}</Badge>
                      <Badge tone="gray">{b.audience === 'ALL' ? 'Everyone' : b.audience.map(roleLabel).join(', ')}</Badge></div>
                    <p className="mt-2 whitespace-pre-line text-sm">{b.body}</p>
                    <p className="mt-2 text-xs text-mute">{userName(db, b.by)} · {ago(b.at)}</p>
                  </div>
                  <div className="w-full sm:w-56">
                    {acked ? <Badge tone="green"><CheckCheck className="size-3.5" />Acknowledged</Badge> : <Button size="sm" variant="success" icon={CheckCheck} onClick={() => run(() => ackBroadcast(me, b.id), 'Thanks!')}>Acknowledge</Button>}
                    {manage && <div className="mt-3"><p className="mb-1 text-xs text-mute">{b.acks.length} of {size} acknowledged</p><Progress value={(b.acks.length / Math.max(1, size)) * 100} tone="green" /></div>}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New company update"
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button icon={Send} onClick={async () => { if (await run(() => publishBroadcast(me, { title: f.title, body: f.body, priority: f.priority, audience: f.all ? 'ALL' : f.roles }), 'Published')) { setOpen(false); setF({ title: '', body: '', priority: 'NORMAL', all: true, roles: [] }) } }}>Publish</Button></>}>
        <div className="grid gap-4">
          <Input label="Title" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <Textarea label="Message" required rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          <Select label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as typeof f.priority })}><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></Select>
          <Checkbox checked={f.all} onChange={(v) => setF({ ...f, all: v })} label="Send to everyone" />
          {!f.all && <div className="flex flex-wrap gap-3">{ROLES.map((r) => <Checkbox key={r.id} checked={f.roles.includes(r.id)} onChange={(v) => setF({ ...f, roles: v ? [...f.roles, r.id] : f.roles.filter((x) => x !== r.id) })} label={r.label} />)}</div>}
        </div>
      </Modal>
    </div>
  )
}
