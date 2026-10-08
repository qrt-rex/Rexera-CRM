import { useMemo, useState } from 'react'
import { AlertTriangle, ExternalLink, Mail, Send } from 'lucide-react'
import type { Booking } from '../lib/types'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { logClientEmail } from '../lib/actions'
import { CLIENT_TEMPLATES, clientEmailRequest, draftFor, suggestTemplate, type ClientDraft, type ClientTemplateKey } from '../lib/clientMail'
import { sendClientEmailClient } from '../lib/emailClient'
import { checkClientEmail, renderClientEmail } from '../../supabase/functions/_shared/client-email.mjs'
import { Button, Checkbox, Input, Modal, Select, Textarea, useToast } from './ui'

/** Email the client from the file: pick a template, edit it, check the preview, send. */
export function ClientEmailComposer({ b, onClose, template }: { b: Booking; onClose: () => void; template?: ClientTemplateKey }) {
  const db = useDb()
  const me = useMe()
  const toast = useToast()
  const [d, setD] = useState<ClientDraft>(() => draftFor(b, template ?? suggestTemplate(b)))
  const [ccText, setCcText] = useState(() => d.cc.join(', '))
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const set = (patch: Partial<ClientDraft>) => { setD({ ...d, ...patch }); setFailed(null) }
  const pick = (key: ClientTemplateKey) => { const next = draftFor(b, key); setD({ ...next, to: d.to || next.to, cc: d.cc }); setFailed(null) }

  const req = useMemo(() => clientEmailRequest(db, b, me, { ...d, cc: ccText.split(/[,;\s]+/).filter(Boolean) }), [db, b, me, d, ccText])
  const problem = checkClientEmail(req)
  const preview = useMemo(() => renderClientEmail({ ...req, to: req.to || 'client@example.com', sender: req.sender }), [req])
  const unfilled = /\[[^\]]{3,}\]/.test(d.message) || /\[[^\]]{3,}\]/.test(d.subject)

  const send = async () => {
    if (problem) { toast('error', problem); return }
    setBusy(true)
    const r = await sendClientEmailClient(req)
    setBusy(false)
    const log = { to: req.to, cc: req.cc ?? [], subject: req.subject, template: d.template }
    if (r.delivered) {
      logClientEmail(me, b.id, { ...log, status: 'SENT' })
      toast('success', `Email sent to ${req.to}`)
      onClose()
      return
    }
    logClientEmail(me, b.id, { ...log, status: 'FAILED', error: r.message })
    setFailed(r.notConfigured ? 'Email sending is not set up on this server yet (SMTP). You can send it from your own email app instead.' : r.message ?? 'Sending failed.')
  }
  // fallback: the same text in the person's own email app (the formatted layout needs the mail server)
  const mailApp = () => {
    const q = new URLSearchParams({ subject: req.subject, body: renderClientEmail(req).text })
    if (req.cc?.length) q.set('cc', req.cc.join(','))
    window.location.href = `mailto:${encodeURIComponent(req.to)}?${q.toString().replace(/\+/g, '%20')}`
    logClientEmail(me, b.id, { to: req.to, cc: req.cc ?? [], subject: req.subject, template: d.template, status: 'MAIL_APP' })
    onClose()
  }

  return (
    <Modal open onClose={onClose} size="xl" title="Email the client" subtitle={`${b.companyName} · ${b.bookingId} — sent from Rexera; replies come to ${me.email || 'you'}`}
      footer={<>
        {failed && <Button variant="outline" icon={ExternalLink} onClick={mailApp} disabled={!!problem}>Open in my email app</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button icon={Send} loading={busy} disabled={!!problem || busy} onClick={send}>{failed ? 'Try again' : 'Send email'}</Button>
      </>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-3">
          <Select label="Template" value={d.template} onChange={(e) => pick(e.target.value as ClientTemplateKey)}>
            {CLIENT_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name} — {t.when}</option>)}
          </Select>
          <Input label="To (client)" type="email" required value={d.to} onChange={(e) => set({ to: e.target.value })} hint={b.email ? undefined : 'No email on the file — enter the client’s email'} />
          <Input label="CC (optional, up to 3)" value={ccText} onChange={(e) => { setCcText(e.target.value); setFailed(null) }} placeholder="accounts@client.com, partner@client.com" />
          <Input label="Subject" value={d.subject} maxLength={200} onChange={(e) => set({ subject: e.target.value })} />
          <Input label="Heading inside the email" value={d.heading} maxLength={200} onChange={(e) => set({ heading: e.target.value })} />
          <Textarea label="Message" rows={11} maxLength={6000} value={d.message} onChange={(e) => set({ message: e.target.value })}
            hint="Blank line = new paragraph · lines starting with • become a list · your name, role and contact are added at the end" />
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Checkbox checked={d.details} onChange={(v) => set({ details: v })} label="File details box" />
            <Checkbox checked={d.tracker} onChange={(v) => set({ tracker: v })} label="Progress tracker (8 stages)" />
          </div>
          {unfilled && <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-xs font-medium text-warn"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Fill in the [bracketed] parts before sending.</p>}
          {problem && d.to && <p className="text-xs text-bad">{problem}</p>}
          {failed && <p role="alert" className="flex items-start gap-2 rounded-xl bg-bad-soft px-3 py-2 text-xs font-medium text-bad"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{failed}</p>}
        </div>
        <div className="min-w-0">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-mute"><Mail className="size-3.5" />Preview — exactly what the client receives</p>
          <div className="mb-2 rounded-xl border border-line bg-card2 px-3 py-2 text-xs">
            <p className="truncate"><span className="text-mute">To:</span> {req.to || '—'}{req.cc?.length ? <><span className="text-mute"> · CC:</span> {req.cc.join(', ')}</> : null}</p>
            <p className="truncate font-semibold">{req.subject || '—'}</p>
          </div>
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[520px] w-full rounded-xl border border-line bg-white" />
        </div>
      </div>
    </Modal>
  )
}
