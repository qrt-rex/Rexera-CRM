import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity, AlertTriangle, Camera, CheckCircle2, DatabaseBackup, DatabaseZap, Download, Eraser, HardDrive, KeyRound, LayoutGrid, Lock, LogOut, RefreshCcw,
  ScrollText, ShieldAlert, ShieldCheck, Stethoscope, Unlock, UserCog, Users, Wrench, XCircle, type LucideIcon,
} from 'lucide-react'
import type { Role } from '../../lib/types'
import { approxDataBytes, storageBackend, useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { updateUser, userName } from '../../lib/actions'
import { SetPasswordModal } from '../../components/SetPasswordModal'
import { ROLES, isMaster, roleLabel, rolesOf } from '../../lib/rbac'
import {
  autoSnapshotIfDue, cleanupOldData, createSnapshot, downloadBackup, keyStatus, runHealthCheck, setMaintenance, signOutEveryone, unlockAllAccounts,
  type HealthItem,
} from '../../lib/itops'
import { ago, downloadCsv, fmtDateTime, today } from '../../lib/format'
import { Avatar, Badge, Button, Card, Checkbox, cx, Input, Modal, Select, Textarea, Toggle, useConfirm, useRun, useToast } from '../../components/ui'
import { Greeting, LoginLogoutCard, Section, ViewAll } from './widgets'

type Tone = 'navy' | 'green' | 'orange' | 'red' | 'violet' | 'blue' | 'amber' | 'gray' | 'cyan'
const chip: Record<Tone, string> = {
  navy: 'bg-brand-soft text-brand-ink', green: 'bg-ok-soft text-ok', orange: 'bg-accent-soft text-accent', red: 'bg-bad-soft text-bad', violet: 'bg-violet-500/12 text-violet-600 dark:text-violet-300',
  blue: 'bg-info-soft text-info', amber: 'bg-warn-soft text-warn', gray: 'bg-card2 text-mute', cyan: 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-300',
}

function Action({ icon: Icon, label, hint, tone, onClick, to, busy, danger }: { icon: LucideIcon; label: string; hint: string; tone: Tone; onClick?: () => void; to?: string; busy?: boolean; danger?: boolean }) {
  const inner = (
    <>
      <span className={cx('grid size-11 shrink-0 place-items-center rounded-xl transition group-hover:scale-105', chip[tone])}>{busy ? <RefreshCcw className="size-5 animate-spin" /> : <Icon className="size-5" />}</span>
      <span className="min-w-0 text-left"><span className={cx('block text-sm font-bold', danger && 'text-bad')}>{label}</span><span className="block truncate text-[11px] text-mute">{hint}</span></span>
    </>
  )
  const cls = 'group flex items-center gap-3 rounded-2xl border border-line bg-card p-3.5 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop disabled:opacity-60'
  return to ? <Link to={to} className={cls}>{inner}</Link> : <button disabled={busy} onClick={onClick} className={cls}>{inner}</button>
}

export function ItDashboard() {
  const db = useDb()
  const me = useMe()
  const { signIn } = useAuth()
  const run = useRun()
  const toast = useToast()
  const nav = useNavigate()
  const [confirm, confirmNode] = useConfirm()
  const [busy, setBusy] = useState('')
  const [health, setHealth] = useState<HealthItem[] | null>(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [pass, setPass] = useState('')
  const [assignOpen, setAssignOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [maintOpen, setMaintOpen] = useState(false)
  const [maintMsg, setMaintMsg] = useState(db.settings.maintenance?.message ?? '')
  const autoRan = useRef(false)

  const check = async () => { setBusy('health'); setHealth(await runHealthCheck()); setBusy('') }
  useEffect(() => {
    if (autoRan.current) return
    autoRan.current = true
    check()
    autoSnapshotIfDue(me).then((made) => { if (made) { toast('info', 'Automatic daily snapshot saved'); check() } }, () => {})
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const active = db.users.filter((u) => u.active)
  const signedToday = new Set(db.sessions.filter((s) => s.date === today()).map((s) => s.userId)).size
  const fails = Object.entries(db.loginFails)
  const locked = fails.filter(([, f]) => f.until && new Date(f.until) > new Date())
  const keys = db.apiKeys.filter((k) => keyStatus(k) === 'active')
  const lastBackup = db.backupLog.find((b) => b.kind !== 'RESTORE')
  const warnings = health?.filter((h) => h.level !== 'ok').length ?? 0
  const errors = health?.filter((h) => h.level === 'error').length ?? 0
  const maint = db.settings.maintenance
  const events = db.audit.filter((a) => /SIGN_IN|SIGN_OUT|PASSWORD|ACCESS|USER_|ROLE_|API_KEY|BACKUP|MAINTENANCE|UNLOCK|SETTINGS/.test(a.action)).slice(0, 10)
  const custom = db.users.filter((u) => u.grants.length || u.denies.length || u.extraRoles.length)
  const dataSize = useMemo(() => { const b = approxDataBytes(); return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB` }, [db])

  const doAndRecheck = async (key: string, fn: () => unknown, ok: string) => { setBusy(key); const r = await run(fn, ok); setBusy(''); if (r !== undefined) check() }

  return (
    <div>
      <Greeting subtitle="IT Support · master access — users, access, API keys, backups and system health"
        right={
          <button onClick={check} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 text-left backdrop-blur hover:bg-white/15">
            {health === null || busy === 'health' ? <RefreshCcw className="size-8 animate-spin text-white/80" /> : errors ? <XCircle className="size-8 text-red-300" /> : warnings ? <AlertTriangle className="size-8 text-amber-300" /> : <CheckCircle2 className="size-8 text-emerald-300" />}
            <span><span className="block text-xs text-white/70">System health</span><span className="block text-lg font-extrabold">{health === null ? 'Checking…' : errors ? `${errors} problem${errors > 1 ? 's' : ''}` : warnings ? `${warnings} to review` : 'All good'}</span></span>
          </button>
        } />

      {maint?.on && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm">
          <Wrench className="size-5 text-warn" /><b className="text-warn">Maintenance mode is ON</b><span className="text-mute">since {fmtDateTime(maint.at)} by {userName(db, maint.by)}</span>
          <Button size="sm" className="ml-auto" onClick={() => doAndRecheck('maint', () => setMaintenance(me, false, ''), 'Maintenance mode off — everyone can sign in')}>Turn off</Button>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <Stat icon={Users} tone="navy" label="Active accounts" value={`${active.length}`} sub={`${db.users.length - active.length} inactive`} />
        <Stat icon={Activity} tone="green" label="Signed in today" value={`${signedToday}`} sub={`of ${active.length}`} />
        <Stat icon={ShieldAlert} tone={locked.length ? 'red' : 'amber'} label="Locked / failed" value={`${locked.length} / ${fails.reduce((s, [, f]) => s + f.count, 0)}`} sub="sign-ins" />
        <Stat icon={KeyRound} tone="violet" label="API keys" value={`${keys.length}`} sub={`${db.apiKeys.length - keys.length} revoked/expired`} />
        <Stat icon={DatabaseBackup} tone="cyan" label="Last backup" value={lastBackup ? ago(lastBackup.at) : 'never'} sub={lastBackup?.kind.toLowerCase().replace('_', ' ') ?? 'take one now'} />
        <Stat icon={HardDrive} tone="gray" label="Data size" value={dataSize} sub={storageBackend() === 'indexeddb' ? 'stored in IndexedDB' : 'localStorage fallback'} />
      </div>

      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-mute">One-click actions</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        <Action icon={Stethoscope} tone="green" label="Run health check" hint="Storage, passwords, owners, backups" busy={busy === 'health'} onClick={check} />
        <Action icon={Camera} tone="cyan" label="Snapshot now" hint="Saved in this browser · restore any time" busy={busy === 'snap'} onClick={() => doAndRecheck('snap', () => createSnapshot(me, 'Snapshot from IT dashboard'), 'Snapshot saved')} />
        <Action icon={Download} tone="navy" label="Download backup" hint="Encrypted file of all data" onClick={() => { setPass(''); setBackupOpen(true) }} />
        <Action icon={UserCog} tone="violet" label="Assign access" hint="Role, extra roles, active" onClick={() => setAssignOpen(true)} />
        <Action icon={KeyRound} tone="orange" label="API keys" hint="Create, rotate, revoke" to="/api-keys" />
        <Action icon={Unlock} tone="amber" label="Unlock all accounts" hint={`${fails.length} with failed sign-ins`} busy={busy === 'unlock'} onClick={() => doAndRecheck('unlock', () => unlockAllAccounts(me), 'All sign-in locks cleared')} />
        <Action icon={RefreshCcw} tone="blue" label="Set a password" hint="Type a new password for someone" onClick={() => setResetOpen(true)} />
        <Action icon={Wrench} tone={maint?.on ? 'red' : 'amber'} label={maint?.on ? 'End maintenance' : 'Maintenance mode'} hint={maint?.on ? 'Let everyone back in' : 'Only IT & Super Admin can sign in'} onClick={() => maint?.on ? doAndRecheck('maint', () => setMaintenance(me, false, ''), 'Maintenance mode off') : setMaintOpen(true)} />
        <Action icon={LogOut} tone="red" label="Sign out everyone" hint="Ends every session (you stay in)" danger onClick={async () => {
          if (await confirm('Sign out everyone?', 'Every signed-in person is signed out and must sign in again. You stay signed in.', true)) {
            if (await run(() => signOutEveryone(me), 'Everyone has been signed out')) signIn(me.id)
          }
        }} />
        <Action icon={Eraser} tone="gray" label="Clean up old data" hint="Read notifications > 30 d, activity > 180 d" busy={busy === 'clean'} onClick={async () => {
          if (await confirm('Clean up old data?', 'Removes read notifications older than 30 days and activity log entries older than 180 days. Take a backup first if you need them.')) doAndRecheck('clean', () => cleanupOldData(me), 'Old data cleaned up')
        }} />
        <Action icon={ScrollText} tone="gray" label="Export activity log" hint={`${db.audit.length} entries as CSV`} onClick={() => downloadCsv(`activity-${today()}.csv`, db.audit.map((a) => ({ at: a.at, by: userName(db, a.by), action: a.action, detail: a.detail })))} />
        <Action icon={LayoutGrid} tone="navy" label="Access management" hint="Permission matrix, users, settings" to="/access" />
        <Action icon={DatabaseZap} tone="violet" label="Import from old CRM" hint="Old PHP CRM .sql dump · verified before saving" to="/legacy-import" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Section title="Health check" subtitle={health ? `${health.length} checks · ${warnings} to review` : 'Running…'} icon={Stethoscope} className="xl:col-span-2"
          action={<Button size="sm" variant="ghost" icon={RefreshCcw} onClick={check}>Re-run</Button>}>
          <ul className="divide-y divide-line/70">
            {(health ?? []).map((h) => (
              <li key={h.id} className="flex items-start gap-3 px-5 py-3">
                {h.level === 'ok' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" /> : h.level === 'warn' ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-bad" />}
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{h.title}</p><p className="text-xs text-mute">{h.detail}</p></div>
                {h.fix && <Button size="sm" variant="soft" loading={busy === 'fix-' + h.id} onClick={() => doAndRecheck('fix-' + h.id, () => h.fix!.run(me), `${h.title}: fixed`)}>{h.fix.label}</Button>}
              </li>
            ))}
            {health === null && <li className="px-5 py-6 text-sm text-mute">Checking the system…</li>}
          </ul>
        </Section>
        <div className="space-y-6">
          <Section title="Security watch" icon={ShieldAlert}>
            <ul className="divide-y divide-line/70">
              {fails.map(([login, f]) => (
                <li key={login} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{login}</span>
                  {f.until && new Date(f.until) > new Date() ? <Badge tone="red"><Lock className="size-3" />locked</Badge> : <Badge tone="amber">{f.count} failed</Badge>}
                </li>
              ))}
              {!fails.length && <li className="px-5 py-4 text-sm text-mute">No failed sign-ins. 🔒</li>}
            </ul>
          </Section>
          <LoginLogoutCard />
        </div>

        <Section title="Access overview" subtitle="People per role · custom access" icon={ShieldCheck} className="xl:col-span-2" action={<ViewAll to="/access" />}>
          <div className="flex flex-wrap gap-2 px-5 pb-3 pt-1">
            {ROLES.map((r) => { const n = active.filter((u) => rolesOf(u).includes(r.id)).length; return n ? <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-semibold"><span className="size-2 rounded-full" style={{ background: r.color }} />{r.label} · {n}</span> : null })}
          </div>
          <ul className="divide-y divide-line/70 border-t border-line">
            {custom.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <Avatar name={u.name} photo={u.photo} size={28} />
                <span className="min-w-0 flex-1"><span className="font-semibold">{u.name}</span> <span className="text-xs text-mute">· {roleLabel(u.role)}{u.extraRoles.length ? ` + ${u.extraRoles.map(roleLabel).join(', ')}` : ''}</span></span>
                {u.grants.length > 0 && <Badge tone="green">+{u.grants.length}</Badge>}{u.denies.length > 0 && <Badge tone="red">−{u.denies.length}</Badge>}
              </li>
            ))}
            {!custom.length && <li className="px-5 py-4 text-sm text-mute">Nobody has extra roles or per-person permissions — everyone uses their role's defaults.</li>}
          </ul>
        </Section>
        <Section title="Sign-in & access events" icon={Activity} action={<ViewAll to="/audit" />}>
          <ul className="divide-y divide-line/70">
            {events.map((a) => (
              <li key={a.id} className="px-5 py-2.5 text-sm">
                <p className="truncate"><b>{userName(db, a.by)}</b> <span className="text-mute">{a.detail}</span></p>
                <p className="text-[11px] text-mute">{a.action.toLowerCase().replace(/_/g, ' ')} · {ago(a.at)}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {/* modals */}
      <Modal open={backupOpen} onClose={() => setBackupOpen(false)} title="Download encrypted backup" size="sm"
        footer={<><Button variant="outline" onClick={() => nav('/backup')}>More options</Button><Button icon={Download} loading={busy === 'dl'} disabled={pass.length < 8} onClick={async () => { setBusy('dl'); const ok = await run(() => downloadBackup(me, pass), 'Backup downloaded'); setBusy(''); if (ok) { setBackupOpen(false); check() } }}>Download</Button></>}>
        <Input label="Passphrase (8+ characters)" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus hint="Needed to restore. Keep it somewhere safe." />
      </Modal>
      <AssignAccess open={assignOpen} onClose={() => setAssignOpen(false)} />
      <SetPasswordModal open={resetOpen} onClose={() => setResetOpen(false)} people={db.users.filter((u) => u.id !== me.id && (rolesOf(me).includes('superadmin') || !rolesOf(u).includes('superadmin'))).sort((a, b) => a.name.localeCompare(b.name))} />
      <Modal open={maintOpen} onClose={() => setMaintOpen(false)} title="Turn on maintenance mode" size="sm"
        footer={<><Button variant="outline" onClick={() => setMaintOpen(false)}>Cancel</Button><Button variant="danger" icon={Wrench} onClick={async () => { if (await run(() => setMaintenance(me, true, maintMsg), 'Maintenance mode on')) { setMaintOpen(false); check() } }}>Turn on</Button></>}>
        <p className="mb-3 text-sm text-mute">Everyone except IT Support and Super Admin sees a maintenance screen and can't sign in until you turn it off.</p>
        <Textarea label="Message shown to users" value={maintMsg} onChange={(e) => setMaintMsg(e.target.value)} placeholder="e.g. Upgrading the system, back by 6 pm" />
      </Modal>
      {confirmNode}
    </div>
  )
}

function Stat({ icon: Icon, tone, label, value, sub }: { icon: LucideIcon; tone: Tone; label: string; value: ReactNode; sub: string }) {
  return (
    <Card className="p-3.5">
      <div className="flex items-center gap-2"><span className={cx('grid size-8 place-items-center rounded-lg', chip[tone])}><Icon className="size-4" /></span><span className="truncate text-[11px] font-semibold text-mute">{label}</span></div>
      <p className="mt-1.5 truncate text-xl font-extrabold">{value}</p><p className="truncate text-[11px] text-mute">{sub}</p>
    </Card>
  )
}

/** Quick role / extra-role / active assignment. Fine-grained permissions stay in Access Management. */
function AssignAccess({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const sa = rolesOf(me).includes('superadmin')
  const people = useMemo(() => db.users.filter((u) => u.id !== me.id && (sa || !rolesOf(u).includes('superadmin'))).sort((a, b) => a.name.localeCompare(b.name)), [db.users, me.id, sa])
  const [userId, setUserId] = useState('')
  const u = db.users.find((x) => x.id === userId)
  const [role, setRole] = useState<Role>('sales')
  const [extra, setExtra] = useState<Role[]>([])
  const [activeFlag, setActiveFlag] = useState(true)
  useEffect(() => { if (u) { setRole(u.role); setExtra(u.extraRoles); setActiveFlag(u.active) } }, [u])
  const roles = ROLES.filter((r) => sa || r.id !== 'superadmin')
  return (
    <Modal open={open} onClose={onClose} title="Assign access" subtitle="Changes apply immediately and are written to the activity log"
      footer={<><Link to="/access" onClick={onClose} className="mr-auto self-center text-xs font-semibold text-brand-ink hover:underline">Per-permission allow / deny →</Link><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button icon={UserCog} disabled={!u} onClick={async () => { if (u && await run(() => updateUser(me, u.id, { role, extraRoles: extra.filter((r) => r !== role), active: activeFlag }), `Access updated for ${u.name}`)) onClose() }}>Save access</Button></>}>
      <div className="grid gap-4">
        <Select label="Person" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">— Select —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name} · {roleLabel(p.role)}{p.active ? '' : ' (inactive)'}</option>)}
        </Select>
        {u && <>
          <Select label="Main role (decides their dashboard)" value={role} onChange={(e) => setRole(e.target.value as Role)}>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}{isMaster({ ...u, role: r.id, extraRoles: [] }) ? ' — master access' : ''}</option>)}</Select>
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-mute">Extra roles (adds their permissions)</span>
            <div className="grid grid-cols-2 gap-2">{roles.filter((r) => r.id !== role).map((r) => <Checkbox key={r.id} checked={extra.includes(r.id)} label={r.label} onChange={(v) => setExtra(v ? [...extra, r.id] : extra.filter((x) => x !== r.id))} />)}</div>
          </div>
          <label className="flex items-center justify-between rounded-xl bg-card2 px-3 py-2.5 text-sm font-semibold">Account active <Toggle checked={activeFlag} onChange={setActiveFlag} label="Account active" /></label>
        </>}
      </div>
    </Modal>
  )
}
