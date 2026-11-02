import { useEffect, useState } from 'react'
import { KeyRound, UserPlus } from 'lucide-react'
import type { Role } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { createUser, PASSWORD_HINT, PASSWORD_RULE, resetUserPassword, updateUser } from '../lib/actions'
import { isPhone, normPhone } from '../lib/format'
import { canManageRoles, ROLES, roleLabel, rolesOf } from '../lib/rbac'
import { Badge, Button, Input, Modal, Select, useRun } from './ui'

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

/**
 * One window to give someone a CRM sign-in: role, name, email, mobile and password. A new email creates the
 * employee and their Supabase sign-in; an email that is already a CRM account (e.g. a team account added in
 * Supabase) gets the password — and the role, if it was changed — so it is never duplicated.
 * The password goes straight to the server (Supabase Authentication); it is never kept in the CRM.
 */
export function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const blank = { role: 'sales' as Role, name: '', email: '', phone: '', password: '', confirm: '', show: false }
  const [f, setF] = useState(blank)
  const [tried, setTried] = useState(false)
  useEffect(() => { if (open) { setF(blank); setTried(false) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }))
  const roles = ROLES.filter((r) => r.id !== 'superadmin' || rolesOf(me).includes('superadmin'))
  const existing = isEmail(f.email) ? db.users.find((u) => u.active && u.email.toLowerCase() === f.email.trim().toLowerCase()) : undefined
  // an existing account opens with its own name and role
  useEffect(() => { if (existing) setF((x) => ({ ...x, name: existing.name, role: existing.role })) }, [existing?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const errors = {
    name: !existing && f.name.trim().length < 2 ? 'Enter the name.' : '',
    email: !isEmail(f.email) ? 'Enter a valid email.' : '',
    phone: !existing && !isPhone(f.phone) ? 'Enter a valid 10-digit mobile number (the dialer calls it).' : '',
    password: !PASSWORD_RULE.test(f.password) ? PASSWORD_HINT : '',
    confirm: f.password !== f.confirm ? 'The two passwords do not match.' : '',
  }
  const bad = Object.values(errors).some(Boolean)
  const show = (k: keyof typeof errors) => (tried && errors[k]) || undefined

  /** a username nobody active uses: the part of the email before @ (sales, sales2 …) */
  const usernameFor = (email: string) => {
    const base = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'user'
    const taken = new Set(db.users.filter((u) => u.active).map((u) => u.username.toLowerCase()))
    let name = base, n = 2
    while (taken.has(name)) name = `${base}${n++}`
    return name
  }

  const save = async () => {
    setTried(true)
    if (bad) return
    const email = f.email.trim().toLowerCase()
    if (existing) {
      const ok = await run(async () => {
        // roles are IT Support's (Access Control): anyone else only sets the password
        if (existing.role !== f.role && canManageRoles(me)) updateUser(me, existing.id, { role: f.role })
        await resetUserPassword(me, existing.id, f.password)
      }, `Sign-in ready for ${existing.name} (${roleLabel(f.role)}) — share the password with them privately`)
      if (ok) onClose()
      return
    }
    const label = roleLabel(f.role)
    const ok = await run(() => createUser(me, { name: f.name.trim(), username: usernameFor(email), email, phone: normPhone(f.phone), role: f.role, department: label, designation: label }, f.password, undefined),
      `User created: ${f.name.trim()} (${label}) — share the password with them privately`)
    if (ok) onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Create user" subtitle="A CRM sign-in with a role and a password" size="md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon={existing ? KeyRound : UserPlus} onClick={save}>{existing ? 'Set password' : 'Create user'}</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <Select label="Role" required value={f.role} disabled={!!existing && !canManageRoles(me)} hint={existing && !canManageRoles(me) ? 'An existing account keeps its role — IT Support changes roles.' : undefined} onChange={(e) => set({ role: e.target.value as Role })} className="sm:col-span-2">
          {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Select>
        <Input label="Email (login ID)" required type="email" autoComplete="off" value={f.email} onChange={(e) => set({ email: e.target.value })} error={show('email')} />
        <Input label="Full name" required value={f.name} disabled={!!existing} onChange={(e) => set({ name: e.target.value })} error={show('name')} />
        {existing ? (
          <p className="flex flex-wrap items-center gap-2 rounded-xl bg-info-soft px-3 py-2 text-xs text-info sm:col-span-2">
            <Badge tone="blue">Already in the CRM</Badge>{existing.name} · {roleLabel(existing.role)} — this sets their password{existing.role !== f.role ? ` and changes the role to ${roleLabel(f.role)}` : ''}.
          </p>
        ) : (
          <Input label="Mobile" required inputMode="numeric" value={f.phone} onChange={(e) => set({ phone: e.target.value })} error={show('phone')} className="sm:col-span-2" />
        )}
        <Input label="Password" required type={f.show ? 'text' : 'password'} autoComplete="new-password" value={f.password} onChange={(e) => set({ password: e.target.value })} hint={PASSWORD_HINT} error={show('password')} />
        <Input label="Confirm password" required type={f.show ? 'text' : 'password'} autoComplete="new-password" value={f.confirm} onChange={(e) => set({ confirm: e.target.value })} error={show('confirm')} />
        <label className="flex items-center gap-2 text-xs text-mute sm:col-span-2"><input type="checkbox" checked={f.show} onChange={(e) => set({ show: e.target.checked })} className="accent-[var(--brand)]" />Show password</label>
        <p className="text-xs text-mute sm:col-span-2">They sign in with this email (or the username shown in Access Management) and the password. The password is saved only in Supabase sign-in, encrypted — nobody can read it back.</p>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
