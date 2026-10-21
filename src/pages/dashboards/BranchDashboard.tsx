import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Building2, CalendarClock, ChevronRight, ClipboardList, ImageDown, KeyRound, Mail, MapPin, Phone, PhoneCall, Receipt, Target, Trophy,
  TrendingUp, UserCheck, UserPlus, Users, Wallet,
} from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { assignLeads, userName } from '../../lib/actions'
import { rolesOf } from '../../lib/rbac'
import { MODULES, canSee } from '../../lib/modules'
import { BOOKING_STATUS, LEAD_STATUS, OPEN_LEAD } from '../../lib/workflow'
import { dayStatus, monthStart, todaySession } from '../../lib/metrics'
import { bookingMoney, fmtDate, fmtTime, inr, inrShort, today, ymd } from '../../lib/format'
import {
  assignableLeads, branchBookings, branchCode, branchLabel, branchList, branchName, branchStaff, collectionsTrend, directorBranches,
  directorsOf, leadBranch, NO_BRANCH, progressFor, salesTeam, seesUnbranched, type Progress,
} from '../../lib/branches'
import { buildScorecard, money, pctText, SCORE_PERIODS, scorecardImage, type ScorePeriod } from '../../lib/scorecard'
import type { User } from '../../lib/types'
import { Avatar, Badge, Button, Card, Checkbox, cx, EmptyState, Input, Progress as Bar, Select, Table, Tabs, Td, Th, useRun } from '../../components/ui'
import { Bars, HBars } from '../../components/charts'
import { Greeting, LoginLogoutCard, MiniStat, Section, Tile, TileGrid } from './widgets'

const pct = (p: Progress) => (p.achievedPct === null ? '—' : `${p.achievedPct}%`)
const barTone = (v: number | null) => (v === null ? 'navy' : v >= 100 ? 'green' : v >= 60 ? 'orange' : 'red') as 'navy' | 'green' | 'orange' | 'red'
const DAY = {
  WORKING: { label: 'Working', tone: 'green' }, ON_BREAK: { label: 'On break', tone: 'amber' }, DAY_ENDED: { label: 'Day ended', tone: 'gray' },
  ON_LEAVE: { label: 'On leave', tone: 'violet' }, NOT_STARTED: { label: 'Not in yet', tone: 'red' },
} as const

/**
 * Branch dashboards. Every branch (AMD-A, AMD-Y, Vadodara …) has its own dashboard with all of that branch's data.
 * A Branch Director sees only the branch(es) they run; Super Admin / IT see every branch, plus an all-branches overview.
 * `branchId` opens one branch (/branches/:id); without it a director lands on their branch, Super Admin on the overview.
 */
export function BranchDashboard({ branchId }: { branchId?: string }) {
  const db = useDb()
  const me = useMe()
  const mine = directorBranches(db, me)
  const master = seesUnbranched(me)
  const id = branchId ?? (mine.length === 1 && !master ? mine[0] : undefined)
  const subtitle = id ? `${branchLabel(db, id)} · Branch dashboard` : `All branches · ${mine.length} branch${mine.length === 1 ? '' : 'es'}`
  const header = <Greeting subtitle={subtitle} right={<BranchTabs ids={mine} current={id} showAll={mine.length > 1 || master} />} />

  if (branchId && !mine.includes(branchId)) {
    return <div>{header}<EmptyState icon={Building2} title="This isn't your branch" text="You can open only the branch dashboards of the branches you run." /></div>
  }
  if (!mine.length) {
    return (
      <div>{header}
        <EmptyState icon={Building2} title="No branch assigned yet"
          text={master ? 'The Super Admin adds branches in Access Management → Settings.' : 'HR sets the branch you run in Employee Details → Branches they run. Your branch dashboard appears here then.'} />
      </div>
    )
  }
  return (
    <div>
      {header}
      {id ? <BranchView id={id} /> : <AllBranchesView ids={mine} unbranched={master} />}
      {me.role === 'branchdirector' && <YourPages />}
    </div>
  )
}

