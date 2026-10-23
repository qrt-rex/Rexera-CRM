# Workflow automation — Legal → Operations → Admin

Handover notes for the October 2026 workflow upgrade. It adds to the existing CRM and doesn't redesign it:
the 8 processing stages, CRM entries, roles and screens all work as before.

## 1. How it fits together

```
Sales ─► Team Leader ─► Accounts ─► LEGAL ──approve──► OPERATIONS ──assign──► ADMIN ─► Ops approval ─► Completed
                                      │  └─changes required─► Sales corrects ─► back to Legal
                                      └─reject─► Sales (resubmit → Accounts)
                         on approval:  client welcome email (+ WhatsApp link) · 15-day follow-up starts
                         on Admin:     5-stage Admin checklist · Pitch Deck reminder every 3–4 days
```

- **Rules shared by the app and the server**: `supabase/workflow-rules.mjs` (IST dates, follow-ups, Pitch Deck,
  scheme dates, Admin progress, message templates) and `supabase/form-rules.mjs` (form fields, file checks).
  The browser and the live server use the same code, so the two can't disagree.
- **Scheduled jobs**: the server runs them, not the browser. `POST /api/jobs/run` → `server/jobs.mjs`, called every
  15 minutes by a scheduler. Each reminder is written to `reminder_log` under a unique key before it is sent, so a
  second run, or two runs at once, never sends it twice.
- **Fallback in the browser**: in local mode, or when the server job hasn't run for 2 hours, the CRM tab of whoever is
  signed in runs the same reminders, using the same duplicate guard on the file.
- **Public client forms**: `/f/<token>` → `GET /api/forms/<token>`, `POST /api/forms/<token>/submit` (`server/forms.mjs`).
  Clients never get access to a table or file. The server reads and writes with the secret key and checks every
  answer and file before storing anything.

## 2. Modules

| New | Purpose |
|---|---|
| `src/components/WorkflowPanels.tsx` | Booking → **Workflow** tab: welcome message status / retry / preview / WhatsApp, 15-day follow-up, Admin checklist + Pitch Deck |
| `src/pages/modules/Forms.tsx` (`/forms`) | Document Form Builder: build, preview, publish / close / archive, new link, send by email / WhatsApp, responses |
| `src/pages/PublicForm.tsx` (`/f/:token`) | The client's form page (no login) |
| `src/components/FormRenderer.tsx` | Shared field renderer (builder preview + client page) |
| `src/pages/modules/WorkflowSettings.tsx` (`/workflow-settings`) | Reminder intervals, auto-send, templates with preview, alert roles, Ops contact, job / email / WhatsApp status |
| `src/components/OpsAutomation.tsx` | Ops dashboard: automation alerts + **Admin Progress Overview** (per Admin, 5 stages, drill-down) |
| `src/components/OpsReport.tsx` | Reports → **Operations & Admin**: week / month / year / range, comparison, KPIs, drill-down, CSV |
| `src/lib/welcome.ts`, `src/lib/forms.ts` | Welcome message content + sending; form actions (tokens, versions, links, review) |
| `server/jobs.mjs`, `server/forms.mjs` | Scheduled jobs; public form endpoints |
| `supabase/workflow-rules.mjs`, `supabase/form-rules.mjs` | Shared rules (above) |

**Changed:**
- `src/lib/actions.ts`: decisions, Admin checklist, follow-ups, reminders, scheme rules and welcome state.
- `src/lib/types.ts`, `src/lib/rbac.ts`, `src/lib/hrsuite.ts` (upgrade `workflow-automation-1`), `src/lib/workflow.ts` and `src/lib/modules.ts`.
- `src/components/booking.tsx`, `BookingDetail.tsx`, `OpsDesk.tsx`, `WorkDashboards.tsx`, `Reports.tsx` and `Schemes.tsx`.
- `src/layout/Shell.tsx`, `src/App.tsx`, `src/lib/cloud.ts` and `supabase/backup-mapping.mjs`.
- `server.mjs`, `vite.config.ts`, `Dockerfile`, `render.yaml` and `.env.example`.

