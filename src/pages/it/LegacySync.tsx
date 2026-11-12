import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowLeftRight, BookOpen, CheckCircle2, ChevronDown, Cloud, Copy, Database, DatabaseZap, Download, FileWarning, HardDrive, History, KeyRound,
  Loader2, Play, Plug, RefreshCcw, Server, Settings2, ShieldCheck, Square, Wand2, XCircle, type LucideIcon,
} from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { ago, fmtDateTime } from '../../lib/format'
import {
  INTERVALS, LATEST_CONNECTOR, bytes, connectorOutdated, intervalText, loadStatus, loadStorage, newSecret, runNow, saveConfig, stopRun, testConnection,
  type Ping, type SyncRun, type SyncStatus, type SyncStorage, type TableSize,
} from '../../lib/legacySync'
import { Logo } from '../../components/Logo'
import { Badge, Button, Card, CardHeader, cx, EmptyState, Input, PageHeader, Progress, Select, Tabs, Toggle, useConfirm, useToast } from '../../components/ui'

type Tab = 'overview' | 'log' | 'settings' | 'guide'
const MB = 1048576, GB = 1073741824

/**
 * IT Support → Old CRM sync. One switch turns the live copy from the old PHP CRM on or off; the page shows both CRMs,
 * their connection and storage, every sync run with its errors and failed files, the settings and the setup steps.
 * Everything runs on the CRM server (server/legacySync.mjs); this page only reads and changes it.
 */
