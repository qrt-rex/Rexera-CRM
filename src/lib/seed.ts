import type { Booking, BookingStatus, DB, DaySession, Invoice, Lead, LeadStatus, Payment, Role, Service, User } from './types'
import { DEFAULT_ROLE_PERMS } from './rbac'
import { hashPassword } from './crypto'
import { addDays, round2, ymd } from './format'
import { STAGES } from './workflow'

export const SEED_VERSION = 5
/** Password for the extra sample accounts (local demo only — change or remove before any real use). */
export const DEMO_PASSWORD = 'Rexera@2026'

/**
 * Company sign-in accounts. Only SHA-256 hashes of the agreed passwords are kept here, never the
 * passwords themselves (hash = sha256("rexera:<username>:<password>"), see lib/crypto.ts).
 */
const PRESET_HASHES: Record<string, string> = {
  superadmin: '6bb511d5f4d9a868caaac6077860d9d660204b4996fcb08ef79314b9404fe808',
  admin: 'c0d44c22cddc33e8fd6b6236bad908b3a1a68c9e1f223b76484eed06555258c5',
  hr: '6ef17e0e44865676e1dc7a3ae239af168876547e5d92db0000f35bfcfcd03f83',
  'hr.in': 'fd6d9fabfd45513242d037faea66bfe70a04139fca113ede005f118aff2f3c2a',
  legal: '7052a4468cb9adb82f8f347d87d4f422d1ab91be4e25d8281422be31858f8437',
  sales: '5254c0154ae93cf5f3d4b3118e10e6087cd5c30278d78e1292b4dbc93933ce9c',
  it: '93a51d36276b2da859cd06d855eb9f37c98dbcad4fab4323cd7f540d1716bc0e',
  support: '25238f269956cbdc28489ee06ed8f4a9ee4ab6b8665660b38aea2d5853b2a939',
  ot: 'c93b9710653fcf6cfa95fbcb00201e486819b3d09c8198905d202eca83a34f63',
}
/** Accounts with their own password (the login demo panel fills only their email). */
export const PRESET_USERS = new Set(Object.keys(PRESET_HASHES))
const EMAILS: Record<string, string> = {
  superadmin: 'superadmin@rexera.co.in', admin: 'admin@rexera.co.in', hr: 'hr@rexera.co.in', 'hr.in': 'hr@rexera.in',
  legal: 'legal@rexera.co.in', sales: 'sales@rexera.co.in', it: 'it@rexera.co.in', support: 'support@rexera.co.in', ot: 'ot@rexera.co.in',
}

