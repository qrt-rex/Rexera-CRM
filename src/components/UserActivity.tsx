import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Eraser, FileText, MousePointerClick, MousePointer2, RefreshCcw, Send, SlidersHorizontal, XCircle, type LucideIcon } from 'lucide-react'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { roleLabel } from '../lib/rbac'
import { ACTIVITY_KINDS, canReadActivity, loadActivity, pruneActivity, type ActivityEvent, type ActivityKind } from '../lib/activity'
import { downloadCsv, fmtDate, today } from '../lib/format'
import { Avatar, Badge, Button, Card, CardHeader, cx, Toggle, useConfirm, useRun } from './ui'

const PAGE = 200
const KIND: Record<ActivityKind, { icon: LucideIcon; tone: 'navy' | 'blue' | 'violet' | 'amber' | 'green' | 'red'; label: string }> = {
  page: { icon: FileText, tone: 'navy', label: 'page' }, click: { icon: MousePointerClick, tone: 'blue', label: 'click' }, change: { icon: SlidersHorizontal, tone: 'violet', label: 'choice' },
  submit: { icon: Send, tone: 'amber', label: 'submit' }, action: { icon: MousePointer2, tone: 'green', label: 'action' }, error: { icon: AlertTriangle, tone: 'red', label: 'error' },
}
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })

/**
 * IT dashboard → User activity: every page, click, choice, form and action result of every person, newest first —
 * filter by person, kind, dates and text; export; clear old events. Only the IT Support team sees it (the database
 * lets nobody else read it — not Super Admin either).
 */
