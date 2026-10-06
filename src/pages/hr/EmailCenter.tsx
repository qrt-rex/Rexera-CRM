import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AtSign, Bot, Clock, ExternalLink, Eye, Mail, MailCheck, Pencil, Play, Send, Sparkles, TestTube2, Trash2, Users, X } from 'lucide-react'
import type { AutomationKey, EmailMsg, Role } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { AUTOMATIONS, PLACEHOLDERS, automationMeta, deleteBatch, fill, mailtoLink, rolesForPicker, runScheduledAutomations, saveAutomation, sendEmail, sendTest } from '../../lib/email'
import { roleLabel } from '../../lib/rbac'
import { ago, fmtDateTime } from '../../lib/format'
import { Avatar, Badge, Button, Card, CardHeader, cx, Drawer, EmptyState, Input, Modal, PageHeader, Tabs, Textarea, Toggle, useConfirm, useRun, useToast } from '../../components/ui'

type Tab = 'compose' | 'sent' | 'automations'
const AUTO_VARS: Partial<Record<AutomationKey, string[]>> = {
  'leave-decision': ['{status}', '{leave_type}', '{leave_dates}', '{leave_days}', '{decided_by}', '{remark}'],
  'payslip-ready': ['{month}'], 'monthly-attendance': ['{month}', '{present}', '{leave}'], 'work-anniversary': ['{years}'], 'broadcast-copy': ['{title}', '{message}'],
}

export default function EmailCenter() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'compose'
  const db = useDb()
  return (
    <div>
      <PageHeader title="Email Center" subtitle="Email people at their login address · automations send the routine ones for you" icon={Mail}
        actions={<Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ id: 'compose', label: 'Compose', icon: Send }, { id: 'sent', label: 'Sent', icon: MailCheck, count: new Set(db.emails.map((e) => e.batchId)).size }, { id: 'automations', label: 'Automations', icon: Bot, count: db.emailAutomations.filter((a) => a.enabled).length }]} />} />
      <Card className="mb-5 flex items-start gap-3 p-4 text-sm">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-accent" />
        <p className="text-mute">Emails are delivered to each person's <b className="text-ink">CRM inbox</b> (sidebar → Email) and ring their bell. No mail server is connected yet, so use <b className="text-ink">Open in mail app</b> to send the same email from Outlook or Gmail; once the server's SMTP is connected these go out automatically.</p>
      </Card>
      {tab === 'compose' && <Compose onSent={() => setParams({ tab: 'sent' })} />}
      {tab === 'sent' && <Sent />}
      {tab === 'automations' && <Automations />}
    </div>
  )
}