/** Switch between branch dashboards (only the branches this person may open). */
function BranchTabs({ ids, current, showAll }: { ids: string[]; current?: string; showAll: boolean }) {
  const db = useDb()
  if (ids.length < 2 && !showAll) return null
  const pill = (active: boolean) => cx('rounded-xl px-3.5 py-2 text-sm font-bold transition', active ? 'bg-white text-[#2E3A8C] shadow' : 'text-white/85 hover:bg-white/15')
  return (
    <nav aria-label="Branches" className="flex flex-wrap gap-1 rounded-2xl border border-white/25 bg-white/10 p-1 backdrop-blur">
      {showAll && <Link to="/dashboard/branchdirector" className={pill(!current)}>All branches</Link>}
      {ids.map((b) => <Link key={b} to={`/branches/${b}`} title={branchName(db, b)} className={pill(current === b)}>{branchCode(db, b)}</Link>)}
    </nav>
  )
}

// ------------------------------------------------------------------------------------------------ one branch
function BranchView({ id }: { id: string }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const branch = branchList(db).find((b) => b.id === id)
  const team = useMemo(() => salesTeam(db, [id], false), [db, id])
  const staff = useMemo(() => branchStaff(db, [id]), [db, id])
  const p = useMemo(() => progressFor(db, team), [db, team])
  const trend = useMemo(() => collectionsTrend(db, team), [db, team])
  const files = useMemo(() => branchBookings(db, [id]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db, id])
  const leads = useMemo(() => db.leads.filter((l) => leadBranch(db, l) === id), [db, id])
  const t = today(), month = monthStart()
  const filesMonth = files.filter((b) => (b.bookingDate ?? ymd(b.createdAt)) >= month).length
  const present = staff.filter((u) => todaySession(db, u.id)).length
  const due = leads.filter((l) => OPEN_LEAD.includes(l.status) && l.followUp && l.followUp <= t).sort((a, b) => (a.followUp ?? '').localeCompare(b.followUp ?? ''))
  const leadMix = (Object.keys(LEAD_STATUS) as (keyof typeof LEAD_STATUS)[]).map((s) => ({ label: LEAD_STATUS[s].label, value: leads.filter((l) => l.status === s).length })).filter((x) => x.value)
  const directors = directorsOf(db, id), leaders = team.filter((u) => rolesOf(u).includes('teamlead'))
  const code = branchCode(db, id)

  return (
    <>
      {/* branch details */}
      <Card className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-3 p-4 text-sm">
        <span className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-brand-soft font-extrabold text-brand-ink">{code.slice(0, 5)}</span>
          <span><b className="block">{branch?.name}</b><span className="text-xs text-mute">{[branch?.city, branch?.state].filter(Boolean).join(', ') || 'Address not set'}</span></span></span>
        {branch?.address && <span className="flex items-center gap-1.5 text-mute"><MapPin className="size-4" />{branch.address}{branch.pin ? ` – ${branch.pin}` : ''}</span>}
        {branch?.phone && <span className="flex items-center gap-1.5 text-mute"><Phone className="size-4" />{branch.phone}</span>}
        {branch?.email && <span className="flex items-center gap-1.5 text-mute"><Mail className="size-4" />{branch.email}</span>}
        {branch?.gstin && <span className="flex items-center gap-1.5 text-mute"><Receipt className="size-4" />GSTIN {branch.gstin}</span>}
        <span className="text-mute">Director: <b className="text-ink">{directors.map((u) => u.name).join(', ') || '—'}</b></span>
        <span className="text-mute">Team leaders: <b className="text-ink">{leaders.map((u) => u.name).join(', ') || '—'}</b></span>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat label="Staff · present today" value={`${staff.length} · ${present}`} icon={UserCheck} />
        <MiniStat label="Calls today" value={p.callsToday} icon={PhoneCall} tone="green" />
        <MiniStat label="Open leads · due" value={`${p.openLeads} · ${p.followUpsDue}`} icon={CalendarClock} tone="amber" />
        <MiniStat label="CRM entries this month" value={filesMonth} icon={ClipboardList} tone="violet" />
        <MiniStat label="Collected this month" value={inrShort(p.collectedMonth)} icon={Wallet} tone="blue" />
        <MiniStat label="Outstanding" value={inrShort(p.outstanding)} icon={TrendingUp} tone="orange" />
        <MiniStat label="Monthly target" value={p.target ? inrShort(p.target) : '—'} icon={Target} />
        <MiniStat label="Target achieved" value={pct(p)} icon={Trophy} tone={p.achievedPct !== null && p.achievedPct >= 100 ? 'green' : 'orange'} />
      </div>

      <ScorecardSection team={team} scopeName={code} />
      <PeopleSection team={team} subtitle={`${code} · this month`} />

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <Section title="CRM entries" subtitle={`${files.length} client file${files.length === 1 ? '' : 's'} booked by ${code} · newest first`} icon={ClipboardList}
          action={can('bookings.all', 'bookings.team') ? <Link to="/bookings" className="text-xs font-bold text-brand-ink hover:underline">All CRM entries →</Link> : undefined}>
          {!files.length ? <EmptyState icon={ClipboardList} title="No CRM entries yet" text="Client files booked by this branch's sales people appear here." /> : (
            <Table>
              <thead><tr><Th>CRM ID</Th><Th>Company</Th><Th>Sales person</Th><Th className="text-right">Paid (with GST)</Th><Th>Status</Th></tr></thead>
              <tbody>
                {files.slice(0, 8).map((b) => (
                  <tr key={b.id} className="hover:bg-card2/60">
                    <Td><Link to={`/bookings/${b.id}`} className="font-mono text-xs font-bold text-brand-ink hover:underline">{b.bookingId}</Link></Td>
                    <Td><span className="block font-semibold">{b.companyName}</span><span className="text-[11px] text-mute">{fmtDate(b.bookingDate ?? b.createdAt)}</span></Td>
                    <Td className="text-xs">{userName(db, b.createdBy)}</Td>
                    <Td className="text-right font-semibold tabular-nums">{inr(bookingMoney(b).collected)}</Td>
                    <Td><Badge tone={BOOKING_STATUS[b.status].tone}>{BOOKING_STATUS[b.status].label}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
        <div className="space-y-6">
          <Section title="Collections · last 6 months" subtitle={code} icon={TrendingUp}><div className="p-5"><Bars data={trend} format={inrShort} highlightLast height={160} /></div></Section>
          <Section title="Leads by status" subtitle={`${leads.length} lead${leads.length === 1 ? '' : 's'} with ${code}`} icon={Users}>
            <div className="p-5">{leadMix.length ? <HBars data={leadMix} /> : <p className="text-sm text-mute">No leads with this branch yet.</p>}</div>
          </Section>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <Section title="Attendance today" subtitle={`${present} of ${staff.length} signed in`} icon={UserCheck}>
          {!staff.length ? <EmptyState icon={UserCheck} title="Nobody in this branch yet" text="HR sets each person's branch in Employee Details." /> : (
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              {staff.slice().sort((a, b) => a.name.localeCompare(b.name)).map((u) => {
                const st = DAY[dayStatus(db, u.id)], s = todaySession(db, u.id)
                return (
                  <div key={u.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                    <Avatar name={u.name} photo={u.photo} size={30} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{u.name}</span><span className="block truncate text-[11px] text-mute">{u.designation || u.role}{s ? ` · in ${fmtTime(s.loginAt)}` : ''}</span></span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                )
              })}
            </div>
          )}
        </Section>
        <div className="space-y-6">
          {me.role === 'branchdirector' && <LoginLogoutCard />}
          <Section title="Follow-ups due" subtitle={`${due.length} lead${due.length === 1 ? '' : 's'} due today or overdue`} icon={CalendarClock}>
            {!due.length ? <p className="p-5 text-sm text-mute">Nothing due — well done.</p> : (
              <ul className="divide-y divide-line">
                {due.slice(0, 8).map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{l.name}</span><span className="block truncate text-[11px] text-mute">{userName(db, l.assignedTo)} · {l.company || l.phone}</span></span>
                    <span className={cx('text-xs font-bold', (l.followUp ?? '') < t ? 'text-bad' : 'text-warn')}>{(l.followUp ?? '') < t ? fmtDate(l.followUp) : 'Today'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {can('leads.assign', 'leads.manage') && <AssignClients team={team} />}
    </>
  )
}

// ------------------------------------------------------------------------------------------------ every branch
function AllBranchesView({ ids, unbranched }: { ids: string[]; unbranched: boolean }) {
  const db = useDb()
  const navigate = useNavigate()
  const { can } = useAuth()
  const team = useMemo(() => salesTeam(db, ids, unbranched), [db, ids, unbranched])
  const total = useMemo(() => progressFor(db, team), [db, team])
  const trend = useMemo(() => collectionsTrend(db, team), [db, team])
  const rows = useMemo(() => {
    const list = ids.map((id) => ({ id, people: salesTeam(db, [id], false) }))
    if (unbranched) { const none = salesTeam(db, [], true); if (none.length) list.push({ id: NO_BRANCH, people: none }) }
    return list.map((r) => ({ ...r, p: progressFor(db, r.people) }))
  }, [db, ids, unbranched])

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MiniStat label="Sales team" value={team.length} icon={Users} />
        <MiniStat label="Calls today" value={total.callsToday} icon={PhoneCall} tone="green" />
        <MiniStat label="Open leads · due" value={`${total.openLeads} · ${total.followUpsDue}`} icon={CalendarClock} tone="amber" />
        <MiniStat label="CRM entries this month" value={total.bookingsMonth} icon={ClipboardList} tone="violet" />
        <MiniStat label="Collected this month" value={inrShort(total.collectedMonth)} icon={Wallet} tone="blue" />
        <MiniStat label="Target achieved" value={pct(total)} icon={Target} tone={total.achievedPct !== null && total.achievedPct >= 100 ? 'green' : 'orange'} />
      </div>

      <BranchCards ids={ids} className="mb-6" />

      <Section title="Branch-wise comparison" subtitle="This month · money includes GST · click a branch to open its dashboard" icon={Building2}>
        <Table>
          <thead><tr><Th>Branch</Th><Th className="text-right">Team</Th><Th className="text-right">Calls today</Th><Th className="text-right">Open leads</Th><Th className="text-right">CRM entries</Th><Th className="text-right">Collected</Th><Th className="text-right">Target</Th><Th className="w-44">Achieved</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => r.id !== NO_BRANCH && navigate(`/branches/${r.id}`)} className={cx('hover:bg-card2/60', r.id !== NO_BRANCH && 'cursor-pointer')}>
                <Td className="font-semibold">{r.id === NO_BRANCH ? 'No branch set' : branchLabel(db, r.id)}{r.id === NO_BRANCH && <span className="block text-[11px] font-normal text-warn">Set their branch in Employee Details</span>}</Td>
                <Td className="text-right">{r.people.length}<span className="block text-[11px] text-mute">{r.people.filter((u) => rolesOf(u).includes('teamlead')).length} TL</span></Td>
                <Td className="text-right tabular-nums">{r.p.callsToday}</Td>
                <Td className="text-right tabular-nums">{r.p.openLeads}{r.p.followUpsDue > 0 && <span className="block text-[11px] text-warn">{r.p.followUpsDue} due</span>}</Td>
                <Td className="text-right tabular-nums">{r.p.bookingsMonth}</Td>
                <Td className="text-right font-bold tabular-nums">{inr(r.p.collectedMonth)}</Td>
                <Td className="text-right tabular-nums text-mute">{r.p.target ? inr(r.p.target) : '—'}</Td>
                <Td><div className="flex items-center gap-2"><Bar value={Math.min(100, r.p.achievedPct ?? 0)} tone={barTone(r.p.achievedPct)} className="flex-1" /><span className="w-10 text-right text-xs font-bold">{pct(r.p)}</span></div></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <ScorecardSection team={team} scopeName={ids.length === 1 && !unbranched ? branchCode(db, ids[0]) : 'All branches'} />

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_340px]">
        <PeopleSection team={team} subtitle="Every branch · this month" showBranch className="mt-0" />
        <Section title="Collections · last 6 months" subtitle="Every branch" icon={TrendingUp} className="self-start"><div className="p-5"><Bars data={trend} format={inrShort} highlightLast height={170} /></div></Section>
      </div>

      {can('leads.assign', 'leads.manage') && <AssignClients team={team} />}
    </>
  )
}

/** One card per branch with its headline numbers — opens that branch's dashboard (also used on the Super Admin dashboard). */
export function BranchCards({ ids, className }: { ids?: string[]; className?: string }) {
  const db = useDb()
  const me = useMe()
  const list = ids ?? directorBranches(db, me)
  const month = monthStart()
  if (!list.length) return null
  return (
    <div className={cx('grid gap-4 sm:grid-cols-2 xl:grid-cols-3', className)}>
      {list.map((id) => {
        const team = salesTeam(db, [id], false), staff = branchStaff(db, [id]), p = progressFor(db, team)
        const present = staff.filter((u) => todaySession(db, u.id)).length
        const files = branchBookings(db, [id]).filter((b) => (b.bookingDate ?? ymd(b.createdAt)) >= month).length
        return (
          <Link key={id} to={`/branches/${id}`} className="group rounded-2xl border border-line bg-card p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop">
            <div className="flex items-center gap-3">
              <span className="grid h-11 min-w-11 place-items-center rounded-xl bg-brand-soft px-2 text-sm font-extrabold text-brand-ink">{branchCode(db, id)}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-bold">{branchName(db, id)}</span><span className="text-xs text-mute">{staff.length} staff · {present} in today · {team.length} in sales</span></span>
              <ChevronRight className="size-5 text-mute transition group-hover:translate-x-0.5 group-hover:text-ink" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <span><b className="block tabular-nums">{inrShort(p.collectedMonth)}</b><span className="text-[11px] text-mute">Collected</span></span>
              <span><b className="block tabular-nums">{files}</b><span className="text-[11px] text-mute">CRM entries</span></span>
              <span><b className="block tabular-nums">{p.openLeads}</b><span className="text-[11px] text-mute">Open leads</span></span>
            </div>
            <div className="mt-3 flex items-center gap-2"><Bar value={Math.min(100, p.achievedPct ?? 0)} tone={barTone(p.achievedPct)} className="flex-1" /><span className="text-xs font-bold">{pct(p)}</span></div>
          </Link>
        )
      })}
    </div>
  )
}

/** Every sales person's month: calls, open leads, CRM entries, collections and target. */
function PeopleSection({ team, subtitle, showBranch, className = 'mt-6' }: { team: User[]; subtitle: string; showBranch?: boolean; className?: string }) {
  const db = useDb()
  const people = useMemo(() => team.map((u) => ({ u, p: progressFor(db, [u]) })).sort((a, b) => b.p.collectedMonth - a.p.collectedMonth || b.p.callsMonth - a.p.callsMonth), [db, team])
  return (
    <Section title="Sales people progress" subtitle={subtitle} icon={Users} className={className}>
      {!people.length ? <EmptyState icon={Users} title="No sales people here" text="Team leaders and sales people with this branch appear here (HR sets the branch in Employee Details)." /> : (
        <Table>
          <thead><tr><Th>Person</Th>{showBranch && <Th>Branch</Th>}<Th className="text-right">Calls<span className="block font-normal normal-case">today / month</span></Th><Th className="text-right">Open leads</Th><Th className="text-right">CRM entries</Th><Th className="text-right">Collected</Th><Th className="w-40">Target</Th></tr></thead>
          <tbody>
            {people.map(({ u, p }) => (
              <tr key={u.id} className="hover:bg-card2/60">
                <Td><span className="flex items-center gap-2.5"><Avatar name={u.name} photo={u.photo} size={30} /><span className="min-w-0"><span className="block truncate font-semibold">{u.name}</span>
                  <span className="block truncate text-[11px] text-mute">{rolesOf(u).includes('teamlead') ? 'Team Leader' : `Sales${u.teamLeadId ? ` · ${userName(db, u.teamLeadId)}` : ''}`}</span></span></span></Td>
                {showBranch && <Td className="text-xs">{u.branchId ? branchCode(db, u.branchId) : 'No branch set'}</Td>}
                <Td className="text-right tabular-nums"><b>{p.callsToday}</b><span className="text-mute"> / {p.callsMonth}</span></Td>
                <Td className="text-right tabular-nums">{p.openLeads}{p.followUpsDue > 0 && <span className="block text-[11px] text-warn">{p.followUpsDue} due</span>}</Td>
                <Td className="text-right tabular-nums">{p.bookingsMonth}</Td>
                <Td className="text-right font-bold tabular-nums">{inr(p.collectedMonth)}</Td>
                <Td>{p.target ? <div><div className="mb-0.5 flex justify-between text-[11px]"><span className="text-mute">{inrShort(p.target)}</span><b>{pct(p)}</b></div><Bar value={Math.min(100, p.achievedPct ?? 0)} tone={barTone(p.achievedPct)} /></div> : <span className="text-xs text-mute">No target</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  )
}

/** Shortcuts to the pages the Super Admin has given this Branch Director. */
function YourPages() {
  const { can } = useAuth()
  const pages = MODULES.filter((m) => !m.hrOnly && canSee(m, can) && !['security', 'notifications', 'inbox', 'users', 'system'].includes(m.key)).slice(0, 9)
  return (
    <Section title="Your pages" subtitle="What the Super Admin has given you access to" icon={KeyRound} className="mt-6">
      <div className="p-5"><TileGrid>{pages.map((m) => <Tile key={m.key} to={m.path} icon={m.icon} label={m.label} desc={m.desc} tone={m.tone} />)}</TileGrid></div>
    </Section>
  )
}

/** Scorecard like the monthly "BRD SCORECARD" sheet, for a day / week / month / year, downloadable as an image. */
function ScorecardSection({ team, scopeName }: { team: ReturnType<typeof salesTeam>; scopeName: string }) {
  const db = useDb()
  const run = useRun()
  const [period, setPeriod] = useState<ScorePeriod>('month')
  const [on, setOn] = useState(today())
  const card = useMemo(() => buildScorecard(db, team, period, on || today(), scopeName), [db, team, period, on, scopeName])
  const multi = card.branches.length > 1
  const tone = (p: number | null) => (p === null ? 'text-mute' : p >= 100 ? 'text-ok' : p >= 60 ? 'text-warn' : 'text-bad')
  const cell = 'border border-line/80 px-3 py-1.5'
  return (
    <Section title="Scorecard" subtitle={`${fmtDate(card.from)} – ${fmtDate(card.to)} · collections till ${fmtDate(card.tillDate)} · with GST · ranked by collection`} icon={Trophy} className="mt-6"
      action={<Button size="sm" icon={ImageDown} disabled={!card.rows.length} onClick={() => run(() => scorecardImage(card, db.settings.companyName || 'Rexera'), 'Scorecard image downloaded')}>Download image</Button>}>
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
        <Tabs value={period} onChange={(v) => setPeriod(v as ScorePeriod)} tabs={SCORE_PERIODS} />
        <Input label={period === 'day' ? 'Day' : period === 'week' ? 'Any day in the week' : period === 'month' ? 'Any day in the month' : 'Any day in the year'} type="date" value={on} max={today()} onChange={(e) => setOn(e.target.value)} />
        <span className="ml-auto text-xs text-mute">Targets are monthly; a day or week is its share of the month, a year is 12 months.</span>
      </div>
      {!card.rows.length ? <EmptyState icon={Trophy} title="No sales people here" text="Team leaders and sales people with this branch appear here." /> : (
        <div className="overflow-x-auto p-4">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <caption className="border border-b-0 border-line/80 bg-card py-2 font-serif text-xl font-extrabold tracking-wide">{card.title}</caption>
            <thead className="bg-sky-100 text-[11px] font-extrabold uppercase text-ink dark:bg-sky-500/15">
              <tr>
                <th className={cell}>Rank</th><th className={cell}>Employee names</th>{multi && <th className={cell}>Branch</th>}
                <th className={cell}>Target<span className="block">{card.label}</span></th><th className={cell}>Collection<span className="block">ach. till date</span></th>
                <th className={cell}>Pending</th><th className={cell}>Ach. percentage</th>
              </tr>
            </thead>
            <tbody className="bg-orange-100/80 font-semibold dark:bg-orange-500/10">
              {card.rows.map((r) => (
                <tr key={r.user.id}>
                  <td className={cx(cell, 'text-center tabular-nums')}>{r.rank}</td>
                  <td className={cx(cell, 'uppercase')}>{r.user.name}{rolesOf(r.user).includes('teamlead') && <span className="ml-1.5 text-[10px] font-bold normal-case text-mute">TL</span>}</td>
                  {multi && <td className={cx(cell, 'text-xs')}>{r.branch}</td>}
                  <td className={cx(cell, 'text-right tabular-nums')}>{money(r.target)}</td>
                  <td className={cx(cell, 'text-right tabular-nums')}>{money(r.collected)}</td>
                  <td className={cx(cell, 'text-right tabular-nums', r.pending < 0 && 'text-ok')}>{money(r.pending)}</td>
                  <td className={cx(cell, 'text-right font-bold tabular-nums', tone(r.pct))}>{pctText(r.pct)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-card font-extrabold">
              <tr>
                <td className={cx(cell, 'text-center')} colSpan={multi ? 3 : 2}>GRAND TOTAL</td>
                <td className={cx(cell, 'text-right tabular-nums')}>{money(card.total.target)}</td>
                <td className={cx(cell, 'text-right tabular-nums')}>{money(card.total.collected)}</td>
                <td className={cx(cell, 'text-right tabular-nums', card.total.pending < 0 && 'text-ok')}>{money(card.total.pending)}</td>
                <td className={cx(cell, 'text-right tabular-nums', tone(card.total.pct))}>{pctText(card.total.pct)}</td>
              </tr>
            </tfoot>
          </table>
          {multi && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {card.branches.map((b) => (
                <div key={b.name} className="rounded-xl border border-line p-3">
                  <p className="flex items-center justify-between text-sm font-bold"><span className="truncate">{b.name}</span><span className={tone(b.total.pct)}>{pctText(b.total.pct)}</span></p>
                  <p className="mt-0.5 text-[11px] text-mute">{b.people} people · {money(b.total.collected)} of {money(b.total.target)}</p>
                  <Bar value={Math.min(100, b.total.pct ?? 0)} tone={barTone(b.total.pct)} className="mt-2" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

/** Hand clients (leads) straight to a team leader in the branch; the team leader passes them on to their sales people. */
function AssignClients({ team }: { team: ReturnType<typeof salesTeam> }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  // where a lead came from is shown to the Super Admin only
  const showSource = useAuth().can('leads.admin')
  const [mode, setMode] = useState<'unassigned' | 'team'>('unassigned')
  const [picked, setPicked] = useState<string[]>([])
  const [to, setTo] = useState('')
  const leaders = useMemo(() => team.filter((u) => rolesOf(u).includes('teamlead')).sort((a, b) => a.name.localeCompare(b.name)), [team])
  const leads = useMemo(() => assignableLeads(db, team, mode).slice(0, 50), [db, team, mode])
  const all = leads.length > 0 && leads.every((l) => picked.includes(l.id))
  const assign = async () => {
    const target = leaders.find((u) => u.id === to)
    if (await run(() => assignLeads(me, picked, to), `${picked.length} client(s) assigned to ${target?.name}`)) setPicked([])
  }
  const teamSize = (id: string) => team.filter((u) => u.teamLeadId === id).length
  return (
    <Section title="Assign clients to team leaders" subtitle="Give leads directly to a team leader — they are notified at once and pass them on to their sales people" icon={UserPlus} className="mt-6"
      action={<span className="flex gap-1 rounded-xl bg-card2 p-1 text-xs font-semibold">
        {([['unassigned', 'Not assigned'], ['team', 'With my team (re-assign)']] as const).map(([k, l]) => <button key={k} onClick={() => { setMode(k); setPicked([]) }} className={cx('rounded-lg px-3 py-1.5', mode === k ? 'bg-card shadow-sm' : 'text-mute hover:text-ink')}>{l}</button>)}
      </span>}>
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
        <Select label="Team leader" value={to} onChange={(e) => setTo(e.target.value)} className="min-w-64 flex-1">
          <option value="">— Choose a team leader —</option>
          {leaders.map((u) => <option key={u.id} value={u.id}>{u.name} · {teamSize(u.id)} sales people{u.branchId ? ` · ${branchName(db, u.branchId)}` : ''}</option>)}
        </Select>
        <Button icon={UserPlus} disabled={!to || !picked.length} onClick={assign}>Assign {picked.length || ''} client{picked.length === 1 ? '' : 's'}</Button>
        {!leaders.length && <p className="w-full text-xs text-warn">No team leader in this branch yet — HR sets the branch in Employee Details.</p>}
      </div>
      {!leads.length ? <EmptyState icon={UserPlus} title={mode === 'unassigned' ? 'Every lead is assigned' : 'No open leads with your team'} /> : (
        <Table>
          <thead><tr><Th className="w-10"><Checkbox checked={all} onChange={(v) => setPicked(v ? leads.map((l) => l.id) : [])} /></Th><Th>Client</Th><Th>Service</Th>{showSource && <Th>Source</Th>}<Th>Status</Th><Th>{mode === 'team' ? 'With' : 'Added'}</Th></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className={cx('hover:bg-card2/60', picked.includes(l.id) && 'bg-brand-soft/50')}>
                <Td><Checkbox checked={picked.includes(l.id)} onChange={(v) => setPicked((p) => (v ? [...p, l.id] : p.filter((x) => x !== l.id)))} /></Td>
                <Td><span className="block font-semibold">{l.name}</span><span className="text-[11px] text-mute">{l.company || l.city || l.phone}</span></Td>
                <Td className="text-xs">{l.service || '—'}</Td>
                {showSource && <Td className="text-xs">{l.source}</Td>}
                <Td><Badge tone={LEAD_STATUS[l.status].tone}>{LEAD_STATUS[l.status].label}</Badge></Td>
                <Td className="text-xs">{mode === 'team' ? userName(db, l.assignedTo) : fmtDate(l.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  )
}
