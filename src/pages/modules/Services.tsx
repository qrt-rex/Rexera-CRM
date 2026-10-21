import { useMemo, useState } from 'react'
import { Layers, Package, Pencil, Plus } from 'lucide-react'
import type { BookingType, Service } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { needsPriceSplit, saveService } from '../../lib/actions'
import { BOOKING_TYPES, COMBO_PACKAGES, comboCap, isFundingService, priceFor } from '../../lib/catalog'
import { inr } from '../../lib/format'
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, Input, Modal, PageHeader, SearchBox, Select, Table, Td, Th, useRun } from '../../components/ui'

const PRICE_TYPES = BOOKING_TYPES.filter((t) => t.id !== 'SINGLE')

/** Services with a price for each booking type, and the combo packages (Basic / Standard / Premium / Enterprise). */
export default function Services() {
  const db = useDb()
  const { can } = useAuth()
  const manage = can('schemes.manage')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [edit, setEdit] = useState<{ id?: string; s: Omit<Service, 'id'> } | null>(null)
  const cats = useMemo(() => [...new Set(db.services.map((s) => s.category))].sort(), [db.services])
  const list = db.services.filter((s) => (!cat || s.category === cat) && (!q || `${s.name} ${s.category}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  return (
    <div>
      <PageHeader title="Services" subtitle="Price for each booking type · price bifurcation is compulsory except for funding services" icon={Layers}
        actions={manage && <Button variant="accent" icon={Plus} onClick={() => setEdit({ s: { name: '', category: cats[0] ?? '', price: 0, gstRate: 18, deduction: 0, active: true } })}>Add service</Button>} />

      <Card className="mb-6 overflow-hidden">
        <CardHeader title="Application Support combo packages" subtitle="More applications, more opportunities — booked as Combo 3 / 6 / 9 / 12 months on a CRM entry" icon={Package} />
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          {([3, 6, 9, 12] as const).map((m, i) => {
            const p = COMBO_PACKAGES[m]
            const tone = ['bg-[#43A047]', 'bg-[#1E88E5]', 'bg-[#7E57C2]', 'bg-[#F57C00]'][i]
            return (
              <div key={m} className="overflow-hidden rounded-2xl border border-line">
                <div className={`${tone} px-4 py-3 text-white`}><p className="font-extrabold">{p.name}</p><p className="text-xs italic opacity-90">{p.tagline}</p></div>
                <dl className="space-y-1.5 p-4 text-sm">
                  <div className="flex justify-between"><dt className="text-mute">Duration</dt><dd className="font-bold">{p.months} months</dd></div>
                  <div className="flex justify-between"><dt className="text-mute">Applications</dt><dd className="font-bold">{p.minApps}–{p.maxApps}</dd></div>
                  <div className="flex justify-between"><dt className="text-mute">Additional</dt><dd className="font-bold">{p.extraPerMonth} per month</dd></div>
                  <div className="flex justify-between"><dt className="text-mute">Up to</dt><dd className="font-bold">{comboCap(p)} in all</dd></div>
                  <div className="flex justify-between border-t border-line pt-2"><dt className="text-mute">Minimum price</dt><dd className="text-base font-extrabold">{inr(p.minPrice)}</dd></div>
                </dl>
              </div>
            )
          })}
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-mute">Initial applications are submitted as per the package; after them, 2 additional applications are provided each month during the package period, subject to the agreed terms. Application support covers preparation, documentation guidance and submission.</p>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <SearchBox value={q} onChange={setQ} placeholder="Search services…" className="min-w-52 flex-1" />
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category" className="h-10 rounded-xl border border-line bg-card px-3 text-sm"><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        {!list.length ? <EmptyState icon={Layers} title="No services" /> : (
          <Table>
            <thead><tr><Th>Service</Th>{BOOKING_TYPES.map((t) => <Th key={t.id} className="text-right">{t.label.replace(' · ', ' (').replace(/months$/, 'months)')}</Th>)}<Th className="text-right">GST</Th>{manage && <Th />}</tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={s.active ? 'hover:bg-card2/60' : 'opacity-50'}>
                  <Td><span className="block font-semibold">{s.name}</span><span className="text-[11px] text-mute">{s.category}</span>
                    <span className="ml-1">{isFundingService(s) ? <Badge tone="green">funding · one price is enough</Badge> : needsPriceSplit(s) && <Badge tone="gray">price required</Badge>}</span>{!s.active && <Badge tone="red" className="ml-1">inactive</Badge>}</Td>
                  {BOOKING_TYPES.map((t) => <Td key={t.id} className="text-right tabular-nums">{t.id === 'SINGLE' || s.prices?.[t.id] != null ? inr(priceFor(s, t.id)) : <span className="text-mute" title="Same as Single">{inr(s.price)}</span>}</Td>)}
                  <Td className="text-right text-xs">{s.gstRate}%</Td>
                  {manage && <Td className="text-right"><Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${s.name}`} onClick={() => setEdit({ id: s.id, s: { ...s } })} /></Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {edit && <ServiceForm init={edit.s} id={edit.id} cats={cats} onClose={() => setEdit(null)} />}
    </div>
  )
}

function ServiceForm({ init, id, cats, onClose }: { init: Omit<Service, 'id'>; id?: string; cats: string[]; onClose: () => void }) {
  const me = useMe()
  const run = useRun()
  const [s, setS] = useState(init)
  const setPrice = (t: BookingType, v: string) => setS((x) => { const prices = { ...(x.prices ?? {}) }; if (v === '') delete prices[t]; else prices[t] = Number(v); return { ...x, prices } })
  return (
    <Modal open onClose={onClose} title={id ? `Edit ${init.name}` : 'Add service'} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={async () => { if (await run(() => saveService(me, s, id), 'Service saved')) onClose() }}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Service name" required value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} className="sm:col-span-2" />
        <Input label="Category" required value={s.category} onChange={(e) => setS({ ...s, category: e.target.value })} list="svc-cats" hint="Funding: “Government Grants & Schemes” or “Funding & Investment” (not loans)" />
        <datalist id="svc-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        <Select label="GST %" value={s.gstRate} onChange={(e) => setS({ ...s, gstRate: Number(e.target.value) })}>{[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</Select>
        <Input label="Single booking price (₹)" required type="number" min={0} value={s.price || ''} onChange={(e) => setS({ ...s, price: Number(e.target.value) })} />
        {PRICE_TYPES.map((t) => (
          <Input key={t.id} label={`${t.label} price (₹)`} type="number" min={0} value={s.prices?.[t.id] ?? ''} placeholder={`Same as single (${s.price || 0})`} onChange={(e) => setPrice(t.id, e.target.value)} />
        ))}
        <Input label="Service deduction (₹)" type="number" min={0} value={s.deduction || ''} onChange={(e) => setS({ ...s, deduction: Number(e.target.value) })} hint="Kept back from the advance (e.g. government fee)" />
        <div className="flex items-end pb-2"><Checkbox label="Active (can be picked on CRM entries)" checked={s.active} onChange={(v) => setS({ ...s, active: v })} /></div>
      </div>
    </Modal>
  )
}
