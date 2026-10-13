import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Briefcase, ChevronDown, Download, Forward, Pencil, Plus, Trash2, Upload, UserPlus, Users } from 'lucide-react'
import type { Lead, LeadStatus } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import {
  assignLeads, deleteLeads, deleteUnassignedLeads, forwardLead, isOverdueLead, isPendingLead, markLeadsSeen, overdueLeadsOf, setLeadStatus, userName, visibleLeads,
} from '../../lib/actions'
import { CLOSED_LEAD, FOLLOW_UP_LEAD, LEAD_STATUS, OPEN_LEAD } from '../../lib/workflow'
import { addDays, ago, downloadCsv, fmtDate, fmtDateTime, inr, today, ymd } from '../../lib/format'
import { rolesOf } from '../../lib/rbac'
import {
  Badge, Button, Card, Checkbox, Drawer, EmptyState, Input, Menu, MenuItem, Modal, PageHeader, SearchBox, Select, Table, Tabs, Td, Textarea, Th, useConfirm, useRun,
} from '../../components/ui'
import { LeadFormModal } from '../../components/LeadForm'
import { LeadUploadHistory, LeadUploadModal } from '../../components/LeadUpload'
import { CallLogger } from './Dialer'

type View = 'open' | 'due' | 'new' | 'pending' | 'unassigned' | 'CONVERTED' | 'closed' | 'all' | 'uploads'
const STATUS_CLS: Record<string, string> = {
  blue: 'border-info/30 bg-info-soft text-info', gray: 'border-line bg-card2 text-mute', amber: 'border-warn/30 bg-warn-soft text-warn',
  violet: 'border-violet-300 bg-violet-500/10 text-violet-700 dark:text-violet-300', red: 'border-bad/30 bg-bad-soft text-bad', green: 'border-ok/30 bg-ok-soft text-ok',
  cyan: 'border-cyan-300 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300', orange: 'border-orange-300 bg-orange-500/10 text-orange-700 dark:text-orange-300',
}
/** These ask for something before saving: a follow-up date, a reason, or the deal value. */
const needsDetails = (s: LeadStatus) => FOLLOW_UP_LEAD.includes(s) || s === 'NOT_INTERESTED' || s === 'CONVERTED'
/** "Assigned by A → B, forwarded by B → C" */
const chainText = (db: ReturnType<typeof useDb>, l: Lead) => (l.chain ?? []).map((h) => `${h.kind === 'FORWARDED' ? 'forwarded' : h.kind === 'REASSIGNED' ? 'reassigned' : 'assigned'} by ${userName(db, h.by)} → ${userName(db, h.to)}`).join(', ')

