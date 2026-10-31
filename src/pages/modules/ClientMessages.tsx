import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, FileText, Mail, MessageCircle, RotateCcw, Save, Settings2, TriangleAlert, Users } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { CLOUD } from '../../lib/cloud'
import { roleLabel } from '../../lib/rbac'
import { DEFAULT_TEMPLATES, mayEditTemplates, resetTemplate, saveTemplate, templatesOf } from '../../lib/clientMessages'
import { fmtDateTime } from '../../lib/format'
import { fillMessage, MESSAGE_STAGES, MESSAGE_STATUS, PLACEHOLDERS, type MessageStageId, type MessageTemplate } from '../../../supabase/message-rules.mjs'
import { Badge, Button, Card, CardHeader, cx, EmptyState, Input, PageHeader, SearchBox, Select, Tabs, Textarea, useConfirm, useRun, useSubmitting } from '../../components/ui'
import { LogRow } from '../../components/ClientMessage'

type Tab = 'templates' | 'log' | 'setup'
const SAMPLE = { client_name: 'Asha Mehta', company: 'Asha Foods Pvt Ltd', application_no: 'RX-2026-000123', status: 'With Operations', stage: '3. Document In-process / In-review', service: 'PMEGP Loan Assistance', team_member: 'Sneha Patel', team_phone: '98765 43210', our_company: 'Rexera' }

/**
 * Client Messages (Operation Team, Admin, Super Admin, IT): the WhatsApp and email templates every team sends from,
 * every message sent to clients, and whether WhatsApp / email are connected on the server.
 */
export default function ClientMessages() {
  const db = useDb()
  const me = useMe()
  const [tab, setTab] = useState<Tab>('templates')
  if (!mayEditTemplates(me)) return <Card><EmptyState icon={MessageCircle} title="Only the Operation Team and Admin manage client messages" text="Send your team’s messages from the CRM entry or client entry." /></Card>
  return (
    <div>
      <PageHeader title="Client Messages" icon={MessageCircle}
        subtitle="WhatsApp and email templates each team sends to clients, and every message sent. Teams review and edit each message before sending." />
      <Tabs className="mb-5 w-fit max-w-full" value={tab} onChange={setTab} tabs={[
        { id: 'templates', label: 'Templates', icon: FileText, count: MESSAGE_STAGES.length }, { id: 'log', label: 'Message log', icon: MessageCircle, count: (db.clientMessages ?? []).length },
        { id: 'setup', label: 'WhatsApp & email setup', icon: Settings2 },
      ]} />
      {tab === 'templates' && <Templates />}
      {tab === 'log' && <Log />}
      {tab === 'setup' && <Setup />}
    </div>
  )
}

function Templates() {
  const db = useDb()
  const [pick, setPick] = useState<MessageStageId>('WELCOME')
  const tpls = templatesOf(db)
  const saved = db.settings.clientTemplates ?? {}
  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="h-fit overflow-hidden">
        <ul className="divide-y divide-line/70">
          {MESSAGE_STAGES.map((s) => (
            <li key={s.id}><button type="button" onClick={() => setPick(s.id)} className={cx('w-full px-4 py-3 text-left transition', pick === s.id ? 'bg-brand-soft' : 'hover:bg-card2')}>
              <span className="flex items-center gap-2 text-sm font-bold">{s.label}{saved[s.id] && <Badge tone="blue">edited</Badge>}</span>
              <span className="block text-[11px] text-mute">{s.teams.map((t) => roleLabel(t as never)).join(' · ')}</span>
            </button></li>
          ))}
        </ul>
      </Card>
      <Editor key={pick} stage={pick} tpl={tpls[pick]} edited={saved[pick]} />
    </div>
  )
}

