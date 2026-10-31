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
    photo_url: s(u.photo), shift: u.shift ?? null, branch_id: s(u.branchId), branch_ids: u.branchIds ?? [],
  }))
  t.app_users_team = d.users.filter((u) => uref(u.teamLeadId)).map((u) => ({ id: u.id, team_lead_id: u.teamLeadId }))
  t.user_extra_roles = d.users.flatMap((u) => u.extraRoles.filter((r) => r !== u.role).map((role) => ({ user_id: u.id, role })))
  t.user_permission_overrides = d.users.flatMap((u) => [...u.grants.map((p) => ({ user_id: u.id, permission: p, effect: 'allow' })), ...u.denies.map((p) => ({ user_id: u.id, permission: p, effect: 'deny' }))])
  t.role_permissions = Object.entries(d.rolePerms).flatMap(([role, perms]) => [...new Set(perms)].map((permission) => ({ role, permission })))
  t.login_attempts = Object.entries(d.loginFails ?? {}).map(([login, f]) => ({ login, failures: f.count, locked_until: s(f.until) }))

  t.services = d.services.map((x) => ({ id: x.id, name: x.name, category: x.category, price: x.price, gst_rate: x.gstRate, deduction: x.deduction, active: x.active, prices: x.prices && Object.keys(x.prices).length ? x.prices : null }))
  const uploadIds = new Set((d.leadUploads ?? []).map((x) => x.id))
  t.lead_uploads = (d.leadUploads ?? []).map((x) => ({ id: x.id, file_name: x.fileName, size_bytes: x.size ?? 0, total_rows: x.totalRows ?? 0, imported: x.imported ?? 0, uploaded_by: uref(x.by), uploaded_at: x.at }))
  t.leads = d.leads.map((l) => ({
    id: l.id, code: l.code, name: l.name, company: l.company ?? '', phone: l.phone, email: s(l.email), city: l.city ?? '', state: l.state ?? '',
    service: l.service ?? '', source: l.source ?? '', price: l.price ?? null, status: l.status, follow_up: s(l.followUp), notes: l.notes ?? '',
    assigned_to: uref(l.assignedTo), created_by: uref(l.createdBy), created_at: l.createdAt, legacy: l.legacy ?? null,
    alt_phone: s(l.altPhone), location: s(l.location), industry: s(l.industry), business_type: s(l.businessType), turnover: s(l.turnover),
    funding_amount: s(l.fundingAmount), funding_category: s(l.fundingCategory), requirement: s(l.requirement), form_at: s(l.formAt), extra: l.extra ?? null,
    upload_id: l.uploadId && uploadIds.has(l.uploadId) ? l.uploadId : null, chain: l.chain?.length ? l.chain : null, assigned_at: s(l.assignedAt), seen_at: s(l.seenAt),
    history: l.history?.length ? l.history : null,
  }))
  t.lead_calls = d.leads.flatMap((l) => l.calls.map((c) => ({ id: c.id, lead_id: l.id, called_at: c.at, called_by: uref(c.by), outcome: c.outcome, note: c.note ?? '', duration_sec: c.durationSec ?? 0,
    // the dialer-dashboard columns are only sent when set, so call logging keeps working before their migration is run
    ...(c.totalSec != null ? { total_sec: c.totalSec } : {}), ...(c.callStatus ? { call_status: c.callStatus } : {}), ...(c.wrapSec != null ? { wrap_sec: c.wrapSec } : {}) })))

  t.bookings = d.bookings.map((b) => ({
    id: b.id, booking_code: b.bookingId, company_name: b.companyName, contact_person: b.contactPerson, mobile: b.mobile, email: s(b.email),
    pan: s(b.pan), gstin: s(b.gstin), city: b.city ?? '', state: b.state ?? '', industry: b.industry ?? '', service_id: s(b.serviceId), service_name: b.serviceName,
    mode: b.mode, success_fee_pct: b.successFeePct ?? 0, total_quoted: b.totalQuoted, gst_rate: b.gstRate, deduction: b.deduction ?? 0,
    created_by: uref(b.createdBy), team_lead_id: uref(b.teamLeadId), status: b.status, hold_from: s(b.holdFrom), hold_reason: s(b.holdReason),
    ops_member_id: uref(b.opsMemberId), admin_id: uref(b.adminId), stage: b.stage, max_stage: b.maxStage, priority: b.priority, deadline: s(b.deadline),
    lead_id: s(b.leadId), created_at: b.createdAt, updated_at: b.updatedAt, legacy_id: b.legacyId ?? null, legacy: b.legacy ?? null,
    address: s(b.address), website: s(b.website), cin: s(b.cin), startup_contact: b.startupContact ?? null, billing: b.billing ?? null, owner_name: s(b.ownerName),
    services: b.services ?? null, combo: b.combo ?? null, payment_contact: s(b.paymentContact), payment_email: s(b.paymentEmail), booking_date: s(b.bookingDate),
    success_fee: b.successFee ?? null, remarks: s(b.remarks), closed_by: uref(b.closedBy), stage_outcome: s(b.stageOutcome), stage_reason: s(b.stageReason),
    booking_type: s(b.bookingType), commission: b.commission ?? null,
    welcome: b.welcome ?? null, follow_up: b.followUp ?? null, admin_work: b.adminWork && Object.keys(b.adminWork).length ? b.adminWork : null,
    client_docs: b.clientDocs && Object.keys(b.clientDocs).length ? b.clientDocs : null, milestones: b.milestones?.length ? b.milestones : null, client_updates: b.clientUpdates?.length ? b.clientUpdates : null,
  }))
  t.booking_payments = d.bookings.flatMap((b) => b.payments.map((p) => ({ id: p.id, booking_id: b.id, part: p.part, amount: p.amount, gst: p.gst, total: p.total, paid_on: p.date, mode: p.mode, proof_name: p.proofName, recorded_by: uref(p.recordedBy), verified: p.verified, is_adjustment: p.mode === 'Adjustment', date_unknown: !!p.dateUnknown, proof: p.proof ?? null, tds_pct: p.tds?.pct ?? null, tds_amount: p.tds?.amount ?? null })))
  t.booking_refunds = d.bookings.flatMap((b) => (b.refunds ?? []).map((x) => ({ id: x.id, booking_id: b.id, amount: x.amount, requested_on: x.date, reason: x.reason ?? '', status: x.status, refunded_on: s(x.refundedOn), mode: s(x.mode), ref: s(x.ref), created_by: uref(x.by), created_at: x.at, ...(x.history?.length ? { payment_ids: x.paymentIds?.length ? x.paymentIds : null, documents: x.documents?.length ? x.documents : null, proof: x.proof?.length ? x.proof : null, review_note: s(x.reviewNote), reviewed_by: uref(x.reviewedBy), reviewed_at: s(x.reviewedAt), completed_by: uref(x.completedBy), completed_at: s(x.completedAt), history: x.history } : {}) })))
  t.booking_approvals = d.bookings.flatMap((b) => b.approvals.map((a) => ({ id: a.id, booking_id: b.id, level: a.level, action: a.action, decided_by: uref(a.by), decided_at: a.at, remark: a.remark ?? '' })))
  t.booking_stage_moves = d.bookings.flatMap((b) => b.stageHistory.map((h, i) => ({ id: `${b.id}-stage-${i + 1}`, booking_id: b.id, stage: h.stage, moved_at: h.at, moved_by: uref(h.by), note: h.note ?? '', outcome: s(h.outcome) })))
  t.booking_comments = d.bookings.flatMap((b) => b.comments.map((c) => ({ id: c.id, booking_id: b.id, author_id: uref(c.by), created_at: c.at, body: c.text, kind: c.kind ?? '' })))
  t.booking_documents = d.bookings.flatMap((b) => b.documents.map((x) => ({ id: x.id, booking_id: b.id, name: x.name, category: x.category, size_bytes: x.size ?? 0, uploaded_at: x.at, uploaded_by: uref(x.by), status: x.status ?? 'PENDING', storage_path: null, legacy_path: x.legacyPath ?? null, file: x.file ?? null, note: s(x.note), reviewed_by: uref(x.reviewedBy), reviewed_at: s(x.reviewedAt) })))
  t.booking_client_emails = d.bookings.flatMap((b) => (b.clientEmails ?? []).map((e) => ({ id: e.id, booking_id: b.id, sent_by: uref(e.by), sent_at: e.at, to_email: e.to, cc: e.cc ?? [], subject: e.subject, template: e.template, status: e.status, error: s(e.error) })))
  t.client_doc_uploads = d.bookings.flatMap((b) => (b.clientUploads ?? []).map((x) => ({ id: x.id, booking_id: b.id, category: x.category, file: x.file, at: x.at, account_id: s(x.accountId), note: s(x.note) })))
  t.booking_tasks = d.bookings.flatMap((b) => b.tasks.map((x) => ({ id: x.id, booking_id: b.id, title: x.title, done: x.done, due_on: s(x.due), created_by: uref(x.by), assignee_id: uref(x.assignee), remind_every_days: x.remindEveryDays ?? null, last_reminded_at: s(x.lastRemindedAt), created_at: x.createdAt ?? b.createdAt })))

  t.invoices = d.invoices.map((i) => ({ id: i.id, number: i.number, type: i.type, booking_id: s(i.bookingId), client: i.client, gstin: i.gstin ?? '', state: i.state, paid: i.paid, status: i.status, issued_on: i.date, due_on: i.due, sales_person: uref(i.salesPerson), created_by: uref(i.createdBy), branch_id: s(i.branchId), client_address: s(i.clientAddress), client_pan: s(i.clientPan),
    // sent only when set, so invoices keep saving before the remarks column's migration is run
    ...(i.remarks ? { remarks: i.remarks } : {}) }))
  t.invoice_items = d.invoices.flatMap((i) => i.items.map((it, n) => ({ invoice_id: i.id, position: n + 1, description: it.desc, sac: it.sac ?? '', qty: it.qty, rate: it.rate, gst_rate: it.gstRate })))
  t.invoice_shares = d.invoices.flatMap((i) => (i.shares ?? []).map((x) => ({ id: x.id, invoice_id: i.id, sent_at: x.at, sent_by: uref(x.by), channel: x.channel, to_addr: x.to, status: x.status, error: s(x.error), message_id: s(x.messageId) })))

  t.schemes = d.schemes.map((x) => ({ id: x.id, title: x.title, category: x.category, summary: x.summary, benefit: x.benefit, eligibility: x.eligibility, active: x.active, created_at: x.createdAt, created_by: uref(x.by), price: x.price ?? null, start_date: s(x.startDate), end_date: s(x.endDate), updated_at: s(x.updatedAt), updated_by: uref(x.updatedBy) }))
  t.posts = d.posts.map((x) => ({ id: x.id, kind: x.kind, title: x.title, body: x.body, theme: x.theme, pinned: !!x.pinned, created_at: x.createdAt, created_by: uref(x.by) }))
  t.broadcasts = d.broadcasts.map((x) => ({ id: x.id, title: x.title, body: x.body, priority: x.priority, audience: x.audience === 'ALL' ? null : x.audience, created_at: x.at, created_by: uref(x.by) }))
  t.broadcast_acks = d.broadcasts.flatMap((x) => x.acks.filter((u) => userIds.has(u)).map((user_id) => ({ broadcast_id: x.id, user_id, acked_at: x.at })))
  t.events = d.events.map((x) => ({ id: x.id, title: x.title, event_date: x.date, event_time: x.kind === 'HOLIDAY' ? null : x.time, kind: x.kind, description: x.description ?? '', created_by: uref(x.by) }))

  t.day_sessions = d.sessions.filter((x) => userIds.has(x.userId)).map((x) => ({ id: x.id, user_id: x.userId, work_date: x.date, login_at: x.loginAt, logout_at: s(x.logoutAt), breaks: x.breaks ?? [], reopened_by: uref(x.reopenedBy), late_break: x.lateBreak ?? null }))
  t.leave_requests = d.leaves.filter((x) => userIds.has(x.userId)).map((x) => ({ id: x.id, user_id: x.userId, type: x.type, from_date: x.from, to_date: x.to, days: x.days, reason: x.reason, status: x.status, approver_roles: x.approvers, decided_by: uref(x.decidedBy), decided_at: s(x.decidedAt), remark: s(x.remark), created_at: x.createdAt, attachment: x.attachment ?? null }))

  t.payroll_runs = d.payrollRuns.map((r) => ({ id: r.id, month: r.month, status: r.status, provisional: r.provisional, calculated_at: r.calculatedAt, calculated_by: uref(r.calculatedBy) }))
  t.payroll_rows = d.payrollRuns.flatMap((r) => r.rows.filter((x) => userIds.has(x.userId)).map((x) => ({
    run_id: r.id, user_id: x.userId, name: x.name, designation: x.designation ?? '', department: x.department ?? '', ctc: x.ctc ?? null, basic: x.basic,
    hra: x.hra ?? null, other_allowance: x.otherAllowance ?? null, pf_wages: x.pfWages, pf_employer: x.pfEmployer, gross: x.gross, days_in_month: x.daysInMonth,
    paid_days: x.paidDays, lop_days: x.lopDays, lop_amount: x.lopAmount, pf_employee: x.pfEmployee, professional_tax: x.pt, incentive: x.incentive,
    net_salary: x.ctc != null ? x.net : Math.round((x.net - x.incentive) * 100) / 100,
    paid_on: s(x.paidOn), paid_ref: s(x.paidRef), paid_by: s(x.paidBy),
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
    { key: 'breaks', value: d.settings.breakPolicy ?? null },
    { key: 'leadAssign', value: d.settings.leadAssign ?? null },
    { key: 'workflow', value: d.settings.workflow ?? null },
    { key: 'jobs', value: d.settings.jobs ?? null },
    { key: 'dialerCampaigns', value: d.settings.dialerCampaigns ?? null },
    { key: 'clientTemplates', value: d.settings.clientTemplates ?? null },
    { key: 'counters', value: d.counters },
    { key: 'meta', value: { version: d.version, upgrades: d.upgrades ?? [] } },
  ]
  t.api_keys = (d.apiKeys ?? []).map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, key_hash: k.hash, scopes: k.scopes, created_by: uref(k.createdBy), created_at: k.createdAt, expires_at: s(k.expiresAt), revoked_at: s(k.revokedAt), revoked_by: uref(k.revokedBy) }))
  t.backup_log = (d.backupLog ?? []).map((b) => ({ id: b.id, at: b.at, by_user: uref(b.by), kind: b.kind, note: b.note ?? '', bytes: b.bytes ?? 0, encrypted: !!b.encrypted }))
  t.audit_log = d.audit.map((a) => ({ at: a.at, by_user: uref(a.by), action: a.action, detail: a.detail ?? '' })).reverse()

  t.candidate_forms = (d.candidateForms ?? []).map((f) => ({ id: f.id, token: f.token, title: f.title, kind: f.kind, positions: f.positions ?? [], position: s(f.positions?.[0]), department: f.department ?? '', description: f.description ?? '', active: f.active, created_at: f.createdAt, created_by: uref(f.by) }))
  t.candidate_applications = (d.candidates ?? []).map((c) => ({ id: c.id, form_id: c.formId, name: c.name, email: c.email, phone: c.phone, city: c.city ?? '', dob: s(c.dob), qualification: c.qualification, college: s(c.college), experience: c.experience ?? '', current_company: s(c.currentCompany), expected_salary: s(c.expectedSalary), notice_period: s(c.noticePeriod), branch: s(c.branch), position: s(c.position), candidate_type: s(c.candidateType), current_ctc: s(c.currentCtc), interview_at: s(c.interviewAt), linkedin: s(c.linkedin), message: s(c.message), resume: c.resume, status: c.status, notes: s(c.notes), submitted_at: c.submittedAt, ...(c.selected !== undefined ? { selected: c.selected, selected_at: s(c.selectedAt), selected_by: s(c.selectedBy) } : {}) }))
  t.deleted_items = (d.deletedItems ?? []).map((x) => ({ id: x.id, module: x.module, kind: x.kind, label: x.label, rows: x.rows ?? 1, data: x.data ?? null, files: x.files?.length ? x.files : null, deleted_by: s(x.deletedBy), deleted_at: x.deletedAt }))
  t.candidate_letters = (d.candidateLetters ?? []).map((m) => ({ id: m.id, candidate_id: m.candidateId, kind: m.kind, channel: m.channel, to_addr: m.to, subject: s(m.subject), body: m.body, status: m.status, error: s(m.error), sent_by: m.by, sent_at: m.at }))
  t.company_assets = (d.assets ?? []).map((a) => ({ id: a.id, tag: a.tag, name: a.name, category: a.category, brand: s(a.brand), model: s(a.model), serial: s(a.serial), purchase_date: s(a.purchaseDate), cost: a.cost ?? null, vendor: s(a.vendor), warranty_until: s(a.warrantyUntil), location: s(a.location), condition: s(a.condition), status: a.status, assigned_to: uref(a.assignedTo), assigned_on: s(a.assignedOn), notes: s(a.notes), invoice: a.invoice ?? null, created_at: a.createdAt }))
  t.asset_events = (d.assets ?? []).flatMap((a) => a.history.map((h) => ({ asset_id: a.id, at: h.at, by_user: uref(h.by), action: h.action, user_id: uref(h.userId), note: s(h.note) })))
  t.stock_items = (d.stock ?? []).map((x) => ({ id: x.id, name: x.name, category: x.category, unit: x.unit, qty: x.qty, min_qty: x.minQty, unit_cost: x.unitCost ?? null, location: s(x.location), created_at: x.createdAt }))
  t.stock_moves = (d.stock ?? []).flatMap((x) => x.moves.map((m) => ({ item_id: x.id, at: m.at, by_user: uref(m.by), qty: m.qty, note: s(m.note), issued_to: uref(m.issuedTo) })))
  t.company_expenses = (d.expenses ?? []).map((x) => ({ id: x.id, spent_on: x.date, category: x.category, description: x.description, amount: x.amount, gst: x.gst, vendor: s(x.vendor), paid_via: x.paidVia, paid_by: uref(x.paidBy), bill: x.bill ?? null, added_by: uref(x.by), created_at: x.createdAt, branch_id: s(x.branchId) }))
  t.legacy_files = (d.legacyFiles ?? []).map((x) => ({ path: x.path, file: x.file, kind: x.kind ?? '' }))
  const formIds = new Set((d.docForms ?? []).map((f) => f.id)), bookingIds = new Set(d.bookings.map((b) => b.id))
  t.doc_forms = (d.docForms ?? []).map((f) => ({
    id: f.id, token: f.token, name: f.name, description: f.description ?? '', instructions: f.instructions ?? '', kind: f.kind, fields: f.fields ?? [], version: f.version, versions: f.versions ?? [],
    status: f.status, booking_id: f.bookingId && bookingIds.has(f.bookingId) ? f.bookingId : null, expires_on: s(f.expiresOn), verify: f.verify ?? 'NONE', document: f.document ?? null,
    created_by: uref(f.createdBy), created_at: f.createdAt, updated_at: f.updatedAt, updated_by: uref(f.updatedBy), views: f.views ?? 0, last_viewed_at: s(f.lastViewedAt),
  }))
  t.doc_form_submissions = (d.formSubmissions ?? []).filter((x) => formIds.has(x.formId)).map((x) => ({
    id: x.id, form_id: x.formId, form_version: x.formVersion, booking_id: x.bookingId && bookingIds.has(x.bookingId) ? x.bookingId : null, fields: x.fields ?? [], answers: x.answers ?? {}, files: x.files ?? [],
    submitted_at: x.submittedAt, status: x.status, reviewed_by: uref(x.reviewedBy), reviewed_at: s(x.reviewedAt), note: s(x.note),
  }))
  t.sales_kit = (d.salesKit ?? []).map((x) => ({
    id: x.id, category: x.category, position: x.position, name: x.name, benefits: x.benefits ?? '', sectors: x.sectors ?? '', eligibility: x.eligibility ?? '', last_date: x.lastDate ?? '',
    organisation: x.organisation ?? '', scheme_type: x.schemeType ?? '', applicable_for: x.applicableFor ?? '', min_charge: x.minCharge ?? '', registration_charge: s(x.registrationCharge),
    updated_at: s(x.updatedAt), updated_by: uref(x.updatedBy),
  }))
  t.site_content = (d.siteContent ?? []).map((x) => ({ key: x.key, draft: x.draft ?? null, published: x.published ?? null, updated_at: x.updatedAt, updated_by: uref(x.updatedBy), published_at: s(x.publishedAt), published_by: uref(x.publishedBy) }))
  t.eligibility_schemes = (d.eligibilitySchemes ?? []).map((x) => ({
    id: x.id, position: x.position, active: x.active !== false, name: x.name, kind: x.kind ?? '', agency: x.agency ?? '', url: x.url ?? '', service_match: x.serviceMatch ?? '',
    status_note: x.statusNote ?? '', summary: x.summary ?? '', benefits: x.benefits ?? [], documents: x.documents ?? [], process: x.process ?? [], conditions: x.conditions ?? [],
    subsidy: x.subsidy ?? null, bands: x.bands ?? null, verified_on: x.verifiedOn, updated_at: s(x.updatedAt), updated_by: uref(x.updatedBy),
  }))
  t.automation_rules = (d.automationRules ?? []).map((x) => ({
    id: x.id, name: x.name, description: s(x.description), enabled: x.enabled !== false, position: x.position ?? 0, trigger: x.trigger, entity: s(x.entity), match: s(x.match),
    conditions: x.conditions ?? [], actions: x.actions ?? [], repeat_days: x.repeatDays ?? null, created_at: s(x.createdAt), updated_at: s(x.updatedAt), updated_by: uref(x.updatedBy),
  }))
  t.automation_runs = (d.automationRuns ?? []).map((x) => ({
    id: x.id, rule_id: x.ruleId, rule_name: x.ruleName, at: x.at, by_user: uref(x.by), trigger: x.trigger, record_type: x.recordType, record_id: x.recordId ?? '', record_label: x.recordLabel ?? '', ok: x.ok !== false, detail: x.detail ?? '',
  }))
  t.site_content_history = (d.siteHistory ?? []).map((x) => ({ id: x.id, key: x.key, content: x.content ?? null, published_at: x.at, published_by: uref(x.by) }))
  t.client_accounts = (d.clientAccounts ?? []).map((x) => ({ id: x.id, auth_user_id: s(x.authUserId), email: x.email, name: x.name, phone: s(x.phone), booking_ids: x.bookingIds ?? [], status: x.status, invited_at: x.invitedAt, invited_by: uref(x.invitedBy), activated_at: s(x.activatedAt), last_login_at: s(x.lastLoginAt), assigned_to: uref(x.assignedTo), disabled_at: s(x.disabledAt) }))
  t.client_activity = (d.clientActivity ?? []).map((x) => ({ id: x.id, account_id: x.accountId, booking_id: s(x.bookingId), at: x.at, action: x.action, detail: s(x.detail), by_user: uref(x.by) }))
  t.media_items = (d.mediaItems ?? []).map((x) => ({
    id: x.id, serial: x.serial, scheme_name: x.schemeName, title: x.title, description: x.description ?? '', media_type: x.mediaType, files: x.files ?? [],
    internal: !!x.internal, external: !!x.external, client_booking_ids: x.clientBookingIds ?? [], assign_date: s(x.assignDate), assign_time: s(x.assignTime),
    assigned_to: uref(x.assignedTo), work_status: x.workStatus, notes: s(x.notes), submitted: !!x.submitted, submitted_at: s(x.submittedAt), submitted_by: uref(x.submittedBy),
    completed_at: s(x.completedAt), created_at: x.createdAt, created_by: uref(x.createdBy), updated_at: x.updatedAt, updated_by: uref(x.updatedBy), history: x.history ?? [],
  }))
  t.client_entries = (d.clientEntries ?? []).map((x) => ({
    id: x.id, entry_date: x.date, client_name: x.clientName, company_name: x.companyName, phone: x.phone, service_id: s(x.serviceId), scheme: x.scheme,
    pitched_price: x.pitchedPrice, status: x.status, requirement: x.requirement, note: x.note, follow_up: s(x.followUp), follow_ups: x.followUps ?? [],
    lead_id: s(x.leadId), owner_id: uref(x.ownerId), created_at: x.createdAt, updated_at: x.updatedAt, booking_id: s(x.bookingId), converted_at: s(x.convertedAt),
    // sent only when set, so client entries keep saving before the email column's migration is run
    ...(x.email ? { email: x.email } : {}),
  }))
  t.client_messages = (d.clientMessages ?? []).map((x) => ({
    id: x.id, booking_id: s(x.bookingId), client_entry_id: s(x.clientEntryId), stage: x.stage, channel: x.channel, to_addr: x.to, subject: s(x.subject), body: x.body,
    status: x.status, error: s(x.error), sent_by: uref(x.by), sent_at: x.at, provider_id: s(x.providerId),
  }))
  t.website_lead_log = (d.webLeadLog ?? []).map((x) => ({ id: x.id, at: x.at, status: x.status, form: s(x.form), name: s(x.name), phone: s(x.phone), email: s(x.email), error: s(x.error), lead_id: s(x.leadId), fields: x.fields ?? null, retried_at: s(x.retriedAt), retried_by: uref(x.retriedBy) }))
  t.recruitment_datasets = (backup.imports ?? []).map((x) => ({ id: x.id, name: x.name, file_name: x.fileName, sheet: s(x.sheet), kind: x.kind, columns: x.columns, imported_at: x.importedAt, imported_by: uref(x.importedBy), bytes: x.bytes ?? 0 }))
  t.recruitment_rows = (backup.imports ?? []).flatMap((x) => x.rows.map((cells, i) => ({ dataset_id: x.id, row_no: i + 1, cells })))
  return t
}

