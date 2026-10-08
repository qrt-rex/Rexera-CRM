# Rexera CRM 2.0

A modern, role-based CRM for Rexera Financial Services — built from the dashboard mockups and the
`CRM_PROMPT.md` / `CRM_LOGIC.md` specs. One login, eight purpose-built dashboards, and the full client-file
workflow from lead to completed work.

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:5180>. Other commands: `npm run build` (type-check + production build), `npm run typecheck`.

## Live Production Deployment

To host live on a **VPS, Render, Railway, Cloud VM, or Docker**:

### 1. Standard Node.js Server
```bash
npm install
npm run build
npm start
```
Runs `server.mjs`, serving the production frontend with SPA routing and live SMTP endpoints for reset link & OTP emails.

### 2. Docker Deployment
```bash
docker build -t rexera-crm .
docker run -p 5180:5180 --env-file .env.local rexera-crm
```

### 3. Live Server Environment Variables
Set these in your host dashboard (Railway / Render / VPS environment variables):
- `PORT` — default `5180` (or injected by platform)
- `SMTP_HOST` — `smtp.hostinger.com`
- `SMTP_PORT` — `587`
- `SMTP_USER` — `no-reply@hr.rexera.in`
- `SMTP_PASS` — your email password (wrap in quotes if it has `#`, e.g. `"pass#123"`)
- `SMTP_FROM` — `"Rexera CRM" <no-reply@hr.rexera.in>`


### Sign-in accounts

Sign in with the company email (not case-sensitive) and the password agreed for that account. Only
SHA-256 hashes of those passwords are stored, in `src/lib/seed.ts` (`PRESET_HASHES`).

| Role | Email |
|---|---|
| Super Admin | qrt@rexera.in |
| Super Admin | superadmin@rexera.co.in |
| Admin | admin@rexera.co.in |
| HR | hr@rexera.co.in |
| HR | hr@rexera.in |
| Legal | legal@rexera.co.in |
| Sales Person | sales@rexera.co.in |
| IT Support | it@rexera.co.in |
| Customer Support | support@rexera.co.in |
| Operation Team | ot@rexera.co.in |

The extra sample people (Accounts, Team Leaders, more sales and operations staff) use `DEMO_PASSWORD`
from the same file.

In developer mode the login page's **Accounts** panel fills an account's email, and after the password the
6-digit code is shown on screen — click **Use code**. Both are hidden in production builds (unless
`VITE_DEMO=1`). Sign-in needs a secure context (`localhost` or `https://`), because passwords are checked
with the browser's SHA-256.

## The client-file workflow

```
Sales: New CRM entry (client, service, quote, advance + proof)
  → Team Leader approves / rejects
  → Accounts verifies payments: approve / reject / on hold
  → Legal reviews and assigns an Operation Team member + furthest allowed stage
  → Operations moves the 9 stages (cannot pass the allowed stage), then assigns to Admin
  → Admin completes the client work (or holds / returns to Operations)
```

Every step is recorded on the entry's timeline, notifies the next person (bell, pop-up bubble, sidebar
count) and tells the sales owner the outcome. Rejected entries go back to the owner to fix and resubmit.

9 stages: Data Collection → Data Received → Documents In-process → Documents In-review → Documents Approved
→ Ready to Submit → Submitted → Approved / Rejected → Re-submission.

## What each dashboard has (from the mockups)

- **Sales / Team Leader** — New CRM Leads, Dialer (highlighted), Document Form, Flyer & Post, Schemes,
  Invoice / Bill, Sales Information, CRM Entry, Broadcast, client assignment, Request my leave, Attendance,
  Login–Logout card, collections vs target ring, CRM entries with live approval stepper. Team Leader adds
  Sales team progress, assign client to sales person, sales person ↔ client info and an approval queue.
- **Accounts** — CRM entries (view & edit money, deductions, verify payments), client files approve /
  reject / on hold, collections chart.
- **Legal** — review & assign to Operations (member + max stage + deadline), Operations workload, leave approvals.
- **Operation Team** — KPI strip, Document Management, Tasks & Follow-ups (kanban), Reports, Assign to
  Admin, Flyer/post edit, Employee details.
- **Admin** — assigned to me by Operations, CRM entries, flyer/post edit, completed and on-hold clients.
- **Super Admin** — Login/Logout, Calendar, Invoice total, Attendance top row; 16 module tiles; Reports and
  All-dashboards column; can open every role's dashboard.
- **HR** — people KPIs, weekly attendance, leave approvals, employee distribution, events, broadcasts.

Every dashboard has the sidebar (Dashboard, Attendance Board, modules, month calendar with event dots,
Profile setting, Email and Notification counts), the pill search (**Ctrl + K** command palette across pages,
clients, leads and people), the bell menu and the notification speech-bubble.

## Modules

Leads (import/export CSV, duplicate-phone block, bulk assign, call history) · Dialer (queue, call timer,
outcomes move the lead status) · CRM entries (list, form with live GST, detail with payments, balance
payments, deductions, 9-stage processing, tasks, documents, timeline with @mentions) · Waiting for me ·
Client Work Board (kanban / table) · Document forms · Schemes · Flyers / Posts / Sales info (copy, download)
· Broadcasts with acknowledgement · Billing (tax & proforma invoices, CGST+SGST vs IGST, printable invoice,
payments, GST register CSV) · Attendance (live board + daily register) · Leave (balances, routing by role) ·
Employees · Events calendar · Messages + templates · Sales team progress · Reports (overview, services,
revenue, report cards, exports) · Notifications · Access management (users, extra roles, per-user
allow/deny, role × permission matrix, system settings) · Activity log · Profile settings (photo, address,
password, pop-up toggle, light/dark/system theme).

## How it's built

- React 19 + TypeScript + Vite + Tailwind CSS v4, React Router 7, lucide-react. Pages are lazy-loaded.
- `src/lib/types.ts` — data model; `src/lib/rbac.ts` — roles, permission catalogue, default matrix,
  reserved permissions; `src/lib/workflow.ts` — stages, statuses, call outcomes.
- `src/lib/actions.ts` — **all business rules** (every write checks permissions and validates input:
  phone, PAN, GSTIN, PIN, amounts). `src/lib/store.ts` — a local JSON document store persisted to
  `localStorage` and synced across tabs.
- Data lives in the browser in this build, so it runs with no backend. To connect the existing FastAPI
  backend, replace the bodies of the functions in `actions.ts` with `fetch` calls; pages don't change.

## Before real use

This build is a fully working front end with a browser-side store. For production:

1. Connect it to the FastAPI/PostgreSQL backend (server-side RBAC, bcrypt passwords, real emailed codes).
2. Remove the demo password and demo-accounts panel (`src/lib/seed.ts`, `src/pages/Login.tsx`).
3. Store uploaded files on the server (the demo keeps only small files' previews in the browser).
