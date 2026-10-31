import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellRing, Clock, FileSignature, KeyRound, Mail, MessageCircle, Save, ScrollText, Settings2, Sparkles } from 'lucide-react'
import type { Role, WorkflowSettings as WS } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { saveWorkflowSettings } from '../../lib/actions'
import { ROLES } from '../../lib/rbac'
import { CLOUD } from '../../lib/cloud'
import { fmtDateTime } from '../../lib/format'
import { fillTemplate, WELCOME_PLACEHOLDERS, WHATSAPP_FORM_VARS, WHATSAPP_INVOICE_VARS, WHATSAPP_NOTIFY_VARS, WHATSAPP_WELCOME_VARS, workflowSettings } from '../../../supabase/workflow-rules.mjs'
import { Badge, Button, Card, CardHeader, Checkbox, Input, PageHeader, Select, Textarea, Toggle, useRun } from '../../components/ui'

const SAMPLE = { client_name: 'Asha Patel', company: 'Rexera', service: 'Seed Fund Scheme', reference: 'RX-2026-000123', status: 'With our Operations team', ops_name: 'Sneha Patel', ops_phone: '9876500001', ops_email: 'ops@rexera.co.in' }

/**
 * Admin control area for the automated workflow: reminder intervals, the client welcome message, the Operations
 * contact, scheme expiry recipients — and whether the server's scheduled job and the mail server are working.
 */
