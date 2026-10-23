import { useMemo, useState } from 'react'
import { BookMarked, ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react'
import type { SalesKitItem } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { deleteSalesKitItem, saveSalesKitItem, userName, type SalesKitInput } from '../../lib/actions'
import { fmtDateTime } from '../../lib/format'
import { daysBetween, istToday } from '../../../supabase/workflow-rules.mjs'
import { Badge, Button, Card, cx, EmptyState, Input, Modal, PageHeader, SearchBox, Select, Tabs, Textarea, useConfirm, useRun } from '../../components/ui'

const CATEGORIES = ['Grant', 'Grant + Debt + Equity', 'Debt + Equity', 'Equity', 'Loan', 'Loan + Subsidy', 'Certification / GeM / Award']
const blank: SalesKitInput = { category: 'Grant', name: '', benefits: '', sectors: '', eligibility: '', lastDate: 'Rolling basis', organisation: '', schemeType: '', applicableFor: 'Pan India', minCharge: '' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "18 Nov 2026" → 2026-11-18 (anything else, like "Rolling basis", has no date). */
const ymdOf = (s: string) => { const m = s.match(/^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/); const i = m ? MONTHS.indexOf(m[2]!) : -1; return m && i >= 0 ? `${m[3]}-${String(i + 1).padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null }

/**
 * Sales Kit: every scheme sales can offer — benefits, sectors, eligibility, last date, who runs it and our charge.
 * Everyone reads it; only the Operation team edits it (saleskit.manage, checked in the actions and the database).
 */
export default function SalesKit() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const manage = can('saleskit.manage')
  const items = db.salesKit ?? []
  const cats = useMemo(() => [...new Set([...CATEGORIES, ...items.map((x) => x.category)])].filter((c) => items.some((x) => x.category === c)), [items])
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id?: string; v: SalesKitInput } | null>(null)
  const t = istToday()
  const list = items
    .filter((x) => cat === 'all' || x.category === cat)
    .filter((x) => !q || `${x.name} ${x.benefits} ${x.sectors} ${x.eligibility} ${x.organisation} ${x.applicableFor} ${x.schemeType}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => cats.indexOf(a.category) - cats.indexOf(b.category) || a.position - b.position)

  const closing = (x: SalesKitItem) => {
    const d = ymdOf(x.lastDate)
    if (!d) return null
    const left = daysBetween(t, d)
    return left < 0 ? { tone: 'red' as const, text: 'Closed' } : left <= 7 ? { tone: 'amber' as const, text: left === 0 ? 'Closes today' : `Closes in ${left} day${left === 1 ? '' : 's'}` } : null
  }

  return (
    <div>
      <PageHeader title="Sales Kit" subtitle={manage ? 'Schemes, benefits, eligibility, last dates and our charges — you keep this up to date for the sales team' : 'Every scheme you can offer — benefits, who can apply, the last date and our charge (kept up to date by the Operation team)'} icon={BookMarked}
        actions={manage && <Button variant="accent" icon={Plus} onClick={() => setEdit({ v: { ...blank, category: cat !== 'all' ? cat : 'Grant' } })}>Add scheme</Button>} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Tabs value={cat} onChange={setCat} tabs={[{ id: 'all', label: 'All', count: items.length }, ...cats.map((c) => ({ id: c, label: c, count: items.filter((x) => x.category === c).length }))]} />
        <SearchBox value={q} onChange={setQ} placeholder="Search scheme, sector, state, eligibility…" className="min-w-60 flex-1" />
      </div>
      {!list.length ? <Card><EmptyState icon={BookMarked} title={items.length ? 'No schemes match' : 'The Sales Kit is empty'} text={items.length ? 'Try another search or category.' : manage ? 'Add the first scheme.' : 'The Operation team adds schemes here.'} /></Card> : (
        <div className="space-y-3">
          {list.map((x) => {
            const isOpen = open === x.id, c = closing(x)
            return (
              <Card key={x.id} className="overflow-hidden">
                <button className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-left hover:bg-card2/50" onClick={() => setOpen(isOpen ? null : x.id)} aria-expanded={isOpen}>
                  <span className="min-w-0 flex-1 basis-64">
                    <span className="flex flex-wrap items-center gap-2"><b className="text-[15px]">{x.name}</b><Badge tone="violet">{x.category}</Badge>{c && <Badge tone={c.tone}>{c.text}</Badge>}</span>
                    <span className="mt-0.5 block truncate text-xs text-mute">{[x.organisation, x.schemeType, x.applicableFor].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-right text-xs"><span className="block text-mute">Last date</span><b>{x.lastDate || '—'}</b></span>
                  <span className="text-right text-xs"><span className="block text-mute">Our charge</span><b className="text-brand-ink">{x.minCharge || '—'}</b></span>
                  {isOpen ? <ChevronUp className="size-4 text-mute" /> : <ChevronDown className="size-4 text-mute" />}
                </button>
                {isOpen && (
                  <div className="border-t border-line px-5 py-4">
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
                      {manage && <>
                        <Button size="sm" variant="outline" icon={Pencil} onClick={() => { const { id, position: _p, updatedAt: _u, updatedBy: _b, ...v } = x; setEdit({ id, v }) }}>Edit</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={async () => { if (await confirm(`Remove “${x.name}”?`, 'It disappears from the Sales Kit for everyone.', true)) run(() => deleteSalesKitItem(me, x.id), 'Removed') }}>Remove</Button>
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
      {node}
    </div>
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
        <Textarea label="Focus sectors" rows={4} value={v.sectors} onChange={(e) => set({ sectors: e.target.value })} />
        <Textarea label="Eligibility criteria" rows={4} value={v.eligibility} onChange={(e) => set({ eligibility: e.target.value })} />
        <Input label="Funding organisation" value={v.organisation} onChange={(e) => set({ organisation: e.target.value })} />
        <Input label="Type of scheme" value={v.schemeType} onChange={(e) => set({ schemeType: e.target.value })} />
        <Input label="Applicable for" value={v.applicableFor} onChange={(e) => set({ applicableFor: e.target.value })} hint="Pan India, or the state(s)" />
        <Input label="Our minimum charge (upfront)" value={v.minCharge} onChange={(e) => set({ minCharge: e.target.value })} placeholder="INR 10,000 + 18% GST" />
        <Textarea label="Govt registration charge / note (optional)" rows={2} value={v.registrationCharge ?? ''} onChange={(e) => set({ registrationCharge: e.target.value })} className="sm:col-span-2" />
      </div>
    </Modal>
  )
}
