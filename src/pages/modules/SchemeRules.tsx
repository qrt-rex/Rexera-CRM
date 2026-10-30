import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, BadgeCheck, CalendarClock, Copy, Eye, EyeOff, ListChecks, Pencil, Plus, RotateCcw, Save, ScanSearch, Trash2, TriangleAlert, X } from 'lucide-react'
import type { EligibilityCondition, EligibilityRule, EligibilityScheme } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { canEditSchemeRules } from '../../lib/rbac'
import { checkerSchemes, deleteEligibilityScheme, moveEligibilityScheme, restoreBuiltInSchemes, saveEligibilityScheme, setEligibilitySchemeActive, usingBuiltInSchemes, type SchemeInput } from '../../lib/eligibility'
import { daysBetween, fmtDate, inr, today, uid } from '../../lib/format'
import { checkScheme, DEFAULT_SCHEMES, DEFAULTS_CHECKED, describeRule, FIELDS, OPS, schemeProblems, STATUS, type EligibilityProfile } from '../../../supabase/eligibility-rules.mjs'
import { CHECK_ICON, Lakh, loadCheckedProfile, ProfileFields, serviceFor } from '../../components/EligibilityChecker'
import { Badge, Button, Card, Checkbox, cx, EmptyState, Input, Menu, MenuItem, Modal, PageHeader, Select, Tabs, Textarea, useConfirm, useRun, useSubmitting, useToast } from '../../components/ui'
import { MiniStat } from '../dashboards/widgets'

/** Rules older than this are flagged: government schemes change, so the team re-checks them against the official site. */
const STALE_DAYS = 180
const fieldGroups = [
  { label: 'Client details', keys: Object.keys(FIELDS).filter((k) => !FIELDS[k]!.derived) },
  { label: 'Worked out from them', keys: Object.keys(FIELDS).filter((k) => FIELDS[k]!.derived) },
]
const blankScheme = (): SchemeInput => ({
  active: true, name: '', kind: '', agency: '', url: '', serviceMatch: '', statusNote: '', summary: '', benefits: [], documents: [], process: [], conditions: [], verifiedOn: today(),
})
const blankCondition = (): EligibilityCondition => ({ id: uid('c'), label: '', field: 'projectCost', op: 'lte', value: 10e5, otherwise: 'fail' })
const toForm = (s: EligibilityScheme): SchemeInput => {
  const { id: _id, position: _p, updatedAt: _u, updatedBy: _b, ...rest } = structuredClone(s)
  return rest
}
const stale = (d?: string) => !d || daysBetween(d, today()) > STALE_DAYS

/**
 * Scheme Checker Rules: the government schemes Rexy's Scheme Checker uses — details, the conditions a client is
 * checked against, benefits, documents, how to apply, subsidy and loan bands. Super Admin and the Operation team edit
 * them (the database allows nobody else); sales people see every change at once.
 */
