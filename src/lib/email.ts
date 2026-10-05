import type { AutomationKey, DB, EmailAutomation, EmailMsg, Role, User } from './types'
import { effectivePerms, roleLabel, rolesOf } from './rbac'
import { getDb, mutate } from './store'
import { addDays, nowIso, today, uid, ymd } from './format'
import { automationMeta } from './emailTemplates'

/**
 * Email Center. Emails go to each person's login email address. This build has no SMTP server, so every email is
 * delivered to the person's CRM inbox (sidebar "Email" + a bell notification); "Open in mail app" sends the same
 * message from Outlook/Gmail. When the backend's SMTP is connected, these records are what it sends.
 */

export { AUTOMATIONS, automationMeta, defaultAutomations } from './emailTemplates'

export const PLACEHOLDERS = ['{first_name}', '{name}', '{email}', '{role}', '{department}', '{designation}', '{company}', '{login_url}', '{date}']
const loginUrl = () => (typeof location !== 'undefined' ? `${location.origin}/login` : '/login')

export function fill(text: string, u: User | undefined, d: DB, extra: Record<string, string | number> = {}) {
  const vars: Record<string, string | number> = {
    name: u?.name ?? '', first_name: u?.name.split(' ')[0] ?? '', email: u?.email ?? '', role: u ? roleLabel(u.role) : '',
    department: u?.department ?? '', designation: u?.designation ?? '', company: d.settings.companyName, login_url: loginUrl(),
    date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), ...extra,
  }
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/** Writes personalised emails into the data (inside a mutate) and rings each person's bell. */
export function deliver(d: DB, from: string, recipients: User[], subject: string, body: string, opts: { automation?: AutomationKey; extra?: (u: User) => Record<string, string | number> } = {}) {
  const batchId = uid('eb-')
  const at = nowIso()
  for (const u of recipients) {
    const extra = opts.extra?.(u) ?? {}
    const msg: EmailMsg = { id: uid('em-'), batchId, to: u.id, toEmail: u.email, from, subject: fill(subject, u, d, extra), body: fill(body, u, d, extra), at, automation: opts.automation, read: false }
    d.emails.unshift(msg)
    d.notices.unshift({ id: uid('n-'), userId: u.id, title: `✉️ ${msg.subject}`, body: `Email from ${from === 'system' ? 'Rexera CRM' : d.users.find((x) => x.id === from)?.name ?? 'HR'}`, link: '/inbox', at, read: false, kind: 'info' })
  }
  if (d.emails.length > 3000) d.emails.length = 3000
  return { batchId, count: recipients.length }
}

/** Event automations, called from inside actions' mutate(). */
export function fireAutomation(d: DB, key: AutomationKey, recipients: User[], extra: (u: User) => Record<string, string | number> = () => ({})) {
  const a = d.emailAutomations?.find((x) => x.key === key)
  const people = recipients.filter((u) => u.active && u.email)
  if (!a?.enabled || !people.length) return
  deliver(d, 'system', people, a.subject, a.body, { automation: key, extra })
  a.sent += people.length
  a.lastRunAt = nowIso()
}

// ------------------------------------------------------------------ manual sending
export function canEmail(me: User) { return effectivePerms(getDb(), me).has('email.send') }

export function sendEmail(me: User, recipientIds: string[], subject: string, body: string) {
  if (!canEmail(me)) throw new Error("You don't have access to send emails.")
  if (!subject.trim()) throw new Error('Add a subject.')
  if (body.trim().length < 3) throw new Error('Write a message.')
  return mutate((d) => {
    // anyone @mentioned in the message is added too
    const mentioned = [...body.matchAll(/@([\w.]+)/g)].map((m) => d.users.find((u) => u.username.toLowerCase() === m[1]!.toLowerCase())?.id).filter(Boolean) as string[]
    const ids = new Set([...recipientIds, ...mentioned])
    const people = d.users.filter((u) => ids.has(u.id) && u.active && u.email)
    if (!people.length) throw new Error('Pick at least one recipient.')
    const r = deliver(d, me.id, people, subject.trim(), body)
    d.audit.unshift({ id: uid('a-'), at: nowIso(), by: me.id, action: 'EMAIL_SEND', detail: `“${subject.trim()}” to ${people.length} people` })
    return r
  })
}

/** Removes a sent email from every recipient's inbox (e.g. sent by mistake). */
export function deleteBatch(me: User, batchId: string) {
  if (!canEmail(me)) throw new Error("You don't have access to do that.")
  mutate((d) => {
    const msgs = d.emails.filter((e) => e.batchId === batchId)
    if (!msgs.length) throw new Error('Email not found.')
    d.emails = d.emails.filter((e) => e.batchId !== batchId)
    d.audit.unshift({ id: uid('a-'), at: nowIso(), by: me.id, action: 'EMAIL_DELETE', detail: `“${msgs[0]!.subject}” removed from ${msgs.length} inbox(es)` })
  })
}