export default function Leads() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const [confirm, confirmNode] = useConfirm()
  const sa = rolesOf(me).includes('superadmin')
  const assigner = can('leads.assign', 'leads.manage')
  const [q, setQ] = useState('')
  const [view, setView] = useState<View>(() => (params.get('view') as View) || 'open')
  const [owner, setOwner] = useState('')
  const [disp, setDisp] = useState<LeadStatus | ''>('')
  const [sel, setSel] = useState<string[]>([])
  const [form, setForm] = useState<{ open: boolean; lead?: Lead }>({ open: false })
  const [assign, setAssign] = useState({ open: false, to: '', note: '' })
  const [upload, setUpload] = useState(false)
  const [status, setStatus] = useState<{ lead: Lead; status: LeadStatus; note: string; followUp: string; value: string } | null>(null)
  const [fwd, setFwd] = useState<{ lead: Lead; to: string; note: string } | null>(null)
  // leads given to me that I hadn't opened: shown as "New" this visit, then marked seen
  const [unseen] = useState(() => new Set(db.leads.filter((l) => l.assignedTo === me.id && !l.seenAt).map((l) => l.id)))
  useEffect(() => { markLeadsSeen(me) }, [me])

  const openId = params.get('open')
  const all = visibleLeads(db, me)
  const t = today()
  const myOverdue = overdueLeadsOf(db, me.id)

  const counts = useMemo(() => ({
    open: all.filter((l) => OPEN_LEAD.includes(l.status)).length,
    due: all.filter((l) => OPEN_LEAD.includes(l.status) && l.followUp && l.followUp <= t).length,
    new: all.filter((l) => unseen.has(l.id)).length,
    pending: all.filter((l) => isPendingLead(l)).length,
    unassigned: all.filter((l) => !l.assignedTo).length,
    CONVERTED: all.filter((l) => l.status === 'CONVERTED').length,
    closed: all.filter((l) => CLOSED_LEAD.includes(l.status)).length,
    all: all.length,
  }), [all, t, unseen])

  const list = useMemo(() => {
    const s = q.toLowerCase()
    return all.filter((l) => {
      if (view === 'open' && !OPEN_LEAD.includes(l.status)) return false
      if (view === 'due' && !(OPEN_LEAD.includes(l.status) && l.followUp && l.followUp <= t)) return false
      if (view === 'new' && !unseen.has(l.id)) return false
      if (view === 'pending' && !isPendingLead(l)) return false
      if (view === 'unassigned' && l.assignedTo) return false
      if (view === 'CONVERTED' && l.status !== 'CONVERTED') return false
      if (view === 'closed' && !CLOSED_LEAD.includes(l.status)) return false
      if (disp && l.status !== disp) return false
      if (owner && (l.assignedTo ?? '') !== (owner === 'none' ? '' : owner)) return false
      return !s || [l.name, l.company, l.phone, l.code, l.city, l.service, l.email, l.altPhone ?? ''].some((x) => x.toLowerCase().includes(s))
    }).sort((a, b) => Number(isOverdueLead(b)) - Number(isOverdueLead(a)) || (a.followUp ?? '9').localeCompare(b.followUp ?? '9') || b.createdAt.localeCompare(a.createdAt))
  }, [all, q, view, owner, disp, t, unseen])

  const owners = db.users.filter((u) => u.active && rolesOf(u).some((r) => r === 'sales' || r === 'teamlead') && (can('leads.manage') || u.teamLeadId === me.id || u.id === me.id))
  const colleagues = db.users.filter((u) => u.active && u.id !== me.id && rolesOf(u).some((r) => r === 'sales' || r === 'teamlead'))
  const lead = openId ? all.find((l) => l.id === openId) : undefined
  const allSel = list.length > 0 && list.every((l) => sel.includes(l.id))

  // a disposition that needs more opens a small form; the rest save straight away
  const pickStatus = async (l: Lead, s: LeadStatus) => {
    if (needsDetails(s)) { setStatus({ lead: l, status: s, note: '', followUp: l.followUp && l.followUp >= t ? l.followUp : ymd(addDays(new Date(), 1)), value: l.price != null ? String(l.price) : '' }); return }
    await run(() => setLeadStatus(me, l.id, s), `${l.name}: ${LEAD_STATUS[s].label}`)
  }
  const saveStatus = async () => {
    if (!status) return
    const { lead: l, status: s, note, followUp, value } = status
    const ok = await run(() => setLeadStatus(me, l.id, s, note, FOLLOW_UP_LEAD.includes(s) ? followUp : undefined, s === 'CONVERTED' && value ? Number(value) : undefined), `${l.name}: ${LEAD_STATUS[s].label}`)
    if (!ok) return
    setStatus(null)
    if ((s === 'HOT_PROSPECT' || s === 'CONVERTED') && can('bookings.create') && await confirm('Hot prospect — create a CRM entry?', `${l.name}'s details will be filled in for you; you can change anything before saving.`)) nav(`/bookings/new?lead=${l.id}`)
  }

  return (
    <div>
      <PageHeader title="CRM Leads" subtitle={can('leads.manage') ? 'All leads across the company' : assigner ? 'Your leads and your team’s' : 'Leads assigned to you'} icon={UserPlus}
        actions={<>
          {sa && <Button variant="outline" icon={Upload} onClick={() => setUpload(true)}>Upload leads</Button>}
          <Button variant="outline" icon={Download} onClick={() => downloadCsv(`leads-${t}.csv`, list.map((l) => ({
            code: l.code, name: l.name, company: l.company, phone: l.phone, alternate_phone: l.altPhone ?? '', email: l.email, city: l.city, state: l.state, location: l.location ?? '',
            service: l.service, source: l.source, requirement: l.requirement ?? '', industry: l.industry ?? '', business_type: l.businessType ?? '', turnover: l.turnover ?? '',
            funding_amount: l.fundingAmount ?? '', price: l.price ?? '', status: LEAD_STATUS[l.status].label, follow_up: l.followUp ?? '', owner: userName(db, l.assignedTo), created: ymd(l.createdAt),
          })))}>Export</Button>
          <Button variant="accent" icon={Plus} onClick={() => setForm({ open: true })}>New lead</Button>
        </>} />

      {myOverdue.length > 0 && (
        <div role="alert" className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-bad/40 bg-bad-soft px-4 py-3 text-sm text-bad">
          <AlertTriangle className="size-5" />
          <span className="flex-1"><b>{myOverdue.length} lead(s) still on “New” from before today.</b> <span className="text-ink/75">Update their disposition (or forward them) now — until you do, no new leads can be given to you.</span></span>
          <Button size="sm" variant="danger" onClick={() => { setView('open'); setDisp('NEW') }}>Show them</Button>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <Tabs value={view} onChange={(v) => { setView(v); setSel([]) }} tabs={[
            { id: 'open', label: 'To call', count: counts.open }, { id: 'due', label: 'Follow-ups due', count: counts.due },
            ...(counts.new ? [{ id: 'new' as const, label: 'New for me', count: counts.new }] : []),
            ...(assigner ? [{ id: 'pending' as const, label: 'Pending (2 days)', count: counts.pending }, { id: 'unassigned' as const, label: 'Unassigned', count: counts.unassigned }] : []),
            { id: 'CONVERTED', label: 'Converted', count: counts.CONVERTED }, { id: 'closed', label: 'Closed', count: counts.closed }, { id: 'all', label: 'All', count: counts.all },
            ...(sa ? [{ id: 'uploads' as const, label: 'Upload history', count: db.leadUploads?.length ?? 0 }] : []),
          ]} />
          {view !== 'uploads' && <>
            <SearchBox value={q} onChange={setQ} placeholder="Search name, phone, company, email…" className="min-w-52 flex-1" />
            <select value={disp} onChange={(e) => setDisp(e.target.value as LeadStatus | '')} className="h-10 rounded-xl border border-line bg-card px-3 text-sm" aria-label="Filter by disposition">
              <option value="">All dispositions</option>{(Object.keys(LEAD_STATUS) as LeadStatus[]).map((s) => <option key={s} value={s}>{LEAD_STATUS[s].label}</option>)}
            </select>
            {assigner && (
              <select value={owner} onChange={(e) => setOwner(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-3 text-sm" aria-label="Filter by owner">
                <option value="">Everyone</option><option value="none">Unassigned</option>
                {owners.map((u) => <option key={u.id} value={u.id}>{u.name}{overdueLeadsOf(db, u.id).length ? ` · ${overdueLeadsOf(db, u.id).length} overdue` : ''}</option>)}
              </select>
            )}
            {can('leads.manage') && view === 'unassigned' && counts.unassigned > 0 && (
              <Button size="sm" variant="ghost" icon={Trash2} className="text-bad" onClick={async () => { if (await confirm('Delete all unassigned leads?', `${counts.unassigned} lead(s) nobody has been given are deleted, with their history.`, true)) run(() => deleteUnassignedLeads(me), 'Unassigned leads deleted') }}>Delete all unassigned</Button>
            )}
          </>}
        </div>
        {sel.length > 0 && view !== 'uploads' && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-soft/50 px-4 py-2 text-sm">
            <b>{sel.length} selected</b>
            {assigner && <Button size="sm" variant="soft" icon={Users} onClick={() => setAssign({ open: true, to: '', note: '' })}>Assign</Button>}
            {can('leads.manage') && <Button size="sm" variant="ghost" icon={Trash2} className="text-bad" onClick={async () => { if (await confirm('Delete leads?', `${sel.length} lead(s) and their call history will be removed.`, true)) { run(() => deleteLeads(me, sel), 'Deleted'); setSel([]) } }}>Delete</Button>}
            <button className="ml-auto text-xs text-mute hover:underline" onClick={() => setSel([])}>Clear</button>
          </div>
        )}
        {view === 'uploads' ? <LeadUploadHistory /> : !list.length ? <EmptyState icon={UserPlus} title="No leads here" text={sa ? 'Add a lead, or upload a sheet of leads.' : 'Add a lead.'} action={<Button icon={Plus} onClick={() => setForm({ open: true })}>New lead</Button>} /> : (
          <Table>
            <thead><tr>
              <Th className="w-10"><Checkbox checked={allSel} onChange={(v) => setSel(v ? list.map((l) => l.id) : [])} /></Th>
              <Th>Lead</Th><Th>Service</Th><Th>Disposition</Th><Th>Follow-up</Th><Th>Owner</Th><Th className="text-right">Actions</Th>
            </tr></thead>
            <tbody>
              {list.slice(0, 200).map((l) => {
                const last = l.chain?.at(-1)
                return (
                  <tr key={l.id} className={isOverdueLead(l) ? 'bg-bad-soft/40 hover:bg-bad-soft/60' : 'hover:bg-card2/60'}>
                    <Td><Checkbox checked={sel.includes(l.id)} onChange={(v) => setSel((s) => (v ? [...s, l.id] : s.filter((x) => x !== l.id)))} /></Td>
                    <Td>
                      <button onClick={() => setParams({ open: l.id })} className="text-left">
                        <span className="flex items-center gap-1.5 font-semibold hover:text-brand-ink">{l.name}{unseen.has(l.id) && <Badge tone="blue">New</Badge>}{isOverdueLead(l) && <Badge tone="red">Overdue</Badge>}</span>
                        <span className="block text-xs text-mute">{l.company || '—'} · <span className="font-mono">{l.phone}</span></span>
                      </button>
                    </Td>
                    <Td><span className="block max-w-48 truncate">{l.service || l.requirement || '—'}</span><span className="text-xs text-mute">{l.price != null ? inr(l.price) : 'No price'} · {l.source}</span></Td>
                    <Td>
                      <select value={l.status} aria-label={`Disposition of ${l.name}`} onChange={(e) => pickStatus(l, e.target.value as LeadStatus)}
                        className={`h-8 rounded-lg border px-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-brand/20 ${STATUS_CLS[LEAD_STATUS[l.status].tone] ?? 'border-line bg-card'}`}>
                        {(Object.keys(LEAD_STATUS) as LeadStatus[]).map((s) => <option key={s} value={s}>{LEAD_STATUS[s].label}</option>)}
                      </select>
                    </Td>
                    <Td>{l.followUp ? <span className={l.followUp < t ? 'font-semibold text-bad' : l.followUp === t ? 'font-semibold text-warn' : ''}>{fmtDate(l.followUp)}</span> : <span className="text-mute">—</span>}</Td>
                    <Td className="text-xs">
                      {l.assignedTo ? <>{userName(db, l.assignedTo)}{last && last.by !== last.to && <span className="block text-[11px] text-mute">{last.kind === 'FORWARDED' ? 'forwarded' : 'from'} by {userName(db, last.by)}</span>}</> : <Badge tone="amber">Unassigned</Badge>}
                    </Td>
                    <Td className="text-right">
                      <Menu width="w-56" trigger={(o) => <Button size="sm" variant="outline" icon={ChevronDown} aria-expanded={o}>Update</Button>}>
                        {(close) => <>
                          <MenuItem icon={Pencil} onClick={() => { close(); setForm({ open: true, lead: l }) }}>Change info</MenuItem>
                          {(l.assignedTo === me.id || assigner) && <MenuItem icon={Forward} onClick={() => { close(); setFwd({ lead: l, to: '', note: '' }) }}>Forward to a colleague</MenuItem>}
                          {l.status !== 'CONVERTED' && can('bookings.create') && <MenuItem icon={Briefcase} onClick={() => { close(); nav(`/bookings/new?lead=${l.id}`) }}>Book as CRM entry</MenuItem>}
                        </>}
                      </Menu>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
        {view !== 'uploads' && list.length > 200 && <p className="p-3 text-center text-xs text-mute">Showing 200 of {list.length}. Refine the search to see more.</p>}
      </Card>

      <LeadFormModal open={form.open} lead={form.lead} onClose={() => setForm({ open: false })} />
      {sa && <LeadUploadModal open={upload} onClose={() => { setUpload(false); setView('unassigned') }} />}

      <Modal open={assign.open} onClose={() => setAssign({ ...assign, open: false })} title={`Assign ${sel.length} lead(s)`} size="sm"
        footer={<><Button variant="outline" onClick={() => setAssign({ ...assign, open: false })}>Cancel</Button><Button disabled={!assign.to} onClick={async () => { if (await run(() => assignLeads(me, sel, assign.to, assign.note), 'Leads assigned')) { setAssign({ open: false, to: '', note: '' }); setSel([]) } }}>Assign</Button></>}>
        <div className="space-y-4">
          <Select label="Sales person" value={assign.to} onChange={(e) => setAssign({ ...assign, to: e.target.value })}>
            <option value="">— Select —</option>
            {owners.map((u) => { const n = overdueLeadsOf(db, u.id).length; return <option key={u.id} value={u.id} disabled={n > 0}>{u.name}{n ? ` — ${n} overdue lead(s), can't take new ones` : ''}</option> })}
          </Select>
          <Input label="Note (optional)" value={assign.note} onChange={(e) => setAssign({ ...assign, note: e.target.value })} />
        </div>
      </Modal>

      <Modal open={!!fwd} onClose={() => setFwd(null)} title={fwd ? `Forward ${fwd.lead.name}` : ''} subtitle="The lead moves to your colleague; the history shows you forwarded it." size="sm"
        footer={<><Button variant="outline" onClick={() => setFwd(null)}>Cancel</Button><Button icon={Forward} disabled={!fwd?.to || (fwd?.note.trim().length ?? 0) < 3} onClick={async () => { if (fwd && await run(() => forwardLead(me, fwd.lead.id, fwd.to, fwd.note), 'Lead forwarded')) setFwd(null) }}>Forward</Button></>}>
        {fwd && <div className="space-y-4">
          <Select label="Colleague" value={fwd.to} onChange={(e) => setFwd({ ...fwd, to: e.target.value })}>
            <option value="">— Select —</option>
            {colleagues.filter((u) => u.id !== fwd.lead.assignedTo).map((u) => { const n = overdueLeadsOf(db, u.id).length; return <option key={u.id} value={u.id} disabled={n > 0}>{u.name}{n ? ` — ${n} overdue lead(s)` : ''}</option> })}
          </Select>
          <Textarea label="Note for them" required rows={3} value={fwd.note} onChange={(e) => setFwd({ ...fwd, note: e.target.value })} placeholder="e.g. Client speaks Gujarati — please call after 4 pm" />
        </div>}
      </Modal>

      <Modal open={!!status} onClose={() => setStatus(null)} title={status ? `${status.lead.name} · ${LEAD_STATUS[status.status].label}` : ''} size="sm"
        footer={<><Button variant="outline" onClick={() => setStatus(null)}>Cancel</Button><Button disabled={status?.status === 'NOT_INTERESTED' && (status.note.trim().length < 3)} onClick={saveStatus}>Save disposition</Button></>}>
        {status && <div className="space-y-4">
          {FOLLOW_UP_LEAD.includes(status.status) && <Input label="Next follow-up" type="date" min={t} value={status.followUp} onChange={(e) => setStatus({ ...status, followUp: e.target.value })} />}
          {status.status === 'CONVERTED' && <Input label="Deal value (₹)" type="number" min={0} value={status.value} onChange={(e) => setStatus({ ...status, value: e.target.value })} hint="Optional, before GST" />}
          <Textarea label={status.status === 'NOT_INTERESTED' ? 'Reason' : 'Note'} required={status.status === 'NOT_INTERESTED'} rows={2} value={status.note} onChange={(e) => setStatus({ ...status, note: e.target.value })}
            placeholder={status.status === 'NOT_INTERESTED' ? 'Why not? e.g. already took the service elsewhere' : 'What happened?'} />
        </div>}
      </Modal>

      <Drawer open={!!lead} onClose={() => setParams({})} title={lead?.name} subtitle={lead && <span>{lead.code} · {lead.company || 'No company'} · <Badge tone={LEAD_STATUS[lead.status].tone}>{LEAD_STATUS[lead.status].label}</Badge></span>}
        footer={lead && <>
          <Button variant="outline" icon={Pencil} onClick={() => setForm({ open: true, lead })}>Edit</Button>
          {(lead.assignedTo === me.id || assigner) && <Button variant="outline" icon={Forward} onClick={() => setFwd({ lead, to: '', note: '' })}>Forward</Button>}
          {lead.status !== 'CONVERTED' && can('bookings.create') && <Button variant="accent" icon={Briefcase} onClick={() => nav(`/bookings/new?lead=${lead.id}`)}>Book as CRM entry</Button>}
        </>}>
        {lead && <LeadDetails lead={lead} />}
      </Drawer>
      {confirmNode}
    </div>
  )
}

/** Everything about one lead: details from the sheet, who passed it to whom, what happened, and its calls. */
function LeadDetails({ lead }: { lead: Lead }) {
  const db = useDb()
  const facts: [string, string | undefined][] = [
    ['Phone', lead.phone], ['Alternate phone', lead.altPhone], ['Email', lead.email], ['City', [lead.city, lead.state].filter(Boolean).join(', ')], ['Address', lead.location],
    ['Service', lead.service], ['Price', lead.price != null ? inr(lead.price) : undefined], ['Source', lead.source], ['Industry', lead.industry], ['Business type', lead.businessType],
    ['Annual turnover', lead.turnover], ['Funding amount', lead.fundingAmount], ['Funding category', lead.fundingCategory], ['Form filled', lead.formAt ? fmtDateTime(lead.formAt) : undefined],
    ['Owner', userName(db, lead.assignedTo)], ['Given to them', lead.assignedAt ? ago(lead.assignedAt) : undefined], ['Created', ago(lead.createdAt)],
  ]
  const upload = lead.uploadId ? db.leadUploads?.find((u) => u.id === lead.uploadId) : undefined
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 text-sm">
        {facts.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="rounded-xl bg-card2 px-3 py-2"><p className="text-[11px] text-mute">{k}</p><p className="truncate font-semibold" title={v}>{v}</p></div>
        ))}
      </div>
      {lead.requirement && <div><h4 className="mb-1 text-sm font-bold">Requirement</h4><p className="whitespace-pre-line text-sm">{lead.requirement}</p></div>}
      {lead.notes && <div><h4 className="mb-1 text-sm font-bold">Notes</h4><p className="whitespace-pre-line rounded-xl border border-line p-3 text-sm">{lead.notes}</p></div>}
      {lead.extra && Object.keys(lead.extra).length > 0 && (
        <details className="rounded-xl border border-line p-3 text-sm">
          <summary className="cursor-pointer font-bold">More details from the sheet{upload ? ` (${upload.fileName})` : ''}</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">{Object.entries(lead.extra).map(([k, v]) => <div key={k}><dt className="text-[11px] text-mute">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
        </details>
      )}
      {(lead.chain?.length ?? 0) > 0 && (
        <div>
          <h4 className="mb-2 font-bold">Hand-over chain</h4>
          <ol className="flex flex-wrap items-center gap-1.5 text-xs">
            {lead.chain!.map((h, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {i === 0 && <span className="rounded-full bg-card2 px-2 py-1 font-semibold">{userName(db, h.by)}</span>}
                <span className="text-mute" title={`${fmtDateTime(h.at)}${h.note ? ` — ${h.note}` : ''}`}>{h.kind === 'FORWARDED' ? 'forwarded →' : h.kind === 'REASSIGNED' ? 'reassigned →' : 'assigned →'}</span>
                <span className="rounded-full bg-brand-soft px-2 py-1 font-semibold text-brand-ink">{userName(db, h.to)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-1 text-[11px] text-mute">{chainText(db, lead)}</p>
        </div>
      )}
      <div><h4 className="mb-3 font-bold">Log a call</h4><CallLogger lead={lead} /></div>
      <div>
        <h4 className="mb-3 font-bold">Activity ({lead.history?.length ?? 0})</h4>
        <ol className="space-y-3 border-l-2 border-line pl-4">
          {(lead.history ?? []).map((h, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[23px] top-1 size-3 rounded-full border-2 border-card bg-brand" />
              <p className="text-sm font-semibold">{h.action} <span className="font-normal text-mute">· {userName(db, h.by)}</span></p>
              <p className="text-xs text-mute">{fmtDateTime(h.at)}</p>
              {h.note && <p className="mt-0.5 text-sm">{h.note}</p>}
            </li>
          ))}
          {!lead.history?.length && <li className="text-sm text-mute">Nothing recorded yet.</li>}
        </ol>
      </div>
      <div>
        <h4 className="mb-3 font-bold">Call history ({lead.calls.length})</h4>
        <ol className="space-y-3 border-l-2 border-line pl-4">
          {lead.calls.map((c) => (
            <li key={c.id} className="relative">
              <span className="absolute -left-[23px] top-1 size-3 rounded-full border-2 border-card bg-accent" />
              <p className="text-sm font-semibold">{LEAD_STATUS[c.outcome]?.label ?? c.outcome} <span className="font-normal text-mute">· {Math.round(c.durationSec / 60)} min · {userName(db, c.by)}</span></p>
              <p className="text-xs text-mute">{fmtDateTime(c.at)}</p>
              {c.note && <p className="mt-1 text-sm">{c.note}</p>}
            </li>
          ))}
          {!lead.calls.length && <li className="text-sm text-mute">No calls yet.</li>}
        </ol>
      </div>
    </div>
  )
}

export type { LeadStatus }
