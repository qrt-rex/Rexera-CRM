import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Bot, CheckCircle2, Copy, History, LayoutTemplate, Pencil, Play, Plus, Save, Server, Trash2, TriangleAlert, Workflow, X, XCircle, Zap } from 'lucide-react'
import type { AutomationAction, AutomationCondition, AutomationRecipient, AutomationRule, DB } from '../../lib/types'
import { getDb, useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { AUTOMATIONS, saveAutomation } from '../../lib/email'
import {
  automationProblems, builtinOn, canEditAutomation, clearAutomationRuns, customRules, deleteAutomationRule, factsOf, FIELDS, moveAutomationRule, PLACEHOLDERS,
  recipientsOf, roleOptions, runRuleNow, saveAutomationRule, scheduleMatches, setAutomationEnabled, type FieldDef, type RuleInput,
} from '../../lib/automation'
import { ago, fmtDateTime, today } from '../../lib/format'
import { ACTIONS, BUILTINS, builtinId, ENTITY_LABELS, fillText, opsFor, RECIPIENTS, REPEAT, ruleEntity, ruleMatches, TEMPLATES, TRIGGERS, triggerOf } from '../../../supabase/automation-rules.mjs'
import { Badge, Button, Card, Checkbox, cx, EmptyState, Input, Menu, MenuItem, Modal, PageHeader, Select, Tabs, Textarea, Toggle, useConfirm, useRun, useSubmitting } from '../../components/ui'
import { MiniStat } from '../dashboards/widgets'

type Tab = 'rules' | 'builtin' | 'history'
const small = 'h-9 rounded-lg border border-line bg-card px-2.5 text-sm outline-none focus:border-brand'
const blankRule = (): RuleInput => ({ name: '', enabled: true, trigger: 'booking.created', match: 'all', conditions: [], actions: [{ type: 'notify', to: [{ kind: 'owner' }], title: '', body: '' }] })
const fromTemplate = (t: (typeof TEMPLATES)[number]): RuleInput => ({ enabled: false, match: 'all', ...structuredClone(t) }) as RuleInput
const toForm = (r: AutomationRule): RuleInput => { const { id: _i, position: _p, createdAt: _c, updatedAt: _u, updatedBy: _b, ...rest } = structuredClone(r); return { match: 'all', ...rest } }

const ONE: Record<string, string> = { booking: 'CRM entry', lead: 'lead', clientEntry: 'client entry', invoice: 'invoice', leave: 'leave request', user: 'employee' }
/** "A CRM entry …" → "a CRM entry …" (keeps CRM, DPIIT … as they are) */
const lowerFirst = (s: string) => (s[1] && s[1] === s[1].toUpperCase() && /[A-Z]/.test(s[1]) ? s : s.charAt(0).toLowerCase() + s.slice(1))
/** "Status is Rejected", "Days since the last decision at least 2" */
function describe(entity: string, c: AutomationCondition) {
  const f = FIELDS[entity]?.[c.field]
  if (!f) return c.field
  const op = opsFor(f.type).find((o) => o.id === c.op)?.label ?? c.op
  const lbl = (v: unknown) => f.options?.find((o) => o.id === v)?.label ?? String(v)
  const val = c.op === 'in' || c.op === 'not_in' ? (c.values ?? []).map(lbl).join(' / ') : c.op === 'empty' || c.op === 'not_empty' ? '' : f.type === 'bool' ? (c.value ? 'Yes' : 'No') : f.type === 'money' ? `₹${Number(c.value).toLocaleString('en-IN')}` : lbl(c.value)
  return `${f.label} ${op} ${val}`.trim()
}
function describeAction(d: DB, a: AutomationAction) {
  const who = (a.to ?? []).map((r) => r.kind === 'role' ? roleOptions().find((x) => x.id === r.role)?.label ?? r.role : r.kind === 'user' ? userName(d, r.userId) : RECIPIENTS.find((x) => x.id === r.kind)?.label.split(' (')[0]).join(', ')
  const def = ACTIONS.find((x) => x.id === a.type)?.label ?? a.type
  return a.type === 'priority' ? `${def}: ${a.value?.toLowerCase()}` : a.type === 'comment' ? def : `${def} → ${who || 'nobody'}`
}

/**
 * Automation Center: every automation in the CRM in one place. The built-in automations (break monitor, reminders,
 * server jobs, scheduled emails) can be switched on / off, and the IT Support team builds its own rules: when
 * something happens — or in a daily check — and the conditions hold, notify, email, add a task / note or set the
 * priority. Only IT Support edits (the database checks the same); Super Admin can look.
 */
export default function AutomationCenter() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const editor = canEditAutomation(me)
  const [tab, setTab] = useState<Tab>('rules')
  const [edit, setEdit] = useState<{ id?: string; form: RuleInput } | null>(null)
  const rules = customRules(db)
  const runs = db.automationRuns ?? []
  const t = today()
  const runsToday = runs.filter((r) => r.at.slice(0, 10) === t).length
  const failed = runs.filter((r) => !r.ok && Date.now() - new Date(r.at).getTime() < 7 * 86400000).length
  const builtinsOn = BUILTINS.filter((b) => builtinOn(db, b.key)).length
  const paused = !builtinOn(db, 'custom-rules')

  return (
    <div>
      <PageHeader title="Automation Center" icon={Workflow}
        subtitle="Every automation in the CRM: built-in reminders and jobs, your own rules, and what they did."
        actions={editor ? <>
          <Menu width="w-96" trigger={(o) => <Button variant="outline" icon={LayoutTemplate} aria-expanded={o}>From a template</Button>}>
            {(close) => TEMPLATES.map((tp) => <MenuItem key={tp.name} icon={Zap} onClick={() => { close(); setEdit({ form: fromTemplate(tp) }) }}>{tp.name}</MenuItem>)}
          </Menu>
          <Button variant="accent" icon={Plus} onClick={() => setEdit({ form: blankRule() })}>New rule</Button>
        </> : <Badge tone="gray">View only — the IT Support team edits automations</Badge>} />

      {paused && <p className="mb-4 flex items-center gap-2 rounded-2xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm"><TriangleAlert className="size-4 text-warn" /><b>All custom rules are paused</b> (Built-in automations → Custom automation rules).</p>}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="Your rules switched on" value={`${rules.filter((r) => r.enabled).length} of ${rules.length}`} icon={Zap} tone="green" />
        <MiniStat label="Built-in automations on" value={`${builtinsOn} of ${BUILTINS.length}`} icon={Bot} />
        <MiniStat label="Runs today" value={runsToday} icon={History} tone="blue" />
        <MiniStat label="Failed in the last 7 days" value={failed} icon={XCircle} tone={failed ? 'red' : 'gray'} />
      </div>

      <Tabs className="mb-4 w-fit max-w-full" value={tab} onChange={setTab} tabs={[
        { id: 'rules', label: 'Rules', icon: Zap, count: rules.length }, { id: 'builtin', label: 'Built-in automations', icon: Bot, count: BUILTINS.length + AUTOMATIONS.length },
        { id: 'history', label: 'Run history', icon: History, count: runs.length },
      ]} />

      {tab === 'rules' && (!rules.length ? (
        <Card>
          <EmptyState icon={Workflow} title="No rules yet" text={editor ? 'Start from a template below, or make a new rule.' : 'The IT Support team adds rules here.'} />
          {editor && <div className="grid gap-3 border-t border-line p-5 sm:grid-cols-2">{TEMPLATES.map((tp) => (
            <button key={tp.name} type="button" onClick={() => setEdit({ form: fromTemplate(tp) })} className="rounded-2xl border border-line p-4 text-left transition hover:border-brand hover:bg-brand-soft/40">
              <p className="flex items-center gap-2 text-sm font-bold"><Zap className="size-4 text-accent" />{tp.name}</p>
              <p className="mt-1 text-xs text-mute">{triggerOf(tp.trigger)?.label}</p>
            </button>
          ))}</div>}
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((r, i) => {
            const entity = ruleEntity(r)
            const mine = runs.filter((x) => x.ruleId === r.id)
            return (
              <Card key={r.id} className={cx('p-4', !r.enabled && 'opacity-75')}>
                <div className="flex flex-wrap items-start gap-3">
                  {editor && <span className="flex flex-col">
                    <button type="button" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => run(() => moveAutomationRule(me, r.id, -1))} className="grid size-6 place-items-center rounded text-mute hover:bg-card2 disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label={`Move ${r.name} down`} disabled={i === rules.length - 1} onClick={() => run(() => moveAutomationRule(me, r.id, 1))} className="grid size-6 place-items-center rounded text-mute hover:bg-card2 disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                  </span>}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2"><b>{r.name}</b>{r.enabled ? <Badge tone="green" dot>On</Badge> : <Badge tone="gray">Off</Badge>}{triggerOf(r.trigger)?.schedule && <Badge tone="blue">Daily check · {ENTITY_LABELS[entity as keyof typeof ENTITY_LABELS]}</Badge>}</p>
                    {r.description && <p className="text-xs text-mute">{r.description}</p>}
                    <p className="mt-2 text-sm"><span className="font-semibold text-brand-ink">When</span> {triggerOf(r.trigger)?.schedule ? `every day, for each ${ONE[entity] ?? 'record'} where` : lowerFirst(triggerOf(r.trigger)?.label ?? r.trigger)}
                      {r.conditions.length > 0 && <> {triggerOf(r.trigger)?.schedule ? '' : <span className="font-semibold text-brand-ink">and </span>}{r.conditions.map((c) => describe(entity, c)).join(r.match === 'any' ? ' or ' : ' and ')}</>}</p>
                    <p className="text-sm"><span className="font-semibold text-brand-ink">Then</span> {r.actions.map((a) => describeAction(db, a)).join(' · ')}</p>
                    <p className="mt-1 text-[11px] text-mute">{mine.length} run{mine.length === 1 ? '' : 's'}{mine[0] ? ` · last ${ago(mine[0].at)}` : ''}{mine.some((x) => !x.ok) ? ` · ${mine.filter((x) => !x.ok).length} failed` : ''}{r.updatedBy ? ` · edited by ${userName(db, r.updatedBy)}` : ''}</p>
                  </div>
                  {editor ? (
                    <span className="flex items-center gap-1">
                      <Toggle checked={r.enabled} label={`${r.name} on/off`} onChange={(v) => run(() => setAutomationEnabled(me, r.id, v), v ? 'Rule on' : 'Rule off')} />
                      <Button size="sm" variant="ghost" icon={Copy} aria-label={`Copy ${r.name}`} title="Copy" onClick={() => setEdit({ form: { ...toForm(r), name: `${r.name} (copy)`, enabled: false } })} />
                      <Button size="sm" variant="soft" icon={Pencil} onClick={() => setEdit({ id: r.id, form: toForm(r) })}>Edit</Button>
                      <Button size="sm" variant="ghost" icon={Trash2} className="text-bad" aria-label={`Delete ${r.name}`} onClick={async () => { if (await confirm(`Delete “${r.name}”?`, 'It stops at once. Its run history stays.', true)) run(() => deleteAutomationRule(me, r.id), 'Rule deleted') }} />
                    </span>
                  ) : <Button size="sm" variant="ghost" onClick={() => setEdit({ id: r.id, form: toForm(r) })}>View</Button>}
                </div>
              </Card>
            )
          })}
        </div>
      ))}

      {tab === 'builtin' && (
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line/70">
              {BUILTINS.map((b) => {
                const on = builtinOn(db, b.key)
                return (
                  <li key={b.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className={cx('grid size-9 shrink-0 place-items-center rounded-xl', on ? 'bg-ok-soft text-ok' : 'bg-card2 text-mute')}>{b.where.startsWith('Server') ? <Server className="size-4" /> : <Bot className="size-4" />}</span>
                    <span className="min-w-0 flex-1"><b className="text-sm">{b.name}</b><span className="block text-xs text-mute">{b.desc}</span><span className="block text-[11px] text-mute">Runs in: {b.where}</span></span>
                    {editor ? <Toggle checked={on} label={`${b.name} on/off`} onChange={(v) => run(() => setAutomationEnabled(me, builtinId(b.key), v), v ? 'Switched on' : 'Switched off')} /> : <Badge tone={on ? 'green' : 'gray'}>{on ? 'On' : 'Off'}</Badge>}
                  </li>
                )
              })}
            </ul>
          </Card>
          <Card className="overflow-hidden">
            <p className="border-b border-line px-4 py-3 text-sm font-bold">Email automations <span className="font-normal text-mute">— the wording is edited in Email Center → Automations</span></p>
            <ul className="divide-y divide-line/70">
              {AUTOMATIONS.map((m) => {
                const a = db.emailAutomations.find((x) => x.key === m.key)
                return (
                  <li key={m.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1"><b className="text-sm">{m.name}</b><span className="block text-xs text-mute">{m.when} · {a?.sent ?? 0} sent{a?.lastRunAt ? ` · last ${ago(a.lastRunAt)}` : ''}</span></span>
                    {editor ? <Toggle checked={!!a?.enabled} label={`${m.name} on/off`} onChange={(v) => run(() => saveAutomation(me, m.key, { enabled: v }), v ? 'Switched on' : 'Switched off')} /> : <Badge tone={a?.enabled ? 'green' : 'gray'}>{a?.enabled ? 'On' : 'Off'}</Badge>}
                  </li>
                )
              })}
            </ul>
          </Card>
          <p className="text-xs text-mute">App automations run while a Super Admin / IT Support person has the CRM open (lunch-break checks: anyone working). Server jobs run every 15 minutes on the live server, with nobody signed in.</p>
        </div>
      )}

      {tab === 'history' && <RunHistory editor={editor} onClear={async () => { if (await confirm('Clear the run history?', 'Every run is removed from the list. Rules keep working.', true)) run(() => clearAutomationRuns(me), 'History cleared') }} />}

      {edit && <RuleEditor key={edit.id ?? 'new'} id={edit.id} initial={edit.form} readOnly={!editor} onClose={() => setEdit(null)} />}
      {confirmNode}
    </div>
  )
}

