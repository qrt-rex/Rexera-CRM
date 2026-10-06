import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Briefcase, Mail, Pencil, Phone, Plus, UsersRound } from 'lucide-react'
import type { FileRef, Role, User } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { createUser, PASSWORD_HINT, PASSWORD_RULE, updateUser, userName, usersWithRole, type UserInput } from '../../lib/actions'
import { collections, dayStatus, monthStart } from '../../lib/metrics'
import { ROLES, roleColor, roleLabel } from '../../lib/rbac'
import { fmtDate, inr } from '../../lib/format'
import { Avatar, Badge, Button, Card, Drawer, Input, Modal, PageHeader, SearchBox, Select, useRun } from '../../components/ui'
import { RESUME_TYPES } from '../../lib/files'
import { FileField, FileLink } from '../../components/FileField'
import { PhoneInput } from '../../components/fields'

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
  const [pw, setPw] = useState({ password: '', confirm: '', show: false })
  const [resume, setResume] = useState<FileRef | undefined>()
  const [tried, setTried] = useState(false)
  const closeForm = () => { setForm({ open: false, data: blank }); setPw({ password: '', confirm: '', show: false }); setResume(undefined); setTried(false) }
  const manage = can('employees.manage', 'access.manage')
  const list = useMemo(() => db.users.filter((u) => (!role || u.role === role) && (!q || `${u.name} ${u.email} ${u.designation} ${u.department}`.toLowerCase().includes(q.toLowerCase()))), [db.users, q, role])
  const open = params.get('open') ? db.users.find((u) => u.id === params.get('open')) : undefined
  useEffect(() => {
    if (params.get('new') && manage) { setForm({ open: true, data: blank }); setParams({}, { replace: true }) }
  }, [params, setParams, manage])
  const tls = usersWithRole(db, 'teamlead')

  const pwError = !pw.password ? 'Set a password for the new account.' : !PASSWORD_RULE.test(pw.password) ? PASSWORD_HINT : pw.password !== pw.confirm ? 'The two passwords do not match.' : ''
  const save = async () => {
    const d = form.data
    if (!form.user) {
      setTried(true)
      if (pwError || !resume) return
    }
    const ok = form.user
      ? await run(() => updateUser(me, form.user!.id, { name: d.name, email: d.email, phone: d.phone, department: d.department, designation: d.designation, teamLeadId: d.teamLeadId, salary: d.salary }), 'Employee updated')
      : await run(() => createUser(me, d, pw.password, resume), `Account created for ${d.name} — share the password with them privately`)
    if (ok) closeForm()
  }

  return (
    <div>
      <PageHeader title="Employee Details" subtitle={`${db.users.filter((u) => u.active).length} active people across ${new Set(db.users.map((u) => u.department)).size} departments`} icon={UsersRound}
        actions={manage && <Button variant="accent" icon={Plus} onClick={() => { closeForm(); setForm({ open: true, data: blank }) }}>Add employee</Button>} />
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
              {open.resume && manage && <div className="col-span-2 rounded-xl bg-card2 px-3 py-2"><p className="text-[11px] text-mute">Resume</p><FileLink file={open.resume} /></div>}
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

      <Modal open={form.open} onClose={closeForm} title={form.user ? `Edit ${form.user.name}` : 'Add employee'} size="lg"
        subtitle={form.user ? 'Role and access are changed in Access Management.' : 'Set their first password and attach their resume. They can change the password later in Settings → Security.'}
        footer={<><Button variant="outline" onClick={closeForm}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['name', 'username', 'email', 'department', 'designation'] as const).map((k) => (
            <Input key={k} label={k[0]!.toUpperCase() + k.slice(1)} required={['name', 'username', 'email'].includes(k)} disabled={!!form.user && k === 'username'} value={form.data[k] ?? ''} onChange={(e) => setForm({ ...form, data: { ...form.data, [k]: e.target.value } })} />
          ))}
          <PhoneInput label="Phone" value={form.data.phone ?? ''} onChange={(v) => setForm({ ...form, data: { ...form.data, phone: v } })} />
          {!form.user && <Select label="Role" value={form.data.role} onChange={(e) => setForm({ ...form, data: { ...form.data, role: e.target.value as Role } })}>{ROLES.filter((r) => r.id !== 'superadmin' || me.role === 'superadmin').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select>}
          {form.data.role === 'sales' && <Select label="Team leader" value={form.data.teamLeadId ?? ''} onChange={(e) => setForm({ ...form, data: { ...form.data, teamLeadId: e.target.value || undefined } })}><option value="">—</option>{tls.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
          <Input label="Monthly salary (₹)" type="number" value={form.data.salary ?? ''} onChange={(e) => setForm({ ...form, data: { ...form.data, salary: e.target.value ? Number(e.target.value) : undefined } })} />
        </div>
        {!form.user && (
          <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <Input label="Joining date" type="date" value={form.data.joinedOn ?? ''} onChange={(e) => setForm({ ...form, data: { ...form.data, joinedOn: e.target.value } })} hint="Leave empty for today" />
            <div />
            <Input label="Password" required type={pw.show ? 'text' : 'password'} autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} error={tried && pwError && pwError !== 'The two passwords do not match.' ? pwError : undefined} hint={PASSWORD_HINT} />
            <Input label="Confirm password" required type={pw.show ? 'text' : 'password'} autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} error={tried && pwError === 'The two passwords do not match.' ? pwError : undefined} />
            <label className="flex items-center gap-2 text-xs text-mute sm:col-span-2"><input type="checkbox" checked={pw.show} onChange={(e) => setPw({ ...pw, show: e.target.checked })} className="accent-[var(--brand)]" />Show password</label>
            <div className="sm:col-span-2"><FileField label="Resume" required accept={RESUME_TYPES} acceptLabel="PDF or Word" value={resume} onChange={setResume} error={tried && !resume ? "Attach the new joinee's resume." : undefined} /></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
