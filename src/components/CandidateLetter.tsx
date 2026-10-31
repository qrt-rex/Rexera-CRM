import { useMemo, useState, type ReactNode } from 'react'
import { Download, Eye, FileCheck2, FilePen, Mail, MessageCircle, RotateCcw, Send, UserCheck, X } from 'lucide-react'
import type { CandidateApplication, CandidateLetter } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { userName } from '../lib/actions'
import { draftBody, letterPdf, type LetterData } from '../lib/letters'
import { contactOfCandidate, LETTER_CHOICES, letterDataFor, lettersFor, newLetterRequestId, selectCandidate, sendCandidateLetter, type LetterChoice, type LetterResult } from '../lib/hrLetters'
import { mailLink, whatsappLink } from '../lib/clientMessages'
import { fmtDateTime } from '../lib/format'
import { Badge, Button, Card, CardHeader, cx, Input, Modal, Textarea, useRun, useSubmitting, useToast } from './ui'

const STATUS: Record<CandidateLetter['status'], { label: string; tone: 'green' | 'blue' | 'red' | 'amber' }> = {
  SENT: { label: 'Sent', tone: 'green' }, MANUAL: { label: 'Sent from own app', tone: 'blue' }, FAILED: { label: 'Failed', tone: 'red' }, NOT_CONFIGURED: { label: 'Not set up', tone: 'amber' },
}
const choice = (k: LetterChoice) => LETTER_CHOICES.find((c) => c.id === k)!

/** The candidates HR has ticked: send each an offer or joining letter, or take them off the list. */
export function SelectedCandidates({ onOpen }: { onOpen: (id: string) => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [send, setSend] = useState<{ id: string; kind: LetterChoice } | null>(null)
  const picked = db.candidates.filter((c) => c.selected)
  const target = send ? db.candidates.find((c) => c.id === send.id && c.selected) : undefined
  if (!picked.length) return null
  return (
    <Card className="mb-6 overflow-hidden border-ok/30">
      <CardHeader title="Selected candidates" icon={UserCheck} subtitle={`${picked.length} selected — send each an offer or joining letter by email or WhatsApp. Untick a candidate to take them off this list.`} />
      <ul className="divide-y divide-line/70">
        {picked.map((c) => {
          const sent = lettersFor(db, c.id)
          const last = (k: LetterChoice) => sent.find((l) => l.kind === k && (l.status === 'SENT' || l.status === 'MANUAL'))
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(c.id)}>
                <p className="truncate font-semibold hover:underline">{c.name}</p>
                <p className="truncate text-xs text-mute">{[c.position, c.branch].filter(Boolean).join(' · ') || '—'} · {c.email} · {c.phone}</p>
                {(last('OFFER') || last('JOINING')) && <p className="mt-0.5 flex flex-wrap gap-1">{(['OFFER', 'JOINING'] as const).map((k) => last(k) && <Badge key={k} tone="green">{choice(k).label} sent {fmtDateTime(last(k)!.at)}</Badge>)}</p>}
              </button>
              <div className="flex flex-wrap gap-1.5">
                {LETTER_CHOICES.map((k) => <Button key={k.id} size="sm" variant={k.id === 'OFFER' ? 'accent' : 'outline'} icon={k.id === 'OFFER' ? FilePen : FileCheck2} onClick={() => setSend({ id: c.id, kind: k.id })}>{k.label}</Button>)}
                <Button size="sm" variant="ghost" icon={X} aria-label={`Unselect ${c.name}`} title="Take off the selected list" onClick={() => run(() => selectCandidate(me, c.id, false), `${c.name} is no longer selected`)} />
              </div>
            </li>
          )
        })}
      </ul>
      {target && send && <SendLetterModal c={target} kind={send.kind} onClose={() => setSend(null)} />}
    </Card>
  )
}

