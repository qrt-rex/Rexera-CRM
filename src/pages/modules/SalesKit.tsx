import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  BookMarked, BookmarkPlus, Check, ChevronDown, ChevronUp, Download, FileSpreadsheet, FolderPlus, Layers, Link2, Lock, Pencil, Plus, Save, Share2, Trash2, Upload, Users,
} from 'lucide-react'
import type { SalesKitItem, SchemeFilter, SchemeKit } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { canEditSchemesUser } from '../../lib/rbac'
import { deleteSalesKitItem, deleteSchemeKit, importSalesKit, saveSalesKitItem, saveSchemeKit, toggleKitScheme, userName, type SalesKitInput, type SchemeKitInput } from '../../lib/actions'
import { readGoogleSheet, readSheets } from '../../lib/bulkUsers'
import { fmtDateTime } from '../../lib/format'
import { istToday } from '../../../supabase/workflow-rules.mjs'
import {
  AMOUNT_BANDS, CHARGE_BANDS, CLOSING, closingOf, emptyFilter, filterCount, kitItems, matches, optionsOf, planSchemeImport, SORTS, sortItems, type ImportRow,
} from '../../../supabase/scheme-kit-rules.mjs'
import { Badge, Button, Card, Checkbox, cx, EmptyState, Input, Modal, PageHeader, SearchBox, Select, Textarea, Toggle, useConfirm, useRun, useToast } from '../../components/ui'
import { FilterBar, MultiFilter } from '../../components/MultiFilter'

const CATEGORIES = ['Grant', 'Grant + Debt + Equity', 'Debt + Equity', 'Equity', 'Loan', 'Loan + Subsidy', 'Certification / GeM / Award']
const blank: SalesKitInput = { category: 'Grant', name: '', benefits: '', sectors: '', eligibility: '', lastDate: 'Rolling basis', organisation: '', schemeType: '', applicableFor: 'Pan India', minCharge: '' }
const COLORS = ['#2E3A8C', '#F47B20', '#0E9F6E', '#7C3AED', '#DB2777', '#0891B2', '#B45309', '#475569']
const CLOSE_TONE: Record<string, 'red' | 'amber' | 'blue' | 'green' | 'gray'> = { closed: 'red', week: 'amber', month: 'blue', open: 'green', rolling: 'gray' }
const CLOSE_TEXT = Object.fromEntries(CLOSING)

/**
 * Sales Kit & Scheme Kits. Every scheme sales can offer — benefits, sectors, eligibility, last date, who runs it, our
 * charge — with advanced filters, sorting, and Scheme Kits: named lists picked by hand and / or saved filters, personal
 * or shared. Everyone reads the schemes and makes their own kits; schemes and shared kits are changed by the Operation
 * Team, IT Support and Super Admin only (the database checks the same).
 */
