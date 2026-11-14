import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity, AlertTriangle, ArrowLeftRight, Bug, Camera, FileSpreadsheet, GraduationCap, CheckCircle2, DatabaseBackup, DatabaseZap, Download, Eraser, HardDrive, KeyRound, LayoutGrid, Lock, LogOut, RefreshCcw,
  ScrollText, ShieldAlert, ShieldCheck, Stethoscope, Trash2, Unlock, Upload, UserCog, UserPlus, Users, Wrench, XCircle, Image as ImageIcon, type LucideIcon,
} from 'lucide-react'
import { useFileUrl } from '../../components/ProofGallery'
import type { Role } from '../../lib/types'
import { approxDataBytes, getDb, storageBackend, useDb } from '../../lib/store'
import { CLOUD } from '../../lib/cloud'
import { useAuth, useMe } from '../../lib/auth'
import { createUser, PASSWORD_HINT, PASSWORD_RULE, resetUserPassword, updateUser, userName } from '../../lib/actions'
import { isPhone, normPhone } from '../../lib/format'
import { SetPasswordModal } from '../../components/SetPasswordModal'
import { ROLES, isMaster, roleLabel, rolesOf } from '../../lib/rbac'
import {
  autoSnapshotIfDue, cleanupOldData, createSnapshot, downloadBackup, keyStatus, MAINTENANCE_IMAGE_TYPES, runHealthCheck, setMaintenance, setMaintenanceImage, signOutEveryone, unlockAllAccounts,
  type HealthItem,
} from '../../lib/itops'
import { ago, downloadCsv, fmtDateTime, today } from '../../lib/format'
import { Avatar, Badge, Button, Card, Checkbox, cx, Input, Modal, Select, Textarea, Toggle, useConfirm, useRun, useToast } from '../../components/ui'
import { Greeting, LoginLogoutCard, Section, ViewAll } from './widgets'
import { UserActivity } from '../../components/UserActivity'
import { DeletedFiles } from '../../components/DeletedFiles'
import { BulkUsers } from '../../components/BulkUsers'

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

