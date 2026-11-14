import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, Columns3, FileSpreadsheet, Link2, Sparkles, Upload, Users } from 'lucide-react'
import type { Role } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { ROLES, roleLabel } from '../lib/rbac'
import { readGoogleSheet, readSheets } from '../lib/bulkUsers'
import { applyEmployeeImport, branchPlan, planEmployeeImport, type EmployeePlan } from '../lib/employeeImport'
import { monthOf } from '../../supabase/employee-sheet-rules.mjs'
import { inr } from '../lib/format'
import { Badge, Button, cx, Input, Modal, Select, useConfirm, useRun, useToast } from './ui'

const TYPE_LABEL: Record<string, string> = { text: 'Text', number: 'Number', date: 'Date', email: 'Email', phone: 'Phone' }
/** Every column of the sheet and where it goes — nothing is left out without being shown here. */
function ColumnsFound({ plan }: { plan: EmployeePlan }) {
  const [open, setOpen] = useState(false)
  const cols = plan.columns
  const fresh = cols.filter((c) => c.to === 'custom' && c.isNew)
  const tone = { crm: 'blue', custom: 'violet', attendance: 'green', serial: 'gray' } as const
  return (
    <div className="rounded-xl border border-line">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left text-sm">
        <Columns3 className="size-4 text-brand-ink" /><b>Columns detected: {cols.length}</b>
        <span className="text-xs text-mute">{cols.filter((c) => c.to === 'crm').length} CRM fields · {cols.filter((c) => c.to === 'custom').length} employee fields{fresh.length ? ` (${fresh.length} new)` : ''}{cols.some((c) => c.to === 'attendance') ? ' · attendance days' : ''}</span>
        {fresh.length > 0 && <Badge tone="violet"><Sparkles className="size-3" />New: {fresh.slice(0, 4).map((c) => c.label).join(', ')}{fresh.length > 4 ? '…' : ''}</Badge>}
        <span className="ml-auto text-xs font-semibold text-brand-ink">{open ? 'Hide' : 'Show all'}</span>
      </button>
      {open && (
        <div className="max-h-64 overflow-auto border-t border-line">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card2 text-left text-[10px] uppercase tracking-wide text-mute"><tr><th className="px-3 py-1.5">Column</th><th className="px-2 py-1.5">Heading in the sheet</th><th className="px-2 py-1.5">Goes to</th><th className="px-3 py-1.5">Type</th></tr></thead>
            <tbody className="divide-y divide-line/70">
              {cols.map((c, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 font-mono text-mute">{plan.columns.some((x) => x.sheet !== c.sheet) ? `${c.sheet} · ` : ''}{c.col}</td>
                  <td className="px-2 py-1.5 font-semibold">{c.heading}</td>
                  <td className="px-2 py-1.5"><Badge tone={tone[c.to]}>{c.to === 'crm' ? 'CRM field' : c.to === 'custom' ? (c.isNew ? 'New employee field' : 'Employee field') : c.to === 'attendance' ? 'Attendance' : 'Not stored'}</Badge> <span className="ml-1">{c.label}</span></td>
                  <td className="px-3 py-1.5 text-mute">{c.type ? TYPE_LABEL[c.type] : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * HR → Employee Details → Import from a sheet: the company's attendance / salary register (.xlsx / .csv or a Google
 * Sheets link). Preview every person — new, update (fields that change), unchanged — with their attendance for the
 * month; Apply saves it all at once. Bank account numbers are shown masked here.
 */
export function EmployeeImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const [confirm, node] = useConfirm()
  const input = useRef<HTMLInputElement>(null)
  const [sheets, setSheets] = useState<{ name: string; rows: unknown[][] }[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [month, setMonth] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [show, setShow] = useState<'all' | 'new' | 'update' | 'same' | 'skip'>('all')
  const [roleFor, setRoleFor] = useState<Record<string, Role>>({})
  const plan = useMemo(() => (sheets ? planEmployeeImport(sheets, db, month) : null), [sheets, db, month])
  const rows = plan?.rows ?? null
  const n = (a: string) => rows?.filter((r) => r.action === a).length ?? 0
  const newDepts = [...new Set((rows ?? []).filter((r) => r.action === 'new').map((r) => r.v.department))]
  const branches = rows ? branchPlan(db, rows.filter((r) => r.action !== 'skip')) : null
  const reset = () => { setSheets(null); setFileName(''); setErr(''); setShow('all'); setRoleFor({}) }
  const load = async (name: string, get: () => Promise<{ name: string; rows: unknown[][] }[]>) => {
    setBusy(true); setErr('')
    try {
      const s = await get()
      const m = monthOf(name) || monthOf(s.map((x) => x.name).join(' ')) || new Date().toISOString().slice(0, 7)
      if (!planEmployeeImport(s, db, m).rows.length) throw new Error('No employees found — the sheet needs a heading row with a name column (Name, Employee Name, or First Name + Last Name).')
      setSheets(s); setFileName(name); setMonth(m)
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const apply = async () => {
    if (!rows || !plan) return
    const nf = plan.fields.filter((f) => f.isNew).length
    const marks = rows.filter((r) => r.action !== 'skip').reduce((s, r) => s + r.marks.length, 0)
    if (!(await confirm('Apply the employee register?', `${n('new')} new employee(s) (no CRM login until IT gives one), ${n('update')} updated, ${marks} attendance mark(s) for ${month}. ${nf ? `${nf} new employee field(s) are created from the sheet's columns. ` : ''}Roles and logins are not changed. Payroll for ${month} uses the attendance marks.`))) return
    const r = await run(() => applyEmployeeImport(me, plan!, month, Object.fromEntries(newDepts.map((d) => [d, roleFor[d] ?? (/sales/i.test(d) ? 'sales' : 'support')]))))
    if (r && typeof r === 'object') { toast('success', `Employees: ${r.added} added, ${r.updated} updated, ${r.marks} attendance mark(s)${r.newFields ? ` · ${r.newFields} new field(s)` : ''}${r.branches.length ? ` · branches added: ${r.branches.join(', ')}` : ''}`); reset(); onClose() }
  }
  const list = (rows ?? []).filter((r) => show === 'all' || r.action === show)
  const mask = (a: string) => (a ? `•••• ${a.slice(-4)}` : '—')

  return (
    <Modal open={open} onClose={() => { reset(); onClose() }} size="xl" title="Import employees from a sheet"
      subtitle="Any employee sheet, as it is: every column is read — the CRM's own fields are recognised by their name (Name, DOJ, Department, Mobile, Email, bank, salary parts, day columns P / A / H…) and every other column becomes an employee field by itself. People are matched by office email (else by name); nothing is duplicated. Roles and logins are never changed."
      footer={rows ? <><Button variant="outline" onClick={reset}>Choose another</Button><Button icon={CheckCircle2} disabled={!n('new') && !n('update')} onClick={apply}>Apply ({n('new')} new · {n('update')} updated)</Button></> : <Button variant="outline" onClick={onClose}>Close</Button>}>
      <input ref={input} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void load(f.name, () => readSheets(f)) }} />
      {!rows && (
        <div className="grid gap-4">
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void load('Google Sheet', () => readGoogleSheet(link.trim(), 'employees')) }}>
            <label className="min-w-[16rem] flex-1">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-mute"><Link2 className="size-3.5" />Google Sheets link</span>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className="h-10 w-full rounded-xl border border-line bg-card px-3 text-sm" />
            </label>
            <Button type="submit" icon={FileSpreadsheet} loading={busy} disabled={!link.trim()}>Read the sheet</Button>
          </form>
          <button type="button" onClick={() => input.current?.click()} className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-6 py-8 text-center hover:border-brand hover:bg-brand-soft/30">
            <Upload className="size-9 text-brand-ink" /><span className="font-bold">Choose the register (.xlsx / .csv)</span>
            <span className="text-xs text-mute">e.g. “REXERA ATTENDANCE REPORT - NOV-26.csv” — the month of the day columns is taken from the name (change it in the preview).</span>
          </button>
          {err && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{err}</p>}
        </div>
      )}
      {rows && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <p className="flex items-center gap-2 text-sm"><FileSpreadsheet className="size-4 text-brand-ink" /><b>{fileName}</b><span className="text-mute">· {rows.length} people</span></p>
            <Input label="Attendance month (day columns)" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ml-auto w-48" />
          </div>
          {plan && <ColumnsFound plan={plan} />}
          <div className="flex flex-wrap gap-2">
            {([['all', `All ${rows.length}`], ['new', `New ${n('new')}`], ['update', `Update ${n('update')}`], ['same', `Unchanged ${n('same')}`], ['skip', `Skipped ${n('skip')}`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setShow(k)} className={cx('rounded-full border px-3 py-1 text-xs font-semibold', show === k ? 'border-brand bg-brand text-white' : 'border-line hover:bg-card2')}>{l}</button>
            ))}
          </div>
          <div className="max-h-[48vh] overflow-auto rounded-xl border border-line">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 bg-card2 text-left text-[11px] uppercase tracking-wide text-mute"><tr>
                <th className="px-3 py-2">Person</th><th className="px-2 py-2">Department · branch</th><th className="px-2 py-2">Joined</th><th className="px-2 py-2">CTC</th><th className="px-2 py-2">Bank</th><th className="px-2 py-2">Attendance</th><th className="px-3 py-2">What happens</th>
              </tr></thead>
              <tbody className="divide-y divide-line/70">
                {list.map((r) => {
                  const c = { P: 0, A: 0, H: 0, L: 0 }; for (const m of r.marks) c[m.mark]++
                  return (
                    <tr key={r.line} className={cx(r.action === 'skip' && 'bg-bad-soft/30')}>
                      <td className="px-3 py-2"><b>{r.v.name}</b><span className="block text-[11px] text-mute">{r.v.email || 'no office email'}{r.v.phone ? ` · ${r.v.phone}` : ''}</span></td>
                      <td className="px-2 py-2 text-xs">{r.v.department} · {r.v.designation}<span className="block text-mute">{r.v.branchKey || '—'}{r.v.gender ? ` · ${r.v.gender}` : ''}</span></td>
                      <td className="px-2 py-2 text-xs">{r.v.joinedOn || '—'}</td>
                      <td className="px-2 py-2 text-xs">{r.v.ctc != null ? inr(r.v.ctc) : '—'}</td>
                      <td className="px-2 py-2 text-xs">{r.v.bankName || '—'}<span className="block text-mute">{mask(r.v.bankAccount)}{r.v.bankIfsc ? ` · ${r.v.bankIfsc}` : ''}</span></td>
                      <td className="px-2 py-2 text-xs">{r.marks.length ? <>P {c.P} · A {c.A}{c.H ? ` · H ${c.H}` : ''}</> : '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.action === 'new' ? <Badge tone="green">new</Badge> : r.action === 'update' ? <Badge tone="blue">update</Badge> : r.action === 'same' ? <Badge tone="gray">unchanged</Badge> : <Badge tone="red">skipped</Badge>}
                        {Object.keys(r.v.custom).length > 0 && <span className="mt-1 block text-mute">+ {Object.keys(r.v.custom).length} more detail{Object.keys(r.v.custom).length === 1 ? '' : 's'} ({Object.keys(r.v.custom).map((k) => plan?.fields.find((f) => f.key === k)?.label ?? k).slice(0, 4).join(', ')}{Object.keys(r.v.custom).length > 4 ? '…' : ''})</span>}
                        {r.changes.length > 0 && <span className="mt-1 block text-mute">changes: {r.changes.join(', ')}</span>}
                        {r.problems.map((p) => <span key={p} className="mt-1 block text-bad">{p}</span>)}
                        {r.notes.map((p) => <span key={p} className="mt-1 block text-mute">{p}</span>)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {branches && branches.missing.length > 0 && <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">Branches added: {branches.missing.join(', ')} — add their address and GSTIN later in Access → Settings → Branches.</p>}
          {newDepts.length > 0 && (
            <div className="rounded-xl border border-line p-3">
              <p className="mb-2 flex items-center gap-2 text-sm font-bold"><Users className="size-4" />CRM role for the {n('new')} new people <span className="font-normal text-mute">— they get no login until IT gives them a password</span></p>
              <div className="grid gap-2 sm:grid-cols-3">
                {newDepts.map((dep) => (
                  <Select key={dep} label={`${dep || 'No department'} · ${rows.filter((r) => r.action === 'new' && r.v.department === dep).length}`} value={roleFor[dep] ?? (/sales/i.test(dep) ? 'sales' : 'support')} onChange={(e) => setRoleFor({ ...roleFor, [dep]: e.target.value as Role })}>
                    {ROLES.filter((r) => !['superadmin', 'it'].includes(r.id)).map((r) => <option key={r.id} value={r.id}>{roleLabel(r.id)}</option>)}
                  </Select>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {node}
    </Modal>
  )
}