## 3. Database (`supabase/migrations/20261022000000_workflow_automation.sql`, also at the end of `run-now.sql`)

Additive only, and safe to run more than once:
- **Enum value**: `booking_status` gains `CHANGES_REQUIRED`.
- **`bookings`**: new jsonb columns `welcome`, `follow_up` and `admin_work`.
- **`schemes`**:
  - new columns `price`, `start_date`, `end_date`, `updated_at` and `updated_by`;
  - checks: price ≥ 0, and the end date not before the start date.
- **`reminder_log`**: the sent-reminder ledger, with a unique key per reminder. Masters and `workflow.manage` can read it; only the server writes it.
- **`doc_forms` and `doc_form_submissions`**: RLS requires `forms.manage`, and only masters can delete a submission. Both tables are in the realtime publication.
- **`role_permissions`**:
  - Admin gets `workflow.manage`, `followup.manage` and `forms.manage`;
  - Operation Team gets `forms.manage`.
- **`app_settings` policy**: users with `workflow.manage` may write the `workflow` key.
- **`invoice_shares`** (`20261023000000_invoice_shares.sql`): one row per invoice sent to a client. Anyone who can open the invoice can read it; only the server writes it. It is in the realtime publication.
- **Trigger `bookings_status_guard`**: a status change must follow the rules in section 4. A direct API write can't skip a step.
  - Not limited: the server (secret key), the SQL editor, and Super Admin / IT.

## 4. Status transitions

| From | To | Action | Who (app and database) |
|---|---|---|---|
| Pending Team Leader | Pending Accounts / Rejected | Approve / Reject | the file's Team Leader (`bookings.approve_tl`) |
| Pending Accounts | Pending Legal / Accounts hold / Rejected | Approve / Hold / Reject | Accounts |
| Accounts hold | Pending Legal / Rejected | Approve / Reject | Accounts |
| **Pending Legal** | **In Operations** | **Approve and assign Operations** (needs the Agreement or Undertaking) | Legal |
| **Pending Legal** | **Changes required** | **Request changes** (reason required) | Legal |
| Pending Legal | Rejected | Reject (reason required) | Legal |
| **Changes required** | **Pending Legal** | Resubmit after correcting (owner may edit) | the sales owner |
| Rejected | Pending Accounts / Pending Team Leader | Resubmit / send to a Team Leader | the sales owner |
| In Operations | With Admin / On hold | Assign Admin / Hold | the file's Operations member |
| With Admin | Ops approval / On hold / In Operations | Work done / Hold / Return | the file's Admin |
| Ops approval | Completed / With Admin | Approve / Send back | the file's Operations member |
| On hold | the status it came from | Resume | the file's Operations member or Admin |
| Completed | In Operations | Re-open by moving the stage back (reason required) | Operations / Admin |

Super Admin may take every action. Every decision records who acted, when and the remark in the file's approval history.

## 5. Reminder logic (all dates in IST)

| Reminder | Starts | Repeats | Stops | Who is told |
|---|---|---|---|---|
| **File follow-up** | Legal approval (first time only) | every 15 days (Workflow settings; changeable per file) | file completed or rejected, or paused | Operations member + Admin |
| **Pitch Deck** | Admin assigned | every 3 days (3 or 4, global and per file) | stage Approved / Completed / Not needed | file's Admin + Operations member |
| **Scheme ending** | — | once, the day before the end date | after it is sent | roles in Workflow settings (Admin, Operations by default) |
| **Welcome retry** | Legal approval | pending > 5 min, stuck sending > 15 min, failed: up to 3 attempts, 30 min apart | sent, or 3 failed attempts | Operations member on failure |

- **Missed runs**: when the server was down, the next run sends **one** reminder, not one per missed date. The next date then moves to the first date in the future that keeps the same rhythm.
- **Pause and resume**: Admin (`followup.manage`) can pause, resume, change the next date or change the interval. Resuming never sends the missed reminders.
- **Notes**: Operations, Admin, and anyone with `followup.manage` can record follow-up notes. A note sets "last follow-up".
- **Overdue**: shown on the file, on the Ops dashboard alerts, and in the Admin Progress Overview.

