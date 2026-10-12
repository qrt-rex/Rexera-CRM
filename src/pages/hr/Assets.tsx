import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, Download, History, IndianRupee, Laptop, MoreHorizontal, Package, PackageCheck, Pencil, Plus, Receipt,
  RotateCcw, ShieldAlert, Trash2, UserCheck, Wrench,
} from 'lucide-react'
import type { Asset, Expense, StockItem } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import {
  ASSET_CATEGORIES, ASSET_STATUS, assignAsset, deleteAsset, deleteExpense, deleteStockItem, EXPENSE_CATEGORIES, lowStock, moveStock, PAID_VIA, returnAsset,
  saveAsset, saveExpense, saveStockItem, setAssetStatus, STOCK_CATEGORIES, warrantyEndingSoon, type AssetInput, type ExpenseInput, type StockInput,
} from '../../lib/assets'
import { DOC_TYPES } from '../../lib/files'
import { downloadCsv, fmtDate, fmtDateTime, inr, today, ymd } from '../../lib/format'
import { FileField, FileLink } from '../../components/FileField'
import { Avatar, Badge, Button, Card, CardHeader, cx, EmptyState, Input, Menu, MenuItem, Modal, PageHeader, SearchBox, Select, Table, Tabs, Td, Textarea, Th, useConfirm, useRun } from '../../components/ui'
import { MiniStat } from '../dashboards/widgets'

type Tab = 'assets' | 'inventory' | 'expenses'

export default function Assets() {
  const [params, setParams] = useSearchParams()
  const tab = (['assets', 'inventory', 'expenses'].includes(params.get('tab') ?? '') ? params.get('tab') : 'assets') as Tab
  const db = useDb()
  return (
    <div>
      <PageHeader title="Assets & Expenses" subtitle="Company assets handed to employees, office inventory and day-to-day expenses" icon={Package}
        actions={<Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
          { id: 'assets', label: 'Assets', icon: Laptop, count: (db.assets ?? []).filter((a) => a.status !== 'RETIRED').length },
          { id: 'inventory', label: 'Inventory', icon: Boxes, count: (db.stock ?? []).filter(lowStock).length || undefined },
          { id: 'expenses', label: 'Expenses', icon: Receipt },
        ]} />} />
      {tab === 'assets' ? <AssetsTab /> : tab === 'inventory' ? <InventoryTab /> : <ExpensesTab />}
    </div>
  )
}

// ================================================================== assets
const blankAsset: AssetInput = { name: '', category: 'Laptop', condition: 'NEW' }

