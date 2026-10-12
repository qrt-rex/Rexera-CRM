import type { Asset, AssetEvent, AssetStatus, DB, Expense, StockItem, User } from './types'
import { getDb, mutate } from './store'
import { effectivePerms } from './rbac'
import { ActionError } from './actions'
import { addDays, fmtDate, nowIso, round2, today, uid, ymd } from './format'

/** Company assets (tracked one by one), inventory (counted by quantity) and expenses — managed by HR. */
export const ASSET_CATEGORIES = ['Laptop', 'Desktop', 'Monitor', 'Mobile phone', 'SIM card', 'Tablet', 'Printer / scanner', 'Networking', 'Furniture', 'Vehicle', 'Office equipment', 'Software licence', 'Other']
export const STOCK_CATEGORIES = ['Stationery', 'Printing & toner', 'Pantry', 'Cleaning', 'IT accessories', 'Marketing material', 'First aid', 'Other']
export const EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Internet & phone', 'Office supplies', 'Pantry & refreshments', 'Travel & conveyance', 'Repairs & maintenance', 'Software & subscriptions', 'Marketing & ads', 'Courier & postage', 'Professional fees', 'Bank charges', 'Staff welfare', 'Equipment purchase', 'Other']
export const PAID_VIA: Record<Expense['paidVia'], string> = { CASH: 'Cash', UPI: 'UPI', BANK: 'Bank transfer', CARD: 'Card', CHEQUE: 'Cheque' }
export const ASSET_STATUS: Record<AssetStatus, { label: string; tone: 'green' | 'blue' | 'amber' | 'gray' }> = {
  IN_STOCK: { label: 'In stock', tone: 'green' }, ASSIGNED: { label: 'Assigned', tone: 'blue' }, REPAIR: { label: 'Under repair', tone: 'amber' }, RETIRED: { label: 'Retired', tone: 'gray' },
}

function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new ActionError(msg) }
const need = (me: User) => assert(effectivePerms(getDb(), me).has('assets.manage'), "You don't have access to company assets and expenses.")
const log = (d: DB, by: string, action: string, detail: string) => { d.audit.unshift({ id: uid('a-'), at: nowIso(), by, action, detail }); if (d.audit.length > 1000) d.audit.length = 1000 }
const tell = (d: DB, userId: string, title: string, body: string) => d.notices.unshift({ id: uid('n-'), userId, title, body, link: '/notifications', at: nowIso(), read: false, kind: 'info' })
const userName = (d: DB, id?: string) => d.users.find((u) => u.id === id)?.name ?? '—'
const findAsset = (d: DB, id: string) => { const a = d.assets?.find((x) => x.id === id); assert(a, 'Asset not found.'); return a }
const event = (a: Asset, e: Omit<AssetEvent, 'at'>) => { a.history.unshift({ ...e, at: nowIso() }); if (a.history.length > 100) a.history.length = 100 }
const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v))

// ------------------------------------------------------------------ assets
export type AssetInput = Pick<Asset, 'name' | 'category'> & Partial<Pick<Asset, 'brand' | 'model' | 'serial' | 'purchaseDate' | 'cost' | 'vendor' | 'warrantyUntil' | 'location' | 'condition' | 'notes' | 'invoice'>>

function checkAsset(d: DB, i: AssetInput, id?: string) {
  assert(i.name.trim().length >= 2, 'Enter the item name.')
  assert(i.category, 'Pick a category.')
  const cost = num(i.cost)
  assert(cost === undefined || (Number.isFinite(cost) && cost >= 0), 'Cost must be 0 or more.')
  const serial = i.serial?.trim()
  if (serial) assert(!d.assets?.some((a) => a.id !== id && a.serial?.toLowerCase() === serial.toLowerCase()), `Serial number ${serial} is already on another asset.`)
}
const clean = (i: AssetInput) => ({
  ...i, name: i.name.trim(), brand: i.brand?.trim() || undefined, model: i.model?.trim() || undefined, serial: i.serial?.trim() || undefined,
  vendor: i.vendor?.trim() || undefined, location: i.location?.trim() || undefined, notes: i.notes?.trim() || undefined,
  cost: num(i.cost) !== undefined ? round2(num(i.cost)!) : undefined, purchaseDate: i.purchaseDate || undefined, warrantyUntil: i.warrantyUntil || undefined,
})

export function saveAsset(me: User, i: AssetInput, id?: string) {
  need(me)
  checkAsset(getDb(), i, id)
  return mutate((d) => {
    d.assets ??= []
    if (id) {
      const a = findAsset(d, id)
      Object.assign(a, clean(i))
      event(a, { by: me.id, action: 'EDITED' })
      log(d, me.id, 'ASSET_EDIT', `${a.tag} ${a.name}`)
      return a.id
    }
    const n = d.assets.reduce((m, a) => Math.max(m, Number(a.tag.replace(/\D/g, '')) || 0), 0) + 1
    const a: Asset = { ...clean(i), id: uid('as-'), tag: `RX-AST-${String(n).padStart(4, '0')}`, status: 'IN_STOCK', history: [], createdAt: nowIso() }
    event(a, { by: me.id, action: 'ADDED' })
    d.assets.unshift(a)
    log(d, me.id, 'ASSET_ADD', `${a.tag} ${a.name} (${a.category})`)
    return a.id
  })
}

