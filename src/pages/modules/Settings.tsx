import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bell, KeyRound, LogOut, Monitor, Moon, Palette, Save, Settings as SettingsIcon, ShieldCheck, Sun, Trash2, Upload, User as UserIcon } from 'lucide-react'
import { useDb } from '../../lib/store'
import { applyTheme, getTheme, useAuth, useMe, type Theme } from '../../lib/auth'
import { changePassword, updateProfile } from '../../lib/actions'
import { INDIAN_STATES, fmtDateTime } from '../../lib/format'
import { roleLabel, rolesOf } from '../../lib/rbac'
import { POPUP_KEY } from '../../layout/Shell'
import { Avatar, Badge, Button, Card, CardHeader, cx, FileButton, Input, PageHeader, Select, Toggle, readAsDataUrl, useRun } from '../../components/ui'

type Tab = 'profile' | 'security' | 'notifications' | 'appearance'

export default function Settings() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'profile'
  const items: { id: Tab; label: string; icon: typeof UserIcon }[] = [
    { id: 'profile', label: 'Profile', icon: UserIcon }, { id: 'security', label: 'Security', icon: ShieldCheck },
    { id: 'notifications', label: 'Notifications', icon: Bell }, { id: 'appearance', label: 'Appearance', icon: Palette },
  ]
  return (
    <div>
      <PageHeader title="Profile Settings" subtitle="Your own account only — role and permissions are managed by a Super Admin" icon={SettingsIcon} />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <Card className="h-fit p-2">
          <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-mute">General settings</p>
          {items.map((i) => (
            <button key={i.id} onClick={() => setParams({ tab: i.id })} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold', tab === i.id ? 'bg-brand-soft text-brand-ink' : 'text-ink/80 hover:bg-card2')}>
              <i.icon className="size-4" />{i.label}
            </button>
          ))}
        </Card>
        <div>{tab === 'profile' ? <Profile /> : tab === 'security' ? <Security /> : tab === 'notifications' ? <Notifs /> : <Appearance />}</div>
      </div>
    </div>
  )
}

function Profile() {
  const me = useMe()
  const run = useRun()
  const init = { name: me.name, phone: me.phone, line: me.address?.line ?? '', city: me.address?.city ?? '', state: me.address?.state ?? 'Gujarat', pin: me.address?.pin ?? '', country: me.address?.country ?? 'India' }
  const [f, setF] = useState(init)
  const dirty = JSON.stringify(f) !== JSON.stringify(init)
  const save = () => run(() => updateProfile(me, { name: f.name, phone: f.phone, address: { line: f.line, city: f.city, state: f.state, pin: f.pin, country: f.country } }), 'Profile saved')
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Employee information" icon={UserIcon} />
      <div className="flex flex-wrap items-center gap-5 border-b border-line p-5">
        <Avatar name={me.name} photo={me.photo} size={84} />
        <div>
          <div className="flex flex-wrap gap-2">
            <FileButton accept="image/png,image/jpeg,image/gif" maxBytes={800 * 1024} onFile={async (file) => { const url = await readAsDataUrl(file); run(() => updateProfile(me, { photo: url }), 'Photo updated') }}><Button size="sm" icon={Upload}>Upload file</Button></FileButton>
            {me.photo && <Button size="sm" variant="outline" icon={Trash2} onClick={() => run(() => updateProfile(me, { photo: undefined }), 'Photo removed')}>Remove</Button>}
          </div>
          <p className="mt-2 text-xs text-mute">JPG, GIF or PNG. Max 800 KB. Shown as your avatar everywhere.</p>
        </div>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Input label="Full name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label="User name" value={me.username} disabled hint="Ask an admin to change it" />
        <Input label="Phone number" required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <Input label="Email" value={me.email} disabled hint="Your sign-in address (read-only)" />
        <Input label="Address" value={f.line} onChange={(e) => setF({ ...f, line: e.target.value })} className="sm:col-span-2" />
        <Select label="Country" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}><option>India</option><option>Other</option></Select>
        <Select label="State / Province" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Input label="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
        <Input label="Postal code" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} maxLength={6} />
      </div>
      <div className="flex justify-end gap-2 border-t border-line p-4">
        <Button variant="outline" disabled={!dirty} onClick={() => setF(init)}>Cancel</Button>
        <Button icon={Save} disabled={!dirty} onClick={save}>Save changes</Button>
      </div>
    </Card>
  )
}