## 6. Integrations: what works now and what's missing

| Integration | Status |
|---|---|
| Welcome email | **Works once `SMTP_PASS` is set on Render** (SMTP `no-reply@hr.rexera.in`; Resend if `RESEND_API_KEY` is set). Each attempt is logged with status, recipient, attempts and error. Without SMTP the file shows **"Not set up"**; nothing is marked sent |
| Welcome WhatsApp | **Interakt** (`server/whatsapp.mjs`). Needs `INTERAKT_API_KEY` on Render and an approved template name in Workflow settings → WhatsApp templates. Sent on Legal approval; the job retries up to 3 times. A per-file ledger (`reminder_log` key `welcome-wa:<file>`) stops a second message. "Sent" means Interakt accepted it; delivery and read receipts aren't tracked (Interakt webhook not connected). Without the key or template it shows "Not set up", and **Open in WhatsApp** (wa.me) still works |
| Invoice PDF | **Send to client** on the invoice (`server/share.mjs`, `POST /api/invoices/send`). The PDF (`src/lib/invoicePdf.ts`) is attached to the email and sent on WhatsApp as a document. For WhatsApp, a private copy in `crm-files` is reached through a 7-day signed link. Each result is stored in `invoice_shares` (written by the server only) and shown on the invoice |
| Form links by email | Uses the same email setup |
| Form links by WhatsApp | wa.me button (manual) |
| Scheduled jobs | Need `JOBS_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and a scheduler (section 9) |
| Public forms | Need `SUPABASE_SECRET_KEY` on the server. In local / browser mode the client page says "Forms are not available right now" |
| E-signature | **Not built**: needs a provider (e.g. Digio, Leegality). Clients upload a signed document instead |

## 7. Permissions

| Feature | Super Admin / IT | Admin | Operation Team | Legal | Accounts | Sales | Team Leader / Branch Director |
|---|---|---|---|---|---|---|---|
| Approve / request changes / reject at Legal | ✓ | | | ✓ | | | |
| Correct and resubmit after "changes required" | ✓ | | | | | own files | |
| Welcome message: send / retry / WhatsApp | ✓ | ✓ | ✓ | ✓ | | | |
| Follow-up notes | ✓ | ✓ | own files | | | | |
| Pause / resume / reschedule follow-up | ✓ | ✓ | | | | | |
| Admin checklist stages | ✓ | own files | own files | | | | |
| Pitch Deck interval (3/4 days) | ✓ | ✓ | own files | | | | |
| Form Builder + responses (`forms.manage`) | ✓ | ✓ | ✓ | | | | |
| Workflow settings (`workflow.manage`) | ✓ | ✓ | | | | | |
| Schemes: add / edit (`schemes.manage`) | ✓ | ✓ | ✓ | | | | |
| Schemes: view | all | all | all | live only | live only | **live only, read-only** | live only |
| Admin Progress Overview (Ops dashboard / Admin dashboard) | ✓ | ✓ | ✓ | ✓ | | | |
| Reports → Operations & Admin (`reports.view`) | ✓ | ✓ | ✓ | ✓ | ✓ | | Branch Director |

**Where each rule is enforced:**
- **Decisions and status changes**: checked in the app and by the database trigger.
- **Forms, settings and schemes**: database RLS.
- **Follow-up, checklist and welcome fields**: checked in the app. In the database they are covered by the existing booking visibility rule, i.e. anyone who can see the file (see section 11).
- **Hidden scheme details for Sales**: hidden in the app only. RLS hides inactive schemes, but an active scheme's category, benefit and eligibility columns are readable by any signed-in user.

## 8. Tests

Run with `npm run db:check`. All pass:
- `server/jobs.test.mjs`: follow-up, Pitch Deck, scheme and welcome-retry jobs each send exactly once across repeated runs; a follow-up several days overdue sends one reminder and moves to the next future date; the jobs secret is required.
- `server/forms.test.mjs`:
  - malformed, closed and expired links are refused;
  - the mobile check (nothing of the form is shown before it);
  - answer validation, and a renamed `.exe` is refused;
  - files are stored privately;
  - the form version is kept with the submission;
  - notification and audit entry.
- `supabase/workflow-rules.test.mjs`: IST dates, intervals, scheme state and days left, Admin progress counts and %, templates.
- `supabase/backup-mapping.test.mjs`: every new field survives app → tables → app.
- Existing suites (Blutec, website leads, lead upload, cloud sync).

**Typecheck and build:** `npx tsc -b` and `npm run build` pass.

**Browser check** (test copy, local mode):
- **Legal**: request changes needs a reason; the owner can edit and resubmit; approval moves the file to Operations and creates the welcome and follow-up once.
- **Welcome**: a second approval doesn't duplicate it; without SMTP it honestly reports "Not set up".
- **Admin**: the checklist is created with 5 stages; Sales are blocked; "returned" needs a note.
- **Pitch Deck reminder**: fires once, then not again; an interval of 5 days is refused; it stops when done.
- **Follow-up reminder**: fires once; Operations can't pause it, Admin can; resume moves the date forward.
- **Schemes**: bad dates are refused, Sales can't edit, the expiry alert fires once.
- **Progress**: shows 1/5 (20%).
- **Forms**: Sales are blocked; publishing an empty form is refused; editing a live form makes v2; a new link replaces the old token.
- **Pages**: `/forms`, `/workflow-settings`, `/ops-desk`, `/reports` (Operations & Admin), `/schemes` and the Workflow tab all render without errors.

**Not tested here:**
- **The SQL migration**: no Postgres on this computer. Run it in the Supabase SQL editor; it stops with a visible error if anything is wrong.
- **Real email delivery**: no SMTP password on this computer.

## 8a. October 24 additions

- **Clickable counts**: every count on the Operation team dashboard opens its list. Most go to the Operations Dashboard via `/ops-desk?filter=active|admin|review|hold|overdue|week|done|all&member=me|team`; tasks go to `/work` and documents to `/documents`. The Operations Dashboard and Admin dashboard counts are clickable too.
- **Forward stages**: the file's Operations person uses **Forward stages** on the Workflow tab to give Pitch Deck, Finance, DPR, Certification and Submission to different Admins.
  - Each new person gets the next assignment number: `RX-2026-000127/1`, `/2`, `/3` … (stages given to the same person at the same time share one).
  - The number is shown on the stage, sent in the notification, and used in the uploaded file's name.
  - It is kept in the stage history (`admin_work.*.history[].ref`), so no new column is needed.
- **Admin upload**: when a stage is assigned to an Admin, they get **Upload file** on that stage (and in its status window). The file is stored on the CRM entry as a document of that stage, and Operations is told so they can verify it.
  - The Admin dashboard lists **My Admin stages**.
- **Document review is final**: once a document is verified or rejected, only a Super Admin can change it.
  - Who decided, and when, is shown everywhere.
  - In the database, `booking_documents.reviewed_by` / `reviewed_at` are stamped by a trigger, which also refuses the change (`20261024010000_document_review_lock.sql`).
- **Form Builder → Share**: send a form link by email (any address) and WhatsApp. WhatsApp goes through Interakt when a **form link template** is set in Workflow settings (`{{1}}` client, `{{2}}` form, `{{3}}` link, `{{4}}` company); otherwise WhatsApp opens with the message ready.
  - Route: `POST /api/forms/share`.
- **Sales Kit** (`/sales-kit`): the 55 schemes from *Sales Kit.xlsx* in 7 categories.
  - Everyone can read it; only the Operation team (`saleskit.manage`, plus Super Admin / IT) can add, edit or remove schemes. This is checked in the app and by RLS.
  - Migration: `20261024000000_sales_kit.sql`, which also loads the list.
- **Wording**: "Pre-Check Deck" is now **Pitch Deck** everywhere on screen (internal names such as `PRECHECK` and `precheckDays` are unchanged, so existing data keeps working).
  - Spelling fixes: "Joinees" → "Joiners"; in the Sales Kit, "encouaged", "custome hiring", "verticle", "regitration", "Liqiuor", "Empowermentc" and "Tamilnadu" are corrected.

## 9. Deployment

1. **Database**: Supabase → SQL editor → paste and run `supabase/run-now.sql`. It is safe to run again.
2. **Render environment** (rexera-crm → Environment):
   - `JOBS_SECRET`: a new random value of at least 16 characters. Keep it private.
   - `SMTP_PASS`: the mailbox password, if not set already.
   - `INTERAKT_API_KEY`: Interakt → Settings → Developer Settings.
   - `SUPABASE_URL` and `SUPABASE_SECRET_KEY`: if not set already.
3. **Push** the commit, and Render redeploys.
4. **Scheduler**: every 15 minutes, call `POST https://<your-app>.onrender.com/api/jobs/run` with header `X-Jobs-Secret: <JOBS_SECRET>`. Use one of:
   - **cron-job.org** (free): new cron job → URL above → Advanced → request method POST, header `X-Jobs-Secret`.
     The free Render plan sleeps when idle. The first call may then time out on cron-job.org's side, but the server still runs the job.
   - **Render Cron Job** (billed by Render): command `curl -fsS -X POST -H "X-Jobs-Secret: $JOBS_SECRET" https://<your-app>.onrender.com/api/jobs/run`, schedule `*/15 * * * *`.
