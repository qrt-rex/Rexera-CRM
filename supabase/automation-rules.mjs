// Automation Center — the rule engine behind the CRM's own automations ("when this happens, and these conditions
// hold, do that"). Only IT Support creates and edits rules and switches the built-in automations on or off; the rules
// run in the browser that made the change (events) or in Super Admin / IT browsers (daily checks).
//
// The engine is plain data in, plain data out, so it is tested on its own: a record becomes "facts" (values to
// check and texts to show), conditions test the facts, and actions are filled-in texts the app then carries out.

/** What can start a rule. A daily check looks at every record of one kind (e.g. CRM entries stuck in a status). */
export const TRIGGERS = [
  { id: 'booking.created', label: 'A CRM entry is submitted', entity: 'booking' },
  { id: 'booking.status', label: 'A CRM entry changes status', entity: 'booking' },
  { id: 'booking.stage', label: 'A file moves to another processing stage', entity: 'booking' },
  { id: 'booking.payment', label: 'A payment is added to a CRM entry', entity: 'booking' },
  { id: 'booking.document', label: 'A document is uploaded to a CRM entry', entity: 'booking' },
  { id: 'lead.created', label: 'A new lead comes in', entity: 'lead' },
  { id: 'lead.assigned', label: 'A lead is assigned to someone', entity: 'lead' },
  { id: 'lead.status', label: 'A lead’s status changes', entity: 'lead' },
  { id: 'clientEntry.created', label: 'A client entry is saved', entity: 'clientEntry' },
  { id: 'clientEntry.status', label: 'A client entry’s status changes', entity: 'clientEntry' },
  { id: 'invoice.created', label: 'An invoice is created', entity: 'invoice' },
  { id: 'invoice.paid', label: 'An invoice is fully paid', entity: 'invoice' },
  { id: 'leave.requested', label: 'Leave is requested', entity: 'leave' },
  { id: 'leave.decided', label: 'Leave is approved or rejected', entity: 'leave' },
  { id: 'user.created', label: 'A new employee is added', entity: 'user' },
  { id: 'schedule.daily', label: 'Every day — check records', schedule: true },
]
export const ENTITY_LABELS = { booking: 'CRM entries', lead: 'Leads', clientEntry: 'Client entries', invoice: 'Invoices', leave: 'Leave requests', user: 'Employees' }
export const triggerOf = (id) => TRIGGERS.find((t) => t.id === id)
/** The kind of record a rule works on: the trigger's, or the one a daily check looks at. */
export const ruleEntity = (r) => triggerOf(r.trigger)?.entity ?? r.entity

export const OPS = {
  select: [{ id: 'eq', label: 'is' }, { id: 'neq', label: 'is not' }, { id: 'in', label: 'is one of' }, { id: 'not_in', label: 'is not one of' }],
  text: [{ id: 'contains', label: 'contains' }, { id: 'not_contains', label: 'does not contain' }, { id: 'eq', label: 'is exactly' }, { id: 'empty', label: 'is empty' }, { id: 'not_empty', label: 'is filled in' }],
  number: [{ id: 'gte', label: 'at least' }, { id: 'gt', label: 'more than' }, { id: 'lte', label: 'at most' }, { id: 'lt', label: 'less than' }, { id: 'eq', label: 'equals' }],
  bool: [{ id: 'is', label: 'is' }],
}
/** money and days compare like numbers */
export const opsFor = (type) => OPS[type === 'money' || type === 'days' ? 'number' : type] ?? OPS.text

/** Who gets a notification / email / task. */
export const RECIPIENTS = [
  { id: 'owner', label: 'The record’s person (sales person, lead owner, applicant…)' },
  { id: 'teamlead', label: 'Their team leader' },
  { id: 'ops', label: 'Operations person on the file', entity: 'booking' },
  { id: 'admin', label: 'Admin on the file', entity: 'booking' },
  { id: 'role', label: 'Everyone with a role' },
  { id: 'user', label: 'A particular person' },
]
export const ACTIONS = [
  { id: 'notify', label: 'Send a bell notification' },
  { id: 'email', label: 'Send an email (CRM inbox)' },
  { id: 'task', label: 'Add a task to the file', entity: 'booking' },
  { id: 'comment', label: 'Add a note to the file', entity: 'booking' },
  { id: 'priority', label: 'Set the file’s priority', entity: 'booking' },
]
export const REPEAT = [{ id: 0, label: 'Once per record' }, { id: 1, label: 'Every day while it matches' }, { id: 3, label: 'Every 3 days while it matches' }, { id: 7, label: 'Every 7 days while it matches' }]
export const MAX_PER_RUN = 25