let s = 20261005
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!
const between = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1))
const at = (daysAgo: number, h = 10, m = 0) => {
  const d = addDays(new Date(), -daysAgo)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

const SERVICES: [string, string, number][] = [
  ['Seed Fund Scheme', 'Government Grants & Schemes', 75000],
  ['PMEGP Loan Assistance', 'Government Grants & Schemes', 45000],
  ['PMFME Subsidy', 'Government Grants & Schemes', 40000],
  ['CGTMSE Loan', 'Funding & Investment', 55000],
  ['Mudra Loan', 'Funding & Investment', 25000],
  ['NIDHI PRAYAS Grant', 'Government Grants & Schemes', 60000],
  ['TIDE 2.0 Grant', 'Government Grants & Schemes', 65000],
  ['Startup India Certificate (DPIIT)', 'Certifications & Registrations', 12000],
  ['ISO 9001 Certification', 'Certifications & Registrations', 18000],
  ['UDYAM Registration', 'Certifications & Registrations', 3500],
  ['FSSAI License', 'Certifications & Registrations', 8500],
  ['GeM Registration', 'Certifications & Registrations', 9500],
  ['GST Registration', 'Certifications & Registrations', 4500],
  ['IEC Code', 'Certifications & Registrations', 5000],
  ['Trademark Registration', 'Certifications & Registrations', 9000],
  ['Private Limited Incorporation', 'Company Services', 15000],
  ['12A & 80G Registration', 'Certifications & Registrations', 22000],
  ['ZED Certification', 'Certifications & Registrations', 16000],
  ['Pitch Deck & DPR', 'Funding & Investment', 30000],
  ['Angel Investment Readiness', 'Funding & Investment', 50000],
  ['Website Development', 'Digital Services', 35000],
  ['Digital Marketing (3 months)', 'Digital Services', 45000],
]

export async function buildSeed(): Promise<DB> {
  s = 20261005
  const pw = (u: string) => hashPassword(u, DEMO_PASSWORD)

  const people: [string, string, string, Role, string, string?][] = [
    ['u-sa', 'Rohan Mehta', 'superadmin', 'superadmin', 'Management'],
    ['u-ad1', 'Priya Nair', 'admin', 'admin', 'Administration'],
    ['u-ad2', 'Karan Shah', 'admin.karan', 'admin', 'Administration'],
    ['u-acc', 'Neha Joshi', 'accounts', 'accounts', 'Accounts'],
    ['u-leg', 'Aditya Rao', 'legal', 'legal', 'Legal'],
    ['u-op1', 'Sneha Patel', 'ot', 'operations', 'Operations'],
    ['u-op2', 'Vikram Singh', 'ops.vikram', 'operations', 'Operations'],
    ['u-tl1', 'Anjali Desai', 'teamlead', 'teamlead', 'Sales'],
    ['u-tl2', 'Manish Kumar', 'tl.manish', 'teamlead', 'Sales'],
    ['u-s1', 'Rahul Verma', 'sales', 'sales', 'Sales', 'u-tl1'],
    ['u-s2', 'Pooja Iyer', 'sales.pooja', 'sales', 'Sales', 'u-tl1'],
    ['u-s3', 'Arjun Malhotra', 'sales.arjun', 'sales', 'Sales', 'u-tl1'],
    ['u-s4', 'Kavya Reddy', 'sales.kavya', 'sales', 'Sales', 'u-tl2'],
    ['u-s5', 'Imran Khan', 'sales.imran', 'sales', 'Sales', 'u-tl2'],
    ['u-hr', 'Meera Kapoor', 'hr', 'hr', 'Human Resources'],
    ['u-hr2', 'Kavita Menon', 'hr.in', 'hr', 'Human Resources'],
    ['u-it', 'Nitin Joshi', 'it', 'it', 'IT'],
    ['u-sup', 'Farah Ali', 'support', 'support', 'Customer Support'],
  ]
  const designations: Record<Role, string> = {
    superadmin: 'Director', admin: 'Admin Executive', accounts: 'Accounts Manager', legal: 'Legal Head',
    operations: 'Operations Executive', teamlead: 'Sales Team Leader', sales: 'Business Development Executive', hr: 'HR Manager',
    it: 'IT Support Engineer', support: 'Customer Support Executive',
  }
  const users: User[] = []
  for (const [i, [id, name, username, role, dept, tl]] of people.entries()) {
    users.push({
      id, name, username, role, teamLeadId: tl,
      email: EMAILS[username] ?? `${username.replace('.', '_')}@rexera.co.in`,
      phone: `98${String(25000000 + i * 734521).slice(0, 8)}`,
      extraRoles: [], grants: [], denies: [],
      department: dept, designation: designations[role],
      joinedOn: ymd(addDays(new Date(), -between(120, 900))),
      active: true,
      passHash: PRESET_HASHES[username] ?? await pw(username),
      address: { line: `${between(10, 400)}, ${pick(['MG Road', 'CG Road', 'SG Highway', 'Ring Road', 'Station Road'])}`, city: 'Ahmedabad', state: 'Gujarat', pin: '380009', country: 'India' },
      salary: role === 'sales' ? pick([22000, 25000, 28000, 30000]) : role === 'teamlead' ? 40000 : undefined,
      target: role === 'sales' ? 300000 : role === 'teamlead' ? 1200000 : undefined,
    })
  }
  const salesIds = ['u-s1', 'u-s2', 'u-s3', 'u-s4', 'u-s5']
  const tlOf = (id: string) => users.find((u) => u.id === id)?.teamLeadId ?? id

  const services: Service[] = SERVICES.map(([name, category, price], i) => ({
    id: `svc-${i + 1}`, name, category, price, gstRate: 18,
    deduction: name.startsWith('Startup India') ? 1100 : 0, active: true,
  }))

  // ---------- leads ----------
  const first = ['Amit', 'Sunita', 'Rakesh', 'Divya', 'Harsh', 'Nisha', 'Gaurav', 'Ritu', 'Sanjay', 'Komal', 'Deepak', 'Bhavna', 'Yash', 'Tanvi', 'Nikhil', 'Shreya', 'Mohit', 'Payal', 'Kunal', 'Isha']
  const last = ['Shah', 'Patel', 'Gupta', 'Sharma', 'Jain', 'Mehta', 'Agarwal', 'Bhatt', 'Trivedi', 'Chauhan']
  const biz = ['Agro Foods', 'Tech Labs', 'Textiles', 'Pharma', 'Solar Energy', 'Packaging', 'Ceramics', 'Organics', 'Logistics', 'EdTech', 'Spices', 'Robotics', 'Dairy', 'Handicrafts', 'Bio Innovations']
  const cities: [string, string][] = [['Ahmedabad', 'Gujarat'], ['Surat', 'Gujarat'], ['Vadodara', 'Gujarat'], ['Rajkot', 'Gujarat'], ['Mumbai', 'Maharashtra'], ['Pune', 'Maharashtra'], ['Jaipur', 'Rajasthan'], ['Indore', 'Madhya Pradesh'], ['Bengaluru', 'Karnataka'], ['Delhi', 'Delhi']]
  const statuses: LeadStatus[] = ['NEW', 'NEW', 'NEW', 'ATTEMPTED', 'CALL_BACK', 'CALL_BACK', 'INTERESTED', 'INTERESTED', 'NOT_INTERESTED', 'CONVERTED', 'INVALID']
  const leads: Lead[] = []
  for (let i = 0; i < 48; i++) {
    const fn = pick(first), ln = pick(last), [city, state] = pick(cities)
    const status = pick(statuses)
    const owner = i % 9 === 8 ? undefined : salesIds[i % salesIds.length]
    const created = between(0, 25)
    const svc = pick(services)
    leads.push({
      id: `lead-${i + 1}`, code: `LD-${String(1001 + i)}`,
      name: `${fn} ${ln}`, company: `${ln} ${pick(biz)} Pvt Ltd`,
      phone: `${pick(['98', '97', '99', '88', '70'])}${String(between(10000000, 99999999))}`,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@gmail.com`,
      city, state, service: svc.name, source: pick(['Website', 'Facebook Ads', 'Google Ads', 'Referral', 'IVR campaign', 'Exhibition']),
      price: rnd() > 0.3 ? svc.price : undefined,
      status,
      followUp: ['CALL_BACK', 'INTERESTED'].includes(status) ? ymd(addDays(new Date(), between(-2, 4))) : undefined,
      notes: status === 'INTERESTED' ? 'Wants details of eligibility and timeline.' : '',
      assignedTo: owner, createdBy: owner ?? 'u-sa', createdAt: at(created, between(9, 18), between(0, 59)),
      calls: status === 'NEW' ? [] : Array.from({ length: between(1, 3) }, (_, k) => ({
        id: `call-${i}-${k}`, at: at(Math.max(0, created - k), between(10, 18), between(0, 59)), by: owner ?? 'u-s1',
        outcome: k === 0 ? ({ ATTEMPTED: 'NO_ANSWER', CALL_BACK: 'CALL_BACK', INTERESTED: 'INTERESTED', NOT_INTERESTED: 'NOT_INTERESTED', CONVERTED: 'CONVERTED', INVALID: 'WRONG_NUMBER', NEW: 'NO_ANSWER' } as const)[status] : 'NO_ANSWER',
        note: '', durationSec: between(15, 420),
      })),
    })
  }

  // ---------- bookings (CRM entries) ----------
  const flow: { st: BookingStatus; stage?: number; paid: number }[] = [
    { st: 'PENDING_TL', paid: 1 }, { st: 'PENDING_TL', paid: 1 },
    { st: 'PENDING_ACCOUNTS', paid: 1 }, { st: 'PENDING_ACCOUNTS', paid: 2 }, { st: 'ACCOUNTS_HOLD', paid: 1 },
    { st: 'PENDING_LEGAL', paid: 2 }, { st: 'PENDING_LEGAL', paid: 1 },
    { st: 'IN_OPERATIONS', stage: 2, paid: 2 }, { st: 'IN_OPERATIONS', stage: 4, paid: 2 }, { st: 'IN_OPERATIONS', stage: 6, paid: 3 },
    { st: 'WITH_ADMIN', stage: 7, paid: 3 }, { st: 'WITH_ADMIN', stage: 7, paid: 2 },
    { st: 'ON_HOLD', stage: 3, paid: 1 },
    { st: 'COMPLETED', stage: 8, paid: 4 }, { st: 'COMPLETED', stage: 8, paid: 3 }, { st: 'COMPLETED', stage: 8, paid: 4 },
    { st: 'REJECTED', paid: 1 },
  ]
  const bookings: Booking[] = []
  for (const [i, f] of flow.entries()) {
    const owner = salesIds[i % salesIds.length]!
    const svc = services[(i * 3) % services.length]!
    const [city, state] = pick(cities)
    const ln = pick(last)
    const created = 30 - i
    const quoted = svc.price
    const parts = [0.4, 0.3, 0.2, 0.1]
    const payments: Payment[] = Array.from({ length: f.paid }, (_, k) => {
      const amount = round2(quoted * parts[k]!)
      const gst = round2(amount * 0.18)
      return {
        id: `pay-${i}-${k}`, part: k + 1, amount, gst, total: round2(amount + gst),
        date: ymd(addDays(new Date(), -created + k * 4)), mode: pick(['UPI', 'NEFT', 'Cheque', 'Card']),
        proofName: `payment-proof-${k + 1}.pdf`, recordedBy: owner,
        verified: !['PENDING_TL', 'PENDING_ACCOUNTS', 'ACCOUNTS_HOLD'].includes(f.st) || k > 0 ? true : false,
      }
    })
    const approvals = []
    const ord: BookingStatus[] = ['PENDING_TL', 'PENDING_ACCOUNTS', 'PENDING_LEGAL', 'IN_OPERATIONS', 'WITH_ADMIN', 'COMPLETED']
    const reached = f.st === 'ON_HOLD' ? 3 : f.st === 'ACCOUNTS_HOLD' ? 1 : f.st === 'REJECTED' ? 0 : ord.indexOf(f.st)
    const levelBy: [string, string, string][] = [
      ['Team Leader', tlOf(owner), 'Client details verified, forwarded to accounts.'],
      ['Accounts', 'u-acc', 'Advance received and verified against bank statement.'],
      ['Legal', 'u-leg', `Agreement reviewed. Assigned to ${i % 2 ? 'Vikram' : 'Sneha'} (Operations).`],
      ['Operations', i % 2 ? 'u-op2' : 'u-op1', 'Documents filed; handed to Admin for submission.'],
      ['Admin', i % 2 ? 'u-ad2' : 'u-ad1', 'Application approved by the authority. Work complete.'],
    ]
    for (let k = 0; k < reached; k++) {
      const [level, by, remark] = levelBy[k]!
      approvals.push({ id: `ap-${i}-${k}`, level, action: k === 3 ? 'ASSIGNED_ADMIN' : k === 2 ? 'ASSIGNED_OPS' : k === 4 ? 'COMPLETED' : 'APPROVED', by, at: at(created - k * 2 - 1, 12), remark })
    }
    if (f.st === 'REJECTED') approvals.push({ id: `ap-${i}-r`, level: 'Team Leader', action: 'REJECTED', by: tlOf(owner), at: at(created - 1, 15), remark: 'PAN does not match company name. Please correct and resubmit.' })
    if (f.st === 'ACCOUNTS_HOLD') approvals.push({ id: `ap-${i}-h`, level: 'Accounts', action: 'HOLD', by: 'u-acc', at: at(created - 3, 15), remark: 'Payment not yet reflected in bank. Holding until credited.' })
    const stage = f.stage ?? 1
    const inOps = ['IN_OPERATIONS', 'WITH_ADMIN', 'ON_HOLD', 'COMPLETED'].includes(f.st)
    bookings.push({
      id: `bk-${i + 1}`, bookingId: `RX-2026-${String(120 + i).padStart(6, '0')}`,
      companyName: `${ln} ${pick(biz)} Pvt Ltd`, contactPerson: `${pick(first)} ${ln}`,
      mobile: `9${String(between(100000000, 999999999))}`, email: `info@${ln.toLowerCase()}${i}.in`,
      pan: `${ln.toUpperCase().padEnd(3, 'X').slice(0, 3)}PC${between(1000, 9999)}${pick(['K', 'L', 'M'])}`,
      gstin: rnd() > 0.3 ? `24${ln.toUpperCase().padEnd(3, 'X').slice(0, 3)}PC${between(1000, 9999)}K1Z${between(1, 9)}` : '',
      city, state, industry: pick(['Manufacturing', 'Food Processing', 'IT / Software', 'Agriculture', 'Healthcare', 'Retail']),
      serviceId: svc.id, serviceName: svc.name, mode: rnd() > 0.5 ? 'Refundable' : 'Non-Refundable',
      successFeePct: pick([0, 2, 3, 5]), totalQuoted: quoted, gstRate: 18, deduction: svc.deduction,
      payments, createdBy: owner, teamLeadId: tlOf(owner), status: f.st,
      holdFrom: f.st === 'ON_HOLD' ? 'IN_OPERATIONS' : undefined,
      holdReason: f.st === 'ON_HOLD' ? 'Documents not complete' : undefined,
      approvals,
      opsMemberId: inOps ? (i % 2 ? 'u-op2' : 'u-op1') : undefined,
      adminId: ['WITH_ADMIN', 'COMPLETED'].includes(f.st) ? (i % 2 ? 'u-ad2' : 'u-ad1') : undefined,
      stage, maxStage: inOps ? Math.max(stage, 6) : 1,
      stageHistory: inOps ? Array.from({ length: stage }, (_, k) => ({ stage: k + 1, at: at(created - 6 - k, 11), by: i % 2 ? 'u-op2' : 'u-op1', note: k === 0 ? 'Started' : `Moved to ${STAGES[k]}` })) : [],
      comments: [
        { id: `c-${i}-1`, by: owner, at: at(created, 11), text: 'Client is keen to start this month. Advance paid via ' + (payments[0]?.mode ?? 'UPI') + '.', kind: 'BDE' },
        ...(reached > 1 ? [{ id: `c-${i}-2`, by: 'u-acc', at: at(created - 2, 16), text: 'Payment verified.', kind: 'Accounts' }] : []),
      ],
      documents: inOps ? [
        { id: `d-${i}-1`, name: 'PAN card.pdf', category: 'KYC', size: 182000, at: at(created - 5), by: 'u-op1', status: 'VERIFIED' },
        { id: `d-${i}-2`, name: 'Certificate of incorporation.pdf', category: 'Company documents', size: 420000, at: at(created - 5), by: 'u-op1', status: stage > 3 ? 'VERIFIED' : 'PENDING' },
      ] : [],
      tasks: inOps ? [
        { id: `t-${i}-1`, title: 'Collect last 2 years ITR', done: stage > 2, by: 'u-op1', due: ymd(addDays(new Date(), 2)) },
        { id: `t-${i}-2`, title: 'Prepare application form', done: stage > 5, by: 'u-op1', due: ymd(addDays(new Date(), 5)) },
      ] : [],
      priority: pick(['LOW', 'MEDIUM', 'MEDIUM', 'HIGH']),
      deadline: ymd(addDays(new Date(), between(-3, 14))),
      createdAt: at(created, 11), updatedAt: at(Math.max(0, created - reached * 2), 15),
    })
  }

  // ---------- invoices ----------
  const invoices: Invoice[] = bookings.filter((b) => !['PENDING_TL', 'REJECTED'].includes(b.status)).slice(0, 10).map((b, i) => {
    const base = b.payments.reduce((x, p) => x + p.amount, 0)
    const total = round2(b.totalQuoted * 1.18)
    const paid = round2(base * 1.18)
    return {
      id: `inv-${i + 1}`, number: `RX/26-27/${String(41 + i).padStart(4, '0')}`, type: i % 4 === 3 ? 'PROFORMA' : 'TAX',
      bookingId: b.id, client: b.companyName, gstin: b.gstin, state: b.state,
      items: [{ desc: b.serviceName, sac: '998311', qty: 1, rate: b.totalQuoted, gstRate: 18 }],
      paid, status: paid >= total - 1 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'ISSUED',
      date: b.createdAt.slice(0, 10), due: ymd(addDays(b.createdAt, 15)), salesPerson: b.createdBy, createdBy: 'u-acc',
    } satisfies Invoice
  })

  // ---------- attendance (last 21 days) ----------
  const sessions: DaySession[] = []
  for (let d = 21; d >= 1; d--) {
    const day = addDays(new Date(), -d)
    if (day.getDay() === 0) continue
    for (const u of users) {
      if (rnd() < 0.08) continue
      const inH = 9, inM = between(0, 40)
      sessions.push({ id: `ds-${d}-${u.id}`, userId: u.id, date: ymd(day), loginAt: at(d, inH, inM), logoutAt: at(d, 18, between(0, 50)) })
    }
  }
  if (new Date().getDay() !== 0) {
    for (const u of users) {
      if (['u-s5', 'u-ad2', 'u-hr', 'u-sa'].includes(u.id)) continue
      sessions.push({ id: `ds-0-${u.id}`, userId: u.id, date: ymd(), loginAt: at(0, 9, between(0, 35)), logoutAt: u.id === 'u-op2' ? at(0, 13, 10) : undefined })
    }
  }

  const db: DB = {
    version: SEED_VERSION,
    users, leads, bookings, services, invoices, sessions,
    schemes: [
      { id: 'sc-1', title: 'Startup India Seed Fund', category: 'Grant', summary: 'Up to ₹20 lakh grant for proof of concept and up to ₹50 lakh for market entry through incubators.', benefit: 'Up to ₹70 lakh', eligibility: 'DPIIT-recognised startup, incorporated < 2 years', active: true, createdAt: at(20), by: 'u-sa' },
      { id: 'sc-2', title: 'PMEGP', category: 'Subsidy', summary: 'Credit-linked subsidy for new micro enterprises in manufacturing and services.', benefit: '15–35% subsidy', eligibility: 'Age 18+, project above ₹10 lakh needs VIII pass', active: true, createdAt: at(18), by: 'u-sa' },
      { id: 'sc-3', title: 'PMFME', category: 'Subsidy', summary: 'Support for micro food-processing units for upgradation and formalisation.', benefit: '35% capital subsidy up to ₹10 lakh', eligibility: 'Existing micro food enterprises', active: true, createdAt: at(15), by: 'u-sa' },
      { id: 'sc-4', title: 'CGTMSE', category: 'Loan guarantee', summary: 'Collateral-free credit for MSEs, guaranteed by the trust.', benefit: 'Loans up to ₹5 crore without collateral', eligibility: 'New and existing MSEs', active: true, createdAt: at(12), by: 'u-sa' },
      { id: 'sc-5', title: 'TIDE 2.0', category: 'Grant', summary: 'Grants for tech startups using ICT for social impact via MeitY incubators.', benefit: 'Up to ₹7 lakh / ₹25 lakh', eligibility: 'Tech startups at idea / PoC stage', active: true, createdAt: at(9), by: 'u-sa' },
      { id: 'sc-6', title: 'NIDHI PRAYAS', category: 'Grant', summary: 'Support from idea to prototype for hardware innovators.', benefit: 'Up to ₹10 lakh', eligibility: 'Individual innovators and startups', active: true, createdAt: at(4), by: 'u-sa' },
      { id: 'sc-7', title: 'Mudra Loan (Shishu / Kishore / Tarun)', category: 'Loan', summary: 'Loans for non-corporate small businesses.', benefit: 'Up to ₹20 lakh', eligibility: 'Small business, non-farm income activity', active: true, createdAt: at(2), by: 'u-sa' },
    ],
    posts: [
      { id: 'po-1', kind: 'FLYER', title: 'Seed Fund — Apply before 31 Oct', body: 'Get up to ₹70 lakh for your startup. Free eligibility check with Rexera.', theme: 'navy', createdAt: at(6), by: 'u-op1', pinned: true },
      { id: 'po-2', kind: 'FLYER', title: 'ISO 9001 in 15 days', body: 'Fast-track ISO certification with complete documentation support.', theme: 'orange', createdAt: at(5), by: 'u-op1' },
      { id: 'po-3', kind: 'POST', title: 'Diwali offer: UDYAM + GST combo', body: 'Register UDYAM and GST together at a special combo price this festive season. 🪔', theme: 'violet', createdAt: at(3), by: 'u-ad1' },
      { id: 'po-4', kind: 'POST', title: 'Client success: ₹45 lakh PMEGP sanctioned', body: 'Congratulations to Shah Agro Foods on their PMEGP sanction, processed by Rexera in 38 days.', theme: 'green', createdAt: at(1), by: 'u-op2' },
      { id: 'po-5', kind: 'SALES_INFO', title: 'Pitch: Seed Fund in 60 seconds', body: '1) Ask incorporation date & DPIIT status. 2) Explain PoC vs market entry. 3) Mention our 92% shortlisting rate. 4) Close on the free eligibility report.', theme: 'navy', createdAt: at(8), by: 'u-op1' },
      { id: 'po-6', kind: 'SALES_INFO', title: 'Handling “fees are too high”', body: 'Compare our fee with the grant value, highlight refundable mode, offer instalments (40/30/20/10).', theme: 'orange', createdAt: at(7), by: 'u-op1' },
      { id: 'po-7', kind: 'SALES_INFO', title: 'Price list — October 2026', body: 'Startup India ₹12,000 · ISO ₹18,000 · UDYAM ₹3,500 · FSSAI ₹8,500 · Trademark ₹9,000 (all + 18% GST).', theme: 'gray', createdAt: at(2), by: 'u-ad1' },
    ],
    broadcasts: [
      { id: 'br-1', title: 'Office closed on Dussehra', body: 'The office stays closed on the festival day. Plan client calls accordingly.', priority: 'HIGH', audience: 'ALL', by: 'u-hr', at: at(3), acks: ['u-s1', 'u-op1', 'u-acc'] },
      { id: 'br-2', title: 'New incentive slabs from October', body: 'Monthly slabs now start at ₹1.2 lakh net collection. See Sales Information for the full table.', priority: 'NORMAL', audience: ['sales', 'teamlead'], by: 'u-sa', at: at(5), acks: ['u-s2'] },
      { id: 'br-3', title: 'Upload documents within 24 hours', body: 'All client documents must be uploaded to the CRM entry within 24 hours of receipt.', priority: 'URGENT', audience: ['operations', 'admin', 'legal'], by: 'u-sa', at: at(1), acks: [] },
    ],
    events: [
      { id: 'ev-1', title: 'Weekly sales review', date: ymd(addDays(new Date(), 1)), time: '10:00', kind: 'MEETING', description: 'Pipeline and collections review with team leaders.', by: 'u-sa' },
      { id: 'ev-2', title: 'Seed Fund training', date: ymd(addDays(new Date(), 3)), time: '15:00', kind: 'TRAINING', description: 'New eligibility rules and documentation.', by: 'u-hr' },
      { id: 'ev-3', title: 'Dussehra holiday', date: ymd(addDays(new Date(), 7)), time: '00:00', kind: 'HOLIDAY', description: 'Office closed.', by: 'u-hr' },
      { id: 'ev-4', title: 'Monthly GST filing', date: ymd(addDays(new Date(), 6)), time: '17:00', kind: 'DEADLINE', description: 'GSTR-1 for last month.', by: 'u-acc' },
      { id: 'ev-5', title: 'Team birthday celebration', date: ymd(new Date()), time: '17:30', kind: 'CELEBRATION', description: 'Cake in the conference room 🎂', by: 'u-hr' },
    ],
    leaves: [
      { id: 'lv-1', userId: 'u-s2', type: 'CL', from: ymd(addDays(new Date(), 2)), to: ymd(addDays(new Date(), 3)), days: 2, reason: 'Family function', status: 'PENDING', approvers: ['teamlead', 'hr', 'superadmin'], createdAt: at(1) },
      { id: 'lv-2', userId: 'u-op2', type: 'SL', from: ymd(addDays(new Date(), -4)), to: ymd(addDays(new Date(), -4)), days: 1, reason: 'Fever', status: 'APPROVED', approvers: ['hr', 'superadmin'], decidedBy: 'u-hr', decidedAt: at(4), createdAt: at(5) },
      { id: 'lv-3', userId: 'u-acc', type: 'EL', from: ymd(addDays(new Date(), 10)), to: ymd(addDays(new Date(), 14)), days: 5, reason: 'Vacation', status: 'PENDING', approvers: ['hr', 'superadmin'], createdAt: at(0, 9) },
      { id: 'lv-4', userId: 'u-hr', type: 'CL', from: ymd(new Date()), to: ymd(new Date()), days: 1, reason: 'Personal work', status: 'APPROVED', approvers: ['superadmin'], decidedBy: 'u-sa', decidedAt: at(2), createdAt: at(3) },
    ],
    notices: [],
    messages: [
      { id: 'm-1', from: 'u-tl1', to: 'u-s1', body: 'Please follow up with the Seed Fund leads today.', at: at(0, 9, 40), read: false },
      { id: 'm-2', from: 'u-acc', to: 'u-sa', body: 'Two files are on hold for payment confirmation.', at: at(0, 11), read: false },
      { id: 'm-3', from: 'u-op1', to: 'u-ad1', body: 'RX-2026-000130 is ready for submission.', at: at(1, 16), read: true },
    ],
    templates: [
      { id: 'tp-1', name: 'Payment reminder', body: 'Dear {client}, a friendly reminder that ₹{amount} is due for {service}. — Team Rexera', by: 'u-sa' },
      { id: 'tp-2', name: 'Documents request', body: 'Dear {client}, please share the following documents to proceed: {documents}. — Team Rexera', by: 'u-sa' },
      { id: 'tp-3', name: 'Welcome', body: 'Welcome to Rexera, {client}! Your booking {booking} is confirmed. Your relationship manager is {employee}.', by: 'u-sa' },
    ],
    audit: [{ id: 'a-1', at: at(0, 9), by: 'u-sa', action: 'SYSTEM', detail: 'Demo data created' }],
    rolePerms: structuredClone(DEFAULT_ROLE_PERMS),
    settings: { sessionMinutes: 60, supplierState: 'Gujarat', companyName: 'Rexera Financial Services Pvt. Ltd.', companyGstin: '24AAKCR1234F1Z5' },
    counters: { booking: 120 + flow.length, lead: 1001 + 48, invoice: 41 + invoices.length },
    loginFails: {},
  }

  // starter notifications so the bell is not empty
  const n = (userId: string, title: string, body: string, link: string, kind: 'info' | 'action' | 'success' | 'warning', ago: number) =>
    db.notices.push({ id: `n-${db.notices.length + 1}`, userId, title, body, link, at: at(0, 12 - ago), read: false, kind })
  for (const b of bookings) {
    if (b.status === 'PENDING_TL' && b.teamLeadId) n(b.teamLeadId, 'CRM entry waiting for you', `${b.bookingId} · ${b.companyName}`, `/bookings/${b.id}`, 'action', 1)
    if (b.status === 'PENDING_ACCOUNTS') n('u-acc', 'File waiting for accounts', `${b.bookingId} · ${b.companyName}`, `/bookings/${b.id}`, 'action', 2)
    if (b.status === 'PENDING_LEGAL') n('u-leg', 'File waiting for legal review', `${b.bookingId} · ${b.companyName}`, `/bookings/${b.id}`, 'action', 2)
    if (b.status === 'WITH_ADMIN' && b.adminId) n(b.adminId, 'Assigned to you by Operations', `${b.bookingId} · ${b.companyName}`, `/bookings/${b.id}`, 'action', 3)
    if (b.status === 'REJECTED') n(b.createdBy, 'CRM entry rejected', `${b.bookingId}: fix and resubmit`, `/bookings/${b.id}`, 'warning', 3)
  }
  for (const u of users) n(u.id, 'Welcome to Rexera CRM 2.0', 'Press Ctrl + K anywhere to search and jump.', '/settings', 'info', 4)
  n('u-s1', 'New scheme published', 'Mudra Loan (Shishu / Kishore / Tarun)', '/schemes', 'info', 2)
  n('u-tl1', 'Leave request', 'Pooja Iyer asked for 2 days CL', '/leave', 'action', 1)
  n('u-hr', 'Leave request', 'Neha Joshi asked for 5 days EL', '/leave', 'action', 1)
  return db
}