export default function LegacySync() {
  const db = useDb()
  const me = useMe()
  const toast = useToast()
  const [confirm, confirmNode] = useConfirm()
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('tab') as Tab) || 'overview')
  const [st, setSt] = useState<SyncStatus | null>(null)
  const [storage, setStorage] = useState<SyncStorage | null>(null)
  const [err, setErr] = useState('')
  const [storageErr, setStorageErr] = useState('')
  const [busy, setBusy] = useState('')

  const refresh = useCallback(async () => {
    try { setSt(await loadStatus()); setErr('') } catch (e) { setErr((e as Error).message) }
  }, [])
  const refreshStorage = useCallback(async (fresh = false) => {
    try { setStorage(await loadStorage(fresh)); setStorageErr('') } catch (e) { setStorageErr((e as Error).message) }
  }, [])
  useEffect(() => { void refresh(); void refreshStorage() }, [refresh, refreshStorage])
  // live: every 5 s while a copy runs, every 15 s otherwise (only while this page is open and visible)
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, st?.running ? 5000 : 15000)
    return () => clearInterval(t)
  }, [refresh, st?.running])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refreshStorage() }, 60000)
    return () => clearInterval(t)
  }, [refreshStorage])

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try { await fn(); if (ok) toast('success', ok); await refresh() } catch (e) { toast('error', (e as Error).message) }
    setBusy('')
  }

  const cfg = st?.config
  const s = cfg?.state ?? {}
  const runs = st?.runs ?? []
  const oldName = cfg?.old_name || s.old?.name || 'Old CRM'
  const oldLogo = cfg?.old_logo || s.old?.logo || ''
  const connected = !!cfg?.url && s.connected !== false && !!(s.lastPingAt || s.lastOkAt)
  const lastRun = runs[0]
  const failedFiles = runs.find((r) => r.status !== 'running')?.files?.failed ?? []
  const errors = runs.filter((r) => r.status === 'error').length
  const totals = useMemo(() => runs.reduce((t, r) => ({
    added: t.added + (r.written?.totals?.added ?? 0), updated: t.updated + (r.written?.totals?.updated ?? 0), kept: t.kept + (r.written?.totals?.kept ?? 0), files: t.files + (r.files?.copied ?? 0),
  }), { added: 0, updated: 0, kept: 0, files: 0 }), [runs])

  const toggle = async (on: boolean) => {
    // nothing to connect to yet → straight to the address box instead of an error
    if (on && !cfg?.url) {
      setTab('settings')
      toast('info', 'First enter the old CRM connector’s address and press Test connection — a working address is saved, then turn the sync on.')
      return
    }
    if (on && st?.secret.problem) { setTab('guide'); toast('error', `LEGACY_SYNC_SECRET on Render: ${st.secret.problem}. See step 2 of the Setup guide.`); return }
    if (!on && !(await confirm('Turn the old CRM sync off?', 'Copying stops at once (a copy in progress stops before it writes). Everything already copied stays in the new CRM. You can turn it on again any time.'))) return
    await act('toggle', () => saveConfig({ enabled: on }), on ? `Old CRM sync is ON — checking every ${intervalText(cfg?.interval_sec ?? 60)}` : 'Old CRM sync is OFF')
  }
  const copyAll = async () => {
    if (!(await confirm('Copy everything from the old CRM now?', 'Reads every table of the old CRM and adds what is missing or changed there. Nothing is duplicated, nothing in the new CRM is deleted, and records someone changed in the new CRM keep their changes (unless Settings say otherwise). It can take a few minutes on a large CRM.'))) return
    await act('run', () => runNow(true), 'Full copy started — follow it in the Activity log')
  }

  const status: { tone: 'green' | 'amber' | 'red' | 'gray' | 'blue'; text: string } =
    st?.running ? { tone: 'blue', text: 'Copying now…' }
      : !cfg?.enabled ? { tone: 'gray', text: 'Off' }
        : s.lastError ? { tone: 'red', text: 'On · last check failed' }
          : { tone: 'green', text: `On · checks every ${intervalText(cfg.interval_sec)}` }

  return (
    <div>
      <PageHeader title="Old CRM sync" icon={ArrowLeftRight}
        subtitle="Copies every record, file and attachment from the old PHP CRM into this CRM, then keeps copying new and changed data while the switch is on. IT Support only."
        actions={<Button variant="outline" size="sm" icon={RefreshCcw} onClick={() => { void refresh(); void refreshStorage(true) }}>Refresh</Button>} />

      {err && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" />
          <div className="min-w-0"><p className="font-semibold text-warn">Can't load the sync status</p><p className="text-mute">{err}</p><p className="mt-1 text-xs text-mute">The setup steps are in the Setup guide tab.</p></div>
        </div>
      )}

      {/* the two CRMs and the switch between them */}
      <div className="mb-5 grid items-stretch gap-3 lg:grid-cols-[1fr_minmax(260px,320px)_1fr]">
        <CrmCard
          logo={oldLogo ? <img src={oldLogo} alt="" className="h-9 max-w-[160px] object-contain" /> : <span className="grid size-9 place-items-center rounded-lg bg-card2 text-mute"><Server className="size-5" /></span>}
          name={oldName} role="Source · old PHP CRM (MySQL)"
          badge={!cfg?.url ? <Badge tone="gray" dot>Not set up</Badge> : connected ? <Badge tone="green" dot>Connected</Badge> : <Badge tone="red" dot>Not connected</Badge>}
          rows={[
            ['Connector', s.old?.version ? `v${s.old.version} · PHP ${s.old.php ?? '?'}` : '—'],
            ['MySQL', s.old?.databases?.main?.mysql ?? '—'],
            ['Database', storage?.old ? bytes(Object.values(storage.old.databases).reduce((n, d) => n + d.bytes, 0)) : '—'],
            ['Uploaded files', storage?.old?.files ? `${bytes(storage.old.files.bytes)} · ${storage.old.files.files.toLocaleString('en-IN')} files` : '—'],
            ['Records in old CRM', s.oldTotal != null ? s.oldTotal.toLocaleString('en-IN') : '—'],
            ['Records read (last copy)', s.oldRows != null ? s.oldRows.toLocaleString('en-IN') : cfg?.url ? 'after the first copy' : '—'],
          ]} />

        <Card className="flex flex-col p-4">
          <div className="flex items-center gap-3">
            <span className={cx('grid size-10 place-items-center rounded-xl', cfg?.enabled ? 'bg-ok-soft text-ok' : 'bg-card2 text-mute')}>
              {st?.running ? <Loader2 className="size-5 animate-spin" /> : <ArrowLeftRight className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-mute">Real-time sync</p>
              <p className="truncate text-base font-extrabold">{cfg?.enabled ? 'ON' : 'OFF'}</p>
            </div>
            {busy === 'toggle' ? <Loader2 className="size-5 animate-spin text-mute" /> : <Toggle checked={!!cfg?.enabled} onChange={(v) => void toggle(v)} label="Old CRM sync on or off" />}
          </div>
          <div className="mt-3"><Badge tone={status.tone} dot>{status.text}</Badge></div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-mute">Last check</dt><dd className="text-right font-semibold">{s.lastCheckAt ? ago(s.lastCheckAt) : '—'}</dd>
            <dt className="text-mute">Last copy</dt><dd className="text-right font-semibold">{s.lastOkAt ? ago(s.lastOkAt) : 'never'}</dd>
            <dt className="text-mute">Conflicts</dt><dd className="text-right font-semibold">{cfg?.prefer === 'old' ? 'old CRM wins' : 'new CRM wins'}</dd>
          </dl>
          {s.lastError && <p className="mt-2 line-clamp-3 rounded-lg bg-bad-soft px-2.5 py-1.5 text-[11px] text-bad">{s.lastError}</p>}
          <div className="mt-auto flex flex-wrap gap-2 pt-3">
            {st?.running
              ? <Button size="sm" variant="danger" icon={Square} loading={busy === 'stop'} onClick={() => act('stop', stopRun, 'Stopping — nothing more is written')}>Stop</Button>
              : <>
                <Button size="sm" icon={Play} disabled={!cfg?.url} loading={busy === 'run'} onClick={() => act('run', () => runNow(false), 'Copy started')}>Copy now</Button>
                <Button size="sm" variant="outline" icon={DatabaseZap} disabled={!cfg?.url} onClick={() => void copyAll()}>Copy everything</Button>
              </>}
          </div>
        </Card>

        <CrmCard
          logo={<Logo size="sm" />} name="Rexera CRM 2.0" role="Destination · this CRM (Supabase)"
          badge={st ? <Badge tone="green" dot>Connected</Badge> : <Badge tone="gray" dot>—</Badge>}
          rows={[
            ['Database', storage ? `${bytes(storage.new.database_bytes)} of ${bytes(storage.new.db_limit_bytes)}` : '—'],
            ['File storage', storage ? `${bytes(storage.new.buckets.reduce((n, b) => n + b.bytes, 0))} of ${bytes(storage.new.storage_limit_bytes)}` : '—'],
            ['Added by sync', totals.added.toLocaleString('en-IN')],
            ['Updated by sync', totals.updated.toLocaleString('en-IN')],
            ['Files copied', totals.files.toLocaleString('en-IN')],
          ]} />
      </div>

      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Storage & statistics', icon: HardDrive },
        { id: 'log', label: 'Activity log', icon: History, count: errors || undefined },
        { id: 'settings', label: 'Settings', icon: Settings2 },
        { id: 'guide', label: 'Setup guide', icon: BookOpen },
      ]} />

      {tab === 'overview' && <Overview st={st} storage={storage} storageErr={storageErr} totals={totals} lastRun={lastRun} failedFiles={failedFiles.length} onRefresh={() => refreshStorage(true)} />}
      {tab === 'log' && <RunLog runs={runs} userOf={(id) => (id ? userName(db, id) : '—')} onRetry={() => act('run', () => runNow(false), 'Copy started — failed files are tried again')} running={!!st?.running} canRun={!!cfg?.url} />}
      {tab === 'settings' && st && <SettingsTab st={st} onSaved={async () => { await refresh(); void refreshStorage(true) }} />}
      {tab === 'settings' && !st && <Card><EmptyState icon={Settings2} title="Settings load from the CRM server" text={err || 'Loading…'} /></Card>}
      {tab === 'guide' && <Guide st={st} />}

      <p className="mt-5 text-[11px] text-mute">Signed in as {me.name}. Every change of these settings is written to the activity log.</p>
      {confirmNode}
    </div>
  )
}

