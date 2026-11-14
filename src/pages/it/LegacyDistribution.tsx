import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Briefcase, CheckCircle2, KeyRound, Layers, Save, Search, ShieldCheck, Sparkles, UserCheck, UserCog, Users, UsersRound, Wand2 } from 'lucide-react'
import type { Role } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { roleLabel, rolesOf } from '../../lib/rbac'
import { applyFixes, assignFiles, distribution, grantOpsAndAssign, savePeopleMap, setTeamLead, type PersonRow } from '../../lib/legacyDistribute'
import { Avatar, Badge, Button, Card, CardHeader, cx, EmptyState, Select, Stat, useConfirm, useRun } from '../../components/ui'

/**
 * Old CRM sync → Role-wise distribution: every old client file, lead and history entry with its person, on the right
 * dashboard. Live (reads the CRM's data as it changes). People map (old CRM user → account here), automatic
 * placement, team leaders, and whatever is left given to someone in one go.
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
    return <Card><EmptyState icon={Layers} title="No old CRM data yet" text="Once the first copy has run, this shows which dashboard every old client file and lead lands on — person by person — and fixes what has no owner." /></Card>
  }
  const people = r.people.filter((p) => !q.trim() || `${p.user.name} ${p.user.email} ${p.roles.map(roleLabel).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))
  const salesPeople = db.users.filter((u) => u.active && rolesOf(u).some((x) => ['sales', 'teamlead', 'superadmin'].includes(x))).sort((a, b) => a.name.localeCompare(b.name))
  const opsPeople = db.users.filter((u) => u.active && rolesOf(u).includes('operations')).sort((a, b) => a.name.localeCompare(b.name))
  const pc = r.planCounts
  const planFiles = new Set(r.plan.filter((c) => c.record === 'booking').map((c) => c.id)).size
  const allGood = !r.plan.length && !r.owner.missing.length && !r.owner.inactive.length && !r.ops.missing.length && !r.opsMismatch.length

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Briefcase} tone={r.owner.missing.length + r.owner.inactive.length ? 'amber' : 'green'} label="Files on a Sales dashboard" value={`${pct(r.owner.ok, r.files)}%`} sub={`${r.owner.ok.toLocaleString('en-IN')} of ${r.files.toLocaleString('en-IN')} old files`} />
        <Stat icon={Users} tone={r.ops.ok < r.ops.inOps ? 'amber' : 'green'} label="Files in work with their person" value={`${pct(r.ops.ok, r.ops.inOps)}%`} sub={`${r.ops.ok.toLocaleString('en-IN')} of ${r.ops.inOps.toLocaleString('en-IN')} with Operations / Admin`} />
        <Stat icon={UserCheck} tone={r.leadsOpen + r.leadsInactive ? 'blue' : 'green'} label="Old leads with a person" value={`${pct(r.leadsAssigned, r.leads)}%`} sub={`${r.leadsOpen.toLocaleString('en-IN')} unassigned · ${r.leadsInactive} with someone inactive`} />
        <Stat icon={KeyRound} tone={r.noPassword.length ? 'red' : 'green'} label="People who can't sign in yet" value={r.noPassword.length} sub="have old files or leads, no password" />
      </div>

      {/* automatic step */}
      <Card>
        <CardHeader icon={Wand2} title={allGood ? 'Every old record is with its person' : 'Put every old record with its person'}
          subtitle={allGood ? 'Each file has an active sales owner and, in work, its Operations person or Admin; history is on each person’s account.' : 'From the person map below and what the old CRM recorded (closer, submitter, assigned-to). Work reassigned in the new CRM stays; later copies keep the same people.'}
          action={r.plan.length > 0 && <Button icon={Wand2} onClick={async () => {
            if (await confirm('Put everything right?', `${planFiles.toLocaleString('en-IN')} old file(s), ${pc.lead} lead(s) and ${pc.history} history entr(ies) move to their person (details below). Written to the activity log.`)) {
              await run(() => applyFixes(me), 'Old CRM data is with each person — dashboards show it now')
            }
          }}>Put everything right ({planFiles.toLocaleString('en-IN')})</Button>} />
        <ul className="divide-y divide-line/70 text-sm">
          {allGood && <li className="flex items-center gap-2 px-4 py-3 text-ok"><CheckCircle2 className="size-4" />Nothing to fix.</li>}
          {pc.owner > 0 && <Li><b>{pc.owner}</b> file(s) to their sales person (the person who closed it in the old CRM, or their account here).</Li>}
          {pc.ops > 0 && <Li><b>{pc.ops}</b> file(s) in work to their Operations person (assigned to them in the old CRM).</Li>}
          {pc.admin > 0 && <Li><b>{new Set(r.plan.filter((c) => c.kind === 'admin').map((c) => c.id)).size}</b> file(s) to the Admin who processed them in the old CRM — “With Admin”, on their Admin dashboard.</Li>}
          {pc.teamlead > 0 && <Li><b>{pc.teamlead}</b> file(s) to the owner’s team leader (the team leader they had is no longer active).</Li>}
          {pc.lead + pc.history > 0 && <Li><b>{pc.lead}</b> lead(s) and <b>{pc.history}</b> history entr(ies) (comments, approvals, stages, payments, notifications) to the person’s current account.</Li>}
          {r.opsMismatch.map((m) => (
            <li key={m.user.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <AlertTriangle className="size-4 shrink-0 text-warn" />
              <span className="min-w-0 flex-1"><b>{m.user.name}</b> had <b>{m.files.length}</b> file(s) in the old CRM but is <b>{rolesOf(m.user).map(roleLabel).join(' + ')}</b> here, without Operations or Admin — so the files are on nobody's dashboard.</span>
              <Button size="sm" variant="soft" onClick={async () => {
                if (await confirm(`Give ${m.user.name} the Operations role?`, `Operations is added as an extra role (their main role stays), and their ${m.files.length} old file(s) go to their Operations dashboard. Or pick another Operations member.`)) await run(() => grantOpsAndAssign(me, m), `${m.user.name}: Operations role added, ${m.files.length} file(s) assigned`)
              }}>Add Operations role & assign</Button>
              <AssignTo label="or give to" people={opsPeople} onPick={(id) => run(() => assignFiles(me, m.files, 'ops', id), 'Files assigned')} />
            </li>
          ))}
          <Leftover title="file(s) with no sales owner the old CRM could identify" ids={r.owner.missing} people={salesPeople} onPick={(id) => run(() => assignFiles(me, r.owner.missing, 'owner', id), 'Files given to the sales owner')} />
          <Leftover title="file(s) whose sales owner is no longer active — map the person below, or give them to someone" ids={r.owner.inactive} people={salesPeople} onPick={(id) => run(() => assignFiles(me, r.owner.inactive, 'owner', id), 'Files given to the new sales owner')} />
          <Leftover title="file(s) in work whose old assignee has no account here (deleted in the old CRM) — map the old user below, or give them to someone" ids={r.ops.missing} people={opsPeople} onPick={(id) => run(() => assignFiles(me, r.ops.missing, 'ops', id), 'Files assigned to Operations')} />
          {r.noPassword.length > 0 && (
            <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <KeyRound className="size-4 shrink-0 text-bad" />
              <span className="min-w-0 flex-1"><b>{r.noPassword.length}</b> person(s) have old files or leads but no password yet, so they can't open their dashboard: {r.noPassword.slice(0, 6).map((u) => u.name).join(', ')}{r.noPassword.length > 6 ? '…' : ''}. Their team leader and managers still see the files.</span>
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

      <PeopleMap rows={r.oldPeople} />
      <Teams gaps={r.teams} leads={r.teamLeads} />

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

const STATE: Record<PersonRow['state'], { label: string; tone: 'green' | 'amber' | 'red' | 'gray' | 'blue' }> = {
  ok: { label: 'on their dashboard', tone: 'green' }, 'no-password': { label: 'no password yet', tone: 'amber' },
  role: { label: 'no Operations / Admin role', tone: 'amber' }, inactive: { label: 'account not active', tone: 'red' }, unknown: { label: 'deleted in the old CRM', tone: 'red' },
}

/** Old CRM person → account here. Changes are saved together; their old work moves at once and later copies follow. */
function PeopleMap({ rows }: { rows: PersonRow[] }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const users = useMemo(() => db.users.filter((u) => u.active && !u.deletedAt).sort((a, b) => a.name.localeCompare(b.name)), [db.users])
  const byId = useMemo(() => new Map(db.users.map((u) => [u.id, u])), [db.users])
  const attention = rows.filter((x) => x.state === 'inactive' || x.state === 'unknown' || x.state === 'role')
  const suggestions = rows.filter((x) => x.suggestion && !x.mappedTo)
  const shown = (all ? rows : attention).filter((x) => !q.trim() || `${x.name} ${x.email} #${x.oldId} ${x.oldRole}`.toLowerCase().includes(q.trim().toLowerCase()))
  const changed = Object.entries(edits).filter(([k, v]) => (rows.find((x) => x.oldId === k)?.mappedTo ?? '') !== v)
  const save = async (entries: Record<string, string>, what: string) => {
    const lines = Object.entries(entries).map(([k, v]) => `#${k} ${rows.find((x) => x.oldId === k)?.name ?? ''} → ${v ? byId.get(v)?.name : 'their own account'}`)
    if (await confirm(what, `${lines.slice(0, 8).join('\n')}${lines.length > 8 ? `\n… and ${lines.length - 8} more` : ''}\n\nTheir old files, leads and history move to that account now, and later copies from the old CRM use it too. Saving also puts every other old record with its person (the automatic step above).`)) {
      await run(() => savePeopleMap(me, entries), 'Person map saved — old work moved to each account')
      setEdits({})
    }
  }
  return (
    <Card>
      <CardHeader icon={UserCog} title="People: old CRM → new CRM"
        subtitle={`${rows.length} people in the old CRM · ${attention.length} need attention. Pick the account that holds someone's old work (e.g. a new account, or who took over from an old user deleted in the old CRM).`}
        action={<span className="flex flex-wrap items-center gap-2">
          {suggestions.length > 0 && <Button size="sm" variant="soft" icon={Sparkles} onClick={() => save(Object.fromEntries(suggestions.map((x) => [x.oldId, x.suggestion!.userId])), `Use ${suggestions.length} suggestion(s)?`)}>Use suggestions ({suggestions.length})</Button>}
          {changed.length > 0 && <Button size="sm" icon={Save} onClick={() => save(Object.fromEntries(changed), `Save ${changed.length} change(s)?`)}>Save ({changed.length})</Button>}
        </span>} />
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <div className="flex rounded-lg border border-line p-0.5 text-xs font-semibold">
          {[[false, `Needs attention (${attention.length})`], [true, `Everyone (${rows.length})`]].map(([v, l]) => (
            <button key={String(v)} onClick={() => setAll(v as boolean)} className={cx('rounded-md px-2.5 py-1', all === v ? 'bg-brand-soft text-brand-ink' : 'text-mute hover:text-ink')}>{l as string}</button>
          ))}
        </div>
        <label className="relative ml-auto w-56 max-w-full"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-mute" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search old people…" aria-label="Search old people" className="h-8 w-full rounded-lg border border-line bg-card pl-8 pr-2 text-xs" /></label>
      </div>
      {!shown.length ? <p className="flex items-center gap-2 px-4 py-3 text-sm text-ok"><CheckCircle2 className="size-4" />{all ? 'No one matches.' : 'Everyone from the old CRM reaches an active account.'}</p> : (
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 bg-card"><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute">
              <th className="px-4 py-2 font-semibold">Old CRM person</th><th className="px-2 py-2 text-right font-semibold">Closed</th><th className="px-2 py-2 text-right font-semibold">In work</th><th className="px-2 py-2 text-right font-semibold">Leads</th>
              <th className="px-2 py-2 font-semibold">Now</th><th className="px-4 py-2 font-semibold">Their old work goes to</th>
            </tr></thead>
            <tbody className="divide-y divide-line/70">
              {shown.slice(0, 300).map((x) => {
                const v = edits[x.oldId] ?? x.mappedTo ?? ''
                const sug = x.suggestion && byId.get(x.suggestion.userId)
                return (
                  <tr key={x.oldId}>
                    <td className="px-4 py-2"><span className="block truncate font-semibold">{x.name}</span><span className="block truncate text-[11px] text-mute">#{x.oldId}{x.email ? ` · ${x.email}` : ''}{x.oldRole ? ` · ${x.oldRole}` : ''}</span></td>
                    {[x.owned, x.ops, x.leads].map((n, i) => <td key={i} className={cx('px-2 py-2 text-right tabular-nums', !n && 'text-mute')}>{n.toLocaleString('en-IN')}</td>)}
                    <td className="px-2 py-2"><Badge tone={STATE[x.state].tone}>{STATE[x.state].label}</Badge>{x.nowId && x.nowId !== x.account?.id && <span className="mt-0.5 block truncate text-[11px] text-mute">→ {byId.get(x.nowId)?.name}</span>}</td>
                    <td className="px-4 py-2">
                      <Select aria-label={`Account for ${x.name}`} value={v} onChange={(e) => setEdits({ ...edits, [x.oldId]: e.target.value })} className="!h-8 !py-0 text-xs">
                        <option value="">{x.account ? `Their own account (${x.account.name})` : '— pick a person —'}</option>
                        {users.filter((u) => u.id !== x.account?.id).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
                      </Select>
                      {sug && !x.mappedTo && v !== sug.id && <button onClick={() => setEdits({ ...edits, [x.oldId]: sug.id })} className="mt-1 block text-[11px] font-semibold text-brand hover:underline">Suggested: {sug.name} ({x.suggestion!.why})</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirmNode}
    </Card>
  )
}

/** Sales people without an active team leader: their leader sees and approves nothing of their (old) work. */
function Teams({ gaps, leads }: { gaps: { branchId: string; people: { id: string; name: string; email: string }[]; files: number }[]; leads: { id: string; name: string; branchId?: string }[] }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const total = gaps.reduce((s, g) => s + g.people.length, 0)
  const branch = (id: string) => db.settings.branches?.find((b) => b.id === id)?.name ?? (id ? id : 'No branch set')
  return (
    <Card>
      <CardHeader icon={UsersRound} title={total ? `Team leaders: ${total} sales person(s) without one` : 'Team leaders'}
        subtitle={total ? 'A team leader sees their team’s files and leads (old and new) and approves new files. The old CRM had a single Manager, so pick the team leader here — by branch, or person by person.' : 'Every sales person has an active team leader.'} />
      {total > 0 && (
        <ul className="divide-y divide-line/70 text-sm">
          {gaps.map((g) => (
            <li key={g.branchId} className="px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1"><b>{branch(g.branchId)}</b> · {g.people.length} sales person(s) · {g.files.toLocaleString('en-IN')} old file(s)</span>
                <AssignTo label="Team leader for all" people={[...leads].sort((a, b) => Number(b.branchId === g.branchId) - Number(a.branchId === g.branchId))} onPick={(id) => run(() => setTeamLead(me, g.people.map((p) => p.id), id), 'Team leader set — their team’s files show on the leader’s dashboard')} />
              </div>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-xs font-semibold text-brand">Person by person</summary>
                <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                  {g.people.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs">
                      <span className="min-w-0 truncate font-semibold">{p.name}</span>
                      <AssignTo label="" people={leads} onPick={(id) => run(() => setTeamLead(me, [p.id], id), 'Team leader set')} />
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const Li = ({ children }: { children: React.ReactNode }) => <li className="flex items-start gap-2 px-4 py-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" /><span>{children}</span></li>

function AssignTo({ label, people, onPick }: { label: string; people: { id: string; name: string }[]; onPick: (id: string) => void }) {
  const [v, setV] = useState('')
  return (
    <span className="flex items-center gap-1.5 text-xs text-mute">{label}
      <Select aria-label={label || 'Person'} value={v} onChange={(e) => setV(e.target.value)} className="!h-8 !py-0 text-xs">
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