export default function SchemeRules() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const [confirm, confirmNode] = useConfirm()
  const editor = canEditSchemeRules(db, me)
  const schemes = checkerSchemes(db)
  const builtIn = usingBuiltInSchemes(db)
  const [edit, setEdit] = useState<{ id?: string; form: SchemeInput } | null>(null)
  const active = schemes.filter((s) => s.active !== false)
  const conds = schemes.reduce((n, s) => n + s.conditions.length, 0)
  const old = schemes.filter((s) => stale(s.verifiedOn))

  if (!editor) return <Card><EmptyState icon={BadgeCheck} title="Only Super Admin and the Operation team edit the Scheme Checker rules" text="Sales people use the checker in Rexy (the assistant button)." /></Card>

  return (
    <div>
      <PageHeader title="Scheme Checker Rules" icon={BadgeCheck}
        subtitle="What Rexy’s Scheme Checker checks: each government scheme, its conditions, benefits, documents and how to apply. Sales people see every change at once."
        actions={<>
          <Menu width="w-72" trigger={(o) => <Button variant="outline" icon={RotateCcw} aria-expanded={o}>Built-in schemes</Button>}>
            {(close) => <>
              <MenuItem icon={Plus} onClick={async () => { close(); const n = await run(() => restoreBuiltInSchemes(me, 'missing')); if (typeof n === 'number') toast('success', n ? `${n} built-in scheme(s) added back` : 'Every built-in scheme is already here') }}>Add back missing built-in schemes</MenuItem>
              <MenuItem icon={RotateCcw} danger onClick={async () => { close(); if (await confirm('Reset every scheme to the built-in rules?', `Your changes and added schemes are replaced by the ${DEFAULT_SCHEMES.length} built-in schemes (rules checked ${fmtDate(DEFAULTS_CHECKED)}). This cannot be undone.`, true)) run(() => restoreBuiltInSchemes(me, 'all'), 'Back to the built-in schemes') }}>Reset all to built-in…</MenuItem>
            </>}
          </Menu>
          <Button variant="accent" icon={Plus} onClick={() => setEdit({ form: blankScheme() })}>Add scheme</Button>
        </>} />

      {builtIn && <p className="mb-4 flex items-start gap-2 rounded-2xl border border-info/30 bg-info-soft px-4 py-3 text-sm text-info"><ListChecks className="mt-0.5 size-4 shrink-0" />The checker is using the built-in schemes (rules checked {fmtDate(DEFAULTS_CHECKED)}). Your first change saves them here, so the team owns them from then on.</p>}
      {old.length > 0 && <p className="mb-4 flex items-start gap-2 rounded-2xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" /><span><b>{old.length} scheme(s) not checked for over {STALE_DAYS} days:</b> {old.map((s) => s.name).join(', ')}. Check them against the official site and update the “rules last checked” date.</span></p>}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Schemes shown to sales" value={`${active.length} of ${schemes.length}`} icon={Eye} tone="green" />
        <MiniStat label="Conditions checked" value={conds} icon={ListChecks} />
        <MiniStat label="Oldest rules check" value={schemes.length ? fmtDate(schemes.map((s) => s.verifiedOn).sort()[0]) : '—'} icon={CalendarClock} tone={old.length ? 'amber' : 'navy'} />
      </div>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-line/70">
          {schemes.map((s, i) => {
            const svc = serviceFor(db.services, s)
            return (
              <li key={s.id} className={cx('flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap', s.active === false && 'bg-card2/50')}>
                <span className="flex flex-col">
                  <button type="button" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => run(() => moveEligibilityScheme(me, s.id, -1))} className="grid size-6 place-items-center rounded text-mute hover:bg-card2 hover:text-ink disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                  <button type="button" aria-label={`Move ${s.name} down`} disabled={i === schemes.length - 1} onClick={() => run(() => moveEligibilityScheme(me, s.id, 1))} className="grid size-6 place-items-center rounded text-mute hover:bg-card2 hover:text-ink disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                </span>
                <button type="button" onClick={() => setEdit({ id: s.id, form: toForm(s) })} className="min-w-0 flex-1 text-left">
                  <span className="flex flex-wrap items-center gap-2"><b className={cx('truncate', s.active === false && 'text-mute line-through')}>{s.name}</b>{s.active === false && <Badge tone="gray">Hidden</Badge>}{s.statusNote && <Badge tone="amber">Note</Badge>}</span>
                  <span className="block truncate text-xs text-mute">{[s.kind, s.agency].filter(Boolean).join(' · ')} · {s.conditions.length} condition{s.conditions.length === 1 ? '' : 's'}{s.subsidy ? ' · subsidy' : ''}{s.bands ? ' · bands' : ''}{svc ? ` · service: ${svc.name}` : ''}</span>
                  <span className={cx('block text-[11px]', stale(s.verifiedOn) ? 'font-semibold text-warn' : 'text-mute')}>Rules checked {fmtDate(s.verifiedOn)}{s.updatedBy ? ` · edited by ${userName(db, s.updatedBy)}` : ''}</span>
                </button>
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" icon={s.active === false ? Eye : EyeOff} title={s.active === false ? 'Show to sales people' : 'Hide from sales people'} aria-label={s.active === false ? `Show ${s.name}` : `Hide ${s.name}`}
                    onClick={() => run(() => setEligibilitySchemeActive(me, s.id, s.active === false), s.active === false ? 'Shown in the checker' : 'Hidden from the checker')} />
                  <Button size="sm" variant="ghost" icon={Copy} title="Copy as a new scheme" aria-label={`Copy ${s.name}`} onClick={() => setEdit({ form: { ...toForm(s), name: `${s.name} (copy)`, conditions: s.conditions.map((c) => ({ ...structuredClone(c), id: uid('c') })) } })} />
                  <Button size="sm" variant="soft" icon={Pencil} onClick={() => setEdit({ id: s.id, form: toForm(s) })}>Edit</Button>
                  <Button size="sm" variant="ghost" icon={Trash2} className="text-bad" aria-label={`Remove ${s.name}`} onClick={async () => { if (await confirm(`Remove ${s.name}?`, 'It disappears from the Scheme Checker. To keep it for later, hide it instead.', true)) run(() => deleteEligibilityScheme(me, s.id), 'Scheme removed') }} />
                </span>
              </li>
            )
          })}
        </ul>
      </Card>

      {edit && <SchemeEditor key={edit.id ?? 'new'} id={edit.id} initial={edit.form} onClose={() => setEdit(null)} />}
      {confirmNode}
    </div>
  )
}

