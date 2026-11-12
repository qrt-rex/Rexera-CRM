import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  BookmarkPlus, Check, ChevronDown, ChevronUp, Combine, Download, FolderPlus, Layers, Library, Lock, Pencil, Plus, RefreshCcw, Save, Share2, Trash2, Users, Wand2,
} from 'lucide-react'
import type { SalesKitItem, SchemeFilter, SchemeKit as Kit, SchemeMaster } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { canEditSchemesUser } from '../../lib/rbac'
import { deleteSchemeKit, saveSchemeKit, toggleKitScheme, userName, type SchemeKitInput } from '../../lib/actions'
import { buildSchemeMaster, kitIdsToMaster, masterList, mergeMasterSchemes, saveMasterScheme, schemeView, unlinkedCount, usageOf, USAGE_LABELS } from '../../lib/schemeMaster'
import { fmtDateTime } from '../../lib/format'
import { istToday } from '../../../supabase/workflow-rules.mjs'
import { AMOUNT_BANDS, CHARGE_BANDS, CLOSING, closingOf, emptyFilter, filterCount, kitItems, matches, optionsOf, SORTS, sortItems } from '../../../supabase/scheme-kit-rules.mjs'
import { Badge, Button, Card, Checkbox, cx, EmptyState, Input, Modal, PageHeader, SearchBox, Select, Textarea, Toggle, useConfirm, useRun, useToast } from '../../components/ui'
import { FilterBar, MultiFilter } from '../../components/MultiFilter'

const CATEGORIES = ['Grant', 'Grant + Debt + Equity', 'Debt + Equity', 'Equity', 'Loan', 'Loan + Subsidy', 'Subsidy', 'Certification / GeM / Award', 'Other']
const COLORS = ['#2E3A8C', '#F47B20', '#0E9F6E', '#7C3AED', '#DB2777', '#0891B2', '#B45309', '#475569']
const CLOSE_TONE: Record<string, 'red' | 'amber' | 'blue' | 'green' | 'gray'> = { closed: 'red', week: 'amber', month: 'blue', open: 'green', rolling: 'gray' }
const CLOSE_TEXT = Object.fromEntries(CLOSING)

/**
 * Scheme Kit — the master list of schemes: the only place a scheme's name is set. Renaming a scheme here renames it in
 * Services (the Scheme dropdown of client entries), every CRM entry, client entries, the Sales Kit, Schemes, the Scheme
 * Checker and Digital Media. Also Scheme Kits (named lists, personal or shared) and advanced filters. Everyone reads it;
 * the Operation Team, IT Support and Super Admin change it (the database checks the same).
 */
