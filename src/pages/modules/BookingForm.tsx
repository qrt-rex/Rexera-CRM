import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Briefcase, Building2, Calculator, IndianRupee, Paperclip, Save, Send, Upload } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { createBooking, findDuplicates, updateBooking, usersWithRole, type BookingInput } from '../../lib/actions'
import { INDIAN_STATES, gstSplit, inr, isGstin, isPan, isPhone, round2, today } from '../../lib/format'
import { rolesOf } from '../../lib/rbac'
import { Button, Card, CardHeader, FileButton, Input, PageHeader, Select, Textarea, useRun } from '../../components/ui'

export default function BookingForm() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const nav = useNavigate()
  const { id } = useParams()
  const [params] = useSearchParams()
  const existing = id ? db.bookings.find((b) => b.id === id) : undefined
  const lead = params.get('lead') ? db.leads.find((l) => l.id === params.get('lead')) : undefined
  const svcFromLead = lead ? db.services.find((s) => s.name === lead.service) : undefined

  const [f, setF] = useState<BookingInput>(() => existing ? {
    companyName: existing.companyName, contactPerson: existing.contactPerson, mobile: existing.mobile, email: existing.email, pan: existing.pan,
    gstin: existing.gstin, city: existing.city, state: existing.state, industry: existing.industry, serviceId: existing.serviceId, mode: existing.mode,
    successFeePct: existing.successFeePct, totalQuoted: existing.totalQuoted, priority: existing.priority, teamLeadId: existing.teamLeadId,
    advance: { amount: 0, date: today(), mode: 'UPI', proofName: 'existing' },
  } : {
    companyName: lead?.company ?? '', contactPerson: lead?.name ?? '', mobile: lead?.phone ?? '', email: lead?.email ?? '', pan: '', gstin: '',
    city: lead?.city ?? '', state: lead?.state || 'Gujarat', industry: '', serviceId: svcFromLead?.id ?? '', mode: 'Refundable', successFeePct: 0,
    totalQuoted: lead?.price ?? svcFromLead?.price ?? 0, priority: 'MEDIUM', teamLeadId: me.teamLeadId, leadId: lead?.id, note: '',
    advance: { amount: 0, date: today(), mode: 'UPI', proofName: '' },
  })
  const set = <K extends keyof BookingInput>(k: K, v: BookingInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const setAdv = (k: keyof BookingInput['advance'], v: string | number) => setF((x) => ({ ...x, advance: { ...x.advance, [k]: v } }))

  const svc = db.services.find((s) => s.id === f.serviceId)
  const gstRate = svc?.gstRate ?? 18
  const dups = useMemo(() => findDuplicates(db, f, existing?.id), [db, f, existing?.id])
  const advGst = gstSplit(f.advance.amount || 0, gstRate, f.state, db.settings.supplierState)
  const quoteGst = round2((f.totalQuoted || 0) * (1 + gstRate / 100))
  const tls = usersWithRole(db, 'teamlead')
  const isTL = rolesOf(me).includes('teamlead')
  const cats = [...new Set(db.services.map((s) => s.category))]

  const submit = async () => {
    if (existing) {
      const { advance: _a, ...patch } = f
      if (await run(() => updateBooking(me, existing.id, patch), 'CRM entry saved')) nav(`/bookings/${existing.id}`)
    } else {
      const newId = await run(() => createBooking(me, f), isTL ? 'Submitted to Accounts' : 'Submitted to your team leader')
      if (typeof newId === 'string') nav(`/bookings/${newId}`)
    }
  }
  const err = {
    mobile: f.mobile && !isPhone(f.mobile) ? '10-digit Indian mobile' : undefined,
    pan: f.pan && !isPan(f.pan) ? 'Format ABCDE1234F' : undefined,
    gstin: f.gstin && !isGstin(f.gstin) ? '15 characters, e.g. 24ABCDE1234F1Z5' : undefined,
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={existing ? `Edit ${existing.bookingId}` : 'New CRM Entry'} subtitle={lead ? `From lead ${lead.code} · ${lead.name}` : 'One booking = one client buying one service'} icon={Briefcase}
        actions={<Link to={existing ? `/bookings/${existing.id}` : '/bookings'}><Button variant="outline">Cancel</Button></Link>} />

      {dups.length > 0 && (
        <div className="mb-5 flex gap-3 rounded-2xl border border-warn/40 bg-warn-soft p-4 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-warn" />
          <div><p className="font-bold text-warn">Possible duplicate client</p>
            <p className="text-mute">Same mobile, email, PAN or GSTIN exists on: {dups.slice(0, 3).map((d) => <Link key={d.id} to={`/bookings/${d.id}`} className="mr-2 font-semibold text-brand-ink underline">{d.bookingId} ({d.serviceName})</Link>)}. You can still continue (e.g. another service for the same client).</p></div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Block title="Client company" icon={Building2}>
            <Input label="Company name" required value={f.companyName} onChange={(e) => set('companyName', e.target.value)} className="sm:col-span-2" />
            <Input label="Contact person" required value={f.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} />
            <Input label="Company mobile" required inputMode="tel" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} error={err.mobile} />
            <Input label="Company email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
            <Input label="Industry" value={f.industry} onChange={(e) => set('industry', e.target.value)} placeholder="e.g. Food Processing" />
            <Input label="Company PAN" value={f.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} error={err.pan} maxLength={10} />
            <Input label="GSTIN" value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} error={err.gstin} maxLength={15} />
            <Input label="City" value={f.city} onChange={(e) => set('city', e.target.value)} />
            <Select label="State" value={f.state} onChange={(e) => set('state', e.target.value)} hint={f.state === db.settings.supplierState ? 'Same state: CGST + SGST' : 'Other state: IGST'}>
              {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Block>

          <Block title="Service & quote" icon={IndianRupee}>
            <Select label="Service" required value={f.serviceId} className="sm:col-span-2" onChange={(e) => { const s = db.services.find((x) => x.id === e.target.value); setF((x) => ({ ...x, serviceId: e.target.value, totalQuoted: x.totalQuoted || s?.price || 0 })) }}>
              <option value="">— Select a service —</option>
              {cats.map((c) => <optgroup key={c} label={c}>{db.services.filter((s) => s.category === c && s.active).map((s) => <option key={s.id} value={s.id}>{s.name} · {inr(s.price)}</option>)}</optgroup>)}
            </Select>
            <Input label="Total quoted (before GST)" required type="number" min={0} value={f.totalQuoted || ''} onChange={(e) => set('totalQuoted', Number(e.target.value))} hint={`With ${gstRate}% GST: ${inr(quoteGst)}`} />
            <Select label="Mode" value={f.mode} onChange={(e) => set('mode', e.target.value as BookingInput['mode'])}><option>Refundable</option><option>Non-Refundable</option></Select>
            <Input label="Success fee %" type="number" min={0} max={30} value={f.successFeePct || ''} onChange={(e) => set('successFeePct', Number(e.target.value))} />
            <Select label="Priority" value={f.priority} onChange={(e) => set('priority', e.target.value as BookingInput['priority'])}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></Select>
          </Block>

          {!existing && (
            <Block title="Advance payment" icon={Paperclip}>
              <Input label="Advance received (before GST)" required type="number" min={0} value={f.advance.amount || ''} onChange={(e) => setAdv('amount', Number(e.target.value))} />
              <Input label="Payment date" type="date" value={f.advance.date} onChange={(e) => setAdv('date', e.target.value)} />
              <Select label="Payment mode" value={f.advance.mode} onChange={(e) => setAdv('mode', e.target.value)}>{['UPI', 'NEFT', 'RTGS', 'IMPS', 'Cheque', 'Card', 'Cash'].map((m) => <option key={m}>{m}</option>)}</Select>
              <div>
                <span className="mb-1.5 block text-xs font-semibold text-mute">Payment proof <span className="text-bad">*</span></span>
                <FileButton accept="image/*,application/pdf" onFile={(file) => setAdv('proofName', file.name)}>
                  <Button type="button" variant="outline" icon={Upload} className="w-full justify-start">{f.advance.proofName || 'Attach JPG / PNG / PDF'}</Button>
                </FileButton>
              </div>
              {!isTL && (
                <Select label="Send to team leader" required value={f.teamLeadId ?? ''} onChange={(e) => set('teamLeadId', e.target.value)} className="sm:col-span-2" hint="Client assign to team leader — they give the first approval.">
                  <option value="">— Select —</option>{tls.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me.teamLeadId ? ' (my team leader)' : ''}</option>)}
                </Select>
              )}
              <Textarea label="Note for approvers" value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} className="sm:col-span-2" />
            </Block>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="overflow-hidden">
            <CardHeader title="Summary" icon={Calculator} />
            <div className="space-y-2.5 p-5 text-sm">
              <Row k="Service" v={svc?.name ?? '—'} />
              <Row k="Quoted" v={inr(f.totalQuoted || 0)} />
              <Row k={`GST ${gstRate}%`} v={inr(quoteGst - (f.totalQuoted || 0))} />
              <Row k="Quoted with GST" v={<b>{inr(quoteGst)}</b>} />
              {!existing && <>
                <div className="my-3 border-t border-dashed border-line" />
                <Row k="Advance" v={inr(f.advance.amount || 0)} />
                {advGst.igst ? <Row k="IGST" v={inr(advGst.igst)} /> : <><Row k="CGST" v={inr(advGst.cgst)} /><Row k="SGST" v={inr(advGst.sgst)} /></>}
                <Row k="Advance with GST" v={<b className="text-ok">{inr((f.advance.amount || 0) + advGst.tax)}</b>} />
                {svc?.deduction ? <Row k="Service deduction" v={<span className="text-bad">− {inr(svc.deduction)}</span>} /> : null}
                <Row k="Balance due" v={<b className="text-bad">{inr(Math.max(0, quoteGst - (f.advance.amount || 0) - advGst.tax))}</b>} />
                <p className="pt-2 text-xs text-mute">Suggested plan: 40 / 30 / 20 / 10 → {[0.4, 0.3, 0.2, 0.1].map((p) => inr(round2((f.totalQuoted || 0) * p))).join(' · ')}</p>
              </>}
            </div>
            <div className="border-t border-line p-4">
              <Button variant="accent" size="lg" className="w-full" icon={existing ? Save : Send} onClick={submit}>{existing ? 'Save changes' : isTL ? 'Submit to Accounts' : 'Submit to team leader'}</Button>
              {!existing && <p className="mt-2 text-center text-[11px] text-mute">Chain: Team Leader → Accounts → Legal → Operations → Admin</p>}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function Block({ title, icon, children }: { title: string; icon: typeof Briefcase; children: ReactNode }) {
  return <Card className="overflow-hidden"><CardHeader title={title} icon={icon} /><div className="grid gap-4 p-5 sm:grid-cols-2">{children}</div></Card>
}
function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-mute">{k}</span><span className="truncate text-right">{v}</span></div>
}