function Editor({ stage, tpl, edited }: { stage: MessageStageId; tpl: MessageTemplate; edited?: { updatedAt?: string; updatedBy?: string } }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const [busy, once] = useSubmitting()
  const [f, setF] = useState(tpl)
  const s = MESSAGE_STAGES.find((x) => x.id === stage)!
  const dirty = f.subject !== tpl.subject || f.email !== tpl.email || f.whatsapp !== tpl.whatsapp
  const [focus, setFocus] = useState<keyof MessageTemplate>('email')
  const insert = (p: string) => setF((x) => ({ ...x, [focus]: `${x[focus]}{${p}}` }))
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader title={s.label} subtitle={`${s.desc} · sent by: ${s.teams.map((t) => roleLabel(t as never)).join(', ')} (and Super Admin / IT)`} icon={Users}
          action={edited && <span className="text-[11px] text-mute">edited {edited.updatedAt ? fmtDateTime(edited.updatedAt) : ''} by {userName(db, edited.updatedBy)}</span>} />
        <div className="space-y-3 p-5">
          <div className="flex flex-wrap gap-1"><span className="mr-1 text-xs font-semibold text-mute">Insert:</span>{PLACEHOLDERS.map(([k, l]) => <button key={k} type="button" title={l} onClick={() => insert(k)} className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-accent hover:brightness-95">{`{${k}}`}</button>)}</div>
          <Input label="Email subject" value={f.subject} maxLength={200} onFocus={() => setFocus('subject')} onChange={(e) => setF({ ...f, subject: e.target.value })} />
          <div className="grid gap-4 xl:grid-cols-2">
            <Textarea label="Email" rows={12} maxLength={6000} value={f.email} onFocus={() => setFocus('email')} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <div>
              <Textarea label={`WhatsApp (${f.whatsapp.length}/900) — empty = the email text`} rows={12} maxLength={900} value={f.whatsapp} onFocus={() => setFocus('whatsapp')} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} />
              <p className="mt-1 text-[11px] text-mute">Sent inside the approved WhatsApp template: “Dear {'{client}'}, {'<this text>'} — {db.settings.companyName || 'Rexera'}”.</p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {edited && <Button variant="ghost" icon={RotateCcw} onClick={async () => { if (await confirm('Back to the built-in text?', `${s.label}: your edits are replaced by the built-in template.`)) { run(() => resetTemplate(me, stage), 'Built-in template restored'); setF(DEFAULT_TEMPLATES[stage]) } }}>Built-in text</Button>}
            <Button icon={Save} loading={busy} disabled={!dirty} onClick={() => once(async () => { await run(() => saveTemplate(me, stage, f), 'Template saved — every team uses it now') })}>Save template</Button>
          </div>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Preview" subtitle="With a sample client — the sender sees it filled for the real client and can edit it before sending" icon={CheckCircle2} />
        <div className="grid gap-4 p-5 xl:grid-cols-2">
          <div className="rounded-2xl bg-card2 p-4 text-sm"><p className="mb-1 flex items-center gap-1.5 text-xs font-bold text-ok"><MessageCircle className="size-3.5" />WhatsApp</p><p>Dear {SAMPLE.client_name}, {fillMessage(f.whatsapp || f.email, SAMPLE).replace(/\s*\n+\s*/g, ' ')} — {db.settings.companyName || 'Rexera'}</p></div>
          <div className="rounded-2xl bg-card2 p-4 text-sm"><p className="mb-1 flex items-center gap-1.5 text-xs font-bold text-info"><Mail className="size-3.5" />{fillMessage(f.subject, SAMPLE)}</p><p className="whitespace-pre-line">{fillMessage(f.email, SAMPLE)}</p></div>
        </div>
      </Card>
      {confirmNode}
    </div>
  )
}