// parents before children; [table, conflict columns]
export const ORDER = [
  ['app_users', 'id'], ['app_users_team', 'id'], ['user_extra_roles', 'user_id,role'], ['user_permission_overrides', 'user_id,permission'],
  ['role_permissions', 'role,permission'], ['login_attempts', 'login'], ['services', 'id'], ['lead_uploads', 'id'], ['leads', 'id'], ['lead_calls', 'id'],
  ['bookings', 'id'], ['booking_payments', 'id'], ['booking_approvals', 'id'], ['booking_stage_moves', 'id'], ['booking_comments', 'id'],
  ['booking_documents', 'id'], ['booking_client_emails', 'id'], ['booking_tasks', 'id'], ['booking_refunds', 'id'], ['invoices', 'id'], ['invoice_items', 'invoice_id,position'], ['invoice_shares', 'id'], ['schemes', 'id'],
  ['posts', 'id'], ['broadcasts', 'id'], ['broadcast_acks', 'broadcast_id,user_id'], ['events', 'id'], ['day_sessions', 'id'],
  ['leave_requests', 'id'], ['payroll_runs', 'id'], ['payroll_rows', 'run_id,user_id'], ['pf_accounts', 'user_id'],
  ['incentive_rule_versions', 'version'], ['manual_incentives', 'id'], ['notifications', 'id'], ['messages', 'id'],
  ['message_templates', 'id'], ['emails', 'id'], ['email_automations', 'key'], ['app_settings', 'key'], ['api_keys', 'id'],
  ['backup_log', 'id'], ['candidate_forms', 'id'], ['candidate_applications', 'id'], ['candidate_letters', 'id'], ['deleted_items', 'id'], ['recruitment_datasets', 'id'], ['recruitment_rows', 'dataset_id,row_no'],
  ['company_assets', 'id'], ['stock_items', 'id'], ['company_expenses', 'id'], ['legacy_files', 'path'],
  ['doc_forms', 'id'], ['doc_form_submissions', 'id'], ['sales_kit', 'id'], ['eligibility_schemes', 'id'], ['automation_rules', 'id'], ['automation_runs', 'id'],
  ['site_content', 'key'], ['site_content_history', 'id'], ['website_lead_log', 'id'],
  ['client_accounts', 'id'], ['client_activity', 'id'], ['client_doc_uploads', 'id'], ['media_items', 'id'], ['client_entries', 'id'], ['client_messages', 'id'],
]
export const APPEND_ONLY = ['payroll_history', 'audit_log', 'asset_events', 'stock_moves']   // identity ids: only copied into an empty table

