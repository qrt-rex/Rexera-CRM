import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, UserMinus, UserPlus, Users, XCircle } from 'lucide-react'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { roleLabel } from '../lib/rbac'
import { applyUsers, planUsers, readSheets, type ApplyResult, type Plan } from '../lib/bulkUsers'
import { Badge, Button, Checkbox, cx, Modal, Progress, Select, useConfirm } from './ui'

/**
 * IT dashboard → Add users from a sheet: upload the company's user sheet (Name · ID · ROLE · Provide Dashboard ·
 * PWD · Branch), check every person's roles, branch and what happens, then apply. Passwords are never shown.
 */
export function BulkUsers({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const [confirm, confirmNode] = useConfirm()
  const input = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<{ name: string; rows: unknown[][] }[] | null>(null)
  const [err, setErr] = useState('')
  const [removeIds, setRemoveIds] = useState<string[] | null>(null)
  const [teamLeads, setTeamLeads] = useState<Record<string, string>>({})
  const [welcome, setWelcome] = useState(false)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [results, setResults] = useState<ApplyResult[] | null>(null)
  const [show, setShow] = useState<'all' | 'create' | 'update' | 'skip'>('all')

  const plan: Plan | null = useMemo(() => (sheets ? planUsers(sheets, db, me) : null), [sheets, db, me])
  const removing = removeIds ?? plan?.remove.map((u) => u.id) ?? []
  const count = (a: string) => plan?.rows.filter((r) => r.action === a).length ?? 0
  // the branches with sales people, and the team leaders the sheet puts in each
  const branchTeams = useMemo(() => {
    const m = new Map<string, { sales: number; leads: { email: string; name: string }[] }>()
    for (const r of plan?.rows ?? []) {
      if (r.action === 'skip' || !r.branchKey) continue
      const t = m.get(r.branchKey) ?? { sales: 0, leads: [] }
      if (r.roles[0] === 'sales') t.sales++
      if (r.roles.includes('teamlead')) t.leads.push({ email: r.email, name: r.name })
      m.set(r.branchKey, t)
    }
    return [...m.entries()].filter(([, t]) => t.sales && t.leads.length)
  }, [plan])

  const reset = () => { setSheets(null); setFileName(''); setErr(''); setRemoveIds(null); setTeamLeads({}); setResults(null); setShow('all') }
  const pick = async (f: File | undefined) => {
    if (!f) return
    reset()
    try { setSheets(await readSheets(f)); setFileName(f.name) } catch (e) { setErr(`Couldn't read ${f.name}: ${(e as Error).message}`) }
  }
  const apply = async () => {
    if (!plan) return
    const n = count('create'), u = count('update')
    if (!(await confirm('Apply the user list?', `${n} new user(s), ${u} updated${removing.length ? `, ${removing.length} removed (they can't sign in; Employees → Restore brings them back)` : ''}. Every change is written to the activity log.`, removing.length > 0))) return
    setBusy({ done: 0, total: 1 })
    const res = await applyUsers(me, plan, { removeIds: removing, teamLeads, welcome }, (done, total) => setBusy({ done, total }))
    setBusy(null); setResults(res); setSheets(null)
  }

  const rows = (plan?.rows ?? []).filter((r) => show === 'all' || r.action === show)
  return (
    <Modal open={open} onClose={() => { if (!busy) { reset(); onClose() } }} size="xl" title="Add users from a sheet"
      subtitle="Upload the user list (Name · ID · ROLE · Provide Dashboard · PWD · Branch). Check the preview, then apply. Passwords go straight to Supabase sign-in — never shown or stored in the CRM."
      footer={results ? <Button onClick={() => { reset(); onClose() }}>Done</Button> : <>
        <Button variant="outline" disabled={!!busy} onClick={() => { reset(); onClose() }}>Cancel</Button>
        <Button icon={UserPlus} disabled={!plan || !!busy || (!count('create') && !count('update') && !removing.length)} loading={!!busy} onClick={apply}>
          Apply{plan ? ` (${count('create')} new · ${count('update')} updated${removing.length ? ` · ${removing.length} removed` : ''})` : ''}
        </Button></>}>
      <input ref={input} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />

      {busy && <div className="mb-4"><p className="mb-1 flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Applying… {busy.done} of {busy.total}</p><Progress value={(busy.done / Math.max(1, busy.total)) * 100} /></div>}

      {results && (
        <div>
          <p className="mb-2 text-sm"><b className="text-ok">{results.filter((r) => r.ok).length} done</b>{results.some((r) => !r.ok) && <> · <b className="text-bad">{results.filter((r) => !r.ok).length} not done</b></>}</p>
          <ul className="max-h-[55vh] divide-y divide-line/70 overflow-auto rounded-xl border border-line text-sm">
            {results.map((r, i) => (
              <li key={i} className="flex items-start gap-2 px-3 py-2">
                {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" />}
                <span className="min-w-0 flex-1"><b>{r.name}</b> <span className="text-xs text-mute">· {r.line}</span><span className={cx('block text-xs', r.ok ? 'text-mute' : 'text-bad')}>{r.message}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!results && !plan && (
        <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-6 py-10 text-center hover:border-brand hover:bg-brand-soft/30">
          <FileSpreadsheet className="size-10 text-brand-ink" />
          <span className="font-bold">Choose the user sheet (.xlsx or .csv)</span>
          <span className="max-w-md text-xs text-mute">Every sheet and table in the file is read. Columns by their headings: Name, ID (email — the login), ROLE, Provide Dashboard (e.g. “Admin, hr, legal, OT”, “Team Leader Dashboard”, “Branch dashboard (Vadodara)”), PWD, Branch (e.g. AMD_A, AMD_Y, BRD).</span>
          {err && <span className="text-xs text-bad">{err}</span>}
        </button>
      )}

      {!results && plan && (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FileSpreadsheet className="size-4 text-brand-ink" /><b>{fileName}</b>
            <span className="text-mute">· {plan.rows.length} people read</span>
            <Button size="sm" variant="ghost" icon={Upload} onClick={() => input.current?.click()}>Choose another</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {([['all', `All ${plan.rows.length}`], ['create', `New ${count('create')}`], ['update', `Update ${count('update')}`], ['skip', `Skipped ${count('skip')}`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setShow(k)} className={cx('rounded-full border px-3 py-1 text-xs font-semibold', show === k ? 'border-brand bg-brand text-white' : 'border-line hover:bg-card2', k === 'skip' && count('skip') > 0 && show !== k && 'text-bad')}>{l}</button>
            ))}
          </div>

          <div className="max-h-[42vh] overflow-auto rounded-xl border border-line">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="sticky top-0 bg-card2 text-left text-[11px] uppercase tracking-wide text-mute"><tr>
                <th className="px-3 py-2">Person</th><th className="px-2 py-2">Login</th><th className="px-2 py-2">Dashboard (roles)</th><th className="px-2 py-2">Branch</th><th className="px-2 py-2">Password</th><th className="px-3 py-2">What happens</th>
              </tr></thead>
              <tbody className="divide-y divide-line/70">
                {rows.map((r) => (
                  <tr key={r.line} className={cx(r.action === 'skip' && 'bg-bad-soft/30')}>
                    <td className="px-3 py-2"><b>{r.name}</b><span className="block text-[11px] text-mute">{r.designation} · {r.line}</span></td>
                    <td className="px-2 py-2 text-xs">{r.email || '—'}</td>
                    <td className="px-2 py-2"><span className="flex flex-wrap gap-1">{r.roles.map((x, i) => <Badge key={x} tone={i ? 'gray' : 'navy'}>{roleLabel(x)}{i ? '' : ' · main'}</Badge>)}</span></td>
                    <td className="px-2 py-2 text-xs">{r.branchKey ?? '—'}{r.director ? ' (runs it)' : ''}</td>
                    <td className="px-2 py-2 text-xs">{r.password ? (r.problems.some((p) => p.startsWith('Password')) ? <span className="text-bad">doesn't fit the rule</span> : r.action === 'update' ? 'new password' : 'set') : r.action === 'update' ? 'kept' : '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.action === 'create' ? <Badge tone="green">new</Badge> : r.action === 'update' ? <Badge tone="blue">update</Badge> : <Badge tone="red">skipped</Badge>}
                      {r.problems.map((p) => <span key={p} className="mt-1 block text-bad">{p}</span>)}
                      {r.notes.map((p) => <span key={p} className="mt-1 block text-mute">{p}</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {plan.newBranches.length > 0 && <p className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info"><AlertTriangle className="mt-0.5 size-4 shrink-0" />New branch{plan.newBranches.length > 1 ? 'es' : ''} added: {plan.newBranches.map((b) => `${b.code} (${b.name})`).join(', ')} — add their address and GSTIN later in Access → Settings → Branches.</p>}

          {branchTeams.length > 0 && (
            <div className="rounded-xl border border-line p-3">
              <p className="mb-2 flex items-center gap-2 text-sm font-bold"><Users className="size-4" />Team Leader for each branch's sales people <span className="font-normal text-mute">(optional — they see their team's files; change any person later in Employees)</span></p>
              <div className="grid gap-2 sm:grid-cols-3">
                {branchTeams.map(([b, t]) => (
                  <Select key={b} label={`${b} · ${t.sales} sales people`} value={teamLeads[b] ?? ''} onChange={(e) => setTeamLeads({ ...teamLeads, [b]: e.target.value })}>
                    <option value="">Set later</option>{t.leads.map((l) => <option key={l.email} value={l.email}>{l.name}</option>)}
                  </Select>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-line p-3">
            <p className="mb-1 flex items-center gap-2 text-sm font-bold"><UserMinus className="size-4 text-bad" />Remove people who are not in the sheet ({removing.length} of {plan.remove.length})</p>
            <p className="mb-2 text-xs text-mute">They can no longer sign in; their open leads go back to Unassigned; nothing is deleted — Employees → Restore brings anyone back. You, IT Support accounts and — unless you are a Super Admin — Super Admin accounts are always kept{plan.keepNote.length ? ` (${plan.keepNote.join(', ')})` : ''}.</p>
            {plan.remove.length > 0 ? <>
              <div className="mb-2 flex gap-2"><Button size="sm" variant="ghost" onClick={() => setRemoveIds(plan.remove.map((u) => u.id))}>Tick all</Button><Button size="sm" variant="ghost" onClick={() => setRemoveIds([])}>Untick all</Button></div>
              <div className="grid max-h-40 gap-1 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
                {plan.remove.map((u) => <Checkbox key={u.id} checked={removing.includes(u.id)} label={`${u.name} · ${u.email}${u.id.startsWith('lg-') ? ' · old CRM' : ''}`} onChange={(v) => setRemoveIds(v ? [...removing, u.id] : removing.filter((x) => x !== u.id))} />)}
              </div>
            </> : <p className="text-xs text-ok">Everyone signed up is in the sheet.</p>}
          </div>

          <Checkbox checked={welcome} onChange={setWelcome} label="Send the welcome message to new users (Automation Center → welcome)" />
        </div>
      )}
      {confirmNode}
    </Modal>
  )
}