function CrmCard({ logo, name, role, badge, rows }: { logo: ReactNode; name: string; role: string; badge: ReactNode; rows: [string, ReactNode][] }) {
  return (
    <Card className="p-4">
      <div className="flex min-h-10 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center">{logo}</div>
        {badge}
      </div>
      <p className="mt-2 truncate text-sm font-extrabold">{name}</p>
      <p className="text-[11px] text-mute">{role}</p>
      <dl className="mt-3 divide-y divide-line/60 text-xs">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-mute">{k}</dt><dd className="truncate text-right font-semibold">{v}</dd></div>)}
      </dl>
    </Card>
  )
}

// ------------------------------------------------------------------ storage & statistics
function Meter({ label, used, limit, sub }: { label: string; used: number | null | undefined; limit: number | null | undefined; sub?: string }) {
  const pct = used != null && limit ? Math.round((used / limit) * 100) : null
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold">{label}</span>
        <span className="text-mute"><b className="text-ink">{bytes(used)}</b> used{limit ? ` of ${bytes(limit)} · ${bytes(Math.max(0, limit - (used ?? 0)))} free` : ''}</span>
      </div>
      <Progress value={pct ?? 0} tone={pct == null ? 'navy' : pct >= 90 ? 'red' : pct >= 75 ? 'orange' : 'green'} />
      <p className="mt-0.5 text-[11px] text-mute">{pct != null ? `${pct}% used` : ''}{sub ? `${pct != null ? ' · ' : ''}${sub}` : ''}</p>
    </div>
  )
}
function TopTables({ tables }: { tables: TableSize[] }) {
  const [all, setAll] = useState(false)
  const list = all ? tables : tables.slice(0, 8)
  if (!tables.length) return null
  return (
    <div>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-[11px] text-mute"><th className="py-1 font-semibold">Table</th><th className="py-1 text-right font-semibold">Rows</th><th className="py-1 text-right font-semibold">Size</th></tr></thead>
        <tbody className="divide-y divide-line/60">
          {list.map((t) => <tr key={t.name}><td className="truncate py-1 font-mono text-[11px]">{t.name}</td><td className="py-1 text-right tabular-nums">{Number(t.rows).toLocaleString('en-IN')}</td><td className="py-1 text-right tabular-nums">{bytes(t.bytes)}</td></tr>)}
        </tbody>
      </table>
      {tables.length > 8 && <button className="mt-1 text-[11px] font-semibold text-brand-ink hover:underline" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${tables.length} tables`}</button>}
    </div>
  )
}

function Overview({ st, storage, storageErr, totals, lastRun, failedFiles, onRefresh }: {
  st: SyncStatus | null; storage: SyncStorage | null; storageErr: string; totals: { added: number; updated: number; kept: number; files: number }; lastRun?: SyncRun; failedFiles: number; onRefresh: () => void
}) {
  const s = st?.config.state ?? {}
  const n = storage?.new
  const o = storage?.old
  const files = n?.buckets.reduce((t, b) => t + b.bytes, 0)
  const oldDb = o ? Object.values(o.databases).reduce((t, d) => t + d.bytes, 0) : null
  const stat = (icon: LucideIcon, label: string, value: ReactNode, sub: string, tone = 'bg-brand-soft text-brand-ink') => (
    <Card className="p-3">
      <div className="flex items-center gap-2"><span className={cx('grid size-7 place-items-center rounded-lg', tone)}>{(() => { const I = icon; return <I className="size-4" /> })()}</span><span className="truncate text-[11px] font-semibold text-mute">{label}</span></div>
      <p className="mt-1 truncate text-lg font-extrabold tabular-nums">{value}</p><p className="truncate text-[11px] text-mute">{sub}</p>
    </Card>
  )
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stat(History, 'Last check', s.lastCheckAt ? ago(s.lastCheckAt) : '—', s.lastCheckAt ? fmtDateTime(s.lastCheckAt) : 'not checked yet')}
        {stat(CheckCircle2, 'Last copy', s.lastOkAt ? ago(s.lastOkAt) : 'never', s.lastTotals ? `+${s.lastTotals.added} · ${s.lastTotals.updated} updated` : '—', 'bg-ok-soft text-ok')}
        {stat(Database, 'Records added', totals.added.toLocaleString('en-IN'), 'last 50 runs', 'bg-ok-soft text-ok')}
        {stat(RefreshCcw, 'Records updated', totals.updated.toLocaleString('en-IN'), 'changed in the old CRM', 'bg-info-soft text-info')}
        {stat(ShieldCheck, 'Kept (new CRM wins)', totals.kept.toLocaleString('en-IN'), 'changed here, not overwritten', 'bg-violet-500/12 text-violet-600 dark:text-violet-300')}
        {stat(FileWarning, 'Files copied / failed', `${totals.files.toLocaleString('en-IN')} / ${failedFiles}`, lastRun?.files?.more ? 'more files next run' : 'attachments & proofs', failedFiles ? 'bg-bad-soft text-bad' : 'bg-accent-soft text-accent')}
      </div>

      {storageErr && <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Storage: {storageErr}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={Cloud} title="New CRM · Supabase" subtitle="Database and file storage of this CRM — limits from your Supabase plan (Settings)"
            action={<Button size="sm" variant="ghost" icon={RefreshCcw} onClick={onRefresh}>Refresh</Button>} />
          <div className="grid gap-4 p-4">
            <Meter label="Database" used={n?.database_bytes} limit={n?.db_limit_bytes} sub="all tables and indexes" />
            <Meter label="File storage" used={files} limit={n?.storage_limit_bytes} sub={n ? `${n.buckets.reduce((t, b) => t + b.files, 0).toLocaleString('en-IN')} files` : undefined} />
            {!!n?.buckets.length && (
              <div className="flex flex-wrap gap-2">{n.buckets.map((b) => <span key={b.bucket} className="rounded-full border border-line px-2.5 py-1 text-[11px]"><b>{b.bucket}</b> · {b.files.toLocaleString('en-IN')} files · {bytes(b.bytes)}</span>)}</div>
            )}
            <TopTables tables={n?.tables ?? []} />
          </div>
        </Card>
        <Card>
          <CardHeader icon={Server} title="Old CRM · hosting" subtitle={storage?.oldAt ? `MySQL and uploads folder · read ${ago(storage.oldAt)}` : 'MySQL and uploads folder (through the connector)'} />
          <div className="grid gap-4 p-4">
            {storage?.oldError && <p className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">{storage.oldError}</p>}
            {!o && !storage?.oldError && <p className="text-sm text-mute">Shown once the connector is set up and tested (Setup guide).</p>}
            {o && <>
              <Meter label="Disk of the old CRM's hosting" used={o.disk?.total != null && o.disk.free != null ? o.disk.total - o.disk.free : null} limit={o.disk?.total} />
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-card2 p-2"><p className="text-mute">Databases</p><p className="font-extrabold">{bytes(oldDb)}</p></div>
                <div className="rounded-lg bg-card2 p-2"><p className="text-mute">Uploads</p><p className="font-extrabold">{bytes(o.files?.bytes)}</p></div>
                <div className="rounded-lg bg-card2 p-2"><p className="text-mute">Files</p><p className="font-extrabold">{o.files ? o.files.files.toLocaleString('en-IN') : '—'}</p></div>
              </div>
              {Object.entries(o.databases).map(([name, d]) => (
                <div key={name}><p className="mb-1 text-xs font-semibold">{name === 'main' ? 'Main database' : 'Billing database'} · {bytes(d.bytes)}</p><TopTables tables={d.tables} /></div>
              ))}
            </>}
          </div>
        </Card>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ activity log
const statusBadge = (r: SyncRun) => r.status === 'ok' ? <Badge tone="green">done</Badge> : r.status === 'partial' ? <Badge tone="amber">done · some left</Badge> : r.status === 'running' ? <Badge tone="blue"><Loader2 className="size-3 animate-spin" />running</Badge> : r.status === 'stopped' ? <Badge tone="amber">stopped</Badge> : <Badge tone="red">error</Badge>
const took = (r: SyncRun) => (r.finished_at ? `${Math.max(1, Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000))} s` : '…')

function RunLog({ runs, userOf, onRetry, running, canRun }: { runs: SyncRun[]; userOf: (id: string | null) => string; onRetry: () => void; running: boolean; canRun: boolean }) {
  const [only, setOnly] = useState<'all' | 'problems'>('all')
  const [open, setOpen] = useState<number | null>(null)
  const list = only === 'all' ? runs : runs.filter((r) => r.status === 'error' || r.status === 'partial' || (r.files?.failed.length ?? 0) > 0)
  return (
    <Card>
      <CardHeader icon={History} title="Activity log" subtitle="Every copy: what changed in the old CRM, what was added, updated or kept, files copied — and every error. Checks with nothing new aren't listed."
        action={<div className="flex flex-wrap gap-2">
          <Select value={only} onChange={(e) => setOnly(e.target.value as 'all' | 'problems')} aria-label="Show" className="!h-8 !py-0 text-xs"><option value="all">All runs</option><option value="problems">Errors & failed files</option></Select>
          <Button size="sm" variant="soft" icon={RefreshCcw} disabled={running || !canRun} onClick={onRetry}>Retry failed</Button>
        </div>} />
      {!list.length && <EmptyState icon={History} title={only === 'all' ? 'No copies yet' : 'No errors'} text={only === 'all' ? 'Runs appear here once the sync is on, or after Copy now.' : 'Every run finished without errors or failed files.'} />}
      <ul className="divide-y divide-line/70">
        {list.map((r) => {
          const t = r.written?.totals
          const failed = r.files?.failed ?? []
          // only the per-table counts (not the totals, notes, repaired or failed lists)
          const tables = Object.entries(r.written ?? {}).filter(([k, v]) => k !== 'totals' && !Array.isArray(v) && typeof v === 'object' && v !== null && 'added' in v) as [string, { added: number; updated: number; kept: number }][]
          return (
            <li key={r.id}>
              <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-card2/60" onClick={() => setOpen(open === r.id ? null : r.id)}>
                {statusBadge(r)}
                <span className="font-semibold">{fmtDateTime(r.started_at)}</span>
                <span className="text-xs text-mute">{r.trigger === 'auto' ? 'automatic' : `${r.trigger === 'full' ? 'copy everything' : 'copy now'} · ${userOf(r.by_user)}`} · {took(r)}</span>
                <span className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px]">
                  {t && <><Badge tone="green">+{t.added}</Badge><Badge tone="blue">{t.updated} updated</Badge>{t.kept > 0 && <Badge tone="violet">{t.kept} kept</Badge>}</>}
                  {(r.files?.copied ?? 0) > 0 && <Badge tone="orange">{r.files!.copied} files</Badge>}
                  {(r.written?.repaired?.length ?? 0) > 0 && <Badge tone="violet">{r.written!.repaired!.length} repaired</Badge>}
                  {(r.written?.failedRows?.length ?? 0) > 0 && <Badge tone="red">{r.written!.failedRows!.length} records left</Badge>}
                  {failed.length > 0 && <Badge tone="red">{failed.length} files failed</Badge>}
                  <ChevronDown className={cx('size-4 text-mute transition', open === r.id && 'rotate-180')} />
                </span>
                {r.error && <p className="basis-full truncate text-xs text-bad">{r.error}</p>}
              </button>
              {open === r.id && (
                <div className="grid gap-3 bg-card2/40 px-4 py-3 text-xs md:grid-cols-2">
                  <div>
                    <p className="mb-1 font-semibold">Changed in the old CRM</p>
                    <p className="text-mute">{r.changed_tables?.length ? r.changed_tables.join(', ') : '—'}</p>
                    <p className="mt-2 text-mute">{(r.rows_read ?? 0).toLocaleString('en-IN')} old rows read</p>
                    {r.error && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-bad-soft px-2 py-1.5 text-bad">{r.error}</p>}
                    {!!r.written?.notes?.length && <ul className="mt-2 list-disc pl-4 text-mute">{r.written.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                  </div>
                  <div>
                    <p className="mb-1 font-semibold">Written per table</p>
                    {tables.length ? (
                      <table className="w-full"><tbody className="divide-y divide-line/60">
                        {tables.map(([k, c]) => <tr key={k}><td className="py-1 font-mono text-[11px]">{k}</td><td className="py-1 text-right">+{c.added}</td><td className="py-1 text-right">{c.updated} upd.</td><td className="py-1 text-right">{c.kept} kept</td></tr>)}
                      </tbody></table>
                    ) : <p className="text-mute">Nothing new.</p>}
                    {!!r.written?.repaired?.length && <>
                      <p className="mb-1 mt-3 font-semibold text-violet-600 dark:text-violet-300">Repaired automatically and saved ({r.written.repaired.length}) — the old value is kept here</p>
                      <ul className="max-h-48 space-y-1 overflow-auto">{r.written.repaired.map((f, i) => (
                        <li key={i} className="rounded bg-card px-2 py-1"><span className="font-mono text-[11px]">{f.table} · {f.key} · {f.column}</span> <span className="text-mute">· {f.why} · was <b className="text-ink">{JSON.stringify(f.from)}</b> → now <b className="text-ink">{JSON.stringify(f.to)}</b></span></li>
                      ))}</ul>
                    </>}
                    {!!r.written?.failedRows?.length && <>
                      <p className="mb-1 mt-3 font-semibold text-bad">Records the database refused ({r.written.failedRows.length}) — the rest were saved; these are tried again (3 times, then set aside)</p>
                      <ul className="max-h-48 space-y-1 overflow-auto">{r.written.failedRows.map((f, i) => {
                        const waits = f.parent && r.written!.failedRows!.some((x) => x.key === f.parent)
                        return <li key={i} className="rounded bg-card px-2 py-1"><span className="font-mono text-[11px]">{f.table} · {f.key}</span> <span className="text-mute">· {waits ? `waits for its client file ${f.parent} (above) — saved together with it`
                          : f.parent ? `its record ${f.parent} is not in the old CRM's data either (deleted there?) — kept aside after 3 tries` : f.error}{f.tries ? ` · try ${f.tries}/3` : ''}</span></li>
                      })}</ul>
                    </>}
                    {failed.length > 0 && <>
                      <p className="mb-1 mt-3 font-semibold text-bad">Files that could not be copied ({failed.length}) — tried again on the next copies (3 times, then set aside)</p>
                      <ul className="max-h-48 space-y-1 overflow-auto">{failed.map((f, i) => <li key={i} className="rounded bg-card px-2 py-1"><span className="font-mono text-[11px]">{f.path}</span> <span className="text-mute">· {f.booking} · {f.error}{f.tries ? ` · try ${f.tries}/3` : ''}</span></li>)}</ul>
                    </>}
                    {(r.files?.setAside ?? 0) > 0 && <p className="mt-2 text-mute">{r.files!.setAside} file(s) set aside after 3 failed tries — fix uploads_dir in the connector config, then press Copy everything to try them again.</p>}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

