import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, Briefcase, CalendarCheck2, Copy, FileText, HardDrive, Headphones, KeyRound, LogIn, Megaphone, MessageSquare,
  PauseCircle, ScrollText, Search, ShieldAlert, Sparkles, UserCheck, UserX, Users, UsersRound,
} from 'lucide-react'
import { useDb } from '../../lib/store'
import { userName, visibleBookings } from '../../lib/actions'
import { useMe } from '../../lib/auth'
import { STAGES } from '../../lib/workflow'
import { ago, bookingMoney, fmtDateTime, inr, today } from '../../lib/format'
import { roleLabel } from '../../lib/rbac'
import { Badge, Button, EmptyState, Stat, Table, Td, Th, useToast } from '../../components/ui'
import { BookingStatusBadge } from '../../components/booking'
import { Greeting, LoginLogoutCard, Section, Tile, TileGrid, ViewAll } from './widgets'

export function ItDashboard() {
  const db = useDb()
  const active = db.users.filter((u) => u.active)
  const signedToday = new Set(db.sessions.filter((s) => s.date === today()).map((s) => s.userId)).size
  const fails = Object.entries(db.loginFails)
  const locked = fails.filter(([, f]) => f.until && new Date(f.until) > new Date())
  const signIns = db.audit.filter((a) => ['SIGN_IN', 'SIGN_OUT', 'PASSWORD', 'PASSWORD_RESET', 'ACCESS_CHANGE', 'USER_CREATE'].includes(a.action)).slice(0, 10)
  const storageKb = useMemo(() => { try { return Math.round((localStorage.getItem('rexera-crm-db')?.length ?? 0) / 1024) } catch { return 0 } }, [db])

  return (
    <div>
      <Greeting subtitle="IT Support · accounts, sign-in security and system health" />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active accounts" value={active.length} icon={Users} tone="navy" sub={`${db.users.length - active.length} deactivated`} />
        <Stat label="Signed in today" value={signedToday} icon={LogIn} tone="green" />
        <Stat label="Failed sign-in attempts" value={fails.reduce((s, [, f]) => s + f.count, 0)} icon={ShieldAlert} tone="amber" />
        <Stat label="Locked accounts" value={locked.length} icon={UserX} tone="red" sub="5 wrong passwords = 5 min lock" />
      </div>
      <TileGrid>
        <Tile to="/employees" icon={UsersRound} label="Employee accounts" desc="Directory, roles, teams" tone="cyan" />
        <Tile to="/audit" icon={ScrollText} label="Activity log" desc="Sign-ins and every change" tone="gray" />
        <Tile to="/attendance" icon={UserCheck} label="Attendance Board" tone="green" />
        <Tile to="/messages" icon={MessageSquare} label="Messages" desc="Help requests from the team" tone="blue" />
        <Tile to="/broadcasts" icon={Megaphone} label="Broadcasts" tone="red" viewOnly />
        <Tile to="/leave?new=1" icon={CalendarCheck2} label="Request my leave" tone="violet" />
      </TileGrid>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section title="Sign-in & access events" subtitle="Latest security-relevant activity" icon={KeyRound} className="xl:col-span-2" action={<ViewAll to="/audit" />}>
          {!signIns.length ? <EmptyState icon={KeyRound} title="No events yet" /> : (
            <Table>
              <thead><tr><Th>When</Th><Th>Who</Th><Th>Event</Th><Th>Detail</Th></tr></thead>
              <tbody>{signIns.map((a) => (
                <tr key={a.id}><Td className="whitespace-nowrap text-xs text-mute">{fmtDateTime(a.at)}</Td><Td className="font-semibold">{userName(db, a.by)}</Td>
                  <Td><Badge tone={a.action === 'SIGN_IN' ? 'green' : a.action === 'SIGN_OUT' ? 'gray' : 'violet'}>{a.action.replace('_', ' ').toLowerCase()}</Badge></Td><Td className="text-sm">{a.detail}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Section>
        <div className="space-y-6">
          <Section title="Security watch" icon={ShieldAlert}>
            <ul className="divide-y divide-line/70">
              {fails.map(([login, f]) => (
                <li key={login} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <AlertTriangle className="size-4 text-warn" />
                  <span className="min-w-0 flex-1 truncate font-medium">{login}</span>
                  {f.until && new Date(f.until) > new Date() ? <Badge tone="red">locked until {new Date(f.until).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</Badge> : <Badge tone="amber">{f.count} failed</Badge>}
                </li>
              ))}
              {!fails.length && <li className="px-5 py-4 text-sm text-mute">No failed sign-ins. 🔒</li>}
            </ul>
          </Section>
          <Section title="System" icon={HardDrive}>
            <dl className="divide-y divide-line/70 text-sm">
              {[['App version', 'Rexera CRM 2.0'], ['Data stored (this browser)', `${storageKb} KB`], ['Inactivity sign-out', `${db.settings.sessionMinutes} min`],
                ['Secure hashing', globalThis.crypto?.subtle ? 'SHA-256 available' : 'Unavailable (open over https or localhost)'], ['Roles', `${new Set(db.users.map((u) => u.role)).size} in use`]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 px-5 py-2.5"><dt className="text-mute">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
              ))}
            </dl>
            <p className="border-t border-line px-5 py-3 text-xs text-mute">Creating accounts, changing roles and resetting passwords is done by a Super Admin in Access Management.</p>
          </Section>
          <LoginLogoutCard />
        </div>
      </div>
    </div>
  )
}

export function SupportDashboard() {
  const db = useDb()
  const me = useMe()
  const toast = useToast()
  const [q, setQ] = useState('')
  const files = visibleBookings(db, me)
  const activeFiles = files.filter((b) => !['COMPLETED', 'REJECTED'].includes(b.status))
  const waiting = files.filter((b) => ['ON_HOLD', 'ACCOUNTS_HOLD'].includes(b.status))
  const missingKyc = activeFiles.filter((b) => b.opsMemberId && !b.documents.some((d) => d.category === 'KYC'))
  const overdue = activeFiles.filter((b) => b.deadline < today())
  const found = q.trim().length >= 2
    ? files.filter((b) => `${b.bookingId} ${b.companyName} ${b.contactPerson} ${b.mobile} ${b.email}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
    : []

  return (
    <div>
      <Greeting subtitle="Customer Support · help clients with status, documents and payments" />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active client files" value={activeFiles.length} icon={Briefcase} tone="violet" />
        <Stat label="Waiting on client / hold" value={waiting.length} icon={PauseCircle} tone="orange" />
        <Stat label="Missing KYC documents" value={missingKyc.length} icon={FileText} tone="amber" />
        <Stat label="Overdue files" value={overdue.length} icon={AlertTriangle} tone="red" />
      </div>

      <Section title="Client lookup" subtitle="Search by name, mobile, email or booking ID to answer a client quickly" icon={Search} className="mb-6">
        <div className="p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-mute" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 98765… or Shah Agro or RX-2026-000125" aria-label="Client lookup"
              className="h-12 w-full rounded-2xl border border-line bg-card pl-12 pr-4 text-base outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" />
          </div>
          {q.trim().length >= 2 && !found.length && <p className="mt-4 text-sm text-mute">No client matches “{q}”.</p>}
          {found.length > 0 && (
            <ul className="mt-4 divide-y divide-line/70 rounded-2xl border border-line">
              {found.map((b) => {
                const m = bookingMoney(b)
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link to={`/bookings/${b.id}`} className="font-bold hover:underline">{b.companyName}</Link>
                      <p className="text-xs text-mute">{b.bookingId} · {b.serviceName} · {b.contactPerson} · {b.mobile}</p>
                      <p className="text-xs text-mute">Owner {userName(db, b.createdBy)}{b.opsMemberId ? ` · Stage ${b.stage}. ${STAGES[b.stage - 1]}` : ''} · outstanding {inr(m.outstanding)}</p>
                    </div>
                    <BookingStatusBadge b={b} />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Section>

      <TileGrid>
        <Tile to="/bookings" icon={Briefcase} label="Client files" desc="Status, payments, documents (view)" tone="violet" />
        <Tile to="/documents" icon={FileText} label="Document forms" desc="Upload what clients send" tone="blue" badge={missingKyc.length} />
        <Tile to="/messages?tab=templates" icon={MessageSquare} label="Reply templates" desc="Payment reminders, document requests" tone="green" />
        <Tile to="/schemes" icon={Sparkles} label="Schemes" tone="green" viewOnly />
        <Tile to="/broadcasts" icon={Megaphone} label="Broadcasts" tone="red" viewOnly />
        <Tile to="/leave?new=1" icon={CalendarCheck2} label="Request my leave" tone="violet" />
      </TileGrid>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section title="Clients to follow up" subtitle="On hold or waiting on the client" icon={Headphones} className="xl:col-span-2" action={<ViewAll to="/bookings?status=ON_HOLD" />}>
          {!waiting.length ? <EmptyState icon={Headphones} title="Nobody waiting" /> : (
            <ul className="divide-y divide-line/70">
              {waiting.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link to={`/bookings/${b.id}`} className="font-semibold hover:underline">{b.companyName}</Link>
                    <p className="text-xs text-mute">{b.contactPerson} · {b.mobile} · {b.holdReason ?? 'On hold'} · updated {ago(b.updatedAt)}</p>
                  </div>
                  <BookingStatusBadge b={b} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <div className="space-y-6">
          <Section title="Quick replies" icon={Copy} action={<ViewAll to="/messages?tab=templates" />}>
            <ul className="divide-y divide-line/70">
              {db.templates.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{t.name}</span><span className="block truncate text-xs text-mute">{t.body}</span></span>
                  <Button size="sm" variant="ghost" icon={Copy} aria-label={`Copy ${t.name}`} onClick={() => navigator.clipboard?.writeText(t.body).then(() => toast('success', 'Copied'), () => toast('error', 'Copy blocked'))} />
                </li>
              ))}
            </ul>
          </Section>
          <LoginLogoutCard />
        </div>
      </div>
      <p className="mt-6 text-xs text-mute">Signed in as {roleLabel(me.role)}. Client files are view-only here; add a comment on a file to pass a client's message to the team.</p>
    </div>
  )
}
