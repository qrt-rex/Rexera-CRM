import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookMarked, Check, ChevronDown, ChevronUp, Download, FileSpreadsheet, Library, Link2, Lock, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import type { SalesKitItem, SchemeFilter } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { canEditSchemesUser } from '../../lib/rbac'
import { deleteSalesKitItem, importSalesKit, saveSalesKitItem, userName, type SalesKitInput } from '../../lib/actions'
import { readGoogleSheet, readSheets } from '../../lib/bulkUsers'
import { masterList } from '../../lib/schemeMaster'
import { fmtDateTime } from '../../lib/format'
import { istToday } from '../../../supabase/workflow-rules.mjs'
import { AMOUNT_BANDS, CHARGE_BANDS, CLOSING, closingOf, emptyFilter, filterCount, matches, optionsOf, planSchemeImport, SORTS, sortItems, type ImportRow } from '../../../supabase/scheme-kit-rules.mjs'
import { linkedMaster } from '../../../supabase/scheme-master-rules.mjs'
import { Badge, Button, Card, cx, EmptyState, Input, Modal, PageHeader, SearchBox, Select, Textarea, useConfirm, useRun, useToast } from '../../components/ui'
import { FilterBar, MultiFilter } from '../../components/MultiFilter'

const CATEGORIES = ['Grant', 'Grant + Debt + Equity', 'Debt + Equity', 'Equity', 'Loan', 'Loan + Subsidy', 'Certification / GeM / Award']
const blank: SalesKitInput = { category: 'Grant', name: '', benefits: '', sectors: '', eligibility: '', lastDate: 'Rolling basis', organisation: '', schemeType: '', applicableFor: 'Pan India', minCharge: '' }
const CLOSE_TONE: Record<string, 'red' | 'amber' | 'blue' | 'green' | 'gray'> = { closed: 'red', week: 'amber', month: 'blue', open: 'green', rolling: 'gray' }
const CLOSE_TEXT = Object.fromEntries(CLOSING)

/**
 * Sales Kit — what sales tells clients about each scheme: benefits, sectors, eligibility, last date, who runs it and our
 * charge. Kept on its own; the scheme names come from the Scheme Kit (renamed there, they change here by themselves).
 * Everyone reads it; the Operation Team, IT Support and Super Admin change it (the database checks the same).
 */
