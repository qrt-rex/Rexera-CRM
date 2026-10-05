import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, Briefcase, CalendarCheck2, Copy, FileText, Headphones, Megaphone, MessageSquare, PauseCircle, Search, Sparkles,
} from 'lucide-react'
import { useDb } from '../../lib/store'
import { userName, visibleBookings } from '../../lib/actions'
import { useMe } from '../../lib/auth'
import { STAGES } from '../../lib/workflow'
import { ago, bookingMoney, inr, today } from '../../lib/format'
import { roleLabel } from '../../lib/rbac'
import { Button, EmptyState, Stat, useToast } from '../../components/ui'
import { BookingStatusBadge } from '../../components/booking'
import { Greeting, LoginLogoutCard, Section, Tile, TileGrid, ViewAll } from './widgets'

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
