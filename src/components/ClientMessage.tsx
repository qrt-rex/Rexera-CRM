import { useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, ChevronDown, Mail, MessageCircle, Send, SendHorizontal, TriangleAlert, XCircle } from 'lucide-react'
import type { Booking, ClientMessage as Msg } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { userName } from '../lib/actions'
import { contactOf, draftFor, lastSent, mailLink, messagesFor, newRequestId, sendMessage, stagesOpen, whatsappLink, type SendResult, type Target } from '../lib/clientMessages'
import { fmtDateTime, ago } from '../lib/format'
import { leftovers, MESSAGE_STATUS, stageOf, type Channel, type MessageStageId } from '../../supabase/message-rules.mjs'
import { Badge, Button, cx, EmptyState, Input, Modal, Textarea, useSubmitting, useToast } from './ui'

const CH: Record<Channel, { label: string; icon: typeof Mail; send: string; own: string }> = {
  WHATSAPP: { label: 'WhatsApp', icon: MessageCircle, send: 'Send WhatsApp message', own: 'Send from my WhatsApp' },
  EMAIL: { label: 'Email', icon: Mail, send: 'Send email', own: 'Send from my mail app' },
}

/**
 * Message the client of a CRM entry / client entry: pick the message (only the ones your team sends, and only when
 * the file has reached that step), review and edit the WhatsApp text and the email, and send each on its own button —
 * or both. Every send is recorded; a second click while sending is ignored, and the server refuses a repeat.
 */
export function MessageClientModal({ target, stage: first, onClose }: { target: Target; stage?: MessageStageId; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const options = stagesOpen(db, me, target)
  const firstOpen = options.find((o) => !o.closed)?.stage.id
  const [stage, setStage] = useState<MessageStageId | undefined>(first && options.some((o) => o.stage.id === first && !o.closed) ? first : firstOpen)
  const contact = contactOf(target)
  const name = target.kind === 'booking' ? `${target.b.contactPerson} · ${target.b.companyName}` : `${target.e.clientName} · ${target.e.companyName}`
  return (
    <Modal open onClose={onClose} size="xl" title={`Message the client · ${name}`}
      subtitle={`WhatsApp ${contact.phone ? `+91 ${contact.phone}` : '— no mobile saved'} · Email ${contact.email ?? '— no email saved'} (as saved on the ${target.kind === 'booking' ? 'CRM entry' : 'client entry'})`}>
      {!options.length ? <EmptyState icon={MessageCircle} title="Your team has no message for this client" /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Which message">
            {options.map(({ stage: s, closed }) => (
              <button key={s.id} type="button" role="radio" aria-checked={stage === s.id} disabled={!!closed} title={closed ?? s.desc} onClick={() => setStage(s.id)}
                className={cx('rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40', stage === s.id ? 'border-brand bg-brand text-white' : 'border-line hover:bg-card2')}>
                {s.label}{(lastSent(db, target, s.id, 'WHATSAPP') || lastSent(db, target, s.id, 'EMAIL')) && <CheckCircle2 className="ml-1 inline size-3.5" />}
              </button>
            ))}
          </div>
          {stage ? <Composer key={stage} target={target} stage={stage} /> : <p className="text-sm text-mute">No message is open at this step of the file yet.</p>}
        </div>
      )}
    </Modal>
  )
}

