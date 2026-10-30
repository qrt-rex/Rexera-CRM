import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FilePlus2, Plus, Save, Trash2 } from 'lucide-react'
import type { Invoice, InvoiceItem } from '../lib/types'
import { useDb } from '../lib/store'
import { useAuth, useMe } from '../lib/auth'
import { createInvoice, PROFORMA_SERVICE, updateInvoice } from '../lib/actions'
import { branchList, invoiceBranch } from '../lib/branches'
import { INDIAN_STATES, addDays, gstSplit, inr, invoiceTotals, ymd } from '../lib/format'
import { Button, cx, Input, Modal, Select, Textarea, useRun, useSubmitting } from './ui'

const blankLine = (): InvoiceItem => ({ desc: '', sac: '998311', qty: 1, rate: 0, gstRate: 18 })

/**
 * New invoice, or edit one (`existing`): Accounts any invoice until it is cancelled, a sales person their own unpaid
 * proforma. Same state → CGST + SGST, otherwise IGST.
 */
export function InvoiceFormModal({ existing, onClose }: { existing?: Invoice; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const nav = useNavigate()
  const [busy, once] = useSubmitting()
  const [f, setF] = useState(() => existing
    ? { type: existing.type, client: existing.client, gstin: existing.gstin, state: existing.state, due: existing.due, remarks: existing.remarks ?? '' }
    : { type: (can('billing.manage') ? 'TAX' : 'PROFORMA') as Invoice['type'], client: '', gstin: '', state: 'Gujarat', due: ymd(addDays(new Date(), 15)), remarks: '' })
  const [items, setItems] = useState<InvoiceItem[]>(() => existing ? existing.items.map((x) => ({ ...x })) : [blankLine()])
  // issued from the creator's own branch: shown, never picked
  const branch = existing ? invoiceBranch(db, existing) : branchList(db).find((b) => b.id === me.branchId)
  const fromState = branch?.state || db.settings.supplierState
  const draft = invoiceTotals({ ...f, items, paid: 0 } as unknown as Invoice, fromState)
  const proforma = f.type === 'PROFORMA'

  const save = () => once(async () => {
    if (existing) {
      if (await run(() => updateInvoice(me, existing.id, { client: f.client, gstin: f.gstin, state: f.state, due: f.due, remarks: f.remarks, items }), 'Invoice updated')) onClose()
      return
    }
    const id = await run(() => createInvoice(me, { ...f, items }), 'Invoice created')
    if (typeof id === 'string') { onClose(); nav(`/billing/${id}`) }
  })

  return (
    <Modal open onClose={onClose} size="xl" title={existing ? `Edit ${existing.number}` : 'New invoice'}
      subtitle={`${branch ? `Issued from ${existing ? 'the branch' : 'your branch'}: ${branch.name}` : 'The branch is not set (HR → Employee Details) — the branch address is printed once it is'} · same state → CGST + SGST, otherwise IGST`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button icon={existing ? Save : FilePlus2} loading={busy} onClick={save}>{existing ? 'Save changes' : `Create ${f.type === 'TAX' ? 'tax invoice' : 'proforma'}`}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Select label="Type" value={f.type} disabled={!!existing} onChange={(e) => { const type = e.target.value as Invoice['type']; setF({ ...f, type }); if (type === 'PROFORMA') setItems((x) => [{ ...x[0]!, desc: PROFORMA_SERVICE }]) }}>
          {(can('billing.manage') || f.type === 'TAX') && <option value="TAX">Tax invoice</option>}<option value="PROFORMA">Proforma</option>
        </Select>
        <Input label="Client" required value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} className="sm:col-span-2" list="invoice-clients" />
        <datalist id="invoice-clients">{db.bookings.map((b) => <option key={b.id} value={b.companyName} />)}</datalist>
        <Input label="GSTIN" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} />
        <Select label="Place of supply" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Input label="Due date" type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
        <Textarea label="Remarks (printed on the invoice)" rows={2} maxLength={1000} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} className="sm:col-span-3" />
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-card2 text-left text-[11px] uppercase text-mute"><tr><th className="p-2">Description</th><th className="p-2">SAC</th><th className="p-2">Qty</th><th className="p-2">Rate</th><th className="p-2">GST %</th><th className="p-2 text-right">Amount</th><th /></tr></thead>
          <tbody>
            {items.map((it, i) => {
              const upd = (p: Partial<InvoiceItem>) => setItems((all) => all.map((x, j) => (j === i ? { ...x, ...p } : x)))
              const cls = 'h-9 w-full rounded-lg border border-line bg-card px-2'
              return (
                <tr key={i} className="border-t border-line">
                  <td className="p-2">{proforma
                    ? <input className={cx(cls, 'bg-card2 font-semibold')} value={PROFORMA_SERVICE} readOnly aria-label="Service (fixed on proforma invoices)" title="A proforma invoice always reads “Consultancy services”" />
                    : <input className={cls} value={it.desc} onChange={(e) => upd({ desc: e.target.value })} list="invoice-svcs" placeholder="Service" aria-label={`Description of line ${i + 1}`} />}</td>
                  <td className="w-24 p-2"><input className={cls} value={it.sac} onChange={(e) => upd({ sac: e.target.value })} aria-label={`SAC of line ${i + 1}`} /></td>
                  <td className="w-16 p-2"><input type="number" min={1} className={cls} value={it.qty} onChange={(e) => upd({ qty: Number(e.target.value) })} aria-label={`Quantity of line ${i + 1}`} /></td>
                  <td className="w-28 p-2"><input type="number" min={0} className={cls} value={it.rate || ''} placeholder="0" onChange={(e) => upd({ rate: Number(e.target.value) })} aria-label={`Rate of line ${i + 1}`} /></td>
                  <td className="w-20 p-2"><select className={cls} value={it.gstRate} onChange={(e) => upd({ gstRate: Number(e.target.value) })} aria-label={`GST of line ${i + 1}`}>{[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}</option>)}</select></td>
                  <td className="p-2 text-right tabular-nums">{inr(it.qty * it.rate + gstSplit(it.qty * it.rate, it.gstRate, f.state, fromState).tax)}</td>
                  <td className="p-2"><button type="button" aria-label="Remove line" disabled={items.length <= 1} onClick={() => setItems((all) => all.filter((_, j) => j !== i))} className="text-mute hover:text-bad disabled:opacity-30"><Trash2 className="size-4" /></button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <datalist id="invoice-svcs">{db.services.map((s) => <option key={s.id} value={s.name} />)}</datalist>
      </div>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        {proforma ? <p className="max-w-sm text-xs text-mute">A proforma invoice has one line, “{PROFORMA_SERVICE}” — enter the amount.</p>
          : <Button size="sm" variant="soft" icon={Plus} onClick={() => setItems((all) => [...all, blankLine()])}>Add line</Button>}
        <div className="w-64 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-mute">Taxable</span>{inr(draft.taxable)}</div>
          {draft.igst ? <div className="flex justify-between"><span className="text-mute">IGST</span>{inr(draft.igst)}</div> : <><div className="flex justify-between"><span className="text-mute">CGST</span>{inr(draft.cgst)}</div><div className="flex justify-between"><span className="text-mute">SGST</span>{inr(draft.sgst)}</div></>}
          <div className="flex justify-between border-t border-line pt-1 font-bold"><span>Total</span>{inr(draft.grand)}</div>
        </div>
      </div>
    </Modal>
  )
}