function RunHistory({ editor, onClear }: { editor: boolean; onClear: () => void }) {
  const db = useDb()
  const [only, setOnly] = useState<'all' | 'failed'>('all')
  const [rule, setRule] = useState('')
  const runs = (db.automationRuns ?? []).filter((r) => (only === 'all' || !r.ok) && (!rule || r.ruleId === rule))
  const names = [...new Map((db.automationRuns ?? []).map((r) => [r.ruleId, r.ruleName])).entries()]
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <Tabs value={only} onChange={setOnly} tabs={[{ id: 'all', label: 'All' }, { id: 'failed', label: 'Failed', count: (db.automationRuns ?? []).filter((r) => !r.ok).length }]} />
        <select aria-label="Rule" value={rule} onChange={(e) => setRule(e.target.value)} className={cx(small, 'min-w-48')}><option value="">Every rule</option>{names.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        {editor && (db.automationRuns ?? []).length > 0 && <Button size="sm" variant="ghost" icon={Trash2} className="ml-auto text-bad" onClick={onClear}>Clear history</Button>}
      </div>
      {!runs.length ? <EmptyState icon={History} title="Nothing has run yet" text="Each time a rule acts on a record it is listed here." /> : (
        <ul className="divide-y divide-line/70">
          {runs.slice(0, 300).map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-2.5 text-sm">
              {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" />}
              <span className="min-w-0 flex-1"><b>{r.ruleName}</b> · {r.recordLabel || r.recordId}<span className="block text-xs text-mute">{r.detail || '—'}</span></span>
              <span className="text-right text-xs text-mute">{fmtDateTime(r.at)}<span className="block">{r.by ? userName(db, r.by) : 'server'}</span></span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------ the rule editor
function RuleEditor({ id, initial, readOnly, onClose }: { id?: string; initial: RuleInput; readOnly: boolean; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [busy, once] = useSubmitting()
  const [f, setF] = useState<RuleInput>(initial)
  const [tried, setTried] = useState(false)
  const set = <K extends keyof RuleInput>(k: K, v: RuleInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const trig = triggerOf(f.trigger)
  const entity = ruleEntity(f) ?? 'booking'
  const fields = FIELDS[entity] ?? {}
  const problems = automationProblems(f)
  const save = () => once(async () => {
    setTried(true)
    if (problems.length) return
    if (await run(() => saveAutomationRule(me, f, id), id ? 'Rule saved' : 'Rule added')) onClose()
  })
  const pickTrigger = (t: string) => {
    const nt = triggerOf(t)
    const ne = nt?.entity ?? f.entity ?? 'booking'
    setF((x) => ({ ...x, trigger: t, entity: nt?.schedule ? ne : undefined, repeatDays: nt?.schedule ? x.repeatDays ?? 1 : undefined,
      // conditions / actions that don't fit the new kind of record are dropped
      conditions: ne === ruleEntity(x) ? x.conditions : [], actions: x.actions.filter((a) => !ACTIONS.find((d) => d.id === a.type)?.entity || ne === 'booking') }))
  }
  const groups = Object.entries(ENTITY_LABELS).map(([e, label]) => ({ label, items: TRIGGERS.filter((x) => x.entity === e) }))

  return (
    <Modal open onClose={onClose} size="xl" title={readOnly ? f.name : id ? `Edit · ${initial.name}` : 'New rule'}
      subtitle="When something happens (or in a daily check) and the conditions hold, the actions run — at once, in the CRM."
      footer={readOnly ? <Button variant="outline" onClick={onClose}>Close</Button> : <>
        {tried && problems.length > 0 && <p className="mr-auto max-w-md text-xs font-semibold text-bad">{problems[0]}{problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}</p>}
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button icon={Save} loading={busy} onClick={save}>{id ? 'Save rule' : 'Add rule'}</Button>
      </>}>
      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input label="Rule name" required value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. New CRM entry → tell Accounts" />
          <div className="flex items-end pb-2"><Checkbox checked={f.enabled} onChange={(v) => set('enabled', v)} label="Switched on" /></div>
          <Input label="Description (optional)" value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} className="sm:col-span-2" />
        </div>

        <Step n={1} title="When">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="This happens" value={f.trigger} onChange={(e) => pickTrigger(e.target.value)} className={cx(trig?.schedule ? 'sm:col-span-1' : 'sm:col-span-3')}>
              {groups.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>)}
              <optgroup label="Daily"><option value="schedule.daily">{triggerOf('schedule.daily')?.label}</option></optgroup>
            </Select>
            {trig?.schedule && <>
              <Select label="Look at" value={f.entity ?? 'booking'} onChange={(e) => setF((x) => ({ ...x, entity: e.target.value, conditions: [], actions: x.actions.filter((a) => !ACTIONS.find((d) => d.id === a.type)?.entity || e.target.value === 'booking') }))}>
                {Object.entries(ENTITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
              <Select label="Act on a record" value={String(f.repeatDays ?? 0)} onChange={(e) => set('repeatDays', Number(e.target.value))}>{REPEAT.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select>
              <p className="text-xs text-mute sm:col-span-3">Checked every 5 minutes while a Super Admin / IT Support person has the CRM open; each record is acted on {f.repeatDays ? `again every ${f.repeatDays} day(s)` : 'once'} while it matches.</p>
            </>}
          </div>
        </Step>

        <Step n={2} title="Only if" action={f.conditions.length > 1 && (
          <select aria-label="Match" value={f.match ?? 'all'} onChange={(e) => set('match', e.target.value as 'all' | 'any')} className={cx(small, 'w-56')}>
            <option value="all">all conditions hold</option><option value="any">any one condition holds</option>
          </select>
        )}>
          <div className="space-y-2">
            {!f.conditions.length && <p className="text-sm text-mute">{trig?.schedule ? 'A daily check needs at least one condition.' : 'No conditions — the rule runs every time this happens.'}</p>}
            {f.conditions.map((c, i) => <ConditionRow key={i} fields={fields} c={c} onChange={(x) => set('conditions', f.conditions.map((y, j) => (j === i ? x : y)))} onRemove={() => set('conditions', f.conditions.filter((_, j) => j !== i))} />)}
            {!readOnly && <Button size="sm" variant="ghost" icon={Plus} onClick={() => { const [k, d] = Object.entries(fields)[0]!; set('conditions', [...f.conditions, newCondition(k, d)]) }}>Add condition</Button>}
          </div>
        </Step>

        <Step n={3} title="Then">
          <div className="space-y-3">
            {f.actions.map((a, i) => <ActionCard key={i} n={i + 1} entity={entity} a={a} onChange={(x) => set('actions', f.actions.map((y, j) => (j === i ? x : y)))} onRemove={() => set('actions', f.actions.filter((_, j) => j !== i))} />)}
            {!readOnly && f.actions.length < 10 && (
              <Menu width="w-64" align="left" trigger={(o) => <Button size="sm" variant="soft" icon={Plus} aria-expanded={o}>Add action</Button>}>
                {(close) => ACTIONS.filter((d) => !d.entity || d.entity === entity).map((d) => <MenuItem key={d.id} onClick={() => { close(); set('actions', [...f.actions, newAction(d.id)]) }}>{d.label}</MenuItem>)}
              </Menu>
            )}
          </div>
        </Step>

        <Preview db={db} rule={f} entity={entity} />
      </fieldset>
    </Modal>
  )
}

function Step({ n, title, action, children }: { n: number; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line p-4">
      <div className="mb-3 flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-brand text-xs font-bold text-white">{n}</span><h3 className="flex-1 font-bold">{title}</h3>{action}</div>
      {children}
    </section>
  )
}

const newCondition = (field: string, d: FieldDef): AutomationCondition =>
  d.type === 'select' ? { field, op: 'eq', value: d.options?.[0]?.id ?? '' } : d.type === 'bool' ? { field, op: 'is', value: true } : d.type === 'text' ? { field, op: 'contains', value: '' } : { field, op: 'gte', value: 1 }
const newAction = (type: string): AutomationAction =>
  type === 'notify' ? { type, to: [{ kind: 'owner' }], title: '', body: '' } : type === 'email' ? { type, to: [{ kind: 'owner' }], subject: '', body: '' }
    : type === 'task' ? { type, to: [{ kind: 'owner' }], title: '', dueInDays: 1 } : type === 'comment' ? { type, text: '' } : { type: 'priority', value: 'HIGH' }

function ConditionRow({ fields, c, onChange, onRemove }: { fields: Record<string, FieldDef>; c: AutomationCondition; onChange: (c: AutomationCondition) => void; onRemove: () => void }) {
  const d = fields[c.field]
  const type = d?.type ?? 'text'
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-xl bg-card2/60 p-2">
      <select aria-label="What to check" value={c.field} onChange={(e) => onChange(newCondition(e.target.value, fields[e.target.value]!))} className={cx(small, 'min-w-48 flex-1')}>
        {Object.entries(fields).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
      </select>
      <select aria-label="How to compare" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value, ...(e.target.value === 'in' || e.target.value === 'not_in' ? { values: c.values ?? [] } : {}) })} className={cx(small, 'w-40')}>
        {opsFor(type).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {type === 'select' && (c.op === 'in' || c.op === 'not_in'
        ? <span className="flex w-full flex-wrap gap-x-3 gap-y-1 px-1">{d!.options!.map((o) => <Checkbox key={o.id} checked={(c.values ?? []).includes(o.id)} label={<span className="text-xs">{o.label}</span>} onChange={(on) => onChange({ ...c, values: on ? [...(c.values ?? []), o.id] : (c.values ?? []).filter((x) => x !== o.id) })} />)}</span>
        : <select aria-label="Value" value={String(c.value ?? '')} onChange={(e) => onChange({ ...c, value: e.target.value })} className={cx(small, 'min-w-44')}>{d!.options!.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>)}
      {type === 'bool' && <select aria-label="Yes or no" value={c.value ? 'y' : 'n'} onChange={(e) => onChange({ ...c, value: e.target.value === 'y' })} className={cx(small, 'w-24')}><option value="y">Yes</option><option value="n">No</option></select>}
      {type === 'text' && c.op !== 'empty' && c.op !== 'not_empty' && <input aria-label="Value" value={String(c.value ?? '')} onChange={(e) => onChange({ ...c, value: e.target.value })} className={cx(small, 'min-w-44')} placeholder="text" />}
      {['number', 'money', 'days'].includes(type) && <span className="flex items-center gap-1"><input aria-label="Value" type="number" min={0} value={String(c.value ?? '')} onChange={(e) => onChange({ ...c, value: e.target.value === '' ? '' : Number(e.target.value) })} className={cx(small, 'w-32')} /><span className="text-xs text-mute">{type === 'money' ? '₹' : type === 'days' ? 'days' : ''}</span></span>}
      <button type="button" aria-label="Remove condition" onClick={onRemove} className="grid size-9 place-items-center rounded-lg text-mute hover:text-bad"><X className="size-4" /></button>
    </div>
  )
}

function Recipients({ entity, to, onChange }: { entity: string; to: AutomationRecipient[]; onChange: (to: AutomationRecipient[]) => void }) {
  const db = useDb()
  const has = (k: string) => to.some((r) => r.kind === k)
  const toggle = (k: AutomationRecipient['kind'], on: boolean) => onChange(on ? [...to, { kind: k }] : to.filter((r) => r.kind !== k))
  const roles = to.filter((r) => r.kind === 'role').map((r) => r.role)
  const users = to.filter((r) => r.kind === 'user').map((r) => r.userId)
  return (
    <div className="space-y-2">
      <span className="flex flex-wrap gap-x-4 gap-y-1">
        {RECIPIENTS.filter((r) => ['owner', 'teamlead', 'ops', 'admin'].includes(r.id) && (!r.entity || r.entity === entity)).map((r) => <Checkbox key={r.id} checked={has(r.id)} label={<span className="text-xs">{r.label}</span>} onChange={(on) => toggle(r.id as AutomationRecipient['kind'], on)} />)}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-mute">Everyone with role:</span>
        {roleOptions().map((r) => <button key={r.id} type="button" onClick={() => onChange(roles.includes(r.id) ? to.filter((x) => !(x.kind === 'role' && x.role === r.id)) : [...to, { kind: 'role', role: r.id }])}
          className={cx('rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', roles.includes(r.id) ? 'border-brand bg-brand text-white' : 'border-line hover:bg-card2')}>{r.label}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-mute">People:</span>
        {users.map((u) => <span key={u} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-ink">{userName(db, u)}<button type="button" aria-label="Remove person" onClick={() => onChange(to.filter((x) => !(x.kind === 'user' && x.userId === u)))}><X className="size-3" /></button></span>)}
        <select aria-label="Add a person" value="" onChange={(e) => e.target.value && onChange([...to, { kind: 'user', userId: e.target.value }])} className={cx(small, 'h-8 text-xs')}>
          <option value="">+ add a person</option>{db.users.filter((u) => u.active && !users.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
    </div>
  )
}

function TextWithChips({ label, value, onChange, entity, rows = 1 }: { label: string; value: string; onChange: (v: string) => void; entity: string; rows?: number }) {
  return (
    <div>
      {rows > 1 ? <Textarea label={label} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} /> : <Input label={label} value={value} onChange={(e) => onChange(e.target.value)} />}
      <span className="mt-1 flex flex-wrap gap-1">{(PLACEHOLDERS[entity] ?? []).map((p) => <button key={p} type="button" onClick={() => onChange(`${value}{${p}}`)} className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] text-accent hover:brightness-95">{`{${p}}`}</button>)}</span>
    </div>
  )
}

function ActionCard({ n, entity, a, onChange, onRemove }: { n: number; entity: string; a: AutomationAction; onChange: (a: AutomationAction) => void; onRemove: () => void }) {
  const def = ACTIONS.find((x) => x.id === a.type)
  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <div className="mb-2 flex items-center gap-2"><Badge tone="violet">{n}</Badge><b className="flex-1 text-sm">{def?.label}</b><button type="button" aria-label="Remove action" onClick={onRemove} className="grid size-8 place-items-center rounded-lg text-mute hover:text-bad"><Trash2 className="size-4" /></button></div>
      <div className="space-y-3">
        {['notify', 'email', 'task'].includes(a.type) && <div><p className="mb-1 text-xs font-semibold text-mute">{a.type === 'task' ? 'Assigned to (the first person found)' : 'Goes to'}</p><Recipients entity={entity} to={a.to ?? []} onChange={(to) => onChange({ ...a, to })} /></div>}
        {a.type === 'notify' && <><TextWithChips label="Title" entity={entity} value={a.title ?? ''} onChange={(title) => onChange({ ...a, title })} /><TextWithChips label="Message" rows={2} entity={entity} value={a.body ?? ''} onChange={(body) => onChange({ ...a, body })} /></>}
        {a.type === 'email' && <><TextWithChips label="Subject" entity={entity} value={a.subject ?? ''} onChange={(subject) => onChange({ ...a, subject })} /><TextWithChips label="Message ({first_name} = the person it goes to)" rows={4} entity={entity} value={a.body ?? ''} onChange={(body) => onChange({ ...a, body })} /></>}
        {a.type === 'task' && <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]"><TextWithChips label="Task" entity={entity} value={a.title ?? ''} onChange={(title) => onChange({ ...a, title })} /><Input label="Due in (days)" type="number" min={0} max={365} value={a.dueInDays ?? 0} onChange={(e) => onChange({ ...a, dueInDays: Number(e.target.value) })} /></div>}
        {a.type === 'comment' && <TextWithChips label="Note on the file" rows={2} entity={entity} value={a.text ?? ''} onChange={(text) => onChange({ ...a, text })} />}
        {a.type === 'priority' && <Select label="Priority" value={a.value ?? 'HIGH'} onChange={(e) => onChange({ ...a, value: e.target.value as AutomationAction['value'] })}><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></Select>}
      </div>
    </div>
  )
}

/** Try the rule on real records before saving: a daily check lists what it would act on now; an event rule is tried on a recent record. */
function Preview({ db, rule, entity }: { db: DB; rule: RuleInput; entity: string }) {
  const me = useMe()
  const run = useRun()
  const schedule = !!triggerOf(rule.trigger)?.schedule
  const recent = useMemo(() => {
    const list = (entity === 'booking' ? db.bookings : entity === 'lead' ? db.leads : entity === 'clientEntry' ? db.clientEntries ?? [] : entity === 'invoice' ? db.invoices : entity === 'leave' ? db.leaves : db.users) as { id: string }[]
    return list.slice(0, 30)
  }, [db, entity])
  const [pick, setPick] = useState('')
  const asRule = { ...rule, id: 'preview', position: 0 } as AutomationRule
  if (schedule) {
    const hits = automationProblemsSafe(rule) ? [] : scheduleMatches(db, asRule)
    return (
      <Step n={4} title="Try it" action={canEditAutomation(me) && <Button size="sm" variant="ghost" icon={Play} onClick={() => run(() => runScheduledRulesNowFor(me), 'Daily checks run')}>Run saved daily checks now</Button>}>
        <p className="text-sm">{hits.length ? <><b>{hits.length}</b> record(s) match today — {hits.filter((h) => !h.done).length} would be acted on now.</> : 'No record matches today.'}</p>
        {hits.length > 0 && <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">{hits.slice(0, 20).map((h) => <li key={h.record.id} className="flex gap-2"><Zap className="size-3.5 text-accent" />{String(h.facts.text.record)}{h.done && <Badge tone="gray">done</Badge>}</li>)}</ul>}
      </Step>
    )
  }
  const rec = recent.find((r) => r.id === pick) ?? recent[0]
  const facts = rec ? factsOf(db, entity, rec as never) : null
  const ok = facts ? ruleMatches(rule, facts, FIELDS[entity] ?? {}) : false
  const first = rule.actions[0]
  return (
    <Step n={4} title="Try it on a record">
      {!rec ? <p className="text-sm text-mute">No {ENTITY_LABELS[entity as keyof typeof ENTITY_LABELS]?.toLowerCase()} yet to try it on.</p> : <>
        <select aria-label="Record" value={rec.id} onChange={(e) => setPick(e.target.value)} className={cx(small, 'w-full sm:w-96')}>
          {recent.map((r) => <option key={r.id} value={r.id}>{String(factsOf(db, entity, r as never).text.record)}</option>)}
        </select>
        <p className="mt-2 text-sm">{ok ? <span className="font-semibold text-ok">Conditions hold — the actions would run.</span> : <span className="font-semibold text-mute">Conditions don’t hold for this record — nothing would run.</span>}
          <span className="block text-xs text-mute">(For “changes status”, the status before the change is only known when it happens.)</span></p>
        {ok && first && facts && <div className="mt-2 rounded-xl bg-card2 p-3 text-xs">
          <p className="font-semibold">{ACTIONS.find((d) => d.id === first.type)?.label}{first.to ? ` → ${recipientsOf(db, entity, rec as never, first.to).map((u) => u.name).join(', ') || 'nobody found'}` : ''}</p>
          {(first.title || first.subject) && <p className="mt-1"><b>{fillText(first.title || first.subject, facts)}</b></p>}
          {(first.body || first.text) && <p className="mt-0.5 whitespace-pre-line text-mute">{fillText(first.body || first.text, facts)}</p>}
        </div>}
      </>}
    </Step>
  )
}
/** A daily check without a valid condition or record kind would match everything: no preview then. */
const automationProblemsSafe = (r: RuleInput) => automationProblems(r).some((p) => /condition|look at/i.test(p))
/** Runs the saved, switched-on daily checks now (save the rule first). */
const runScheduledRulesNowFor = (me: Parameters<typeof runRuleNow>[0]) => {
  const first = customRules(getDb()).find((r) => r.enabled && triggerOf(r.trigger)?.schedule)
  if (!first) throw new Error('Save and switch on a daily check first.')
  return runRuleNow(me, first.id)
}
