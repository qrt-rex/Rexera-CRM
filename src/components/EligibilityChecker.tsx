import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, CheckCircle2, ChevronDown, CircleHelp, ClipboardCopy, ExternalLink, MessageCircle, RotateCcw, ScanSearch, TriangleAlert, XCircle } from 'lucide-react'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { visibleBookings } from '../lib/actions'
import { visibleClientEntries } from '../lib/clientEntries'
import { fmtDate, inr, today } from '../lib/format'
import {
  CATEGORIES, checkEligibility, clientSummary, EDUCATION, ENTITIES, filledCount, PROFILE_KEYS, RULES_CHECKED, SECTORS, STAGES, STATUS,
  type EligibilityProfile, type SchemeResult, type Verdict,
} from '../../supabase/eligibility-rules.mjs'
import { Badge, cx, useToast } from './ui'

const KEY = (id: string) => `rexy-eligibility-${id}`
const load = (id: string): EligibilityProfile => { try { return JSON.parse(sessionStorage.getItem(KEY(id)) || '{}') } catch { return {} } }
const LAKH = 1e5

const ctl = 'h-9 w-full rounded-lg border border-line bg-card px-2.5 text-xs text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15'
function F({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={cx('block min-w-0', wide && 'col-span-2')}><span className="mb-1 block text-[11px] font-semibold text-mute">{label}</span>{children}</label>
}
function Pick({ value, onChange, options, label }: { value?: string; onChange: (v: string) => void; options: { id: string; label: string }[]; label: string }) {
  return <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={ctl}><option value="">Not sure</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
}
/** Yes / No / Not sure — "not sure" leaves the condition open (potentially eligible), it never fails it. */
function YesNo({ value, onChange, label }: { value?: boolean; onChange: (v: boolean | undefined) => void; label: string }) {
  return (
    <select aria-label={label} value={value === true ? 'y' : value === false ? 'n' : ''} onChange={(e) => onChange(e.target.value === 'y' ? true : e.target.value === 'n' ? false : undefined)} className={ctl}>
      <option value="">Not sure</option><option value="y">Yes</option><option value="n">No</option>
    </select>
  )
}
/** Amounts are typed in lakh (how sales people talk), kept in rupees. */
function Lakh({ value, onChange, label }: { value?: number | ''; onChange: (v: number | '') => void; label: string }) {
  return <input aria-label={label} type="number" min={0} step="0.5" inputMode="decimal" placeholder="₹ lakh" value={value === '' || value == null ? '' : +(Number(value) / LAKH).toFixed(2)}
    onChange={(e) => onChange(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) * LAKH)} className={ctl} />
}
const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <fieldset className="rounded-2xl border border-line bg-card p-3"><legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-brand-ink">{title}</legend><div className="grid grid-cols-2 gap-2.5">{children}</div></fieldset>
)
const ICON: Record<string, ReactNode> = {
  pass: <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-label="Meets" />,
  fail: <XCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-label="Does not meet" />,
  unknown: <CircleHelp className="mt-0.5 size-4 shrink-0 text-warn" aria-label="To confirm" />,
}

/**
 * Rexy's Scheme Checker: the sales person enters what the client tells them, and sees which government schemes the
 * client looks eligible / potentially eligible / not eligible for — with the reason for each condition, the benefits,
 * documents and how to apply. A preliminary check only: the bank / agency decides.
 */
