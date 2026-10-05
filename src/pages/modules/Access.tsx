import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { KeyRound, Lock, RefreshCcw, Save, Settings2, ShieldCheck, UserCog, Users } from 'lucide-react'
import type { Perm, Role, User } from '../../lib/types'
import { useDb, resetDemoData } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { resetUserPassword, setRolePerms, updateSettings, updateUser, userName } from '../../lib/actions'
import { ALL_PERMS, DEFAULT_ROLE_PERMS, MASTER_ROLES, PERM_GROUPS, RESERVED, ROLES, effectivePerms, roleLabel, rolesOf } from '../../lib/rbac'
import { INDIAN_STATES, fmtDate } from '../../lib/format'
import { Avatar, Badge, Button, Card, CardHeader, Checkbox, cx, Drawer, Input, PageHeader, SearchBox, Select, Table, Tabs, Td, Th, Toggle, useConfirm, useRun } from '../../components/ui'

type Tab = 'users' | 'roles' | 'settings'

export default function Access() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'users'
  return (
    <div>
      <PageHeader title="Access Management" subtitle="Users, roles, permissions and system settings. Changes apply immediately." icon={KeyRound}
        actions={<Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ id: 'users', label: 'Users', icon: Users }, { id: 'roles', label: 'Role permissions', icon: ShieldCheck }, { id: 'settings', label: 'Settings', icon: Settings2 }]} />} />
      {tab === 'users' && <UsersTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

function UsersTab() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<User | null>(null)
  const meSA = rolesOf(me).includes('superadmin')
  const list = db.users.filter((u) => !q || `${u.name} ${u.username} ${u.email}`.toLowerCase().includes(q.toLowerCase()))
  const cur = open ? db.users.find((u) => u.id === open.id)! : null

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line p-4"><SearchBox value={q} onChange={setQ} placeholder="Search users…" className="max-w-md" /></div>
      <Table>
        <thead><tr><Th>User</Th><Th>Role</Th><Th>Extra roles</Th><Th>Custom</Th><Th>Active</Th><Th className="text-right">Actions</Th></tr></thead>
        <tbody>
          {list.map((u) => {
            // Super Admin accounts can only be changed by a Super Admin
            const self = u.id === me.id || (rolesOf(u).includes('superadmin') && !meSA)
            return (
              <tr key={u.id} className={u.active ? '' : 'opacity-60'}>
                <Td><span className="flex items-center gap-3"><Avatar name={u.name} photo={u.photo} size={34} /><span><span className="block font-semibold">{u.name}{u.id === me.id && <Badge tone="navy" className="ml-2">you</Badge>}{u.id !== me.id && self && <Badge tone="gray" className="ml-2">protected</Badge>}</span><span className="text-xs text-mute">@{u.username} · {u.email}</span></span></span></Td>
                <Td><select disabled={self} value={u.role} onChange={(e) => run(() => updateUser(me, u.id, { role: e.target.value as Role }), 'Role changed')} className="h-9 rounded-lg border border-line bg-card px-2 text-sm disabled:opacity-60" aria-label="Role">
                  {ROLES.filter((r) => meSA || r.id !== 'superadmin' || u.role === 'superadmin').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Td>
                <Td className="text-xs">{u.extraRoles.length ? u.extraRoles.map(roleLabel).join(', ') : <span className="text-mute">—</span>}</Td>
                <Td className="text-xs">{u.grants.length || u.denies.length ? <><Badge tone="green">+{u.grants.length}</Badge> <Badge tone="red">−{u.denies.length}</Badge></> : <span className="text-mute">—</span>}</Td>
                <Td><Toggle checked={u.active} label="Active" onChange={(v) => !self && run(() => updateUser(me, u.id, { active: v }), v ? 'Activated' : 'Deactivated')} /></Td>
                <Td className="text-right"><span className="inline-flex gap-1">
                  <Button size="sm" variant="soft" icon={UserCog} disabled={self} onClick={() => setOpen(u)}>Manage access</Button>
                  <Button size="sm" variant="ghost" icon={RefreshCcw} aria-label="Reset password" title="Reset to demo password" disabled={u.id !== me.id && self} onClick={async () => { if (await confirm('Reset password?', `${u.name}'s password will be reset to the demo password.`)) run(() => resetUserPassword(me, u.id), 'Password reset') }} />
                </span></Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <Drawer open={!!cur} onClose={() => setOpen(null)} title={cur ? `Access · ${cur.name}` : ''} subtitle="Effective access = all roles + allow − deny. Reserved permissions stay with their roles.">
        {cur && <ManageAccess user={cur} />}
      </Drawer>
      {node}
    </Card>
  )
}

function ManageAccess({ user }: { user: User }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const eff = effectivePerms(db, user)
  const fromRoles = effectivePerms(db, { ...user, grants: [], denies: [] })
  const setPerm = (p: Perm, mode: 'role' | 'allow' | 'deny') => {
    const grants = user.grants.filter((x) => x !== p)
    const denies = user.denies.filter((x) => x !== p)
    if (mode === 'allow') grants.push(p)
    if (mode === 'deny') denies.push(p)
    run(() => updateUser(me, user.id, { grants, denies }))
  }
  return (
    <div className="space-y-6">
      <div>
        <h4 className="mb-2 text-sm font-bold">Additional roles</h4>
        <div className="flex flex-wrap gap-3">{ROLES.filter((r) => r.id !== user.role && r.id !== 'superadmin').map((r) => (
          <Checkbox key={r.id} checked={user.extraRoles.includes(r.id)} label={r.label} onChange={(v) => run(() => updateUser(me, user.id, { extraRoles: v ? [...user.extraRoles, r.id] : user.extraRoles.filter((x) => x !== r.id) }), 'Roles updated')} />
        ))}</div>
        {user.role === 'sales' && <Select className="mt-4 max-w-xs" label="Team leader" value={user.teamLeadId ?? ''} onChange={(e) => run(() => updateUser(me, user.id, { teamLeadId: e.target.value || undefined }), 'Team updated')}><option value="">—</option>{db.users.filter((u) => u.role === 'teamlead').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
      </div>
      {PERM_GROUPS.map((g) => (
        <div key={g.group}>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-mute">{g.group}</h4>
          <ul className="divide-y divide-line/70 rounded-xl border border-line">
            {g.perms.map((p) => {
              const mode = user.grants.includes(p.id) ? 'allow' : user.denies.includes(p.id) ? 'deny' : 'role'
              const reserved = RESERVED[p.id]
              return (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <span className={cx('size-2 rounded-full', eff.has(p.id) ? 'bg-ok' : 'bg-line')} />
                  <span className="flex-1 text-sm">{p.label}{reserved && <Lock className="ml-1 inline size-3 text-mute" aria-label={`Reserved for ${reserved.map(roleLabel).join(', ')}`} />}<span className="block text-[11px] text-mute">{fromRoles.has(p.id) ? 'from role' : 'not in role'}</span></span>
                  <div className="flex rounded-lg border border-line p-0.5 text-[11px] font-semibold">
                    {(['role', 'allow', 'deny'] as const).map((m) => <button key={m} onClick={() => setPerm(p.id, m)} className={cx('rounded-md px-2 py-1 capitalize', mode === m ? (m === 'allow' ? 'bg-ok text-white' : m === 'deny' ? 'bg-bad text-white' : 'bg-card2 text-ink') : 'text-mute')}>{m === 'role' ? 'Default' : m}</button>)}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function RolesTab() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [draft, setDraft] = useState<Record<Role, Perm[]>>(() => structuredClone(db.rolePerms))
  const dirty = JSON.stringify(draft) !== JSON.stringify(db.rolePerms)
  const toggle = (r: Role, p: Perm) => setDraft((d) => ({ ...d, [r]: d[r].includes(p) ? d[r].filter((x) => x !== p) : [...d[r], p] }))
  const save = () => run(() => { for (const r of ROLES) if (r.id !== 'superadmin' && JSON.stringify(draft[r.id]) !== JSON.stringify(db.rolePerms[r.id])) setRolePerms(me, r.id, draft[r.id]) }, 'Permissions saved')
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Role × permission matrix" subtitle="Super Admin and IT Support (master roles) always have everything. 🔒 = reserved to specific roles." icon={ShieldCheck}
        action={<span className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setDraft(structuredClone(DEFAULT_ROLE_PERMS))}>Defaults</Button><Button size="sm" icon={Save} disabled={!dirty} onClick={save}>Save changes</Button></span>} />
      <Table>
        <thead><tr><Th className="sticky left-0 z-10 bg-card2">Permission</Th>{ROLES.map((r) => <Th key={r.id} className="text-center"><span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: r.color }} />{r.short}</span><span className="block text-[9px] font-normal normal-case">{r.label}</span></Th>)}</tr></thead>
        <tbody>
          {PERM_GROUPS.map((g) => [
            <tr key={g.group}><Td colSpan={ROLES.length + 1} className="bg-card2/60 text-[11px] font-bold uppercase tracking-wider text-mute">{g.group}</Td></tr>,
            ...g.perms.map((p) => (
              <tr key={p.id} className="hover:bg-card2/40">
                <Td className="sticky left-0 z-10 bg-card text-sm">{p.label}{RESERVED[p.id] && ' 🔒'}<span className="block font-mono text-[10px] text-mute">{p.id}</span></Td>
                {ROLES.map((r) => {
                  const master = MASTER_ROLES.includes(r.id)
                  const locked = master || (RESERVED[p.id] && !RESERVED[p.id]!.includes(r.id))
                  return <Td key={r.id} className="text-center"><input type="checkbox" aria-label={`${r.label}: ${p.label}`} className="size-4 accent-[var(--brand)]" disabled={!!locked} checked={master || draft[r.id].includes(p.id)} onChange={() => toggle(r.id, p.id)} /></Td>
                })}
              </tr>
            )),
          ])}
        </tbody>
      </Table>
      <p className="border-t border-line px-5 py-3 text-xs text-mute">{ALL_PERMS.length} permissions · every page and action checks these on each request.</p>
    </Card>
  )
}

function SettingsTab() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const [s, setS] = useState(db.settings)
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="overflow-hidden">
        <CardHeader title="System settings" icon={Settings2} />
        <div className="grid gap-4 p-5">
          <Input label="Company name" value={s.companyName} onChange={(e) => setS({ ...s, companyName: e.target.value })} />
          <Input label="Company GSTIN" value={s.companyGstin} onChange={(e) => setS({ ...s, companyGstin: e.target.value.toUpperCase() })} />
          <Select label="Supplier state (for CGST/SGST vs IGST)" value={s.supplierState} onChange={(e) => setS({ ...s, supplierState: e.target.value })}>{INDIAN_STATES.map((x) => <option key={x}>{x}</option>)}</Select>
          <Input label="Inactivity sign-out (minutes)" type="number" min={5} max={480} value={s.sessionMinutes} onChange={(e) => setS({ ...s, sessionMinutes: Number(e.target.value) })} hint="A warning shows 1 minute before." />
          <Button icon={Save} className="w-fit" onClick={() => run(() => updateSettings(me, { ...s, sessionMinutes: Math.max(5, s.sessionMinutes || 60) }), 'Settings saved')}>Save settings</Button>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Demo data" icon={RefreshCcw} />
        <div className="space-y-3 p-5 text-sm">
          <p className="text-mute">This build stores data in your browser. Reset brings back the sample company, users, leads and CRM entries.</p>
          <p className="text-mute">Last sign-in activity: {db.audit.find((a) => a.action === 'SIGN_IN') ? `${userName(db, db.audit.find((a) => a.action === 'SIGN_IN')!.by)} · ${fmtDate(db.audit.find((a) => a.action === 'SIGN_IN')!.at)}` : '—'}</p>
          <Button variant="danger" icon={RefreshCcw} onClick={async () => { if (await confirm('Reset all data?', 'Every change made in this browser will be lost.', true)) { await resetDemoData(); location.href = '/login' } }}>Reset demo data</Button>
        </div>
      </Card>
      {node}
    </div>
  )
}
