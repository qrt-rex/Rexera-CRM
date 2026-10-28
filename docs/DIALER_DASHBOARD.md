# Dialer dashboard (Dialer → Dashboard)

**Before using it:** run `supabase/migrations/20261029000000_dialer_dashboard.sql` and
`20261029010000_invoice_remarks.sql` in Supabase → SQL Editor (both are also at the end of `supabase/run-now.sql`).
Neither changes existing rows. Until they are run, calls and invoices still save; only the new fields are left out.

## Where each number comes from

| Panel | Source | Code |
|---|---|---|
| Calls today, Completed, Talk time, Total duration | The CRM call log (`lead_calls`). Each dialer call is saved by the agent and/or Blutec's `call.completed` webhook under the same id `bt-<ref_id>`, so it is never counted twice | `src/lib/callStats.ts` → `callKpis` |
| Completed | Blutec final status `completed` with talk time > 0; calls made from the agent's own phone count unless the outcome is Not pickup / Busy / Voice mail | `isCompleted` |
| Talk time / Total duration | `duration_sec` (Blutec `talk_duration_seconds`) / `total_sec` (Blutec `duration_seconds`, ringing included; talk time when Blutec sent none) | `callKpis` |
| Disposition breakdown | The outcome saved for each of today's calls (Blutec dispositions are mapped to the CRM outcomes by `dispositionToStatus`) | `dispositionCounts` |
| Your campaigns | Blutec `GET /api/campaigns` (already used by the CRM), limited on the server to the campaigns the Super Admin assigned to that person (Dialer → IVR campaigns → Dialer campaigns → Assign) | `server.mjs` (`myCampaigns`), `_shared/blutec.ts` (`campaignsByIds`) |
| Upcoming callbacks | Open leads assigned to the agent with a follow-up date (overdue first) | `pendingCallbacks` |
| Today's activity | Start my day / breaks / Logout (attendance), call time, and wrap-up (from the end of a call until its outcome is saved). On Call / Wrap Up for the current call come from the agent's own dialer | `agentActivity` |

Refresh: the call log is live (Supabase Realtime). Campaigns are re-read once a minute, and the time each was last read is shown. A failed Blutec request shows its error and keeps the last data. It never marks anyone Offline.

## Access

- **Sales person / team leader:** their own dashboard.
- **Super Admin, IT, and anyone with `leads.manage` or `team.progress` (team leaders, branch directors):** an Agent picker. The numbers are built only from leads the viewer may already see (row-level security in Supabase), so a changed parameter can't reveal more. An Admin sees other agents once the Super Admin grants one of those permissions in Access Management.
- **Company campaign list (`campaigns`, `campaignLeads`, `campaignsByIds`):** Super Admin / IT only on the server. A sales person gets only their assigned campaigns, and the server works out which ones those are from their sign-in.
- **Blutec credentials:** stay on the server (`BLUTEC_*` on Render).
- **Webhooks:** checked with Blutec's HMAC signature (`server/blutecWebhook.mjs`).

## Blutec limitations

The Blutec documentation (docs.dialer.blutec.ai) and API hosts could not be reached while this was built. Only endpoints the CRM already used were relied on: click-to-call, call status, campaigns, DND and IVR. So:

- **Agent status (Available / On Call / Wrap Up / Break / Offline)** is worked out from CRM data, not read from Blutec. If Blutec exposes an agent-state API, `agentActivity` is the single place to switch to it.
- **Campaign assignment** is kept in the CRM, because no verified Blutec endpoint lists the agents in a campaign.
- **Callbacks** use CRM follow-up dates, which are days only, not times.
- **Not yet tested against real Blutec credentials.** Check on the live site that `call.completed` deliveries arrive. They need `BLUTEC_CALLS_WEBHOOK_SECRET`, or `BLUTEC_TOKEN` so the server can read the secret, and Blutec pointed at `/api/blutec/webhook/calls`. Also check that campaign rows carry `total_leads` / `fresh_leads`; progress is shown only when they do.