const blank = (v) => v === undefined || v === null || v === ''
/** Does one condition hold for these facts? `type` is the field's type. An unknown value never matches (except "is empty"). */
export function testCondition(c, facts, type) {
  const v = facts.values?.[c.field]
  if (c.op === 'empty') return blank(v)
  if (c.op === 'not_empty') return !blank(v)
  if (blank(v)) return false
  if (type === 'bool') return v === (c.value === true || c.value === 'true')
  if (type === 'number' || type === 'money' || type === 'days') {
    const n = Number(v), x = Number(c.value)
    if (!Number.isFinite(n) || !Number.isFinite(x)) return false
    return c.op === 'gte' ? n >= x : c.op === 'gt' ? n > x : c.op === 'lte' ? n <= x : c.op === 'lt' ? n < x : c.op === 'eq' ? n === x : false
  }
  const s = String(v).toLowerCase(), want = String(c.value ?? '').toLowerCase()
  switch (c.op) {
    case 'eq': return s === want
    case 'neq': return s !== want
    case 'in': return (c.values ?? []).map((x) => String(x).toLowerCase()).includes(s)
    case 'not_in': return !(c.values ?? []).map((x) => String(x).toLowerCase()).includes(s)
    case 'contains': return !!want && s.includes(want)
    case 'not_contains': return !want || !s.includes(want)
  }
  return false
}
/** All conditions (or any one, with match = 'any'); no conditions = always. `fields` maps a field to its type. */
export function ruleMatches(rule, facts, fields) {
  const conds = rule.conditions ?? []
  if (!conds.length) return true
  const test = (c) => testCondition(c, facts, fields[c.field]?.type ?? 'text')
  return rule.match === 'any' ? conds.some(test) : conds.every(test)
}

/** {placeholders} → the record's texts; unknown ones are left as typed (the email adds {first_name} etc. per person). */
export const fillText = (text, facts) => String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (facts.text && k in facts.text ? String(facts.text[k]) : m))

/** Day number (IST date YYYY-MM-DD → days since 1970) for "every n days" periods. */
const dayNo = (ymd) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86400000)
/**
 * The id of one daily-check run for one record: the same id again means "already done" (once per record, or once per
 * period of `repeatDays`), so several browsers never repeat it.
 */
export function scheduleRunId(rule, recordId, today) {
  const every = Number(rule.repeatDays) || 0
  return `ar-${rule.id}-${recordId}${every ? `-${Math.floor(dayNo(today) / every)}` : ''}`.slice(0, 180)
}