export default function SalesKit() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const editor = canEditSchemesUser(me) && can('saleskit.manage')
  const items = db.salesKit ?? []
  const t = istToday()
  const [f, setF] = useState<SchemeFilter>(emptyFilter)
  const [sort, setSort] = useState('')
  const set = (p: Partial<SchemeFilter>) => setF((x) => ({ ...x, ...p }))
  const [open, setOpen] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id?: string; v: SalesKitInput } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const cats = useMemo(() => [...new Set([...CATEGORIES, ...items.map((x) => x.category)])].filter((c) => items.some((x) => x.category === c)), [items])
  const opt = (field: keyof SalesKitItem) => optionsOf(items, field).map((o) => ({ value: o.label, label: o.label, count: o.count }))
  const list = sortItems(items.filter((x) => matches(x, f, t)).sort((a, b) => cats.indexOf(a.category) - cats.indexOf(b.category) || a.position - b.position), sort, t)
  const active = filterCount(f)
  const download = async (rows: SalesKitItem[]) => {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(rows.map((x) => ({
      Category: x.category, 'Scheme name': x.name, Benefits: x.benefits, 'Focus sectors': x.sectors, Eligibility: x.eligibility, 'Last date': x.lastDate,
      'Funding organisation': x.organisation, 'Type of scheme': x.schemeType, 'Applicable for': x.applicableFor, 'Our minimum charge': x.minCharge, 'Govt registration charge': x.registrationCharge ?? '',
    })))
    ws['!cols'] = [14, 32, 50, 36, 36, 16, 28, 18, 20, 24, 24].map((w) => ({ wch: w }))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sales Kit')
    XLSX.writeFile(wb, 'Sales Kit.xlsx')
  }

  return (
    <div>
      <PageHeader title="Sales Kit" icon={BookMarked}
        subtitle={editor ? 'What sales tells clients about each scheme — benefits, eligibility, last dates and our charges. Scheme names come from the Scheme Kit.' : 'Every scheme you can offer — benefits, who can apply, the last date and our charge (kept up to date by the Operation Team)'}
        actions={<>
          <Link to="/scheme-kit"><Button variant="outline" icon={Library}>Scheme Kit</Button></Link>
          {editor && <Button variant="outline" icon={Upload} onClick={() => setImportOpen(true)}>Import from a sheet</Button>}
          {editor && <Button variant="accent" icon={Plus} onClick={() => setEdit({ v: { ...blank, category: f.categories[0] ?? 'Grant' } })}>Add scheme</Button>}
        </>} />

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
          <MultiFilter label="Last date" keepOrder options={CLOSING.map(([v, l]) => ({ value: v, label: l, count: items.filter((x) => closingOf(x, t) === v).length }))} value={f.closing} onChange={(v) => set({ closing: v })} />
          <Select aria-label="Benefit amount" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className={cx('!h-10 w-auto', f.amount && 'border-brand')}>{AMOUNT_BANDS.map(([v, l]) => <option key={v} value={v}>{v ? `Benefit: ${l}` : 'Any benefit amount'}</option>)}</Select>
          <Select aria-label="Our charge" value={f.charge} onChange={(e) => set({ charge: e.target.value })} className={cx('!h-10 w-auto', f.charge && 'border-brand')}>{CHARGE_BANDS.map(([v, l]) => <option key={v} value={v}>{v ? `Charge: ${l}` : 'Any charge'}</option>)}</Select>
        </FilterBar>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-mute">
          <span><b className="text-ink">{list.length}</b> of {items.length} schemes</span>
          <Button size="sm" variant="ghost" icon={Download} className="ml-auto" onClick={() => void download(list)}>Download {list.length} as Excel</Button>
        </div>
      </Card>

      {!list.length ? <Card><EmptyState icon={BookMarked} title={items.length ? 'No schemes match' : 'The Sales Kit is empty'} text={items.length ? 'Change or clear the filters.' : editor ? 'Add the first scheme, or import them from a sheet.' : 'The Operation Team adds schemes here.'} /></Card> : (
        <div className="space-y-3">
          {list.map((x) => {
            const isOpen = open === x.id, c = closingOf(x, t)
            return (
              <Card key={x.id} className="overflow-hidden">
                <button className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left hover:bg-card2/50" onClick={() => setOpen(isOpen ? null : x.id)} aria-expanded={isOpen}>
                  <span className="min-w-0 flex-1 basis-64">
                    <span className="flex flex-wrap items-center gap-2"><b className="text-[15px]">{x.name}</b><Badge tone="violet">{x.category}</Badge>{c !== 'unknown' && c !== 'open' && <Badge tone={CLOSE_TONE[c] ?? 'gray'}>{CLOSE_TEXT[c]}</Badge>}</span>
                    <span className="mt-0.5 block truncate text-xs text-mute">{[x.organisation, x.schemeType, x.applicableFor].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-right text-xs"><span className="block text-mute">Last date</span><b>{x.lastDate || '—'}</b></span>
                  <span className="text-right text-xs"><span className="block text-mute">Our charge</span><b className="text-brand-ink">{x.minCharge || '—'}</b></span>
                  {isOpen ? <ChevronUp className="size-4 text-mute" /> : <ChevronDown className="size-4 text-mute" />}
                </button>
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
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={async () => { if (await confirm(`Remove “${x.name}” from the Sales Kit?`, 'Its sales details go (kept in Deleted items); the scheme stays in the Scheme Kit.', true)) run(() => deleteSalesKitItem(me, x.id), 'Removed') }}>Remove</Button>
                      </>}
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
      {edit && <SalesKitEditor init={edit.v} id={edit.id} categories={[...new Set([...CATEGORIES, ...cats])]} onClose={() => setEdit(null)} />}
      {importOpen && <ImportSchemes items={items} onClose={() => setImportOpen(false)} />}
      {node}
    </div>
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


/**
 * Add / edit a Sales Kit scheme. The name is picked from the Scheme Kit (a name not there yet becomes a new Scheme Kit
 * scheme); a scheme already linked keeps its Scheme Kit name — renamed only there, so it changes everywhere at once.
 */
function SalesKitEditor({ init, id, categories, onClose }: { init: SalesKitInput; id?: string; categories: string[]; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [v, setV] = useState<SalesKitInput>(init)
  const set = (p: Partial<SalesKitInput>) => setV((x) => ({ ...x, ...p }))
  const master = masterList(db)
  const linked = id ? linkedMaster(master, 'salesKit', id) : undefined
  const pick = (name: string) => { const m = master.find((x) => x.name === name); set({ name, ...(m ? { category: m.category } : {}) }) }
  return (
    <Modal open onClose={onClose} title={id ? 'Edit scheme' : 'Add scheme'} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={async () => { if (await run(() => saveSalesKitItem(me, v, id), id ? 'Scheme updated' : 'Scheme added')) onClose() }}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {linked ? (
          <div className="sm:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold text-mute">Scheme name</span>
            <p className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card2 px-3 py-2.5 text-sm"><Lock className="size-4 text-mute" /><b>{linked.name}</b>
              <Link to="/scheme-kit" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"><Link2 className="size-3.5" />Rename in the Scheme Kit</Link></p>
            <p className="mt-1 text-[11px] text-mute">Names are managed in the Scheme Kit — a new name there changes here, in every dropdown and on CRM entries.</p>
          </div>
        ) : (
          <>
            <Input label="Scheme name" list="scheme-kit-names" value={v.name} onChange={(e) => pick(e.target.value)} className="sm:col-span-2"
              hint={master.length ? 'Pick from the Scheme Kit — a new name is added to the Scheme Kit' : 'The Scheme Kit is not set up yet'} />
            <datalist id="scheme-kit-names">{master.filter((m) => m.active).map((m) => <option key={m.id} value={m.name} />)}</datalist>
          </>
        )}
        <Select label="Category" value={v.category} onChange={(e) => set({ category: e.target.value })}>{[...new Set([...categories, v.category])].map((c) => <option key={c}>{c}</option>)}</Select>
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