function Security() {
  const db = useDb()
  const me = useMe()
  const { signOut, perms } = useAuth()
  const run = useRun()
  const [p, setP] = useState({ cur: '', next: '', again: '' })
  const lastSignIn = db.audit.find((a) => a.by === me.id && a.action === 'SIGN_IN')
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader title="Change password" icon={KeyRound} />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Input label="Current password" type="password" autoComplete="current-password" value={p.cur} onChange={(e) => setP({ ...p, cur: e.target.value })} />
          <Input label="New password" type="password" autoComplete="new-password" value={p.next} onChange={(e) => setP({ ...p, next: e.target.value })} hint="8–16 chars, upper, lower, number, symbol" />
          <Input label="Repeat new password" type="password" autoComplete="new-password" value={p.again} onChange={(e) => setP({ ...p, again: e.target.value })} error={p.again && p.again !== p.next ? 'Does not match' : undefined} />
        </div>
        <div className="flex justify-end border-t border-line p-4"><Button disabled={!p.cur || !p.next || p.next !== p.again} onClick={async () => { if (await run(() => changePassword(me, p.cur, p.next), 'Password changed')) setP({ cur: '', next: '', again: '' }) }}>Update password</Button></div>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Sign-in & access" icon={ShieldCheck} />
        <div className="grid gap-3 p-5 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-card2 p-3"><p className="text-xs text-mute">Two-step verification</p><Badge tone="green" className="mt-1">On · emailed 6-digit code</Badge></div>
          <div className="rounded-xl bg-card2 p-3"><p className="text-xs text-mute">Last sign-in</p><p className="font-semibold">{fmtDateTime(lastSignIn?.at)}</p></div>
          <div className="rounded-xl bg-card2 p-3"><p className="text-xs text-mute">Roles</p><p className="font-semibold">{rolesOf(me).map(roleLabel).join(', ')}</p></div>
          <div className="rounded-xl bg-card2 p-3"><p className="text-xs text-mute">Permissions</p><p className="font-semibold">{perms.size} granted</p></div>
        </div>
        <div className="border-t border-line p-4"><Button variant="outline" icon={LogOut} onClick={() => signOut()}>Sign out everywhere</Button></div>
      </Card>
    </div>
  )
}

function Notifs() {
  const [off, setOff] = useState(() => { try { return localStorage.getItem(POPUP_KEY) === '1' } catch { return false } })
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Notifications" icon={Bell} />
      <div className="flex items-center justify-between gap-4 p-5">
        <div><p className="font-semibold">Dashboard pop-up bubble</p><p className="text-sm text-mute">Show the newest unread notification at the bottom-right (this device only). Takes effect on next page load.</p></div>
        <Toggle checked={!off} onChange={(v) => { setOff(!v); try { localStorage.setItem(POPUP_KEY, v ? '0' : '1') } catch { /* ignore */ } }} label="Pop-up" />
      </div>
    </Card>
  )
}

function Appearance() {
  const [theme, setTheme] = useState<Theme>(getTheme)
  const opts: { id: Theme; label: string; icon: typeof Sun }[] = [{ id: 'light', label: 'Light', icon: Sun }, { id: 'dark', label: 'Dark', icon: Moon }, { id: 'system', label: 'System', icon: Monitor }]
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Appearance" icon={Palette} />
      <div className="grid gap-4 p-5 sm:grid-cols-3">
        {opts.map((o) => (
          <button key={o.id} onClick={() => { setTheme(o.id); applyTheme(o.id) }} className={cx('rounded-2xl border-2 p-4 text-left transition', theme === o.id ? 'border-brand bg-brand-soft' : 'border-line hover:bg-card2')}>
            <div className={cx('mb-3 h-20 rounded-xl border border-line', o.id === 'dark' ? 'bg-[#0b1020]' : o.id === 'light' ? 'bg-[#f4f6fb]' : 'bg-gradient-to-r from-[#f4f6fb] to-[#0b1020]')} />
            <p className="flex items-center gap-2 font-semibold"><o.icon className="size-4" />{o.label}</p>
          </button>
        ))}
      </div>
    </Card>
  )
}
