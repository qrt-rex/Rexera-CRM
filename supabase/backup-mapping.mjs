/** Maps a Rexera backup (app JSON) to rows for each Supabase table. Shared by the migration script and its tests. */
// ------------------------------------------------------------------ map the app's data to table rows
const PHONE = /^[6-9][0-9]{9}$/
export function mapAll(backup) {
  const d = backup.db
  const userIds = new Set(d.users.map((u) => u.id))
  const uref = (id) => (id && userIds.has(id) ? id : null)
  const s = (v) => (v === undefined || v === '' ? null : v)
  const t = {}

  t.app_users = d.users.map((u) => ({
    id: u.id, name: u.name, username: u.username, email: u.email.toLowerCase(), phone: PHONE.test(u.phone ?? '') ? u.phone : null,
    role: u.role, team_lead_id: null, department: u.department ?? '', designation: u.designation ?? '', joined_on: u.joinedOn,
    exit_on: s(u.exitOn), active: u.active, salary: u.salary ?? null, sales_target: u.target ?? null, address: u.address ?? {},
    legacy_id: u.legacyId ?? null, legacy_role: u.legacyRole ?? null, needs_password_reset: !!u.needsPasswordReset, resume: u.resume ?? null,
  }))
  t.app_users_team = d.users.filter((u) => uref(u.teamLeadId)).map((u) => ({ id: u.id, team_lead_id: u.teamLeadId }))
  t.user_extra_roles = d.users.flatMap((u) => u.extraRoles.filter((r) => r !== u.role).map((role) => ({ user_id: u.id, role })))
  t.user_permission_overrides = d.users.flatMap((u) => [...u.grants.map((p) => ({ user_id: u.id, permission: p, effect: 'allow' })), ...u.denies.map((p) => ({ user_id: u.id, permission: p, effect: 'deny' }))])
  t.role_permissions = Object.entries(d.rolePerms).flatMap(([role, perms]) => [...new Set(perms)].map((permission) => ({ role, permission })))
  t.login_attempts = Object.entries(d.loginFails ?? {}).map(([login, f]) => ({ login, failures: f.count, locked_until: s(f.until) }))

  t.services = d.services.map((x) => ({ id: x.id, name: x.name, category: x.category, price: x.price, gst_rate: x.gstRate, deduction: x.deduction, active: x.active }))
  t.leads = d.leads.map((l) => ({
    id: l.id, code: l.code, name: l.name, company: l.company ?? '', phone: l.phone, email: s(l.email), city: l.city ?? '', state: l.state ?? '',
    service: l.service ?? '', source: l.source ?? '', price: l.price ?? null, status: l.status, follow_up: s(l.followUp), notes: l.notes ?? '',
    assigned_to: uref(l.assignedTo), created_by: uref(l.createdBy), created_at: l.createdAt, legacy: l.legacy ?? null,
  }))
  t.lead_calls = d.leads.flatMap((l) => l.calls.map((c) => ({ id: c.id, lead_id: l.id, called_at: c.at, called_by: uref(c.by), outcome: c.outcome, note: c.note ?? '', duration_sec: c.durationSec ?? 0 })))

  t.bookings = d.bookings.map((b) => ({
    id: b.id, booking_code: b.bookingId, company_name: b.companyName, contact_person: b.contactPerson, mobile: b.mobile, email: s(b.email),
    pan: s(b.pan), gstin: s(b.gstin), city: b.city ?? '', state: b.state ?? '', industry: b.industry ?? '', service_id: s(b.serviceId), service_name: b.serviceName,
    mode: b.mode, success_fee_pct: b.successFeePct ?? 0, total_quoted: b.totalQuoted, gst_rate: b.gstRate, deduction: b.deduction ?? 0,
    created_by: uref(b.createdBy), team_lead_id: uref(b.teamLeadId), status: b.status, hold_from: s(b.holdFrom), hold_reason: s(b.holdReason),
    ops_member_id: uref(b.opsMemberId), admin_id: uref(b.adminId), stage: b.stage, max_stage: b.maxStage, priority: b.priority, deadline: s(b.deadline),
    lead_id: s(b.leadId), created_at: b.createdAt, updated_at: b.updatedAt, legacy_id: b.legacyId ?? null, legacy: b.legacy ?? null,
    address: s(b.address), website: s(b.website), cin: s(b.cin), startup_contact: b.startupContact ?? null, billing: b.billing ?? null, owner_name: s(b.ownerName),
    services: b.services ?? null, combo: b.combo ?? null, payment_contact: s(b.paymentContact), payment_email: s(b.paymentEmail), booking_date: s(b.bookingDate),
    success_fee: b.successFee ?? null, remarks: s(b.remarks), closed_by: uref(b.closedBy), stage_outcome: s(b.stageOutcome),
  }))
  t.booking_payments = d.bookings.flatMap((b) => b.payments.map((p) => ({ id: p.id, booking_id: b.id, part: p.part, amount: p.amount, gst: p.gst, total: p.total, paid_on: p.date, mode: p.mode, proof_name: p.proofName, recorded_by: uref(p.recordedBy), verified: p.verified, is_adjustment: p.mode === 'Adjustment', date_unknown: !!p.dateUnknown, proof: p.proof ?? null })))
  t.booking_approvals = d.bookings.flatMap((b) => b.approvals.map((a) => ({ id: a.id, booking_id: b.id, level: a.level, action: a.action, decided_by: uref(a.by), decided_at: a.at, remark: a.remark ?? '' })))
  t.booking_stage_moves = d.bookings.flatMap((b) => b.stageHistory.map((h, i) => ({ id: `${b.id}-stage-${i + 1}`, booking_id: b.id, stage: h.stage, moved_at: h.at, moved_by: uref(h.by), note: h.note ?? '', outcome: s(h.outcome) })))
  t.booking_comments = d.bookings.flatMap((b) => b.comments.map((c) => ({ id: c.id, booking_id: b.id, author_id: uref(c.by), created_at: c.at, body: c.text, kind: c.kind ?? '' })))
  t.booking_documents = d.bookings.flatMap((b) => b.documents.map((x) => ({ id: x.id, booking_id: b.id, name: x.name, category: x.category, size_bytes: x.size ?? 0, uploaded_at: x.at, uploaded_by: uref(x.by), status: x.status ?? 'PENDING', storage_path: null, legacy_path: x.legacyPath ?? null, file: x.file ?? null })))
  t.booking_tasks = d.bookings.flatMap((b) => b.tasks.map((x) => ({ id: x.id, booking_id: b.id, title: x.title, done: x.done, due_on: s(x.due), created_by: uref(x.by), assignee_id: uref(x.assignee), remind_every_days: x.remindEveryDays ?? null, last_reminded_at: s(x.lastRemindedAt), created_at: x.createdAt ?? b.createdAt })))

  t.invoices = d.invoices.map((i) => ({ id: i.id, number: i.number, type: i.type, booking_id: s(i.bookingId), client: i.client, gstin: i.gstin ?? '', state: i.state, paid: i.paid, status: i.status, issued_on: i.date, due_on: i.due, sales_person: uref(i.salesPerson), created_by: uref(i.createdBy), branch_id: s(i.branchId), client_address: s(i.clientAddress), client_pan: s(i.clientPan) }))
  t.invoice_items = d.invoices.flatMap((i) => i.items.map((it, n) => ({ invoice_id: i.id, position: n + 1, description: it.desc, sac: it.sac ?? '', qty: it.qty, rate: it.rate, gst_rate: it.gstRate })))

  t.schemes = d.schemes.map((x) => ({ id: x.id, title: x.title, category: x.category, summary: x.summary, benefit: x.benefit, eligibility: x.eligibility, active: x.active, created_at: x.createdAt, created_by: uref(x.by) }))
  t.posts = d.posts.map((x) => ({ id: x.id, kind: x.kind, title: x.title, body: x.body, theme: x.theme, pinned: !!x.pinned, created_at: x.createdAt, created_by: uref(x.by) }))
  t.broadcasts = d.broadcasts.map((x) => ({ id: x.id, title: x.title, body: x.body, priority: x.priority, audience: x.audience === 'ALL' ? null : x.audience, created_at: x.at, created_by: uref(x.by) }))
  t.broadcast_acks = d.broadcasts.flatMap((x) => x.acks.filter((u) => userIds.has(u)).map((user_id) => ({ broadcast_id: x.id, user_id, acked_at: x.at })))
  t.events = d.events.map((x) => ({ id: x.id, title: x.title, event_date: x.date, event_time: x.kind === 'HOLIDAY' ? null : x.time, kind: x.kind, description: x.description ?? '', created_by: uref(x.by) }))

  t.day_sessions = d.sessions.filter((x) => userIds.has(x.userId)).map((x) => ({ id: x.id, user_id: x.userId, work_date: x.date, login_at: x.loginAt, logout_at: s(x.logoutAt), breaks: x.breaks ?? [], reopened_by: uref(x.reopenedBy) }))
  t.leave_requests = d.leaves.filter((x) => userIds.has(x.userId)).map((x) => ({ id: x.id, user_id: x.userId, type: x.type, from_date: x.from, to_date: x.to, days: x.days, reason: x.reason, status: x.status, approver_roles: x.approvers, decided_by: uref(x.decidedBy), decided_at: s(x.decidedAt), remark: s(x.remark), created_at: x.createdAt, attachment: x.attachment ?? null }))

  t.payroll_runs = d.payrollRuns.map((r) => ({ id: r.id, month: r.month, status: r.status, provisional: r.provisional, calculated_at: r.calculatedAt, calculated_by: uref(r.calculatedBy) }))
  t.payroll_rows = d.payrollRuns.flatMap((r) => r.rows.filter((x) => userIds.has(x.userId)).map((x) => ({
    run_id: r.id, user_id: x.userId, name: x.name, designation: x.designation ?? '', department: x.department ?? '', ctc: x.ctc ?? null, basic: x.basic,
    hra: x.hra ?? null, other_allowance: x.otherAllowance ?? null, pf_wages: x.pfWages, pf_employer: x.pfEmployer, gross: x.gross, days_in_month: x.daysInMonth,
    paid_days: x.paidDays, lop_days: x.lopDays, lop_amount: x.lopAmount, pf_employee: x.pfEmployee, professional_tax: x.pt, incentive: x.incentive,
    net_salary: x.ctc != null ? x.net : Math.round((x.net - x.incentive) * 100) / 100,
  })))
  t.payroll_history = d.payrollRuns.flatMap((r) => r.history.map((h) => ({ run_id: r.id, at: h.at, by_user: uref(h.by), action: h.action, note: h.note ?? '' })))
  t.pf_accounts = d.pfAccounts.filter((a) => userIds.has(a.userId)).map((a) => ({ user_id: a.userId, uan: /^\d{12}$/.test(a.uan ?? '') ? a.uan : null, enrolled: a.enrolled }))
  const ruleRow = (r) => { const { version, updatedAt, updatedBy, ...rules } = r; return { version, rules, updated_at: updatedAt, updated_by: uref(updatedBy) } }
  t.incentive_rule_versions = [...d.incentiveHistory, d.incentiveRules].map(ruleRow)
  t.manual_incentives = (d.manualIncentives ?? []).filter((m) => userIds.has(m.userId)).map((m) => ({ id: m.id, user_id: m.userId, month: m.month, amount: m.amount, reason: m.reason, added_by: uref(m.addedBy), added_at: m.addedAt, paid_at: s(m.paidAt) }))

  t.notifications = d.notices.filter((n) => userIds.has(n.userId)).map((n) => ({ id: n.id, user_id: n.userId, title: n.title, body: n.body ?? '', link: s(n.link), kind: n.kind, created_at: n.at, read: n.read }))
  t.messages = d.messages.filter((m) => userIds.has(m.from) && userIds.has(m.to)).map((m) => ({ id: m.id, from_user: m.from, to_user: m.to, body: m.body, sent_at: m.at, read: m.read, attachments: m.attachments ?? null }))
  t.message_templates = d.templates.map((x) => ({ id: x.id, name: x.name, body: x.body, created_by: uref(x.by) }))
  t.emails = (d.emails ?? []).filter((e) => userIds.has(e.to)).map((e) => ({ id: e.id, batch_id: e.batchId, to_user: e.to, to_email: e.toEmail, from_user: uref(e.from), subject: e.subject, body: e.body, sent_at: e.at, automation: s(e.automation), read: e.read }))
  t.email_automations = (d.emailAutomations ?? []).map((a) => ({ key: a.key, enabled: a.enabled, subject: a.subject, body: a.body, last_run_key: s(a.lastRunKey), last_run_at: s(a.lastRunAt), sent: a.sent }))

  t.app_settings = [
    { key: 'company', value: { name: d.settings.companyName, gstin: d.settings.companyGstin, supplierState: d.settings.supplierState } },
    { key: 'session', value: { minutes: d.settings.sessionMinutes, validAfter: d.settings.sessionsValidAfter ?? null } },
    { key: 'maintenance', value: d.settings.maintenance ?? { on: false, message: '' } },
    { key: 'pf', value: d.pfSettings },
    { key: 'branches', value: d.settings.branches ?? [] },
    { key: 'attendance', value: { dayLock: d.settings.dayLock === true } },
  ]
  t.api_keys = (d.apiKeys ?? []).map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, key_hash: k.hash, scopes: k.scopes, created_by: uref(k.createdBy), created_at: k.createdAt, expires_at: s(k.expiresAt), revoked_at: s(k.revokedAt), revoked_by: uref(k.revokedBy) }))
  t.backup_log = (d.backupLog ?? []).map((b) => ({ id: b.id, at: b.at, by_user: uref(b.by), kind: b.kind, note: b.note ?? '', bytes: b.bytes ?? 0, encrypted: !!b.encrypted }))
  t.audit_log = d.audit.map((a) => ({ at: a.at, by_user: uref(a.by), action: a.action, detail: a.detail ?? '' })).reverse()

  t.candidate_forms = (d.candidateForms ?? []).map((f) => ({ id: f.id, token: f.token, title: f.title, kind: f.kind, department: f.department ?? '', description: f.description ?? '', active: f.active, created_at: f.createdAt, created_by: uref(f.by) }))
  t.candidate_applications = (d.candidates ?? []).map((c) => ({ id: c.id, form_id: c.formId, name: c.name, email: c.email, phone: c.phone, city: c.city ?? '', dob: s(c.dob), qualification: c.qualification, college: s(c.college), experience: c.experience ?? '', current_company: s(c.currentCompany), expected_salary: s(c.expectedSalary), notice_period: s(c.noticePeriod), linkedin: s(c.linkedin), message: s(c.message), resume: c.resume, status: c.status, notes: s(c.notes), submitted_at: c.submittedAt }))
  t.recruitment_datasets = (backup.imports ?? []).map((x) => ({ id: x.id, name: x.name, file_name: x.fileName, sheet: s(x.sheet), kind: x.kind, columns: x.columns, imported_at: x.importedAt, imported_by: uref(x.importedBy), bytes: x.bytes ?? 0 }))
  t.recruitment_rows = (backup.imports ?? []).flatMap((x) => x.rows.map((cells, i) => ({ dataset_id: x.id, row_no: i + 1, cells })))
  return t
}