/** Everything wrong with a rule before it is saved (empty = it can be saved). */
export function ruleProblems(rule, fieldsByEntity) {
  const p = []
  if (!rule || typeof rule !== 'object') return ['Nothing to save.']
  if (!rule.name?.trim() || rule.name.trim().length < 3) p.push('Give the rule a name.')
  if (rule.name && rule.name.length > 120) p.push('Keep the name under 120 characters.')
  const t = triggerOf(rule.trigger)
  if (!t) p.push('Pick when the rule runs.')
  const entity = ruleEntity(rule)
  if (t?.schedule && !ENTITY_LABELS[rule.entity]) p.push('Pick which records the daily check looks at.')
  const fields = fieldsByEntity[entity] ?? {}
  const conds = rule.conditions ?? []
  if (conds.length > 15) p.push('Up to 15 conditions.')
  if (t?.schedule && !conds.length) p.push('A daily check needs at least one condition — otherwise it would act on every record.')
  conds.forEach((c, i) => {
    const what = `Condition ${i + 1}`
    const f = fields[c.field]
    if (!f) { p.push(`${what}: pick what to check`); return }
    if (!opsFor(f.type).some((o) => o.id === c.op)) p.push(`${what}: pick how to compare`)
    else if (c.op === 'in' || c.op === 'not_in') { if (!c.values?.length) p.push(`${what}: tick at least one`) }
    else if (f.type === 'bool') { if (typeof c.value !== 'boolean') p.push(`${what}: pick Yes or No`) }
    else if (['number', 'money', 'days'].includes(f.type)) { if (blank(c.value) || !Number.isFinite(Number(c.value))) p.push(`${what}: enter a number`) }
    else if (!['empty', 'not_empty'].includes(c.op) && blank(c.value)) p.push(`${what}: enter a value`)
  })
  const acts = rule.actions ?? []
  if (!acts.length) p.push('Add at least one action.')
  if (acts.length > 10) p.push('Up to 10 actions.')
  acts.forEach((a, i) => {
    const what = `Action ${i + 1}`
    const def = ACTIONS.find((x) => x.id === a.type)
    if (!def) { p.push(`${what}: pick what to do`); return }
    if (def.entity && def.entity !== entity) p.push(`${what}: “${def.label}” only works on CRM entries`)
    if (['notify', 'email', 'task'].includes(a.type)) {
      const to = a.to ?? []
      if (!to.length) p.push(`${what}: pick who gets it`)
      for (const r of to) {
        const rd = RECIPIENTS.find((x) => x.id === r.kind)
        if (!rd) p.push(`${what}: unknown recipient`)
        else if (rd.entity && rd.entity !== entity) p.push(`${what}: “${rd.label}” is only for CRM entries`)
        else if (r.kind === 'role' && !r.role) p.push(`${what}: pick the role`)
        else if (r.kind === 'user' && !r.userId) p.push(`${what}: pick the person`)
      }
    }
    if (a.type === 'notify' && !a.title?.trim()) p.push(`${what}: write the notification title`)
    if (a.type === 'email' && (!a.subject?.trim() || (a.body ?? '').trim().length < 3)) p.push(`${what}: write the email subject and message`)
    if (a.type === 'task' && (!a.title?.trim() || !Number.isInteger(Number(a.dueInDays)) || Number(a.dueInDays) < 0 || Number(a.dueInDays) > 365)) p.push(`${what}: write the task and its due date (0–365 days)`)
    if (a.type === 'comment' && (a.text ?? '').trim().length < 3) p.push(`${what}: write the note`)
    if (a.type === 'priority' && !['LOW', 'MEDIUM', 'HIGH'].includes(a.value)) p.push(`${what}: pick the priority`)
    for (const k of ['title', 'body', 'subject', 'text']) if (a[k] && String(a[k]).length > 2000) p.push(`${what}: keep texts under 2000 characters`)
  })
  if (![0, 1, 3, 7].includes(Number(rule.repeatDays ?? 0))) p.push('Pick how often a daily check repeats.')
  return p
}

/**
 * The CRM's built-in automations. IT Support switches each on or off here (stored as automation_rules rows with id
 * "builtin:<key>"); off means the app and the server job skip it. `where` says what runs it.
 */
export const BUILTINS = [
  { key: 'break-monitor', name: 'Lunch break: start reminder and late-return warning', where: 'App (every 30 s)', desc: 'At the break start everyone working gets a reminder; anyone still on break after it ends is warned and HR is alerted.' },
  { key: 'break-prompt', name: 'Lunch break: “Start break” card at break time', where: 'App', desc: 'The one-click Start break card on every page during the lunch window.' },
  { key: 'task-reminders', name: 'File task reminders', where: 'App (every 5 min)', desc: 'Reminds the person a task on a file is assigned to when it is due.' },
  { key: 'combo-reminders', name: 'Combo period ending (7 days before)', where: 'App (every 5 min)', desc: 'Tells the sales owner and team leader a combo booking’s period ends soon.' },
  { key: 'file-follow-ups', name: '15-day file follow-ups', where: 'Server job + app', desc: 'Reminds Operations and Admin to follow up with the client on active files.' },
  { key: 'pitch-deck-reminders', name: 'Pitch Deck follow-ups (every 3–4 days)', where: 'Server job + app', desc: 'Reminds the Admin working on a Pitch Deck to follow up.' },
  { key: 'scheme-expiry-alerts', name: 'Scheme ends tomorrow alert', where: 'Server job + app', desc: 'Alerts the chosen roles a day before a scheme closes.' },
  { key: 'welcome-messages', name: 'Client welcome email / WhatsApp retries', where: 'Server job', desc: 'Sends the welcome message the approving screen could not send (up to 3 tries).' },
  { key: 'scheduled-emails', name: 'Scheduled staff emails (start-day reminder, anniversaries, monthly attendance)', where: 'App (every 5 min)', desc: 'The daily and monthly emails of the Email Center — each one also has its own switch there.' },
  { key: 'custom-rules', name: 'Custom automation rules', where: 'App', desc: 'Every rule on the Rules tab. Off pauses all of them at once.' },
]
export const builtinId = (key) => `builtin:${key}`