export function assignAsset(me: User, id: string, userId: string, note = '', on = today()) {
  need(me)
  mutate((d) => {
    const a = findAsset(d, id)
    assert(a.status !== 'RETIRED', 'A retired asset cannot be assigned.')
    assert(a.status !== 'REPAIR', 'This asset is under repair — mark it back in stock first.')
    const u = d.users.find((x) => x.id === userId && x.active)
    assert(u, 'Pick an active employee.')
    assert(a.assignedTo !== userId, `${a.tag} is already with ${u.name}.`)
    if (a.assignedTo) event(a, { by: me.id, action: 'RETURNED', userId: a.assignedTo, note: `Handed over to ${u.name}` })
    a.status = 'ASSIGNED'; a.assignedTo = userId; a.assignedOn = on
    event(a, { by: me.id, action: 'ASSIGNED', userId, note: note.trim() || undefined })
    tell(d, userId, 'Company asset handed to you', `${a.name}${a.serial ? ` (S/N ${a.serial})` : ''} · ${a.tag} — please take care of it and return it when asked.`)
    log(d, me.id, 'ASSET_ASSIGN', `${a.tag} ${a.name} → ${u.name}`)
  })
}

export function returnAsset(me: User, id: string, condition?: Asset['condition'], note = '') {
  need(me)
  mutate((d) => {
    const a = findAsset(d, id)
    assert(a.status === 'ASSIGNED' && a.assignedTo, 'This asset is not assigned to anyone.')
    const from = a.assignedTo
    event(a, { by: me.id, action: 'RETURNED', userId: from, note: note.trim() || undefined })
    a.status = 'IN_STOCK'; a.assignedTo = undefined; a.assignedOn = undefined
    if (condition) a.condition = condition
    log(d, me.id, 'ASSET_RETURN', `${a.tag} ${a.name} returned by ${userName(d, from)}`)
  })
}

/** Under repair, retired (lost / scrapped / sold), or back in stock. */
export function setAssetStatus(me: User, id: string, status: 'REPAIR' | 'RETIRED' | 'IN_STOCK', note = '') {
  need(me)
  assert(status === 'IN_STOCK' || note.trim().length >= 3, status === 'RETIRED' ? 'Say why it is retired (lost, scrapped, sold…).' : 'Say what is wrong with it.')
  mutate((d) => {
    const a = findAsset(d, id)
    assert(a.status !== status, 'It already has that status.')
    if (a.assignedTo) { event(a, { by: me.id, action: 'RETURNED', userId: a.assignedTo }); a.assignedTo = undefined; a.assignedOn = undefined }
    a.status = status
    event(a, { by: me.id, action: status === 'IN_STOCK' ? 'BACK_IN_STOCK' : status, note: note.trim() || undefined })
    log(d, me.id, 'ASSET_STATUS', `${a.tag} ${a.name} → ${ASSET_STATUS[status].label}${note ? `: ${note.trim()}` : ''}`)
  })
}

export function deleteAsset(me: User, id: string) {
  need(me)
  mutate((d) => {
    const a = findAsset(d, id)
    assert(a.status !== 'ASSIGNED', `Get ${a.tag} back from ${userName(d, a.assignedTo)} first (or retire it).`)
    d.assets = d.assets!.filter((x) => x.id !== id)
    log(d, me.id, 'ASSET_DELETE', `${a.tag} ${a.name}`)
  })
}

export const warrantyEndingSoon = (a: Asset, days = 30) => !!a.warrantyUntil && a.status !== 'RETIRED' && a.warrantyUntil >= today() && a.warrantyUntil <= ymd(addDays(new Date(), days))
export const assetsOf = (d: DB, userId: string) => (d.assets ?? []).filter((a) => a.assignedTo === userId && a.status === 'ASSIGNED')

// ------------------------------------------------------------------ inventory
export type StockInput = Pick<StockItem, 'name' | 'category' | 'unit' | 'minQty'> & { unitCost?: number; location?: string; openingQty?: number }

