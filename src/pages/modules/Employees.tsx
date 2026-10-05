import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Briefcase, Mail, Pencil, Phone, Plus, UsersRound } from 'lucide-react'
import type { Role, User } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { createUser, updateUser, userName, usersWithRole, type UserInput } from '../../lib/actions'
import { collections, dayStatus, monthStart } from '../../lib/metrics'
import { ROLES, roleColor, roleLabel } from '../../lib/rbac'
import { fmtDate, inr } from '../../lib/format'
import { Avatar, Badge, Button, Card, Drawer, Input, Modal, PageHeader, SearchBox, Select, useRun } from '../../components/ui'
import { DEMO_PASSWORD } from '../../lib/seed'

const blank: UserInput = { name: '', username: '', email: '', phone: '', role: 'sales', department: 'Sales', designation: 'Business Development Executive' }

export default function Employees() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [form, setForm] = useState<{ open: boolean; user?: User; data: UserInput }>({ open: false, data: blank })
  const manage = can('employees.manage', 'access.manage')
  const list = useMemo(() => db.users.filter((u) => (!role || u.role === role) && (!q || `${u.name} ${u.email} ${u.designation} ${u.department}`.toLowerCase().includes(q.toLowerCase()))), [db.users, q, role])
  const open = params.get('open') ? db.users.find((u) => u.id === params.get('open')) : undefined
  useEffect(() => {
    if (params.get('new') && manage) { setForm({ open: true, data: blank }); setParams({}, { replace: true }) }
  }, [params, setParams, manage])
  const tls = usersWithRole(db, 'teamlead')

  const save = async () => {
    const d = form.data
    const ok = form.user
      ? await run(() => updateUser(me, form.user!.id, { name: d.name, email: d.email, phone: d.phone, department: d.department, designation: d.designation, teamLeadId: d.teamLeadId, salary: d.salary }), 'Employee updated')
      : await run(() => createUser(me, d), `Account created — first password is the demo password`)
    if (ok) setForm({ open: false, data: blank })
  }

  return (
    <div>
      <PageHeader title="Employee Details" subtitle={`${db.users.filter((u) => u.active).length} active people across ${new Set(db.users.map((u) => u.department)).size} departments`} icon={UsersRound}
        actions={manage && <Button variant="accent" icon={Plus} onClick={() => setForm({ open: true, data: blank })}>Add employee</Button>} />
      <div className="mb-5 flex flex-wrap gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search people…" className="min-w-60 flex-1" />
        <select value={role} onChange={(e) => setRole(e.target.value as Role | '')} className="h-10 rounded-xl border border-line bg-card px-3 text-sm" aria-label="Role"><option value="">All roles</option>{ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {list.map((u) => {
          const st = dayStatus(db, u.id)
          return (
            <Card key={u.id} className={`cursor-pointer p-5 transition hover:-translate-y-0.5 hover:shadow-pop ${u.active ? '' : 'opacity-60'}`} onClick={() => setParams({ open: u.id })}>
              <div className="flex items-start gap-3">
                <Avatar name={u.name} photo={u.photo} size={52} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{u.name}</p>
                  <p className="truncate text-xs text-mute">{u.designation}</p>
                  <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: roleColor(u.role) }}>{roleLabel(u.role)}</span>
                </div>
                <span className={`size-2.5 rounded-full ${st === 'WORKING' ? 'bg-ok' : st === 'ON_LEAVE' ? 'bg-warn' : 'bg-line'}`} title={st} />
              </div>
              <div className="mt-4 space-y-1 text-xs text-mute">
                <p className="flex items-center gap-2 truncate"><Mail className="size-3.5" />{u.email}</p>
                <p className="flex items-center gap-2"><Phone className="size-3.5" />{u.phone || '—'}</p>
                {u.teamLeadId && <p className="flex items-center gap-2"><UsersRound className="size-3.5" />Team of {userName(db, u.teamLeadId)}</p>}
              </div>
            </Card>
          )
        })}
      </div>

      <Drawer open={!!open} onClose={() => setParams({})} title={open?.name} subtitle={open && `${open.designation} · ${open.department}`}
        footer={open && manage && <Button icon={Pencil} onClick={() => setForm({ open: true, user: open, data: { name: open.name, username: open.username, email: open.email, phone: open.phone, role: open.role, department: open.department, designation: open.designation, teamLeadId: open.teamLeadId, salary: open.salary } })}>Edit</Button>}>
        {open && (
          <div className="space-y-5">
            <div className="flex items-center gap-4"><Avatar name={open.name} photo={open.photo} size={72} /><div><Badge tone="navy">{roleLabel(open.role)}</Badge>{!open.active && <Badge tone="red" className="ml-1">Inactive</Badge>}<p className="mt-1 text-sm text-mute">Joined {fmtDate(open.joinedOn)}</p></div></div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[['Username', open.username], ['Email', open.email], ['Phone', open.phone || '—'], ['Team leader', userName(db, open.teamLeadId)], ['City', open.address?.city ?? '—'], ['Today', dayStatus(db, open.id).replace('_', ' ').toLowerCase()]].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-card2 px-3 py-2"><p className="text-[11px] text-mute">{k}</p><p className="truncate font-semibold">{v}</p></div>
              ))}
            </div>
            {['sales', 'teamlead'].includes(open.role) && (
              <Card className="p-4"><p className="flex items-center gap-2 text-sm font-bold"><Briefcase className="size-4" />This month</p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
                  <div><p className="text-lg font-extrabold">{db.bookings.filter((b) => b.createdBy === open.id).length}</p><p className="text-[11px] text-mute">CRM entries</p></div>
                  <div><p className="text-lg font-extrabold">{db.leads.filter((l) => l.assignedTo === open.id).length}</p><p className="text-[11px] text-mute">Leads</p></div>
                  <div><p className="text-lg font-extrabold">{inr(collections(db, [open.id], monthStart()))}</p><p className="text-[11px] text-mute">Collected</p></div>
                </div>
              </Card>
            )}
            {open.teamLeadId === undefined && open.role === 'teamlead' && <p className="text-sm text-mute">Team: {db.users.filter((u) => u.teamLeadId === open.id).map((u) => u.name).join(', ') || '—'}</p>}
          </div>
        )}
      </Drawer>

      <Modal open={form.open} onClose={() => setForm({ open: false, data: blank })} title={form.user ? `Edit ${form.user.name}` : 'Add employee'} size="lg"
        subtitle={form.user ? 'Role and access are changed in Access Management.' : 'The account gets the demo password; ask them to change it in Settings → Security.'}
        footer={<><Button variant="outline" onClick={() => setForm({ open: false, data: blank })}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['name', 'username', 'email', 'phone', 'department', 'designation'] as const).map((k) => (
            <Input key={k} label={k[0]!.toUpperCase() + k.slice(1)} required={['name', 'username', 'email'].includes(k)} disabled={!!form.user && k === 'username'} value={form.data[k] ?? ''} onChange={(e) => setForm({ ...form, data: { ...form.data, [k]: e.target.value } })} />
          ))}
          {!form.user && <Select label="Role" value={form.data.role} onChange={(e) => setForm({ ...form, data: { ...form.data, role: e.target.value as Role } })}>{ROLES.filter((r) => r.id !== 'superadmin' || me.role === 'superadmin').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select>}
          {form.data.role === 'sales' && <Select label="Team leader" value={form.data.teamLeadId ?? ''} onChange={(e) => setForm({ ...form, data: { ...form.data, teamLeadId: e.target.value || undefined } })}><option value="">—</option>{tls.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
          <Input label="Monthly salary (₹)" type="number" value={form.data.salary ?? ''} onChange={(e) => setForm({ ...form, data: { ...form.data, salary: e.target.value ? Number(e.target.value) : undefined } })} />
        </div>
        {!form.user && <p className="mt-4 rounded-xl bg-card2 p-3 text-xs text-mute">Local demo: new accounts start with the shared demo password ({DEMO_PASSWORD.length} characters, defined in <code>src/lib/seed.ts</code>).</p>}
      </Modal>
    </div>
  )
}
