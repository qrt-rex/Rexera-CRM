import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Activity, Ban, CheckCircle2, Link2, LogOut, Mail, Send, ShieldCheck, TrendingUp, UserPlus, UserRoundCheck, Users } from 'lucide-react'
import type { Booking, ClientAccount } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth } from '../../lib/auth'
import { CLOUD } from '../../lib/cloud'
import { clientDocState, portalAdmin, userName } from '../../lib/actions'
import { ServerError } from '../../lib/serverApi'
import { ago, fmtDateTime, isEmail } from '../../lib/format'
import { BOOKING_STATUS, STAGES } from '../../lib/workflow'
import { ADMIN_STAGES } from '../../../supabase/workflow-rules.mjs'
import { Badge, Button, Card, CardHeader, Checkbox, cx, EmptyState, Input, Modal, PageHeader, SearchBox, Select, Stat, Table, Tabs, Td, Th, useConfirm, useToast } from '../../components/ui'

const STATUS = { ACTIVE: { label: 'Active', tone: 'green' }, INVITED: { label: 'Invited', tone: 'amber' }, DISABLED: { label: 'Deactivated', tone: 'red' } } as const
const ACTION_LABEL: Record<string, string> = {
  INVITED: 'Invited', ACTIVATED: 'Set password — active', SIGNED_IN: 'Signed in', UPLOADED: 'Uploaded', PROFILE: 'Profile changed', REQUEST: 'Message to the team', ACCESS_RESET: 'Reset link sent',
  APPROVED: 'Approved', DEACTIVATED: 'Deactivated', SESSIONS_REVOKED: 'Signed out everywhere', LINKED: 'Entries linked', ASSIGNED: 'Team member',
}
type Invite = { bookingIds: string[]; email: string; name: string; assignedTo: string; override: boolean; mismatch?: string }

