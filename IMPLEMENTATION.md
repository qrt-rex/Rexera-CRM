# CRM change requests: status and remaining work

Checked against `main` at `fb0a6cb` (2026-10-21). The build passes and `npm run db:check` passes all 5 suites.

**Before anything else:** run `supabase/run-now.sql` in Supabase → SQL Editor. It includes `20261021000000_crm_requests.sql` (prices per booking type, TDS, commission, refunds, salary status, branch expenses) and `20261020000000_sales_target_setters.sql`. Without it, these features don't save in Supabase mode.

## Done (in the code)

| # | Request | Where |
|---|---------|-------|
| 1 | Website form → CRM leads | `POST /api/website-lead`: `server/websiteLeads.mjs`, route in `server.mjs`. Removes duplicates by phone, has a spam trap and a rate limit, and checks the optional `WEBSITE_LEAD_KEY` |
| 2 | CRM Leads for Super Admin only (manual, website, CSV); lead source shown only to Super Admin | `leads.admin` permission (reserved to `superadmin`, `src/lib/rbac.ts`). Sales and team leaders work their leads in the Dialer |
| 3 | Automatic equal assignment, remainder going back to the first person, plus manual | `roundRobin` / `shareLeads` in `src/lib/actions.ts`; `src/components/LeadSharing.tsx` (Auto-assign, Share equally) |
| 4 | Industry dropdown on CRM entry | `INDUSTRIES` in `src/lib/catalog.ts`, `BookingForm.tsx` (with an Other option to type one) |
| 5 | Email Center in its own layout, not the HR dashboard | Removed from `HR_PATHS` in `src/layout/Shell.tsx` |
| 6 | Remove employee where employees are added | `removeEmployee` / restore in `actions.ts`, `Employees.tsx` |
| 7 | Entries from sales / team leaders go straight to Accounts | `createBooking` → `PENDING_ACCOUNTS` |
| 8 | Branch-wise expenses (AMD-A, AMD-Y, BRD, ALL) | `src/lib/assets.ts`, `src/pages/hr/Assets.tsx` |
| 9 | Razorpay in the payment-mode dropdowns | `PAYMENT_MODES`, used by the CRM entry form, Add payment and Mark paid |
| 10 | CA/DSA commission, optional, 5–30 %, typed by hand (Accounts) | `setCommission`, `BookingDetail.tsx` |
| 11 | TDS on a payment: 1–15 %, 10 % by default | `addPayment` / `setPaymentTds` |
| 12 | Part payments 2, 3, 4… added later count on the day and in the month they were paid | `addPayment`; the scorecard and `collections()` add up by `payment.date` |
| 13 | Booking types: Single, Multiple, Combo 3 / 6 / 9 / 12 months | `BOOKING_TYPES`, `COMBO_PACKAGES` in `catalog.ts`; Services page with a price per type |
| 14 | Price bifurcation required except for funding services | `isFundingService` / `needsPriceSplit` |
| 15 | Total quoted = the advance (part 1), not the sum of the scheme prices | `createBooking` (`totalQuoted = payments[0].amount`) |
| 16 | Proforma invoice always reads "Consultancy services" | `PROFORMA_SERVICE`; read-only in `Billing.tsx` |
| 17 | Refund entries, Accounts only | `refunds.manage` (reserved to `superadmin` and `accounts`), `Refunds.tsx` |
| 18 | Complimentary services added by the Operation team | `addComplimentaryService` |
| 19 | Salary Paid / Not Paid page with search | `src/pages/hr/SalaryStatus.tsx` (`/salary-status`) |
| 20 | Share invoices by email and WhatsApp | `InvoiceView.tsx`: email, plus a WhatsApp `wa.me` link |

## Not done or partly done: to work on

- [ ] **Services from the uploaded photo.** The prices-per-type column and the combo packages exist, but the services and prices from the photo are not entered. That photo isn't in the repo.
  Enter them on the Services page, or send the photo again so they can be seeded.
  Also confirm: the request said "4 columns" but listed 6 (Single, Multiple, Combo 3/6/9/12). All 6 were built.
- [ ] **Connect the website itself.** The CRM side is ready, but rexera.co.in's form still has to post to `https://rexera-crm.onrender.com/api/website-lead`. The address and the field names are shown in CRM Leads → Website form.
  - Set `WEBSITE_LEAD_KEY` on Render if you use a key.
  - Small fix needed: the server's CORS `Access-Control-Allow-Headers` (`server.mjs`, the `sendJson` headers) lacks `X-Website-Key`. A browser `fetch` that sends the key as a header will be blocked; sending it as a `key` form field works. Add the header name when wiring the site.
- [ ] **Scorecard drill-down by payment date.** The scorecard already counts each part payment in the month it was paid, but it shows only totals.
  The request asked it to show "this was added on this date". Still to add: a per-person list of the payments that make up the figure (CRM entry, part no., date, amount).
- [ ] **Scorecard rules to confirm** before changing the code:
  - It adds `payment.total`, which includes GST, while Performance and Incentives use the amount before GST.
  - It counts payments Accounts hasn't verified yet.
  - It doesn't take off TDS (the money the client kept back) or refunds.
  Decide which of these should change, then make `collections()` (`src/lib/metrics.ts`) and `src/lib/scorecard.ts` agree.
- [ ] **WhatsApp sending.** Today it is a `wa.me` link that opens WhatsApp with the message filled in. You said you'll integrate the WhatsApp API later; replace the link in `InvoiceView.tsx` (`share.whatsapp`) then.
