import { useState } from 'react'
import { CalendarRange, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { Scheme } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { deleteScheme, upsertScheme, userName } from '../../lib/actions'
import { fmtDate, fmtDateTime, inr } from '../../lib/format'
import { istToday, schemeDaysLeft, schemeDuration, schemeState, type SchemeState } from '../../../supabase/workflow-rules.mjs'
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, SearchBox, Tabs, Textarea, Toggle, useConfirm, useRun } from '../../components/ui'

type Edit = Omit<Scheme, 'id' | 'createdAt' | 'by' | 'updatedAt' | 'updatedBy'> & { id?: string }
const blank: Edit = { title: '', category: 'Grant', summary: '', benefit: '', eligibility: '', active: true, price: undefined, startDate: '', endDate: '' }
const STATE: Record<SchemeState, { label: string; tone: 'green' | 'blue' | 'red' | 'gray' | 'amber' }> = {
  ACTIVE: { label: 'Active', tone: 'green' }, UPCOMING: { label: 'Upcoming', tone: 'blue' }, EXPIRED: { label: 'Expired', tone: 'red' },
  INACTIVE: { label: 'Inactive', tone: 'gray' }, NO_DATES: { label: 'No dates', tone: 'amber' },
}

/**
 * Schemes with price, start and end date. Admin and the Operation team edit them (enforced in the actions and in the
 * database); sales see a read-only card with the name, dates, price and details — never expired or inactive ones.
 */
export default function Schemes() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const manage = can('schemes.manage')
  const t = istToday()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'live' | 'EXPIRED' | 'all'>('live')
  const [edit, setEdit] = useState<Edit | null>(null)
  const live = (s: Scheme) => ['ACTIVE', 'UPCOMING', 'NO_DATES'].includes(schemeState(s, t))
  const list = db.schemes
    .filter((s) => (manage ? (tab === 'all' || (tab === 'live' ? live(s) : schemeState(s, t) === 'EXPIRED')) : live(s)))
    .filter((s) => !q || `${s.title} ${s.summary} ${s.category}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999'))
  const days = edit?.startDate && edit.endDate && edit.endDate >= edit.startDate ? schemeDuration(edit) : null

  return (
    <div>
      <PageHeader title="Schemes" subtitle={manage ? 'Price, start and end date for each scheme — Admin and Operations are reminded the day before one ends' : 'Government schemes you can offer — name, dates, price and details (added by Admin and the Operation team)'} icon={Sparkles}
        actions={<>{manage && <Button variant="accent" icon={Plus} onClick={() => setEdit({ ...blank })}>Add scheme</Button>}</>} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search schemes…" className="max-w-md flex-1" />
        {manage && <Tabs value={tab} onChange={setTab} tabs={[
          { id: 'live', label: 'Active & upcoming', count: db.schemes.filter(live).length },
          { id: 'EXPIRED', label: 'Expired', count: db.schemes.filter((s) => schemeState(s, t) === 'EXPIRED').length },
          { id: 'all', label: 'All', count: db.schemes.length },
        ]} />}
      </div>
      {!list.length ? <Card><EmptyState icon={Sparkles} title="No schemes" /></Card> : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s, i) => {
            const st = schemeState(s, t), left = schemeDaysLeft(s, t), dur = schemeDuration(s)
            return (
              <Card key={s.id} className="flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-pop anim-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="relative bg-gradient-to-br from-[#2E3A8C] to-[#4b5bc4] p-5 text-white">
                  <span className="flex flex-wrap gap-1.5">{manage && <Badge tone="orange" className="bg-white/90">{s.category}</Badge>}<Badge tone={STATE[st].tone} className="bg-white/90">{STATE[st].label}</Badge></span>
                  <h3 className="mt-3 text-lg font-extrabold">{s.title}</h3>
                  {s.price != null && <p className="mt-1 text-2xl font-extrabold text-[#F4A12A]">{inr(s.price)}</p>}
                  {manage && s.benefit && <p className="mt-1 text-sm font-semibold text-white/85">{s.benefit}</p>}
                </div>
                <div className="flex flex-1 flex-col p-5 text-sm">
                  {s.startDate && s.endDate && (
                    <p className="mb-3 flex items-center gap-2 rounded-xl bg-card2 px-3 py-2 text-xs">
                      <CalendarRange className="size-4 text-brand-ink" />
                      <span><b>{fmtDate(s.startDate)} – {fmtDate(s.endDate)}</b>{dur ? ` · ${dur} days` : ''}
                        {st === 'ACTIVE' && left != null && <span className={left <= 1 ? 'font-semibold text-bad' : 'text-mute'}> · {left === 0 ? 'ends today' : `${left} day${left === 1 ? '' : 's'} left`}</span>}
                        {st === 'UPCOMING' && <span className="text-mute"> · starts in {schemeDaysLeft({ endDate: s.startDate }, t)} days</span>}</span>
                    </p>
                  )}
                  <p className="flex-1 text-mute">{s.summary}</p>
                  {manage && s.eligibility && <p className="mt-3 rounded-xl bg-card2 p-3 text-xs"><b>Eligibility:</b> {s.eligibility}</p>}
                  {manage && (
                    <div className="mt-3 flex items-center justify-between text-[11px] text-mute">
                      <span>Updated {fmtDateTime(s.updatedAt ?? s.createdAt)}{s.updatedBy ? ` by ${userName(db, s.updatedBy)}` : ''}</span>
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setEdit({ ...s, startDate: s.startDate ?? '', endDate: s.endDate ?? '' })} />
                        <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete" className="text-bad" onClick={async () => { if (await confirm('Delete scheme?', s.title, true)) run(() => deleteScheme(me, s.id), 'Deleted') }} />
                      </span>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit scheme' : 'New scheme'}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={async () => { if (edit && await run(() => upsertScheme(me, { ...edit, startDate: edit.startDate || undefined, endDate: edit.endDate || undefined }), 'Scheme saved')) setEdit(null) }}>Save</Button></>}>
        {edit && <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Scheme name" required value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className="sm:col-span-2" />
          <Input label="Price (₹)" type="number" min={0} value={edit.price ?? ''} onChange={(e) => setEdit({ ...edit, price: e.target.value === '' ? undefined : Number(e.target.value) })} />
          <Input label="Category" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} />
          <Input label="Start date" type="date" value={edit.startDate ?? ''} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} />
          <Input label="End date" type="date" min={edit.startDate || undefined} value={edit.endDate ?? ''} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })}
            error={edit.startDate && edit.endDate && edit.endDate < edit.startDate ? 'Must be on or after the start date' : undefined} hint={days ? `Duration ${days} days · reminder the day before it ends` : undefined} />
          <Input label="Benefit" value={edit.benefit} onChange={(e) => setEdit({ ...edit, benefit: e.target.value })} placeholder="e.g. Up to ₹20 lakh" className="sm:col-span-2" />
          <Textarea label="Description / details" value={edit.summary} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} className="sm:col-span-2" />
          <Textarea label="Eligibility / conditions" value={edit.eligibility} onChange={(e) => setEdit({ ...edit, eligibility: e.target.value })} className="sm:col-span-2" />
          <label className="flex items-center gap-3 text-sm"><Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />Active (visible to sales while within its dates)</label>
        </div>}
      </Modal>
      {node}
    </div>
  )
}
