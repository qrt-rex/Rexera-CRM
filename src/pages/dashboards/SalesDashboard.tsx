import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3, Briefcase, CalendarCheck2, ClipboardCheck, FileText, Images, IndianRupee, Megaphone, Network, Phone, PhoneCall,
  Sparkles, Target, UserCheck, UserPlus, Users, BellRing, Lightbulb,
} from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { visibleBookings, userName } from '../../lib/actions'
import { collections, monthStart, salesNumbers, waitingFor } from '../../lib/metrics'
import { inr, inrShort } from '../../lib/format'
import { EmptyState } from '../../components/ui'
import { Ring } from '../../components/charts'
import { BookingRow, BookingStatusBadge, ChainStepper } from '../../components/booking'
import { Greeting, LoginLogoutCard, MiniStat, Section, Tile, TileGrid, UpcomingEvents, ViewAll } from './widgets'

export function SalesDashboard({ lead }: { lead: boolean }) {
  const db = useDb()
  const me = useMe()
  const n = salesNumbers(db, me)
  const team = useMemo(() => db.users.filter((u) => u.teamLeadId === me.id && u.active), [db.users, me.id])
  const ids = lead ? [me.id, ...team.map((u) => u.id)] : [me.id]
  const collected = collections(db, ids, monthStart())
  const target = lead ? (me.target ?? 1200000) : (me.target ?? 300000)
  const pct = Math.min(100, Math.round((collected / target) * 100))
  const mine = visibleBookings(db, me).filter((b) => lead || b.createdBy === me.id)
  const waiting = waitingFor(db, me)
  const unacked = db.broadcasts.filter((b) => (b.audience === 'ALL' || b.audience.includes(me.role)) && !b.acks.includes(me.id)).length
  const newPosts = db.posts.filter((p) => Date.now() - new Date(p.createdAt).getTime() < 3 * 86400000).length

  return (
    <div>
      <Greeting
        subtitle={lead ? `Team Leader · ${team.length} people in your team` : 'Sales Person · let’s close some deals today'}
        right={
          <div className="flex items-center gap-4 rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
            <Ring value={pct} size={72} stroke={8} color="#F4A12A"><span className="text-white">{pct}%</span></Ring>
            <div className="text-sm">
              <p className="text-white/70">{lead ? 'Team' : 'My'} collections this month</p>
              <p className="text-xl font-extrabold">{inr(collected)}</p>
              <p className="text-xs text-white/70">Target {inrShort(target)} · {inr(Math.max(0, target - collected))} to go</p>
            </div>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Leads to call" value={n.toCall} icon={PhoneCall} tone="navy" />
        <MiniStat label="Follow-ups due" value={n.followUps} icon={CalendarCheck2} tone="amber" />
        <MiniStat label="Calls today" value={n.callsToday} icon={Phone} tone="green" />
        <MiniStat label={lead ? 'Waiting for my approval' : 'Converted leads'} value={lead ? waiting.length : n.converted} icon={lead ? ClipboardCheck : Target} tone="orange" />
      </div>

      <TileGrid>
        <Tile to="/leads" icon={UserPlus} label="CRM Leads" desc="Your leads — add, call, update status" tone="navy" badge={n.toCall} />
        <Tile to="/dialer" icon={Phone} label="Dialer" desc="Call your queue, log outcomes" highlight />
        <Tile to="/documents" icon={FileText} label="Document Form" desc="Collect client documents" tone="blue" />
        <Tile to="/content?tab=FLYER" icon={Images} label="Flyer & Post" desc="Latest marketing material" tone="orange" viewOnly={!lead} badge={newPosts || undefined} />
        <Tile to="/schemes" icon={Sparkles} label="Schemes" desc="Government schemes & offers" tone="green" viewOnly />
        <Tile to="/billing" icon={IndianRupee} label="Invoice / Bill" desc="Proforma & my invoices" tone="amber" />
        <Tile to="/content?tab=SALES_INFO" icon={Lightbulb} label="Sales Information" desc="Pitches, price list, objections" tone="violet" viewOnly={!lead} />
        <Tile to="/bookings/new" icon={Briefcase} label="CRM Entry" desc="Book a client with advance" tone="violet" />
        <Tile to="/broadcasts" icon={Megaphone} label="Broadcast" desc="Company updates" tone="red" viewOnly={!lead} badge={unacked || undefined} />
        {lead ? (
          <>
            <Tile to="/team" icon={BarChart3} label="Sales team progress" desc="Calls, conversions, collections" tone="green" />
            <Tile to="/assign" icon={Network} label="Assign client to sales person" desc="Move clients within your team" tone="pink" />
            <Tile to="/assign?tab=team" icon={Users} label="Sales person ↔ client info" desc="Who owns which client" tone="cyan" />
          </>
        ) : (
          <Tile to="/assign" icon={Network} label="Client assign to team leader" desc="Send a client to a team leader" tone="pink" />
        )}
        <Tile to="/leave?new=1" icon={CalendarCheck2} label="Request my leave" desc="Apply in two clicks" tone="violet" />
        <Tile to="/attendance" icon={UserCheck} label="Attendance Board" desc="Live day status" tone="green" />
        <Tile to="/notifications" icon={BellRing} label="Notifications" desc="Approvals and updates" tone="orange" />
      </TileGrid>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          <LoginLogoutCard />
          <UpcomingEvents limit={3} />
        </div>
        <div className="space-y-6 xl:col-span-2">
          {lead && (
            <Section title="Waiting for my approval" subtitle="CRM entries submitted by your team" icon={ClipboardCheck} action={<ViewAll to="/approvals" />}>
              {waiting.length ? waiting.slice(0, 5).map((b) => <BookingRow key={b.id} b={b} />) : <EmptyState icon={ClipboardCheck} title="Nothing waiting" text="New CRM entries from your team appear here." />}
            </Section>
          )}
          <Section title={lead ? 'Team CRM entries' : 'My CRM entries'} subtitle="Track every file through the approval chain" icon={Briefcase} action={<ViewAll to="/bookings" />}>
            {!mine.length ? <EmptyState icon={Briefcase} title="No CRM entries yet" text="Book your first client from a converted lead." /> : (
              <ul className="divide-y divide-line/70">
                {mine.slice(0, 5).map((b) => (
                  <li key={b.id} className="px-5 py-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Link to={`/bookings/${b.id}`} className="font-bold hover:underline">{b.companyName}</Link>
                      <BookingStatusBadge b={b} />
                      <span className="ml-auto text-xs text-mute">{b.serviceName}{lead && ` · ${userName(db, b.createdBy)}`}</span>
                    </div>
                    <ChainStepper b={b} compact />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