/** Ready-made rules to start from (the IT team edits them after adding). */
export const TEMPLATES = [
  {
    name: 'New CRM entry → tell Accounts and the team leader', trigger: 'booking.created', conditions: [],
    actions: [{ type: 'notify', to: [{ kind: 'role', role: 'accounts' }, { kind: 'teamlead' }], title: 'New CRM entry {record}', body: '{company} · {service} · ₹{quoted} by {owner}' }],
  },
  {
    name: 'High-value CRM entry (₹1 lakh+) → alert Super Admin and set priority high', trigger: 'booking.created', conditions: [{ field: 'quoted', op: 'gte', value: 100000 }],
    actions: [{ type: 'notify', to: [{ kind: 'role', role: 'superadmin' }], title: 'High-value booking {record}', body: '{company} · ₹{quoted} · {service} by {owner}' }, { type: 'priority', value: 'HIGH' }],
  },
  {
    name: 'CRM entry rejected → email the sales person', trigger: 'booking.status', conditions: [{ field: 'status', op: 'eq', value: 'REJECTED' }],
    actions: [{ type: 'email', to: [{ kind: 'owner' }], subject: 'CRM entry {record} was rejected', body: 'Hi {first_name},\n\n{record} · {company} was rejected. Open it in the CRM to see why: {link}\n\nRexera CRM' }],
  },
  {
    name: 'Payment received → thank-you note on the file and tell the owner', trigger: 'booking.payment', conditions: [],
    actions: [{ type: 'notify', to: [{ kind: 'owner' }], title: 'Payment received · {record}', body: '₹{payment} added to {company}' }, { type: 'comment', text: 'Payment of ₹{payment} recorded — thank the client and confirm the next step.' }],
  },
  {
    name: 'CRM entry stuck with Accounts for 2+ days → remind Accounts daily', trigger: 'schedule.daily', entity: 'booking', repeatDays: 1,
    conditions: [{ field: 'status', op: 'eq', value: 'PENDING_ACCOUNTS' }, { field: 'daysInStatus', op: 'gte', value: 2 }],
    actions: [{ type: 'notify', to: [{ kind: 'role', role: 'accounts' }], title: 'Waiting {daysInStatus} days: {record}', body: '{company} has been with Accounts for {daysInStatus} days' }],
  },
  {
    name: 'Lead not called for 3 days → remind the owner', trigger: 'schedule.daily', entity: 'lead', repeatDays: 3,
    conditions: [{ field: 'assigned', op: 'is', value: true }, { field: 'daysSinceLastCall', op: 'gte', value: 3 }, { field: 'status', op: 'not_in', values: ['CONVERTED', 'NOT_INTERESTED', 'WRONG_NUMBER', 'DND', 'SCRAP'] }],
    actions: [{ type: 'notify', to: [{ kind: 'owner' }], title: 'Call {record} today', body: '{client} has not been called for {daysSinceLastCall} days' }],
  },
  {
    name: 'Invoice overdue 7+ days → tell Accounts and the sales person', trigger: 'schedule.daily', entity: 'invoice', repeatDays: 7,
    conditions: [{ field: 'daysOverdue', op: 'gte', value: 7 }, { field: 'balance', op: 'gt', value: 0 }],
    actions: [{ type: 'notify', to: [{ kind: 'role', role: 'accounts' }, { kind: 'owner' }], title: 'Invoice {record} overdue {daysOverdue} days', body: '{client} · balance ₹{balance}' }],
  },
  {
    name: 'Client entry follow-up overdue → remind the sales person', trigger: 'schedule.daily', entity: 'clientEntry', repeatDays: 1,
    conditions: [{ field: 'followUpOverdueDays', op: 'gte', value: 1 }],
    actions: [{ type: 'notify', to: [{ kind: 'owner' }], title: 'Follow up {client}', body: 'Follow-up was due {followUpOverdueDays} day(s) ago · {scheme}' }],
  },
  {
    name: 'Leave requested → email HR', trigger: 'leave.requested', conditions: [],
    actions: [{ type: 'email', to: [{ kind: 'role', role: 'hr' }], subject: 'Leave request: {owner}', body: '{owner} asked for {days} day(s) of {leaveType} leave ({record}).\n\nOpen the CRM to decide: {link}' }],
  },
  {
    name: 'File reaches Submission stage → task for the Admin', trigger: 'booking.stage', conditions: [{ field: 'stage', op: 'eq', value: 6 }],
    actions: [{ type: 'task', to: [{ kind: 'admin' }], title: 'Submit {company}’s application and upload the acknowledgement', dueInDays: 2 }],
  },
]
