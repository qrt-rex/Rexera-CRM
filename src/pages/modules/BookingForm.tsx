import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Briefcase, Building2, Calculator, CreditCard, FileText, IndianRupee, Layers, MessageSquareText, Plus, Save, Send, Trash2, Wallet } from 'lucide-react'
import type { FileRef } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { createBooking, findDuplicates, needsPriceSplit, updateBooking, usersWithRole, type BookingInput, type PaymentPartInput } from '../../lib/actions'
import { DOC_TYPES } from '../../lib/files'
import { addDays, fmtDate, inr, isEmail, isGstin, isPan, round2, today, ymd } from '../../lib/format'
import { rolesOf } from '../../lib/rbac'
import { stateForCity } from '../../lib/india'
import { Button, Card, CardHeader, cx, Input, PageHeader, Select, Textarea, useRun } from '../../components/ui'
import { CityInput, PhoneInput, StateSelect } from '../../components/fields'
import { FileField } from '../../components/FileField'
import { DocUploader, type PendingDoc } from '../../components/DocUploader'

const MODES = ['UPI', 'NEFT', 'RTGS', 'IMPS', 'Cheque', 'Card', 'Cash']
const COMPANY_DOCS = ['Company PAN card', 'GST certificate', 'Certificate of Incorporation (COI)', 'MSME / Udyam certificate', 'CRM', 'Quotation (QT)', 'Agreement', 'Company documents', 'Other']
type Pay = PaymentPartInput & { proof?: FileRef }

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
  const closers = useMemo(() => db.users.filter((u) => u.active && rolesOf(u).some((r) => r === 'sales' || r === 'teamlead')).sort((a, b) => a.name.localeCompare(b.name)), [db.users])

  const [f, setF] = useState<BookingInput>(() => existing ? {
    companyName: existing.companyName, companyAddress: existing.address ?? '', city: existing.city, state: existing.state, industry: existing.industry,
    contactPerson: existing.contactPerson, mobile: existing.mobile, email: existing.email, pan: existing.pan, gstin: existing.gstin,
    paymentContact: existing.paymentContact ?? existing.mobile, paymentEmail: existing.paymentEmail ?? '',
    services: existing.services?.map((s) => ({ serviceId: s.serviceId, price: s.price })) ?? [{ serviceId: existing.serviceId, price: existing.totalQuoted }],
    combo: existing.combo?.months, totalQuoted: existing.totalQuoted, mode: existing.mode, bookingDate: existing.bookingDate ?? existing.createdAt.slice(0, 10),
    payments: [], closedBy: existing.closedBy ?? existing.createdBy,
    successFee: existing.successFee ?? { type: 'PCT', value: existing.successFeePct || 0 }, remarks: existing.remarks ?? '', priority: existing.priority, teamLeadId: existing.teamLeadId,
  } : {
    // a hot lead fills itself in; the sales person can change everything
    companyName: lead?.company || lead?.name || '', companyAddress: '', city: lead?.city ?? '', state: lead?.state || (lead?.city ? stateForCity(lead.city) ?? '' : '') || 'Gujarat', industry: '',
    contactPerson: lead?.name ?? '', mobile: lead?.phone ?? '', email: lead?.email ?? '', pan: '', gstin: '',
    paymentContact: lead?.phone ?? '', paymentEmail: '',
    services: [{ serviceId: svcFromLead?.id ?? '', price: lead?.price ?? svcFromLead?.price ?? 0 }],
    combo: undefined, totalQuoted: lead?.price ?? svcFromLead?.price ?? 0, mode: 'Refundable', bookingDate: today(),
    payments: [{ amount: 0, date: today(), mode: 'UPI' }], closedBy: me.id,
    successFee: { type: 'PCT', value: 0 }, remarks: '', note: '', priority: 'MEDIUM', teamLeadId: me.teamLeadId, leadId: lead?.id,
  })
  const [docs, setDocs] = useState<PendingDoc[]>([])
  const [tried, setTried] = useState(false)
  const set = <K extends keyof BookingInput>(k: K, v: BookingInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const setPay = (i: number, patch: Partial<Pay>) => setF((x) => ({ ...x, payments: x.payments.map((p, j) => (j === i ? { ...p, ...patch } : p)) }))
  const setSvc = (i: number, patch: Partial<{ serviceId: string; price: number }>) => setF((x) => ({ ...x, services: x.services.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))

  const rows = f.services.map((x) => ({ ...x, s: db.services.find((s) => s.id === x.serviceId) }))
  const gstRate = Math.max(18, ...rows.map((r) => r.s?.gstRate ?? 18))
  const sumPrices = round2(rows.reduce((t, r) => t + (r.price || 0), 0))
  const allPriced = rows.length > 0 && rows.every((r) => r.price > 0)
  const quoteGst = round2((f.totalQuoted || 0) * (1 + gstRate / 100))
  const part1 = f.payments[0]?.amount || 0
  const paid = round2(f.payments.reduce((t, p) => t + (p.amount || 0), 0))
  const withGst = (n: number) => round2(n * (1 + gstRate / 100))
  const advPct = f.totalQuoted ? Math.round((part1 / f.totalQuoted) * 1000) / 10 : 0
  const comboEnd = f.combo ? (() => { const x = new Date(f.bookingDate + 'T00:00:00'); x.setMonth(x.getMonth() + f.combo!); return ymd(x) })() : ''
  const dups = useMemo(() => findDuplicates(db, f, existing?.id), [db, f, existing?.id])
  const tls = usersWithRole(db, 'teamlead')
  const isTL = rolesOf(me).includes('teamlead')
  const cats = [...new Set(db.services.map((s) => s.category))]
  const minServices = f.combo ? 3 : 1

  const e = tried ? {
    companyName: f.companyName.trim().length < 2 ? 'Required' : undefined,
    companyAddress: f.companyAddress.trim().length < 5 ? 'Required' : undefined,
    city: !f.city.trim() ? 'Required' : undefined,
    contactPerson: f.contactPerson.trim().length < 2 ? 'Required' : undefined,
    email: !isEmail(f.email) ? 'A valid email is required' : undefined,
    pan: !isPan(f.pan) ? 'Required · ABCDE1234F' : undefined,
    gstin: f.gstin && !isGstin(f.gstin) ? '15 characters, e.g. 24ABCDE1234F1Z5' : undefined,
    total: !(f.totalQuoted > 0) ? 'Required' : allPriced && Math.abs(sumPrices - f.totalQuoted) >= 0.01 ? `Services add up to ${inr(sumPrices)}` : undefined,
    remarks: f.remarks.trim().length < 3 ? 'Remarks are required' : undefined,
  } : {} as Record<string, string | undefined>

  const submit = async () => {
    setTried(true)
    if (existing) {
      const ok = await run(() => updateBooking(me, existing.id, {
        companyName: f.companyName, address: f.companyAddress, city: f.city, state: f.state, industry: f.industry, contactPerson: f.contactPerson, mobile: f.mobile,
        email: f.email, pan: f.pan.toUpperCase(), gstin: f.gstin.toUpperCase(), paymentContact: f.paymentContact, paymentEmail: f.paymentEmail, mode: f.mode,
        bookingDate: f.bookingDate, closedBy: f.closedBy, successFee: f.successFee, remarks: f.remarks, priority: f.priority,
      }), 'CRM entry saved')
      if (ok) nav(`/bookings/${existing.id}`)
      return
    }
    const newId = await run(() => createBooking(me, { ...f, documents: docs }), isTL ? 'Submitted to Accounts' : 'Submitted to your team leader')
    if (typeof newId === 'string') nav(`/bookings/${newId}`)
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={existing ? `Edit ${existing.bookingId}` : 'New CRM Entry'} subtitle={lead ? `Filled in from lead ${lead.code} · ${lead.name} — change anything you need` : 'Fields marked * are required. The date and time of entry are saved automatically.'} icon={Briefcase}
        actions={<Link to={existing ? `/bookings/${existing.id}` : '/bookings'}><Button variant="outline">Cancel</Button></Link>} />

      {dups.length > 0 && (
        <div className="mb-5 flex gap-3 rounded-2xl border border-warn/40 bg-warn-soft p-4 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-warn" />
          <div><p className="font-bold text-warn">Possible duplicate client</p>
            <p className="text-mute">Same mobile, email, PAN or GSTIN exists on: {dups.slice(0, 3).map((d) => <Link key={d.id} to={`/bookings/${d.id}`} className="mr-2 font-semibold text-brand-ink underline">{d.bookingId} ({d.serviceName})</Link>)}. You can still continue (e.g. another service for the same client).</p></div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_330px]">
        <div className="space-y-6">
          <Block title="Client company" icon={Building2}>
            <Input label="Company name" required value={f.companyName} error={e.companyName} onChange={(ev) => set('companyName', ev.target.value)} className="sm:col-span-2" />
            <Textarea label="Company address" required rows={2} value={f.companyAddress} error={e.companyAddress} onChange={(ev) => set('companyAddress', ev.target.value)} className="sm:col-span-2" placeholder="Building, street, area" />
            <CityInput label="City" required value={f.city} onChange={(v) => set('city', v)} onState={(s) => set('state', s)} />
            <StateSelect label="Company state" required value={f.state} onChange={(v) => set('state', v)} />
            <Input label="Contact person" required value={f.contactPerson} error={e.contactPerson} onChange={(ev) => set('contactPerson', ev.target.value)} />
            <PhoneInput label="Company mobile" required value={f.mobile} onChange={(v) => set('mobile', v)} />
            <Input label="Company email" required type="email" value={f.email} error={e.email} onChange={(ev) => set('email', ev.target.value)} />
            <Input label="Industry" value={f.industry} onChange={(ev) => set('industry', ev.target.value)} placeholder="e.g. Food Processing" />
            <Input label="Company PAN" required value={f.pan} error={e.pan} onChange={(ev) => set('pan', ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} maxLength={10} />
            <Input label="GST" value={f.gstin} error={e.gstin} onChange={(ev) => set('gstin', ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15))} maxLength={15} hint={f.state === db.settings.supplierState ? 'Same state: CGST + SGST' : 'Other state: IGST'} />
          </Block>

          <Block title="Payment contact" icon={CreditCard}>
            <PhoneInput label="Payment contact" required value={f.paymentContact} onChange={(v) => set('paymentContact', v)} hint="Who pays — can be different from the company mobile" />
            <Input label="Payment email" type="email" value={f.paymentEmail} onChange={(ev) => set('paymentEmail', ev.target.value)} error={tried && f.paymentEmail && !isEmail(f.paymentEmail) ? 'Not a valid email' : undefined} />
          </Block>

          <Card className="overflow-hidden">
            <CardHeader title="Services & quote" subtitle={`Price bifurcation is required for certification, website, logo and trade services${f.combo ? ' · combo needs at least 3 services' : ''}`} icon={Layers} />
            <div className="space-y-4 p-5">
              {!existing && (
                <div className="flex flex-wrap gap-2">
                  {([undefined, 3, 6, 12] as const).map((m) => (
                    <button key={String(m)} type="button" onClick={() => setF((x) => ({ ...x, combo: m, services: m && x.services.length < 3 ? [...x.services, ...Array.from({ length: 3 - x.services.length }, () => ({ serviceId: '', price: 0 }))] : x.services }))}
                      className={cx('rounded-full border px-4 py-1.5 text-sm font-semibold transition', f.combo === m ? 'border-brand bg-brand text-white' : 'border-line hover:bg-card2')}>
                      {m === undefined ? 'Single booking' : `Combo · ${m === 12 ? '1 year' : `${m} months`}`}
                    </button>
                  ))}
                </div>
              )}
              {f.combo && <p className="rounded-xl bg-info-soft px-3 py-2 text-xs text-info">Combo period: {fmtDate(f.bookingDate)} → {fmtDate(comboEnd)}. More services can be added to this booking until then; you'll be reminded a week before it ends.</p>}
              <div className="space-y-2">
                {rows.map((r, i) => {
                  const must = r.s ? needsPriceSplit(r.s) : false
                  return (
                    <div key={i} className="grid grid-cols-[1fr_150px_auto] items-end gap-2">
                      <Select label={i === 0 ? 'Service' : undefined} required={i === 0} value={r.serviceId} disabled={!!existing} aria-label={`Service ${i + 1}`}
                        onChange={(ev) => { const s = db.services.find((x) => x.id === ev.target.value); setSvc(i, { serviceId: ev.target.value, price: r.price || s?.price || 0 }) }}>
                        <option value="">— Select a service —</option>
                        {cats.map((c) => <optgroup key={c} label={c}>{db.services.filter((s) => s.category === c && s.active).map((s) => <option key={s.id} value={s.id} disabled={f.services.some((x, j) => j !== i && x.serviceId === s.id)}>{s.name}</option>)}</optgroup>)}
                      </Select>
                      <Input label={i === 0 ? 'Price (₹)' : undefined} type="number" inputMode="decimal" min={0} value={r.price || ''} disabled={!!existing} aria-label={`Price of service ${i + 1}`}
                        onChange={(ev) => setSvc(i, { price: Number(ev.target.value) })} error={tried && must && !(r.price > 0) ? 'Required' : undefined} placeholder={must ? 'Required' : 'Optional'} />
                      <Button type="button" variant="ghost" icon={Trash2} aria-label={`Remove service ${i + 1}`} disabled={!!existing || f.services.length <= minServices} onClick={() => set('services', f.services.filter((_, j) => j !== i))} />
                    </div>
                  )
                })}
                {!existing && <Button type="button" size="sm" variant="soft" icon={Plus} onClick={() => set('services', [...f.services, { serviceId: '', price: 0 }])}>Add service</Button>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Total quoted (before GST)" required type="number" inputMode="decimal" min={0} value={f.totalQuoted || ''} disabled={!!existing} error={e.total}
                  onChange={(ev) => set('totalQuoted', Number(ev.target.value))}
                  hint={allPriced && Math.abs(sumPrices - f.totalQuoted) >= 0.01 ? undefined : `With ${gstRate}% GST: ${inr(quoteGst)}`} />
                {!existing && allPriced && Math.abs(sumPrices - f.totalQuoted) >= 0.01 && <Button type="button" variant="outline" className="self-end" onClick={() => set('totalQuoted', sumPrices)}>Use service total · {inr(sumPrices)}</Button>}
                <Select label="Mode" required value={f.mode} onChange={(ev) => set('mode', ev.target.value as BookingInput['mode'])}><option>Refundable</option><option>Non-Refundable</option></Select>
                <div>
                  <span className="mb-1.5 block text-xs font-semibold text-mute">After discount success fee <span className="text-bad">*</span></span>
                  <div className="flex gap-2">
                    <select aria-label="Success fee type" value={f.successFee.type} onChange={(ev) => set('successFee', { ...f.successFee, type: ev.target.value as 'AMOUNT' | 'PCT' })} className="h-10 rounded-xl border border-line bg-card px-2 text-sm">
                      <option value="PCT">%</option><option value="AMOUNT">₹</option>
                    </select>
                    <input type="number" inputMode="decimal" min={0} aria-label="Success fee" value={f.successFee.value} onChange={(ev) => set('successFee', { ...f.successFee, value: Number(ev.target.value) })}
                      className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-sm outline-none focus:border-brand" />
                  </div>
                  <p className="mt-1 text-[11px] text-mute">Enter 0 if the client didn't agree to a success fee.</p>
                </div>
                <Select label="Priority" value={f.priority} onChange={(ev) => set('priority', ev.target.value as BookingInput['priority'])}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></Select>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Booking & payments" subtitle="Payment part 1 is required with proof; add part 2, 3… if the client pays in parts" icon={Wallet} />
            <div className="space-y-4 p-5">
              <Input label="Booking date" required type="date" max={today()} value={f.bookingDate} onChange={(ev) => set('bookingDate', ev.target.value)} className="sm:max-w-xs" />
              {!existing && f.payments.map((p, i) => (
                <div key={i} className="rounded-2xl border border-line p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-bold">Payment part {i + 1}{i === 0 && <span className="text-bad"> *</span>}</p>
                    {i > 0 && <Button type="button" size="sm" variant="ghost" icon={Trash2} aria-label={`Remove part ${i + 1}`} onClick={() => set('payments', f.payments.filter((_, j) => j !== i))} />}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Input label="Amount (before GST)" required type="number" inputMode="decimal" min={0} value={p.amount || ''} onChange={(ev) => setPay(i, { amount: Number(ev.target.value) })}
                      hint={p.amount ? `With GST ${inr(withGst(p.amount))}${i === 0 && f.totalQuoted ? ` · ${advPct}% of total` : ''}` : undefined} error={tried && !(p.amount > 0) ? 'Required' : undefined} />
                    <Input label="Date" required type="date" value={p.date} onChange={(ev) => setPay(i, { date: ev.target.value })} />
                    <Select label="Mode" value={p.mode} onChange={(ev) => setPay(i, { mode: ev.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</Select>
                    <div className="sm:col-span-3">
                      <FileField label={i === 0 ? 'Attachment of receiving the payment' : 'Payment proof (optional)'} required={i === 0} accept={DOC_TYPES} acceptLabel="Screenshot or PDF"
                        value={p.proof} onChange={(proof) => setPay(i, { proof })} error={tried && i === 0 && !p.proof ? 'Attach the payment proof' : undefined} />
                    </div>
                  </div>
                </div>
              ))}
              {!existing && <Button type="button" variant="soft" icon={Plus} onClick={() => set('payments', [...f.payments, { amount: 0, date: today(), mode: 'UPI' }])}>Add payment part</Button>}
              {existing && <p className="text-sm text-mute">Payments are added from the CRM entry page (Balance payment).</p>}
            </div>
          </Card>

          <Block title="Closing & remarks" icon={MessageSquareText}>
            <Select label="Lead closed by" required value={f.closedBy} onChange={(ev) => set('closedBy', ev.target.value)}>
              {closers.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me.id ? ' (me)' : ''}</option>)}
              {!closers.some((u) => u.id === me.id) && <option value={me.id}>{me.name} (me)</option>}
            </Select>
            {!existing && !isTL && (
              <Select label="Send to team leader" required value={f.teamLeadId ?? ''} onChange={(ev) => set('teamLeadId', ev.target.value)} hint="They give the first approval.">
                <option value="">— Select —</option>{tls.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me.teamLeadId ? ' (my team leader)' : ''}</option>)}
              </Select>
            )}
            <Textarea label="Remarks" required rows={3} value={f.remarks} error={e.remarks} onChange={(ev) => set('remarks', ev.target.value)} className="sm:col-span-2" placeholder="What was agreed with the client, special conditions, next steps…" />
            {!existing && <Textarea label="Notes for approvers" rows={2} value={f.note ?? ''} onChange={(ev) => set('note', ev.target.value)} className="sm:col-span-2" />}
          </Block>

          {!existing && (
            <Card className="overflow-hidden">
              <CardHeader title="Company documents" subtitle="Optional — company PAN card, GSTIN, CRM / QT / Agreement" icon={FileText} />
              <div className="p-5"><DocUploader value={docs} onChange={setDocs} categories={COMPANY_DOCS} label="Documents" /></div>
            </Card>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="overflow-hidden">
            <CardHeader title="Summary" icon={Calculator} />
            <div className="space-y-2.5 p-5 text-sm">
              {rows.filter((r) => r.s).map((r, i) => <Row key={i} k={r.s!.name} v={r.price ? inr(r.price) : <span className="text-mute">—</span>} />)}
              {f.combo && <Row k="Combo until" v={fmtDate(comboEnd)} />}
              <div className="my-2 border-t border-dashed border-line" />
              <Row k="Total quoted" v={inr(f.totalQuoted || 0)} />
              <Row k={`GST ${gstRate}%`} v={inr(quoteGst - (f.totalQuoted || 0))} />
              <Row k="Quoted with GST" v={<b>{inr(quoteGst)}</b>} />
              {!existing && <>
                <div className="my-2 border-t border-dashed border-line" />
                <Row k={`Advance (part 1) · ${advPct}%`} v={inr(part1)} />
                <Row k="Advance with GST" v={<b className="text-ok">{inr(withGst(part1))}</b>} />
                {f.payments.length > 1 && <Row k={`All ${f.payments.length} parts with GST`} v={inr(withGst(paid))} />}
                <Row k="Balance due" v={<b className="text-bad">{inr(Math.max(0, quoteGst - withGst(paid)))}</b>} />
                <Row k="Success fee" v={f.successFee.value ? (f.successFee.type === 'PCT' ? `${f.successFee.value}%` : inr(f.successFee.value)) : 'None (0)'} />
              </>}
            </div>
            <div className="border-t border-line p-4">
              <Button variant="accent" size="lg" className="w-full" icon={existing ? Save : Send} onClick={submit}>{existing ? 'Save changes' : isTL ? 'Submit to Accounts' : 'Submit to team leader'}</Button>
              {!existing && <p className="mt-2 text-center text-[11px] text-mute">Chain: Team Leader → Accounts → Legal → Operations → Admin → Ops approval</p>}
            </div>
          </Card>
          {!existing && <p className="mt-3 flex items-center gap-1.5 px-1 text-[11px] text-mute"><IndianRupee className="size-3" />Deadline {fmtDate(f.combo ? comboEnd : ymd(addDays(new Date(), 30)))} · saved with today's date and time</p>}
        </aside>
      </div>
    </div>
  )
}

function Block({ title, icon, children }: { title: string; icon: typeof Briefcase; children: ReactNode }) {
  return <Card className="overflow-hidden"><CardHeader title={title} icon={icon} /><div className="grid gap-4 p-5 sm:grid-cols-2">{children}</div></Card>
}
function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-mute">{k}</span><span className="shrink-0 text-right">{v}</span></div>
}