export function EligibilityChecker({ onExplain }: { onExplain: (prompt: string) => void }) {
  const db = useDb()
  const me = useMe()
  const toast = useToast()
  const [p, setP] = useState<EligibilityProfile>(() => load(me.id))
  const [view, setView] = useState<'form' | 'results'>(() => (filledCount(load(me.id)) ? 'results' : 'form'))
  const [openId, setOpenId] = useState<string | null>(null)
  useEffect(() => { try { sessionStorage.setItem(KEY(me.id), JSON.stringify(p)) } catch { /* private mode */ } }, [me.id, p])
  const set = <K extends keyof EligibilityProfile>(k: K, v: EligibilityProfile[K]) => setP((x) => ({ ...x, [k]: v }))
  const results = useMemo(() => checkEligibility(p, today()), [p])
  const filled = filledCount(p)
  const counts = (s: Verdict) => results.filter((r) => r.status === s).length
  // the client's name can come from the sales person's own client / CRM entries
  const names = useMemo(() => [...new Set([...visibleClientEntries(db, me).map((e) => e.companyName), ...visibleBookings(db, me).map((b) => b.companyName)])].slice(0, 200), [db, me])
  const nonIndividual = !!p.entity && !['INDIVIDUAL', 'PROPRIETORSHIP'].includes(p.entity)

  const explain = (r: SchemeResult) => {
    const s = r.scheme
    onExplain([
      `Explain the ${s.name} to my client${p.clientName ? ` (${p.clientName})` : ''} in simple words I can say on a call. Use only these facts:`,
      `What it is: ${s.summary}`, `Benefits: ${s.benefits.join('; ')}`,
      `Our preliminary check: ${STATUS[r.status].label} — ${r.checks.map((c) => `${c.label}: ${c.reason}`).join('; ')}`,
      `Documents: ${s.documents.join('; ')}`, `How to apply: ${s.process.join(' → ')}`, s.statusNote ? `Note: ${s.statusNote}` : '',
      'Tell me what to ask the client next for anything still to confirm. Say clearly that the bank / agency decides and approval is not guaranteed.',
    ].filter(Boolean).join('\n'))
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(clientSummary(results, p.clientName)); toast('success', 'Summary copied — paste it in WhatsApp or email') } catch { toast('error', 'Could not copy — select the text instead.') }
  }

  if (view === 'form') return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-card2/50 px-3 py-3">
        <p className="rounded-xl bg-info-soft px-3 py-2 text-[11px] leading-relaxed text-info">Fill what the client tells you — leave “Not sure” for anything you don’t know yet. More details give sharper results.</p>
        <Section title="Client">
          <F label="Client / company name" wide>
            <input list="rexy-client-names" value={p.clientName ?? ''} onChange={(e) => set('clientName', e.target.value)} placeholder="Optional" className={ctl} />
            <datalist id="rexy-client-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
          </F>
          <F label="Entity type"><Pick label="Entity type" value={p.entity} onChange={(v) => set('entity', v)} options={ENTITIES} /></F>
          <F label="Stage"><Pick label="Stage" value={p.stage} onChange={(v) => set('stage', v)} options={STAGES} /></F>
          <F label="Activity"><Pick label="Activity" value={p.sector} onChange={(v) => set('sector', v)} options={SECTORS} /></F>
          <F label="Location"><Pick label="Location" value={p.area} onChange={(v) => set('area', v as EligibilityProfile['area'])} options={[{ id: 'URBAN', label: 'Urban' }, { id: 'RURAL', label: 'Rural' }]} /></F>
          <F label="Incorporated / started on" wide><input type="date" max={today()} value={p.incorporated ?? ''} onChange={(e) => set('incorporated', e.target.value)} className={ctl} aria-label="Incorporated on" /></F>
        </Section>
        <Section title="Money (₹ lakh)">
          <F label="Annual turnover"><Lakh label="Annual turnover in lakh" value={p.turnover} onChange={(v) => set('turnover', v)} /></F>
          <F label="Investment in machinery / equipment"><Lakh label="Investment in lakh" value={p.investment} onChange={(v) => set('investment', v)} /></F>
          <F label="Project cost / loan needed"><Lakh label="Project cost in lakh" value={p.projectCost} onChange={(v) => set('projectCost', v)} /></F>
          <F label="Govt. money received before"><Lakh label="Earlier government funding in lakh" value={p.priorFunding} onChange={(v) => set('priorFunding', v)} /></F>
        </Section>
        <Section title="Registrations & business">
          <F label="Udyam registered?"><YesNo label="Udyam registered" value={p.udyam} onChange={(v) => set('udyam', v)} /></F>
          <F label="DPIIT recognised?"><YesNo label="DPIIT recognised" value={p.dpiit} onChange={(v) => set('dpiit', v)} /></F>
          <F label="Innovative / tech-based product?" wide><YesNo label="Innovative or technology-based" value={p.innovative} onChange={(v) => set('innovative', v)} /></F>
        </Section>
        <Section title="Promoter">
          <F label="Age (years)"><input type="number" min={0} max={100} value={p.age ?? ''} onChange={(e) => set('age', e.target.value === '' ? '' : Number(e.target.value))} className={ctl} aria-label="Promoter age" /></F>
          <F label="Education"><Pick label="Education" value={p.education} onChange={(v) => set('education', v)} options={EDUCATION} /></F>
          <F label="Social category"><Pick label="Social category" value={p.category} onChange={(v) => set('category', v)} options={CATEGORIES} /></F>
          <F label="Woman entrepreneur?"><YesNo label="Woman entrepreneur" value={p.woman} onChange={(v) => set('woman', v)} /></F>
          {nonIndividual && <F label="SC / ST / women hold 51%+?" wide><YesNo label="SC ST or women hold 51 percent" value={p.reserved51} onChange={(v) => set('reserved51', v)} /></F>}
          <F label="Indian promoters 51%+?" wide><YesNo label="Indian promoters hold 51 percent" value={p.indian51} onChange={(v) => set('indian51', v)} /></F>
        </Section>
        <Section title="History">
          <F label="Took a govt. subsidy before?"><YesNo label="Earlier government subsidy" value={p.priorSubsidy} onChange={(v) => set('priorSubsidy', v)} /></F>
          <F label="Any loan default?"><YesNo label="Loan default" value={p.defaulter} onChange={(v) => set('defaulter', v)} /></F>
        </Section>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-card p-3">
        <button type="button" onClick={() => { setP({}); setOpenId(null) }} disabled={!filled && !p.clientName} className="grid size-10 place-items-center rounded-xl border border-line text-mute hover:bg-card2 hover:text-ink disabled:opacity-40" title="Clear all details" aria-label="Clear all details"><RotateCcw className="size-4" /></button>
        <button type="button" onClick={() => { setView('results'); setOpenId(null) }}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-brand text-sm font-semibold text-white shadow-sm hover:brightness-110"><ScanSearch className="size-4" />Check eligibility · {filled}/{PROFILE_KEYS.length} details</button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-card2/50 px-3 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setView('form')} className="mr-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"><ArrowLeft className="size-3.5" />Edit details{p.clientName ? ` · ${p.clientName}` : ''}</button>
          <Badge tone="green">{counts('ELIGIBLE')} eligible</Badge><Badge tone="amber">{counts('POSSIBLE')} to confirm</Badge><Badge tone="red">{counts('NOT_ELIGIBLE')} not eligible</Badge>
        </div>
        <p className="flex gap-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-[11px] leading-relaxed text-ink/80">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
          <span><b>Preliminary check</b> on {filled} of {PROFILE_KEYS.length} details, using scheme rules checked on {fmtDate(RULES_CHECKED)}. The bank / agency decides after verifying documents — never promise approval.</span>
        </p>
        {results.map((r) => {
          const open = openId === r.scheme.id
          const svc = db.services.find((s) => s.active && r.scheme.service.test(s.name))
          return (
            <article key={r.scheme.id} className={cx('overflow-hidden rounded-2xl border bg-card shadow-sm', r.status === 'ELIGIBLE' ? 'border-ok/40' : r.status === 'POSSIBLE' ? 'border-warn/40' : 'border-line')}>
              <button type="button" onClick={() => setOpenId(open ? null : r.scheme.id)} aria-expanded={open} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-card2/60">
                <span className="mt-0.5">{ICON[r.status === 'ELIGIBLE' ? 'pass' : r.status === 'NOT_ELIGIBLE' ? 'fail' : 'unknown']}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold leading-snug">{r.scheme.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge><span className="text-[11px] text-mute">{r.scheme.kind}</span></span>
                  <span className={cx('mt-1 block text-[11px] leading-snug', r.status === 'NOT_ELIGIBLE' ? 'text-bad' : 'text-mute', !open && 'line-clamp-2')}>{r.why}</span>
                </span>
                <ChevronDown className={cx('mt-1 size-4 shrink-0 text-mute transition', open && 'rotate-180')} />
              </button>
              {open && (
                <div className="space-y-3 border-t border-line px-3 py-3 text-xs">
                  <p className="leading-relaxed">{r.scheme.summary}</p>
                  {r.scheme.statusNote && <p className="flex gap-1.5 rounded-lg bg-warn-soft px-2.5 py-1.5 text-[11px] text-ink/80"><TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />{r.scheme.statusNote}</p>}
                  <div>
                    <h4 className="mb-1 text-[11px] font-bold uppercase text-mute">Why — condition by condition</h4>
                    <ul className="space-y-1">{r.checks.map((c, i) => <li key={i} className="flex gap-2">{ICON[c.status]}<span><b>{c.label}:</b> {c.reason}</span></li>)}</ul>
                  </div>
                  <Info title="Benefits" items={r.scheme.benefits} />
                  <Info title="Documents needed" items={r.scheme.documents} />
                  <Info title="How to apply" items={r.scheme.process} ordered />
                  <p className="text-[11px] text-mute">{r.scheme.agency} · <a href={r.scheme.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-brand-ink hover:underline">Official site<ExternalLink className="size-3" /></a></p>
                  {svc && <p className="rounded-lg bg-brand-soft px-2.5 py-1.5 text-[11px] text-brand-ink">Rexera service: <b>{svc.name}</b> · {inr(svc.price)} + GST</p>}
                  <button type="button" onClick={() => explain(r)} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-brand/40 text-xs font-semibold text-brand-ink hover:bg-brand-soft"><MessageCircle className="size-3.5" />Explain this to my client (Rexy)</button>
                </div>
              )}
            </article>
          )
        })}
      </div>
      <div className="flex gap-2 border-t border-line bg-card p-3">
        <button type="button" onClick={() => setView('form')} className="h-10 rounded-xl border border-line px-3 text-xs font-semibold hover:bg-card2">Edit details</button>
        <button type="button" onClick={copy} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-brand text-sm font-semibold text-white shadow-sm hover:brightness-110"><ClipboardCopy className="size-4" />Copy summary for client</button>
      </div>
    </div>
  )
}

function Info({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  const List = ordered ? 'ol' : 'ul'
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-bold uppercase text-mute">{title}</h4>
      <List className={cx('space-y-0.5 pl-4', ordered ? 'list-decimal' : 'list-disc')}>{items.map((x, i) => <li key={i}>{x}</li>)}</List>
    </div>
  )
}