5. **Check**:
   - Workflow settings shows "Scheduled job: last run …".
   - Approve a test file at Legal, then check its Workflow tab shows the email as Sent.
   - Open a published form link on a phone.

## 10. Rollback

- **Code**: redeploy the previous commit (Render → Deploys → *Rollback*, or `git revert` the commit and push).
- **Scheduler**: pause the cron job.
- **Database**: the changes are additive, so the old code ignores the new columns and tables.
  - Before rolling back the code, move files out of "Changes required": `update bookings set status = 'PENDING_LEGAL' where status = 'CHANGES_REQUIRED';`. The old app doesn't know that status. An enum value can't be dropped, but it does no harm.
  - To remove the status guard: `drop trigger if exists bookings_status_guard on bookings;`.
  - To keep data, leave `doc_forms`, `doc_form_submissions` and `reminder_log`. Otherwise drop them.

## 11. Known limits and remaining configuration

- **WhatsApp (Interakt)**:
  - Create two templates in Interakt and wait for Meta's approval. Variable order is shown in Workflow settings.
    - **Welcome** (text): `{{1}}` client name, `{{2}}` service, `{{3}}` reference, `{{4}}` Ops name, `{{5}}` Ops phone.
    - **Invoice** (Document header): `{{1}}` client name, `{{2}}` document, `{{3}}` amount, `{{4}}` company.
  - Enter the template code names in Workflow settings.
  - Sending needs the live CRM (Supabase sign-in). The server checks the caller can open the invoice or file.
- **Invoice bank line**: the printed and sent invoice carries a fixed bank line (`HDFC Bank · A/c 50200012345678 · IFSC HDFC0001234`). Confirm it's the real account before sending invoices to clients.
- **E-signature**: needs a provider.
- **Stored files**: uploads, including form submissions, are in the private `crm-files` bucket. Any signed-in staff member who knows a file's id can read it. Per-file storage rules would be a separate change.
- **Workflow fields on a file**: the welcome, follow-up and Admin-checklist fields are checked in the app. In the database, anyone who can see the file can write them, as with other booking fields today.
- **Welcome emails before SMTP**: files approved while SMTP isn't set up stay "Not set up". Press **Retry** on the file after SMTP is configured; nothing is sent automatically for them.
- **To fill in**:
  - Workflow settings → **Operations contact** (name, phone, email): used in the welcome message.
  - Review the welcome templates.
  - Choose the scheme alert roles.
