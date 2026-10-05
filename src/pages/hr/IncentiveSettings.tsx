import { useState, type ChangeEvent } from 'react'
import { History, Plus, Save, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { IncentiveRules } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { saveIncentiveRules } from '../../lib/payroll'
import { DEFAULT_INCENTIVE } from '../../lib/hrsuite'
import { fmtDateTime, inr } from '../../lib/format'
import { Button, Card, CardHeader, Input, PageHeader, useRun } from '../../components/ui'

type Draft = Omit<IncentiveRules, 'version' | 'updatedAt' | 'updatedBy'>
const toDraft = (r: IncentiveRules): Draft => ({ ...r, slabs: r.slabs.map((s) => ({ ...s })) })

export default function IncentiveSettings() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const manage = can('incentives.manage')
  const [f, setF] = useState<Draft>(() => toDraft(db.incentiveRules))
  const num = (k: keyof Draft) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) })
  const setSlab = (i: number, patch: Partial<Draft['slabs'][number]>) => setF({ ...f, slabs: f.slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)) })

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Incentive Settings" subtitle={`Version ${db.incentiveRules.version} · saved ${db.incentiveRules.updatedBy === 'system' ? 'by default' : `${fmtDateTime(db.incentiveRules.updatedAt)} by ${userName(db, db.incentiveRules.updatedBy)}`}`} icon={SlidersHorizontal}
        actions={manage && <>
          <Button variant="outline" onClick={() => setF(toDraft(DEFAULT_INCENTIVE))}>Load defaults</Button>
          <Button icon={Save} onClick={() => run(() => saveIncentiveRules(me, f), 'Saved as a new version — recalculate open payrolls to apply')}>Save new version</Button>
        </>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Eligibility, daily & weekly" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Input label="Eligible at salary ×" type="number" step="0.1" disabled={!manage} value={f.eligibilityMultiple} onChange={num('eligibilityMultiple')} hint="Below this, no incentive at all" className="sm:col-span-2" />
            <Input label="Daily threshold (₹)" type="number" disabled={!manage} value={f.dailyThreshold} onChange={num('dailyThreshold')} />
            <Input label="Daily %" type="number" step="0.1" disabled={!manage} value={f.dailyPct} onChange={num('dailyPct')} />
            <Input label="Weekly threshold (₹, Mon–Sun)" type="number" disabled={!manage} value={f.weeklyThreshold} onChange={num('weeklyThreshold')} />
            <Input label="Weekly %" type="number" step="0.1" disabled={!manage} value={f.weeklyPct} onChange={num('weeklyPct')} />
            <Input label="Monthly slab from salary ×" type="number" step="0.1" disabled={!manage} value={f.monthlyMultiple} onChange={num('monthlyMultiple')} className="sm:col-span-2" />
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Monthly slabs" subtitle="% of the whole month's collections" />
          <div className="space-y-2 p-5">
            {f.slabs.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="w-20 shrink-0 text-mute">{i === 0 ? 'Under' : s.upTo == null ? 'From' : 'Up to'}</span>
                {s.upTo == null
                  ? <span className="h-9 flex-1 rounded-lg bg-card2 px-3 leading-9">{inr(f.slabs[i - 1]?.upTo ?? 0)}+</span>
                  : <input type="number" disabled={!manage} value={s.upTo} onChange={(e) => setSlab(i, { upTo: Number(e.target.value) })} className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-card px-3" aria-label={`Slab ${i + 1} limit`} />}
                <input type="number" step="0.5" disabled={!manage} value={s.pct} onChange={(e) => setSlab(i, { pct: Number(e.target.value) })} className="h-9 w-20 rounded-lg border border-line bg-card px-2 text-right" aria-label={`Slab ${i + 1} percent`} />
                <span className="text-mute">%</span>
                {manage && s.upTo != null && f.slabs.length > 2 && <button aria-label="Remove slab" onClick={() => setF({ ...f, slabs: f.slabs.filter((_, j) => j !== i) })} className="text-mute hover:text-bad"><Trash2 className="size-4" /></button>}
              </div>
            ))}
            {manage && <Button size="sm" variant="soft" icon={Plus} onClick={() => {
              const open = f.slabs.at(-1)!, prev = f.slabs.at(-2)
              setF({ ...f, slabs: [...f.slabs.slice(0, -1), { upTo: (prev?.upTo ?? 0) + 100000, pct: open.pct }, { upTo: null, pct: open.pct + 2.5 }] })
            }}>Add slab</Button>}
          </div>
        </Card>
      </div>
      <Card className="mt-6 overflow-hidden">
        <CardHeader title="Version history" icon={History} />
        <ul className="divide-y divide-line/70 text-sm">
          {db.incentiveHistory.length === 0 && <li className="px-5 py-4 text-mute">No earlier versions.</li>}
          {db.incentiveHistory.map((h) => (
            <li key={h.version + h.updatedAt} className="flex flex-wrap justify-between gap-2 px-5 py-3">
              <span><b>v{h.version}</b> <span className="text-mute">· eligible ×{h.eligibilityMultiple} · daily {h.dailyPct}% ≥ {inr(h.dailyThreshold)} · weekly {h.weeklyPct}% ≥ {inr(h.weeklyThreshold)} · {h.slabs.length} slabs</span></span>
              <span className="text-xs text-mute">{h.updatedBy === 'system' ? 'default' : `${userName(db, h.updatedBy)} · ${fmtDateTime(h.updatedAt)}`}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