export function UserActivity() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [userId, setUserId] = useState('')
  const [kind, setKind] = useState<ActivityKind | ''>('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<ActivityEvent[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [live, setLive] = useState(true)
  const filter = useMemo(() => ({ from, to: to < from ? from : to, userId: userId || undefined, kind, q }), [from, to, userId, kind, q])

  const load = useCallback(async (append = false) => {
    setLoading(true); setError('')
    try {
      const got = await loadActivity(filter, append ? rows.length : 0, PAGE)
      setRows((r) => (append ? [...r, ...got] : got))
      setMore(got.length === PAGE)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the activity.') } finally { setLoading(false) }
  }, [filter, rows.length])
  // reload when a filter changes (typing in the search waits a moment)
  useEffect(() => { const t = setTimeout(() => { void load(false) }, q ? 400 : 0); return () => clearTimeout(t) }, [filter])  // eslint-disable-line react-hooks/exhaustive-deps
  // live: the newest events every 20 seconds while looking at today
  useEffect(() => {
    if (!live || filter.to !== today()) return
    const t = setInterval(() => { void load(false) }, 20000)
    return () => clearInterval(t)
  }, [live, filter, load])

  if (!canReadActivity(me)) return null
  const name = (id: string) => db.users.find((u) => u.id === id)?.name ?? 'Former user'
  const people = [...rows.reduce((m, r) => m.set(r.userId, (m.get(r.userId) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])
  const failed = rows.filter((r) => r.kind === 'action' && r.ok === false).length
  const errors = rows.filter((r) => r.kind === 'error').length
  const ctl = 'h-9 rounded-lg border border-line bg-card px-2.5 text-sm outline-none focus:border-brand'
  let lastDay = ''

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader title="User activity — every click" icon={MousePointerClick}
        subtitle="Every page, click, choice, form and action result of every person. Only the IT Support team sees this — typed text and passwords are never recorded."
        action={<span className="flex items-center gap-2 text-xs text-mute"><Toggle checked={live} onChange={setLive} label="Live" />Live</span>} />
      <div className="flex flex-wrap items-end gap-2 border-b border-line px-5 py-3">
        <label className="text-[11px] font-semibold text-mute">From<input type="date" max={today()} value={from} onChange={(e) => setFrom(e.target.value)} className={cx(ctl, 'block')} /></label>
        <label className="text-[11px] font-semibold text-mute">To<input type="date" max={today()} min={from} value={to} onChange={(e) => setTo(e.target.value)} className={cx(ctl, 'block')} /></label>
        <label className="text-[11px] font-semibold text-mute">Person
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={cx(ctl, 'block min-w-44')} aria-label="Person">
            <option value="">Everyone</option>{[...db.users].sort((a, b) => a.name.localeCompare(b.name)).map((u) => <option key={u.id} value={u.id}>{u.name} · {roleLabel(u.role)}</option>)}
          </select></label>
        <label className="text-[11px] font-semibold text-mute">Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as ActivityKind | '')} className={cx(ctl, 'block')} aria-label="Kind">
            <option value="">Everything</option>{ACTIVITY_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select></label>
        <label className="min-w-48 flex-1 text-[11px] font-semibold text-mute">Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Button, page, client…" className={cx(ctl, 'block w-full')} aria-label="Search the activity" /></label>
        <Button size="sm" variant="outline" icon={RefreshCcw} loading={loading} onClick={() => load(false)}>Refresh</Button>
        <Button size="sm" variant="outline" icon={Download} disabled={!rows.length} onClick={() => downloadCsv(`user-activity-${filter.from}${filter.to !== filter.from ? `-to-${filter.to}` : ''}.csv`, rows.map((r) => ({
          time: new Date(r.at).toLocaleString('en-IN'), person: name(r.userId), role: roleLabel(r.role as never), kind: r.kind, what: r.label, where: r.area ?? '', page: r.path, detail: r.detail ?? '', result: r.ok === undefined ? '' : r.ok ? 'done' : 'failed',
        })))}>Export</Button>
        <Button size="sm" variant="ghost" icon={Eraser} onClick={async () => {
          if (await confirm('Clear old activity?', 'Removes every event older than 90 days, for everyone. Export first if you need them.', true)) { const n = await run(() => pruneActivity(90), 'Old activity cleared'); if (n !== undefined) void load(false) }
        }}>Clear &gt; 90 days</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-line px-5 py-3 text-sm sm:grid-cols-4">
        <span><b className="block text-lg tabular-nums">{rows.length}{more ? '+' : ''}</b><span className="text-xs text-mute">events shown</span></span>
        <span><b className="block text-lg tabular-nums">{people.length}</b><span className="text-xs text-mute">people</span></span>
        <span><b className={cx('block text-lg tabular-nums', failed > 0 && 'text-bad')}>{failed}</b><span className="text-xs text-mute">failed actions</span></span>
        <span><b className={cx('block text-lg tabular-nums', errors > 0 && 'text-bad')}>{errors}</b><span className="text-xs text-mute">screen errors</span></span>
      </div>
      {people.length > 1 && !userId && (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-2.5">
          {people.slice(0, 12).map(([id, n]) => <button key={id} type="button" onClick={() => setUserId(id)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-semibold hover:bg-card2" title={`Only ${name(id)}`}>{name(id)}<Badge tone="gray">{n}</Badge></button>)}
        </div>
      )}

      {error ? <p className="flex items-center gap-2 px-5 py-6 text-sm text-bad"><XCircle className="size-4" />{error}</p>
        : !rows.length ? <p className="px-5 py-10 text-center text-sm text-mute">{loading ? 'Loading…' : 'No activity for these filters.'}</p> : (
          <ul className="max-h-[640px] divide-y divide-line/60 overflow-y-auto">
            {rows.map((r) => {
              const k = KIND[r.kind] ?? KIND.click
              const day = r.at.slice(0, 10)
              const head = day !== lastDay
              lastDay = day
              return (
                <li key={r.id}>
                  {head && <p className="sticky top-0 z-[1] bg-card2 px-5 py-1 text-[11px] font-bold uppercase tracking-wide text-mute">{fmtDate(r.at)}</p>}
                  <div className="flex items-start gap-3 px-5 py-2">
                    <span className="w-[84px] shrink-0 pt-0.5 font-mono text-[11px] text-mute">{time(r.at)}</span>
                    <span className="flex w-40 shrink-0 items-center gap-2 max-sm:hidden"><Avatar name={name(r.userId)} size={24} /><span className="min-w-0"><span className="block truncate text-xs font-semibold">{name(r.userId)}</span><span className="block truncate text-[10px] text-mute">{roleLabel(r.role as never)}</span></span></span>
                    <Badge tone={k.tone} className="shrink-0"><k.icon className="mr-1 inline size-3" />{k.label}</Badge>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="sm:hidden text-xs font-semibold text-mute">{name(r.userId)} · </span>
                      <b className="break-words">{r.label}</b>
                      {r.kind === 'action' && (r.ok ? <CheckCircle2 className="ml-1 inline size-3.5 text-ok" /> : <XCircle className="ml-1 inline size-3.5 text-bad" />)}
                      <span className="block truncate text-[11px] text-mute">{[r.area, r.path].filter(Boolean).join(' · ')}</span>
                      {r.detail && <span className={cx('block text-[11px]', r.ok === false ? 'text-bad' : 'text-mute')}>{r.detail}</span>}
                    </span>
                  </div>
                </li>
              )
            })}
            {more && <li className="p-3 text-center"><Button size="sm" variant="ghost" loading={loading} onClick={() => load(true)}>Load {PAGE} more</Button></li>}
          </ul>
        )}
      {confirmNode}
    </Card>
  )
}