function AssetsTab() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [status, setStatus] = useState('')
  const [edit, setEdit] = useState<{ id?: string; f: AssetInput } | null>(null)
  const [assign, setAssign] = useState<Asset | null>(null)
  const [statusFor, setStatusFor] = useState<{ a: Asset; to: 'REPAIR' | 'RETIRED' } | null>(null)
  const [historyOf, setHistoryOf] = useState<Asset | null>(null)
  const all = db.assets ?? []
  const people = db.users.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name))
  const list = useMemo(() => all.filter((a) => (!cat || a.category === cat) && (!status || a.status === status)
    && (!q || `${a.tag} ${a.name} ${a.brand ?? ''} ${a.model ?? ''} ${a.serial ?? ''} ${db.users.find((u) => u.id === a.assignedTo)?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [all, cat, status, q, db.users])
  const live = all.filter((a) => a.status !== 'RETIRED')
  const value = live.reduce((s, a) => s + (a.cost ?? 0), 0)
  const soon = all.filter((a) => warrantyEndingSoon(a))
  const who = (id?: string) => db.users.find((u) => u.id === id)

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MiniStat label="Assets in use" value={live.length} icon={Laptop} />
        <MiniStat label="With employees" value={all.filter((a) => a.status === 'ASSIGNED').length} icon={UserCheck} tone="blue" />
        <MiniStat label="In stock" value={all.filter((a) => a.status === 'IN_STOCK').length} icon={PackageCheck} tone="green" />
        <MiniStat label="Under repair" value={all.filter((a) => a.status === 'REPAIR').length} icon={Wrench} tone="amber" />
        <MiniStat label="Total value" value={inr(value)} icon={IndianRupee} tone="violet" />
      </div>
      {soon.length > 0 && <p className="mb-4 flex items-center gap-2 rounded-xl bg-warn-soft px-4 py-2 text-sm text-warn"><ShieldAlert className="size-4" />Warranty ends within 30 days: {soon.map((a) => `${a.tag} ${a.name} (${fmtDate(a.warrantyUntil)})`).join(', ')}</p>}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <SearchBox value={q} onChange={setQ} placeholder="Search tag, item, serial, employee…" className="min-w-56 flex-1" />
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category" className="h-10 rounded-xl border border-line bg-card px-3 text-sm"><option value="">All categories</option>{ASSET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="h-10 rounded-xl border border-line bg-card px-3 text-sm"><option value="">All statuses</option>{Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          <Button variant="outline" icon={Download} onClick={() => downloadCsv(`assets-${today()}.csv`, list.map((a) => ({ tag: a.tag, item: a.name, category: a.category, brand: a.brand ?? '', model: a.model ?? '', serial: a.serial ?? '', status: ASSET_STATUS[a.status].label, assigned_to: who(a.assignedTo)?.name ?? '', assigned_on: a.assignedOn ?? '', cost: a.cost ?? '', purchase_date: a.purchaseDate ?? '', vendor: a.vendor ?? '', warranty_until: a.warrantyUntil ?? '', location: a.location ?? '', condition: a.condition ?? '' })))}>Export</Button>
          <Button variant="accent" icon={Plus} onClick={() => setEdit({ f: { ...blankAsset, purchaseDate: today() } })}>Add asset</Button>
        </div>
        {!list.length ? <EmptyState icon={Laptop} title={all.length ? 'No assets match' : 'No assets yet'} text={all.length ? 'Try another filter.' : 'Add laptops, phones, SIM cards, furniture… then hand them to employees.'} /> : (
          <Table>
            <thead><tr><Th>Tag</Th><Th>Item</Th><Th>Category</Th><Th>With</Th><Th>Status</Th><Th className="text-right">Cost</Th><Th>Warranty</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {list.map((a) => {
                const u = who(a.assignedTo)
                return (
                  <tr key={a.id} className="hover:bg-card2/60">
                    <Td className="whitespace-nowrap font-mono text-xs font-semibold">{a.tag}</Td>
                    <Td><span className="block font-semibold">{a.name}</span><span className="text-[11px] text-mute">{[a.brand, a.model].filter(Boolean).join(' ')}{a.serial ? ` · S/N ${a.serial}` : ''}</span></Td>
                    <Td className="text-xs">{a.category}</Td>
                    <Td>{u ? <span className="flex items-center gap-2"><Avatar name={u.name} photo={u.photo} size={26} /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{u.name}</span><span className="text-[11px] text-mute">since {fmtDate(a.assignedOn)}</span></span></span> : <span className="text-xs text-mute">{a.location || '—'}</span>}</Td>
                    <Td><Badge tone={ASSET_STATUS[a.status].tone}>{ASSET_STATUS[a.status].label}</Badge></Td>
                    <Td className="text-right tabular-nums">{a.cost != null ? inr(a.cost) : '—'}</Td>
                    <Td className={cx('whitespace-nowrap text-xs', warrantyEndingSoon(a) ? 'font-semibold text-warn' : a.warrantyUntil && a.warrantyUntil < today() ? 'text-mute line-through' : '')}>{a.warrantyUntil ? fmtDate(a.warrantyUntil) : '—'}</Td>
                    <Td className="text-right"><span className="inline-flex items-center gap-1">
                      {a.status === 'ASSIGNED'
                        ? <Button size="sm" variant="outline" icon={RotateCcw} onClick={async () => { if (await confirm(`Take back ${a.tag}?`, `${a.name} returns to stock from ${u?.name}.`)) run(() => returnAsset(me, a.id), 'Returned to stock') }}>Return</Button>
                        : a.status === 'IN_STOCK' ? <Button size="sm" variant="soft" icon={UserCheck} onClick={() => setAssign(a)}>Assign</Button> : null}
                      <Menu width="w-52" trigger={(o) => <Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label={`More for ${a.tag}`} aria-expanded={o} />}>
                        {(close) => <>
                          <MenuItem icon={Pencil} onClick={() => { close(); setEdit({ id: a.id, f: { ...a } }) }}>Edit</MenuItem>
                          <MenuItem icon={History} onClick={() => { close(); setHistoryOf(a) }}>History</MenuItem>
                          {a.status === 'ASSIGNED' && <MenuItem icon={UserCheck} onClick={() => { close(); setAssign(a) }}>Hand to someone else</MenuItem>}
                          {a.status !== 'REPAIR' && a.status !== 'RETIRED' && <MenuItem icon={Wrench} onClick={() => { close(); setStatusFor({ a, to: 'REPAIR' }) }}>Send for repair</MenuItem>}
                          {(a.status === 'REPAIR' || a.status === 'RETIRED') && <MenuItem icon={PackageCheck} onClick={() => { close(); run(() => setAssetStatus(me, a.id, 'IN_STOCK'), 'Back in stock') }}>Back in stock</MenuItem>}
                          {a.status !== 'RETIRED' && <MenuItem icon={AlertTriangle} onClick={() => { close(); setStatusFor({ a, to: 'RETIRED' }) }}>Retire (lost / scrapped / sold)</MenuItem>}
                          <MenuItem icon={Trash2} danger onClick={async () => { close(); if (await confirm(`Delete ${a.tag}?`, 'Deleting removes it and its history. Retire it instead to keep the record.', true)) run(() => deleteAsset(me, a.id), 'Deleted') }}>Delete</MenuItem>
                        </>}
                      </Menu>
                    </span></Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {edit && <AssetForm init={edit.f} id={edit.id} onClose={() => setEdit(null)} />}
      {assign && <AssignModal a={assign} people={people} onClose={() => setAssign(null)} />}
      {statusFor && <StatusModal a={statusFor.a} to={statusFor.to} onClose={() => setStatusFor(null)} />}
      <Modal open={!!historyOf} onClose={() => setHistoryOf(null)} title={historyOf ? `${historyOf.tag} · ${historyOf.name}` : ''} subtitle="History">
        <ol className="space-y-3">
          {(all.find((x) => x.id === historyOf?.id)?.history ?? []).map((h, i) => (
            <li key={i} className="flex gap-3 text-sm"><span className={cx('mt-1.5 size-2 shrink-0 rounded-full', i ? 'bg-line' : 'bg-accent')} />
              <span><b>{({ ADDED: 'Added', ASSIGNED: 'Assigned', RETURNED: 'Returned', REPAIR: 'Sent for repair', RETIRED: 'Retired', BACK_IN_STOCK: 'Back in stock', EDITED: 'Edited' } as const)[h.action]}</b>{h.userId ? ` · ${who(h.userId)?.name ?? '—'}` : ''}{h.note ? ` — ${h.note}` : ''}
                <span className="block text-[11px] text-mute">{who(h.by)?.name ?? '—'} · {fmtDateTime(h.at)}</span></span></li>
          ))}
        </ol>
      </Modal>
      {confirmNode}
    </>
  )
}

function AssetForm({ init, id, onClose }: { init: AssetInput; id?: string; onClose: () => void }) {
  const me = useMe()
  const run = useRun()
  const [f, setF] = useState<AssetInput>(init)
  const set = (p: Partial<AssetInput>) => setF({ ...f, ...p })
  return (
    <Modal open onClose={onClose} title={id ? 'Edit asset' : 'Add asset'} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={async () => { if (await run(() => saveAsset(me, f, id), id ? 'Asset saved' : 'Asset added')) onClose() }}>{id ? 'Save' : 'Add asset'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Item" required value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Dell Latitude laptop" />
        <Select label="Category" value={f.category} onChange={(e) => set({ category: e.target.value })}>{ASSET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
        <Input label="Brand" value={f.brand ?? ''} onChange={(e) => set({ brand: e.target.value })} />
        <Input label="Model" value={f.model ?? ''} onChange={(e) => set({ model: e.target.value })} />
        <Input label="Serial / IMEI / SIM number" value={f.serial ?? ''} onChange={(e) => set({ serial: e.target.value })} />
        <Select label="Condition" value={f.condition ?? 'GOOD'} onChange={(e) => set({ condition: e.target.value as Asset['condition'] })}><option value="NEW">New</option><option value="GOOD">Good</option><option value="FAIR">Fair</option><option value="POOR">Poor</option></Select>
        <Input label="Purchase date" type="date" max={today()} value={f.purchaseDate ?? ''} onChange={(e) => set({ purchaseDate: e.target.value })} />
        <Input label="Cost (₹)" type="number" min={0} value={f.cost ?? ''} onChange={(e) => set({ cost: e.target.value === '' ? undefined : Number(e.target.value) })} />
        <Input label="Vendor" value={f.vendor ?? ''} onChange={(e) => set({ vendor: e.target.value })} />
        <Input label="Warranty until" type="date" value={f.warrantyUntil ?? ''} onChange={(e) => set({ warrantyUntil: e.target.value })} />
        <Input label="Location / branch" value={f.location ?? ''} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Ahmedabad office" className="sm:col-span-2" />
        <div className="sm:col-span-2"><FileField label="Purchase invoice" accept={DOC_TYPES} acceptLabel="PDF or photo" value={f.invoice} onChange={(invoice) => set({ invoice })} /></div>
        <Textarea label="Notes" rows={2} value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} className="sm:col-span-2" />
      </div>
    </Modal>
  )
}

function AssignModal({ a, people, onClose }: { a: Asset; people: { id: string; name: string; department: string }[]; onClose: () => void }) {
  const me = useMe()
  const run = useRun()
  const [userId, setUserId] = useState('')
  const [on, setOn] = useState(today())
  const [note, setNote] = useState('')
  return (
    <Modal open onClose={onClose} title={`Assign ${a.tag}`} subtitle={`${a.name}${a.serial ? ` · S/N ${a.serial}` : ''}`} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon={UserCheck} disabled={!userId} onClick={async () => { if (await run(() => assignAsset(me, a.id, userId, note, on), 'Asset assigned — the employee is notified')) onClose() }}>Assign</Button></>}>
      <div className="grid gap-4">
        <Select label="Employee" required value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">— Select —</option>{people.filter((u) => u.id !== a.assignedTo).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.department}</option>)}
        </Select>
        <Input label="Handed over on" type="date" max={today()} value={on} onChange={(e) => setOn(e.target.value)} />
        <Textarea label="Note (accessories, condition…)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. with charger and bag" />
      </div>
    </Modal>
  )
}

function StatusModal({ a, to, onClose }: { a: Asset; to: 'REPAIR' | 'RETIRED'; onClose: () => void }) {
  const me = useMe()
  const run = useRun()
  const [note, setNote] = useState('')
  return (
    <Modal open onClose={onClose} title={to === 'REPAIR' ? `Send ${a.tag} for repair` : `Retire ${a.tag}`} subtitle={a.name} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={to === 'RETIRED' ? 'danger' : 'primary'} onClick={async () => { if (await run(() => setAssetStatus(me, a.id, to, note), to === 'REPAIR' ? 'Marked under repair' : 'Asset retired')) onClose() }}>{to === 'REPAIR' ? 'Send for repair' : 'Retire'}</Button></>}>
      {a.assignedTo && <p className="mb-3 rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">It is taken back from the employee first.</p>}
      <Textarea label={to === 'REPAIR' ? 'What is wrong? (where it went)' : 'Why? (lost, scrapped, sold…)'} required rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  )
}

// ================================================================== inventory
function InventoryTab() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<{ id?: string; f: StockInput } | null>(null)
  const [moveFor, setMoveFor] = useState<{ s: StockItem; dir: 1 | -1 } | null>(null)
  const items = db.stock ?? []
  const list = items.filter((s) => !q || `${s.name} ${s.category} ${s.location ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(lowStock(b)) - Number(lowStock(a)) || a.name.localeCompare(b.name))
  const recent = items.flatMap((s) => s.moves.map((m) => ({ ...m, item: s }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12)
  const name = (id?: string) => db.users.find((u) => u.id === id)?.name ?? '—'
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MiniStat label="Items" value={items.length} icon={Boxes} />
        <MiniStat label="Low on stock" value={items.filter(lowStock).length} icon={AlertTriangle} tone="red" />
        <MiniStat label="Stock value" value={inr(items.reduce((s, i) => s + i.qty * (i.unitCost ?? 0), 0))} icon={IndianRupee} tone="violet" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap gap-2 border-b border-line p-4">
            <SearchBox value={q} onChange={setQ} placeholder="Search items…" className="min-w-56 flex-1" />
            <Button variant="accent" icon={Plus} onClick={() => setEdit({ f: { name: '', category: STOCK_CATEGORIES[0]!, unit: 'pcs', minQty: 5, openingQty: 0 } })}>Add item</Button>
          </div>
          {!list.length ? <EmptyState icon={Boxes} title={items.length ? 'No items match' : 'No inventory yet'} text={items.length ? undefined : 'Add stationery, pantry, toner… and track what comes in and goes out.'} /> : (
            <Table>
              <thead><tr><Th>Item</Th><Th>Category</Th><Th className="text-right">In stock</Th><Th className="text-right">Low at</Th><Th>Location</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className={cx('hover:bg-card2/60', lowStock(s) && 'bg-bad-soft/30')}>
                    <Td><span className="font-semibold">{s.name}</span>{s.unitCost != null && <span className="block text-[11px] text-mute">{inr(s.unitCost)} / {s.unit}</span>}</Td>
                    <Td className="text-xs">{s.category}</Td>
                    <Td className="text-right"><b className={cx('tabular-nums', lowStock(s) && 'text-bad')}>{s.qty}</b> <span className="text-xs text-mute">{s.unit}</span>{lowStock(s) && <Badge tone="red" className="ml-2">Low</Badge>}</Td>
                    <Td className="text-right text-xs text-mute">{s.minQty}</Td>
                    <Td className="text-xs">{s.location || '—'}</Td>
                    <Td className="text-right"><span className="inline-flex gap-1">
                      <Button size="sm" variant="soft" icon={ArrowDownToLine} onClick={() => setMoveFor({ s, dir: 1 })}>In</Button>
                      <Button size="sm" variant="outline" icon={ArrowUpFromLine} disabled={s.qty === 0} onClick={() => setMoveFor({ s, dir: -1 })}>Out</Button>
                      <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${s.name}`} onClick={() => setEdit({ id: s.id, f: { name: s.name, category: s.category, unit: s.unit, minQty: s.minQty, unitCost: s.unitCost, location: s.location } })} />
                      <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${s.name}`} className="text-bad" onClick={async () => { if (await confirm(`Delete ${s.name}?`, 'Its stock history is removed too.', true)) run(() => deleteStockItem(me, s.id), 'Deleted') }} />
                    </span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="self-start overflow-hidden">
          <CardHeader title="Recent movements" icon={History} />
          <ul className="max-h-[60vh] divide-y divide-line/70 overflow-y-auto">
            {recent.map((m, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className={cx('w-12 shrink-0 text-right font-bold tabular-nums', m.qty > 0 ? 'text-ok' : 'text-bad')}>{m.qty > 0 ? '+' : ''}{m.qty}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{m.item.name}</span>
                  <span className="block truncate text-[11px] text-mute">{m.issuedTo ? `to ${name(m.issuedTo)} · ` : ''}{m.note ? `${m.note} · ` : ''}{name(m.by)} · {fmtDateTime(m.at)}</span></span>
              </li>
            ))}
            {!recent.length && <li className="px-5 py-6 text-center text-sm text-mute">No movements yet.</li>}
          </ul>
        </Card>
      </div>
      {edit && <StockForm init={edit.f} id={edit.id} onClose={() => setEdit(null)} />}
      {moveFor && <MoveModal s={moveFor.s} dir={moveFor.dir} onClose={() => setMoveFor(null)} />}
      {confirmNode}
    </>
  )
}

function StockForm({ init, id, onClose }: { init: StockInput; id?: string; onClose: () => void }) {
  const me = useMe()
  const run = useRun()
  const [f, setF] = useState<StockInput>(init)
  const set = (p: Partial<StockInput>) => setF({ ...f, ...p })
  return (
    <Modal open onClose={onClose} title={id ? 'Edit item' : 'Add inventory item'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={async () => { if (await run(() => saveStockItem(me, f, id), 'Saved')) onClose() }}>{id ? 'Save' : 'Add item'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Item" required value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. A4 paper" className="sm:col-span-2" />
        <Select label="Category" value={f.category} onChange={(e) => set({ category: e.target.value })}>{STOCK_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
        <Input label="Unit" required value={f.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="pcs, box, ream, kg" />
        {!id && <Input label="Opening quantity" type="number" min={0} value={f.openingQty ?? 0} onChange={(e) => set({ openingQty: Number(e.target.value) })} />}
        <Input label="Warn when stock is at or below" type="number" min={0} value={f.minQty} onChange={(e) => set({ minQty: Number(e.target.value) })} />
        <Input label="Unit cost (₹)" type="number" min={0} value={f.unitCost ?? ''} onChange={(e) => set({ unitCost: e.target.value === '' ? undefined : Number(e.target.value) })} />
        <Input label="Location" value={f.location ?? ''} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Store room" />
      </div>
    </Modal>
  )
}

function MoveModal({ s, dir, onClose }: { s: StockItem; dir: 1 | -1; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const [to, setTo] = useState('')
  return (
    <Modal open onClose={onClose} title={dir > 0 ? `Stock in · ${s.name}` : `Stock out · ${s.name}`} subtitle={`${s.qty} ${s.unit} in stock now`} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={async () => { if (await run(() => moveStock(me, s.id, dir * Math.round(qty), note, to || undefined), dir > 0 ? 'Stock added' : 'Stock issued')) onClose() }}>{dir > 0 ? 'Add to stock' : 'Take out'}</Button></>}>
      <div className="grid gap-4">
        <Input label={`Quantity (${s.unit})`} type="number" min={1} max={dir < 0 ? s.qty : undefined} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        {dir < 0 && <Select label="Issued to (optional)" value={to} onChange={(e) => setTo(e.target.value)}><option value="">— Nobody specific —</option>{db.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
        <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={dir > 0 ? 'e.g. bought from vendor, bill no.' : 'e.g. for client meeting'} />
      </div>
    </Modal>
  )
}

// ================================================================== expenses
function ExpensesTab() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const [month, setMonth] = useState(today().slice(0, 7))
  const [cat, setCat] = useState('')
  const [edit, setEdit] = useState<{ id?: string; f: ExpenseInput } | null>(null)
  const all = db.expenses ?? []
  const inMonth = all.filter((e) => e.date.startsWith(month))
  const list = inMonth.filter((e) => !cat || e.category === cat).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  const total = (xs: Expense[]) => xs.reduce((s, e) => s + e.amount + e.gst, 0)
  const byCat = EXPENSE_CATEGORIES.map((c) => ({ c, v: total(inMonth.filter((e) => e.category === c)) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)
  const max = Math.max(1, ...byCat.map((x) => x.v))
  // local date maths (toISOString would shift to UTC and land on the wrong month in India)
  const prevMonth = (() => { const d = new Date(month + '-01T00:00:00'); d.setMonth(d.getMonth() - 1); return ymd(d).slice(0, 7) })()
  const prev = total(all.filter((e) => e.date.startsWith(prevMonth)))
  const name = (id?: string) => db.users.find((u) => u.id === id)?.name ?? '—'
  const monthLabel = new Date(month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label={`Spent in ${monthLabel}`} value={inr(total(inMonth))} icon={IndianRupee} tone="violet" />
        <MiniStat label="GST paid" value={inr(inMonth.reduce((s, e) => s + e.gst, 0))} icon={Receipt} tone="blue" />
        <MiniStat label="Entries" value={inMonth.length} icon={Receipt} />
        <MiniStat label="vs last month" value={prev ? `${total(inMonth) >= prev ? '+' : ''}${Math.round(((total(inMonth) - prev) / prev) * 100)}%` : '—'} icon={History} tone={total(inMonth) > prev ? 'red' : 'green'} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap gap-2 border-b border-line p-4">
            <input type="month" value={month} max={today().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" className="h-10 rounded-xl border border-line bg-card px-3 text-sm" />
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category" className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-sm"><option value="">All categories</option>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            <Button variant="outline" icon={Download} onClick={() => downloadCsv(`expenses-${month}.csv`, list.map((e) => ({ date: e.date, category: e.category, description: e.description, vendor: e.vendor ?? '', amount: e.amount, gst: e.gst, total: e.amount + e.gst, paid_via: PAID_VIA[e.paidVia], paid_by: name(e.paidBy), bill: e.bill?.name ?? '', added_by: name(e.by) })))}>Export</Button>
            <Button variant="accent" icon={Plus} onClick={() => setEdit({ f: { date: today(), category: 'Office supplies', description: '', amount: 0, gst: 0, paidVia: 'UPI' } })}>Add expense</Button>
          </div>
          {!list.length ? <EmptyState icon={Receipt} title={`No expenses in ${monthLabel}`} text="Record rent, bills, supplies, travel… with the bill attached." /> : (
            <Table>
              <thead><tr><Th>Date</Th><Th>Expense</Th><Th>Category</Th><Th className="text-right">Amount</Th><Th>Paid</Th><Th>Bill</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} className="hover:bg-card2/60">
                    <Td className="whitespace-nowrap text-xs">{fmtDate(e.date)}</Td>
                    <Td><span className="block font-semibold">{e.description}</span>{e.vendor && <span className="text-[11px] text-mute">{e.vendor}</span>}</Td>
                    <Td className="text-xs">{e.category}</Td>
                    <Td className="whitespace-nowrap text-right"><b className="tabular-nums">{inr(e.amount + e.gst)}</b>{e.gst > 0 && <span className="block text-[11px] text-mute">incl. GST {inr(e.gst)}</span>}</Td>
                    <Td className="text-xs">{PAID_VIA[e.paidVia]}{e.paidBy ? <span className="block text-mute">by {name(e.paidBy)}</span> : null}</Td>
                    <Td>{e.bill ? <FileLink file={e.bill} label="View" /> : <span className="text-xs text-mute">—</span>}</Td>
                    <Td className="text-right"><span className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit expense" onClick={() => setEdit({ id: e.id, f: { ...e } })} />
                      <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete expense" className="text-bad" onClick={async () => { if (await confirm('Delete this expense?', `${e.description} · ${inr(e.amount + e.gst)}`, true)) run(() => deleteExpense(me, e.id), 'Deleted') }} />
                    </span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="self-start overflow-hidden">
          <CardHeader title="Where the money went" subtitle={monthLabel} icon={IndianRupee} />
          <ul className="space-y-3 p-5">
            {byCat.map((x) => (
              <li key={x.c}>
                <div className="mb-1 flex justify-between text-xs"><button className="font-semibold hover:underline" onClick={() => setCat(cat === x.c ? '' : x.c)}>{x.c}</button><span className="tabular-nums">{inr(x.v)}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-card2"><div className="h-full rounded-full bg-brand" style={{ width: `${(x.v / max) * 100}%` }} /></div>
              </li>
            ))}
            {!byCat.length && <li className="text-center text-sm text-mute">Nothing spent this month.</li>}
          </ul>
        </Card>
      </div>
      {edit && <ExpenseForm init={edit.f} id={edit.id} onClose={() => setEdit(null)} />}
      {confirmNode}
    </>
  )
}

function ExpenseForm({ init, id, onClose }: { init: ExpenseInput; id?: string; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [f, setF] = useState<ExpenseInput>(init)
  const set = (p: Partial<ExpenseInput>) => setF({ ...f, ...p })
  return (
    <Modal open onClose={onClose} title={id ? 'Edit expense' : 'Add expense'} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={async () => { if (await run(() => saveExpense(me, f, id), 'Expense saved')) onClose() }}>{id ? 'Save' : 'Add expense'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Date" type="date" required max={today()} value={f.date} onChange={(e) => set({ date: e.target.value })} />
        <Select label="Category" value={f.category} onChange={(e) => set({ category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
        <Input label="Description" required value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Office internet — October" className="sm:col-span-2" />
        <Input label="Amount before GST (₹)" type="number" min={0} required value={f.amount || ''} onChange={(e) => set({ amount: Number(e.target.value) })} />
        <Input label="GST (₹)" type="number" min={0} value={f.gst || ''} onChange={(e) => set({ gst: Number(e.target.value) })} hint={f.amount > 0 ? `Total ${inr((f.amount || 0) + (f.gst || 0))}` : undefined} />
        <Input label="Vendor / paid to" value={f.vendor ?? ''} onChange={(e) => set({ vendor: e.target.value })} />
        <Select label="Paid via" value={f.paidVia} onChange={(e) => set({ paidVia: e.target.value as Expense['paidVia'] })}>{Object.entries(PAID_VIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select label="Paid by (if an employee paid)" value={f.paidBy ?? ''} onChange={(e) => set({ paidBy: e.target.value || undefined })} className="sm:col-span-2">
          <option value="">Company account</option>{db.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <div className="sm:col-span-2"><FileField label="Bill / receipt" accept={DOC_TYPES} acceptLabel="PDF or photo" value={f.bill} onChange={(bill) => set({ bill })} /></div>
      </div>
    </Modal>
  )
}
