import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, Check, KeyRound, Lock, Minus, Plus, RefreshCcw, Save, Settings2, ShieldCheck, Trash2, UserCog, Users, X } from 'lucide-react'
import type { AccessKey, Branch, FnAction, Perm, Role, User } from '../../lib/types'
import { useDb, resetDemoData } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { assignCustomRole, createCustomRole, deleteCustomRole, saveBranches, setRoleFn, setRolePerms, setUserFn, updateCustomRole, updateSettings, updateUser, userName } from '../../lib/actions'
import { CityInput, PhoneInput, StateSelect } from '../../components/fields'
import {
  accessControlOf, ALL_PERMS, canManageRoles, customRoleOf, DEFAULT_ROLE_PERMS, deniedFns, effectivePerms, FN_ACTIONS, fnKey, MASTER_ROLES, PERM_GROUPS, RESERVED, ROLES, roleLabel, rolesOf,
} from '../../lib/rbac'
import { MODULES, canSee, type ModuleDef } from '../../lib/modules'
import { INDIAN_STATES, fmtDate } from '../../lib/format'
import { SetPasswordModal } from '../../components/SetPasswordModal'
import { Avatar, Badge, Button, Card, CardHeader, Checkbox, cx, Drawer, Input, PageHeader, SearchBox, Select, Table, Tabs, Td, Th, Toggle, useConfirm, useRun } from '../../components/ui'

type Tab = 'users' | 'roles' | 'settings'

/**
 * Access Management. User accounts (create, activate, passwords): access managers. Roles, permissions and functions —
 * module by module, user by user: IT Support only (Access Control), or someone IT allowed by name. Changes save to
 * Supabase at once and reach everyone's screen live; the database checks the same rules.
 */