/** Fill the letter, check the PDF, then send it on email and / or WhatsApp. Closes by itself if the candidate is unselected. */
export function SendLetterModal({ c, kind, onClose }: { c: CandidateApplication; kind: LetterChoice; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const toast = useToast()
  const [x, setX] = useState<LetterData>(() => letterDataFor(db, me, c))
  const [text, setText] = useState('')
  const [edited, setEdited] = useState(false)
  const k = choice(kind)
  const drafted = useMemo(() => draftBody(k.kind, x), [k.kind, x])
  const body = edited ? text : drafted
  const set = (patch: Partial<LetterData>) => setX((v) => ({ ...v, ...patch }))
  const contact = contactOfCandidate(c)
  const [subject, setSubject] = useState(`${k.label} — ${x.designation || 'your application'} at ${db.settings.companyName}`)
  const [mailText, setMailText] = useState(`Dear ${c.name.split(/\s+/)[0]},\n\nPlease find your ${k.label.toLowerCase()} attached. Kindly read it and confirm your acceptance by replying to this email.\n\nRegards,\n${me.name}\nHuman Resources, ${db.settings.companyName}`)
  const [waText, setWaText] = useState(`Dear ${c.name.split(/\s+/)[0]}, please find your ${k.label.toLowerCase()} from ${db.settings.companyName}. Kindly confirm your acceptance.`)
  const missing = !x.name.trim() ? 'Enter the candidate’s name.' : !x.designation.trim() ? 'Enter the designation.' : !x.startDate ? 'Enter the joining date.' : ''
  const fileName = `${k.label.replace(/ /g, '-')}-${x.name.trim().replace(/\s+/g, '-')}.pdf`
  const pdf = () => { if (missing) throw new Error(missing); return letterPdf(k.kind, x, body) }
  const sent = lettersFor(db, c.id).filter((l) => l.kind === kind)

  const preview = () => { try { const url = URL.createObjectURL(pdf()); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60_000) } catch (e) { toast('error', (e as Error).message) } }
  const download = () => { const url = URL.createObjectURL(pdf()); const a = document.createElement('a'); a.href = url; a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000) }

  return (
    <Modal open onClose={onClose} size="xl" title={`${k.label} · ${c.name}`} subtitle="Check the details and the letter, then send it — the PDF goes to the email and mobile saved on the application">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Name" required value={x.name} onChange={(e) => set({ name: e.target.value })} />
            <Input label="Designation" required value={x.designation} onChange={(e) => set({ designation: e.target.value })} />
            <Input label="Department" value={x.department} onChange={(e) => set({ department: e.target.value })} />
            <Input label="Work location" value={x.location} onChange={(e) => set({ location: e.target.value })} />
            <Input label="Joining date" type="date" required value={x.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            <Input label="Monthly salary / CTC (₹)" type="number" min={0} value={x.amount || ''} onChange={(e) => set({ amount: Number(e.target.value) })} />
            <Input label="Probation (months)" type="number" min={0} value={x.probationMonths} onChange={(e) => set({ probationMonths: Number(e.target.value) })} />
            {kind === 'OFFER' ? <Input label="Accept by (optional)" type="date" value={x.endDate} min={x.date} onChange={(e) => set({ endDate: e.target.value })} />
              : <Input label="Reporting to" value={x.reportingTo} onChange={(e) => set({ reportingTo: e.target.value })} />}
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2"><p className="text-xs font-semibold text-mute">Letter text</p>{edited && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setEdited(false)}>Reset</Button>}</div>
            <textarea value={body} onChange={(e) => { setText(e.target.value); setEdited(true) }} aria-label="Letter text" rows={12}
              className="w-full resize-y rounded-xl border border-line bg-card p-3 font-serif text-sm leading-relaxed outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" />
          </div>
          {missing && <p className="text-xs text-warn">{missing}</p>}
          <div className="flex flex-wrap gap-2"><Button variant="outline" icon={Eye} onClick={preview}>Preview PDF</Button><Button variant="ghost" icon={Download} disabled={!!missing} onClick={() => { try { download() } catch (e) { toast('error', (e as Error).message) } }}>Download</Button></div>
        </div>

        <div className="grid content-start gap-4">
          <Channel icon={Mail} title="Email" to={contact.email} blocked={missing}
            fields={<><Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} /><Textarea label="Message (the PDF is attached)" rows={6} value={mailText} onChange={(e) => setMailText(e.target.value)} /></>}
            send={(manual, requestId) => sendCandidateLetter(me, c, { kind, channel: 'EMAIL', subject, body: mailText, pdf: manual ? undefined : pdf(), fileName, manual, requestId })}
            fallback={() => { download(); window.open(mailLink(contact.email!, subject, `${mailText}\n\n(Please attach ${fileName} — it was just downloaded.)`), '_blank') }} fallbackLabel="Send from my mail app" />
          <Channel icon={MessageCircle} title="WhatsApp" to={contact.phone && `+91 ${contact.phone}`} blocked={missing}
            fields={<Textarea label="Message (a 7-day link to the PDF is added)" rows={3} value={waText} onChange={(e) => setWaText(e.target.value)} />}
            send={(manual, requestId) => sendCandidateLetter(me, c, { kind, channel: 'WHATSAPP', body: waText, pdf: manual ? undefined : pdf(), fileName, manual, requestId })}
            fallback={() => { download(); window.open(whatsappLink(contact.phone!, `${waText}\n(The letter PDF is attached.)`), '_blank') }} fallbackLabel="Send from my WhatsApp" />
          {sent.length > 0 && (
            <div className="rounded-xl border border-line">
              <p className="border-b border-line px-3 py-2 text-xs font-semibold text-mute">{k.label}s sent to {c.name.split(/\s+/)[0]}</p>
              <ul className="max-h-40 divide-y divide-line/70 overflow-y-auto text-xs">{sent.map((l) => <LetterRow key={l.id} l={l} />)}</ul>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** One channel's send button, with the result and — when the server can't send — "send from my own app" (recorded). */
function Channel({ icon: Icon, title, to, blocked, fields, send, fallback, fallbackLabel }: {
  icon: typeof Mail; title: string; to?: string; blocked: string; fields: ReactNode
  send: (manual: boolean, requestId: string) => Promise<LetterResult>; fallback: () => void; fallbackLabel: string
}) {
  const toast = useToast()
  const [requestId, setRequestId] = useState(newLetterRequestId)
  const [result, setResult] = useState<LetterResult | null>(null)
  const [busy, go] = useSubmitting()
  const run = (manual: boolean) => go(async () => {
    try {
      if (manual) fallback()
      const r = await send(manual, manual ? newLetterRequestId() : requestId)
      setResult(r)
      toast(r.ok ? 'success' : r.status === 'NOT_CONFIGURED' ? 'warning' : 'error', r.message)
      // a definite answer: a new click is a new send (a lost connection keeps the id, so a retry is answered once)
      if (r.status !== 'ERROR') setRequestId(newLetterRequestId())
    } catch (e) { toast('error', (e as Error).message) }
  })
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold"><Icon className="size-4 text-brand-ink" />{title}<span className={cx('ml-auto truncate text-xs font-normal', to ? 'text-mute' : 'text-bad')}>{to ?? 'not on the application'}</span></p>
      <div className="grid gap-2">{fields}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" icon={Send} loading={busy} disabled={!to || !!blocked} onClick={() => run(false)}>Send {title === 'Email' ? 'email' : 'WhatsApp'}</Button>
        {result && !result.ok && result.status !== 'ERROR' && to && <Button size="sm" variant="outline" icon={Icon} disabled={!!blocked} onClick={() => run(true)}>{fallbackLabel}</Button>}
      </div>
      {result && <p className={cx('mt-1.5 text-xs', result.ok ? 'text-ok' : 'text-warn')}>{result.message}</p>}
    </div>
  )
}

function LetterRow({ l }: { l: CandidateLetter }) {
  const db = useDb()
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-1.5">
      <span className="w-32 text-mute">{fmtDateTime(l.at)}</span>
      <Badge tone="gray">{l.channel === 'EMAIL' ? 'Email' : 'WhatsApp'}</Badge>
      <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
      <span className="min-w-0 flex-1 truncate">{l.to}{l.error ? ` — ${l.error}` : ''}</span>
      <span className="text-mute">{userName(db, l.by)}</span>
    </li>
  )
}

/** Every letter sent to one candidate (the candidate drawer). */
export function CandidateLetters({ c }: { c: CandidateApplication }) {
  const db = useDb()
  const list = lettersFor(db, c.id)
  if (!list.length) return null
  return (
    <div className="rounded-xl border border-line">
      <p className="border-b border-line px-3 py-2 text-xs font-semibold text-mute">Letters sent</p>
      <ul className="divide-y divide-line/70 text-xs">{list.map((l) => <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5"><b>{choice(l.kind).label}</b><Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge><span className="text-mute">{l.channel === 'EMAIL' ? 'email' : 'WhatsApp'} · {fmtDateTime(l.at)}</span></li>)}</ul>
    </div>
  )
}
