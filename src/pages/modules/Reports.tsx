import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BookOpenCheck, Download, FileBarChart, Printer, TrendingUp } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { userName, visibleBookings } from '../../lib/actions'
import { collections, monthStart, pipelineTotals, revenueByMonth } from '../../lib/metrics'
import { BOOKING_STATUS, STAGES } from '../../lib/workflow'
import { bookingMoney, daysBetween, downloadCsv, inr, inrShort, today } from '../../lib/format'
import { rolesOf, roleLabel } from '../../lib/rbac'
import { Avatar, Badge, Button, Card, CardHeader, PageHeader, Progress, Table, Tabs, Td, Th } from '../../components/ui'
import { Bars, Donut, HBars } from '../../components/charts'
import { WorkProgress } from './WorkProgress'

type Tab = 'overview' | 'progress' | 'services' | 'revenue' | 'cards' | 'export'

export default function Reports() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'overview'
  const books = visibleBookings(db, me)
  const totals = pipelineTotals(db, books)
  const rev = revenueByMonth(db, 12)
  const byService = useMemo(() => {
    const m = new Map<string, { count: number; collected: number }>()
    for (const b of books) { const x = m.get(b.serviceName) ?? { count: 0, collected: 0 }; x.count++; x.collected += bookingMoney(b).collected; m.set(b.serviceName, x) }
    return [...m.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.collected - a.collected)
  }, [books])
  const byStage = STAGES.map((s, i) => ({ label: `${i + 1}. ${s}`, value: books.filter((b) => b.opsMemberId && b.stage === i + 1 && b.status !== 'COMPLETED').length }))
  const turnaround = useMemo(() => {
    const done = books.filter((b) => b.status === 'COMPLETED')
    return done.length ? Math.round(done.reduce((s, b) => s + daysBetween(b.createdAt.slice(0, 10), b.updatedAt.slice(0, 10)), 0) / done.length) : 0
  }, [books])
  const sales = db.users.filter((u) => u.active && rolesOf(u).some((r) => r === 'sales' || r === 'teamlead'))
  const tabs: { id: Tab; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'progress', label: 'Work progress' }, { id: 'services', label: 'Service reports' }, { id: 'revenue', label: 'Profit & revenue' }, { id: 'cards', label: 'Report cards' }, ...(can('reports.export') ? [{ id: 'export' as Tab, label: 'Export data' }] : [])]

  const exports: [string, () => void][] = [
    ['All CRM entries', () => downloadCsv(`crm-entries-${today()}.csv`, books.map((b) => { const m = bookingMoney(b); return { id: b.bookingId, company: b.companyName, service: b.serviceName, status: BOOKING_STATUS[b.status].label, stage: b.stage, quoted: m.quotedWithGst, collected: m.collected, outstanding: m.outstanding, sales: userName(db, b.createdBy), created: b.createdAt.slice(0, 10) } }))],
    ['Payments / collections', () => downloadCsv(`collections-${today()}.csv`, books.flatMap((b) => b.payments.map((p) => ({ booking: b.bookingId, company: b.companyName, part: p.part, date: p.date, mode: p.mode, amount: p.amount, gst: p.gst, total: p.total, verified: p.verified ? 'yes' : 'no', sales: userName(db, b.createdBy) }))))],
    ['User collections (this month)', () => downloadCsv(`user-collections-${today()}.csv`, sales.map((u) => ({ name: u.name, role: roleLabel(u.role), collected: collections(db, [u.id], monthStart()), target: u.target ?? '' })))],
    ['Leads', () => downloadCsv(`leads-${today()}.csv`, db.leads.map((l) => ({ code: l.code, name: l.name, phone: l.phone, status: l.status, service: l.service, owner: userName(db, l.assignedTo), calls: l.calls.length })))],
    ['Approval history', () => downloadCsv(`approvals-${today()}.csv`, books.flatMap((b) => b.approvals.map((a) => ({ booking: b.bookingId, level: a.level, action: a.action, by: userName(db, a.by), at: a.at, remark: a.remark }))))],
    ['Attendance (21 days)', () => downloadCsv(`attendance-${today()}.csv`, db.sessions.map((s) => ({ date: s.date, name: userName(db, s.userId), login: s.loginAt, logout: s.logoutAt ?? '' })))],
  ]

  return (
    <div>
      <PageHeader title="Reports" subtitle="Analytics across the client pipeline, sales and services" icon={BookOpenCheck} />
      <Tabs className="mb-5 w-fit" value={tab} onChange={(t) => setParams({ tab: t })} tabs={tabs} />

      {tab === 'overview' && (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:col-span-3 xl:grid-cols-4">
            {[['Quoted (with GST)', inr(totals.quoted)], ['Collected', inr(totals.collected)], ['Outstanding', inr(totals.outstanding)], ['Avg. turnaround', `${turnaround} days`]].map(([k, v]) => <Card key={k} className="p-4"><p className="text-xs font-semibold text-mute">{k}</p><p className="mt-1 text-xl font-extrabold">{v}</p></Card>)}
          </div>
          <Card className="overflow-hidden xl:col-span-2"><CardHeader title="Collections · 12 months" icon={TrendingUp} /><div className="p-5"><Bars data={rev} format={inrShort} highlightLast height={220} /></div></Card>
          <Card className="overflow-hidden"><CardHeader title="Files by status" /><div className="p-5"><Donut data={(Object.keys(BOOKING_STATUS) as (keyof typeof BOOKING_STATUS)[]).map((k) => ({ label: BOOKING_STATUS[k].label, value: books.filter((b) => b.status === k).length })).filter((x) => x.value)} /></div></Card>
          <Card className="overflow-hidden xl:col-span-3"><CardHeader title="Stage-wise files in processing" /><div className="p-5"><HBars data={byStage} /></div></Card>
        </div>
      )}

      {tab === 'progress' && <WorkProgress />}
      {tab === 'services' && (
        <Card className="overflow-hidden">
          <CardHeader title="Service-wise report" action={<Button size="sm" variant="outline" icon={Download} onClick={() => downloadCsv('service-report.csv', byService.map((s) => ({ service: s.label, bookings: s.count, collected: Math.round(s.collected) })))}>CSV</Button>} />
          <Table><thead><tr><Th>Service</Th><Th className="text-right">Bookings</Th><Th className="text-right">Collected</Th><Th className="w-64">Share</Th></tr></thead>
            <tbody>{byService.map((s) => <tr key={s.label}><Td className="font-semibold">{s.label}</Td><Td className="text-right">{s.count}</Td><Td className="text-right font-semibold">{inr(s.collected)}</Td><Td><Progress value={(s.collected / Math.max(1, byService[0]!.collected)) * 100} /></Td></tr>)}</tbody></Table>
        </Card>
      )}

      {tab === 'revenue' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="overflow-hidden lg:col-span-2"><CardHeader title="Monthly collections (with GST)" icon={TrendingUp} /><div className="p-5"><Bars data={rev} format={inrShort} height={240} highlightLast /></div></Card>
          <Card className="overflow-hidden"><CardHeader title="Net of GST" /><div className="space-y-2 p-5 text-sm">
            {(() => { const base = books.reduce((s, b) => s + bookingMoney(b).collectedBase, 0); const gst = totals.collected - base; const ded = books.reduce((s, b) => s + (b.payments.length ? b.deduction : 0), 0); return <>
              <div className="flex justify-between"><span className="text-mute">Collected incl. GST</span><b>{inr(totals.collected)}</b></div>
              <div className="flex justify-between"><span className="text-mute">GST payable</span><b className="text-bad">− {inr(gst)}</b></div>
              <div className="flex justify-between"><span className="text-mute">Service deductions</span><b className="text-bad">− {inr(ded)}</b></div>
              <div className="flex justify-between border-t border-line pt-2 text-base"><span>Net revenue</span><b className="text-ok">{inr(base - ded)}</b></div></> })()}
          </div></Card>
          <Card className="overflow-hidden"><CardHeader title="Top services by revenue" /><div className="p-5"><HBars data={byService.slice(0, 6).map((s) => ({ label: s.label, value: Math.round(s.collected) }))} format={inrShort} /></div></Card>
        </div>
      )}

      {tab === 'cards' && (
        <div>
          <div className="no-print mb-4 flex justify-end"><Button icon={Printer} onClick={() => window.print()}>Print report cards</Button></div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {sales.map((u) => {
              const coll = collections(db, [u.id], monthStart())
              const target = u.target ?? 300000
              const pct = Math.round((coll / target) * 100)
              const calls = db.leads.flatMap((l) => l.calls).filter((c) => c.by === u.id).length
              const conv = db.leads.filter((l) => l.assignedTo === u.id && l.status === 'CONVERTED').length
              const grade = pct >= 100 ? 'A+' : pct >= 75 ? 'A' : pct >= 50 ? 'B' : pct >= 25 ? 'C' : 'D'
              return (
                <Card key={u.id} className="print-area p-5">
                  <div className="flex items-center gap-3"><Avatar name={u.name} photo={u.photo} size={48} /><div className="flex-1"><p className="font-bold">{u.name}</p><p className="text-xs text-mute">{roleLabel(u.role)} · {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</p></div>
                    <span className="grid size-12 place-items-center rounded-2xl bg-brand text-lg font-extrabold text-white">{grade}</span></div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-card2 p-2"><p className="text-lg font-extrabold">{calls}</p><p className="text-[10px] text-mute">Calls</p></div>
                    <div className="rounded-xl bg-card2 p-2"><p className="text-lg font-extrabold">{conv}</p><p className="text-[10px] text-mute">Converted</p></div>
                    <div className="rounded-xl bg-card2 p-2"><p className="text-lg font-extrabold">{db.bookings.filter((b) => b.createdBy === u.id).length}</p><p className="text-[10px] text-mute">CRM entries</p></div>
                  </div>
                  <p className="mt-4 mb-1 flex justify-between text-xs"><span>{inr(coll)} of {inrShort(target)}</span><b>{pct}%</b></p>
                  <Progress value={pct} tone={pct >= 100 ? 'green' : 'orange'} />
                  <Badge tone={pct >= 100 ? 'green' : pct >= 50 ? 'amber' : 'red'} className="mt-3">{pct >= 100 ? 'Target achieved' : `${inr(Math.max(0, target - coll))} to go`}</Badge>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'export' && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {exports.map(([label, fn]) => (
            <Card key={label} className="flex items-center gap-4 p-5">
              <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-ink"><FileBarChart className="size-5" /></span>
              <span className="flex-1 font-semibold">{label}</span>
              <Button size="sm" variant="outline" icon={Download} onClick={fn}>CSV</Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
