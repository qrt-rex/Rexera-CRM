import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bug, CheckCircle2, ChevronDown, RefreshCcw, RotateCcw, Search, ShieldCheck, Stethoscope, Wand2, XCircle } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { ago, fmtDateTime } from '../../lib/format'
import { loadErrors, setErrorStatus, type AppError } from '../../lib/errorReport'
import { runHealthCheck, type HealthItem } from '../../lib/itops'
import { Badge, Button, Card, CardHeader, cx, EmptyState, PageHeader, Select, Stat, Tabs, useToast } from '../../components/ui'

type View = 'open' | 'auto_fixed' | 'solved' | 'all'
const SOURCE: Record<AppError['source'], string> = { browser: 'Screen', save: 'Save', server: 'Server', sync: 'Old CRM sync' }

/**
 * IT Support → Error log. Every error in the CRM, grouped and diagnosed: what it means, how to fix it, and what the
 * CRM already fixed by itself. Live (refreshes every 15 s). Also runs the system checks and their automatic fixes.
 */
export default function ErrorLog() {
  const db = useDb()
  const me = useMe()
  const toast = useToast()
  const [list, setList] = useState<AppError[] | null>(null)
  const [err, setErr] = useState('')
  const [view, setView] = useState<View>('open')
  const [source, setSource] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [health, setHealth] = useState<HealthItem[] | null>(null)
  const [busy, setBusy] = useState('')

  const refresh = useCallback(async () => {
    try { setList(await loadErrors()); setErr('') } catch (e) { setErr((e as Error).message) }
  }, [])
  const check = useCallback(async () => { setHealth(await runHealthCheck()) }, [])
  useEffect(() => { void refresh(); void check() }, [refresh, check])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 15000)
    return () => clearInterval(t)
  }, [refresh])

  const all = list ?? []
  const day = Date.now() - 86_400_000
  const counts = {
    open: all.filter((e) => e.status === 'open').length, auto_fixed: all.filter((e) => e.status === 'auto_fixed').length,
    solved: all.filter((e) => e.status === 'solved').length, today: all.filter((e) => Date.parse(e.last_at) > day).reduce((n, e) => n + 1, 0),
  }
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return all.filter((e) => (view === 'all' || e.status === view) && (!source || e.source === source)
      && (!s || `${e.title} ${e.message} ${e.place ?? ''} ${e.code}`.toLowerCase().includes(s)))
  }, [all, view, source, q])

  const mark = async (ids: number[], status: 'open' | 'solved') => {
    setBusy(`mark-${ids.join(',')}`)
    try { await setErrorStatus(ids, status, me.id); toast('success', status === 'solved' ? `${ids.length} marked solved — it opens again by itself if it happens again` : 'Opened again'); await refresh() }
    catch (e) { toast('error', (e as Error).message) }
    setBusy('')
  }
  const fixable = (health ?? []).filter((h) => h.level !== 'ok' && h.fix)
  const fixAll = async () => {
    setBusy('fixall')
    let done = 0
    for (const h of fixable) { try { await h.fix!.run(me); done++ } catch (e) { toast('error', `${h.title}: ${(e as Error).message}`) } }
    toast('success', `${done} problem${done === 1 ? '' : 's'} fixed automatically`)
    await check(); setBusy('')
  }

  return (
    <div>
      <PageHeader title="Error log & auto-fix" icon={Bug}
        subtitle="Every error in the CRM — on anyone's screen, in a save, on the server, in the old CRM sync — explained, with the fix, and fixed by itself where it can be. Live."
        actions={<Button variant="outline" size="sm" icon={RefreshCcw} onClick={() => { void refresh(); void check() }}>Refresh</Button>} />

      {err && <div className="mb-4 flex items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" /><p className="text-warn">{err}</p></div>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={XCircle} tone={counts.open ? 'red' : 'green'} label="Open — need a look" value={counts.open} onClick={() => setView('open')} />
        <Stat icon={Wand2} tone="violet" label="Fixed automatically" value={counts.auto_fixed} onClick={() => setView('auto_fixed')} />
        <Stat icon={CheckCircle2} tone="green" label="Solved" value={counts.solved} onClick={() => setView('solved')} />
        <Stat icon={Bug} tone="blue" label="Seen in the last 24 h" value={counts.today} onClick={() => setView('all')} />
      </div>

      <Card className="mb-4">
        <CardHeader icon={Stethoscope} title="System checks" subtitle={health ? `${health.length} checks · ${health.filter((h) => h.level !== 'ok').length} to review · ${fixable.length} fixable automatically` : 'Running…'}
          action={<div className="flex gap-2">
            <Button size="sm" variant="ghost" icon={RefreshCcw} onClick={() => void check()}>Re-run</Button>
            {fixable.length > 0 && <Button size="sm" icon={Wand2} loading={busy === 'fixall'} onClick={fixAll}>Fix all automatically ({fixable.length})</Button>}
          </div>} />
        <ul className="divide-y divide-line/70">
          {(health ?? []).filter((h) => h.level !== 'ok').map((h) => (
            <li key={h.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              {h.level === 'warn' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" />}
              <div className="min-w-0 flex-1"><p className="font-semibold">{h.title}</p><p className="text-xs text-mute">{h.detail}</p></div>
              {h.fix && <Button size="sm" variant="soft" loading={busy === `fix-${h.id}`} onClick={async () => { setBusy(`fix-${h.id}`); try { await h.fix!.run(me); toast('success', `${h.title}: fixed`) } catch (e) { toast('error', (e as Error).message) } await check(); setBusy('') }}>{h.fix.label}</Button>}
            </li>
          ))}
          {health && !health.some((h) => h.level !== 'ok') && <li className="flex items-center gap-2 px-4 py-3 text-sm text-ok"><ShieldCheck className="size-4" />All {health.length} checks passed.</li>}
        </ul>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <Tabs value={view} onChange={setView} tabs={[
            { id: 'open', label: 'Open', count: counts.open }, { id: 'auto_fixed', label: 'Fixed automatically', count: counts.auto_fixed },
            { id: 'solved', label: 'Solved', count: counts.solved }, { id: 'all', label: 'All' },
          ]} />
          <Select aria-label="Where" value={source} onChange={(e) => setSource(e.target.value)} className="!h-8 !py-0 text-xs">
            <option value="">Everywhere</option>{Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <label className="relative ml-auto min-w-[12rem] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-mute" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search errors, pages…" aria-label="Search errors" className="h-8 w-full rounded-lg border border-line bg-card pl-8 pr-2 text-xs" />
          </label>
          {view === 'open' && shown.length > 1 && <Button size="sm" variant="outline" icon={CheckCircle2} loading={busy.startsWith('mark-')} onClick={() => mark(shown.map((e) => e.id), 'solved')}>Mark all solved</Button>}
        </div>
        {list === null && !err && <p className="px-4 py-6 text-sm text-mute">Loading…</p>}
        {list !== null && !shown.length && <EmptyState icon={view === 'open' ? ShieldCheck : Bug} title={view === 'open' ? 'No open errors' : 'Nothing here'} text={view === 'open' ? 'Everything that went wrong was fixed automatically or marked solved.' : undefined} />}
        <ul className="divide-y divide-line/70">
          {shown.map((e) => (
            <li key={e.id}>
              <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-card2/60" onClick={() => setOpen(open === e.id ? null : e.id)}>
                {e.status === 'open' ? <Badge tone="red" dot>open</Badge> : e.status === 'auto_fixed' ? <Badge tone="violet"><Wand2 className="size-3" />fixed automatically</Badge> : <Badge tone="green"><CheckCircle2 className="size-3" />solved</Badge>}
                <span className="min-w-0 flex-1 truncate font-semibold">{e.title || e.message}</span>
                <Badge tone="gray">{SOURCE[e.source]}</Badge>
                {e.count > 1 && <Badge tone="amber">×{e.count.toLocaleString('en-IN')}</Badge>}
                <span className="text-xs text-mute">{ago(e.last_at)}</span>
                <ChevronDown className={cx('size-4 text-mute transition', open === e.id && 'rotate-180')} />
                <p className="basis-full truncate text-xs text-mute">{e.message}{e.place ? ` · ${e.place}` : ''}</p>
              </button>
              {open === e.id && (
                <div className="grid gap-3 bg-card2/40 px-4 py-3 text-xs md:grid-cols-2">
                  <div className="space-y-2">
                    <p><b>What happened:</b> <span className="text-mute">{e.diagnosis}</span></p>
                    <p><b>How to fix it:</b> <span className="text-mute">{e.fix}</span></p>
                    {e.auto_fix && <p className="rounded-lg bg-violet-500/10 px-2 py-1.5"><Wand2 className="mr-1 inline size-3.5 text-violet-600" /><b>Done automatically:</b> {e.auto_fix}</p>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {e.status !== 'solved'
                        ? <Button size="sm" icon={CheckCircle2} loading={busy === `mark-${e.id}`} onClick={() => mark([e.id], 'solved')}>Mark solved</Button>
                        : <Button size="sm" variant="outline" icon={RotateCcw} loading={busy === `mark-${e.id}`} onClick={() => mark([e.id], 'open')}>Open again</Button>}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p><b>Message:</b> <span className="break-words font-mono text-[11px]">{e.message}</span></p>
                    <p><b>Where:</b> {e.place || '—'} · {SOURCE[e.source]}</p>
                    <p><b>Who:</b> {e.user_id ? userName(db, e.user_id) : '—'}</p>
                    <p><b>Seen:</b> {e.count.toLocaleString('en-IN')} time{e.count === 1 ? '' : 's'} · first {fmtDateTime(e.first_at)} · last {fmtDateTime(e.last_at)}</p>
                    {e.solved_at && <p><b>Solved:</b> {fmtDateTime(e.solved_at)}{e.solved_by ? ` by ${userName(db, e.solved_by)}` : ''}</p>}
                    {e.detail && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-card px-2 py-1.5 font-mono text-[10px] text-mute">{e.detail}</pre>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