// ------------------------------------------------------------------ table rows back to the app's data
/** Postgres answers timestamps as `…+00:00`; the app stores `toISOString()` (`….000Z`). Dates (YYYY-MM-DD) stay as they are. */
const TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)$/
const iso = (v) => (typeof v === 'string' && TS.test(v) ? new Date(v).toISOString() : v)
export const normalizeRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, iso(v)]))

/**
 * The reverse of mapAll: rebuilds the app's DB document from table rows (as loaded from Supabase, or as mapAll returns
 * them). Sign-in moves to Supabase Auth, so users come back without a password hash. Child rows must arrive in their
 * natural order (load them ordered by id / position).
 */
export function rowsToDb(input) {
  const t = Object.fromEntries(Object.entries(input).map(([k, list]) => [k, (list ?? []).map(normalizeRow)]))
  const rows = (name) => t[name] ?? []
  const u = (v) => (v === null ? undefined : v)
  const opt = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null))
  const group = (name, key) => {
    const m = new Map()
    for (const r of rows(name)) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r) }
    return (k) => m.get(k) ?? []
  }
  const setting = (key) => rows('app_settings').find((r) => r.key === key)?.value
  const round2 = (n) => Math.round(n * 100) / 100

  const teamOf = new Map(rows('app_users_team').map((r) => [r.id, r.team_lead_id]))
  const extraOf = group('user_extra_roles', 'user_id'), overridesOf = group('user_permission_overrides', 'user_id')
  const users = rows('app_users').map((r) => opt({
    id: r.id, name: r.name, username: r.username, email: r.email, phone: r.phone ?? '', role: r.role,
    extraRoles: extraOf(r.id).map((x) => x.role),
    grants: overridesOf(r.id).filter((x) => x.effect === 'allow').map((x) => x.permission),
    denies: overridesOf(r.id).filter((x) => x.effect === 'deny').map((x) => x.permission),
    teamLeadId: u(r.team_lead_id) ?? teamOf.get(r.id), department: r.department ?? '', designation: r.designation ?? '',
    joinedOn: r.joined_on, exitOn: u(r.exit_on), active: r.active, passHash: '', photo: u(r.photo_url),
    address: r.address && Object.keys(r.address).length ? r.address : undefined, salary: u(r.salary), target: u(r.sales_target),
    legacyId: u(r.legacy_id), legacyRole: u(r.legacy_role), needsPasswordReset: r.needs_password_reset || undefined, resume: u(r.resume),
    shift: u(r.shift), branchId: u(r.branch_id), branchIds: r.branch_ids?.length ? r.branch_ids : undefined,
  }))

  const callsOf = group('lead_calls', 'lead_id')
  const leads = rows('leads').map((r) => opt({
    id: r.id, code: r.code, name: r.name, company: r.company ?? '', phone: r.phone, email: r.email ?? '', city: r.city ?? '', state: r.state ?? '',
    service: r.service ?? '', source: r.source ?? '', price: u(r.price), status: r.status, followUp: u(r.follow_up), notes: r.notes ?? '',
    assignedTo: u(r.assigned_to), createdBy: r.created_by ?? '', createdAt: r.created_at, legacy: u(r.legacy),
    altPhone: u(r.alt_phone), location: u(r.location), industry: u(r.industry), businessType: u(r.business_type), turnover: u(r.turnover),
    fundingAmount: u(r.funding_amount), fundingCategory: u(r.funding_category), requirement: u(r.requirement), formAt: u(r.form_at), extra: u(r.extra),
    uploadId: u(r.upload_id), chain: u(r.chain), assignedAt: u(r.assigned_at), seenAt: u(r.seen_at), history: u(r.history),
    calls: callsOf(r.id).map((c) => opt({ id: c.id, at: c.called_at, by: c.called_by ?? '', outcome: c.outcome, note: c.note ?? '', durationSec: c.duration_sec ?? 0, totalSec: u(c.total_sec), callStatus: u(c.call_status), wrapSec: u(c.wrap_sec) })),
  }))

  const payOf = group('booking_payments', 'booking_id'), apprOf = group('booking_approvals', 'booking_id'), stageOf = group('booking_stage_moves', 'booking_id')
  const commOf = group('booking_comments', 'booking_id'), docOf = group('booking_documents', 'booking_id'), taskOf = group('booking_tasks', 'booking_id')
  const mailOf = group('booking_client_emails', 'booking_id'), refundOf = group('booking_refunds', 'booking_id'), cupOf = group('client_doc_uploads', 'booking_id')
  const bookings = rows('bookings').map((r) => opt({
    id: r.id, bookingId: r.booking_code, companyName: r.company_name, contactPerson: r.contact_person, mobile: r.mobile, email: r.email ?? '',
    pan: r.pan ?? '', gstin: r.gstin ?? '', city: r.city ?? '', state: r.state ?? '', industry: r.industry ?? '', serviceId: r.service_id ?? '', serviceName: r.service_name,
    mode: r.mode, successFeePct: r.success_fee_pct ?? 0, totalQuoted: r.total_quoted, gstRate: r.gst_rate, deduction: r.deduction ?? 0,
    createdBy: r.created_by ?? '', teamLeadId: u(r.team_lead_id), status: r.status, holdFrom: u(r.hold_from), holdReason: u(r.hold_reason),
    opsMemberId: u(r.ops_member_id), adminId: u(r.admin_id), stage: r.stage, maxStage: r.max_stage, priority: r.priority, deadline: r.deadline ?? '',
    leadId: u(r.lead_id), createdAt: r.created_at, updatedAt: r.updated_at, legacyId: u(r.legacy_id), legacy: u(r.legacy),
    address: u(r.address), website: u(r.website), cin: u(r.cin), startupContact: u(r.startup_contact), billing: u(r.billing), ownerName: u(r.owner_name),
    services: u(r.services), combo: u(r.combo), paymentContact: u(r.payment_contact), paymentEmail: u(r.payment_email), bookingDate: u(r.booking_date),
    successFee: u(r.success_fee), remarks: u(r.remarks), closedBy: u(r.closed_by), stageOutcome: u(r.stage_outcome), stageReason: u(r.stage_reason),
    bookingType: u(r.booking_type), commission: u(r.commission), welcome: u(r.welcome), followUp: u(r.follow_up), adminWork: u(r.admin_work),
    clientDocs: u(r.client_docs), milestones: u(r.milestones), clientUpdates: u(r.client_updates),
    clientUploads: cupOf(r.id).length ? cupOf(r.id).map((x) => opt({ id: x.id, category: x.category, file: x.file, at: x.at, accountId: x.account_id ?? '', note: u(x.note) })) : undefined,
    refunds: refundOf(r.id).length ? refundOf(r.id).map((x) => opt({ id: x.id, amount: x.amount, date: x.requested_on, reason: x.reason ?? '', status: x.status, refundedOn: u(x.refunded_on), mode: u(x.mode), ref: u(x.ref), by: x.created_by ?? '', at: x.created_at, paymentIds: x.payment_ids?.length ? x.payment_ids : undefined, documents: x.documents?.length ? x.documents : undefined, proof: x.proof?.length ? x.proof : undefined, reviewNote: u(x.review_note), reviewedBy: u(x.reviewed_by), reviewedAt: u(x.reviewed_at), completedBy: u(x.completed_by), completedAt: u(x.completed_at), history: x.history?.length ? x.history : undefined })) : undefined,
    payments: payOf(r.id).map((p) => opt({ id: p.id, part: p.part, amount: p.amount, gst: p.gst, total: p.total, date: p.paid_on, mode: p.mode, proofName: p.proof_name ?? '', recordedBy: p.recorded_by ?? '', verified: p.verified, dateUnknown: p.date_unknown || undefined, proof: u(p.proof), tds: p.tds_pct != null ? { pct: p.tds_pct, amount: p.tds_amount ?? 0 } : undefined })),
    approvals: apprOf(r.id).map((a) => ({ id: a.id, level: a.level, action: a.action, by: a.decided_by ?? '', at: a.decided_at, remark: a.remark ?? '' })),
    stageHistory: stageOf(r.id).map((h) => opt({ stage: h.stage, at: h.moved_at, by: h.moved_by ?? '', note: h.note ?? '', outcome: u(h.outcome) })),
    comments: commOf(r.id).map((c) => ({ id: c.id, by: c.author_id ?? '', at: c.created_at, text: c.body, kind: c.kind ?? '' })),
    documents: docOf(r.id).map((x) => opt({ id: x.id, name: x.name, category: x.category, size: x.size_bytes ?? 0, at: x.uploaded_at, by: x.uploaded_by ?? '', status: x.status, legacyPath: u(x.legacy_path), file: u(x.file), note: u(x.note), reviewedBy: u(x.reviewed_by), reviewedAt: u(x.reviewed_at) })),
    tasks: taskOf(r.id).map((x) => opt({ id: x.id, title: x.title, done: x.done, due: u(x.due_on), by: x.created_by ?? '', assignee: u(x.assignee_id), remindEveryDays: u(x.remind_every_days), createdAt: u(x.created_at), lastRemindedAt: u(x.last_reminded_at) })),
    clientEmails: mailOf(r.id).length ? mailOf(r.id).map((e) => opt({ id: e.id, at: e.sent_at, by: e.sent_by ?? '', to: e.to_email, cc: e.cc ?? [], subject: e.subject, template: e.template, status: e.status, error: u(e.error) })) : undefined,
  }))

  const itemsOf = group('invoice_items', 'invoice_id'), sharesOf = group('invoice_shares', 'invoice_id')
  const invoices = rows('invoices').map((r) => opt({
    id: r.id, number: r.number, type: r.type, bookingId: u(r.booking_id), client: r.client, gstin: r.gstin ?? '', state: r.state, paid: r.paid, status: r.status,
    date: r.issued_on, due: r.due_on, salesPerson: u(r.sales_person), createdBy: r.created_by ?? '', branchId: u(r.branch_id), clientAddress: u(r.client_address), clientPan: u(r.client_pan), remarks: u(r.remarks),
    items: [...itemsOf(r.id)].sort((a, b) => a.position - b.position).map((it) => ({ desc: it.description, sac: it.sac ?? '', qty: it.qty, rate: it.rate, gstRate: it.gst_rate })),
    shares: [...sharesOf(r.id)].sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at))).map((x) => opt({ id: x.id, at: x.sent_at, by: x.sent_by ?? '', channel: x.channel, to: x.to_addr ?? '', status: x.status, error: u(x.error), messageId: u(x.message_id) })),
  }))

  const acksOf = group('broadcast_acks', 'broadcast_id'), runRows = group('payroll_rows', 'run_id'), runHist = group('payroll_history', 'run_id')
  const eventsOf = group('asset_events', 'asset_id'), movesOf = group('stock_moves', 'item_id'), datasetRows = group('recruitment_rows', 'dataset_id')
  const versions = [...rows('incentive_rule_versions')].sort((a, b) => a.version - b.version)
    .map((v) => ({ ...v.rules, version: v.version, updatedAt: v.updated_at, updatedBy: v.updated_by ?? 'system' }))
  const company = setting('company') ?? {}, session = setting('session') ?? {}, meta = setting('meta') ?? {}, maintenance = setting('maintenance')

  const db = {
    version: meta.version, upgrades: meta.upgrades ?? [], users, leads, bookings, invoices,
    services: rows('services').map((x) => opt({ id: x.id, name: x.name, category: x.category, price: x.price, gstRate: x.gst_rate, deduction: x.deduction, active: x.active, prices: u(x.prices) })),
    schemes: rows('schemes').map((x) => opt({ id: x.id, title: x.title, category: x.category, summary: x.summary, benefit: x.benefit, eligibility: x.eligibility, active: x.active, createdAt: x.created_at, by: x.created_by ?? '', price: u(x.price), startDate: u(x.start_date), endDate: u(x.end_date), updatedAt: u(x.updated_at), updatedBy: u(x.updated_by) })),
    posts: rows('posts').map((x) => opt({ id: x.id, kind: x.kind, title: x.title, body: x.body, theme: x.theme, createdAt: x.created_at, by: x.created_by ?? '', pinned: x.pinned || undefined })),
    broadcasts: rows('broadcasts').map((x) => ({ id: x.id, title: x.title, body: x.body, priority: x.priority, audience: x.audience ?? 'ALL', by: x.created_by ?? '', at: x.created_at, acks: acksOf(x.id).map((a) => a.user_id) })),
    events: rows('events').map((x) => ({ id: x.id, title: x.title, date: x.event_date, time: x.event_time ?? '00:00', kind: x.kind, description: x.description ?? '', by: x.created_by ?? '' })),
    leaves: rows('leave_requests').map((x) => opt({ id: x.id, userId: x.user_id, type: x.type, from: x.from_date, to: x.to_date, days: x.days, reason: x.reason, status: x.status, approvers: x.approver_roles, decidedBy: u(x.decided_by), decidedAt: u(x.decided_at), remark: u(x.remark), createdAt: x.created_at, attachment: u(x.attachment) })),
    sessions: rows('day_sessions').map((x) => opt({ id: x.id, userId: x.user_id, date: x.work_date, loginAt: x.login_at, logoutAt: u(x.logout_at), breaks: x.breaks?.length ? x.breaks : undefined, reopenedBy: u(x.reopened_by), lateBreak: u(x.late_break) })),
    notices: rows('notifications').map((n) => opt({ id: n.id, userId: n.user_id, title: n.title, body: n.body ?? '', link: u(n.link), at: n.created_at, read: n.read, kind: n.kind })),
    messages: rows('messages').map((m) => opt({ id: m.id, from: m.from_user, to: m.to_user, body: m.body, at: m.sent_at, read: m.read, attachments: u(m.attachments) })),
    templates: rows('message_templates').map((x) => ({ id: x.id, name: x.name, body: x.body, by: x.created_by ?? '' })),
    // the app keeps the audit log newest first; the table is oldest first
    audit: [...rows('audit_log')].reverse().map((a, i) => ({ id: `a-${a.id ?? i}`, at: a.at, by: a.by_user ?? '', action: a.action, detail: a.detail ?? '' })),
    rolePerms: rows('role_permissions').reduce((m, r) => { (m[r.role] ??= []).push(r.permission); return m }, {}),
    settings: opt({
      sessionMinutes: session.minutes, supplierState: company.supplierState, companyName: company.name, companyGstin: company.gstin,
      maintenance: maintenance && (maintenance.on || maintenance.message || maintenance.by) ? maintenance : undefined,
      sessionsValidAfter: u(session.validAfter), dayLock: setting('attendance')?.dayLock || undefined,
      branches: setting('branches')?.length ? setting('branches') : undefined, breakPolicy: u(setting('breaks')), leadAssign: u(setting('leadAssign')), workflow: u(setting('workflow')), jobs: u(setting('jobs')), dialerCampaigns: u(setting('dialerCampaigns')), clientTemplates: u(setting('clientTemplates')),
    }),
    counters: setting('counters') ?? { booking: 0, lead: 0, invoice: 0 },
    loginFails: Object.fromEntries(rows('login_attempts').map((r) => [r.login, opt({ count: r.failures, until: u(r.locked_until) })])),
    payrollRuns: rows('payroll_runs').map((r) => ({
      id: r.id, month: r.month, status: r.status, provisional: r.provisional, calculatedAt: r.calculated_at, calculatedBy: r.calculated_by ?? '',
      rows: runRows(r.id).map((x) => opt({
        userId: x.user_id, name: x.name, designation: x.designation ?? '', department: x.department ?? '', ctc: u(x.ctc), hra: u(x.hra), otherAllowance: u(x.other_allowance),
        gross: x.gross, daysInMonth: x.days_in_month, paidDays: x.paid_days, lopDays: x.lop_days, lopAmount: x.lop_amount, basic: x.basic, pfWages: x.pf_wages,
        pfEmployee: x.pf_employee, pfEmployer: x.pf_employer, pt: x.professional_tax, incentive: x.incentive,
        net: x.ctc != null ? x.net_salary : round2(x.net_salary + x.incentive), paidOn: u(x.paid_on), paidRef: u(x.paid_ref), paidBy: u(x.paid_by),
      })),
      history: runHist(r.id).map((h) => ({ at: h.at, by: h.by_user ?? '', action: h.action, note: h.note ?? '' })),
    })),
    pfSettings: setting('pf'),
    pfAccounts: rows('pf_accounts').map((a) => ({ userId: a.user_id, uan: a.uan ?? '', enrolled: a.enrolled })),
    incentiveRules: versions.at(-1), incentiveHistory: versions.slice(0, -1),
    manualIncentives: rows('manual_incentives').map((m) => opt({ id: m.id, userId: m.user_id, month: m.month, amount: m.amount, reason: m.reason, addedBy: m.added_by ?? '', addedAt: m.added_at, paidAt: u(m.paid_at) })),
    apiKeys: rows('api_keys').map((k) => opt({ id: k.id, name: k.name, prefix: k.prefix, hash: k.key_hash, scopes: k.scopes, createdBy: k.created_by ?? '', createdAt: k.created_at, expiresAt: u(k.expires_at), revokedAt: u(k.revoked_at), revokedBy: u(k.revoked_by) })),
    backupLog: rows('backup_log').map((b) => opt({ id: b.id, at: b.at, by: b.by_user ?? '', kind: b.kind, note: b.note ?? '', bytes: b.bytes ?? 0, encrypted: b.encrypted || undefined })),
    emails: rows('emails').map((e) => opt({ id: e.id, batchId: e.batch_id, to: e.to_user, toEmail: e.to_email, from: e.from_user ?? '', subject: e.subject, body: e.body, at: e.sent_at, automation: u(e.automation), read: e.read })),
    emailAutomations: rows('email_automations').map((a) => opt({ key: a.key, enabled: a.enabled, subject: a.subject, body: a.body, lastRunKey: u(a.last_run_key), lastRunAt: u(a.last_run_at), sent: a.sent })),
    candidateForms: rows('candidate_forms').map((f) => opt({ id: f.id, token: f.token, title: f.title, kind: f.kind, positions: f.positions?.length ? f.positions : f.position ? [f.position] : undefined, department: f.department ?? '', description: f.description ?? '', active: f.active, createdAt: f.created_at, by: f.created_by ?? '' })),
    candidates: rows('candidate_applications').map((c) => opt({ id: c.id, formId: c.form_id, name: c.name, email: c.email, phone: c.phone, city: c.city ?? '', dob: u(c.dob), qualification: c.qualification, college: u(c.college), experience: c.experience ?? '', currentCompany: u(c.current_company), expectedSalary: u(c.expected_salary), noticePeriod: u(c.notice_period), branch: u(c.branch), position: u(c.position), candidateType: u(c.candidate_type), currentCtc: u(c.current_ctc), interviewAt: u(c.interview_at), linkedin: u(c.linkedin), message: u(c.message), resume: c.resume, status: c.status, notes: u(c.notes), submittedAt: c.submitted_at, selected: c.selected ?? undefined, selectedAt: u(c.selected_at), selectedBy: u(c.selected_by) })),
    deletedItems: rows('deleted_items').map((x) => opt({ id: x.id, module: x.module, kind: x.kind, label: x.label, rows: x.rows ?? 1, data: x.data ?? null, files: x.files?.length ? x.files : undefined, deletedBy: x.deleted_by ?? '', deletedAt: x.deleted_at })),
    candidateLetters: rows('candidate_letters').map((m) => opt({ id: m.id, candidateId: m.candidate_id, kind: m.kind, channel: m.channel, to: m.to_addr, subject: u(m.subject), body: m.body, status: m.status, error: u(m.error), by: m.sent_by ?? '', at: m.sent_at })),
    legacyFiles: rows('legacy_files').map((x) => ({ path: x.path, file: x.file, kind: x.kind ?? '' })),
    leadUploads: rows('lead_uploads').map((x) => ({ id: x.id, fileName: x.file_name, size: x.size_bytes ?? 0, totalRows: x.total_rows ?? 0, imported: x.imported ?? 0, by: x.uploaded_by ?? '', at: x.uploaded_at })),
    assets: rows('company_assets').map((a) => opt({
      id: a.id, tag: a.tag, name: a.name, category: a.category, brand: u(a.brand), model: u(a.model), serial: u(a.serial), purchaseDate: u(a.purchase_date), cost: u(a.cost),
      vendor: u(a.vendor), warrantyUntil: u(a.warranty_until), location: u(a.location), condition: u(a.condition), status: a.status, assignedTo: u(a.assigned_to),
      assignedOn: u(a.assigned_on), notes: u(a.notes), invoice: u(a.invoice), createdAt: a.created_at,
      history: eventsOf(a.id).map((h) => opt({ at: h.at, by: h.by_user ?? '', action: h.action, userId: u(h.user_id), note: u(h.note) })),
    })),
    stock: rows('stock_items').map((x) => opt({ id: x.id, name: x.name, category: x.category, unit: x.unit, qty: x.qty, minQty: x.min_qty, unitCost: u(x.unit_cost), location: u(x.location), createdAt: x.created_at, moves: movesOf(x.id).map((m) => opt({ at: m.at, by: m.by_user ?? '', qty: m.qty, note: u(m.note), issuedTo: u(m.issued_to) })) })),
    expenses: rows('company_expenses').map((x) => opt({ id: x.id, date: x.spent_on, category: x.category, description: x.description, amount: x.amount, gst: x.gst, vendor: u(x.vendor), paidVia: x.paid_via, paidBy: u(x.paid_by), bill: u(x.bill), by: x.added_by ?? '', createdAt: x.created_at, branchId: u(x.branch_id) })),
    docForms: rows('doc_forms').map((f) => opt({
      id: f.id, token: f.token, name: f.name, description: f.description ?? '', instructions: f.instructions ?? '', kind: f.kind, fields: f.fields ?? [], version: f.version, versions: f.versions ?? [],
      status: f.status, bookingId: u(f.booking_id), expiresOn: u(f.expires_on), verify: f.verify ?? 'NONE', document: u(f.document),
      createdBy: f.created_by ?? '', createdAt: f.created_at, updatedAt: f.updated_at, updatedBy: f.updated_by ?? '', views: f.views ?? 0, lastViewedAt: u(f.last_viewed_at),
    })),
    formSubmissions: rows('doc_form_submissions').map((x) => opt({
      id: x.id, formId: x.form_id, formVersion: x.form_version, bookingId: u(x.booking_id), fields: x.fields ?? [], answers: x.answers ?? {}, files: x.files ?? [],
      submittedAt: x.submitted_at, status: x.status, reviewedBy: u(x.reviewed_by), reviewedAt: u(x.reviewed_at), note: u(x.note),
    })),
    siteContent: rows('site_content').map((x) => opt({ key: x.key, draft: x.draft ?? null, published: u(x.published), updatedAt: x.updated_at, updatedBy: x.updated_by ?? '', publishedAt: u(x.published_at), publishedBy: u(x.published_by) })),
    siteHistory: rows('site_content_history').map((x) => ({ id: x.id, key: x.key, content: x.content ?? null, at: x.published_at, by: x.published_by ?? '' })),
    clientAccounts: rows('client_accounts').map((x) => opt({ id: x.id, authUserId: u(x.auth_user_id), email: x.email, name: x.name, phone: u(x.phone), bookingIds: x.booking_ids ?? [], status: x.status, invitedAt: x.invited_at, invitedBy: x.invited_by ?? '', activatedAt: u(x.activated_at), lastLoginAt: u(x.last_login_at), assignedTo: u(x.assigned_to), disabledAt: u(x.disabled_at) })),
    clientActivity: rows('client_activity').map((x) => opt({ id: x.id, accountId: x.account_id, bookingId: u(x.booking_id), at: x.at, action: x.action, detail: u(x.detail), by: u(x.by_user) })),
    mediaItems: rows('media_items').map((x) => opt({
      id: x.id, serial: x.serial, schemeName: x.scheme_name, title: x.title, description: x.description ?? '', mediaType: x.media_type, files: x.files ?? [],
      internal: !!x.internal, external: !!x.external, clientBookingIds: x.client_booking_ids?.length ? x.client_booking_ids : undefined, assignDate: u(x.assign_date), assignTime: u(x.assign_time),
      assignedTo: u(x.assigned_to), workStatus: x.work_status, notes: u(x.notes), submitted: !!x.submitted, submittedAt: u(x.submitted_at), submittedBy: u(x.submitted_by),
      completedAt: u(x.completed_at), createdAt: x.created_at, createdBy: x.created_by ?? '', updatedAt: x.updated_at, updatedBy: x.updated_by ?? '', history: x.history ?? [],
    })),
    clientEntries: rows('client_entries').map((x) => opt({
      id: x.id, date: x.entry_date, clientName: x.client_name, companyName: x.company_name, phone: x.phone, serviceId: x.service_id ?? '', scheme: x.scheme,
      pitchedPrice: Number(x.pitched_price), status: x.status, requirement: x.requirement, note: x.note, followUp: u(x.follow_up), followUps: x.follow_ups ?? [],
      leadId: u(x.lead_id), ownerId: x.owner_id ?? '', createdAt: x.created_at, updatedAt: x.updated_at, bookingId: u(x.booking_id), convertedAt: u(x.converted_at), email: u(x.email),
    })),
    clientMessages: rows('client_messages').map((x) => opt({
      id: x.id, bookingId: u(x.booking_id), clientEntryId: u(x.client_entry_id), stage: x.stage, channel: x.channel, to: x.to_addr, subject: u(x.subject), body: x.body,
      status: x.status, error: u(x.error), by: x.sent_by ?? '', at: x.sent_at, providerId: u(x.provider_id),
    })),
    webLeadLog: rows('website_lead_log').map((x) => opt({ id: x.id, at: x.at, status: x.status, form: u(x.form), name: u(x.name), phone: u(x.phone), email: u(x.email), error: u(x.error), leadId: u(x.lead_id), fields: u(x.fields), retriedAt: u(x.retried_at), retriedBy: u(x.retried_by) })),
    automationRules: rows('automation_rules').map((x) => opt({
      id: x.id, name: x.name, description: u(x.description), enabled: x.enabled !== false, position: x.position ?? 0, trigger: x.trigger, entity: u(x.entity), match: u(x.match),
      conditions: x.conditions ?? [], actions: x.actions ?? [], repeatDays: u(x.repeat_days), createdAt: u(x.created_at), updatedAt: u(x.updated_at), updatedBy: u(x.updated_by),
    })),
    automationRuns: rows('automation_runs').map((x) => opt({
      id: x.id, ruleId: x.rule_id, ruleName: x.rule_name, at: x.at, by: u(x.by_user), trigger: x.trigger, recordType: x.record_type, recordId: x.record_id ?? '', recordLabel: x.record_label ?? '', ok: x.ok !== false, detail: x.detail ?? '',
    })),
    eligibilitySchemes: rows('eligibility_schemes').map((x) => opt({
      id: x.id, position: x.position, active: x.active !== false, name: x.name, kind: x.kind ?? '', agency: x.agency ?? '', url: x.url ?? '', serviceMatch: x.service_match ?? '',
      statusNote: x.status_note ?? '', summary: x.summary ?? '', benefits: x.benefits ?? [], documents: x.documents ?? [], process: x.process ?? [], conditions: x.conditions ?? [],
      subsidy: u(x.subsidy), bands: u(x.bands), verifiedOn: x.verified_on, updatedAt: u(x.updated_at), updatedBy: u(x.updated_by),
    })),
    salesKit: rows('sales_kit').map((x) => opt({
      id: x.id, category: x.category, position: x.position, name: x.name, benefits: x.benefits ?? '', sectors: x.sectors ?? '', eligibility: x.eligibility ?? '', lastDate: x.last_date ?? '',
      organisation: x.organisation ?? '', schemeType: x.scheme_type ?? '', applicableFor: x.applicable_for ?? '', minCharge: x.min_charge ?? '', registrationCharge: u(x.registration_charge),
      updatedAt: u(x.updated_at), updatedBy: u(x.updated_by),
    })),
  }
  const imports = rows('recruitment_datasets').map((x) => opt({ id: x.id, name: x.name, fileName: x.file_name, sheet: u(x.sheet), kind: x.kind, columns: x.columns, importedAt: x.imported_at, importedBy: x.imported_by ?? '', bytes: x.bytes ?? 0, rows: [...datasetRows(x.id)].sort((a, b) => a.row_no - b.row_no).map((r) => r.cells) }))
  return { db, imports }
}