type Tab = 'details' | 'conditions' | 'info' | 'extras' | 'test'

function SchemeEditor({ id, initial, onClose }: { id?: string; initial: SchemeInput; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [busy, once] = useSubmitting()
  const [f, setF] = useState<SchemeInput>(initial)
  const [tab, setTab] = useState<Tab>('details')
  const [tried, setTried] = useState(false)
  const [p, setP] = useState<EligibilityProfile>(() => loadCheckedProfile(me.id))
  const set = <K extends keyof SchemeInput>(k: K, v: SchemeInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const problems = schemeProblems(f)
  const test = useMemo(() => checkScheme({ ...f, id: id ?? 'draft', position: 0 }, p, today()), [f, p, id])
  const svc = serviceFor(db.services, { ...f, id: '', position: 0 })
  const setCond = (i: number, c: EligibilityCondition) => set('conditions', f.conditions.map((x, j) => (j === i ? c : x)))
  const moveCond = (i: number, d: -1 | 1) => { const l = [...f.conditions]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j]!, l[i]!]; set('conditions', l) }

  const save = () => once(async () => {
    setTried(true)
    if (problems.length) return
    if (await run(() => saveEligibilityScheme(me, f, id), id ? 'Scheme saved — the checker uses it now' : 'Scheme added to the checker')) onClose()
  })

  return (
    <Modal open onClose={onClose} size="xl" title={id ? `Edit · ${initial.name}` : 'Add scheme'}
      subtitle="Conditions decide the result: any mismatch that means “not eligible” rules the scheme out; anything not known yet leaves it “to confirm”."
      footer={<>
        {tried && problems.length > 0 && <p className="mr-auto max-w-md text-xs font-semibold text-bad">{problems[0]}{problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}</p>}
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button icon={Save} loading={busy} onClick={save}>{id ? 'Save changes' : 'Add scheme'}</Button>
      </>}>
      <Tabs className="mb-4 w-fit max-w-full" value={tab} onChange={setTab} tabs={[
        { id: 'details', label: 'Details' }, { id: 'conditions', label: 'Conditions', count: f.conditions.length }, { id: 'info', label: 'Benefits & documents' },
        { id: 'extras', label: 'Subsidy & bands' }, { id: 'test', label: 'Test', icon: ScanSearch },
      ]} />

      {tab === 'details' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Scheme name" required value={f.name} onChange={(e) => set('name', e.target.value)} className="sm:col-span-2" placeholder="e.g. PMEGP — Prime Minister’s Employment Generation Programme" />
          <Input label="Kind" value={f.kind} onChange={(e) => set('kind', e.target.value)} placeholder="Loan + subsidy, Grant, Registration…" />
          <Input label="Agency" value={f.agency} onChange={(e) => set('agency', e.target.value)} placeholder="KVIC, banks, DPIIT…" />
          <Input label="Official site" value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://…" />
          <Input label="Rules last checked on" required type="date" max={today()} value={f.verifiedOn} onChange={(e) => set('verifiedOn', e.target.value)} hint={`Flagged after ${STALE_DAYS} days — re-check against the official guidelines`} />
          <Input label="Matching Rexera service (a word in its name)" value={f.serviceMatch} onChange={(e) => set('serviceMatch', e.target.value)} placeholder="e.g. pmegp" hint={svc ? `Shows: ${svc.name} · ${inr(svc.price)}` : f.serviceMatch ? 'No active service has this word in its name' : 'Sales people see our service and price with the scheme'} />
          <div className="flex items-end pb-2"><Checkbox checked={f.active} onChange={(v) => set('active', v)} label="Shown to sales people in the checker" /></div>
          <Textarea label="Summary (one line: what the client gets)" required rows={2} value={f.summary} onChange={(e) => set('summary', e.target.value)} className="sm:col-span-2" />
          <Textarea label="Note for sales people (e.g. confirm the scheme is still open)" rows={2} value={f.statusNote} onChange={(e) => set('statusNote', e.target.value)} className="sm:col-span-2" />
        </div>
      )}

      {tab === 'conditions' && (
        <div className="space-y-3">
          {!f.conditions.length && <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-mute">No conditions yet — without them the checker can only say “to confirm”.</p>}
          {f.conditions.map((c, i) => (
            <ConditionCard key={c.id} c={c} n={i + 1} last={i === f.conditions.length - 1} onChange={(x) => setCond(i, x)} onMove={(d) => moveCond(i, d)}
              onCopy={() => set('conditions', [...f.conditions.slice(0, i + 1), { ...structuredClone(c), id: uid('c'), label: `${c.label} (copy)` }, ...f.conditions.slice(i + 1)])}
              onRemove={() => set('conditions', f.conditions.filter((_, j) => j !== i))} />
          ))}
          <Button variant="soft" icon={Plus} onClick={() => set('conditions', [...f.conditions, blankCondition()])}>Add condition</Button>
        </div>
      )}

      {tab === 'info' && (
        <div className="grid gap-4 md:grid-cols-3">
          <LinesField label="Benefits" value={f.benefits} onChange={(v) => set('benefits', v)} />
          <LinesField label="Documents needed" value={f.documents} onChange={(v) => set('documents', v)} />
          <LinesField label="How to apply (in order)" value={f.process} onChange={(v) => set('process', v)} />
        </div>
      )}

      {tab === 'extras' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-4">
            <Checkbox checked={!!f.subsidy} label={<b>Subsidy estimate</b>} onChange={(v) => set('subsidy', v ? { field: 'projectCost', generalUrban: 15, generalRural: 25, specialUrban: 25, specialRural: 35 } : undefined)} />
            <p className="mt-1 text-xs text-mute">Shows “x% of the amount ≈ ₹…” to the sales person. Special category = OBC, SC, ST, minority, ex-servicemen, disability, transgender, or a woman entrepreneur.</p>
            {f.subsidy && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <MoneyFieldSelect value={f.subsidy.field} onChange={(field) => set('subsidy', { ...f.subsidy!, field })} className="col-span-2" />
                {([['generalUrban', 'General · urban %'], ['generalRural', 'General · rural %'], ['specialUrban', 'Special · urban %'], ['specialRural', 'Special · rural %']] as const).map(([k, label]) => (
                  <Input key={k} label={label} type="number" min={0} max={100} value={f.subsidy![k]} onChange={(e) => set('subsidy', { ...f.subsidy!, [k]: Number(e.target.value) })} />
                ))}
              </div>
            )}
          </Card>
          <Card className="p-4">
            <Checkbox checked={!!f.bands} label={<b>Loan bands</b>} onChange={(v) => set('bands', v ? { field: 'projectCost', items: [{ max: 5e5, label: '' }] } : undefined)} />
            <p className="mt-1 text-xs text-mute">Names for ranges of an amount, e.g. Mudra Shishu / Kishore / Tarun. The first band the amount fits in is shown.</p>
            {f.bands && (
              <div className="mt-3 space-y-2">
                <MoneyFieldSelect value={f.bands.field} onChange={(field) => set('bands', { ...f.bands!, field })} />
                {f.bands.items.map((b, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2">
                    <input aria-label={`Band ${i + 1} name`} value={b.label} placeholder="Band name" onChange={(e) => set('bands', { ...f.bands!, items: f.bands!.items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} className="h-9 rounded-lg border border-line bg-card px-2.5 text-sm" />
                    <Lakh label={`Band ${i + 1} up to (lakh)`} value={b.max} onChange={(v) => set('bands', { ...f.bands!, items: f.bands!.items.map((x, j) => (j === i ? { ...x, max: Number(v) || 0 } : x)) })} />
                    <button type="button" aria-label={`Remove band ${i + 1}`} onClick={() => set('bands', { ...f.bands!, items: f.bands!.items.filter((_, j) => j !== i) })} className="grid size-8 place-items-center rounded-lg text-mute hover:text-bad"><X className="size-4" /></button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon={Plus} onClick={() => set('bands', { ...f.bands!, items: [...f.bands!.items, { max: 0, label: '' }] })}>Add band (up to ₹ lakh)</Button>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'test' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <p className="text-xs text-mute">Try this scheme (with your unsaved changes) on a client. It starts from the client last checked in Rexy.</p>
            <ProfileFields p={p} set={(k, v) => setP((x) => ({ ...x, [k]: v }))} />
          </div>
          <div className="lg:sticky lg:top-0 lg:self-start">
            <Card className="p-4">
              <p className="flex items-center gap-2 font-bold">{f.name || 'This scheme'} <Badge tone={STATUS[test.status].tone}>{STATUS[test.status].label}</Badge></p>
              <p className="mt-1 text-xs text-mute">{test.why}</p>
              <ul className="mt-3 space-y-1.5 text-xs">{test.checks.map((c, i) => <li key={i} className="flex gap-2">{CHECK_ICON[c.status]}<span><b>{c.label}:</b> {c.reason}</span></li>)}</ul>
              {!test.checks.length && <p className="mt-3 text-xs text-mute">No condition applies to this client.</p>}
            </Card>
          </div>
        </div>
      )}
    </Modal>
  )
}

function LinesField({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join('\n'))
  return <Textarea label={label} rows={9} value={text} hint="One per line" onChange={(e) => { setText(e.target.value); onChange(e.target.value.split('\n')) }} />
}

function MoneyFieldSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <Select label="Worked out on" value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {Object.entries(FIELDS).filter(([, x]) => x.type === 'money').map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
    </Select>
  )
}

const small = 'h-9 rounded-lg border border-line bg-card px-2.5 text-sm outline-none focus:border-brand'

/** field · how · value(s) — the editor of one rule (a condition, or one of its "only when" rules). */
function RuleEditor({ r, onChange }: { r: EligibilityRule; onChange: (r: EligibilityRule) => void }) {
  const f = FIELDS[r.field]
  const type = f?.type ?? 'money'
  const pickField = (field: string) => {
    const t = FIELDS[field]!.type
    onChange(t === 'select' ? { field, op: 'in', values: [] } : t === 'bool' ? { field, op: 'is', value: true } : { field, op: 'lte', value: t === 'money' ? 10e5 : 1 })
  }
  const num = (k: 'value' | 'value2', label: string): ReactNode => type === 'money'
    ? <Lakh label={label} value={typeof r[k] === 'number' ? (r[k] as number) : ''} onChange={(v) => onChange({ ...r, [k]: v === '' ? undefined : v })} className="w-28" />
    : <input aria-label={label} type="number" min={0} value={typeof r[k] === 'number' ? (r[k] as number) : ''} onChange={(e) => onChange({ ...r, [k]: e.target.value === '' ? undefined : Number(e.target.value) })} className={cx(small, 'w-24')} placeholder="years" />
  return (
    <div className="flex flex-wrap items-start gap-2">
      <select aria-label="What to check" value={r.field} onChange={(e) => pickField(e.target.value)} className={cx(small, 'min-w-48 flex-1')}>
        {fieldGroups.map((g) => <optgroup key={g.label} label={g.label}>{g.keys.map((k) => <option key={k} value={k}>{FIELDS[k]!.label}</option>)}</optgroup>)}
      </select>
      <select aria-label="How to compare" value={r.op} onChange={(e) => onChange({ ...r, op: e.target.value as EligibilityRule['op'] })} className={cx(small, 'w-36')}>
        {OPS[type].map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {type === 'bool' && <select aria-label="Yes or no" value={r.value === false ? 'n' : 'y'} onChange={(e) => onChange({ ...r, value: e.target.value === 'y' })} className={cx(small, 'w-24')}><option value="y">Yes</option><option value="n">No</option></select>}
      {(type === 'money' || type === 'years') && <span className="flex items-center gap-1.5">{num('value', 'Limit')}{r.op === 'between' && <><span className="text-xs text-mute">and</span>{num('value2', 'Upper limit')}</>}<span className="text-xs text-mute">{type === 'money' ? '₹ lakh' : 'years'}</span></span>}
      {type === 'select' && (
        <span className="flex w-full flex-wrap gap-x-3 gap-y-1 rounded-lg bg-card2/60 px-2.5 py-1.5">
          {f!.options!.map((o) => <Checkbox key={o.id} checked={(r.values ?? []).includes(o.id)} label={<span className="text-xs">{o.label}</span>}
            onChange={(on) => onChange({ ...r, values: on ? [...(r.values ?? []), o.id] : (r.values ?? []).filter((x) => x !== o.id) })} />)}
        </span>
      )}
    </div>
  )
}

function ConditionCard({ c, n, last, onChange, onMove, onCopy, onRemove }: { c: EligibilityCondition; n: number; last: boolean; onChange: (c: EligibilityCondition) => void; onMove: (d: -1 | 1) => void; onCopy: () => void; onRemove: () => void }) {
  const ruleOf = (x: EligibilityCondition): EligibilityRule => ({ field: x.field, op: x.op, values: x.values, value: x.value, value2: x.value2 })
  const when = c.when ?? []
  return (
    <div className="rounded-2xl border border-line bg-card p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="grid size-6 place-items-center rounded-full bg-brand-soft text-[11px] font-bold text-brand-ink">{n}</span>
        <input aria-label={`Condition ${n} name`} value={c.label} placeholder="Short name, e.g. Project cost" onChange={(e) => onChange({ ...c, label: e.target.value })} className={cx(small, 'min-w-40 flex-1 font-semibold')} />
        <select aria-label={`Condition ${n}: a mismatch means`} value={c.otherwise} onChange={(e) => onChange({ ...c, otherwise: e.target.value as EligibilityCondition['otherwise'] })} className={cx(small, 'w-56')}>
          <option value="fail">Mismatch → not eligible</option><option value="unknown">Mismatch → to confirm</option>
        </select>
        <span className="ml-auto flex">
          <button type="button" aria-label="Move up" disabled={n === 1} onClick={() => onMove(-1)} className="grid size-8 place-items-center rounded-lg text-mute hover:bg-card2 disabled:opacity-30"><ArrowUp className="size-4" /></button>
          <button type="button" aria-label="Move down" disabled={last} onClick={() => onMove(1)} className="grid size-8 place-items-center rounded-lg text-mute hover:bg-card2 disabled:opacity-30"><ArrowDown className="size-4" /></button>
          <button type="button" aria-label="Copy condition" onClick={onCopy} className="grid size-8 place-items-center rounded-lg text-mute hover:bg-card2"><Copy className="size-4" /></button>
          <button type="button" aria-label="Remove condition" onClick={onRemove} className="grid size-8 place-items-center rounded-lg text-mute hover:bg-bad-soft hover:text-bad"><Trash2 className="size-4" /></button>
        </span>
      </div>
      <RuleEditor r={ruleOf(c)} onChange={(r) => onChange({ ...c, field: r.field, op: r.op, values: r.values, value: r.value, value2: r.value2 })} />
      <p className="mt-1.5 text-[11px] text-mute">Checks: <b>{describeRule(c)}</b>{when.length ? <> · only when {when.map((w) => describeRule(w)).join(' and ')}</> : null}</p>

      <div className="mt-2 space-y-2">
        {when.map((w, j) => (
          <div key={j} className="flex items-start gap-2 rounded-xl bg-card2/50 p-2">
            <span className="mt-2 text-[11px] font-bold uppercase text-mute">Only when</span>
            <div className="min-w-0 flex-1"><RuleEditor r={w} onChange={(r) => onChange({ ...c, when: when.map((x, k) => (k === j ? r : x)) })} /></div>
            <button type="button" aria-label="Remove only-when rule" onClick={() => onChange({ ...c, when: when.filter((_, k) => k !== j) })} className="mt-0.5 grid size-8 place-items-center rounded-lg text-mute hover:text-bad"><X className="size-4" /></button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {when.length < 3 && <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange({ ...c, when: [...when, { field: 'sector', op: 'in', values: ['MANUFACTURING'] }] })}>Only when…</Button>}
        </div>
        <details className="group rounded-xl border border-line/70 px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-brand-ink">What the sales person reads {c.pass || c.fail || c.ask ? '· custom' : '· automatic'}</summary>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <Textarea label="When it matches" rows={2} value={c.pass ?? ''} onChange={(e) => onChange({ ...c, pass: e.target.value })} placeholder="e.g. {value} — within {limit}" />
            <Textarea label="When it does not" rows={2} value={c.fail ?? ''} onChange={(e) => onChange({ ...c, fail: e.target.value })} placeholder="e.g. {value} — above the {limit} limit" />
            <Textarea label="When it is not known" rows={2} value={c.ask ?? ''} onChange={(e) => onChange({ ...c, ask: e.target.value })} placeholder="e.g. Up to ₹50 lakh — ask the project cost" />
          </div>
          <p className="mt-1 text-[11px] text-mute">Leave empty for the automatic text. <code>{'{value}'}</code> becomes the client’s value (₹, years, Yes / No) and <code>{'{limit}'}</code> this condition’s limit — use it instead of typing the amount, so the text stays right when the limit changes.</p>
        </details>
      </div>
    </div>
  )
}