export function saveStockItem(me: User, i: StockInput, id?: string) {
  need(me)
  assert(i.name.trim().length >= 2, 'Enter the item name.')
  assert(i.unit.trim(), 'Enter the unit (pcs, box, ream, kg…).')
  assert(Number.isFinite(i.minQty) && i.minQty >= 0, 'Low-stock level must be 0 or more.')
  assert(i.unitCost === undefined || (Number.isFinite(i.unitCost) && i.unitCost >= 0), 'Unit cost must be 0 or more.')
  const dup = getDb().stock?.find((s) => s.id !== id && s.name.trim().toLowerCase() === i.name.trim().toLowerCase())
  assert(!dup, `${i.name.trim()} is already in the inventory.`)
  return mutate((d) => {
    d.stock ??= []
    const base = { name: i.name.trim(), category: i.category, unit: i.unit.trim(), minQty: Math.round(i.minQty), unitCost: i.unitCost, location: i.location?.trim() || undefined }
    if (id) {
      const s = d.stock.find((x) => x.id === id)
      assert(s, 'Item not found.')
      Object.assign(s, base)
      log(d, me.id, 'STOCK_EDIT', s.name)
      return s.id
    }
    const opening = Math.max(0, Math.round(i.openingQty ?? 0))
    const s: StockItem = { ...base, id: uid('st-'), qty: opening, moves: opening ? [{ at: nowIso(), by: me.id, qty: opening, note: 'Opening stock' }] : [], createdAt: nowIso() }
    d.stock.unshift(s)
    log(d, me.id, 'STOCK_ADD', `${s.name} · ${opening} ${s.unit}`)
    return s.id
  })
}

/** Stock in (+) or out (−). Stock can't go below zero; issuing to an employee notes who took it. */
export function moveStock(me: User, id: string, qty: number, note = '', issuedTo?: string) {
  need(me)
  assert(Number.isInteger(qty) && qty !== 0, 'Enter a whole quantity.')
  mutate((d) => {
    const s = d.stock?.find((x) => x.id === id)
    assert(s, 'Item not found.')
    assert(s.qty + qty >= 0, `Only ${s.qty} ${s.unit} left — you can't take out ${-qty}.`)
    s.qty += qty
    s.moves.unshift({ at: nowIso(), by: me.id, qty, note: note.trim() || undefined, issuedTo: qty < 0 ? issuedTo || undefined : undefined })
    if (s.moves.length > 200) s.moves.length = 200
    log(d, me.id, qty > 0 ? 'STOCK_IN' : 'STOCK_OUT', `${s.name} ${qty > 0 ? '+' : ''}${qty} ${s.unit} → ${s.qty}${issuedTo ? ` · to ${userName(d, issuedTo)}` : ''}`)
  })
}

export function deleteStockItem(me: User, id: string) {
  need(me)
  mutate((d) => {
    const s = d.stock?.find((x) => x.id === id)
    assert(s, 'Item not found.')
    d.stock = d.stock!.filter((x) => x.id !== id)
    log(d, me.id, 'STOCK_DELETE', s.name)
  })
}
export const lowStock = (s: StockItem) => s.qty <= s.minQty

// ------------------------------------------------------------------ expenses
export type ExpenseInput = Pick<Expense, 'date' | 'category' | 'description' | 'amount' | 'gst' | 'paidVia'> & Partial<Pick<Expense, 'vendor' | 'paidBy' | 'bill'>>

export function saveExpense(me: User, i: ExpenseInput, id?: string) {
  need(me)
  assert(i.date && i.date <= today(), 'Enter the date (not in the future).')
  assert(i.category, 'Pick a category.')
  assert(i.description.trim().length >= 3, 'Describe the expense.')
  assert(Number.isFinite(i.amount) && i.amount > 0, 'Amount must be more than 0.')
  assert(Number.isFinite(i.gst) && i.gst >= 0 && i.gst <= i.amount, 'GST must be between 0 and the amount.')
  return mutate((d) => {
    d.expenses ??= []
    const base = { date: i.date, category: i.category, description: i.description.trim(), amount: round2(i.amount), gst: round2(i.gst), paidVia: i.paidVia, vendor: i.vendor?.trim() || undefined, paidBy: i.paidBy || undefined, bill: i.bill }
    if (id) {
      const e = d.expenses.find((x) => x.id === id)
      assert(e, 'Expense not found.')
      Object.assign(e, base)
      log(d, me.id, 'EXPENSE_EDIT', `${e.category} · ${base.description} · ₹${base.amount + base.gst}`)
      return e.id
    }
    const e: Expense = { ...base, id: uid('ex-'), by: me.id, createdAt: nowIso() }
    d.expenses.unshift(e)
    log(d, me.id, 'EXPENSE_ADD', `${e.category} · ${e.description} · ₹${e.amount + e.gst} on ${fmtDate(e.date)}`)
    return e.id
  })
}

export function deleteExpense(me: User, id: string) {
  need(me)
  mutate((d) => {
    const e = d.expenses?.find((x) => x.id === id)
    assert(e, 'Expense not found.')
    d.expenses = d.expenses!.filter((x) => x.id !== id)
    log(d, me.id, 'EXPENSE_DELETE', `${e.category} · ${e.description} · ₹${e.amount + e.gst}`)
  })
}