// parents before children; [table, conflict columns]
export const ORDER = [
  ['app_users', 'id'], ['app_users_team', 'id'], ['user_extra_roles', 'user_id,role'], ['user_permission_overrides', 'user_id,permission'],
  ['role_permissions', 'role,permission'], ['login_attempts', 'login'], ['services', 'id'], ['leads', 'id'], ['lead_calls', 'id'],
  ['bookings', 'id'], ['booking_payments', 'id'], ['booking_approvals', 'id'], ['booking_stage_moves', 'id'], ['booking_comments', 'id'],
  ['booking_documents', 'id'], ['booking_tasks', 'id'], ['invoices', 'id'], ['invoice_items', 'invoice_id,position'], ['schemes', 'id'],
  ['posts', 'id'], ['broadcasts', 'id'], ['broadcast_acks', 'broadcast_id,user_id'], ['events', 'id'], ['day_sessions', 'id'],
  ['leave_requests', 'id'], ['payroll_runs', 'id'], ['payroll_rows', 'run_id,user_id'], ['pf_accounts', 'user_id'],
  ['incentive_rule_versions', 'version'], ['manual_incentives', 'id'], ['notifications', 'id'], ['messages', 'id'],
  ['message_templates', 'id'], ['emails', 'id'], ['email_automations', 'key'], ['app_settings', 'key'], ['api_keys', 'id'],
  ['backup_log', 'id'], ['candidate_forms', 'id'], ['candidate_applications', 'id'], ['recruitment_datasets', 'id'], ['recruitment_rows', 'dataset_id,row_no'],
]
export const APPEND_ONLY = ['payroll_history', 'audit_log']   // identity ids: only copied into an empty table
