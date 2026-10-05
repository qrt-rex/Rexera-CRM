import { useMemo } from 'react'
import {
  AlertTriangle, BadgeCheck, BarChart3, Briefcase, CalendarCheck2, CheckCircle2, ClipboardCheck, FileSearch, FileText, IndianRupee,
  PauseCircle, Scale, UserCheck, UserCog, Wallet, BookOpenCheck,
} from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { usersWithRole } from '../../lib/actions'
import { collections, monthStart, pipelineTotals, revenueByMonth, waitingFor } from '../../lib/metrics'
import { inr, inrShort, today } from '../../lib/format'
import { EmptyState } from '../../components/ui'
import { Bars, HBars } from '../../components/charts'
import { BookingRow } from '../../components/booking'
import { Greeting, LoginLogoutCard, MiniStat, Section, Tile, TileGrid, UpcomingEvents, ViewAll } from './widgets'

export function AccountsDashboard() {
  const db = useDb()
  const me = useMe()
  const waiting = waitingFor(db, me)
  const pending = db.bookings.filter((b) => b.status === 'PENDING_ACCOUNTS').length
  const hold = db.bookings.filter((b) => b.status === 'ACCOUNTS_HOLD').length
  const unverified = db.bookings.reduce((n, b) => n + b.payments.filter((p) => !p.verified).length, 0)
  const salesIds = db.users.map((u) => u.id)
  const month = collections(db, salesIds, monthStart())
  const totals = pipelineTotals(db)
  const rev = revenueByMonth(db)

  return (
    <div>
      <Greeting subtitle="Accounts · verify payments and decide client files" />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Files to approve" value={pending} icon={ClipboardCheck} tone="amber" />
        <MiniStat label="On hold" value={hold} icon={PauseCircle} tone="orange" />
        <MiniStat label="Payments to verify" value={unverified} icon={Wallet} tone="red" />
        <MiniStat label="Collected this month" value={inrShort(month)} icon={IndianRupee} tone="green" />
      </div>
      <TileGrid>
        <Tile to="/bookings" icon={Briefcase} label="CRM Entries" desc="View and edit every entry, payments & deductions" tone="violet" />
        <Tile to="/approvals" icon={BadgeCheck} label="Client files" desc="Approve, reject or put on hold" tone="amber" badge={waiting.length} highlight={waiting.length > 0} />
        <Tile to="/billing" icon={IndianRupee} label="Invoice / Bill" desc="GST invoices & receivables" tone="green" />
        <Tile to="/reports" icon={BarChart3} label="Reports" desc="Collections, outstanding, exports" tone="navy" />
        <Tile to="/leave?new=1" icon={CalendarCheck2} label="Request my leave" tone="violet" />
        <Tile to="/attendance" icon={UserCheck} label="Attendance Board" tone="green" />
      </TileGrid>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section title="Client files waiting for you" subtitle="Approve sends the file to Legal" icon={ClipboardCheck} className="xl:col-span-2" action={<ViewAll to="/approvals" />}>
          {waiting.length ? waiting.slice(0, 6).map((b) => <BookingRow key={b.id} b={b} />) : <EmptyState icon={CheckCircle2} title="All clear" text="No files are waiting for accounts." />}
        </Section>
        <div className="space-y-6">
          <LoginLogoutCard />
          <Section title="Money overview" icon={IndianRupee}>
            <div className="space-y-3 p-5 text-sm">
              <div className="flex justify-between"><span className="text-mute">Quoted (with GST)</span><b>{inr(totals.quoted)}</b></div>
              <div className="flex justify-between"><span className="text-mute">Collected</span><b className="text-ok">{inr(totals.collected)}</b></div>
              <div className="flex justify-between"><span className="text-mute">Outstanding</span><b className="text-bad">{inr(totals.outstanding)}</b></div>
            </div>
          </Section>
        </div>
      </div>
      <Section title="Collections · last 6 months" icon={BarChart3} className="mt-6">
        <div className="p-5"><Bars data={rev} format={inrShort} highlightLast height={200} /></div>
      </Section>
    </div>
  )
}

export function LegalDashboard() {
  const db = useDb()
  const me = useMe()
  const waiting = waitingFor(db, me).filter((b) => b.status === 'PENDING_LEGAL')
  const withOps = db.bookings.filter((b) => b.status === 'IN_OPERATIONS').length
  const overdue = db.bookings.filter((b) => !['COMPLETED', 'REJECTED'].includes(b.status) && b.deadline < today()).length
  const done = db.bookings.filter((b) => b.status === 'COMPLETED' && b.updatedAt.slice(0, 10) >= monthStart()).length
  const ops = usersWithRole(db, 'operations')
  const workload = useMemo(() => ops.map((u) => ({
    label: u.name, value: db.bookings.filter((b) => b.opsMemberId === u.id && ['IN_OPERATIONS', 'ON_HOLD'].includes(b.status)).length, sub: 'active files',
  })), [db.bookings, ops])
  const pendingLeave = db.leaves.filter((l) => l.status === 'PENDING' && l.approvers.includes('legal')).length

  return (
    <div>
      <Greeting subtitle="Legal · review CRM entries and assign them to the Operation team" />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Waiting for legal" value={waiting.length} icon={FileSearch} tone="violet" />
        <MiniStat label="With Operations" value={withOps} icon={UserCog} tone="cyan" />
        <MiniStat label="Overdue files" value={overdue} icon={AlertTriangle} tone="red" />
        <MiniStat label="Completed this month" value={done} icon={CheckCircle2} tone="green" />
      </div>
      <TileGrid>
        <Tile to="/approvals" icon={Scale} label="CRM entries to review" desc="Show & assign to the operation team" tone="violet" badge={waiting.length} highlight={waiting.length > 0} />
        <Tile to="/work" icon={Briefcase} label="Client work monitor" desc="Every file, every stage" tone="cyan" />
        <Tile to="/documents" icon={FileText} label="Document forms" desc="Client documents & verification" tone="blue" />
        <Tile to="/leave" icon={CalendarCheck2} label="Leave approvals" desc="Sales team requests" tone="amber" badge={pendingLeave} />
        <Tile to="/reports" icon={BookOpenCheck} label="Reports" tone="navy" />
        <Tile to="/attendance" icon={UserCheck} label="Attendance Board" tone="green" />
      </TileGrid>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section title="Review & assign" subtitle="Pick an operations member and the furthest stage they may reach" icon={Scale} className="xl:col-span-2" action={<ViewAll to="/approvals" />}>
          {waiting.length ? waiting.slice(0, 6).map((b) => <BookingRow key={b.id} b={b} />) : <EmptyState icon={CheckCircle2} title="Nothing to review" text="Files approved by Accounts appear here." />}
        </Section>
        <div className="space-y-6">
          <Section title="Operation team workload" icon={UserCog}><div className="p-5"><HBars data={workload} /></div></Section>
          <LoginLogoutCard />
          <UpcomingEvents limit={3} />
        </div>
      </div>
    </div>
  )
}