/** Super Admin: client portal accounts — invite, link CRM entries, approve / deactivate, reset access, sign out, assign; activity log. */
export default function ClientPortal() {
  const db = useDb()
  const { can } = useAuth()
  const toast = useToast()
  const [confirm, confirmNode] = useConfirm()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<'progress' | 'accounts' | 'activity'>('progress')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'' | ClientAccount['status']>('')
  const [busy, setBusy] = useState('')
  const accounts = db.clientAccounts ?? []
  const byId = useMemo(() => new Map(db.bookings.map((b) => [b.id, b])), [db.bookings])
  const staff = db.users.filter((u) => u.active)
  const linked = new Set(accounts.flatMap((a) => a.bookingIds))
  const fromEntry = (b?: Booking): Invite => ({ bookingIds: b ? [b.id] : [], email: b?.email || b?.paymentEmail || '', name: b?.contactPerson ?? '', assignedTo: b?.opsMemberId ?? '', override: false })
  const [invite, setInvite] = useState<Invite | null>(() => { const b = byId.get(params.get('invite') ?? ''); return b ? fromEntry(b) : null })
  const [linkFor, setLinkFor] = useState<{ acct: ClientAccount; ids: string[]; override: boolean; mismatch?: string } | null>(null)
  const [logFor, setLogFor] = useState<ClientAccount | null>(null)
  const [entryQ, setEntryQ] = useState('')

  const call = async (key: string, action: Parameters<typeof portalAdmin>[0], body: Record<string, unknown>, ok?: string) => {
    setBusy(key)
    try {
      const r = await portalAdmin(action, body)
      toast('success', r.message || ok || 'Done')
      return { ok: true as const }
    } catch (e) {
      if (e instanceof ServerError && e.code === 'EMAIL_MISMATCH') return { ok: false as const, mismatch: e.message }
      toast('error', e instanceof Error ? e.message : String(e))
      return { ok: false as const }
    } finally { setBusy('') }
  }

  const ql = q.trim().toLowerCase()
  const shown = accounts.filter((a) => (!status || a.status === status) && (!ql || `${a.name} ${a.email} ${a.phone ?? ''} ${a.bookingIds.map((id) => `${byId.get(id)?.bookingId} ${byId.get(id)?.companyName}`).join(' ')}`.toLowerCase().includes(ql)))
  const activity = [...(db.clientActivity ?? [])].sort((x, y) => y.at.localeCompare(x.at))
  const acctOf = new Map(accounts.map((a) => [a.id, a]))
  const eq = entryQ.trim().toLowerCase()
  const entryOptions = (keep: string[], acctId?: string) => db.bookings.filter((b) => keep.includes(b.id) || ((!linked.has(b.id) || accounts.find((a) => a.id === acctId)?.bookingIds.includes(b.id)) && (!eq || `${b.bookingId} ${b.companyName} ${b.contactPerson} ${b.email}`.toLowerCase().includes(eq)))).slice(0, 60)
  const mayManage = can('portal.manage')

  return (
    <div>
      <PageHeader title="Client Portal" subtitle="Clients sign in with email and password after your invite, and see only their own projects, documents and updates" icon={UserRoundCheck}
        actions={mayManage && <Button icon={UserPlus} onClick={() => { setEntryQ(''); setInvite(fromEntry()) }}>Invite a client</Button>} />
      {!CLOUD && <p className="mb-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">The client portal works on the live CRM (connected to Supabase) — invites, sign-in and uploads go through the live server.</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Portal accounts" value={accounts.length} icon={Users} onClick={() => setStatus('')} />
        <Stat label="Active" value={accounts.filter((a) => a.status === 'ACTIVE').length} icon={CheckCircle2} tone="green" onClick={() => setStatus('ACTIVE')} />
        <Stat label="Invited (not signed in)" value={accounts.filter((a) => a.status === 'INVITED').length} icon={Mail} tone="amber" onClick={() => setStatus('INVITED')} />
        <Stat label="Deactivated" value={accounts.filter((a) => a.status === 'DISABLED').length} icon={Ban} tone="red" onClick={() => setStatus('DISABLED')} />
      </div>

      <Tabs className="mb-5 w-fit max-w-full" value={tab} onChange={setTab} tabs={[
        { id: 'progress', label: 'Progress', icon: TrendingUp, count: accounts.length }, { id: 'accounts', label: 'Accounts', icon: Users, count: accounts.length },
        { id: 'activity', label: 'Activity log', icon: Activity, count: activity.length },
      ]} />

      {tab === 'progress' && <Progress onActivity={setLogFor} />}

      {tab === 'accounts' && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            <SearchBox value={q} onChange={setQ} placeholder="Search client, email or entry…" className="min-w-56 flex-1" />
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-44"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INVITED">Invited</option><option value="DISABLED">Deactivated</option></Select>
          </div>
          {!shown.length ? <EmptyState icon={UserRoundCheck} title={accounts.length ? 'No account matches' : 'No client has portal access yet'} text={accounts.length ? undefined : 'Invite a client: they get an email to set their password.'} /> : (
            <Table>
              <thead><tr><Th>Client</Th><Th>CRM entries</Th><Th>Status</Th><Th>Team member</Th><Th>Last sign-in</Th><Th className="text-right">Access</Th></tr></thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id}>
                    <Td><b className="text-sm">{a.name}</b><span className="block text-[11px] text-mute">{a.email}{a.phone ? ` · ${a.phone}` : ''}</span><span className="block text-[11px] text-mute">Invited {fmtDateTime(a.invitedAt)} by {userName(db, a.invitedBy)}</span></Td>
                    <Td>{a.bookingIds.map((id) => { const b = byId.get(id); return b ? <Link key={id} to={`/bookings/${id}?tab=workflow`} className="block text-xs font-semibold hover:underline">{b.bookingId} · {b.companyName}</Link> : <span key={id} className="block text-xs text-mute">{id}</span> })}</Td>
                    <Td><Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge></Td>
                    <Td>{mayManage
                      ? <Select aria-label={`Team member for ${a.name}`} value={a.assignedTo ?? ''} disabled={busy === `as-${a.id}`} onChange={(e) => call(`as-${a.id}`, 'assign', { accountId: a.id, userId: e.target.value || null }, 'Team member saved')} className="w-44"><option value="">— None —</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
                      : userName(db, a.assignedTo)}</Td>
                    <Td className="text-xs">{a.lastLoginAt ? fmtDateTime(a.lastLoginAt) : <span className="text-mute">never</span>}</Td>
                    <Td className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="ghost" icon={Activity} onClick={() => setLogFor(a)}>Activity</Button>
                        {mayManage && <>
                          <Button size="sm" variant="ghost" icon={Link2} onClick={() => { setEntryQ(''); setLinkFor({ acct: a, ids: a.bookingIds, override: false }) }}>Entries</Button>
                          {a.status !== 'DISABLED' && <Button size="sm" variant="ghost" icon={Send} loading={busy === `sl-${a.id}`} onClick={() => call(`sl-${a.id}`, 'send-link', { accountId: a.id })}>{a.activatedAt ? 'Reset access' : 'Send invite again'}</Button>}
                          {a.authUserId && a.status !== 'INVITED' && <Button size="sm" variant="ghost" icon={LogOut} loading={busy === `rv-${a.id}`} onClick={async () => { if (await confirm('Sign out everywhere?', `${a.name} is signed out on every device and must sign in again.`)) call(`rv-${a.id}`, 'revoke', { accountId: a.id }, 'Signed out everywhere') }}>Sign out</Button>}
                          {a.status === 'DISABLED'
                            ? <Button size="sm" variant="outline" icon={ShieldCheck} loading={busy === `st-${a.id}`} onClick={() => call(`st-${a.id}`, 'status', { accountId: a.id, active: true }, 'Access approved')}>Approve</Button>
                            : <Button size="sm" variant="outline" icon={Ban} loading={busy === `st-${a.id}`} onClick={async () => { if (await confirm('Deactivate portal access?', `${a.name} is signed out at once and can't sign in until you approve them again. Their data stays.`, true)) call(`st-${a.id}`, 'status', { accountId: a.id, active: false }, 'Access deactivated') }}>Deactivate</Button>}
                        </>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'activity' && (
        <Card className="overflow-hidden">
          <CardHeader title="Activity log" icon={Activity} subtitle="Invites, sign-ins, uploads, profile changes and access changes" />
          {!activity.length ? <EmptyState icon={Activity} title="Nothing yet" /> : (
            <Table>
              <thead><tr><Th>When</Th><Th>Client</Th><Th>What</Th><Th>Details</Th><Th>By</Th></tr></thead>
              <tbody>{activity.slice(0, 500).map((x) => (
                <tr key={x.id}><Td className="whitespace-nowrap text-xs">{fmtDateTime(x.at)}</Td><Td className="text-sm">{acctOf.get(x.accountId)?.name ?? '—'}</Td><Td><Badge tone="gray">{ACTION_LABEL[x.action] ?? x.action}</Badge></Td><Td className="text-xs">{x.detail}</Td><Td className="text-xs">{x.by ? userName(db, x.by) : 'Client'}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      )}

      {/* ------------------------------------------------------------ invite */}
      <Modal open={!!invite} onClose={() => { setInvite(null); if (params.has('invite')) setParams({}) }} title="Invite a client to the portal" subtitle="They get an email with a link to set their password" size="md"
        footer={<><Button variant="outline" onClick={() => setInvite(null)}>Cancel</Button><Button icon={Send} loading={busy === 'invite'} disabled={!invite || !invite.bookingIds.length || !isEmail(invite.email) || (!!invite.mismatch && !invite.override)} onClick={async () => {
          if (!invite) return
          const r = await call('invite', 'invite', { bookingIds: invite.bookingIds, email: invite.email.trim(), name: invite.name.trim(), assignedTo: invite.assignedTo || undefined, override: invite.override })
          if (r.ok) { setInvite(null); setParams({}) } else if (r.mismatch) setInvite({ ...invite, mismatch: r.mismatch })
        }}>Send invite</Button></>}>
        {invite && <div className="grid gap-3">
          <EntryPicker options={entryOptions(invite.bookingIds)} q={entryQ} setQ={setEntryQ} picked={invite.bookingIds} byId={byId}
            onChange={(ids) => { const first = byId.get(ids[0] ?? ''); setInvite({ ...invite, bookingIds: ids, ...(!invite.bookingIds.length && first ? { email: first.email || first.paymentEmail || '', name: first.contactPerson, assignedTo: first.opsMemberId ?? '' } : {}), mismatch: undefined, override: false }) }} />
          <Input label="Client email (their sign-in)" type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value, mismatch: undefined, override: false })} hint="Must be the email saved on the CRM entry — one account per email" />
          <Input label="Name" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
          <Select label="Team member (client's contact)" value={invite.assignedTo} onChange={(e) => setInvite({ ...invite, assignedTo: e.target.value })}><option value="">— Operation team member of the entry —</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          {invite.mismatch && <div className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn"><p>{invite.mismatch}</p><div className="mt-2"><Checkbox checked={invite.override} onChange={(v) => setInvite({ ...invite, override: v })} label={<span className="text-xs">I checked — this is the client’s email</span>} /></div></div>}
        </div>}
      </Modal>

      {/* ------------------------------------------------------------ link entries */}
      <Modal open={!!linkFor} onClose={() => setLinkFor(null)} title={linkFor ? `CRM entries for ${linkFor.acct.name}` : ''} subtitle="The client sees only these entries. An entry can belong to one account." size="md"
        footer={<><Button variant="outline" onClick={() => setLinkFor(null)}>Cancel</Button><Button icon={Link2} loading={busy === 'link'} disabled={!linkFor?.ids.length || (!!linkFor?.mismatch && !linkFor.override)} onClick={async () => {
          if (!linkFor) return
          const r = await call('link', 'link', { accountId: linkFor.acct.id, bookingIds: linkFor.ids, override: linkFor.override }, 'Entries saved')
          if (r.ok) setLinkFor(null); else if (r.mismatch) setLinkFor({ ...linkFor, mismatch: r.mismatch })
        }}>Save</Button></>}>
        {linkFor && <div className="grid gap-3">
          <EntryPicker options={entryOptions(linkFor.ids, linkFor.acct.id)} q={entryQ} setQ={setEntryQ} picked={linkFor.ids} byId={byId} onChange={(ids) => setLinkFor({ ...linkFor, ids, mismatch: undefined, override: false })} />
          {linkFor.mismatch && <div className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn"><p>{linkFor.mismatch}</p><div className="mt-2"><Checkbox checked={linkFor.override} onChange={(v) => setLinkFor({ ...linkFor, override: v })} label={<span className="text-xs">I checked — these entries belong to this client</span>} /></div></div>}
        </div>}
      </Modal>

      {/* ------------------------------------------------------------ one account's activity */}
      <Modal open={!!logFor} onClose={() => setLogFor(null)} title={logFor ? `Activity · ${logFor.name}` : ''} size="lg">
        {logFor && <ul className="divide-y divide-line/70 text-sm">
          {activity.filter((x) => x.accountId === logFor.id).map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 py-2"><span className="w-36 text-xs text-mute">{fmtDateTime(x.at)}</span><Badge tone="gray">{ACTION_LABEL[x.action] ?? x.action}</Badge><span className="min-w-0 flex-1 text-xs">{x.detail}</span><span className="text-xs text-mute">{x.by ? userName(db, x.by) : 'Client'}</span></li>
          ))}
          {!activity.some((x) => x.accountId === logFor.id) && <li className="py-4 text-center text-mute">Nothing yet.</li>}
        </ul>}
      </Modal>
      {confirmNode}
    </div>
  )
}

const DOC: Record<string, { label: string; tone: 'gray' | 'amber' | 'blue' | 'violet' | 'green' | 'red' }> = {
  PENDING_UPLOAD: { label: 'waiting for client', tone: 'amber' }, RESUBMISSION: { label: 'asked again', tone: 'red' }, SUBMITTED: { label: 'uploaded — to check', tone: 'blue' },
  UNDER_REVIEW: { label: 'under review', tone: 'violet' }, APPROVED: { label: 'approved', tone: 'green' },
}
type Show = 'all' | 'week' | 'never' | 'waiting' | 'review'

/**
 * Every client who logs in from the website, and how far their work has got: sign-ins, uploads, each CRM entry's
 * status and stage, the documents asked for (waiting / to check / approved), milestones and updates. Read-only for the
 * Operation team, Admin and IT; Super Admin manages access on the Accounts tab.
 */
function Progress({ onActivity }: { onActivity: (a: ClientAccount) => void }) {
  const db = useDb()
  const [q, setQ] = useState('')
  const [show, setShow] = useState<Show>('all')
  const byId = useMemo(() => new Map(db.bookings.map((b) => [b.id, b])), [db.bookings])
  const acts = db.clientActivity ?? []
  const week = Date.now() - 7 * 86400000
  const rows = (db.clientAccounts ?? []).map((a) => {
    const mine = acts.filter((x) => x.accountId === a.id).sort((x, y) => y.at.localeCompare(x.at))
    const files = a.bookingIds.map((id) => byId.get(id)).filter(Boolean) as Booking[]
    const docs = files.flatMap((b) => ADMIN_STAGES.map((s) => ({ b, s, st: clientDocState(b, s.id) })).filter((x) => x.st))
    return {
      a, files, docs, last: mine[0], signIns: mine.filter((x) => x.action === 'SIGNED_IN').length, uploads: mine.filter((x) => x.action === 'UPLOADED').length,
      waiting: docs.filter((x) => x.st === 'PENDING_UPLOAD' || x.st === 'RESUBMISSION').length, review: docs.filter((x) => x.st === 'SUBMITTED' || x.st === 'UNDER_REVIEW').length,
      approved: docs.filter((x) => x.st === 'APPROVED').length,
    }
  }).sort((x, y) => (y.last?.at ?? y.a.invitedAt).localeCompare(x.last?.at ?? x.a.invitedAt))
  const ql = q.trim().toLowerCase()
  const shown = rows.filter((r) => (show === 'all' || (show === 'week' ? !!r.a.lastLoginAt && new Date(r.a.lastLoginAt).getTime() >= week : show === 'never' ? !r.a.lastLoginAt : show === 'waiting' ? r.waiting > 0 : r.review > 0))
    && (!ql || `${r.a.name} ${r.a.email} ${r.a.phone ?? ''} ${r.files.map((b) => `${b.bookingId} ${b.companyName}`).join(' ')}`.toLowerCase().includes(ql)))
  const count = (s: Show) => rows.filter((r) => (s === 'week' ? !!r.a.lastLoginAt && new Date(r.a.lastLoginAt).getTime() >= week : s === 'never' ? !r.a.lastLoginAt : s === 'waiting' ? r.waiting > 0 : s === 'review' ? r.review > 0 : true)).length

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs className="w-fit max-w-full" value={show} onChange={setShow} tabs={[
          { id: 'all', label: 'All', count: count('all') }, { id: 'week', label: 'Signed in this week', count: count('week') }, { id: 'never', label: 'Never signed in', count: count('never') },
          { id: 'waiting', label: 'Waiting on client', count: count('waiting') }, { id: 'review', label: 'Documents to check', count: count('review') },
        ]} />
        <SearchBox value={q} onChange={setQ} placeholder="Search client, email or entry…" className="min-w-56 flex-1" />
      </div>
      {!shown.length ? <Card><EmptyState icon={TrendingUp} title={rows.length ? 'Nothing matches' : 'No client has portal access yet'} text={rows.length ? undefined : 'Clients appear here once the Super Admin invites them; they log in from the website.'} /></Card> : (
        <div className="grid gap-4 xl:grid-cols-2">
          {shown.map(({ a, files, docs, last, signIns, uploads, waiting, review, approved }) => (
            <Card key={a.id} className="overflow-hidden">
              <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2"><b>{a.name}</b><Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge></p>
                  <p className="truncate text-xs text-mute">{a.email}{a.phone ? ` · ${a.phone}` : ''}{a.assignedTo ? ` · team member ${userName(db, a.assignedTo)}` : ''}</p>
                </div>
                <Button size="sm" variant="ghost" icon={Activity} onClick={() => onActivity(a)}>Activity</Button>
              </div>
              <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
                {[
                  ['Last sign-in', a.lastLoginAt ? ago(a.lastLoginAt) : 'never'], ['Sign-ins', signIns], ['Uploads', uploads],
                  ['Last activity', last ? `${ACTION_LABEL[last.action] ?? last.action} · ${ago(last.at)}` : '—'],
                ].map(([k, v]) => <div key={String(k)} className="bg-card px-3 py-2"><p className="text-[10px] font-semibold uppercase text-mute">{k}</p><p className="truncate text-sm font-semibold">{v}</p></div>)}
              </div>
              <div className="space-y-3 px-4 py-3">
                {!files.length && <p className="text-xs text-mute">No CRM entry you can see is linked to this login.</p>}
                {files.map((b) => {
                  const ms = (b.milestones ?? []).filter((m) => m.visible)
                  const mine = docs.filter((x) => x.b.id === b.id)
                  return (
                    <div key={b.id} className="rounded-xl border border-line p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/bookings/${b.id}?tab=workflow`} className="min-w-0 flex-1 truncate text-sm font-bold hover:underline">{b.bookingId} · {b.companyName}</Link>
                        <Badge tone={BOOKING_STATUS[b.status].tone}>{BOOKING_STATUS[b.status].label}</Badge>
                      </div>
                      <div className="mt-2">
                        <div className="mb-1 flex justify-between text-[11px] text-mute"><span>Stage {b.stage} of {STAGES.length} · {STAGES[b.stage - 1]}</span><span>{Math.round((b.stage / STAGES.length) * 100)}%</span></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-card2"><div className="h-full rounded-full bg-brand" style={{ width: `${(b.stage / STAGES.length) * 100}%` }} /></div>
                      </div>
                      {mine.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{mine.map((x) => <Badge key={x.s.id} tone={DOC[x.st!]?.tone ?? 'gray'}>{x.s.short}: {DOC[x.st!]?.label ?? x.st}</Badge>)}</div>}
                      <p className="mt-2 text-[11px] text-mute">{ms.length ? `Milestones ${ms.filter((m) => m.status === 'DONE').length}/${ms.length} done` : 'No milestones shared yet'} · {(b.clientUpdates ?? []).length} update(s) sent</p>
                    </div>
                  )
                })}
              </div>
              {(waiting > 0 || review > 0 || approved > 0) && (
                <p className="flex flex-wrap gap-3 border-t border-line px-4 py-2 text-[11px] font-semibold">
                  {waiting > 0 && <span className="text-warn">{waiting} waiting for the client</span>}{review > 0 && <span className="text-info">{review} to check</span>}{approved > 0 && <span className="text-ok">{approved} approved</span>}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function EntryPicker({ options, q, setQ, picked, byId, onChange }: { options: Booking[]; q: string; setQ: (v: string) => void; picked: string[]; byId: Map<string, Booking>; onChange: (ids: string[]) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold">CRM entries <span className="font-normal text-mute">· {picked.length} picked</span></p>
      {picked.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{picked.map((id) => <Badge key={id} tone="blue">{byId.get(id)?.bookingId ?? id} · {byId.get(id)?.companyName}<button type="button" aria-label="Remove" className="ml-1" onClick={() => onChange(picked.filter((x) => x !== id))}>×</button></Badge>)}</div>}
      <SearchBox value={q} onChange={setQ} placeholder="Find an entry by code, company, person or email…" />
      <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-line">
        {options.filter((b) => !picked.includes(b.id)).map((b) => (
          <button key={b.id} type="button" onClick={() => onChange([...picked, b.id])} className={cx('flex w-full items-center gap-2 border-b border-line/60 px-3 py-2 text-left text-xs last:border-0 hover:bg-card2')}>
            <span className="font-mono font-semibold">{b.bookingId}</span><span className="min-w-0 flex-1 truncate">{b.companyName} · {b.contactPerson}</span><span className="truncate text-mute">{b.email}</span>
          </button>
        ))}
        {!options.some((b) => !picked.includes(b.id)) && <p className="px-3 py-3 text-xs text-mute">No free entry matches (an entry already linked to another account isn’t listed).</p>}
      </div>
    </div>
  )
}