// ------------------------------------------------------------------ settings
function SettingsTab({ st, onSaved }: { st: SyncStatus; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const c = st.config
  const s = c.state ?? {}
  const [url, setUrl] = useState(c.url ?? '')
  const [interval, setIntervalSec] = useState(c.interval_sec)
  const [prefer, setPrefer] = useState(c.prefer)
  const [autopilot, setAutopilot] = useState(c.autopilot !== false)
  const [oldName, setOldName] = useState(c.old_name ?? '')
  const [oldLogo, setOldLogo] = useState(c.old_logo ?? '')
  const [dbMb, setDbMb] = useState(String(Math.round(c.db_limit_bytes / MB)))
  const [stGb, setStGb] = useState(String(+(c.storage_limit_bytes / GB).toFixed(2)))
  const [busy, setBusy] = useState('')
  const [ping, setPing] = useState<Ping | null>(null)
  const [pingErr, setPingErr] = useState('')
  const [save, setSave] = useState<{ state: 'idle' | 'waiting' | 'saving' | 'saved' | 'error'; at?: string; error?: string }>({ state: 'idle' })

  /** what differs from the saved settings (only valid values; the address is saved by Test connection or when leaving the box) */
  const changes = (withUrl: boolean) => {
    const p: Parameters<typeof saveConfig>[0] = {}
    const u = url.trim()
    if (withUrl && u && u !== (c.url ?? '') && /^https:\/\/[^/\s]+\.[^/\s]+\//.test(u)) p.url = u
    if (interval !== c.interval_sec) p.intervalSec = interval
    if (prefer !== c.prefer) p.prefer = prefer
    if (autopilot !== (c.autopilot !== false)) p.autopilot = autopilot
    if (oldName.trim() !== (c.old_name ?? '')) p.oldName = oldName.trim()
    const l = oldLogo.trim()
    if (l !== (c.old_logo ?? '') && (!l || /^https:\/\/\S+\.\S+/.test(l))) p.oldLogo = l
    const db = Number(dbMb) * MB
    if (dbMb && Number.isFinite(db) && Math.round(db) !== c.db_limit_bytes) p.dbLimitBytes = db
    const sg = Number(stGb) * GB
    if (stGb && Number.isFinite(sg) && Math.round(sg) !== c.storage_limit_bytes) p.storageLimitBytes = sg
    return p
  }
  const persist = async (p: Parameters<typeof saveConfig>[0], quiet = true) => {
    if (!Object.keys(p).length) { if (!quiet) toast('success', 'Everything is already saved'); return }
    setSave({ state: 'saving' })
    try {
      await saveConfig(p)
      setSave({ state: 'saved', at: new Date().toISOString() })
      if (!quiet) toast('success', 'Sync settings saved')
      await onSaved()
    } catch (e) { setSave({ state: 'error', error: (e as Error).message }); if (!quiet) toast('error', (e as Error).message) }
  }
  // every change is saved by itself a moment after you stop typing — nothing to fill in again next time
  const pending = JSON.stringify(changes(false))
  useEffect(() => {
    if (pending === '{}') return
    setSave({ state: 'waiting' })
    const t = setTimeout(() => void persist(JSON.parse(pending)), 900)
    return () => clearTimeout(t)
  }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps

  const test = async () => {
    setBusy('test'); setPing(null); setPingErr('')
    try {
      const r = await testConnection(url.trim())
      setPing(r.ping)
      setSave({ state: 'saved', at: new Date().toISOString() })
      toast('success', r.autopilot ? `Connected — address saved. Automatic mode: ${r.autopilot}` : 'Connected — address saved. You can turn the sync on.')
      await onSaved()
    } catch (e) { setPingErr((e as Error).message) }
    setBusy('')
  }
  const saveNow = async () => { setBusy('save'); await persist(changes(true), false); setBusy('') }
  const savedNote = save.state === 'saving' ? <span className="text-mute"><Loader2 className="mr-1 inline size-3.5 animate-spin" />Saving…</span>
    : save.state === 'waiting' ? <span className="text-mute">Saving in a moment…</span>
      : save.state === 'error' ? <span className="text-bad"><XCircle className="mr-1 inline size-3.5" />Not saved: {save.error}</span>
        : <span className="text-ok"><CheckCircle2 className="mr-1 inline size-3.5" />Saved{save.at ? ` ${ago(save.at)}` : c.updated_at ? ` · last change ${fmtDateTime(c.updated_at)}` : ''}</span>
  // the last successful test, remembered on the server (shown until a new test)
  const known = !ping && !pingErr && c.url && s.lastPingAt && s.old && url.trim() === c.url
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader icon={Plug} title="Connection to the old CRM" subtitle="The address of rexera-connector.php on the old CRM's website (https only)" />
        <div className="grid gap-3 p-4">
          <Input label="Connector address" placeholder="https://old-crm.example.com/rexera-sync/rexera-connector.php" value={url} onChange={(e) => setUrl(e.target.value)}
            onBlur={() => { const p = changes(true); if (p.url) void persist({ url: p.url }) }}
            hint="e.g. https://crm.rexera.in/rexera-connector.php — saved by itself, and kept for next time" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" icon={Plug} loading={busy === 'test'} disabled={!url.trim()} onClick={test}>Test connection</Button>
            <span className="text-xs text-mute">Secret on the server: {st.secret.problem ? <b className="text-bad">{st.secret.problem}</b> : <b className="text-ok">set</b>}</span>
          </div>
          {pingErr && <p className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">{pingErr}</p>}
          {(ping || known) && (() => {
            const p = ping ?? { name: s.old!.name ?? 'Old CRM', version: s.old!.version ?? '?', php: s.old!.php ?? '?', uploads: !!s.old!.uploads, databases: (s.old!.databases ?? {}) as Ping['databases'] }
            return (
              <div className="rounded-lg bg-ok-soft px-3 py-2 text-xs">
                <p className="font-semibold text-ok"><CheckCircle2 className="mr-1 inline size-4" />Connected to {p.name} — connector v{p.version}, PHP {p.php}{!ping && s.lastPingAt ? <span className="font-normal text-mute"> · tested {ago(s.lastPingAt)}</span> : null}</p>
                {Object.entries(p.databases).map(([k, d]) => <p key={k} className="mt-1 text-mute">{k === 'main' ? 'Main' : 'Billing'} database: MySQL {d.mysql} · {d.tables?.length ?? 0} tables readable ({d.tables?.join(', ')})</p>)}
                {s.oldTotal != null && <p className="mt-1 text-mute">Records in the old CRM: <b className="text-ink">{s.oldTotal.toLocaleString('en-IN')}</b></p>}
                <p className="mt-1 text-mute">Uploads folder: {p.uploads ? 'found' : <b className="text-bad">not found — check uploads_dir</b>}</p>
                {connectorOutdated(p.version) && (
                  <p className="mt-2 rounded-md bg-warn-soft px-2 py-1.5 text-warn">
                    <b>Connector update {LATEST_CONNECTOR} available</b> — it finds the old CRM's uploads folder by itself, so files copy even if uploads_dir is wrong.{' '}
                    <a className="font-semibold underline" href="/old-crm-connector/rexera-connector.php" download="rexera-connector.php">Download</a> and replace rexera-connector.php on the old CRM's website (the config file stays), then Test connection.
                  </p>
                )}
              </div>
            )
          })()}
          <Input label="Old CRM name (optional)" placeholder={s.old?.name ? `${s.old.name} — from the connector` : 'Taken from the connector if empty'} maxLength={80} value={oldName} onChange={(e) => setOldName(e.target.value)} />
          <Input label="Old CRM logo address (optional, https)" placeholder="https://…/logo.png — taken from the connector if empty" value={oldLogo} onChange={(e) => setOldLogo(e.target.value)} />
        </div>
      </Card>
      <Card>
        <CardHeader icon={Settings2} title="How the sync works" subtitle="Saved by itself · applies from the next check" />
        <div className="grid gap-4 p-4">
          <label className={cx('flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm', autopilot ? 'border-brand bg-brand-soft/40' : 'border-line')}>
            <span className="min-w-0 flex-1"><b>Automatic mode (recommended)</b>
              <span className="block text-xs text-mute">The first time Test connection works, it copies everything and turns the sync on by itself. Problems are retried by themselves (waiting longer each time); a record or file that keeps failing is set aside so the rest keeps copying — every problem is listed in the Activity log and the Error log.</span>
            </span>
            <Toggle checked={autopilot} onChange={setAutopilot} label="Automatic mode" />
          </label>
          <Select label="Check the old CRM for changes every" value={interval} onChange={(e) => setIntervalSec(Number(e.target.value))}
            hint="Each check is one small request; a copy runs only when something changed.">
            {INTERVALS.map((x) => <option key={x} value={x}>{intervalText(x)}</option>)}
          </Select>
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-mute">A record changed in both CRMs</legend>
            {([['new', 'Keep the new CRM’s version (recommended)', 'Work done here — Admin assigned, stage moved, notes — is never overwritten.'],
              ['old', 'Take the old CRM’s version', 'Use only while the old CRM is still the main system.']] as const).map(([v, t, d]) => (
              <label key={v} className={cx('mb-2 flex cursor-pointer gap-3 rounded-xl border p-3 text-sm', prefer === v ? 'border-brand bg-brand-soft/40' : 'border-line')}>
                <input type="radio" name="prefer" checked={prefer === v} onChange={() => setPrefer(v)} className="mt-1 accent-[var(--brand)]" />
                <span><b>{t}</b><span className="block text-xs text-mute">{d}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Supabase database limit (MB)" inputMode="numeric" value={dbMb} onChange={(e) => setDbMb(e.target.value.replace(/[^\d]/g, ''))} hint="Free plan: 500 MB · Pro: 8 GB = 8192" />
            <Input label="Supabase file storage limit (GB)" inputMode="decimal" value={stGb} onChange={(e) => setStGb(e.target.value.replace(/[^\d.]/g, ''))} hint="Free plan: 1 GB · Pro: 100 GB" />
          </div>
          <p className="text-xs text-mute">Never deleted by a sync: anything in this CRM. Never changed: roles, permissions, settings, team assignments. The old CRM is only read.</p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="mr-auto text-xs" role="status" aria-live="polite">{savedNote}</span>
            <Button icon={CheckCircle2} loading={busy === 'save'} onClick={saveNow}>Save</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ setup guide
function Guide({ st }: { st: SyncStatus | null }) {
  const toast = useToast()
  const [secret, setSecret] = useState('')
  const s = st?.config.state ?? {}
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast('success', 'Copied'), () => toast('error', 'Copy it by hand'))
  const steps: { title: string; done: boolean | null; body: ReactNode }[] = [
    { title: 'Update the database', done: !!st, body: <>In Supabase → SQL Editor, run <code>supabase/migrations/20261109000000_legacy_sync.sql</code> (it is also at the end of <code>run-now.sql</code>). It adds the sync's settings, its log and the storage report — nothing else changes.</> },
    {
      title: 'Make a secret and put it on the CRM server', done: st ? !st.secret.problem : null, body: <>
        <p>The two servers prove who they are with one long random secret. Make one here (it is made in this browser and not saved anywhere), then in <b>Render → your CRM service → Environment</b> add <code>LEGACY_SYNC_SECRET</code> with it and save (Render restarts the server).</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" icon={Wand2} onClick={() => setSecret(newSecret())}>Make a secret</Button>
          {secret && <><code className="max-w-full break-all rounded bg-card2 px-2 py-1 text-[11px]">{secret}</code><Button size="sm" variant="ghost" icon={Copy} onClick={() => copy(secret)}>Copy</Button></>}
        </div>
        <p className="mt-1 text-xs text-mute">Keep it like a password: only in Render and in the connector's config file — never in email, chat or the code.</p>
      </>,
    },
    {
      title: 'Download the connector', done: null, body: <>
        <div className="flex flex-wrap gap-2">
          <a href="/old-crm-connector/rexera-connector.php" download="rexera-connector.php"><Button size="sm" variant="outline" icon={Download}>rexera-connector.php</Button></a>
          <a href="/old-crm-connector/rexera-connector.config.sample.php" download="rexera-connector.config.php"><Button size="sm" variant="outline" icon={Download}>rexera-connector.config.php</Button></a>
        </div>
        <p className="mt-1 text-xs text-mute">A small read-only PHP file (PHP 7.4+): it only reads the old CRM's tables and uploaded files, and answers only signed requests from this CRM's server.</p>
      </>,
    },
    {
      title: 'Fill in the config file', done: null, body: <ul className="list-disc space-y-1 pl-4">
        <li><b>secret</b> — the same secret as on Render.</li>
        <li><b>main</b> — the old CRM's MySQL database: name, user and password (Hostinger hPanel → Databases → MySQL Databases). Host is usually <code>localhost</code>. A user with read-only rights (SELECT) is best.</li>
        <li><b>billing</b> — the old billing database, or remove the line.</li>
        <li><b>uploads_dir</b> — the folder with the old CRM's uploaded files (e.g. <code>/home/u…/public_html/uploads</code>).</li>
        <li><b>crm_name</b>, <b>logo_url</b> — shown on this page. <b>allowed_ips</b> — optional, the CRM server's outgoing IP.</li>
      </ul>,
    },
    { title: 'Upload both files to the old CRM', done: null, body: <>Hostinger hPanel → File Manager → in the old CRM's <code>public_html</code>, make a folder such as <code>rexera-sync</code> and upload <code>rexera-connector.php</code> and <code>rexera-connector.config.php</code> into it. The address becomes <code>https://&lt;old-crm-domain&gt;/rexera-sync/rexera-connector.php</code>.</> },
    { title: 'Enter the address and test', done: st ? !!s.lastPingAt && s.connected !== false : null, body: <>Settings tab → Connector address → <b>Test connection</b>. It shows the old CRM's name, the readable tables and whether the uploads folder was found. Then <b>Save settings</b>.</> },
    { title: 'Copy everything once', done: st ? !!s.lastOkAt : null, body: <>Press <b>Copy everything</b> at the top. Follow it in the Activity log; failed files are listed there and tried again on every copy.</> },
    { title: 'Turn the sync ON', done: st ? !!st.config.enabled : null, body: <>Flip the switch at the top. From then on, new and changed records in the old CRM appear here within the check interval. Turn it OFF any time — it stops at once.</> },
  ]
  return (
    <Card>
      <CardHeader icon={BookOpen} title="Setup guide" subtitle="About 15 minutes, once. Ticks turn green as each step is done." />
      <ol className="divide-y divide-line/70">
        {steps.map((x, i) => (
          <li key={i} className="flex gap-3 px-4 py-3 text-sm">
            <span className={cx('grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold', x.done ? 'bg-ok text-white' : 'bg-card2 text-mute')}>
              {x.done ? <CheckCircle2 className="size-4" /> : x.done === false ? <XCircle className="size-4 text-bad" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1"><p className="font-bold">{x.title}</p><div className="mt-0.5 text-[13px] text-mute [&_code]:rounded [&_code]:bg-card2 [&_code]:px-1 [&_code]:text-[12px] [&_code]:text-ink">{x.body}</div></div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-start gap-3 border-t border-line px-4 py-3 text-xs text-mute">
        <KeyRound className="size-4 shrink-0 text-brand-ink" />
        <p className="min-w-0 flex-1">Security: requests are signed (HMAC-SHA256) and expire after 5 minutes; the connector refuses anything else, reads only the tables the import needs and files inside the uploads folder, and never writes to the old CRM. Only IT Support can open this page or call its API.</p>
      </div>
    </Card>
  )
}