export default function SchemeKit() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const [confirm, node] = useConfirm()
  const [params, setParams] = useSearchParams()
  const editor = canEditSchemesUser(me)
  const t = istToday()
  const master = masterList(db)
  const items = useMemo(() => schemeView(db), [db])
  const byId = useMemo(() => new Map(master.map((m) => [m.id, m])), [master])
  const unlinked = unlinkedCount(db)
  // kits made before the Scheme Kit had its own list name Sales Kit ids: read as the Scheme Kit's
  const kits = useMemo(() => (db.schemeKits ?? []).filter((k) => k.shared || k.ownerId === me.id)
    .map((k) => ({ ...k, schemeIds: kitIdsToMaster(db, k.schemeIds), excludedIds: k.excludedIds && kitIdsToMaster(db, k.excludedIds) }))
    .sort((a, b) => Number(b.shared) - Number(a.shared) || a.position - b.position), [db, me.id])
  const kitId = params.get('kit') ?? ''
  const kit = kits.find((k) => k.id === kitId)
  const mayEditKit = (k: Kit) => (k.shared ? editor : k.ownerId === me.id)

  const [f, setF] = useState<SchemeFilter>(emptyFilter)
  const [sort, setSort] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const set = (p: Partial<SchemeFilter>) => setF((x) => ({ ...x, ...p }))
  const [open, setOpen] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ m?: SchemeMaster } | null>(null)
  const [merge, setMerge] = useState<SchemeMaster | null>(null)
  const [kitEdit, setKitEdit] = useState<{ id?: string; v: SchemeKitInput } | null>(null)
  useEffect(() => { if (kitId && !kit && kits.length) setParams({}, { replace: true }) }, [kitId, kit, kits.length, setParams])

  const live = items.filter((x) => showInactive || byId.get(x.id)?.active !== false)
  const base = kit ? kitItems(kit, live, t) : live
  const cats = useMemo(() => [...new Set([...CATEGORIES, ...items.map((x) => x.category)])], [items])
  const opt = (field: keyof SalesKitItem) => optionsOf(base, field).map((o) => ({ value: o.label, label: o.label, count: o.count }))
  const list = sortItems(base.filter((x) => matches(x, f, t)).sort((a, b) => (kit ? 0 : cats.indexOf(a.category) - cats.indexOf(b.category) || a.name.localeCompare(b.name))), sort || kit?.sort || '', t)
  const active = filterCount(f)
  const pickKit = (id: string) => { setParams(id ? { kit: id } : {}); setF(emptyFilter()); setSort(''); setOpen(null) }
  const build = async () => {
    const r = await run(() => buildSchemeMaster(me))
    if (r && typeof r === 'object') toast('success', `Scheme Kit: ${r.added} scheme(s) added, ${r.linked} link(s) made`)
  }
  const download = async (name: string, rows: SalesKitItem[]) => {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(rows.map((x) => ({
      'Scheme name': x.name, Category: x.category, Benefits: x.benefits, 'Focus sectors': x.sectors, Eligibility: x.eligibility, 'Last date': x.lastDate,
      'Funding organisation': x.organisation, 'Type of scheme': x.schemeType, 'Applicable for': x.applicableFor, 'Our minimum charge': x.minCharge,
    })))
    ws['!cols'] = [32, 16, 50, 36, 36, 16, 28, 18, 20, 24].map((w) => ({ wch: w }))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Schemes')
    XLSX.writeFile(wb, `${name.replace(/[^\w -]+/g, '').trim() || 'Schemes'}.xlsx`)
  }

  if (!master.length) {
    return (
      <div>
        <PageHeader title="Scheme Kit" icon={Library} subtitle="The master list of schemes — names set here change everywhere in the CRM" />
        <Card><EmptyState icon={Library} title="The Scheme Kit is not set up yet"
          text={editor ? `It is built from the scheme names already in the CRM — Services, Sales Kit, Schemes and the Scheme Checker (${unlinked} names). Same names become one scheme, linked to each list.` : 'The Operation Team sets it up from the schemes already in the CRM.'}
          action={editor && <Button icon={Wand2} onClick={build}>Build the Scheme Kit ({unlinked} names)</Button>} /></Card>
        {node}
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Scheme Kit" icon={Library}
        subtitle={editor ? 'The master list of schemes — a name changed here changes in every list, dropdown and CRM entry' : 'Every scheme by its official name — organise them into your own kits and filter them any way'}
        actions={<>
          {editor && unlinked > 0 && <Button variant="outline" icon={RefreshCcw} onClick={build}>Add {unlinked} new name{unlinked === 1 ? '' : 's'} from the CRM</Button>}
          {editor && <Button variant="accent" icon={Plus} onClick={() => setEdit({})}>Add scheme</Button>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card className="p-2">
            <p className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-mute"><Layers className="size-3.5" />Scheme Kits</p>
            <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible" aria-label="Scheme Kits">
              <KitButton active={!kit} color="#64748b" name="All schemes" count={live.length} onClick={() => pickKit('')} />
              {kits.map((k) => <KitButton key={k.id} active={kit?.id === k.id} color={k.color ?? COLORS[0]!} name={k.name} count={kitItems(k, live, t).length} shared={k.shared} onClick={() => pickKit(k.id)} />)}
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
                <p className="text-xs text-mute">{kit.description || `${kitItems(kit, live, t).length} schemes`}{kit.filter && filterCount(kit.filter) ? ' · includes every scheme matching its saved filters' : ''}{kit.shared && kit.updatedBy ? ` · updated by ${userName(db, kit.updatedBy)}` : ''}</p>
              </div>
              <Button size="sm" variant="outline" icon={Download} onClick={() => void download(kit.name, list)}>Excel</Button>
              {mayEditKit(kit) && <>
                <Button size="sm" variant="outline" icon={Pencil} onClick={() => setKitEdit({ id: kit.id, v: { name: kit.name, description: kit.description, color: kit.color, schemeIds: kit.schemeIds, excludedIds: kit.excludedIds, filter: kit.filter, sort: kit.sort, shared: kit.shared } })}>Edit kit</Button>
                <Button size="sm" variant="ghost" icon={Trash2} className="text-bad" onClick={async () => { if (await confirm(`Delete the kit “${kit.name}”?`, `The schemes stay in the Scheme Kit; only this kit goes${kit.shared ? ' — for everyone' : ''}.`, true)) { if (await run(() => deleteSchemeKit(me, kit.id), 'Kit deleted')) pickKit('') } }}>Delete</Button>
              </>}
            </Card>
          )}

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
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-mute">
              <span><b className="text-ink">{list.length}</b> of {base.length} schemes{kit ? ` in “${kit.name}”` : ''}</span>
              {editor && <label className="flex items-center gap-1.5"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-[var(--brand)]" />Show inactive schemes</label>}
              {active > 0 && <Button size="sm" variant="soft" icon={Save} className="ml-auto" onClick={() => setKitEdit({ v: { name: '', schemeIds: [], filter: f, sort, shared: false, color: COLORS[kits.length % COLORS.length] } })}>Save these filters as a kit</Button>}
              <Button size="sm" variant="ghost" icon={Download} className={active ? '' : 'ml-auto'} onClick={() => void download(kit ? kit.name : 'Scheme Kit', list)}>Download {list.length} as Excel</Button>
            </div>
          </Card>

          {!list.length ? <Card><EmptyState icon={Library} title={base.length ? 'No schemes match' : kit ? 'This kit is empty' : 'No schemes'} text={base.length ? 'Change or clear the filters.' : kit ? 'Add schemes with “Add to kit” on any scheme, or edit the kit.' : undefined} /></Card> : (
            <div className="space-y-3">
              {list.map((x) => {
                const m = byId.get(x.id)!
                const isOpen = open === x.id, c = closingOf(x, t)
                const used = usageOf(db, m)
                return (
                  <Card key={x.id} className={cx('overflow-hidden', !m.active && 'opacity-70')}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-card2/50">
                      <button className="min-w-0 flex-1 basis-64 text-left" onClick={() => setOpen(isOpen ? null : x.id)} aria-expanded={isOpen}>
                        <span className="flex flex-wrap items-center gap-2"><b className="text-[15px]">{x.name}</b><Badge tone="violet">{x.category}</Badge>
                          {!m.active && <Badge tone="gray">inactive</Badge>}{c !== 'unknown' && c !== 'open' && x.lastDate && <Badge tone={CLOSE_TONE[c] ?? 'gray'}>{CLOSE_TEXT[c]}</Badge>}</span>
                        <span className="mt-1 flex flex-wrap gap-1">{USAGE_LABELS.filter(([k]) => used[k]).map(([k, l]) => <span key={k} className="rounded-full bg-card2 px-2 py-0.5 text-[10px] font-semibold text-mute">{l} {used[k]}</span>)}
                          {!USAGE_LABELS.some(([k]) => used[k]) && <span className="text-[11px] text-mute">Not used anywhere yet</span>}</span>
                      </button>
                      <AddToKit schemeId={x.id} kits={kits.filter(mayEditKit)} live={live} onNew={() => setKitEdit({ v: { name: '', schemeIds: [x.id], shared: false, color: COLORS[kits.length % COLORS.length] } })} />
                      {editor && <Button size="sm" variant="outline" icon={Pencil} onClick={() => setEdit({ m })}>Rename / edit</Button>}
                      <button onClick={() => setOpen(isOpen ? null : x.id)} aria-label={isOpen ? 'Close' : 'Open'} className="text-mute">{isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</button>
                    </div>
                    {isOpen && (
                      <div className="border-t border-line px-4 py-3 text-sm">
                        {m.description && <p className="mb-3 whitespace-pre-line">{m.description}</p>}
                        {m.salesKitIds.length ? (
                          <div className="grid gap-4 md:grid-cols-3">
                            {([['Benefits', x.benefits], ['Focus sectors', x.sectors], ['Eligibility', x.eligibility]] as const).map(([k, v]) => (
                              <div key={k}><p className="text-[11px] font-bold uppercase tracking-wider text-mute">{k}</p><p className="mt-1 whitespace-pre-line">{v || '—'}</p></div>
                            ))}
                          </div>
                        ) : <p className="text-mute">No Sales Kit details for this scheme yet.</p>}
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3 text-[11px] text-mute">
                          <span className="mr-auto">{m.aliases.length ? `Old names: ${m.aliases.join(', ')} · ` : ''}{m.updatedAt ? `Updated ${fmtDateTime(m.updatedAt)}${m.updatedBy ? ` by ${userName(db, m.updatedBy)}` : ''}` : ''}</span>
                          {editor && <Button size="sm" variant="ghost" icon={Combine} onClick={() => setMerge(m)}>Merge a duplicate into this</Button>}
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

      {edit && <MasterEditor m={edit.m} categories={cats} onClose={() => setEdit(null)} />}
      {merge && <MergeModal keep={merge} master={master} onClose={() => setMerge(null)} />}
      {kitEdit && <KitEditor init={kitEdit.v} id={kitEdit.id} items={live} canShare={editor} onClose={(id) => { setKitEdit(null); if (id) pickKit(id) }} />}
      {node}
    </div>
  )
}

/** Add / rename a scheme: a new name changes everywhere it is used (listed before saving). */
function MasterEditor({ m, categories, onClose }: { m?: SchemeMaster; categories: string[]; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const [confirm, node] = useConfirm()
  const [v, setV] = useState({ name: m?.name ?? '', category: m?.category ?? 'Grant', active: m?.active ?? true, description: m?.description ?? '' })
  const renamed = !!m && v.name.trim() && v.name.trim().replace(/\s+/g, ' ') !== m.name
  const used = m ? usageOf(db, m) : null
  const save = async () => {
    if (renamed && used) {
      const where = USAGE_LABELS.filter(([k]) => used[k]).map(([k, l]) => `${l}: ${used[k]}`).join(' · ')
      if (!(await confirm(`Rename “${m!.name}” to “${v.name.trim()}”?`, `The new name replaces the old one everywhere — ${where || 'nothing uses it yet'}. Every scheme dropdown shows the new name. Issued invoices keep the name they were issued with. The old name is kept, so anything still saying it is found.`))) return
    }
    const r = await run(() => saveMasterScheme(me, v, m?.id))
    if (r && typeof r === 'object') { toast('success', renamed ? `Renamed — changed in: ${r.changed}` : m ? 'Scheme saved' : 'Scheme added'); onClose() }
  }
  return (
    <Modal open onClose={onClose} title={m ? `Edit “${m.name}”` : 'Add scheme'} size="md"
      subtitle={m ? 'The name is the scheme’s official name everywhere in the CRM.' : 'A new scheme in the master list — it appears in every scheme dropdown.'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon={Save} onClick={save}>{renamed ? 'Rename everywhere' : 'Save'}</Button></>}>
      <div className="grid gap-3">
        <Input label="Scheme name" value={v.name} maxLength={120} autoFocus onChange={(e) => setV({ ...v, name: e.target.value })} />
        {renamed && used && <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">Changes in: {USAGE_LABELS.filter(([k]) => used[k]).map(([k, l]) => `${l} ${used[k]}`).join(' · ') || 'nothing uses it yet'}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Category" list="scheme-categories" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} hint="Also the Sales Kit's category" />
          <datalist id="scheme-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-card2 px-3 py-2.5 text-sm"><span><b>Active</b><span className="block text-xs text-mute">Inactive schemes leave the dropdowns</span></span><Toggle checked={v.active} onChange={(a) => setV({ ...v, active: a })} label="Active" /></label>
        </div>
        <Textarea label="Short description (optional)" rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </div>
      {node}
    </Modal>
  )
}

function MergeModal({ keep, master, onClose }: { keep: SchemeMaster; master: SchemeMaster[]; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const [drop, setDrop] = useState('')
  const other = master.find((x) => x.id === drop)
  const used = other ? usageOf(db, other) : null
  return (
    <Modal open onClose={onClose} title={`Merge a duplicate into “${keep.name}”`} size="md"
      subtitle="Two records for the same scheme: everything linked to the duplicate moves here and takes this name; the duplicate's name is kept as an old name."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon={Combine} disabled={!other} onClick={async () => { const r = await run(() => mergeMasterSchemes(me, keep.id, drop)); if (typeof r === 'string') { toast('success', `Merged — renamed in: ${r}`); onClose() } }}>Merge</Button></>}>
      <Select label="The duplicate" value={drop} onChange={(e) => setDrop(e.target.value)}>
        <option value="">— Pick the duplicate —</option>{master.filter((x) => x.id !== keep.id).sort((a, b) => a.name.localeCompare(b.name)).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.category}</option>)}
      </Select>
      {other && used && <p className="mt-3 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">“{other.name}” is used in: {USAGE_LABELS.filter(([k]) => used[k]).map(([k, l]) => `${l} ${used[k]}`).join(' · ') || 'nothing'} — all of it becomes “{keep.name}”.</p>}
    </Modal>
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
function AddToKit({ schemeId, kits, live, onNew }: { schemeId: string; kits: Kit[]; live: SalesKitItem[]; onNew: () => void }) {
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
  const one = live.filter((x) => x.id === schemeId)
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="ghost" icon={BookmarkPlus} onClick={() => setOpenMenu(!openMenu)} aria-expanded={openMenu}>Add to kit</Button>
      {openMenu && (
        <div className="anim-pop absolute right-0 top-full z-30 mt-1 w-64 rounded-xl border border-line bg-card p-1.5 shadow-pop">
          {kits.map((k) => {
            const inKit = kitItems(k, one, t).length > 0
            return (
              <button key={k.id} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-card2"
                onClick={() => run(() => toggleKitScheme(me, k.id, schemeId, !inKit), inKit ? `Taken out of ${k.name}` : `Added to ${k.name}`)}>
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