function Composer({ target, stage }: { target: Target; stage: MessageStageId }) {
  const db = useDb()
  const me = useMe()
  const toast = useToast()
  const draft = useMemo(() => draftFor(db, me, target, stage), [stage])  // eslint-disable-line react-hooks/exhaustive-deps
  const [wa, setWa] = useState(draft.whatsapp)
  const [subject, setSubject] = useState(draft.subject)
  const [mail, setMail] = useState(draft.email)
  const contact = contactOf(target)
  const s = stageOf(stage)!
  // one request id per channel: a retry of the same send is answered once by the server
  const [ids, setIds] = useState({ WHATSAPP: newRequestId(), EMAIL: newRequestId() })
  const [result, setResult] = useState<Partial<Record<Channel, SendResult>>>({})
  const [waBusy, waOnce] = useSubmitting()
  const [mailBusy, mailOnce] = useSubmitting()
  const autoWelcome = target.kind === 'booking' && stage === 'LEGAL_CLEARED' && target.b.welcome?.email?.status === 'SENT'

  const send = (ch: Channel, manual = false) => (ch === 'WHATSAPP' ? waOnce : mailOnce)(async () => {
    if (manual) {
      const to = ch === 'WHATSAPP' ? contact.phone : contact.email
      if (!to) return
      window.open(ch === 'WHATSAPP' ? whatsappLink(to, wa) : mailLink(to, subject, mail), '_blank', 'noopener')
    }
    const r = await sendMessage(me, target, { stage, channel: ch, subject, body: ch === 'WHATSAPP' ? wa : mail, manual, requestId: ids[ch] })
    setResult((x) => ({ ...x, [ch]: r }))
    toast(r.ok ? 'success' : 'error', `${CH[ch].label}: ${r.message}`)
    // a new id for the next (deliberate) send of this channel
    if (r.ok || r.status !== 'ERROR') setIds((x) => ({ ...x, [ch]: newRequestId() }))
  })
  const both = async () => { await send('WHATSAPP'); await send('EMAIL') }

  const box = (ch: Channel, editor: ReactNode, missing: boolean, busy: boolean, text: string) => {
    const r = result[ch], last = lastSent(db, target, stage, ch), Icon = CH[ch].icon
    const left = leftovers(ch === 'EMAIL' ? `${subject} ${text}` : text)
    return (
      <section className="flex flex-col rounded-2xl border border-line p-4">
        <p className="mb-3 flex items-center gap-2 font-bold"><Icon className={cx('size-5', ch === 'WHATSAPP' ? 'text-ok' : 'text-info')} />{CH[ch].label}
          <span className="ml-auto truncate text-xs font-normal text-mute">{ch === 'WHATSAPP' ? (contact.phone ? `+91 ${contact.phone}` : 'no mobile saved') : (contact.email ?? 'no email saved')}</span></p>
        <div className="flex-1 space-y-3">{editor}</div>
        {left.length > 0 && <p className="mt-2 text-xs font-semibold text-warn">Fill in or remove {left.join(', ')}.</p>}
        {last && <p className="mt-2 text-[11px] text-mute">Already sent {ago(last.at)} by {userName(db, last.by)} ({MESSAGE_STATUS[last.status].label.toLowerCase()})</p>}
        {r && <p className={cx('mt-2 flex items-start gap-1.5 text-xs font-semibold', r.ok ? 'text-ok' : 'text-bad')}>{r.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}{r.message}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button icon={Send} loading={busy} disabled={missing || left.length > 0} className={cx('flex-1', ch === 'WHATSAPP' && 'bg-ok hover:opacity-90')} onClick={() => send(ch)}>{CH[ch].send}</Button>
          {/* no WhatsApp / mail service on the server (or it failed): send it yourself — it is still recorded */}
          {r && !r.ok && r.status !== 'ERROR' && !missing && <Button variant="outline" icon={SendHorizontal} disabled={busy || left.length > 0} onClick={() => send(ch, true)}>{CH[ch].own}</Button>}
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-mute"><b className="text-ink">{s.label}:</b> {s.desc}. Review and edit before sending — each button sends on its own channel only.</p>
      {autoWelcome && <p className="flex gap-2 rounded-xl bg-info-soft px-3 py-2 text-xs text-info"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />The automatic welcome email (sent when Legal approved) already told this client the file is with Operations.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {box('WHATSAPP', <>
          <Textarea label={`Message (${wa.length}/900)`} rows={9} maxLength={900} value={wa} onChange={(e) => setWa(e.target.value)} />
          <p className="text-[11px] text-mute">Goes in the approved WhatsApp template: “Dear {'{name}'}, an update on your file {'{file no.}'}: {'<this message>'} — {db.settings.companyName || 'Rexera'}”. Line breaks become spaces.</p>
        </>, !contact.phone, waBusy, wa)}
        {box('EMAIL', <>
          <Input label="Subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          <Textarea label="Email" rows={9} maxLength={6000} value={mail} onChange={(e) => setMail(e.target.value)} />
        </>, !contact.email, mailBusy, mail)}
      </div>
      {contact.phone && contact.email && (
        <div className="flex justify-end"><Button variant="outline" icon={Send} loading={waBusy || mailBusy} onClick={both}>Send on both</Button></div>
      )}
    </div>
  )
}

/** Every message sent to this client: channel, message, recipient, sender, time, status. */
export function MessageLog({ target, compact }: { target: Target; compact?: boolean }) {
  const db = useDb()
  const list = messagesFor(db, target)
  if (!list.length) return <EmptyState icon={MessageCircle} title="No messages sent yet" text={compact ? undefined : 'WhatsApp and email messages to this client appear here.'} />
  return <ul className="divide-y divide-line/70">{list.map((m) => <LogRow key={m.id} m={m} />)}</ul>
}
export function LogRow({ m, record }: { m: Msg; record?: ReactNode }) {
  const db = useDb()
  const [open, setOpen] = useState(false)
  const st = MESSAGE_STATUS[m.status], Icon = m.channel === 'WHATSAPP' ? MessageCircle : Mail
  return (
    <li className="px-4 py-2.5 text-sm">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-3 text-left">
        <Icon className={cx('mt-0.5 size-4 shrink-0', m.channel === 'WHATSAPP' ? 'text-ok' : 'text-info')} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2"><b>{stageOf(m.stage)?.label ?? m.stage}</b><Badge tone={st.tone}>{st.label}</Badge>{record}</span>
          <span className="block truncate text-xs text-mute">{m.channel === 'WHATSAPP' ? `+91 ${m.to}` : m.to} · {userName(db, m.by)} · {fmtDateTime(m.at)}</span>
          {m.error && <span className="block text-xs text-bad">{m.error}</span>}
        </span>
        <ChevronDown className={cx('mt-1 size-4 shrink-0 text-mute transition', open && 'rotate-180')} />
      </button>
      {open && <div className="mt-2 rounded-xl bg-card2 p-3 text-xs">{m.subject && <p className="mb-1 font-bold">{m.subject}</p>}<p className="whitespace-pre-line">{m.body}</p></div>}
    </li>
  )
}

/** The milestone messages this person's team sends, open now and not sent yet — shown on the CRM entry as a prompt. */
const PROMPTS: MessageStageId[] = ['WELCOME', 'ACCOUNT_CLEARED', 'LEGAL_CLEARED', 'SUBMITTED', 'COMPLETED']
export function NextMessage({ b, onOpen }: { b: Booking; onOpen: (s: MessageStageId) => void }) {
  const db = useDb()
  const me = useMe()
  const t: Target = { kind: 'booking', b }
  const due = stagesOpen(db, me, t).filter((o) => !o.closed && PROMPTS.includes(o.stage.id) && !lastSent(db, t, o.stage.id, 'WHATSAPP') && !lastSent(db, t, o.stage.id, 'EMAIL'))
    // the step the file is at matters most: the last one first
    .sort((x, y) => PROMPTS.indexOf(y.stage.id) - PROMPTS.indexOf(x.stage.id))
  const top = due[0]
  if (!top) return null
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-brand/30 bg-brand-soft/60 px-4 py-3">
      <MessageCircle className="size-5 text-brand-ink" />
      <p className="min-w-0 flex-1 text-sm"><b>{top.stage.label}</b> — {top.stage.desc}. Let the client know.</p>
      <Button size="sm" icon={Send} onClick={() => onOpen(top.stage.id)}>Message the client</Button>
    </div>
  )
}