/** Maintenance mode → the picture on the maintenance screen: upload, preview, change or remove (IT Support). */
function MaintenanceImage() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const m = db.settings.maintenance
  const img = m?.image
  const { url, error } = useFileUrl(img)
  const pick = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const act = async (file: File | null, ok: string) => { setBusy(true); await run(() => setMaintenanceImage(me, file), ok); setBusy(false) }
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-sm font-semibold">Picture on the maintenance screen</p>
      <div className="grid min-h-36 place-items-center overflow-hidden rounded-xl border border-dashed border-line bg-card2 p-2">
        {img ? (url ? <img src={url} alt="Maintenance screen picture" className="max-h-48 w-auto max-w-full rounded-lg object-contain" />
          : error ? <span className="px-3 text-center text-xs text-bad">The picture could not be loaded — upload it again.</span>
            : <span className="text-xs text-mute">Loading…</span>)
          : <span className="flex flex-col items-center gap-1 px-3 text-center text-xs text-mute"><ImageIcon className="size-6" />No picture yet — users see the standard maintenance screen.</span>}
      </div>
      <input ref={pick} type="file" accept={MAINTENANCE_IMAGE_TYPES} className="hidden" aria-label="Choose the maintenance picture"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) act(f, img ? 'Picture changed — shown during maintenance' : 'Picture uploaded — shown during maintenance') }} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" icon={Upload} loading={busy} onClick={() => pick.current?.click()}>{img ? 'Change picture' : 'Upload image'}</Button>
        {img && <Button size="sm" variant="outline" icon={Trash2} disabled={busy} onClick={() => act(null, 'Picture removed')}>Remove</Button>}
      </div>
      <p className="mt-1.5 text-[11px] text-mute">
        JPG, PNG, WebP or GIF, up to 5 MB. Shown automatically whenever maintenance mode is on.
        {img && <> · {img.name}{m?.imageAt ? ` · ${fmtDateTime(m.imageAt)}` : ''}{m?.imageBy ? ` by ${userName(db, m.imageBy)}` : ''}</>}
      </p>
    </div>
  )
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
  const [createOpen, setCreateOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [maintOpen, setMaintOpen] = useState(false)
  const [maintMsg, setMaintMsg] = useState(db.settings.maintenance?.message ?? '')
  const [picOpen, setPicOpen] = useState(false)
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
          <Button size="sm" variant="outline" className="ml-auto" icon={ImageIcon} onClick={() => setPicOpen(true)}>{maint.image ? 'Change picture' : 'Upload image'}</Button>
          <Button size="sm" onClick={() => doAndRecheck('maint', () => setMaintenance(me, false, ''), 'Maintenance mode off — everyone can sign in')}>Turn off</Button>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <Stat icon={Users} tone="navy" label="Active accounts" value={`${active.length}`} sub={`${db.users.length - active.length} inactive`} />
        <Stat icon={Activity} tone="green" label="Signed in today" value={`${signedToday}`} sub={`of ${active.length}`} />
        <Stat icon={ShieldAlert} tone={locked.length ? 'red' : 'amber'} label="Locked / failed" value={`${locked.length} / ${fails.reduce((s, [, f]) => s + f.count, 0)}`} sub="sign-ins" />
        <Stat icon={KeyRound} tone="violet" label="API keys" value={`${keys.length}`} sub={`${db.apiKeys.length - keys.length} revoked/expired`} />
        <Stat icon={DatabaseBackup} tone="cyan" label="Last backup" value={lastBackup ? ago(lastBackup.at) : 'never'} sub={lastBackup?.kind.toLowerCase().replace('_', ' ') ?? 'take one now'} />
        <Stat icon={HardDrive} tone="gray" label="Data size" value={dataSize} sub={storageBackend() === 'indexeddb' ? 'stored in IndexedDB' : 'localStorage fallback'} />
      </div>

      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-mute">One-click actions</h2>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        <Action icon={Stethoscope} tone="green" label="Run health check" hint="Storage, passwords, owners, backups" busy={busy === 'health'} onClick={check} />
        <Action icon={Camera} tone="cyan" label="Snapshot now" hint={CLOUD ? 'Downloads a backup file to this computer' : 'Saved in this browser · restore any time'} busy={busy === 'snap'} onClick={() => doAndRecheck('snap', () => createSnapshot(me, 'Snapshot from IT dashboard'), 'Snapshot saved')} />
        <Action icon={Download} tone="navy" label="Download backup" hint="Encrypted file of all data" onClick={() => { setPass(''); setBackupOpen(true) }} />
        <Action icon={UserPlus} tone="green" label="Create user" hint="One email · one or more roles · password" onClick={() => setCreateOpen(true)} />
        <Action icon={FileSpreadsheet} tone="green" label="Add users from a sheet" hint="Whole team at once · roles, branch, password · replace old users" onClick={() => setBulkOpen(true)} />
        <Action icon={UserCog} tone="violet" label="Assign access" hint="Main role, extra roles, active" onClick={() => setAssignOpen(true)} />
        <Action icon={KeyRound} tone="orange" label="API keys" hint="Create, rotate, revoke" to="/api-keys" />
        <Action icon={Unlock} tone="amber" label="Unlock all accounts" hint={`${fails.length} with failed sign-ins`} busy={busy === 'unlock'} onClick={() => doAndRecheck('unlock', () => unlockAllAccounts(me), 'All sign-in locks cleared')} />
        <Action icon={RefreshCcw} tone="blue" label="Set a password" hint="Type a new password for someone" onClick={() => setResetOpen(true)} />
        <Action icon={Wrench} tone={maint?.on ? 'red' : 'amber'} label={maint?.on ? 'End maintenance' : 'Maintenance mode'} hint={maint?.on ? 'Let everyone back in' : 'Only IT & Super Admin can sign in'} onClick={() => maint?.on ? doAndRecheck('maint', () => setMaintenance(me, false, ''), 'Maintenance mode off') : setMaintOpen(true)} />
        <Action icon={ImageIcon} tone="amber" label="Maintenance picture" hint={maint?.image ? 'Change or remove the maintenance screen picture' : 'Upload the picture shown during maintenance'} onClick={() => setPicOpen(true)} />
        <Action icon={LogOut} tone="red" label="Sign out everyone" hint="Ends every session (you stay in)" danger onClick={async () => {
          if (await confirm('Sign out everyone?', 'Every signed-in person is signed out and must sign in again. You stay signed in.', true)) {
            if (await run(() => signOutEveryone(me), 'Everyone has been signed out')) signIn(me.id)
          }
        }} />
        <Action icon={Eraser} tone="gray" label="Clean up old data" hint="Read notifications > 30 d, activity > 180 d" busy={busy === 'clean'} onClick={async () => {
          if (await confirm('Clean up old data?', 'Removes read notifications older than 30 days and activity log entries older than 180 days. Take a backup first if you need them.')) doAndRecheck('clean', () => cleanupOldData(me), 'Old data cleaned up')
        }} />
        <Action icon={ScrollText} tone="gray" label="Export activity log" hint={`${db.audit.length} entries as CSV`} onClick={() => downloadCsv(`activity-${today()}.csv`, db.audit.map((a) => ({ at: a.at, by: userName(db, a.by), action: a.action, detail: a.detail })))} />
        <Action icon={ShieldCheck} tone="navy" label="Access Control" hint="Roles, permissions, every function — user by user" to="/access?tab=roles" />
        <Action icon={GraduationCap} tone="orange" label="Quiz Management" hint="Make, publish and archive Sales quizzes · every result" to="/quiz?tab=manage" />
        <Action icon={LayoutGrid} tone="cyan" label="Users & access" hint="Each person's role, functions and permissions" to="/access?tab=users" />
        <Action icon={Bug} tone="red" label="Error log & auto-fix" hint="Every error explained · fixed by itself where safe" to="/error-log" />
        <Action icon={ArrowLeftRight} tone="cyan" label="Old CRM sync" hint="Live copy ON/OFF · storage of both CRMs · log · setup" to="/legacy-sync" />
        <Action icon={DatabaseZap} tone="violet" label="Import from old CRM" hint="Old PHP CRM .sql dump · verified before saving" to="/legacy-import" />
      </div>

      {/* every page, click and action of every person — the IT team's alone */}
      <UserActivity />

      {/* a backup of everything deleted anywhere in the CRM, until IT Support deletes it for good */}
      <DeletedFiles compact />

      <div className="grid gap-5 xl:grid-cols-3">
        <Section title="Health check" subtitle={health ? `${health.length} checks · ${warnings} to review` : 'Running…'} icon={Stethoscope} className="xl:col-span-2"
          action={<Button size="sm" variant="ghost" icon={RefreshCcw} onClick={check}>Re-run</Button>}>
          <ul className="divide-y divide-line/70">
            {(health ?? []).map((h) => (
              <li key={h.id} className="flex items-start gap-3 px-4 py-2.5">
                {h.level === 'ok' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" /> : h.level === 'warn' ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-bad" />}
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{h.title}</p><p className="text-xs text-mute">{h.detail}</p></div>
                {h.fix && <Button size="sm" variant="soft" loading={busy === 'fix-' + h.id} onClick={() => doAndRecheck('fix-' + h.id, () => h.fix!.run(me), `${h.title}: fixed`)}>{h.fix.label}</Button>}
              </li>
            ))}
            {health === null && <li className="px-5 py-6 text-sm text-mute">Checking the system…</li>}
          </ul>
        </Section>
        <div className="space-y-5">
          <Section title="Security watch" icon={ShieldAlert}>
            <ul className="divide-y divide-line/70">
              {fails.map(([login, f]) => (
                <li key={login} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{login}</span>
                  {f.until && new Date(f.until) > new Date() ? <Badge tone="red"><Lock className="size-3" />locked</Badge> : <Badge tone="amber">{f.count} failed</Badge>}
                </li>
              ))}
              {!fails.length && <li className="px-4 py-3 text-sm text-mute">No failed sign-ins. 🔒</li>}
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
            {!custom.length && <li className="px-4 py-3 text-sm text-mute">Nobody has extra roles or per-person permissions — everyone uses their role's defaults.</li>}
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
      <CreateUserIt open={createOpen} onClose={() => setCreateOpen(false)} />
      <BulkUsers open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <SetPasswordModal open={resetOpen} onClose={() => setResetOpen(false)} people={db.users.filter((u) => u.id !== me.id && (rolesOf(me).includes('superadmin') || !rolesOf(u).includes('superadmin'))).sort((a, b) => a.name.localeCompare(b.name))} />
      <Modal open={maintOpen} onClose={() => setMaintOpen(false)} title="Turn on maintenance mode" size="sm"
        footer={<><Button variant="outline" onClick={() => setMaintOpen(false)}>Cancel</Button><Button variant="danger" icon={Wrench} onClick={async () => { if (await run(() => setMaintenance(me, true, maintMsg), 'Maintenance mode on')) { setMaintOpen(false); check() } }}>Turn on</Button></>}>
        <p className="mb-3 text-sm text-mute">Everyone except IT Support and Super Admin sees a maintenance screen and can't sign in until you turn it off.</p>
        <Textarea label="Message shown to users" value={maintMsg} onChange={(e) => setMaintMsg(e.target.value)} placeholder="e.g. Upgrading the system, back by 6 pm" />
        <MaintenanceImage />
      </Modal>
      <Modal open={picOpen} onClose={() => setPicOpen(false)} title="Maintenance screen picture" size="sm"
        footer={<Button variant="outline" onClick={() => setPicOpen(false)}>Done</Button>}>
        <p className="mb-1 text-sm text-mute">Everyone except IT Support and Super Admin sees this picture whenever maintenance mode is on. Upload, change or remove it at any time — it is kept for the next maintenance.</p>
        <MaintenanceImage />
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

/**
 * IT Support: one email, one person, several roles. Ticks every role the person needs (their permissions add up);
 * the main role decides the dashboard they land on. An email already in the CRM edits that person's roles instead
 * (and sets a new password only if one is typed). Saved to Supabase at once — everyone's screen updates live.
 */
function CreateUserIt({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const blank = { name: '', email: '', phone: '', password: '', confirm: '', roles: ['sales'] as Role[], main: 'sales' as Role, show: false }
  const [f, setF] = useState(blank)
  const [tried, setTried] = useState(false)
  useEffect(() => { if (open) { setF(blank); setTried(false) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))
  const email = f.email.trim().toLowerCase()
  const existing = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? db.users.find((u) => u.active && u.email.toLowerCase() === email) : undefined
  // an existing person opens with their own roles
  useEffect(() => { if (existing) setF((x) => ({ ...x, name: existing.name, roles: rolesOf(existing), main: existing.role })) }, [existing?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (r: Role) => {
    const roles = f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r]
    set({ roles, main: roles.includes(f.main) ? f.main : roles[0] ?? f.main })
  }
  const pwNeeded = !existing || !!f.password
  const err = {
    name: !existing && f.name.trim().length < 2 ? 'Enter the name.' : '',
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Enter a valid email — it is the login ID.' : '',
    phone: !existing && !isPhone(f.phone) ? 'Enter a 10-digit mobile number.' : '',
    roles: !f.roles.length ? 'Tick at least one role.' : '',
    password: pwNeeded && !PASSWORD_RULE.test(f.password) ? PASSWORD_HINT : '',
    confirm: pwNeeded && f.password !== f.confirm ? 'The two passwords do not match.' : '',
  }
  const bad = Object.values(err).some(Boolean)
  const show = (k: keyof typeof err) => (tried && err[k]) || undefined
  const usernameFor = (e: string) => {
    const base = e.split('@')[0]!.replace(/[^a-z0-9._-]/g, '') || 'user'
    const taken = new Set(db.users.filter((u) => u.active).map((u) => u.username.toLowerCase()))
    let n = base, i = 2
    while (taken.has(n)) n = `${base}${i++}`
    return n
  }
  const save = async () => {
    setTried(true)
    if (bad) return
    const extra = f.roles.filter((r) => r !== f.main)
    const names = f.roles.map(roleLabel).join(', ')
    if (existing) {
      const ok = await run(async () => {
        updateUser(me, existing.id, { role: f.main, extraRoles: extra })
        if (f.password) await resetUserPassword(me, existing.id, f.password)
      }, `${existing.name}: ${names}`)
      if (ok) onClose()
      return
    }
    const label = roleLabel(f.main)
    const ok = await run(async () => {
      await createUser(me, { name: f.name.trim(), username: usernameFor(email), email, phone: normPhone(f.phone), role: f.main, department: label, designation: label }, f.password, undefined)
      const u = getDb().users.find((x) => x.active && x.email.toLowerCase() === email)
      if (u && extra.length) updateUser(me, u.id, { extraRoles: extra })
    }, `User created: ${f.name.trim()} · ${names} — share the password privately`)
    if (ok) onClose()
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" title={existing ? `Edit roles · ${existing.name}` : 'Create user'}
      subtitle={existing ? `${existing.email} is already in the CRM — change their roles (and password, if you type one)` : 'One email (the login ID), one or more roles. Their access is all their roles together.'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon={UserPlus} onClick={save}>{existing ? 'Save roles' : 'Create user'}</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <Input label="Email (login ID)" required type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} error={show('email')} />
        <Input label="Full name" required value={f.name} disabled={!!existing} onChange={(e) => set({ name: e.target.value })} error={show('name')} />
        {!existing && <Input label="Mobile" required inputMode="numeric" value={f.phone} onChange={(e) => set({ phone: e.target.value })} error={show('phone')} />}
        <Select label="Main role (opens their dashboard)" required value={f.main} onChange={(e) => set({ main: e.target.value as Role })} className={existing ? 'sm:col-span-2' : ''}>
          {f.roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </Select>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-xs font-semibold text-mute">Roles <span className="text-bad">*</span> <span className="font-normal">— tick every role this person needs ({f.roles.length} selected)</span></legend>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Roles">
            {ROLES.map((r) => {
              const on = f.roles.includes(r.id)
              return (
                <button key={r.id} type="button" aria-pressed={on} onClick={() => toggle(r.id)}
                  className={cx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition', on ? 'border-brand bg-brand text-white' : 'border-line text-ink hover:bg-card2')}>
                  <span className="size-2 rounded-full" style={{ background: on ? '#fff' : r.color }} />{r.label}{on && r.id === f.main && <span className="rounded bg-white/25 px-1 text-[10px]">main</span>}
                </button>
              )
            })}
          </div>
          {show('roles') && <p className="mt-1 text-xs text-bad">{err.roles}</p>}
        </fieldset>
        <Input label={existing ? 'New password (optional)' : 'Password'} required={!existing} type={f.show ? 'text' : 'password'} autoComplete="new-password" value={f.password} onChange={(e) => set({ password: e.target.value })} hint={PASSWORD_HINT} error={show('password')} />
        <Input label="Confirm password" required={pwNeeded} type={f.show ? 'text' : 'password'} autoComplete="new-password" value={f.confirm} onChange={(e) => set({ confirm: e.target.value })} error={show('confirm')} />
        <label className="flex items-center gap-2 text-xs text-mute sm:col-span-2"><input type="checkbox" checked={f.show} onChange={(e) => set({ show: e.target.checked })} className="accent-[var(--brand)]" />Show password</label>
        <p className="text-xs text-mute sm:col-span-2">Every role is saved against this one email in Supabase; the person's access is all their roles together and changes on their screen at once — no sign-out needed. The password goes only to Supabase sign-in (encrypted).</p>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
