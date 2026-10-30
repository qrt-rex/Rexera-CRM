import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Briefcase, CalendarCheck2, ClipboardCheck, ClipboardList, FileText, Images, IndianRupee, Megaphone, Network, Phone, PhoneCall, Sparkles, Target, UserCheck, Users, BellRing, Lightbulb, BookMarked, FileSignature, UserRoundCheck, Receipt, Layers } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { visibleBookings, userName } from '../../lib/actions'
import { collections, monthStart, salesNumbers, waitingFor } from '../../lib/metrics'
import { inr, inrShort } from '../../lib/format'
import { EmptyState } from '../../components/ui'
import { Ring } from '../../components/charts'
import { BookingRow, BookingStatusBadge, ChainStepper } from '../../components/booking'
import { ClientEntriesPanel } from '../../components/ClientEntry'
import { followUpDue, visibleClientEntries } from '../../lib/clientEntries'
import { Greeting, LoginLogoutCard, MiniStat, Section, Tile, TileGrid, UpcomingEvents, ViewAll, type TileSubAction } from './widgets'

export function SalesDashboard({ lead }: { lead: boolean }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
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
  const entriesDue = visibleClientEntries(db, me).filter((e) => followUpDue(e)).length

  // Sub-action definitions for each tile's dropdown menu
  const dialerActions: TileSubAction[] = [
    { label: 'Open Dialer', to: '/dialer', icon: Phone },
    { label: 'My Leads Queue', to: '/dialer?tab=queue', icon: PhoneCall },
    { label: 'Call History', to: '/dialer?tab=history', icon: BarChart3 },
  ]
  const docFormActions: TileSubAction[] = [
    { label: 'All Forms', to: '/documents', icon: FileText },
    // the Form Builder is for Admin / Operations — not shown to people who can't open it
    ...(can('forms.manage') ? [{ label: 'Create New Form', to: '/forms', icon: FileSignature }] : []),
  ]
  const flyerActions: TileSubAction[] = [
    { label: 'Flyers & Posters', to: '/content?tab=FLYER', icon: Images },
    { label: 'Sales Info', to: '/content?tab=SALES_INFO', icon: Lightbulb },
  ]
  const schemeActions: TileSubAction[] = [
    { label: 'Browse Schemes', to: '/schemes', icon: Sparkles },
    { label: 'Sales Kit', to: '/sales-kit', icon: BookMarked },
    { label: 'Services & Pricing', to: '/services', icon: Layers },
  ]
  const invoiceActions: TileSubAction[] = [
    { label: 'All Invoices', to: '/billing', icon: IndianRupee },
    { label: 'Create Invoice', to: '/billing?new=1', icon: Receipt },
  ]
  const salesInfoActions: TileSubAction[] = [
    { label: 'Pitches & Scripts', to: '/content?tab=SALES_INFO', icon: Lightbulb },
    { label: 'Price List', to: '/services', icon: Layers },
    { label: 'Sales Kit', to: '/sales-kit', icon: BookMarked },
  ]
  const clientEntryActions: TileSubAction[] = [
    { label: 'View All Entries', to: '/client-entries', icon: ClipboardList },
    { label: 'Due Follow-ups', onClick: () => document.getElementById('client-entries')?.scrollIntoView({ behavior: 'smooth' }), icon: CalendarCheck2 },
  ]
  const broadcastActions: TileSubAction[] = [
    { label: 'All Broadcasts', to: '/broadcasts', icon: Megaphone },
    { label: 'Notifications', to: '/notifications', icon: BellRing },
  ]
  const assignActions: TileSubAction[] = lead ? [
    { label: 'Assign to Sales Person', to: '/assign', icon: Network },
    { label: 'Sales Person ↔ Client', to: '/assign?tab=team', icon: Users },
    { label: 'Team Progress', to: '/team', icon: BarChart3 },
  ] : [
    { label: 'Assign to Team Leader', to: '/assign', icon: Network },
  ]
  const leaveActions: TileSubAction[] = [
    { label: 'Apply for Leave', to: '/leave?new=1', icon: CalendarCheck2 },
    { label: 'My Leave History', to: '/leave', icon: CalendarCheck2 },
  ]
  const attendanceActions: TileSubAction[] = [
    { label: 'Today\'s Board', to: '/attendance', icon: UserCheck },
    { label: 'My Attendance', to: '/attendance?tab=me', icon: UserCheck },
  ]

  return (
    <div>
      <Greeting
        subtitle={lead ? `Team Leader · ${team.length} people in your team` : "Sales Person · let\u2019s close some deals today"}
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
        <Tile to="/dialer" icon={Phone} label="Dialer · my leads" desc="Call your assigned leads, log outcomes" highlight badge={n.toCall} subActions={dialerActions} />
        <Tile to="/documents" icon={FileText} label="Document Form" desc="Collect client documents" tone="blue" subActions={docFormActions} />
        <Tile to="/content?tab=FLYER" icon={Images} label="Flyer & Post" desc="Latest marketing material" tone="orange" badge={newPosts || undefined} subActions={flyerActions} />
        <Tile to="/schemes" icon={Sparkles} label="Schemes" desc="Government schemes & offers" tone="green" subActions={schemeActions} />
        <Tile to="/billing" icon={IndianRupee} label="Invoice / Bill" desc="Proforma & my invoices" tone="amber" subActions={invoiceActions} />
        <Tile to="/content?tab=SALES_INFO" icon={Lightbulb} label="Sales Information" desc="Pitches, price list, objections" tone="violet" subActions={salesInfoActions} />
        <Tile onClick={() => document.getElementById('client-entries')?.scrollIntoView({ behavior: 'smooth' })} icon={ClipboardList} label="Client Entries" desc="Follow up · convert to CRM entry after payment" tone="violet" badge={entriesDue || undefined} subActions={clientEntryActions} />
        <Tile to="/broadcasts" icon={Megaphone} label="Broadcast" desc="Company updates" tone="red" badge={unacked || undefined} subActions={broadcastActions} />
        {lead ? (
          <>
            <Tile to="/team" icon={BarChart3} label="Sales team progress" desc="Calls, conversions, collections" tone="green" />
            <Tile to="/assign" icon={Network} label="Assign client to sales person" desc="Move clients within your team" tone="pink" subActions={assignActions} />
            <Tile to="/assign?tab=team" icon={Users} label="Sales person ↔ client info" desc="Who owns which client" tone="cyan" />
          </>
        ) : (
          <Tile to="/assign" icon={Network} label="Client assign to team leader" desc="Send a client to a team leader" tone="pink" subActions={assignActions} />
        )}
        <Tile to="/leave?new=1" icon={CalendarCheck2} label="Request my leave" desc="Apply in two clicks" tone="violet" subActions={leaveActions} />
        <Tile to="/attendance" icon={UserCheck} label="Attendance Board" desc="Live day status" tone="green" subActions={attendanceActions} />
        <Tile to="/notifications" icon={BellRing} label="Notifications" desc="Approvals and updates" tone="orange" />
      </TileGrid>

      {/* sales person → dialer → client entry → follow-ups → CRM entry */}
      <Section id="client-entries" className="mt-6" title={lead ? 'Client entries · me and my team' : 'My client entries'} subtitle="Filled in the dialer during the call — follow up, then convert to a CRM entry once the payment is received" icon={ClipboardList}>
        <ClientEntriesPanel lead={lead} />
      </Section>

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
            {!mine.length ? <EmptyState icon={Briefcase} title="No CRM entries yet" text="Convert a client entry once the payment is received." /> : (
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