function Log() {
  const db = useDb()
  const [q, setQ] = useState('')
  const [stage, setStage] = useState('')
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const all = db.clientMessages ?? []
  const label = useMemo(() => {
    const b = new Map(db.bookings.map((x) => [x.id, `${x.bookingId} · ${x.companyName}`]))
    const e = new Map((db.clientEntries ?? []).map((x) => [x.id, `${x.clientName} · ${x.companyName}`]))
    return (m: (typeof all)[number]) => (m.bookingId ? b.get(m.bookingId) : m.clientEntryId ? e.get(m.clientEntryId) : '') ?? ''
  }, [db.bookings, db.clientEntries])
  const ql = q.trim().toLowerCase()
  const list = all.filter((m) => (!stage || m.stage === stage) && (!channel || m.channel === channel) && (!status || m.status === status)
    && (!ql || `${label(m)} ${m.to} ${m.subject ?? ''} ${m.body} ${userName(db, m.by)}`.toLowerCase().includes(ql)))
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <SearchBox value={q} onChange={setQ} placeholder="Client, number, email, text, sender…" className="min-w-56 flex-1" />
        <Select aria-label="Message" value={stage} onChange={(e) => setStage(e.target.value)} className="w-52"><option value="">Every message</option>{MESSAGE_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
        <Select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)} className="w-36"><option value="">Both channels</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option></Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44"><option value="">Any status</option>{Object.entries(MESSAGE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
      </div>
      {!list.length ? <EmptyState icon={MessageCircle} title={all.length ? 'Nothing matches' : 'No messages sent yet'} /> : (
        <ul className="divide-y divide-line/70">{list.slice(0, 500).map((m) => <LogRow key={m.id} m={m} record={
          <Link to={m.bookingId ? `/bookings/${m.bookingId}?tab=messages` : '/client-entries'} className="text-xs font-semibold text-brand-ink hover:underline">{label(m) || 'record'}</Link>} />)}</ul>
      )}
    </Card>
  )
}

function Setup() {
  const db = useDb()
  const [health, setHealth] = useState<{ smtpConfigured?: boolean; whatsappConfigured?: boolean } | null>(null)
  useEffect(() => { fetch('/api/health').then((r) => r.json()).then(setHealth, () => setHealth({})) }, [])
  const tpl = db.settings.workflow?.whatsapp?.notifyTemplate
  const row = (ok: boolean | undefined, title: string, text: string) => (
    <li className="flex items-start gap-3 px-5 py-4">
      {ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" /> : <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" />}
      <span className="min-w-0 flex-1"><b className="text-sm">{title}</b><span className="block text-xs text-mute">{text}</span></span>
    </li>
  )
  return (
    <Card className="overflow-hidden">
      <CardHeader title="What sending needs" subtitle="Until these are set, teams can still send each message from their own WhatsApp / mail app — it is recorded the same way" icon={Settings2} />
      <ul className="divide-y divide-line/70">
        {row(CLOUD, 'Live CRM', CLOUD ? 'Connected — messages go through the live server.' : 'This copy is not connected to the live server: messages can only be recorded here.')}
        {row(!!health?.smtpConfigured, 'Email', health === null ? 'Checking…' : health.smtpConfigured ? 'The mail server is set up.' : 'Not set up: add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and SMTP_FROM) — or RESEND_API_KEY — in Render → Environment, then redeploy.')}
        {row(!!health?.whatsappConfigured, 'WhatsApp (Interakt)', health === null ? 'Checking…' : health.whatsappConfigured ? 'The Interakt key is set.' : 'Not set up: add INTERAKT_API_KEY (Interakt → Settings → Developer Settings) in Render → Environment, then redeploy.')}
        {row(!!tpl, 'WhatsApp “client notification” template', tpl ? `Using “${tpl}”.` : 'In Interakt → Templates create a Utility template with 4 variables — e.g. “Dear {{1}}, an update on your file {{2}}: {{3}} — {{4}}” ({{1}} client name, {{2}} file number, {{3}} the message, {{4}} our company) — wait for Meta’s approval, then enter its name in Workflow settings → WhatsApp → Client notification template.')}
      </ul>
      <p className="border-t border-line px-5 py-3 text-xs text-mute"><Link to="/workflow-settings" className="font-semibold text-brand-ink hover:underline">Workflow settings → WhatsApp</Link> (Admin)</p>
    </Card>
  )
}