// ------------------------------------------------------------------ compose
function Compose({ onSent }: { onSent: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const people = useMemo(() => db.users.filter((u) => u.active && u.email).sort((a, b) => a.name.localeCompare(b.name)), [db.users])
  const [to, setTo] = useState<string[]>([])
  const [find, setFind] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('Hi {first_name},\n\n\n\nRegards,\n' + me.name)
  const [mention, setMention] = useState<{ q: string; start: number } | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const add = (ids: string[]) => setTo((cur) => [...new Set([...cur, ...ids])])
  const recipients = people.filter((u) => to.includes(u.id))
  const matches = find.trim() ? people.filter((u) => !to.includes(u.id) && `${u.name} ${u.email} ${u.username} ${u.department}`.toLowerCase().includes(find.toLowerCase())).slice(0, 8) : []
  const mentionMatches = mention ? people.filter((u) => `${u.name} ${u.username}`.toLowerCase().includes(mention.q.toLowerCase())).slice(0, 6) : []
  const departments = [...new Set(people.map((u) => u.department))].sort()

  const onBody = (v: string, caret: number) => {
    setBody(v)
    const m = v.slice(0, caret).match(/(^|\s)@([\w.]*)$/)
    setMention(m ? { q: m[2]!, start: caret - m[2]!.length - 1 } : null)
  }
  const pickMention = (id: string) => {
    const u = people.find((x) => x.id === id)!
    if (!mention || !area.current) return
    const caret = area.current.selectionStart
    const next = body.slice(0, mention.start) + '@' + u.username + ' ' + body.slice(caret)
    setBody(next); add([u.id]); setMention(null)
    setTimeout(() => { area.current?.focus(); const p = mention.start + u.username.length + 2; area.current?.setSelectionRange(p, p) }, 0)
  }
  const insert = (token: string) => {
    const el = area.current
    const pos = el ? el.selectionStart : body.length
    setBody(body.slice(0, pos) + token + body.slice(pos))
    setTimeout(() => { el?.focus(); el?.setSelectionRange(pos + token.length, pos + token.length) }, 0)
  }
  const send = async () => {
    const r = await run(() => sendEmail(me, to, subject, body))
    if (r && typeof r === 'object') { toast('success', `Email delivered to ${r.count} ${r.count === 1 ? 'person' : 'people'}`); setTo([]); setSubject(''); onSent() }
  }
  const mailApp = () => {
    const generic = fill(body, undefined, db).replace(/Hi ,/g, 'Hi all,')
    const link = mailtoLink(recipients.map((u) => u.email), subject, generic)
    if (link.length > 1900) toast('warning', 'The message is long — your mail app may cut it. Consider sending a shorter version.')
    window.location.href = link
  }
  const preview = recipients[0] ?? me

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Card className="overflow-hidden">
        <CardHeader title="New email" icon={Send} />
        <div className="space-y-4 p-5">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-mute">To <span className="text-bad">*</span> · login email addresses</span>
              <span className="ml-auto flex flex-wrap gap-1.5">
                <button className="rounded-full border border-line px-2.5 py-0.5 text-[11px] font-semibold hover:bg-card2" onClick={() => add(people.map((u) => u.id))}>Everyone ({people.length})</button>
                <select className="h-7 rounded-full border border-line bg-card px-2 text-[11px] font-semibold" value="" aria-label="Add a role" onChange={(e) => { const r = e.target.value as Role; if (r) add(people.filter((u) => u.role === r || u.extraRoles.includes(r)).map((u) => u.id)) }}>
                  <option value="">+ Role</option>{rolesForPicker(db).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </select>
                <select className="h-7 rounded-full border border-line bg-card px-2 text-[11px] font-semibold" value="" aria-label="Add a department" onChange={(e) => { const dep = e.target.value; if (dep) add(people.filter((u) => u.department === dep).map((u) => u.id)) }}>
                  <option value="">+ Department</option>{departments.map((d) => <option key={d}>{d}</option>)}
                </select>
              </span>
            </div>
            <div className="relative rounded-xl border border-line bg-card p-2 focus-within:border-brand">
              <div className="flex flex-wrap gap-1.5">
                {recipients.map((u) => (
                  <span key={u.id} title={u.email} className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pl-1 pr-1.5 text-xs font-semibold text-brand-ink">
                    <Avatar name={u.name} photo={u.photo} size={18} />{u.name}
                    <button aria-label={`Remove ${u.name}`} onClick={() => setTo(to.filter((x) => x !== u.id))} className="rounded-full hover:bg-brand/10"><X className="size-3" /></button>
                  </span>
                ))}
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={recipients.length ? 'Add more…' : 'Type a name, email or department…'} aria-label="Find recipients"
                  className="h-7 min-w-40 flex-1 bg-transparent px-1 text-sm outline-none"
                  onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) { add([matches[0].id]); setFind('') } if (e.key === 'Backspace' && !find && to.length) setTo(to.slice(0, -1)) }} />
              </div>
              {matches.length > 0 && (
                <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-card shadow-pop">
                  {matches.map((u) => (
                    <li key={u.id}><button onClick={() => { add([u.id]); setFind('') }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-card2">
                      <Avatar name={u.name} photo={u.photo} size={24} /><span className="flex-1"><b>{u.name}</b> <span className="text-xs text-mute">{u.email}</span></span><span className="text-[11px] text-mute">{roleLabel(u.role)}</span>
                    </button></li>
                  ))}
                </ul>
              )}
            </div>
            {to.length > 0 && <p className="mt-1 flex items-center gap-2 text-xs text-mute"><Users className="size-3.5" />{to.length} recipient{to.length === 1 ? '' : 's'} · <button className="hover:underline" onClick={() => setTo([])}>clear</button></p>}
          </div>

          <Input label="Subject" required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Office closed on Friday" />

          <div className="relative">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-mute">Message <span className="text-bad">*</span> · type <AtSign className="size-3" /> to mention and add someone</span>
            <textarea ref={area} value={body} rows={10} onChange={(e) => onBody(e.target.value, e.target.selectionStart)} onKeyDown={(e) => { if (mention && e.key === 'Enter' && mentionMatches[0]) { e.preventDefault(); pickMention(mentionMatches[0].id) } if (e.key === 'Escape') setMention(null) }}
              className="w-full resize-y rounded-xl border border-line bg-card px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" aria-label="Message" />
            {mention && mentionMatches.length > 0 && (
              <ul className="absolute left-3 z-20 mt-1 w-72 overflow-hidden rounded-xl border border-line bg-card shadow-pop">
                {mentionMatches.map((u) => (
                  <li key={u.id}><button onClick={() => pickMention(u.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-card2">
                    <Avatar name={u.name} photo={u.photo} size={22} /><span className="flex-1"><b>{u.name}</b> <span className="text-xs text-mute">@{u.username}</span></span>
                  </button></li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">{PLACEHOLDERS.map((p) => <button key={p} onClick={() => insert(p)} className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-accent hover:brightness-95">{p}</button>)}</div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <Button variant="outline" icon={ExternalLink} disabled={!recipients.length || !subject.trim()} onClick={mailApp}>Open in mail app</Button>
            <Button variant="accent" icon={Send} disabled={!to.length} onClick={send}>Send to {to.length || '…'}</Button>
          </div>
        </div>
      </Card>

      <Card className="h-fit overflow-hidden xl:sticky xl:top-24">
        <CardHeader title="Preview" subtitle={`As ${preview.name} will see it`} icon={Eye} />
        <div className="space-y-2 p-5 text-sm">
          <p className="text-xs text-mute">To: {preview.email}</p>
          <p className="font-bold">{fill(subject || '(no subject)', preview, db)}</p>
          <p className="whitespace-pre-line rounded-xl bg-card2 p-3 leading-relaxed">{fill(body, preview, db)}</p>
        </div>
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ sent
function Sent() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const [open, setOpen] = useState<EmailMsg[] | null>(null)
  const batches = useMemo(() => {
    const m = new Map<string, EmailMsg[]>()
    for (const e of db.emails) m.set(e.batchId, [...(m.get(e.batchId) ?? []), e])
    return [...m.values()].sort((a, b) => b[0]!.at.localeCompare(a[0]!.at))
  }, [db.emails])
  return (
    <Card className="overflow-hidden">
      {!batches.length ? <EmptyState icon={MailCheck} title="Nothing sent yet" text="Emails you send and automation emails appear here." /> : (
        <ul className="divide-y divide-line/70">
          {batches.slice(0, 100).map((b) => {
            const first = b[0]!
            const read = b.filter((e) => e.read).length
            return (
              <li key={first.batchId}>
                <button onClick={() => setOpen(b)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-card2">
                  <span className={cx('grid size-9 shrink-0 place-items-center rounded-xl', first.automation ? 'bg-violet-500/12 text-violet-600 dark:text-violet-300' : 'bg-brand-soft text-brand-ink')}>{first.automation ? <Bot className="size-4" /> : <Send className="size-4" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{first.subject}</span>
                    <span className="block truncate text-xs text-mute">{first.automation ? `Automation · ${automationMeta(first.automation as AutomationKey).name}` : `By ${userName(db, first.from)}`} · to {b.length === 1 ? first.toEmail : `${b.length} people`}</span>
                  </span>
                  <Badge tone={read === b.length ? 'green' : 'gray'}>{read}/{b.length} read</Badge>
                  <span className="text-xs text-mute">{ago(first.at)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.[0]?.subject} subtitle={open && `${fmtDateTime(open[0]!.at)} · ${open.length} recipient(s)`}
        footer={open && <Button variant="outline" icon={Trash2} className="text-bad" onClick={async () => {
          if (await confirm('Delete this email?', `It is removed from ${open.length} inbox(es). This can't be undone.`, true) && await run(() => deleteBatch(me, open[0]!.batchId), 'Email deleted')) setOpen(null)
        }}>Delete from inboxes</Button>}>
        {open && (
          <div className="space-y-5 text-sm">
            <p className="whitespace-pre-line rounded-xl bg-card2 p-4 leading-relaxed">{open[0]!.body}</p>
            <div>
              <p className="mb-2 font-bold">Recipients</p>
              <ul className="divide-y divide-line/70 rounded-xl border border-line">
                {open.map((e) => <li key={e.id} className="flex items-center gap-2 px-3 py-2"><span className="flex-1"><b>{userName(db, e.to)}</b> <span className="text-xs text-mute">{e.toEmail}</span></span><Badge tone={e.read ? 'green' : 'gray'}>{e.read ? 'read' : 'unread'}</Badge></li>)}
              </ul>
            </div>
          </div>
        )}
      </Drawer>
      {confirmNode}
    </Card>
  )
}

// ------------------------------------------------------------------ automations
function Automations() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [edit, setEdit] = useState<{ key: AutomationKey; subject: string; body: string } | null>(null)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {AUTOMATIONS.map((meta) => {
        const a = db.emailAutomations.find((x) => x.key === meta.key)!
        return (
          <Card key={meta.key} className={cx('p-5 transition', !a.enabled && 'opacity-70')}>
            <div className="flex items-start gap-3">
              <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', a.enabled ? 'bg-ok-soft text-ok' : 'bg-card2 text-mute')}>{meta.schedule === 'event' ? <Bot className="size-5" /> : <Clock className="size-5" />}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold">{meta.name}</p>
                <p className="text-xs text-mute">{meta.when}</p>
              </div>
              <Toggle checked={a.enabled} label={`${meta.name} on/off`} onChange={(v) => run(() => saveAutomation(me, meta.key, { enabled: v }), v ? 'Automation on' : 'Automation off')} />
            </div>
            <p className="mt-3 truncate rounded-lg bg-card2 px-3 py-2 text-sm"><b>Subject:</b> {a.subject}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-mute">
              <span>{a.sent} sent</span>{a.lastRunAt && <span>· last {ago(a.lastRunAt)}</span>}
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" icon={TestTube2} onClick={() => run(() => sendTest(me, meta.key), 'Test email sent to your inbox')}>Test to me</Button>
                {meta.schedule !== 'event' && <Button size="sm" variant="ghost" icon={Play} onClick={() => run(() => { const n = runScheduledAutomations(); if (!n) throw new Error('Nothing due right now — scheduled emails run once per day/month at their time.') }, 'Due emails sent')}>Run due now</Button>}
                <Button size="sm" variant="soft" icon={Pencil} onClick={() => setEdit({ key: meta.key, subject: a.subject, body: a.body })}>Edit</Button>
              </span>
            </div>
          </Card>
        )
      })}
      <Modal open={!!edit} onClose={() => setEdit(null)} size="lg" title={edit ? `Edit · ${automationMeta(edit.key).name}` : ''}
        footer={<><Button variant="outline" onClick={() => edit && setEdit({ ...edit, subject: automationMeta(edit.key).subject, body: automationMeta(edit.key).body })}>Restore default</Button><Button onClick={async () => { if (edit && await run(() => saveAutomation(me, edit.key, { subject: edit.subject, body: edit.body }), 'Template saved')) setEdit(null) }}>Save</Button></>}>
        {edit && <div className="grid gap-4">
          <Input label="Subject" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
          <Textarea label="Message" rows={10} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          <div className="flex flex-wrap gap-1.5">{[...PLACEHOLDERS, ...(AUTO_VARS[edit.key] ?? [])].map((p) => <span key={p} className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-accent">{p}</span>)}</div>
        </div>}
      </Modal>
    </div>
  )
}
