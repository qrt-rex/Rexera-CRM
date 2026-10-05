import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Briefcase, Download, Pencil, Phone, Plus, Trash2, Upload, UserPlus, Users } from 'lucide-react'
import type { Lead, LeadStatus } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { assignLeads, deleteLeads, importLeads, userName, visibleLeads } from '../../lib/actions'
import { LEAD_STATUS, OPEN_LEAD } from '../../lib/workflow'
import { ago, downloadCsv, fmtDate, fmtDateTime, inr, parseCsv, today } from '../../lib/format'
import { rolesOf } from '../../lib/rbac'
import {
  Badge, Button, Card, Checkbox, Drawer, EmptyState, FileButton, Modal, PageHeader, SearchBox, Select, Table, Td, Th, Tabs, useConfirm, useRun, useToast,
} from '../../components/ui'
import { LeadFormModal } from '../../components/LeadForm'
import { CallLogger } from './Dialer'

type View = 'open' | 'due' | 'all' | 'CONVERTED' | 'closed'

export default function Leads() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const toast = useToast()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const [confirm, confirmNode] = useConfirm()
  const [q, setQ] = useState('')
  const [view, setView] = useState<View>('open')
  const [owner, setOwner] = useState('')
  const [sel, setSel] = useState<string[]>([])
  const [form, setForm] = useState<{ open: boolean; lead?: Lead }>({ open: false })
  const [assignTo, setAssignTo] = useState('')
  const [assignOpen, setAssignOpen] = useState(false)
  const openId = params.get('open')
  const all = visibleLeads(db, me)
  const t = today()

  useEffect(() => { if (params.get('new')) { setForm({ open: true }); setParams({}, { replace: true }) } }, [params, setParams])

  const counts = useMemo(() => ({
    open: all.filter((l) => OPEN_LEAD.includes(l.status)).length,
    due: all.filter((l) => OPEN_LEAD.includes(l.status) && l.followUp && l.followUp <= t).length,
    CONVERTED: all.filter((l) => l.status === 'CONVERTED').length,
    closed: all.filter((l) => ['NOT_INTERESTED', 'INVALID'].includes(l.status)).length,
    all: all.length,
  }), [all, t])

  const list = useMemo(() => {
    const s = q.toLowerCase()
    return all.filter((l) => {
      if (view === 'open' && !OPEN_LEAD.includes(l.status)) return false
      if (view === 'due' && !(OPEN_LEAD.includes(l.status) && l.followUp && l.followUp <= t)) return false
      if (view === 'CONVERTED' && l.status !== 'CONVERTED') return false
      if (view === 'closed' && !['NOT_INTERESTED', 'INVALID'].includes(l.status)) return false
      if (owner && (l.assignedTo ?? '') !== (owner === 'none' ? '' : owner)) return false
      return !s || [l.name, l.company, l.phone, l.code, l.city, l.service].some((x) => x.toLowerCase().includes(s))
    }).sort((a, b) => (a.followUp ?? '9').localeCompare(b.followUp ?? '9') || b.createdAt.localeCompare(a.createdAt))
  }, [all, q, view, owner, t])

  const owners = db.users.filter((u) => u.active && rolesOf(u).some((r) => r === 'sales' || r === 'teamlead') && (can('leads.manage') || u.teamLeadId === me.id || u.id === me.id))
  const lead = openId ? all.find((l) => l.id === openId) : undefined
  const allSel = list.length > 0 && list.every((l) => sel.includes(l.id))

  const onImport = async (f: File) => {
    const rows = parseCsv(await f.text())
    if (!rows.length) return toast('error', 'The file has no rows. Use a CSV with a header row: name, phone, company, email, city, state, service, price.')
    const r = await run(() => importLeads(me, rows))
    if (r && typeof r === 'object') toast(r.errors.length ? 'warning' : 'success', `${r.added} added · ${r.skipped} duplicate(s) skipped${r.errors.length ? ` · ${r.errors.length} row error(s)` : ''}`)
  }

  return (
    <div>
      <PageHeader title="CRM Leads" subtitle={can('leads.manage') ? 'All leads across the company' : can('leads.assign') ? 'Your leads and your team’s' : 'Leads assigned to you'} icon={UserPlus}
        actions={<>
          <FileButton accept=".csv,text/csv" onFile={onImport}><Button variant="outline" icon={Upload}>Import CSV</Button></FileButton>
          <Button variant="outline" icon={Download} onClick={() => downloadCsv(`leads-${t}.csv`, list.map((l) => ({ code: l.code, name: l.name, company: l.company, phone: l.phone, email: l.email, city: l.city, state: l.state, service: l.service, source: l.source, price: l.price ?? '', status: l.status, follow_up: l.followUp ?? '', owner: userName(db, l.assignedTo), created: l.createdAt.slice(0, 10) })))}>Export</Button>
          <Button variant="accent" icon={Plus} onClick={() => setForm({ open: true })}>New lead</Button>
        </>} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <Tabs value={view} onChange={setView} tabs={[
            { id: 'open', label: 'To call', count: counts.open }, { id: 'due', label: 'Follow-ups due', count: counts.due },
            { id: 'CONVERTED', label: 'Converted', count: counts.CONVERTED }, { id: 'closed', label: 'Closed', count: counts.closed }, { id: 'all', label: 'All', count: counts.all },
          ]} />
          <SearchBox value={q} onChange={setQ} placeholder="Search name, phone, company…" className="min-w-52 flex-1" />
          {can('leads.assign', 'leads.manage') && (
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-3 text-sm" aria-label="Filter by owner">
              <option value="">Everyone</option><option value="none">Unassigned</option>
              {owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
        </div>
        {sel.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-soft/50 px-4 py-2 text-sm">
            <b>{sel.length} selected</b>
            {can('leads.assign', 'leads.manage') && <Button size="sm" variant="soft" icon={Users} onClick={() => setAssignOpen(true)}>Assign</Button>}
            {can('leads.manage') && <Button size="sm" variant="ghost" icon={Trash2} className="text-bad" onClick={async () => { if (await confirm('Delete leads?', `${sel.length} lead(s) and their call history will be removed.`, true)) { run(() => deleteLeads(me, sel), 'Deleted'); setSel([]) } }}>Delete</Button>}
            <button className="ml-auto text-xs text-mute hover:underline" onClick={() => setSel([])}>Clear</button>
          </div>
        )}
        {!list.length ? <EmptyState icon={UserPlus} title="No leads here" text="Add a lead or import a CSV file." action={<Button icon={Plus} onClick={() => setForm({ open: true })}>New lead</Button>} /> : (
          <Table>
            <thead><tr>
              <Th className="w-10"><Checkbox checked={allSel} onChange={(v) => setSel(v ? list.map((l) => l.id) : [])} /></Th>
              <Th>Lead</Th><Th>Service</Th><Th>Status</Th><Th>Follow-up</Th><Th>Owner</Th><Th className="text-right">Actions</Th>
            </tr></thead>
            <tbody>
              {list.slice(0, 200).map((l) => (
                <tr key={l.id} className="hover:bg-card2/60">
                  <Td><Checkbox checked={sel.includes(l.id)} onChange={(v) => setSel((s) => (v ? [...s, l.id] : s.filter((x) => x !== l.id)))} /></Td>
                  <Td>
                    <button onClick={() => setParams({ open: l.id })} className="text-left">
                      <span className="block font-semibold hover:text-brand-ink">{l.name}</span>
                      <span className="block text-xs text-mute">{l.company || '—'} · <span className="font-mono">{l.phone}</span></span>
                    </button>
                  </Td>
                  <Td><span className="block max-w-48 truncate">{l.service || '—'}</span><span className="text-xs text-mute">{l.price != null ? inr(l.price) : 'No price'} · {l.source}</span></Td>
                  <Td><Badge tone={LEAD_STATUS[l.status].tone} dot>{LEAD_STATUS[l.status].label}</Badge></Td>
                  <Td>{l.followUp ? <span className={l.followUp < t ? 'font-semibold text-bad' : l.followUp === t ? 'font-semibold text-warn' : ''}>{fmtDate(l.followUp)}</span> : <span className="text-mute">—</span>}</Td>
                  <Td className="text-xs">{l.assignedTo ? userName(db, l.assignedTo) : <Badge tone="amber">Unassigned</Badge>}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="soft" icon={Phone} onClick={() => setParams({ open: l.id })}>Call</Button>
                      <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setForm({ open: true, lead: l })} />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.length > 200 && <p className="p-3 text-center text-xs text-mute">Showing 200 of {list.length}. Refine the search to see more.</p>}
      </Card>

      <LeadFormModal open={form.open} lead={form.lead} onClose={() => setForm({ open: false })} />

      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title={`Assign ${sel.length} lead(s)`} size="sm"
        footer={<><Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button><Button onClick={async () => { if (await run(() => assignLeads(me, sel, assignTo), 'Leads assigned')) { setAssignOpen(false); setSel([]) } }}>Assign</Button></>}>
        <Select label="Sales person" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
          <option value="">— Select —</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
      </Modal>

      <Drawer open={!!lead} onClose={() => setParams({})} title={lead?.name} subtitle={lead && <span>{lead.code} · {lead.company || 'No company'}</span>}
        footer={lead && <>
          <Button variant="outline" icon={Pencil} onClick={() => setForm({ open: true, lead })}>Edit</Button>
          {lead.status !== 'CONVERTED' && can('bookings.create') && <Button variant="accent" icon={Briefcase} onClick={() => nav(`/bookings/new?lead=${lead.id}`)}>Book as CRM entry</Button>}
        </>}>
        {lead && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[['Phone', lead.phone], ['Email', lead.email || '—'], ['City', `${lead.city || '—'}, ${lead.state}`], ['Service', lead.service || '—'], ['Price', lead.price != null ? inr(lead.price) : '—'], ['Source', lead.source], ['Owner', userName(db, lead.assignedTo)], ['Created', ago(lead.createdAt)]].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-card2 px-3 py-2"><p className="text-[11px] text-mute">{k}</p><p className="truncate font-semibold">{v}</p></div>
              ))}
            </div>
            {lead.notes && <p className="whitespace-pre-line rounded-xl border border-line p-3 text-sm">{lead.notes}</p>}
            <div><h4 className="mb-3 font-bold">Log a call</h4><CallLogger lead={lead} /></div>
            <div>
              <h4 className="mb-3 font-bold">Call history ({lead.calls.length})</h4>
              <ol className="space-y-3 border-l-2 border-line pl-4">
                {lead.calls.map((c) => (
                  <li key={c.id} className="relative">
                    <span className="absolute -left-[23px] top-1 size-3 rounded-full border-2 border-card bg-accent" />
                    <p className="text-sm font-semibold">{c.outcome.replace('_', ' ').toLowerCase()} <span className="font-normal text-mute">· {Math.round(c.durationSec / 60)} min · {userName(db, c.by)}</span></p>
                    <p className="text-xs text-mute">{fmtDateTime(c.at)}</p>
                    {c.note && <p className="mt-1 text-sm">{c.note}</p>}
                  </li>
                ))}
                {!lead.calls.length && <li className="text-sm text-mute">No calls yet.</li>}
              </ol>
            </div>
          </div>
        )}
      </Drawer>
      {confirmNode}
    </div>
  )
}

export type { LeadStatus }
