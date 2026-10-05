import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRightLeft, Network, Users } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { reassignOwner, sendToTeamLead, userName, usersWithRole, visibleBookings } from '../../lib/actions'
import { bookingMoney, inr } from '../../lib/format'
import { Avatar, Button, Card, CardHeader, EmptyState, PageHeader, Select, Table, Tabs, Td, Th, useRun } from '../../components/ui'
import { BookingStatusBadge } from '../../components/booking'

export default function Assign() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [params, setParams] = useSearchParams()
  const isLead = can('team.assign')
  const tab = params.get('tab') === 'team' ? 'team' : 'assign'
  const team = db.users.filter((u) => u.active && (me.role === 'superadmin' ? u.role === 'sales' : u.teamLeadId === me.id))
  const tls = usersWithRole(db, 'teamlead')
  const [pick, setPick] = useState<Record<string, string>>({})
  const mine = visibleBookings(db, me)
  const teamBookings = mine.filter((b) => me.role === 'superadmin' || b.teamLeadId === me.id)
  const byPerson = useMemo(() => team.map((u) => ({ u, items: db.bookings.filter((b) => b.createdBy === u.id) })), [team, db.bookings])

  if (!isLead) {
    const own = mine.filter((b) => b.createdBy === me.id)
    return (
      <div>
        <PageHeader title="Client assign to team leader" subtitle="Send a client (CRM entry) to the team leader who should approve it" icon={Network} />
        <Card className="overflow-hidden">
          {!own.length ? <EmptyState icon={Network} title="No CRM entries yet" action={<Link to="/bookings/new"><Button>New CRM entry</Button></Link>} /> : (
            <Table>
              <thead><tr><Th>Client</Th><Th>Status</Th><Th>Team leader</Th><Th className="text-right">Send to</Th></tr></thead>
              <tbody>{own.map((b) => {
                const movable = ['PENDING_TL', 'REJECTED'].includes(b.status)
                return (
                  <tr key={b.id}>
                    <Td><Link to={`/bookings/${b.id}`} className="font-semibold hover:underline">{b.companyName}</Link><p className="text-xs text-mute">{b.bookingId} · {b.serviceName}</p></Td>
                    <Td><BookingStatusBadge b={b} /></Td>
                    <Td>{userName(db, b.teamLeadId)}</Td>
                    <Td className="text-right">{movable ? <span className="inline-flex gap-2"><select className="h-9 rounded-lg border border-line bg-card px-2 text-sm" value={pick[b.id] ?? b.teamLeadId ?? ''} onChange={(e) => setPick({ ...pick, [b.id]: e.target.value })} aria-label="Team leader">{tls.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                      <Button size="sm" icon={ArrowRightLeft} onClick={() => run(() => sendToTeamLead(me, b.id, pick[b.id] ?? b.teamLeadId ?? ''), 'Sent to team leader')}>Send</Button></span> : <span className="text-xs text-mute">Already past team leader</span>}</Td>
                  </tr>
                )
              })}</tbody>
            </Table>
          )}
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Client Assignment" subtitle="Assign clients to sales people and see who owns what" icon={Network}
        actions={<Tabs value={tab} onChange={(t) => setParams(t === 'assign' ? {} : { tab: t })} tabs={[{ id: 'assign', label: 'Assign clients', icon: ArrowRightLeft }, { id: 'team', label: 'Sales person ↔ client info', icon: Users }]} />} />
      {tab === 'assign' ? (
        <Card className="overflow-hidden">
          {!teamBookings.length ? <EmptyState icon={Network} title="No team clients" /> : (
            <Table>
              <thead><tr><Th>Client</Th><Th>Status</Th><Th>Current owner</Th><Th className="text-right">Assign to</Th></tr></thead>
              <tbody>{teamBookings.map((b) => (
                <tr key={b.id}>
                  <Td><Link to={`/bookings/${b.id}`} className="font-semibold hover:underline">{b.companyName}</Link><p className="text-xs text-mute">{b.bookingId} · {b.serviceName}</p></Td>
                  <Td><BookingStatusBadge b={b} /></Td>
                  <Td><span className="flex items-center gap-2"><Avatar name={userName(db, b.createdBy)} size={26} />{userName(db, b.createdBy)}</span></Td>
                  <Td className="text-right"><span className="inline-flex gap-2">
                    <Select value={pick[b.id] ?? ''} onChange={(e) => setPick({ ...pick, [b.id]: e.target.value })} aria-label="Sales person"><option value="">— Sales person —</option>{team.filter((u) => u.id !== b.createdBy).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
                    <Button size="sm" disabled={!pick[b.id]} onClick={() => run(() => reassignOwner(me, b.id, pick[b.id]!), 'Client reassigned')}>Assign</Button></span></Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {byPerson.map(({ u, items }) => (
            <Card key={u.id} className="overflow-hidden">
              <CardHeader title={u.name} subtitle={`${items.length} client(s) · ${inr(items.reduce((s, b) => s + bookingMoney(b).collected, 0))} collected`} />
              <ul className="divide-y divide-line/70">
                {items.map((b) => <li key={b.id} className="flex items-center gap-2 px-5 py-2.5"><Link to={`/bookings/${b.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline">{b.companyName}</Link><BookingStatusBadge b={b} /></li>)}
                {!items.length && <li className="px-5 py-4 text-sm text-mute">No clients yet.</li>}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