export function mailtoLink(emails: string[], subject: string, body: string) {
  return `mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export function markEmailRead(me: User, id?: string) {
  mutate((d) => { for (const e of d.emails) if (e.to === me.id && (!id || e.id === id)) e.read = true })
}

export function saveAutomation(me: User, key: AutomationKey, patch: Partial<Pick<EmailAutomation, 'enabled' | 'subject' | 'body'>>) {
  if (!canEmail(me)) throw new Error("You don't have access to change automations.")
  if (patch.subject !== undefined && !patch.subject.trim()) throw new Error('Subject cannot be empty.')
  if (patch.body !== undefined && patch.body.trim().length < 3) throw new Error('Message cannot be empty.')
  mutate((d) => {
    const a = d.emailAutomations.find((x) => x.key === key)!
    Object.assign(a, patch)
    d.audit.unshift({ id: uid('a-'), at: nowIso(), by: me.id, action: 'EMAIL_AUTOMATION', detail: `${automationMeta(key).name}: ${'enabled' in patch ? (patch.enabled ? 'on' : 'off') : 'template edited'}` })
  })
}

/** Sends the automation's email to yourself with sample values so HR can check the wording. */
export function sendTest(me: User, key: AutomationKey) {
  if (!canEmail(me)) throw new Error("You don't have access to do that.")
  mutate((d) => {
    const a = d.emailAutomations.find((x) => x.key === key)!
    const prev = ymd(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1))
    deliver(d, 'system', [d.users.find((u) => u.id === me.id)!], `[TEST] ${a.subject}`, a.body, {
      automation: key,
      extra: () => ({ status: 'approved', leave_type: 'CL', leave_dates: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), leave_days: 1, decided_by: me.name, remark: '', month: monthName(prev.slice(0, 7)), present: 22, leave: 1, years: 2, title: 'Sample company update', message: 'This is how a broadcast email looks.' }),
    })
  })
}

// ------------------------------------------------------------------ scheduled automations (run whenever the app is open)
const monthName = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

/** Idempotent: each daily/monthly automation runs at most once per day/month, whichever browser runs it first. */
export function runScheduledAutomations() {
  const d0 = getDb()
  if (!d0?.emailAutomations) return 0
  const now = new Date()
  const t = today()
  const month = t.slice(0, 7)
  const due = d0.emailAutomations.filter((a) => {
    if (!a.enabled) return false
    if (a.key === 'start-day-reminder') return now.getDay() !== 0 && now.getHours() * 60 + now.getMinutes() >= 630 && a.lastRunKey !== t
    if (a.key === 'work-anniversary') return a.lastRunKey !== t
    if (a.key === 'monthly-attendance') return a.lastRunKey !== month
    return false
  })
  if (!due.length) return 0
  let sent = 0
  mutate((d) => {
    const active = d.users.filter((u) => u.active && u.email)
    for (const a of d.emailAutomations) {
      if (!due.some((x) => x.key === a.key)) continue
      let people: User[] = []
      let extra: (u: User) => Record<string, string | number> = () => ({})
      if (a.key === 'start-day-reminder') {
        const onLeave = new Set(d.leaves.filter((l) => l.status === 'APPROVED' && l.from <= t && l.to >= t).map((l) => l.userId))
        people = active.filter((u) => !onLeave.has(u.id) && !d.sessions.some((s) => s.userId === u.id && s.date === t) && u.joinedOn <= t)
        a.lastRunKey = t
      } else if (a.key === 'work-anniversary') {
        const md = t.slice(5)
        people = active.filter((u) => u.joinedOn.slice(5) === md && u.joinedOn.slice(0, 4) < t.slice(0, 4))
        extra = (u) => ({ years: Number(t.slice(0, 4)) - Number(u.joinedOn.slice(0, 4)) })
        a.lastRunKey = t
      } else if (a.key === 'monthly-attendance') {
        a.lastRunKey = month
        // only on the 1st–3rd, so turning it on mid-month doesn't send an old summary
        if (now.getDate() <= 3) {
          const prev = ymd(addDays(new Date(now.getFullYear(), now.getMonth(), 1), -1)).slice(0, 7)
          people = active.filter((u) => u.joinedOn.slice(0, 7) <= prev)
          extra = (u) => {
            const present = new Set(d.sessions.filter((s) => s.userId === u.id && s.date.startsWith(prev)).map((s) => s.date)).size
            const leave = d.leaves.filter((l) => l.userId === u.id && l.status === 'APPROVED').reduce((n, l) => {
              let c = 0
              for (let x = new Date(l.from + 'T00:00:00'); ymd(x) <= l.to; x = addDays(x, 1)) if (ymd(x).startsWith(prev)) c++
              return n + c
            }, 0)
            return { month: monthName(prev), present, leave }
          }
        }
      }
      if (people.length) {
        deliver(d, 'system', people, a.subject, a.body, { automation: a.key, extra })
        a.sent += people.length
        sent += people.length
      }
      a.lastRunAt = nowIso()
    }
  })
  return sent
}

export const rolesForPicker = (d: DB) => [...new Set(d.users.filter((u) => u.active).flatMap((u) => rolesOf(u)))] as Role[]