export default function WorkflowSettings() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [w, setW] = useState<WS>(() => workflowSettings(db.settings.workflow))
  const [health, setHealth] = useState<{ smtpConfigured?: boolean; whatsappConfigured?: boolean } | null>(null)
  useEffect(() => { fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => setHealth({})) }, [])
  const set = (p: Partial<WS>) => setW((x) => ({ ...x, ...p }))
  const jobs = db.settings.jobs
  const jobsOk = !!jobs?.lastRunAt && Date.now() - new Date(jobs.lastRunAt).getTime() < 2 * 3600_000

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Workflow Settings" subtitle="Reminders, the client welcome message and alerts — no code changes needed" icon={Settings2}
        actions={<Button icon={Save} onClick={() => run(() => saveWorkflowSettings(me, w), 'Workflow settings saved')}>Save</Button>} />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="p-4"><p className="flex items-center gap-2 text-sm font-bold"><Clock className="size-4" />Scheduled job</p>
          {!CLOUD ? <p className="mt-1 text-xs text-mute">Browser mode: reminders run while someone has the CRM open.</p>
            : <><Badge tone={jobsOk ? 'green' : 'red'} className="mt-2">{jobsOk ? 'Running' : jobs ? 'Not run in 2 hours' : 'Never run'}</Badge>
              <p className="mt-1 text-xs text-mute">{jobs ? `Last run ${fmtDateTime(jobs.lastRunAt)} · ${jobs.summary ?? ''}` : 'Set up the Render Cron Job (see the guide).'}{!jobsOk && ' Until it runs, a Super Admin / IT browser sends the reminders.'}</p></>}
        </Card>
        <Card className="p-4"><p className="flex items-center gap-2 text-sm font-bold"><Mail className="size-4" />Email</p>
          <Badge tone={health?.smtpConfigured ? 'green' : health ? 'red' : 'gray'} className="mt-2">{health?.smtpConfigured ? 'Mail server set up' : health ? 'Not set up (SMTP)' : 'Checking…'}</Badge>
          <p className="mt-1 text-xs text-mute">Welcome emails need SMTP_USER and SMTP_PASS on the live server.</p>
        </Card>
        <Card className="p-4"><p className="flex items-center gap-2 text-sm font-bold"><MessageCircle className="size-4" />WhatsApp</p>
          <Badge tone={health?.whatsappConfigured && CLOUD ? 'green' : health ? 'amber' : 'gray'} className="mt-2">{!health ? 'Checking…' : !CLOUD ? 'Live CRM only' : health.whatsappConfigured ? 'Interakt connected' : 'Not set up (Interakt key)'}</Badge>
          <p className="mt-1 text-xs text-mute">Needs INTERAKT_API_KEY on the live server and the template names below. “Sent” means Interakt accepted it — delivery isn’t tracked.</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Reminders" icon={BellRing} />
          <div className="grid gap-4 p-5">
            <Input label="File follow-up: repeat every (days)" type="number" min={1} max={90} value={w.fileReminderDays} onChange={(e) => set({ fileReminderDays: Number(e.target.value) })} hint="For files Legal approves from now on (15 by default). Change one file on its Workflow tab." />
            <Select label="Pitch Deck reminder: every" value={w.precheckDays} onChange={(e) => set({ precheckDays: Number(e.target.value) })}>
              <option value={3}>3 days (default)</option><option value={4}>4 days</option>
            </Select>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-mute">Scheme expiry alert (the day before a scheme ends) goes to</p>
              <div className="grid grid-cols-2 gap-1.5">
                {ROLES.filter((r) => !['it', 'support'].includes(r.id)).map((r) => (
                  <Checkbox key={r.id} label={r.label} checked={w.schemeAlertRoles.includes(r.id)} onChange={(v) => set({ schemeAlertRoles: v ? [...w.schemeAlertRoles, r.id as Role] : w.schemeAlertRoles.filter((x) => x !== r.id) })} />
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Operations contact in the welcome message" subtitle="Empty: the file's Operations person" icon={KeyRound} />
          <div className="grid gap-4 p-5">
            <Input label="Name" value={w.opsContact.name} onChange={(e) => set({ opsContact: { ...w.opsContact, name: e.target.value } })} />
            <Input label="Phone" value={w.opsContact.phone} onChange={(e) => set({ opsContact: { ...w.opsContact, phone: e.target.value } })} />
            <Input label="Email" type="email" value={w.opsContact.email} onChange={(e) => set({ opsContact: { ...w.opsContact, email: e.target.value } })} />
          </div>
        </Card>

        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="Client welcome message" subtitle="Sent once when Legal approves a file and it moves to Operations" icon={Sparkles}
            action={<label className="flex items-center gap-2 text-sm"><Toggle checked={w.welcomeAuto} onChange={(v) => set({ welcomeAuto: v })} label="Send automatically" />Send automatically</label>} />
          <div className="grid gap-5 p-5 lg:grid-cols-2">
            <div className="grid gap-3">
              <Input label="Email subject" value={w.welcomeEmail.subject} onChange={(e) => set({ welcomeEmail: { ...w.welcomeEmail, subject: e.target.value } })} />
              <Textarea label="Email message" rows={12} value={w.welcomeEmail.body} onChange={(e) => set({ welcomeEmail: { ...w.welcomeEmail, body: e.target.value } })} />
              <Textarea label="WhatsApp message (sent by hand with “Open in WhatsApp”)" rows={4} value={w.welcomeWhatsapp} onChange={(e) => set({ welcomeWhatsapp: e.target.value })} hint="Through Interakt the approved template’s own wording is used." />
              <p className="text-[11px] text-mute">Placeholders: {WELCOME_PLACEHOLDERS.join(' ')}. Lines starting with • become a list.</p>
            </div>
            <div className="rounded-2xl bg-card2 p-4 text-sm">
              <p className="text-[11px] font-bold uppercase text-mute">Preview (sample client)</p>
              <p className="mt-2 font-bold">{fillTemplate(w.welcomeEmail.subject, SAMPLE)}</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px]">{fillTemplate(w.welcomeEmail.body, SAMPLE)}</pre>
              <p className="mt-4 text-[11px] font-bold uppercase text-mute">WhatsApp</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-[13px]">{fillTemplate(w.welcomeWhatsapp, SAMPLE)}</pre>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="WhatsApp templates (Interakt)" subtitle="Create each template in Interakt → Templates, wait for Meta's approval, then enter its code name here. Empty = not sent on WhatsApp." icon={MessageCircle} />
          <div className="grid gap-5 p-5 md:grid-cols-2 xl:grid-cols-3">
            <div className="grid content-start gap-2">
              <Input label="Welcome template (text)" placeholder="e.g. client_welcome" value={w.whatsapp.welcomeTemplate} onChange={(e) => set({ whatsapp: { ...w.whatsapp, welcomeTemplate: e.target.value } })} />
              <p className="text-[11px] text-mute">Variables, in this order: {WHATSAPP_WELCOME_VARS.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')}</p>
              <pre className="whitespace-pre-wrap rounded-xl bg-card2 p-3 font-sans text-[12px]">{'Hello {{1}}, welcome to Rexera! Your file {{3}} for {{2}} has been approved and is now with our Operations team. {{4}} will contact you shortly — {{5}}.'}</pre>
            </div>
            <div className="grid content-start gap-2">
              <Input label="Invoice template (document header)" placeholder="e.g. invoice_pdf" value={w.whatsapp.invoiceTemplate} onChange={(e) => set({ whatsapp: { ...w.whatsapp, invoiceTemplate: e.target.value } })} />
              <p className="text-[11px] text-mute">Header: Document (the PDF). Variables: {WHATSAPP_INVOICE_VARS.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')}</p>
              <pre className="whitespace-pre-wrap rounded-xl bg-card2 p-3 font-sans text-[12px]">{'Dear {{1}}, please find attached your {{2}} for {{3}}. Thank you for choosing {{4}}.'}</pre>
            </div>
            <div className="grid content-start gap-2">
              <Input label="Form link template (Document Form Builder)" placeholder="e.g. form_link" value={w.whatsapp.formTemplate} onChange={(e) => set({ whatsapp: { ...w.whatsapp, formTemplate: e.target.value } })} />
              <p className="text-[11px] text-mute">Variables: {WHATSAPP_FORM_VARS.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')}</p>
              <pre className="whitespace-pre-wrap rounded-xl bg-card2 p-3 font-sans text-[12px]">{'Dear {{1}}, please open this secure link to complete "{{2}}": {{3}} — {{4}}'}</pre>
            </div>
            <div className="grid content-start gap-2">
              <Input label="Client notification template (WhatsApp button)" placeholder="e.g. client_update" value={w.whatsapp.notifyTemplate} onChange={(e) => set({ whatsapp: { ...w.whatsapp, notifyTemplate: e.target.value } })} />
              <p className="text-[11px] text-mute">Variables: {WHATSAPP_NOTIFY_VARS.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')}. Used by the WhatsApp button on a CRM entry (Operation, Admin and Legal teams). Empty = the button opens WhatsApp with the message typed in instead.</p>
              <pre className="whitespace-pre-wrap rounded-xl bg-card2 p-3 font-sans text-[12px]">{'Dear {{1}}, an update on your file {{2}}: {{3}} — {{4}}'}</pre>
            </div>
            <div className="grid content-start gap-2">
              <Input label="Template language code" placeholder="en" value={w.whatsapp.language} onChange={(e) => set({ whatsapp: { ...w.whatsapp, language: e.target.value } })} hint="The language the templates were created in (en, en_US, hi …)." />
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6 flex flex-wrap gap-2 p-4">
        <Link to="/forms"><Button variant="outline" icon={FileSignature}>Document Form Builder</Button></Link>
        <Link to="/schemes"><Button variant="outline" icon={Sparkles}>Schemes</Button></Link>
        <Link to="/ops-desk"><Button variant="outline" icon={BellRing}>Operations Dashboard</Button></Link>
        <Link to="/audit"><Button variant="outline" icon={ScrollText}>Activity log</Button></Link>
      </Card>
    </div>
  )
}
