import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase, CalendarClock, ClipboardList, Download, History, MessageCircle, Pencil, Plus, Save, Search } from 'lucide-react'
import { MessageClientModal, MessageLog } from './ClientMessage'
import { mayMessage } from '../lib/clientMessages'
import type { ClientEntry, ClientEntryStatus, Lead } from '../lib/types'
import { useDb } from '../lib/store'
import { useAuth, useMe } from '../lib/auth'
import { userName } from '../lib/actions'
import { addClientFollowUp, canEditClientEntry, canMakeClientEntry, CLIENT_ENTRY_STATUS, createClientEntry, emptyEntry, ENTRY_STATUSES, entryProblems, followUpDue, openEntryForLead, updateClientEntry, visibleClientEntries, type ClientEntryForm } from '../lib/clientEntries'
import { downloadCsv, fmtDate, fmtDateTime, fmtTime, inr, maskPhone, today, ymd } from '../lib/format'
import { seesMaskedPhones } from '../lib/rbac'
import { Badge, Button, cx, EmptyState, Input, Modal, Select, Tabs, Td, Textarea, Th, useConfirm, useRun, useSubmitting } from './ui'
import { PhoneInput } from './fields'

/** The scheme dropdown: the active services, by category. */
function SchemeSelect({ value, onChange, error }: { value: string; onChange: (id: string) => void; error?: string }) {
  const db = useDb()
  const active = db.services.filter((s) => s.active || s.id === value)
  const cats = [...new Set(active.map((s) => s.category))]
  return (
    <Select label="Scheme" required value={value} error={error} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Select scheme —</option>
      {cats.map((c) => <optgroup key={c} label={c}>{active.filter((s) => s.category === c).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
    </Select>
  )
}
function StatusSelect({ value, onChange, error }: { value: ClientEntryStatus | ''; onChange: (s: ClientEntryStatus) => void; error?: string }) {
  return (
    <Select label="Status" required value={value} error={error} onChange={(e) => onChange(e.target.value as ClientEntryStatus)}>
      <option value="">— Select status —</option>
      {ENTRY_STATUSES.map((s) => <option key={s} value={s}>{CLIENT_ENTRY_STATUS[s].label}</option>)}
    </Select>
  )
}

/**
 * The client entry the sales person fills while the dialer call is on. Every field but the follow-up is compulsory;
 * nothing is saved until all of them are filled. `compact`: one column, for the call window.
 */
export function ClientEntryFormView({ lead, entry, compact, onSaved }: { lead?: Lead; entry?: ClientEntry; compact?: boolean; onSaved?: (id: string) => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [busy, submit] = useSubmitting()
  const [f, setF] = useState<ClientEntryForm>(() => entry ? {
    date: entry.date, clientName: entry.clientName, companyName: entry.companyName, phone: entry.phone, serviceId: entry.serviceId,
    pitchedPrice: entry.pitchedPrice, status: entry.status === 'CONVERTED' ? '' : entry.status, requirement: entry.requirement, note: entry.note, followUp: entry.followUp ?? '', email: entry.email ?? '',
  } : emptyEntry(lead, db))
  const [tried, setTried] = useState(false)
  const set = <K extends keyof ClientEntryForm>(k: K, v: ClientEntryForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const e = tried ? entryProblems(db, f) : {}
  const save = () => submit(async () => {
    setTried(true)
    if (Object.keys(entryProblems(db, f)).length) return
    if (entry) {
      if (await run(() => updateClientEntry(me, entry.id, f), 'Client entry updated')) onSaved?.(entry.id)
      return
    }
    const id = await run(() => createClientEntry(me, f, lead?.id), 'Client entry saved')
    if (typeof id === 'string') { setF(emptyEntry(lead, db)); setTried(false); onSaved?.(id) }
  })
  return (
    <div className="space-y-3">
      <div className={cx('grid gap-3', !compact && 'sm:grid-cols-2')}>
        <Input label="Date" required type="date" value={f.date} max={today()} error={e.date} onChange={(ev) => set('date', ev.target.value)} />
        <PhoneInput label="Number" required value={f.phone} onChange={(v) => set('phone', v)} />
        <Input label="Client name" required value={f.clientName} error={e.clientName} onChange={(ev) => set('clientName', ev.target.value)} />
        <Input label="Company name" required value={f.companyName} error={e.companyName} onChange={(ev) => set('companyName', ev.target.value)} />
        <SchemeSelect value={f.serviceId} error={e.serviceId} onChange={(id) => set('serviceId', id)} />
        <Input label="Pitched price (₹)" required type="number" min={0} inputMode="decimal" value={f.pitchedPrice} error={e.pitchedPrice} hint="0 is allowed" onChange={(ev) => set('pitchedPrice', ev.target.value === '' ? '' : Number(ev.target.value))} />
        <StatusSelect value={f.status} error={e.status} onChange={(s) => set('status', s)} />
        <Input label="Follow-up (if needed)" type="date" min={today()} value={f.followUp} error={e.followUp} onChange={(ev) => set('followUp', ev.target.value)} />
        <Input label="Email (for the welcome email)" type="email" value={f.email ?? ''} error={e.email} onChange={(ev) => set('email', ev.target.value)} className={cx(!compact && 'sm:col-span-2')} placeholder="Optional" />
        <Textarea label="Requirement" required rows={2} value={f.requirement} error={e.requirement} onChange={(ev) => set('requirement', ev.target.value)} className={cx(!compact && 'sm:col-span-2')} placeholder="What the client needs" />
        <Textarea label="Note" required rows={2} value={f.note} error={e.note} onChange={(ev) => set('note', ev.target.value)} className={cx(!compact && 'sm:col-span-2')} placeholder="What was discussed on the call" />
      </div>
      {Object.keys(e).length > 0 && <p className="text-xs font-semibold text-bad">Fill in every field marked * to save the client entry{e.phone ? ' (the number needs 10 digits)' : ''}.</p>}
      <Button className="w-full" icon={Save} loading={busy} onClick={save}>{entry ? 'Save changes' : 'Save client entry'}</Button>
    </div>
  )
}

/** A follow-up on a client entry: what happened, the new status and the next date (if another one is needed). */
export function ClientFollowUpForm({ entry, onDone }: { entry: ClientEntry; onDone?: () => void }) {
  const me = useMe()
  const run = useRun()
  const [status, setStatus] = useState<ClientEntryStatus | ''>(entry.status === 'CONVERTED' ? '' : entry.status)
  const [note, setNote] = useState('')
  const [next, setNext] = useState('')
  const [busy, submit] = useSubmitting()
  const save = () => submit(async () => {
    if (!status) return
    if (await run(() => addClientFollowUp(me, entry.id, { status, note, next: next || undefined }), 'Follow-up saved')) { setNote(''); setNext(''); onDone?.() }
  })
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatusSelect value={status} onChange={setStatus} />
        <Input label="Next follow-up (if needed)" type="date" min={today()} value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <Textarea label="What happened" required rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Spoke to the client, payment expected on …" />
      <Button className="w-full" icon={CalendarClock} loading={busy} disabled={!status || note.trim().length < 3} onClick={save}>Save follow-up</Button>
    </div>
  )
}

/** One entry's details and follow-up history. */
function EntryDetails({ entry }: { entry: ClientEntry }) {
  const db = useDb()
  const me = useMe()
  const row = (k: string, v: ReactNode) => <div><dt className="text-[11px] font-semibold uppercase text-mute">{k}</dt><dd className="text-sm">{v}</dd></div>
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        {row('Date', fmtDate(entry.date))}
        {row('Client', entry.clientName)}
        {row('Company', entry.companyName)}
        {row('Number', <span className="font-mono">{seesMaskedPhones(me) ? maskPhone(entry.phone) : entry.phone}</span>)}
        {row('Scheme', entry.scheme)}
        {row('Pitched price', inr(entry.pitchedPrice))}
        {row('Status', <Badge tone={CLIENT_ENTRY_STATUS[entry.status].tone}>{CLIENT_ENTRY_STATUS[entry.status].label}</Badge>)}
        {row('Next follow-up', entry.followUp ? fmtDate(entry.followUp) : '—')}
        {row('Sales person', userName(db, entry.ownerId))}
      </dl>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-card2 p-3"><p className="text-[11px] font-semibold uppercase text-mute">Requirement</p><p className="whitespace-pre-line text-sm">{entry.requirement}</p></div>
        <div className="rounded-xl bg-card2 p-3"><p className="text-[11px] font-semibold uppercase text-mute">Note</p><p className="whitespace-pre-line text-sm">{entry.note}</p></div>
      </div>
      <div>
        <h4 className="mb-2 flex items-center gap-2 text-sm font-bold"><History className="size-4" />Follow-ups</h4>
        {!entry.followUps.length ? <p className="text-sm text-mute">No follow-ups yet.</p> : (
          <ul className="space-y-2">
            {entry.followUps.map((x) => (
              <li key={x.id} className="rounded-xl border border-line p-3 text-sm">
                <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-mute">{fmtDateTime(x.at)} · {userName(db, x.by)} <Badge tone={CLIENT_ENTRY_STATUS[x.status].tone}>{CLIENT_ENTRY_STATUS[x.status].label}</Badge></p>
                <p className="whitespace-pre-line">{x.note}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

type View = 'open' | 'due' | 'converted' | 'all'
/**
 * Client entries on the sales person's and team leader's dashboard: follow them up, and convert them into the CRM
 * entry once the payment is received (only the person who made the entry converts it). `full`: the Client Entries
 * page — every field in its own column, when it was entered, a date filter and a CSV download.
 */
export function ClientEntriesPanel({ lead, full }: { lead: boolean; full?: boolean }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const nav = useNavigate()
  const [confirm, confirmNode] = useConfirm()
  const [view, setView] = useState<View>(full ? 'all' : 'open')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [open, setOpen] = useState<{ id: string; follow: boolean; edit?: boolean } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const t = today()
  const all = useMemo(() => visibleClientEntries(db, me).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db, me])
  const isOpen = (e: ClientEntry) => e.status !== 'CONVERTED' && e.status !== 'NOT_INTERESTED'
  const counts = { open: all.filter(isOpen).length, due: all.filter((e) => followUpDue(e, t)).length, converted: all.filter((e) => e.status === 'CONVERTED').length, all: all.length }
  const ql = q.trim().toLowerCase()
  const rows = all
    .filter((e) => view === 'all' || (view === 'open' ? isOpen(e) : view === 'due' ? followUpDue(e, t) : e.status === 'CONVERTED'))
    .filter((e) => !ql || `${e.clientName} ${e.companyName} ${e.phone} ${e.scheme} ${e.requirement} ${e.note}`.toLowerCase().includes(ql))
    // entered between these days (the day it was saved)
    .filter((e) => (!from || ymd(e.createdAt) >= from) && (!to || ymd(e.createdAt) <= to))
  const download = () => downloadCsv(`client-entries-${today()}.csv`, rows.map((e) => ({
    'Entered on': fmtDateTime(e.createdAt), Date: e.date, 'Client name': e.clientName, 'Company name': e.companyName, Number: e.phone, Scheme: e.scheme,
    'Pitched price': e.pitchedPrice, Status: CLIENT_ENTRY_STATUS[e.status].label, Requirement: e.requirement, Note: e.note, 'Next follow-up': e.followUp ?? '',
    'Follow-ups done': e.followUps.length, 'Last follow-up': e.followUps[0]?.note ?? '', 'Sales person': userName(db, e.ownerId),
  })))
  const cur = open ? all.find((e) => e.id === open.id) : undefined
  const convert = async (e: ClientEntry) => {
    if (await confirm('Payment received — convert to CRM entry?', `${e.clientName} (${e.companyName}) is filled in on the CRM entry form from this client entry. Add the payment you received and its proof there; it counts as a CRM entry once saved.`)) nav(`/bookings/new?entry=${e.id}`)
  }
  const RowActions = ({ e }: { e: ClientEntry }) => (
    <span className="inline-flex flex-wrap justify-end gap-1">
      {e.status === 'CONVERTED'
        ? e.bookingId && <Button size="sm" variant="ghost" icon={Briefcase} onClick={() => nav(`/bookings/${e.bookingId}`)}>CRM entry</Button>
        : <>
          {mayMessage(db, me, { kind: 'entry', e }) && <Button size="sm" variant="ghost" icon={MessageCircle} title="WhatsApp / email the client" aria-label={`Message ${e.clientName}`} onClick={() => setMsg(e.id)} />}
          {canEditClientEntry(me, e) && <Button size="sm" variant="ghost" icon={Pencil} title="Edit" aria-label={`Edit ${e.clientName}`} onClick={() => setOpen({ id: e.id, follow: false, edit: true })} />}
          <Button size="sm" variant="ghost" icon={CalendarClock} title="Add follow-up" aria-label={`Follow-up ${e.clientName}`} onClick={() => setOpen({ id: e.id, follow: true })} />
          {e.ownerId === me.id && e.status !== 'NOT_INTERESTED' && can('bookings.create') && <Button size="sm" variant="soft" icon={Briefcase} title="Convert to CRM entry (payment received)" onClick={() => convert(e)}>Convert</Button>}
        </>}
    </span>
  )
  const status = (e: ClientEntry) => <Badge tone={CLIENT_ENTRY_STATUS[e.status].tone}>{CLIENT_ENTRY_STATUS[e.status].label}</Badge>
  const followUp = (e: ClientEntry) => e.followUp
    ? <span className={cx(followUpDue(e, t) && 'font-bold text-bad')}>Follow-up {fmtDate(e.followUp)}</span>
    : e.followUps.length > 0 ? <span>{e.followUps.length} follow-up{e.followUps.length > 1 ? 's' : ''} done</span> : null
  const owner = (e: ClientEntry) => (e.ownerId === me.id ? 'Me' : userName(db, e.ownerId))
  return (
    <>
      <div className="flex flex-wrap items-end gap-2 border-b border-line px-5 py-3">
        <Tabs value={view} onChange={setView} tabs={[
          { id: 'open', label: 'Open', count: counts.open }, { id: 'due', label: 'Follow-ups due', count: counts.due },
          { id: 'converted', label: 'Converted', count: counts.converted }, { id: 'all', label: 'All', count: counts.all },
        ]} />
        {full && <span className="flex items-end gap-2">
          <Input label="Entered from" type="date" value={from} max={to || today()} onChange={(e) => setFrom(e.target.value)} />
          <Input label="to" type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} />
        </span>}
        <label className="relative ml-auto w-full sm:w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mute" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client, company, number" aria-label="Search client entries"
            className="h-9 w-full rounded-xl border border-line bg-card pl-9 pr-3 text-sm outline-none focus:border-brand" />
        </label>
        {full && <Button size="sm" variant="outline" icon={Download} disabled={!rows.length} onClick={download}>Download CSV</Button>}
      </div>
      {!rows.length ? <EmptyState icon={ClipboardList} title={all.length ? 'Nothing here' : 'No client entries yet'} text={all.length ? undefined : 'Add a client entry, or fill it in the dialer while you are on the call.'} /> : <>
        {/* phones: one card per entry */}
        <ul className="divide-y divide-line/70 md:hidden">
          {rows.map((e) => (
            <li key={e.id} className="space-y-1.5 px-4 py-3">
              <div className="flex items-start gap-2">
                <button onClick={() => setOpen({ id: e.id, follow: false })} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-semibold">{e.clientName}</span>
                  <span className="block truncate text-xs text-mute">{e.companyName} · <span className="font-mono">{seesMaskedPhones(me) ? maskPhone(e.phone) : e.phone}</span></span>
                </button>
                {status(e)}
              </div>
              <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-mute">
                <span className="min-w-0 truncate">{e.scheme}</span><span className="font-semibold tabular-nums text-ink">{inr(e.pitchedPrice)}</span><span>{fmtDate(e.date)}</span>{followUp(e)}
              </p>
              {full && <p className="line-clamp-2 text-xs">{e.requirement}</p>}
              {lead && <p className="text-xs text-mute">Sales person: {owner(e)}</p>}
              <div className="flex justify-end"><RowActions e={e} /></div>
            </li>
          ))}
        </ul>
        {/* tablet and desktop: a table that fits the width — no sideways scrolling; less important columns appear on wider screens */}
        <div className="hidden md:block">
          <table className="w-full table-fixed text-sm">
            <thead><tr>
              <Th>Client</Th><Th className="w-[24%]">Scheme · pitched price</Th><Th className="w-40">Status</Th>
              {full && <Th className="hidden w-[26%] xl:table-cell">Requirement · note</Th>}
              {full && <Th className="hidden w-28 lg:table-cell">Entered on</Th>}
              {lead && <Th className="hidden w-32 lg:table-cell">Sales person</Th>}
              <Th className="w-44 text-right">Actions</Th>
            </tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="align-top hover:bg-card2/50">
                  <Td>
                    <button onClick={() => setOpen({ id: e.id, follow: false })} className="block max-w-full truncate text-left font-semibold hover:underline">{e.clientName}</button>
                    <span className="block truncate text-xs text-mute">{e.companyName}</span>
                    <span className="block font-mono text-[11px] text-mute">{seesMaskedPhones(me) ? maskPhone(e.phone) : e.phone}</span>
                  </Td>
                  <Td><span className="line-clamp-2 text-xs">{e.scheme}</span><span className="block font-semibold tabular-nums">{inr(e.pitchedPrice)}</span></Td>
                  <Td>{status(e)}<span className="mt-1 block text-[11px] text-mute">{fmtDate(e.date)}</span><span className="block text-[11px] text-mute">{followUp(e)}</span></Td>
                  {full && <Td className="hidden xl:table-cell"><span className="line-clamp-2 text-xs" title={e.requirement}>{e.requirement}</span><span className="mt-0.5 line-clamp-2 text-[11px] text-mute" title={e.note}>{e.followUps[0] ? `Last follow-up: ${e.followUps[0].note}` : e.note}</span></Td>}
                  {full && <Td className="hidden text-xs lg:table-cell">{fmtDate(e.createdAt)}<span className="block text-mute">{fmtTime(e.createdAt)}</span></Td>}
                  {lead && <Td className="hidden truncate text-xs lg:table-cell">{owner(e)}</Td>}
                  <Td className="text-right"><RowActions e={e} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
      <Modal open={!!cur} onClose={() => setOpen(null)} size="lg" title={cur ? `${open?.edit ? 'Edit · ' : ''}${cur.clientName} · ${cur.companyName}` : ''} subtitle={cur ? `Client entry · ${cur.scheme}` : undefined}
        footer={cur && !open?.edit && cur.status !== 'CONVERTED' && cur.ownerId === me.id && cur.status !== 'NOT_INTERESTED' && can('bookings.create') ? <Button variant="soft" icon={Briefcase} onClick={() => { setOpen(null); convert(cur) }}>Convert to CRM entry</Button> : undefined}>
        {cur && (open?.edit && canEditClientEntry(me, cur) ? <ClientEntryFormView key={cur.id} entry={cur} onSaved={() => setOpen({ id: cur.id, follow: false })} /> : (
          <div className="space-y-5">
            {cur.status !== 'CONVERTED' && open?.follow && <div className="rounded-2xl border border-line p-4"><h4 className="mb-3 font-bold">Add follow-up</h4><ClientFollowUpForm entry={cur} onDone={() => setOpen({ id: cur.id, follow: false })} /></div>}
            <EntryDetails entry={cur} />
            {cur.status !== 'CONVERTED' && !open?.follow && <div className="flex flex-wrap gap-2">
              <Button variant="outline" icon={CalendarClock} onClick={() => setOpen({ id: cur.id, follow: true })}>Add follow-up</Button>
              {canEditClientEntry(me, cur) && <Button variant="outline" icon={Pencil} onClick={() => setOpen({ id: cur.id, follow: false, edit: true })}>Edit entry</Button>}
              {mayMessage(db, me, { kind: 'entry', e: cur }) && <Button variant="outline" icon={MessageCircle} onClick={() => setMsg(cur.id)}>Message client</Button>}
            </div>}
            <div className="rounded-2xl border border-line"><h4 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-bold"><MessageCircle className="size-4" />Messages to the client</h4><MessageLog target={{ kind: 'entry', e: cur }} compact /></div>
          </div>
        ))}
      </Modal>
      {msg && (() => { const e = all.find((x) => x.id === msg); return e ? <MessageClientModal target={{ kind: 'entry', e }} stage="WELCOME" onClose={() => setMsg(null)} /> : null })()}
      {confirmNode}
    </>
  )
}

/**
 * The two buttons of the Client Entries section: "Add Client Entry" opens the client entry form right here, and
 * "CRM Entries" opens the CRM entry form (for a sales person: pick the client entry to convert).
 */
export function ClientEntryButtons({ size = 'md', crm = true }: { size?: 'sm' | 'md'; crm?: boolean }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const nav = useNavigate()
  const [adding, setAdding] = useState(false)
  // right after a new entry is saved: the welcome message for the client, ready to review and send
  const [welcome, setWelcome] = useState<string | null>(null)
  const saved = welcome ? (db.clientEntries ?? []).find((x) => x.id === welcome) : undefined
  return (
    <>
      {canMakeClientEntry(db, me) && <Button size={size} variant="accent" icon={Plus} onClick={() => setAdding(true)}>Add Client Entry</Button>}
      {crm && can('bookings.create') && <Button size={size} variant="outline" icon={Briefcase} onClick={() => nav('/bookings/new')}>CRM Entries</Button>}
      <Modal open={adding} onClose={() => setAdding(false)} size="lg" title="Add client entry" subtitle="Every field but the follow-up is compulsory · convert it to a CRM entry once the payment is received">
        {adding && <ClientEntryFormView onSaved={(id) => { setAdding(false); setWelcome(id) }} />}
      </Modal>
      {saved && mayMessage(db, me, { kind: 'entry', e: saved }) && <MessageClientModal target={{ kind: 'entry', e: saved }} stage="WELCOME" onClose={() => setWelcome(null)} />}
    </>
  )
}

/**
 * The dialer's client entry for one lead: the form while there is none, else the open entry with a follow-up form
 * (one open entry per client). Used in the call window, and in a window of its own after the call.
 */
export function ClientEntryForLead({ lead, compact, onSaved }: { lead: Lead; compact?: boolean; onSaved?: () => void }) {
  const db = useDb()
  const entry = openEntryForLead(db, lead.id)
  if (!entry) return <ClientEntryFormView key={lead.id} lead={lead} compact={compact} onSaved={onSaved} />
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-card2 p-3 text-sm">
        <p className="flex flex-wrap items-center gap-2 font-semibold">Client entry · {fmtDate(entry.date)} <Badge tone={CLIENT_ENTRY_STATUS[entry.status].tone}>{CLIENT_ENTRY_STATUS[entry.status].label}</Badge></p>
        <p className="text-xs text-mute">{entry.companyName} · {entry.scheme} · pitched {inr(entry.pitchedPrice)}{entry.followUp ? ` · follow-up ${fmtDate(entry.followUp)}` : ''}</p>
        <p className="mt-1 line-clamp-2 text-xs">{entry.requirement}</p>
      </div>
      <p className="text-xs font-bold uppercase tracking-wide text-mute">Add follow-up</p>
      <ClientFollowUpForm key={entry.id} entry={entry} onDone={onSaved} />
      <p className="text-xs text-mute">Convert it to the CRM entry from your dashboard → Client entries, once the payment is received.</p>
    </div>
  )
}