export default function SalesKit() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const [params, setParams] = useSearchParams()
  const editor = canEditSchemesUser(me) && can('saleskit.manage')
  const items = db.salesKit ?? []
  const t = istToday()
  const kits = useMemo(() => (db.schemeKits ?? []).filter((k) => k.shared || k.ownerId === me.id).sort((a, b) => Number(b.shared) - Number(a.shared) || a.position - b.position), [db.schemeKits, me.id])
  const kitId = params.get('kit') ?? ''
  const kit = kits.find((k) => k.id === kitId)
  const mayEditKit = (k: SchemeKit) => (k.shared ? canEditSchemesUser(me) : k.ownerId === me.id)

  const [f, setF] = useState<SchemeFilter>(emptyFilter)
  const [sort, setSort] = useState('')
  const set = (p: Partial<SchemeFilter>) => setF((x) => ({ ...x, ...p }))
  const [open, setOpen] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id?: string; v: SalesKitInput } | null>(null)
  const [kitEdit, setKitEdit] = useState<{ id?: string; v: SchemeKitInput } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  useEffect(() => { if (kitId && !kit && kits.length) setParams({}, { replace: true }) }, [kitId, kit, kits.length, setParams])

  const base = kit ? kitItems(kit, items, t) : items
  const cats = useMemo(() => [...new Set([...CATEGORIES, ...items.map((x) => x.category)])].filter((c) => items.some((x) => x.category === c)), [items])
  const opt = (field: keyof SalesKitItem) => optionsOf(base, field).map((o) => ({ value: o.label, label: o.label, count: o.count }))
  const list = sortItems(base.filter((x) => matches(x, f, t)).sort((a, b) => (kit ? 0 : cats.indexOf(a.category) - cats.indexOf(b.category) || a.position - b.position)), sort || kit?.sort || '', t)
  const active = filterCount(f)

  const pickKit = (id: string) => { setParams(id ? { kit: id } : {}); setF(emptyFilter()); setSort(''); setOpen(null) }
  const download = async (name: string, rows: SalesKitItem[]) => {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(rows.map((x) => ({
      Category: x.category, 'Scheme name': x.name, Benefits: x.benefits, 'Focus sectors': x.sectors, Eligibility: x.eligibility, 'Last date': x.lastDate,
      'Funding organisation': x.organisation, 'Type of scheme': x.schemeType, 'Applicable for': x.applicableFor, 'Our minimum charge': x.minCharge, 'Govt registration charge': x.registrationCharge ?? '',
    })))
    ws['!cols'] = [14, 32, 50, 36, 36, 16, 28, 18, 20, 24, 24].map((w) => ({ wch: w }))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Schemes')
    XLSX.writeFile(wb, `${name.replace(/[^\w -]+/g, '').trim() || 'Schemes'}.xlsx`)
  }

  return (
    <div>
      <PageHeader title="Sales Kit & Scheme Kits" icon={BookMarked}
        subtitle={editor ? 'Every scheme sales offers — keep it up to date, organise it into Scheme Kits, filter it any way' : 'Every scheme you can offer — filter it, and keep your own Scheme Kits (schemes are kept up to date by the Operation Team)'}
        actions={<>
          {editor && <Button variant="outline" icon={Upload} onClick={() => setImportOpen(true)}>Import from a sheet</Button>}
          {editor && <Button variant="accent" icon={Plus} onClick={() => setEdit({ v: { ...blank, category: f.categories[0] ?? 'Grant' } })}>Add scheme</Button>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* kits */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card className="p-2">
            <p className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-mute"><Layers className="size-3.5" />Scheme Kits</p>
            <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible" aria-label="Scheme Kits">
              <KitButton active={!kit} color="#64748b" name="All schemes" count={items.length} onClick={() => pickKit('')} />
              {kits.map((k) => <KitButton key={k.id} active={kit?.id === k.id} color={k.color ?? COLORS[0]!} name={k.name} count={kitItems(k, items, t).length} shared={k.shared} onClick={() => pickKit(k.id)} />)}
            </nav>
            <Button size="sm" variant="ghost" icon={FolderPlus} className="mt-1 w-full justify-start" onClick={() => setKitEdit({ v: { name: '', schemeIds: [], shared: false, color: COLORS[kits.length % COLORS.length] } })}>New kit</Button>
          </Card>
        </aside>

        <div className="min-w-0">
          {kit && (
            <Card className="mb-3 flex flex-wrap items-center gap-3 p-3">
              <span className="size-3 shrink-0 rounded-full" style={{ background: kit.color ?? COLORS[0] }} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-bold">{kit.name}{kit.shared ? <Badge tone="blue"><Users className="size-3" />shared with everyone</Badge> : <Badge tone="gray"><Lock className="size-3" />only you</Badge>}</p>
                <p className="text-xs text-mute">{kit.description || `${kitItems(kit, items, t).length} schemes`}{kit.filter && filterCount(kit.filter) ? ' · includes every scheme matching its saved filters' : ''}{kit.shared && kit.updatedBy ? ` · updated by ${userName(db, kit.updatedBy)}` : ''}</p>
              </div>
              <Button size="sm" variant="outline" icon={Download} onClick={() => void download(kit.name, list)}>Excel</Button>
              {mayEditKit(kit) && <>
                <Button size="sm" variant="outline" icon={Pencil} onClick={() => setKitEdit({ id: kit.id, v: { name: kit.name, description: kit.description, color: kit.color, schemeIds: kit.schemeIds, excludedIds: kit.excludedIds, filter: kit.filter, sort: kit.sort, shared: kit.shared } })}>Edit kit</Button>
                <Button size="sm" variant="ghost" icon={Trash2} className="text-bad" onClick={async () => { if (await confirm(`Delete the kit “${kit.name}”?`, `The schemes stay in the Sales Kit; only this kit goes${kit.shared ? ' — for everyone' : ''}.`, true)) { if (await run(() => deleteSchemeKit(me, kit.id), 'Kit deleted')) pickKit('') } }}>Delete</Button>
              </>}
            </Card>
          )}

          {/* advanced filters */}
          <Card className="mb-3 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <SearchBox value={f.q} onChange={(q) => set({ q })} placeholder="Search name, benefit, sector, state, eligibility…" className="min-w-60 flex-1" />
              <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className="!h-10 w-auto">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            </div>
            <FilterBar active={active} onClear={() => setF(emptyFilter())}>
              <MultiFilter label="Category" options={opt('category')} value={f.categories} onChange={(v) => set({ categories: v })} />
              <MultiFilter label="Type of scheme" options={opt('schemeType')} value={f.types} onChange={(v) => set({ types: v })} />
              <MultiFilter label="Organisation" options={opt('organisation')} value={f.orgs} onChange={(v) => set({ orgs: v })} width="w-80" />
              <MultiFilter label="Applicable for" options={opt('applicableFor')} value={f.places} onChange={(v) => set({ places: v })} />
              <MultiFilter label="Sector" options={opt('sectors')} value={f.sectors} onChange={(v) => set({ sectors: v })} width="w-80" />
              <MultiFilter label="Who can apply" options={opt('eligibility')} value={f.entities} onChange={(v) => set({ entities: v })} width="w-80" />
              <MultiFilter label="Last date" keepOrder options={CLOSING.map(([v, l]) => ({ value: v, label: l, count: base.filter((x) => closingOf(x, t) === v).length }))} value={f.closing} onChange={(v) => set({ closing: v })} />
              <Select aria-label="Benefit amount" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className={cx('!h-10 w-auto', f.amount && 'border-brand')}>{AMOUNT_BANDS.map(([v, l]) => <option key={v} value={v}>{v ? `Benefit: ${l}` : 'Any benefit amount'}</option>)}</Select>
              <Select aria-label="Our charge" value={f.charge} onChange={(e) => set({ charge: e.target.value })} className={cx('!h-10 w-auto', f.charge && 'border-brand')}>{CHARGE_BANDS.map(([v, l]) => <option key={v} value={v}>{v ? `Charge: ${l}` : 'Any charge'}</option>)}</Select>
            </FilterBar>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-mute">
              <span><b className="text-ink">{list.length}</b> of {base.length} schemes{kit ? ` in “${kit.name}”` : ''}</span>
              {active > 0 && <Button size="sm" variant="soft" icon={Save} className="ml-auto" onClick={() => setKitEdit({ v: { name: '', schemeIds: [], filter: f, sort, shared: false, color: COLORS[kits.length % COLORS.length] } })}>Save these filters as a kit</Button>}
              <Button size="sm" variant="ghost" icon={Download} className={active ? '' : 'ml-auto'} onClick={() => void download(kit ? kit.name : 'Sales Kit', list)}>Download {list.length} as Excel</Button>
            </div>
          </Card>

          {!list.length ? <Card><EmptyState icon={BookMarked} title={base.length ? 'No schemes match' : kit ? 'This kit is empty' : 'The Sales Kit is empty'} text={base.length ? 'Change or clear the filters.' : kit ? 'Add schemes with “Add to kit” on any scheme, or edit the kit.' : editor ? 'Add the first scheme, or import them from a sheet.' : 'The Operation Team adds schemes here.'} /></Card> : (
            <div className="space-y-3">
              {list.map((x) => {
                const isOpen = open === x.id, c = closingOf(x, t)
                return (
                  <Card key={x.id} className="overflow-hidden">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-card2/50">
                      <button className="min-w-0 flex-1 basis-64 text-left" onClick={() => setOpen(isOpen ? null : x.id)} aria-expanded={isOpen}>
                        <span className="flex flex-wrap items-center gap-2"><b className="text-[15px]">{x.name}</b><Badge tone="violet">{x.category}</Badge>{c !== 'unknown' && c !== 'open' && <Badge tone={CLOSE_TONE[c] ?? 'gray'}>{CLOSE_TEXT[c]}</Badge>}</span>
                        <span className="mt-0.5 block truncate text-xs text-mute">{[x.organisation, x.schemeType, x.applicableFor].filter(Boolean).join(' · ')}</span>
                      </button>
                      <span className="text-right text-xs"><span className="block text-mute">Last date</span><b>{x.lastDate || '—'}</b></span>
                      <span className="text-right text-xs"><span className="block text-mute">Our charge</span><b className="text-brand-ink">{x.minCharge || '—'}</b></span>
                      <AddToKit scheme={x} kits={kits.filter(mayEditKit)} onNew={() => setKitEdit({ v: { name: '', schemeIds: [x.id], shared: false, color: COLORS[kits.length % COLORS.length] } })} />
                      <button onClick={() => setOpen(isOpen ? null : x.id)} aria-label={isOpen ? 'Close' : 'Open'} className="text-mute">{isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</button>
                    </div>
                    {isOpen && (
                      <div className="border-t border-line px-4 py-3">
                        <div className="grid gap-4 md:grid-cols-3">
                          {([['Benefits', x.benefits], ['Focus sectors', x.sectors], ['Eligibility', x.eligibility]] as const).map(([k, v]) => (
                            <div key={k}><p className="text-[11px] font-bold uppercase tracking-wider text-mute">{k}</p><p className="mt-1 whitespace-pre-line text-sm">{v || '—'}</p></div>
                          ))}
                        </div>
                        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                          {([['Funding organisation', x.organisation], ['Type of scheme', x.schemeType], ['Applicable for', x.applicableFor], ...(x.registrationCharge ? [['Govt registration charge', x.registrationCharge]] as const : [])] as const).map(([k, v]) => (
                            <div key={k}><p className="text-[11px] font-bold uppercase tracking-wider text-mute">{k}</p><p className="mt-0.5 whitespace-pre-line">{v || '—'}</p></div>
                          ))}
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3 text-[11px] text-mute">
                          <span className="mr-auto">{x.updatedAt ? `Updated ${fmtDateTime(x.updatedAt)}${x.updatedBy ? ` by ${userName(db, x.updatedBy)}` : ''}` : 'From the Sales Kit sheet'}</span>
                          {editor && <>
                            <Button size="sm" variant="outline" icon={Pencil} onClick={() => { const { id, position: _p, updatedAt: _u, updatedBy: _b, ...v } = x; setEdit({ id, v }) }}>Edit</Button>
                            <Button size="sm" variant="ghost" icon={Trash2} onClick={async () => { if (await confirm(`Remove “${x.name}”?`, 'It disappears from the Sales Kit and every kit, for everyone (kept in Deleted items).', true)) run(() => deleteSalesKitItem(me, x.id), 'Removed') }}>Remove</Button>
                          </>}
                        </div>
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {edit && <SalesKitEditor init={edit.v} id={edit.id} categories={[...new Set([...CATEGORIES, ...cats])]} onClose={() => setEdit(null)} />}
      {kitEdit && <KitEditor init={kitEdit.v} id={kitEdit.id} items={items} canShare={canEditSchemesUser(me)} onClose={(id) => { setKitEdit(null); if (id) pickKit(id) }} />}
      {importOpen && <ImportSchemes items={items} onClose={() => setImportOpen(false)} />}
      {node}
    </div>
  )
}

function KitButton({ active, color, name, count, shared, onClick }: { active: boolean; color: string; name: string; count: number; shared?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-current={active ? 'page' : undefined}
      className={cx('flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition lg:w-full', active ? 'bg-brand-soft font-bold text-brand-ink' : 'hover:bg-card2')}>
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {shared && <Share2 className="size-3 shrink-0 text-mute" aria-label="shared" />}
      <span className="rounded-full bg-card2 px-1.5 text-[11px] tabular-nums text-mute">{count}</span>
    </button>
  )
}

/** The bookmark menu on each scheme: tick the kits it is in; or start a new kit with it. */
function AddToKit({ scheme, kits, onNew }: { scheme: SalesKitItem; kits: SchemeKit[]; onNew: () => void }) {
  const me = useMe()
  const run = useRun()
  const [openMenu, setOpenMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const t = istToday()
  useEffect(() => {
    if (!openMenu) return
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpenMenu(false) }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [openMenu])
  const items = [scheme]
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="ghost" icon={BookmarkPlus} onClick={() => setOpenMenu(!openMenu)} aria-expanded={openMenu}>Add to kit</Button>
      {openMenu && (
        <div className="anim-pop absolute right-0 top-full z-30 mt-1 w-64 rounded-xl border border-line bg-card p-1.5 shadow-pop">
          {kits.map((k) => {
            const inKit = kitItems(k, items, t).length > 0
            return (
              <button key={k.id} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-card2"
                onClick={() => run(() => toggleKitScheme(me, k.id, scheme.id, !inKit), inKit ? `Taken out of ${k.name}` : `Added to ${k.name}`)}>
                <span className={cx('grid size-4 place-items-center rounded border', inKit ? 'border-brand bg-brand text-white' : 'border-line')}>{inKit && <Check className="size-3" />}</span>
                <span className="size-2 rounded-full" style={{ background: k.color ?? COLORS[0] }} />
                <span className="min-w-0 flex-1 truncate">{k.name}</span>{k.shared && <Share2 className="size-3 text-mute" />}
              </button>
            )
          })}
          {!kits.length && <p className="px-2 py-1.5 text-xs text-mute">No kits yet.</p>}
          <button className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-line px-2 py-1.5 text-left text-sm font-semibold text-brand-ink hover:bg-card2" onClick={() => { setOpenMenu(false); onNew() }}><FolderPlus className="size-4" />New kit with this scheme</button>
        </div>
      )}
    </div>
  )
}

function KitEditor({ init, id, items, canShare, onClose }: { init: SchemeKitInput; id?: string; items: SalesKitItem[]; canShare: boolean; onClose: (id?: string) => void }) {
  const me = useMe()
  const run = useRun()
  const [v, setV] = useState<SchemeKitInput>(init)
  const [useFilter, setUseFilter] = useState(!!init.filter && filterCount(init.filter) > 0)
  const [q, setQ] = useState('')
  const set = (p: Partial<SchemeKitInput>) => setV((x) => ({ ...x, ...p }))
  const picked = new Set(v.schemeIds)
  const t = istToday()
  const byFilter = useFilter && v.filter ? items.filter((x) => matches(x, v.filter, t)).length : 0
  const shown = items.filter((x) => !q.trim() || `${x.name} ${x.category} ${x.organisation}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(picked.has(b.id)) - Number(picked.has(a.id)) || a.name.localeCompare(b.name))
  const save = async () => {
    const r = await run(() => saveSchemeKit(me, { ...v, filter: useFilter ? v.filter : undefined }, id), id ? 'Kit saved' : 'Kit created')
    if (r) onClose(typeof r === 'string' ? r : id)
  }
  return (
    <Modal open onClose={() => onClose()} title={id ? 'Edit Scheme Kit' : 'New Scheme Kit'} size="lg"
      subtitle="A kit is a list of schemes you pick — and / or every scheme matching saved filters (new matching schemes join by themselves)."
      footer={<><Button variant="outline" onClick={() => onClose()}>Cancel</Button><Button icon={Save} onClick={save}>{id ? 'Save kit' : 'Create kit'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Input label="Kit name" value={v.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Women entrepreneurs · Gujarat" autoFocus />
        <div>
          <span className="mb-1.5 block text-xs font-semibold text-mute">Colour</span>
          <div className="flex gap-1.5">{COLORS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => set({ color: c })} className={cx('size-7 rounded-full ring-offset-2 ring-offset-card', v.color === c && 'ring-2 ring-brand')} style={{ background: c }} />)}</div>
        </div>
        <Textarea label="Description (optional)" rows={2} value={v.description ?? ''} onChange={(e) => set({ description: e.target.value })} className="sm:col-span-2" placeholder="Who this kit is for, how sales should use it" />
      </div>
      <div className="mt-3 grid gap-2">
        {canShare
          ? <label className="flex items-center justify-between gap-3 rounded-xl bg-card2 px-3 py-2.5 text-sm"><span><b>Share with everyone</b><span className="block text-xs text-mute">Every staff member sees it; only the Operation Team, IT Support and Super Admin change it.</span></span><Toggle checked={v.shared} onChange={(s) => set({ shared: s })} label="Share with everyone" /></label>
          : <p className="flex items-center gap-1.5 rounded-xl bg-card2 px-3 py-2 text-xs text-mute"><Lock className="size-3.5" />Your kit — only you see it. Shared kits are made by the Operation Team.</p>}
        {v.filter && filterCount(v.filter) > 0 && (
          <label className="flex items-center justify-between gap-3 rounded-xl bg-card2 px-3 py-2.5 text-sm">
            <span><b>Include every scheme matching the saved filters</b><span className="block text-xs text-mute">{filterCount(v.filter)} filter(s) · {byFilter} scheme(s) match now; new ones join by themselves</span></span>
            <Toggle checked={useFilter} onChange={setUseFilter} label="Include matching schemes" />
          </label>
        )}
      </div>
      <div className="mt-3">
        <div className="mb-2 flex items-center gap-2"><b className="text-sm">Schemes picked by hand</b><Badge tone="navy">{v.schemeIds.length}</Badge>
          <SearchBox value={q} onChange={setQ} placeholder="Find a scheme…" className="ml-auto w-56" /></div>
        <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
          {shown.map((x) => (
            <label key={x.id} className="flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3 py-2 text-sm last:border-0 hover:bg-card2">
              <Checkbox checked={picked.has(x.id)} onChange={(c) => set({ schemeIds: c ? [...v.schemeIds, x.id] : v.schemeIds.filter((s) => s !== x.id) })} label="" />
              <span className="min-w-0 flex-1 truncate"><b>{x.name}</b> <span className="text-xs text-mute">· {x.category}{x.organisation ? ` · ${x.organisation}` : ''}</span></span>
            </label>
          ))}
          {!shown.length && <p className="px-3 py-3 text-xs text-mute">Nothing matches.</p>}
        </div>
      </div>
    </Modal>
  )
}

/** Import schemes from a Google Sheet link or an .xlsx / .csv file: preview new / update / unchanged, then apply. */
function ImportSchemes({ items, onClose }: { items: SalesKitItem[]; onClose: () => void }) {
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sheets, setSheets] = useState<{ name: string; rows: unknown[][] }[] | null>(null)
  const [defCat, setDefCat] = useState('Grant')
  const rows: ImportRow[] | null = useMemo(() => (sheets ? planSchemeImport(sheets, items, { defaultCategory: defCat }) : null), [sheets, items, defCat])
  const setRows = (x: null) => setSheets(x)
  const [show, setShow] = useState<'all' | 'new' | 'update' | 'same' | 'skip'>('all')
  const load = async (get: () => Promise<{ name: string; rows: unknown[][] }[]>) => {
    setBusy(true); setErr('')
    try {
      const s = await get()
      if (!planSchemeImport(s, items).length) throw new Error('No schemes found — the sheet needs a heading row with a “Scheme name” column (and benefits, eligibility … as available).')
      setSheets(s)
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const generic = (rows ?? []).some((r) => r.fromDefault && r.action !== 'same')
  const n = (a: string) => rows?.filter((r) => r.action === a).length ?? 0
  const apply = async () => {
    if (!rows) return
    const r = await run(() => importSalesKit(me, rows.filter((x) => x.action === 'new' || x.action === 'update')))
    if (r && typeof r === 'object') { toast('success', `Sales Kit: ${r.added} scheme(s) added, ${r.updated} updated`); setRows(null); onClose() }
  }
  const list = (rows ?? []).filter((r) => show === 'all' || r.action === show)
  return (
    <Modal open onClose={onClose} size="xl" title="Import schemes from a sheet"
      subtitle="Columns by their headings: Scheme name, Category (or one sheet per category), Benefits, Focus sectors, Eligibility, Last date, Funding organisation, Type of scheme, Applicable for, Our charge, Govt registration charge. Existing schemes (same name) are updated — an empty cell never wipes what is there."
      footer={rows ? <><Button variant="outline" onClick={() => setRows(null)}>Back</Button><Button icon={Check} disabled={!n('new') && !n('update')} onClick={apply}>Apply ({n('new')} new · {n('update')} updated)</Button></> : <Button variant="outline" onClick={onClose}>Close</Button>}>
      <input ref={input} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void load(() => readSheets(file)) }} />
      {!rows && (
        <div className="grid gap-4">
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void load(() => readGoogleSheet(link.trim(), 'schemes')) }}>
            <label className="min-w-[16rem] flex-1">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-mute"><Link2 className="size-3.5" />Google Sheets link</span>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className="h-10 w-full rounded-xl border border-line bg-card px-3 text-sm" />
            </label>
            <Button type="submit" icon={FileSpreadsheet} loading={busy} disabled={!link.trim()}>Read the sheet</Button>
            <span className="basis-full text-[11px] text-mute">Shared “Anyone with the link” (Viewer). Every tab is read.</span>
          </form>
          <button type="button" onClick={() => input.current?.click()} className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-6 py-8 text-center hover:border-brand hover:bg-brand-soft/30">
            <FileSpreadsheet className="size-9 text-brand-ink" /><span className="font-bold">Or choose a file (.xlsx / .csv)</span>
          </button>
          {err && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{err}</p>}
        </div>
      )}
      {rows && (
        <div className="grid gap-3">
          {generic && (
            <label className="flex flex-wrap items-center gap-2 rounded-xl bg-info-soft px-3 py-2 text-sm text-info">
              The sheet has no Category column and its tab names don't say it — category for those schemes:
              <Select aria-label="Category for schemes without one" value={defCat} onChange={(e) => setDefCat(e.target.value)} className="!h-8 w-auto !py-0">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
              <span className="basis-full text-xs">(Name each tab after its category — Grant, Loan … — to have them set by themselves.)</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {([['all', `All ${rows.length}`], ['new', `New ${n('new')}`], ['update', `Update ${n('update')}`], ['same', `Unchanged ${n('same')}`], ['skip', `Skipped ${n('skip')}`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setShow(k)} className={cx('rounded-full border px-3 py-1 text-xs font-semibold', show === k ? 'border-brand bg-brand text-white' : 'border-line hover:bg-card2')}>{l}</button>
            ))}
          </div>
          <div className="max-h-[55vh] overflow-auto rounded-xl border border-line">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-card2 text-left text-[11px] uppercase tracking-wide text-mute"><tr><th className="px-3 py-2">Scheme</th><th className="px-2 py-2">Category</th><th className="px-2 py-2">Last date</th><th className="px-2 py-2">Our charge</th><th className="px-3 py-2">What happens</th></tr></thead>
              <tbody className="divide-y divide-line/70">
                {list.map((r) => (
                  <tr key={r.line}>
                    <td className="px-3 py-2"><b>{r.v.name}</b><span className="block text-[11px] text-mute">{r.line}{r.v.organisation ? ` · ${r.v.organisation}` : ''}</span></td>
                    <td className="px-2 py-2 text-xs">{r.v.category}</td>
                    <td className="px-2 py-2 text-xs">{r.v.lastDate}</td>
                    <td className="px-2 py-2 text-xs">{r.v.minCharge || '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.action === 'new' ? <Badge tone="green">new</Badge> : r.action === 'update' ? <Badge tone="blue">update</Badge> : r.action === 'same' ? <Badge tone="gray">unchanged</Badge> : <Badge tone="red">skipped</Badge>}
                      {r.action === 'update' && <span className="mt-1 block text-mute">changes: {r.changes.join(', ')}</span>}
                      {r.problem && <span className="mt-1 block text-bad">{r.problem}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}

function SalesKitEditor({ init, id, categories, onClose }: { init: SalesKitInput; id?: string; categories: string[]; onClose: () => void }) {
  const me = useMe()
  const run = useRun()
  const [v, setV] = useState<SalesKitInput>(init)
  const set = (p: Partial<SalesKitInput>) => setV((x) => ({ ...x, ...p }))
  return (
    <Modal open onClose={onClose} title={id ? 'Edit scheme' : 'Add scheme'} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={async () => { if (await run(() => saveSalesKitItem(me, v, id), id ? 'Scheme updated' : 'Scheme added')) onClose() }}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Scheme name" value={v.name} onChange={(e) => set({ name: e.target.value })} className="sm:col-span-2" />
        <Select label="Category" value={v.category} onChange={(e) => set({ category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</Select>
        <Input label="Last date" value={v.lastDate} onChange={(e) => set({ lastDate: e.target.value })} hint="e.g. 18 Nov 2026 or Rolling basis" />
        <Textarea label="Benefits" rows={4} value={v.benefits} onChange={(e) => set({ benefits: e.target.value })} className={cx('sm:col-span-2')} />
        <Textarea label="Focus sectors" rows={4} value={v.sectors} onChange={(e) => set({ sectors: e.target.value })} hint="One per line — each becomes a filter option" />
        <Textarea label="Eligibility criteria" rows={4} value={v.eligibility} onChange={(e) => set({ eligibility: e.target.value })} hint="One per line (Private Limited, LLP …)" />
        <Input label="Funding organisation" value={v.organisation} onChange={(e) => set({ organisation: e.target.value })} />
        <Input label="Type of scheme" value={v.schemeType} onChange={(e) => set({ schemeType: e.target.value })} />
        <Input label="Applicable for" value={v.applicableFor} onChange={(e) => set({ applicableFor: e.target.value })} hint="Pan India, or the state(s)" />
        <Input label="Our minimum charge (upfront)" value={v.minCharge} onChange={(e) => set({ minCharge: e.target.value })} placeholder="INR 10,000 + 18% GST" />
        <Textarea label="Govt registration charge / note (optional)" rows={2} value={v.registrationCharge ?? ''} onChange={(e) => set({ registrationCharge: e.target.value })} className="sm:col-span-2" />
      </div>
    </Modal>
  )
}
