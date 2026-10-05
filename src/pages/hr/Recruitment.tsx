import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  ArrowDown, ArrowUp, Columns3, Download, FileSpreadsheet, FileText, Filter, Loader2, Pencil, Trash2, Upload, UploadCloud, X, Briefcase,
  CalendarRange, Hash, ListFilter, Sparkles, Type,
} from 'lucide-react'
import { describe, emptyFilter, isActive, matches, profileColumns, toIsoDate, toNumber, type ColumnFilter } from '../../lib/autofilter'
import { useAuth, useMe } from '../../lib/auth'
import { useDb } from '../../lib/store'
import { userName } from '../../lib/actions'
import { ACCEPT, deleteDataset, parseFile, renameDataset, saveDatasets, useDatasets, type Dataset } from '../../lib/imports'
import { ago, downloadCsv, today } from '../../lib/format'
import { Badge, Button, Card, cx, EmptyState, Input, Modal, PageHeader, SearchBox, useConfirm, useToast, Checkbox } from '../../components/ui'

const ALL = '__all__'
const PAGE = 50

export default function Recruitment() {
  const me = useMe()
  const db = useDb()
  const { can } = useAuth()
  const toast = useToast()
  const [confirm, confirmNode] = useConfirm()
  const { list, loading, error } = useDatasets()
  const manage = can('recruitment.manage')
  const [selected, setSelected] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [rename, setRename] = useState<Dataset | null>(null)
  const [newName, setNewName] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!list.length) { setSelected(''); return }
    if (selected !== ALL && !list.some((d) => d.id === selected)) setSelected(list[0]!.id)
  }, [list, selected])

  const importFiles = async (files: FileList | File[]) => {
    const arr = [...files]
    if (!arr.length) return
    setBusy(true)
    const ok: Dataset[] = []
    const failed: string[] = []
    for (const f of arr) {
      try { ok.push(...(await parseFile(f, me.id))) } catch (e) { failed.push(e instanceof Error ? e.message : `${f.name}: could not be read`) }
    }
    try {
      if (ok.length) await saveDatasets(ok)
      if (ok.length) setSelected(ok[0]!.id)
      if (ok.length) toast('success', `Imported ${ok.length} table${ok.length === 1 ? '' : 's'} from ${arr.length - failed.length} file${arr.length - failed.length === 1 ? '' : 's'}`)
      if (failed.length) toast('error', failed.join(' · '))
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Saving failed')
    } finally { setBusy(false) }
  }

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); if (manage) importFiles(e.dataTransfer.files) }

  // the table being shown: one file, or all files combined with a "Source file" column
  const view = useMemo(() => {
    if (selected === ALL) {
      const columns = ['Source file', ...new Set(list.flatMap((d) => d.columns))]
      const rows = list.flatMap((d) => d.rows.map((r) => columns.map((c, i) => (i === 0 ? d.name : r[d.columns.indexOf(c)] ?? ''))))
      return { key: ALL, title: 'All files combined', columns, rows, ds: undefined as Dataset | undefined }
    }
    const ds = list.find((d) => d.id === selected)
    return ds ? { key: ds.id, title: ds.name, columns: ds.columns, rows: ds.rows, ds } : null
  }, [list, selected])

  const totalRows = list.reduce((s, d) => s + d.rows.length, 0)

  return (
    <div onDragOver={(e) => { e.preventDefault(); if (manage) setDrag(true) }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }} onDrop={onDrop}>
      <PageHeader title="Recruitment" subtitle="Import candidate lists or any spreadsheet — every CSV file and Excel sheet becomes its own table, with filters added automatically" icon={Briefcase}
        actions={manage && <>
          <input ref={input} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { const f = e.target.files; if (f) importFiles(f); e.target.value = '' }} />
          <Button variant="accent" icon={busy ? Loader2 : Upload} disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Importing…' : 'Import CSV / Excel'}</Button>
        </>} />

      {drag && (
        <div className="pointer-events-none fixed inset-0 z-[90] grid place-items-center bg-brand/20 backdrop-blur-sm">
          <div className="rounded-3xl border-4 border-dashed border-brand bg-card px-10 py-8 text-center shadow-pop">
            <UploadCloud className="mx-auto size-12 text-brand-ink" /><p className="mt-2 text-lg font-extrabold">Drop files to import</p><p className="text-sm text-mute">CSV, Excel (.xlsx, .xls), OpenDocument</p>
          </div>
        </div>
      )}

      {error && <Card className="mb-5 p-5 text-sm text-bad">Couldn't open browser storage: {error}</Card>}

      {loading ? (
        <Card className="grid place-items-center p-16"><Loader2 className="size-8 animate-spin text-mute" /></Card>
      ) : !list.length ? (
        <Card>
          <button disabled={!manage || busy} onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-line p-14 text-center transition hover:border-brand hover:bg-brand-soft/30 disabled:cursor-default">
            <span className="grid size-16 place-items-center rounded-2xl bg-brand-soft text-brand-ink"><UploadCloud className="size-8" /></span>
            <span className="text-lg font-extrabold">Import your first file</span>
            <span className="max-w-md text-sm text-mute">Drag and drop or click to choose one or more CSV / Excel files. The first row is used as column names. Each Excel sheet becomes its own table.</span>
            {!manage && <span className="text-xs text-bad">You need Recruitment access to import.</span>}
          </button>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
          {/* file list */}
          <Card className="h-fit overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <p className="text-sm font-bold">Imported files</p>
              <p className="text-xs text-mute">{list.length} table{list.length === 1 ? '' : 's'} · {totalRows.toLocaleString('en-IN')} rows</p>
            </div>
            <ul className="max-h-[60vh] overflow-y-auto p-2">
              {list.length > 1 && (
                <li><button onClick={() => setSelected(ALL)} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', selected === ALL ? 'bg-brand-soft' : 'hover:bg-card2')}>
                  <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent"><Columns3 className="size-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">All files combined</span><span className="text-[11px] text-mute">{totalRows.toLocaleString('en-IN')} rows</span></span>
                </button></li>
              )}
              {list.map((d) => (
                <li key={d.id}>
                  <button onClick={() => setSelected(d.id)} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', selected === d.id ? 'bg-brand-soft' : 'hover:bg-card2')}>
                    <span className={cx('grid size-9 shrink-0 place-items-center rounded-lg', d.kind === 'excel' ? 'bg-ok-soft text-ok' : 'bg-info-soft text-info')}>{d.kind === 'excel' ? <FileSpreadsheet className="size-4" /> : <FileText className="size-4" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{d.name}</span>
                      <span className="block truncate text-[11px] text-mute">{d.rows.length.toLocaleString('en-IN')} rows · {d.columns.length} cols · {ago(d.importedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {manage && <div className="border-t border-line p-3"><Button variant="soft" icon={Upload} className="w-full" disabled={busy} onClick={() => input.current?.click()}>Add more files</Button></div>}
          </Card>

          {view && (
            <TableView key={view.key} title={view.title} columns={view.columns} rows={view.rows}
              chooser={
                <label className="flex items-center gap-2 text-sm">
                  <span className="font-semibold text-mute">File</span>
                  <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Choose file" className="h-10 max-w-64 rounded-xl border border-line bg-card px-3 text-sm font-semibold">
                    {list.length > 1 && <option value={ALL}>All files combined</option>}
                    {list.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.rows.length})</option>)}
                  </select>
                </label>
              }
              meta={view.ds && <span className="text-xs text-mute">{view.ds.fileName}{view.ds.sheet ? ` · sheet “${view.ds.sheet}”` : ''} · imported {ago(view.ds.importedAt)} by {userName(db, view.ds.importedBy)}</span>}
              actions={view.ds && manage && <>
                <Button size="sm" variant="ghost" icon={Pencil} onClick={() => { setRename(view.ds!); setNewName(view.ds!.name) }}>Rename</Button>
                <Button size="sm" variant="ghost" icon={Trash2} className="text-bad" onClick={async () => { if (await confirm('Delete this table?', `${view.ds!.name} (${view.ds!.rows.length} rows) will be removed from this browser.`, true)) { await deleteDataset(view.ds!.id); toast('success', 'Table deleted') } }}>Delete</Button>
              </>} />
          )}
        </div>
      )}

      <Modal open={!!rename} onClose={() => setRename(null)} title="Rename table" size="sm"
        footer={<><Button variant="outline" onClick={() => setRename(null)}>Cancel</Button><Button onClick={async () => { if (rename) { await renameDataset(rename, newName); setRename(null) } }}>Save</Button></>}>
        <Input label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
      </Modal>
      {confirmNode}
    </div>
  )
}

// ------------------------------------------------------------------ table viewer
const FILTERS_OPEN_KEY = 'rexera-recruit-filters-open'
const KIND_ORDER = { choice: 0, number: 1, date: 2, text: 3 } as const
const KIND_LABEL = { choice: 'pick', number: 'range', date: 'dates', text: 'contains' } as const
const KIND_ICON = { choice: ListFilter, number: Hash, date: CalendarRange, text: Type } as const
const sortKey = (s: string): number | string | null => toNumber(s) ?? toIsoDate(s)

function TableView({ title, columns, rows, chooser, meta, actions }: { title: string; columns: string[]; rows: string[][]; chooser: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  const [q, setQ] = useState('')
  // every column gets a filter that suits its data, as soon as the table is imported
  const profiles = useMemo(() => profileColumns(columns, rows), [columns, rows])
  const [filters, setFilters] = useState<Record<number, ColumnFilter>>({})
  const [showFilters, setShowFilters] = useState(() => { try { return localStorage.getItem(FILTERS_OPEN_KEY) !== '0' } catch { return true } })
  const [allFilters, setAllFilters] = useState(false)
  const [hidden, setHidden] = useState<number[]>([])
  const [showCols, setShowCols] = useState(false)
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const [page, setPage] = useState(0)

  const setFilter = (i: number, f: ColumnFilter) => setFilters((prev) => ({ ...prev, [i]: f }))
  const clearFilter = (i: number) => setFilters((prev) => { const n = { ...prev }; delete n[i]; return n })
  const toggleOpen = () => setShowFilters((s) => { try { localStorage.setItem(FILTERS_OPEN_KEY, s ? '0' : '1') } catch { /* ignore */ } return !s })

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const active = Object.entries(filters).filter(([, f]) => isActive(f))
    let out = rows.filter((r) => (!needle || r.some((c) => c.toLowerCase().includes(needle))) && active.every(([i, f]) => matches(r[+i] ?? '', f)))
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.col] ?? '', y = b[sort.col] ?? ''
        const kx = sortKey(x), ky = sortKey(y)
        const cmp = kx !== null && ky !== null && typeof kx === typeof ky
          ? (typeof kx === 'number' ? kx - (ky as number) : (kx as string).localeCompare(ky as string))
          : x.localeCompare(y, 'en', { numeric: true })
        return cmp * sort.dir
      })
    }
    return out
  }, [rows, q, filters, sort])

  useEffect(() => setPage(0), [q, filters, sort])
  const visible = columns.map((c, i) => ({ c, i })).filter(({ i }) => !hidden.includes(i))
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const slice = filtered.slice(page * PAGE, page * PAGE + PAGE)
  const activeEntries = Object.entries(filters).filter(([, f]) => isActive(f)).map(([i, f]) => ({ i: +i, f }))
  const activeCount = activeEntries.length
  const ordered = columns.map((c, i) => ({ c, i, p: profiles[i]! })).filter(({ p }) => p.filled > 0).sort((a, b) => KIND_ORDER[a.p.kind] - KIND_ORDER[b.p.kind] || a.i - b.i)
  const shownFilters = allFilters ? ordered : ordered.slice(0, 8)
  const kinds = (['choice', 'number', 'date', 'text'] as const).map((k) => [k, ordered.filter((o) => o.p.kind === k).length] as const).filter(([, n]) => n)

  const exportCsv = () => downloadCsv(`${title.replace(/[^\w-]+/g, '_')}-${today()}.csv`, filtered.map((r) => Object.fromEntries(visible.map(({ c, i }) => [c, r[i] ?? '']))))

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        {chooser}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-bold">{title}</h2>
          {meta}
        </div>
        {actions}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search all columns…" className="min-w-52 flex-1" />
        <Button size="sm" variant={showFilters || activeCount ? 'soft' : 'outline'} icon={Filter} onClick={toggleOpen}>{showFilters ? 'Hide filters' : 'Filters'}{activeCount ? ` · ${activeCount}` : ''}</Button>
        <Button size="sm" variant={showCols ? 'soft' : 'outline'} icon={Columns3} onClick={() => setShowCols((s) => !s)}>Columns{hidden.length ? ` · ${hidden.length} hidden` : ''}</Button>
        <Button size="sm" variant="outline" icon={Download} disabled={!filtered.length} onClick={exportCsv}>Export</Button>
      </div>
      {activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          {activeEntries.map(({ i, f }) => (
            <span key={i} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent-soft py-1 pl-3 pr-1.5 text-xs font-semibold text-accent">
              <span className="truncate">{describe(columns[i]!, f)}</span>
              <button aria-label={`Remove ${columns[i]} filter`} onClick={() => clearFilter(i)} className="grid size-5 place-items-center rounded-full hover:bg-accent/15"><X className="size-3" /></button>
            </span>
          ))}
          <button onClick={() => setFilters({})} className="text-xs font-semibold text-mute hover:text-ink hover:underline">Clear all</button>
        </div>
      )}
      {showFilters && ordered.length > 0 && (
        <div className="border-b border-line bg-card2/50 p-4">
          <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-mute">
            <Sparkles className="size-3.5 text-accent" /><b className="text-ink">Filters added automatically</b>
            {kinds.map(([k, n]) => <span key={k} className="rounded-full bg-card px-2 py-0.5 ring-1 ring-line">{n} {KIND_LABEL[k]}</span>)}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {shownFilters.map(({ c, i, p }) => {
              const f = filters[i] ?? emptyFilter(p)
              const Icon = KIND_ICON[p.kind]
              const on = isActive(filters[i])
              const box = 'h-9 w-full min-w-0 rounded-lg border border-line bg-card px-2 text-sm outline-none focus:border-brand'
              return (
                <div key={i} className={cx('rounded-xl border bg-card p-3', on ? 'border-accent/60 ring-2 ring-accent/15' : 'border-line')}>
                  <div className="mb-2 flex items-center gap-1.5">
                    <Icon className="size-3.5 shrink-0 text-mute" />
                    <span className="min-w-0 flex-1 truncate text-xs font-bold" title={c}>{c}</span>
                    <span className="text-[10px] text-mute">{KIND_LABEL[p.kind]}</span>
                    {on && <button aria-label={`Clear ${c}`} onClick={() => clearFilter(i)} className="text-mute hover:text-bad"><X className="size-3.5" /></button>}
                  </div>
                  {f.kind === 'choice' && (p.values.length <= 8 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {p.values.map(({ value, count }) => {
                        const sel = f.values.includes(value)
                        return (
                          <button key={value} aria-pressed={sel} onClick={() => setFilters((prev) => {
                            const cur = prev[i]?.kind === 'choice' ? prev[i].values : []
                            return { ...prev, [i]: { kind: 'choice', values: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] } }
                          })}
                            className={cx('rounded-full border px-2.5 py-1 text-xs font-semibold transition', sel ? 'border-brand bg-brand text-white' : 'border-line hover:bg-card2')}>
                            {value} <span className={sel ? 'text-white/70' : 'text-mute'}>{count}</span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <select className={box} value={f.values[0] ?? ''} aria-label={c} onChange={(e) => setFilter(i, { kind: 'choice', values: e.target.value ? [e.target.value] : [] })}>
                      <option value="">Any ({p.values.length} values)</option>
                      {p.values.map(({ value, count }) => <option key={value} value={value}>{value} ({count})</option>)}
                    </select>
                  ))}
                  {f.kind === 'number' && (
                    <div className="flex items-center gap-2">
                      <input type="number" className={box} placeholder={`min ${p.min?.toLocaleString('en-IN')}`} value={f.min} aria-label={`${c} minimum`} onChange={(e) => setFilter(i, { ...f, min: e.target.value })} />
                      <span className="text-mute">–</span>
                      <input type="number" className={box} placeholder={`max ${p.max?.toLocaleString('en-IN')}`} value={f.max} aria-label={`${c} maximum`} onChange={(e) => setFilter(i, { ...f, max: e.target.value })} />
                    </div>
                  )}
                  {f.kind === 'date' && (
                    <div className="flex items-center gap-2">
                      <input type="date" className={box} min={p.from} max={p.to} value={f.from} aria-label={`${c} from`} onChange={(e) => setFilter(i, { ...f, from: e.target.value })} />
                      <span className="text-mute">→</span>
                      <input type="date" className={box} min={p.from} max={p.to} value={f.to} aria-label={`${c} to`} onChange={(e) => setFilter(i, { ...f, to: e.target.value })} />
                    </div>
                  )}
                  {f.kind === 'text' && (
                    <input className={box} placeholder="contains…" value={f.q} aria-label={`${c} contains`} onChange={(e) => setFilter(i, { kind: 'text', q: e.target.value })} />
                  )}
                </div>
              )
            })}
          </div>
          {ordered.length > 8 && (
            <button onClick={() => setAllFilters((s) => !s)} className="mt-3 text-xs font-bold text-brand-ink hover:underline">
              {allFilters ? 'Show fewer filters' : `Show all ${ordered.length} filters`}
            </button>
          )}
        </div>
      )}
      {showCols && (
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-line bg-card2/50 p-4">
          {columns.map((c, i) => <Checkbox key={i} checked={!hidden.includes(i)} label={c} onChange={(v) => setHidden(v ? hidden.filter((x) => x !== i) : [...hidden, i])} />)}
        </div>
      )}

      {!filtered.length ? <EmptyState icon={Filter} title="No rows match" text="Change the search or filters." /> : (
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 border-b border-line bg-card2 px-3 py-2.5 text-left text-[11px] font-bold text-mute">#</th>
                {visible.map(({ c, i }) => (
                  <th key={i} onClick={() => setSort(sort?.col === i ? (sort.dir === 1 ? { col: i, dir: -1 } : null) : { col: i, dir: 1 })}
                    className="sticky top-0 z-10 cursor-pointer select-none whitespace-nowrap border-b border-line bg-card2 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-mute hover:text-ink">
                    <span className="inline-flex items-center gap-1">{c}{sort?.col === i && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slice.map((r, ri) => (
                <tr key={ri} className="hover:bg-card2/60">
                  <td className="sticky left-0 border-b border-line/60 bg-card px-3 py-2 text-xs text-mute tabular-nums">{page * PAGE + ri + 1}</td>
                  {visible.map(({ i }) => <td key={i} className="max-w-72 truncate border-b border-line/60 px-3 py-2" title={r[i]}>{r[i] || <span className="text-mute/50">—</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 text-xs text-mute">
        <span>{filtered.length.toLocaleString('en-IN')} of {rows.length.toLocaleString('en-IN')} rows · {columns.length} columns</span>
        {activeCount > 0 && <Badge tone="orange">{activeCount} filter{activeCount === 1 ? '' : 's'}</Badge>}
        <span className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page + 1} / {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
        </span>
      </div>
    </Card>
  )
}
