import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Briefcase, CheckCircle2, KeyRound, Layers, Search, ShieldCheck, UserCheck, Users, Wand2 } from 'lucide-react'
import type { Role } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { roleLabel, rolesOf } from '../../lib/rbac'
import { applyFixes, assignFiles, distribution, grantOpsAndAssign } from '../../lib/legacyDistribute'
import { Avatar, Badge, Button, Card, CardHeader, cx, EmptyState, Select, Stat, useConfirm, useRun } from '../../components/ui'

/**
 * Old CRM sync → Role-wise distribution: every old client file and lead on the right dashboard. Live (reads the
 * CRM's data as it changes). Automatic fixes from what the old CRM recorded; the rest given to someone in one go.
 */
export function LegacyDistribution() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const r = useMemo(() => distribution(db), [db])
  const [q, setQ] = useState('')
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100)

  if (!r.files && !r.leads) {
    return <Card><EmptyState icon={Layers} title="No old CRM data yet" text="Once the first copy has run, this shows which dashboard every old client file and lead lands on — role by role — and fixes what has no owner." /></Card>
  }
  const people = r.people.filter((p) => !q.trim() || `${p.user.name} ${p.user.email} ${p.roles.map(roleLabel).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))
  const salesPeople = db.users.filter((u) => u.active && rolesOf(u).some((x) => ['sales', 'teamlead', 'superadmin'].includes(x))).sort((a, b) => a.name.localeCompare(b.name))
  const opsPeople = db.users.filter((u) => u.active && rolesOf(u).includes('operations')).sort((a, b) => a.name.localeCompare(b.name))
  const fixOwners = r.fixes.filter((f) => f.kind === 'owner').length, fixOps = r.fixes.filter((f) => f.kind === 'ops').length
  const allGood = !r.fixes.length && !r.owner.missing.length && !r.owner.inactive.length && !r.ops.missing.length && !r.ops.inactive.length && !r.opsMismatch.length

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Briefcase} tone={r.owner.missing.length + r.owner.inactive.length ? 'amber' : 'green'} label="Files on a Sales dashboard" value={`${pct(r.owner.ok, r.files)}%`} sub={`${r.owner.ok.toLocaleString('en-IN')} of ${r.files.toLocaleString('en-IN')} old files`} />
        <Stat icon={Users} tone={r.ops.missing.length + r.ops.inactive.length + r.opsMismatch.length ? 'amber' : 'green'} label="Operations files with their person" value={`${pct(r.ops.ok, r.ops.inOps)}%`} sub={`${r.ops.ok.toLocaleString('en-IN')} of ${r.ops.inOps.toLocaleString('en-IN')} with Operations`} />
        <Stat icon={UserCheck} tone={r.leadsOpen + r.leadsInactive ? 'blue' : 'green'} label="Old leads with a person" value={`${pct(r.leadsAssigned, r.leads)}%`} sub={`${r.leadsOpen.toLocaleString('en-IN')} unassigned · ${r.leadsInactive} with someone inactive`} />
        <Stat icon={KeyRound} tone={r.noPassword.length ? 'red' : 'green'} label="People who can't sign in yet" value={r.noPassword.length} sub="old users with files or leads, no password" />
      </div>

      {/* automatic fixes */}
      <Card>
        <CardHeader icon={Wand2} title={allGood ? 'Every old file is on the right dashboard' : 'Fix the distribution'}
          subtitle={allGood ? 'Each file has an active sales owner, and each file with Operations has its Operations person.' : 'Fixed from what the old CRM recorded (closing person, submitter, name, assigned-to). Later copies keep these changes.'}
          action={r.fixes.length > 0 && <Button icon={Wand2} onClick={async () => {
            if (await confirm('Fix automatically?', `${fixOwners} file(s) go to their sales person and ${fixOps} to their Operations person, as recorded in the old CRM. Written to the activity log.`)) {
              await run(() => applyFixes(me, r.fixes), 'Old CRM files distributed — they now show on the right dashboards')
            }
          }}>Fix automatically ({r.fixes.length})</Button>} />
        <ul className="divide-y divide-line/70 text-sm">
          {allGood && <li className="flex items-center gap-2 px-4 py-3 text-ok"><CheckCircle2 className="size-4" />Nothing to fix.</li>}
          {fixOwners > 0 && <li className="px-4 py-2.5"><b>{fixOwners}</b> file(s) without an active sales owner — the old CRM names their sales person.</li>}
          {fixOps > 0 && <li className="px-4 py-2.5"><b>{fixOps}</b> file(s) with Operations but no Operations person — the old CRM names who had them.</li>}
          {r.opsMismatch.map((m) => (
            <li key={m.user.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <AlertTriangle className="size-4 shrink-0 text-warn" />
              <span className="min-w-0 flex-1"><b>{m.user.name}</b> had <b>{m.files.length}</b> file(s) in the old CRM but is <b>{rolesOf(m.user).map(roleLabel).join(' + ')}</b> here, without Operations — so the files are on nobody's Operations dashboard.</span>
              <Button size="sm" variant="soft" onClick={async () => {
                if (await confirm(`Give ${m.user.name} the Operations role?`, `Operations is added as an extra role (their main role stays), and their ${m.files.length} old file(s) go to their Operations dashboard. Or pick another Operations member below.`)) await run(() => grantOpsAndAssign(me, m), `${m.user.name}: Operations role added, ${m.files.length} file(s) assigned`)
              }}>Add Operations role & assign</Button>
              <AssignTo label="or give to" people={opsPeople} onPick={(id) => run(() => assignFiles(me, m.files, 'ops', id), 'Files assigned')} />
            </li>
          ))}
          <Leftover title="file(s) with no sales owner the old CRM could identify" ids={r.owner.missing} people={salesPeople} onPick={(id) => run(() => assignFiles(me, r.owner.missing, 'owner', id), 'Files given to the sales owner')} />
          <Leftover title="file(s) whose sales owner is no longer active" ids={r.owner.inactive} people={salesPeople} onPick={(id) => run(() => assignFiles(me, r.owner.inactive, 'owner', id), 'Files given to the new sales owner')} />
          <Leftover title="file(s) with Operations but no Operations person" ids={r.ops.missing} people={opsPeople} onPick={(id) => run(() => assignFiles(me, r.ops.missing, 'ops', id), 'Files assigned to Operations')} />
          <Leftover title="file(s) whose Operations person is no longer active" ids={r.ops.inactive} people={opsPeople} onPick={(id) => run(() => assignFiles(me, r.ops.inactive, 'ops', id), 'Files assigned to Operations')} />
          {r.noPassword.length > 0 && (
            <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <KeyRound className="size-4 shrink-0 text-bad" />
              <span className="min-w-0 flex-1"><b>{r.noPassword.length}</b> old user(s) have files or leads but no password yet, so they can't open their dashboard: {r.noPassword.slice(0, 6).map((u) => u.name).join(', ')}{r.noPassword.length > 6 ? '…' : ''}.</span>
              <Link to="/dashboard/it"><Button size="sm" variant="outline" icon={ArrowRight}>Set passwords</Button></Link>
            </li>
          )}
          {r.leadsOpen > 0 && (
            <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <UserCheck className="size-4 shrink-0 text-info" />
              <span className="min-w-0 flex-1"><b>{r.leadsOpen.toLocaleString('en-IN')}</b> old lead(s) were unassigned in the old CRM too — they wait in the lead pool for a manager to distribute.</span>
              <Link to="/leads"><Button size="sm" variant="outline" icon={ArrowRight}>Open leads</Button></Link>
            </li>
          )}
        </ul>
      </Card>

      {/* queues by role */}
      <Card>
        <CardHeader icon={Layers} title="Where the old files are" subtitle="Each role sees its queue on its dashboard" />
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {r.queues.map((x) => (
            <div key={x.label} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-sm">
              <span className="min-w-0"><span className="block truncate font-semibold">{x.label}</span><span className="text-[11px] text-mute">{roleLabel(x.role as Role)} dashboard</span></span>
              <span className="text-lg font-extrabold tabular-nums">{x.count.toLocaleString('en-IN')}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-sm">
            <span className="min-w-0"><span className="block truncate font-semibold">With an Admin member</span><span className="text-[11px] text-mute">Admin dashboard</span></span>
            <span className="text-lg font-extrabold tabular-nums">{r.admin.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </Card>

      {/* who sees what */}
      <Card>
        <CardHeader icon={ShieldCheck} title="Who sees what" subtitle="Old client files and leads on each person's dashboard"
          action={<label className="relative w-56 max-w-full"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-mute" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people, roles…" aria-label="Search people" className="h-8 w-full rounded-lg border border-line bg-card pl-8 pr-2 text-xs" /></label>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute">
              <th className="px-4 py-2 font-semibold">Person</th><th className="px-2 py-2 font-semibold">Roles</th>
              <th className="px-2 py-2 text-right font-semibold">Sales files</th><th className="px-2 py-2 text-right font-semibold">Operations</th>
              <th className="px-2 py-2 text-right font-semibold">Admin</th><th className="px-4 py-2 text-right font-semibold">Leads</th>
            </tr></thead>
            <tbody className="divide-y divide-line/70">
              {people.slice(0, 200).map((p) => (
                <tr key={p.user.id}>
                  <td className="px-4 py-2"><span className="flex items-center gap-2"><Avatar name={p.user.name} photo={p.user.photo} size={26} /><span className="min-w-0"><span className="block truncate font-semibold">{p.user.name}</span><span className="block truncate text-[11px] text-mute">{p.user.email}</span></span>{p.user.needsPasswordReset && <Badge tone="red">no password</Badge>}</span></td>
                  <td className="px-2 py-2"><span className="flex flex-wrap gap-1">{p.roles.map((x) => <Badge key={x} tone="gray">{roleLabel(x)}</Badge>)}</span></td>
                  {[p.owned, p.ops, p.admin].map((n, i) => <td key={i} className={cx('px-2 py-2 text-right tabular-nums', !n && 'text-mute')}>{n.toLocaleString('en-IN')}</td>)}
                  <td className={cx('px-4 py-2 text-right tabular-nums', !p.leads && 'text-mute')}>{p.leads.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {confirmNode}
    </div>
  )
}

function AssignTo({ label, people, onPick }: { label: string; people: { id: string; name: string }[]; onPick: (id: string) => void }) {
  const [v, setV] = useState('')
  return (
    <span className="flex items-center gap-1.5 text-xs text-mute">{label}
      <Select aria-label={label} value={v} onChange={(e) => setV(e.target.value)} className="!h-8 !py-0 text-xs">
        <option value="">— person —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <Button size="sm" variant="outline" disabled={!v} onClick={() => { onPick(v); setV('') }}>Assign</Button>
    </span>
  )
}
function Leftover({ title, ids, people, onPick }: { title: string; ids: string[]; people: { id: string; name: string }[]; onPick: (id: string) => void }) {
  if (!ids.length) return null
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <AlertTriangle className="size-4 shrink-0 text-warn" />
      <span className="min-w-0 flex-1"><b>{ids.length.toLocaleString('en-IN')}</b> {title}.</span>
      <AssignTo label="Give all to" people={people} onPick={onPick} />
    </li>
  )
}