export default function Access() {
  const me = useMe()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const it = canManageRoles(me)
  const tabs = [
    ...(can('access.manage') || it ? [{ id: 'users' as const, label: 'Users', icon: Users }] : []),
    ...(it ? [{ id: 'roles' as const, label: 'Access Control', icon: ShieldCheck }] : []),
    ...(can('access.manage') ? [{ id: 'settings' as const, label: 'Settings', icon: Settings2 }] : []),
  ]
  const tab = tabs.find((t) => t.id === params.get('tab'))?.id ?? tabs[0]?.id ?? 'users'
  return (
    <div>
      <PageHeader title="Access Management" subtitle={it ? 'Users, roles, permissions and every function — user by user. Changes apply immediately.' : 'User accounts. Roles and permissions are managed by IT Support.'} icon={KeyRound}
        actions={<Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={tabs} />} />
      {tab === 'users' && <UsersTab />}
      {tab === 'roles' && it && <RolesTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

/** The name a person's role shows under: their custom role, else the built-in one. */
function roleName(db: ReturnType<typeof useDb>, u: User) { return customRoleOf(db, u)?.name ?? roleLabel(u.role) }

function UsersTab() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<User | null>(null)
  const [pwFor, setPwFor] = useState<User | null>(null)
  const meSA = rolesOf(me).includes('superadmin')
  const it = canManageRoles(me)
  const ac = accessControlOf(db)
  const list = db.users.filter((u) => !q || `${u.name} ${u.username} ${u.email} ${roleName(db, u)}`.toLowerCase().includes(q.toLowerCase()))
  const cur = open ? db.users.find((u) => u.id === open.id)! : null

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search users or roles…" className="max-w-md flex-1" />
        {!it && <span className="flex items-center gap-1.5 text-xs text-mute"><Lock className="size-3.5" />Roles and permissions are changed by IT Support only.</span>}
      </div>
      <Table>
        <thead><tr><Th>User</Th><Th>Role</Th><Th>Extra roles</Th><Th>Own settings</Th><Th>Active</Th><Th className="text-right">Actions</Th></tr></thead>
        <tbody>
          {list.map((u) => {
            const self = u.id === me.id
            // accounts: Super Admin accounts only by a Super Admin (or IT)
            const accountLocked = self || (rolesOf(u).includes('superadmin') && !meSA && !it)
            const custom = customRoleOf(db, u)
            const own = u.grants.length + u.denies.length
            return (
              <tr key={u.id} className={u.active ? '' : 'opacity-60'}>
                <Td><span className="flex items-center gap-3"><Avatar name={u.name} photo={u.photo} size={34} /><span><span className="block font-semibold">{u.name}{self && <Badge tone="navy" className="ml-2">you</Badge>}</span><span className="text-xs text-mute">@{u.username} · {u.email}</span></span></span></Td>
                <Td>
                  {it && !self && !custom ? (
                    <select value={u.role} onChange={async (e) => { const role = e.target.value as Role; if (await confirm(`Make ${u.name} ${roleLabel(role)}?`, `${u.name}'s access changes at once — from ${roleLabel(u.role)} to ${roleLabel(role)}.`)) run(() => updateUser(me, u.id, { role }), 'Role changed') }} className="h-9 rounded-lg border border-line bg-card px-2 text-sm" aria-label="Role">
                      {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  ) : <span className="text-sm">{roleName(db, u)}{custom && <span className="block text-[11px] text-mute">custom · on {roleLabel(custom.base)}</span>}</span>}
                </Td>
                <Td className="text-xs">{u.extraRoles.length ? u.extraRoles.map(roleLabel).join(', ') : <span className="text-mute">—</span>}</Td>
                <Td className="text-xs">{own ? <><Badge tone="green">+{u.grants.length}</Badge> <Badge tone="red">−{u.denies.length}</Badge></> : <span className="text-mute">—</span>}{ac.userRole[u.id] && !custom && <Badge tone="amber" className="ml-1">role removed</Badge>}</Td>
                <Td><Toggle checked={u.active} label="Active" onChange={async (v) => {
                  if (accountLocked) return
                  // deactivating signs the person out at once: ask first
                  if (!v && !(await confirm(`Deactivate ${u.name}?`, `${u.name} is signed out at once and can't sign in until you activate the account again. Their records stay.`, true))) return
                  run(() => updateUser(me, u.id, { active: v }), v ? 'Activated' : 'Deactivated')
                }} /></Td>
                <Td className="text-right"><span className="inline-flex gap-1">
                  <Button size="sm" variant="soft" icon={UserCog} onClick={() => setOpen(u)}>{it && !self ? 'Manage access' : 'View access'}</Button>
                  <Button size="sm" variant="ghost" icon={RefreshCcw} aria-label="Set a new password" title="Set a new password" disabled={accountLocked} onClick={() => setPwFor(u)} />
                </span></Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <Drawer open={!!cur} onClose={() => setOpen(null)} width="max-w-5xl" title={cur ? `Access · ${cur.name}` : ''}
        subtitle={cur ? `${roleName(db, cur)} · effective access = role${cur.extraRoles.length ? 's' : ''} + this person's own allow − deny${it && cur.id !== me.id ? '' : ' (view only)'}` : ''}>
        {cur && <ManageAccess user={cur} readOnly={!it || cur.id === me.id} />}
      </Drawer>
      <SetPasswordModal open={!!pwFor} onClose={() => setPwFor(null)} user={pwFor ?? undefined} />
      {node}
    </Card>
  )
}

/** Modules a person reaches by their permissions and roles (before functions). */
const reachable = (perms: Set<Perm>, u: User) => MODULES.filter((m) => canSee(m, (...p: AccessKey[]) => p.some((x) => x.startsWith('fn:') || perms.has(x as Perm)), u))
const GROUPS = [...new Set(MODULES.map((m) => m.group))]

/** One person's complete configuration: role, custom role, extra roles, every module function, every permission. */
function ManageAccess({ user, readOnly }: { user: User; readOnly: boolean }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const ac = accessControlOf(db)
  const eff = effectivePerms(db, user)
  const fromRoles = effectivePerms(db, { ...user, grants: [], denies: [] })
  const offByRole = deniedFns(db, { ...user, grants: [], denies: [] })
  const off = deniedFns(db, user)
  const master = rolesOf(user).some((r) => MASTER_ROLES.includes(r))
  const modules = reachable(eff, user)
  const [section, setSection] = useState<'functions' | 'permissions'>('functions')
  const setPerm = (p: Perm, mode: 'role' | 'allow' | 'deny') => {
    const grants = user.grants.filter((x) => x !== p)
    const denies = user.denies.filter((x) => x !== p)
    if (mode === 'allow') grants.push(p)
    if (mode === 'deny') denies.push(p)
    run(() => updateUser(me, user.id, { grants, denies }))
  }
  const fnMode = (m: string, a: FnAction) => (user.grants.includes(fnKey(m, a)) ? 'allow' : user.denies.includes(fnKey(m, a)) ? 'deny' : 'role')
  // one click: on → off (for this person) → back to the role's setting
  const cycleFn = (m: string, a: FnAction) => {
    const mode = fnMode(m, a), roleOn = !offByRole.has(`${m}:${a}`)
    const next = mode === 'role' ? (roleOn ? 'deny' : 'allow') : 'role'
    run(() => setUserFn(me, user.id, m, a, next), next === 'role' ? 'Back to the role setting' : next === 'allow' ? 'Allowed for this person' : 'Switched off for this person')
  }
  const funcOff = [...off].length, own = user.grants.length + user.denies.length
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Summary label="Modules open" value={modules.filter((m) => !off.has(`${m.key}:view`)).length} />
        <Summary label="Permissions" value={eff.size} />
        <Summary label="Functions switched off" value={funcOff} tone={funcOff ? 'text-bad' : ''} />
        <Summary label="Own settings (allow / deny)" value={own} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-bold">Role</h4>
          {master ? <p className="text-sm text-mute">{roleLabel(user.role)} — a master role: every permission, unless you take one away by name below.</p> : (
            <Select disabled={readOnly} value={ac.userRole[user.id] ?? ''} onChange={(e) => run(() => assignCustomRole(me, user.id, e.target.value || null), 'Role changed')} label="Custom role (optional)">
              <option value="">— {roleLabel(user.role)} (built-in) —</option>
              {ac.customRoles.map((r) => <option key={r.id} value={r.id}>{r.name} · on {roleLabel(r.base)}</option>)}
            </Select>
          )}
          {!readOnly && !master && <p className="mt-1 text-xs text-mute">A custom role replaces the main role's permissions; its dashboard and workflow come from the role it is built on.</p>}
        </div>
        <div>
          <h4 className="mb-2 text-sm font-bold">Additional roles</h4>
          <div className="flex flex-wrap gap-3">{ROLES.filter((r) => r.id !== user.role && r.id !== 'superadmin').map((r) => (
            readOnly ? (user.extraRoles.includes(r.id) && <Badge key={r.id} tone="navy">{r.label}</Badge>)
              : <Checkbox key={r.id} checked={user.extraRoles.includes(r.id)} label={r.label} onChange={(v) => run(() => updateUser(me, user.id, { extraRoles: v ? [...user.extraRoles, r.id] : user.extraRoles.filter((x) => x !== r.id) }), 'Roles updated')} />
          ))}{readOnly && !user.extraRoles.length && <span className="text-sm text-mute">None</span>}</div>
          {user.role === 'sales' && <Select className="mt-4 max-w-xs" label="Team leader" disabled={readOnly} value={user.teamLeadId ?? ''} onChange={(e) => run(() => updateUser(me, user.id, { teamLeadId: e.target.value || undefined }), 'Team updated')}><option value="">—</option>{db.users.filter((u) => u.role === 'teamlead').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
        </div>
      </div>

      <Tabs value={section} onChange={setSection} tabs={[{ id: 'functions', label: 'Modules & functions', icon: ShieldCheck }, { id: 'permissions', label: 'Permissions', icon: KeyRound }]} />

      {section === 'functions' && (
        <div>
          <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mute">
            <span className="flex items-center gap-1"><FnCell state="on" />on (role)</span><span className="flex items-center gap-1"><FnCell state="off" />off (role)</span>
            <span className="flex items-center gap-1"><FnCell state="allow" />allowed for this person</span><span className="flex items-center gap-1"><FnCell state="deny" />switched off for this person</span>
            {!readOnly && <span>Click a box: on ↔ off for this person; click again to go back to the role.</span>}
          </p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="bg-card2 text-[11px] font-bold uppercase tracking-wide text-mute"><th className="px-3 py-2 text-left">Module</th>{FN_ACTIONS.map((a) => <th key={a.id} className="px-1 py-2 text-center">{a.label}</th>)}</tr></thead>
              <tbody>
                {GROUPS.map((g) => {
                  const rows = modules.filter((m) => m.group === g)
                  if (!rows.length) return null
                  return [
                    <tr key={g}><td colSpan={FN_ACTIONS.length + 1} className="border-t border-line bg-card2/50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-mute">{g}</td></tr>,
                    ...rows.map((m) => (
                      <tr key={m.key} className="border-t border-line/60 hover:bg-card2/30">
                        <td className="px-3 py-1.5"><span className="font-medium">{m.label}</span><span className="block text-[10px] text-mute">{m.path}</span></td>
                        {FN_ACTIONS.map((a) => {
                          const mode = fnMode(m.key, a.id), roleOn = !offByRole.has(`${m.key}:${a.id}`)
                          const state = mode === 'allow' ? 'allow' : mode === 'deny' ? 'deny' : roleOn ? 'on' : 'off'
                          return <td key={a.id} className="px-1 py-1 text-center">
                            <button type="button" disabled={readOnly} onClick={() => cycleFn(m.key, a.id)} aria-label={`${m.label} · ${a.label}: ${state}`} title={`${m.label} · ${a.label}`} className="rounded-md disabled:cursor-default"><FnCell state={state} /></button>
                          </td>
                        })}
                      </tr>
                    )),
                  ]
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-mute">Modules shown: the ones this person reaches with their permissions. Give a module's permission (Permissions tab) to add it here. View off hides the whole module.</p>
        </div>
      )}

      {section === 'permissions' && PERM_GROUPS.map((g) => (
        <div key={g.group}>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-mute">{g.group}</h4>
          <ul className="divide-y divide-line/70 rounded-xl border border-line">
            {g.perms.map((p) => {
              const mode = user.grants.includes(p.id) ? 'allow' : user.denies.includes(p.id) ? 'deny' : 'role'
              const reserved = RESERVED[p.id]
              return (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <span className={cx('size-2 rounded-full', eff.has(p.id) ? 'bg-ok' : 'bg-line')} />
                  <span className="flex-1 text-sm">{p.label}{reserved && <Lock className="ml-1 inline size-3 text-mute" aria-label={`Reserved for ${reserved.map(roleLabel).join(', ')}`} />}<span className="block text-[11px] text-mute">{fromRoles.has(p.id) ? 'from role' : 'not in role'} · <span className="font-mono">{p.id}</span></span></span>
                  <div className="flex rounded-lg border border-line p-0.5 text-[11px] font-semibold">
                    {(['role', 'allow', 'deny'] as const).map((m) => <button key={m} disabled={readOnly} onClick={() => setPerm(p.id, m)} className={cx('rounded-md px-2 py-1 capitalize disabled:cursor-default', mode === m ? (m === 'allow' ? 'bg-ok text-white' : m === 'deny' ? 'bg-bad text-white' : 'bg-card2 text-ink') : 'text-mute')}>{m === 'role' ? 'Default' : m}</button>)}
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

function Summary({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return <div className="rounded-xl border border-line bg-card2/40 px-3 py-2"><p className="text-[11px] text-mute">{label}</p><p className={cx('text-xl font-extrabold tabular-nums', tone)}>{value}</p></div>
}
function FnCell({ state }: { state: 'on' | 'off' | 'allow' | 'deny' }) {
  return (
    <span className={cx('inline-grid size-6 place-items-center rounded-md border', state === 'on' ? 'border-ok/40 text-ok' : state === 'off' ? 'border-line text-mute' : state === 'allow' ? 'border-ok bg-ok text-white' : 'border-bad bg-bad text-white')}>
      {state === 'on' || state === 'allow' ? <Check className="size-3.5" /> : state === 'off' ? <Minus className="size-3.5" /> : <X className="size-3.5" />}
    </span>
  )
}

/** IT Support: custom roles, the role × permission matrix, and each role's functions. */
function RolesTab() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const ac = accessControlOf(db)
  const [draft, setDraft] = useState<Record<Role, Perm[]>>(() => structuredClone(db.rolePerms))
  const dirty = JSON.stringify(draft) !== JSON.stringify(db.rolePerms)
  const toggle = (r: Role, p: Perm) => setDraft((d) => ({ ...d, [r]: d[r].includes(p) ? d[r].filter((x) => x !== p) : [...d[r], p] }))
  const save = () => run(() => { for (const r of ROLES) if (!MASTER_ROLES.includes(r.id) && JSON.stringify(draft[r.id]) !== JSON.stringify(db.rolePerms[r.id])) setRolePerms(me, r.id, draft[r.id]) }, 'Permissions saved')
  const [newRole, setNewRole] = useState({ name: '', base: 'sales' as Role })
  const [fnRole, setFnRole] = useState<string>('sales')
  const people = (id: string) => Object.values(ac.userRole).filter((x) => x === id).length
  const roleOptions = [...ROLES.map((r) => ({ id: r.id as string, name: r.label })), ...ac.customRoles.map((r) => ({ id: r.id, name: `${r.name} (custom)` }))]
  const denyFor = new Set(ac.roleDeny[fnRole] ?? [])
  const fnModules = useMemo(() => {
    const custom = ac.customRoles.find((r) => r.id === fnRole)
    const base = (custom?.base ?? fnRole) as Role
    const perms = new Set<Perm>(MASTER_ROLES.includes(base) ? ALL_PERMS : custom ? custom.perms : db.rolePerms[base] ?? DEFAULT_ROLE_PERMS[base])
    const stand = { id: '-', name: '', username: '', email: '', phone: '', role: base, extraRoles: [], grants: [], denies: [], department: '', designation: '', active: true } as unknown as User
    return reachable(perms, stand)
  }, [ac.customRoles, fnRole, db.rolePerms])

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <CardHeader title="Roles" subtitle="Built-in roles, and roles you create. A custom role is built on a built-in role (its dashboard and workflow) with its own permissions." icon={ShieldCheck} />
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <ul className="divide-y divide-line/70 rounded-xl border border-line">
            {ROLES.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="size-2.5 rounded-full" style={{ background: r.color }} /><b className="flex-1">{r.label}</b>
                <span className="text-xs text-mute">{db.users.filter((u) => u.active && u.role === r.id && !ac.userRole[u.id]).length} people · built-in</span>
              </li>
            ))}
            {ac.customRoles.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="size-2.5 rounded-full" style={{ background: r.color }} />
                <input defaultValue={r.name} aria-label="Role name" onBlur={(e) => { if (e.target.value.trim() !== r.name) run(() => updateCustomRole(me, r.id, { name: e.target.value }), 'Role renamed') }}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 font-bold hover:border-line focus:border-brand focus:outline-none" />
                <Badge tone="violet">custom · on {roleLabel(r.base)}</Badge>
                <span className="text-xs text-mute">{people(r.id)} people · {r.perms.length} permissions</span>
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${r.name}`} className="text-bad" onClick={async () => {
                  if (await confirm(`Delete the role “${r.name}”?`, people(r.id) ? `${people(r.id)} person(s) go back to ${roleLabel(r.base)}.` : 'Nobody has this role.', true)) run(() => deleteCustomRole(me, r.id), 'Role deleted')
                }} />
              </li>
            ))}
          </ul>
          <form className="space-y-3 rounded-xl border border-dashed border-line p-4" onSubmit={async (e) => { e.preventDefault(); if (await run(() => { createCustomRole(me, newRole.name, newRole.base) }, 'Role created')) setNewRole({ ...newRole, name: '' }) }}>
            <p className="text-sm font-bold">New role</p>
            <Input label="Name" value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} placeholder="e.g. Senior Sales" />
            <Select label="Built on" value={newRole.base} onChange={(e) => setNewRole({ ...newRole, base: e.target.value as Role })}>
              {ROLES.filter((r) => !MASTER_ROLES.includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
            <p className="text-xs text-mute">Starts with that role's permissions and switched-off functions; change them below. Give it to people in Users → Manage access.</p>
            <Button type="submit" icon={Plus} className="w-full" disabled={newRole.name.trim().length < 2}>Create role</Button>
          </form>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Role functions" subtitle="What each role may do in every module. Off for a role = off for its people, unless you allow it for a person by name." icon={ShieldCheck}
          action={<Select aria-label="Role" value={fnRole} onChange={(e) => setFnRole(e.target.value)} className="min-w-56">{roleOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="bg-card2 text-[11px] font-bold uppercase tracking-wide text-mute"><th className="px-4 py-2 text-left">Module</th>{FN_ACTIONS.map((a) => <th key={a.id} className="px-1 py-2 text-center">{a.label}</th>)}</tr></thead>
            <tbody>
              {fnModules.map((m: ModuleDef) => (
                <tr key={m.key} className="border-t border-line/60 hover:bg-card2/30">
                  <td className="px-4 py-1.5"><span className="font-medium">{m.label}</span><span className="block text-[10px] text-mute">{m.group}</span></td>
                  {FN_ACTIONS.map((a) => {
                    const on = !denyFor.has(`${m.key}:${a.id}`), locked = fnRole === 'it' && m.key === 'access'
                    return <td key={a.id} className="px-1 py-1 text-center"><input type="checkbox" className="size-4 accent-[var(--brand)]" disabled={locked} checked={on} aria-label={`${m.label} · ${a.label}`}
                      onChange={() => run(() => setRoleFn(me, fnRole, m.key, a.id, !on), `${m.label} · ${a.label} ${on ? 'off' : 'on'}`)} /></td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-xs text-mute">Modules shown: those this role reaches with its permissions. Buttons for a switched-off function are locked on that module's pages; exports and downloads stop; the database refuses deletes and new records in the main tables.</p>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Role × permission matrix" subtitle="Super Admin and IT Support (master roles) have everything except what you take away from a person by name. 🔒 = reserved to specific roles." icon={KeyRound}
          action={<span className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setDraft(structuredClone(DEFAULT_ROLE_PERMS))}>Defaults</Button><Button size="sm" icon={Save} disabled={!dirty} onClick={save}>Save changes</Button></span>} />
        <Table>
          <thead><tr><Th className="sticky left-0 z-10 bg-card2">Permission</Th>{ROLES.map((r) => <Th key={r.id} className="text-center"><span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: r.color }} />{r.short}</span><span className="block text-[9px] font-normal normal-case">{r.label}</span></Th>)}
            {ac.customRoles.map((r) => <Th key={r.id} className="text-center"><span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: r.color }} />{r.name}</span><span className="block text-[9px] font-normal normal-case">custom</span></Th>)}</tr></thead>
          <tbody>
            {PERM_GROUPS.map((g) => [
              <tr key={g.group}><Td colSpan={ROLES.length + ac.customRoles.length + 1} className="bg-card2/60 text-[11px] font-bold uppercase tracking-wider text-mute">{g.group}</Td></tr>,
              ...g.perms.map((p) => (
                <tr key={p.id} className="hover:bg-card2/40">
                  <Td className="sticky left-0 z-10 bg-card text-sm">{p.label}{RESERVED[p.id] && ' 🔒'}<span className="block font-mono text-[10px] text-mute">{p.id}</span></Td>
                  {ROLES.map((r) => {
                    const master = MASTER_ROLES.includes(r.id)
                    const locked = master || p.id === 'roles.manage' || (RESERVED[p.id] && !RESERVED[p.id]!.includes(r.id))
                    return <Td key={r.id} className="text-center"><input type="checkbox" aria-label={`${r.label}: ${p.label}`} className="size-4 accent-[var(--brand)]" disabled={!!locked} checked={master ? p.id !== 'roles.manage' || r.id === 'it' : draft[r.id].includes(p.id)} onChange={() => toggle(r.id, p.id)} /></Td>
                  })}
                  {ac.customRoles.map((r) => {
                    const locked = p.id === 'roles.manage' || (RESERVED[p.id] && !RESERVED[p.id]!.includes(r.base))
                    const on = r.perms.includes(p.id)
                    return <Td key={r.id} className="text-center"><input type="checkbox" aria-label={`${r.name}: ${p.label}`} className="size-4 accent-[var(--brand)]" disabled={!!locked} checked={on}
                      onChange={() => run(() => updateCustomRole(me, r.id, { perms: on ? r.perms.filter((x) => x !== p.id) : [...r.perms, p.id] }))} /></Td>
                  })}
                </tr>
              )),
            ])}
          </tbody>
        </Table>
        <p className="border-t border-line px-4 py-2.5 text-xs text-mute">{ALL_PERMS.length} permissions · built-in roles save with “Save changes”; custom roles save on each click. Every change is in the Activity Log with before and after.</p>
      </Card>
      {node}
    </div>
  )
}

/** Branches printed on tax invoices (Accounts picks one per invoice). */
function BranchesCard() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [list, setList] = useState<Branch[]>(() => db.settings.branches ?? [])
  const set = (i: number, patch: Partial<Branch>) => setList((l) => l.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  return (
    <Card className="overflow-hidden lg:col-span-2">
      <CardHeader title="Invoice branches" subtitle="Accounts chooses the branch on each tax invoice; its address and GSTIN print on it" icon={Building2} />
      <div className="grid gap-4 p-4 xl:grid-cols-3">
        {list.map((b, i) => (
          <div key={b.id} className="grid gap-3 rounded-2xl border border-line p-4">
            <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
              <Input label="Branch name" value={b.name} onChange={(e) => set(i, { name: e.target.value })} />
              <Input label="Code" value={b.code ?? ''} maxLength={10} placeholder="AMD-A" hint="On dashboards" onChange={(e) => set(i, { code: e.target.value.toUpperCase() })} />
            </div>
            <Input label="Address" value={b.address} onChange={(e) => set(i, { address: e.target.value })} placeholder="Building, street, area" />
            <div className="grid grid-cols-2 gap-3">
              <CityInput value={b.city} onChange={(v) => set(i, { city: v })} onState={(s) => set(i, { state: s })} />
              <Input label="PIN" inputMode="numeric" maxLength={6} value={b.pin} onChange={(e) => set(i, { pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
            </div>
            <StateSelect value={b.state} onChange={(v) => set(i, { state: v })} />
            <Input label="GSTIN" value={b.gstin} onChange={(e) => set(i, { gstin: e.target.value.toUpperCase() })} maxLength={15} />
            <div className="grid grid-cols-2 gap-3">
              <PhoneInput label="Phone" value={b.phone} onChange={(v) => set(i, { phone: v })} />
              <Input label="Email" type="email" value={b.email} onChange={(e) => set(i, { email: e.target.value })} />
            </div>
            <Input label="Bank details on invoices" value={b.bank ?? ''} onChange={(e) => set(i, { bank: e.target.value })} placeholder="Bank · A/c number · IFSC" hint="Printed on this branch's invoices; nothing is printed when empty" />
          </div>
        ))}
      </div>
      <div className="flex justify-end border-t border-line p-4"><Button icon={Save} onClick={() => run(() => saveBranches(me, list), 'Branches saved')}>Save branches</Button></div>
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
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="overflow-hidden">
        <CardHeader title="System settings" icon={Settings2} />
        <div className="grid gap-4 p-4">
          <Input label="Company name" value={s.companyName} onChange={(e) => setS({ ...s, companyName: e.target.value })} />
          <Input label="Company GSTIN" value={s.companyGstin} onChange={(e) => setS({ ...s, companyGstin: e.target.value.toUpperCase() })} />
          <Select label="Supplier state (for CGST/SGST vs IGST)" value={s.supplierState} onChange={(e) => setS({ ...s, supplierState: e.target.value })}>{INDIAN_STATES.map((x) => <option key={x}>{x}</option>)}</Select>
          <Input label="Inactivity sign-out (minutes)" type="number" min={5} max={480} value={s.sessionMinutes} onChange={(e) => setS({ ...s, sessionMinutes: Number(e.target.value) })} hint="A warning shows 1 minute before." />
          <Button icon={Save} className="w-fit" onClick={() => run(() => updateSettings(me, { companyName: s.companyName, companyGstin: s.companyGstin, supplierState: s.supplierState, sessionMinutes: Math.max(5, s.sessionMinutes || 60) }), 'Settings saved')}>Save settings</Button>
        </div>
      </Card>
      <BranchesCard />
      <Card className="overflow-hidden">
        <CardHeader title="Attendance rules" icon={Lock} />
        <div className="space-y-3 p-4 text-sm">
          <label className="flex items-center justify-between gap-3 font-semibold">
            Block sign-in after Logout until the next day
            <Toggle checked={db.settings.dayLock === true} label="Block sign-in after Logout" onChange={(v) => run(() => updateSettings(me, { dayLock: v }), v ? 'Lock on — after Logout, people sign in again tomorrow' : 'Lock off — people can sign in again after Logout')} />
          </label>
          <p className="text-mute">{db.settings.dayLock === true
            ? 'On: after Logout a person cannot sign in again until tomorrow (IT and Super Admin always can; HR can re-open a day).'
            : 'Off (testing): people can sign in again after Logout, and their day re-opens. Turn this on before going live.'}</p>
          <p className="text-xs text-mute">The 40-minute daily break limit always applies.</p>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Sign-in" icon={Lock} />
        <div className="space-y-3 p-4 text-sm">
          <label className="flex items-center justify-between gap-3 font-semibold">
            Ask for the email code at sign-in
            <Toggle checked={db.settings.loginCode !== false} label="Ask for the email code at sign-in" onChange={(v) => run(() => updateSettings(me, { loginCode: v }), v ? 'Email code on — sign-in needs the password and the 6-digit code' : 'Email code off — everyone signs in with their password')} />
          </label>
          <p className="text-mute">{db.settings.loginCode !== false
            ? 'On: after the password, a 6-digit code is emailed and must be entered. This needs a mail service on the live server (RESEND_API_KEY on Render) — without one nobody receives the code.'
            : 'Off: everyone signs in with their username / email and password only. Turn it back on once the code emails arrive.'}</p>
          {db.settings.loginCode !== false && <>
            <label className="flex items-center justify-between gap-3 border-t border-line pt-3 font-semibold">
              Show the code on screen when it can't be emailed (developer mode)
              <Toggle checked={db.settings.loginCodeOnScreen === true} label="Show the code on screen" onChange={(v) => run(() => updateSettings(me, { loginCodeOnScreen: v }), v ? 'Developer mode on — the code shows on the sign-in screen when email fails' : 'Developer mode off — the code is only emailed')} />
            </label>
            <p className={db.settings.loginCodeOnScreen ? 'text-warn' : 'text-mute'}>{db.settings.loginCodeOnScreen
              ? 'On: if the code email fails, the 6-digit code is shown on the sign-in screen. Anyone who knows a password then gets in without email access — turn this off once emails work.'
              : 'Off: the code is only sent by email.'}</p>
          </>}
        </div>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Demo data" icon={RefreshCcw} />
        <div className="space-y-3 p-4 text-sm">
          <p className="text-mute">This build stores data in your browser. Reset brings back the sample company, users, leads and CRM entries.</p>
          <p className="text-mute">Last sign-in activity: {db.audit.find((a) => a.action === 'SIGN_IN') ? `${userName(db, db.audit.find((a) => a.action === 'SIGN_IN')!.by)} · ${fmtDate(db.audit.find((a) => a.action === 'SIGN_IN')!.at)}` : '—'}</p>
          <Button variant="danger" icon={RefreshCcw} onClick={async () => { if (await confirm('Reset all data?', 'Every change made in this browser will be lost.', true)) { await resetDemoData(); location.href = '/login' } }}>Reset demo data</Button>
        </div>
      </Card>
      {node}
    </div>
  )
}
