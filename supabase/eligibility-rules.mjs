// Government scheme eligibility — the rules behind Rexy's Scheme Checker (sales people check a client on the call).
// A PRELIMINARY check: it says which central schemes the client looks eligible for, may be eligible for (something is
// not known yet), or is not eligible for — and why. The bank / agency decides; nothing here guarantees approval.
//
// Limits as published by the government, checked on RULES_CHECKED (update them when a scheme changes):
//  * MSME classes — S.O. 1364(E), 21 Mar 2025, from 1 Apr 2025: micro ≤ ₹2.5 cr investment and ≤ ₹10 cr turnover,
//    small ≤ ₹25 cr / ₹100 cr, medium ≤ ₹125 cr / ₹500 cr (exports left out of turnover).
//  * DPIIT startup — G.S.R. 108(E), 4 Feb 2026: up to 10 years from incorporation (deep tech 20), turnover ≤ ₹200 cr
//    (deep tech ₹300 cr); private limited, LLP, registered partnership and co-operative society.
//  * Seed Fund (SISFS) — DPIIT-recognised, incorporated ≤ 2 years before applying, technology in the core product,
//    ≤ ₹10 lakh earlier government money; grant ≤ ₹20 lakh, debt / convertibles ≤ ₹50 lakh, through incubators.
//  * PMEGP (KVIC) — new units; project ≤ ₹50 lakh manufacturing / ≤ ₹20 lakh service; VIII pass above ₹10 / ₹5 lakh;
//    margin money 15 / 25 % (general, urban / rural), 25 / 35 % (special categories).
//  * PM Mudra — non-corporate, non-farm micro units; Shishu ≤ ₹50k, Kishore ≤ ₹5 lakh, Tarun ≤ ₹10 lakh,
//    Tarun Plus ₹10–20 lakh (only after repaying a Tarun loan).
//  * Stand-Up India — SC / ST and / or woman, 18+, greenfield, ₹10 lakh – ₹1 crore, 51 % holding in a firm / company.
//  * CGTMSE — micro and small enterprises, collateral-free credit guaranteed up to ₹10 crore (from 1 Apr 2025).
//  * MSME ZED — Udyam-registered MSMEs; subsidy on certification cost 80 / 60 / 50 % (micro / small / medium).
export const RULES_CHECKED = '2026-10-30'

const LAKH = 1e5, CRORE = 1e7
export const ENTITIES = [
  { id: 'INDIVIDUAL', label: 'Individual (no business yet)' }, { id: 'PROPRIETORSHIP', label: 'Proprietorship' },
  { id: 'PARTNERSHIP', label: 'Registered partnership' }, { id: 'LLP', label: 'LLP' }, { id: 'PRIVATE_LTD', label: 'Private limited company' },
  { id: 'PUBLIC_LTD', label: 'Public limited company' }, { id: 'COOPERATIVE', label: 'Co-operative society' }, { id: 'OTHER', label: 'Trust / society / other' },
]
export const SECTORS = [{ id: 'MANUFACTURING', label: 'Manufacturing' }, { id: 'SERVICES', label: 'Services' }, { id: 'TRADING', label: 'Trading' }, { id: 'AGRI_ALLIED', label: 'Agri-allied (dairy, poultry, fisheries…)' }]
export const STAGES = [{ id: 'IDEA', label: 'Idea / not started' }, { id: 'NEW', label: 'New unit being set up' }, { id: 'EXISTING', label: 'Running business' }]
export const EDUCATION = [{ id: 'BELOW_8', label: 'Below VIII' }, { id: 'PASS_8', label: 'VIII pass' }, { id: 'PASS_10', label: 'X pass' }, { id: 'PASS_12', label: 'XII pass' }, { id: 'GRADUATE', label: 'Graduate or above' }]
export const CATEGORIES = [
  { id: 'GENERAL', label: 'General' }, { id: 'OBC', label: 'OBC' }, { id: 'SC', label: 'SC' }, { id: 'ST', label: 'ST' }, { id: 'MINORITY', label: 'Minority' },
  { id: 'EX_SERVICEMEN', label: 'Ex-servicemen' }, { id: 'PWD', label: 'Person with disability' }, { id: 'TRANSGENDER', label: 'Transgender' },
]
export const STATUS = {
  ELIGIBLE: { label: 'Eligible', tone: 'green' },
  POSSIBLE: { label: 'Potentially eligible', tone: 'amber' },
  NOT_ELIGIBLE: { label: 'Not eligible', tone: 'red' },
}

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v))
const has = (v) => v !== undefined && v !== null && v !== ''
const inr = (n) => n >= CRORE ? `₹${+(n / CRORE).toFixed(2)} crore` : n >= LAKH ? `₹${+(n / LAKH).toFixed(2)} lakh` : `₹${Math.round(n).toLocaleString('en-IN')}`
/** Whole years from a YYYY-MM-DD date to `today`. */
export function yearsSince(date, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return undefined
  const [y, m, d] = date.split('-').map(Number), [ty, tm, td] = today.split('-').map(Number)
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0)
}
/** Micro / small / medium by both investment and turnover (2025 limits); LARGE above; undefined while unknown. */
export function msmeClass(investment, turnover) {
  const i = num(investment), t = num(turnover)
  if (i === undefined || t === undefined) return undefined
  if (i <= 2.5 * CRORE && t <= 10 * CRORE) return 'MICRO'
  if (i <= 25 * CRORE && t <= 100 * CRORE) return 'SMALL'
  if (i <= 125 * CRORE && t <= 500 * CRORE) return 'MEDIUM'
  return 'LARGE'
}
const CLASS_LABEL = { MICRO: 'Micro', SMALL: 'Small', MEDIUM: 'Medium', LARGE: 'Large (above MSME limits)' }
const SPECIAL = ['OBC', 'SC', 'ST', 'MINORITY', 'EX_SERVICEMEN', 'PWD', 'TRANSGENDER']
const isCompany = (e) => e === 'PRIVATE_LTD' || e === 'PUBLIC_LTD'
const individualish = (e) => e === 'INDIVIDUAL' || e === 'PROPRIETORSHIP'
/** Entities DPIIT recognises as startups (G.S.R. 108(E) added co-operative societies). */
const RECOGNISABLE = ['PRIVATE_LTD', 'LLP', 'PARTNERSHIP', 'COOPERATIVE']

// one check: pass / fail / unknown (the client has to tell us, or a document has to show it)
const pass = (label, reason) => ({ label, status: 'pass', reason })
const fail = (label, reason) => ({ label, status: 'fail', reason })
const ask = (label, reason) => ({ label, status: 'unknown', reason })
const yesNo = (v, label, ifYes, ifNo, ifUnknown) => v === true ? pass(label, ifYes) : v === false ? fail(label, ifNo) : ask(label, ifUnknown)

export const SCHEMES = [
  {
    id: 'UDYAM', name: 'Udyam Registration (MSME)', kind: 'Registration', agency: 'Ministry of MSME', url: 'https://udyamregistration.gov.in',
    service: /udyam|msme/i,
    summary: 'Free, paperless MSME registration — the key that opens most MSME schemes, bank priority lending and payment protection.',
    benefits: ['Recognised as a micro, small or medium enterprise', 'Needed for CGTMSE collateral-free loans, ZED subsidy and many state incentives', 'Priority-sector bank lending', 'Buyers must pay MSMEs within 45 days (MSMED Act)'],
    documents: ['Aadhaar of the proprietor / managing partner / director', 'PAN of the enterprise (GSTIN if registered)', 'Bank account details', 'Investment and turnover (taken from ITR / GST where filed)'],
    process: ['Go to udyamregistration.gov.in (no fee)', 'Verify Aadhaar with OTP, then PAN', 'Fill the business details, activity (NIC code) and bank details', 'Udyam certificate is issued online; update it every year'],
    checks(p) {
      const c = msmeClass(p.investment, p.turnover)
      return [
        p.udyam === true ? pass('Registration', 'Already Udyam-registered — keep the details updated every year') : pass('Registration', 'Any enterprise within MSME limits can register for free'),
        p.stage === 'IDEA' || p.entity === 'INDIVIDUAL' ? ask('Running enterprise', 'Udyam is for an enterprise that exists — register once the business is set up') : pass('Running enterprise', 'The business is set up or being set up'),
        c === undefined ? ask('MSME limits', 'Enter investment in plant / machinery / equipment and turnover to see the class')
          : c === 'LARGE' ? fail('MSME limits', `Investment / turnover above the medium limit (₹125 crore / ₹500 crore)`)
            : pass('MSME limits', `${CLASS_LABEL[c]} enterprise by investment and turnover (2025 limits)`),
      ]
    },
  },
  {
    id: 'DPIIT', name: 'DPIIT Startup Recognition', kind: 'Recognition', agency: 'DPIIT, Ministry of Commerce & Industry', url: 'https://www.startupindia.gov.in',
    service: /dpiit|startup india|recognition/i,
    summary: 'Government recognition as a startup — needed for Seed Fund, tax holiday (80-IAC), patent and procurement benefits.',
    benefits: ['Income-tax holiday for 3 of the first 10 years (80-IAC — separate approval, turnover ≤ ₹100 crore)', 'Self-certification under labour and environment laws', 'Fast-track patent examination and up to 80% rebate on patent fees', 'Relaxed prior-experience / turnover conditions in government tenders', 'Access to Seed Fund, Fund of Funds and credit guarantee for startups'],
    documents: ['Certificate of incorporation / registration', 'PAN of the entity', 'Short write-up of the innovation (pitch deck, website or video)', 'Details of directors / partners'],
    process: ['Register on startupindia.gov.in', 'Fill the recognition form (entity, innovation, team)', 'Upload the incorporation certificate and write-up', 'DPIIT reviews and issues the certificate online (no fee)'],
    checks(p, t) {
      const age = yearsSince(p.incorporated, t)
      const out = []
      if (!has(p.entity)) out.push(ask('Entity type', 'Private limited, LLP, registered partnership or co-operative society can apply'))
      else if (RECOGNISABLE.includes(p.entity)) out.push(pass('Entity type', 'Entity type can be recognised'))
      else out.push(fail('Entity type', 'Only private limited, LLP, registered partnership or co-operative society — incorporate first (we can help)'))
      out.push(age === undefined ? ask('Age', 'Enter the date of incorporation (up to 10 years; deep tech up to 20)')
        : age < 10 ? pass('Age', `Incorporated ${age} year(s) ago — within 10 years`) : fail('Age', `Incorporated ${age} years ago — over 10 years (deep tech startups up to 20 years — check)`))
      const to = num(p.turnover)
      out.push(to === undefined ? ask('Turnover', 'Turnover must never have crossed ₹200 crore in a year')
        : to <= 200 * CRORE ? pass('Turnover', `Turnover ${inr(to)} — within ₹200 crore`) : fail('Turnover', 'Turnover above ₹200 crore (deep tech up to ₹300 crore)'))
      out.push(yesNo(p.innovative, 'Innovation', 'Works on an innovative / improved product, process or scalable model', 'Must work on innovation, improvement or a scalable, job-creating model — a plain trading or routine business is not recognised', 'Does the business develop a new / improved product, service or process?'))
      return out
    },
  },
  {
    id: 'SISFS', name: 'Startup India Seed Fund Scheme', kind: 'Grant / debt', agency: 'DPIIT, through selected incubators', url: 'https://seedfund.startupindia.gov.in',
    service: /seed fund/i,
    statusNote: 'Approved for 2021–22 to 2024–25 — confirm the call is open on seedfund.startupindia.gov.in before applying.',
    summary: 'Early money for a young startup: a grant for proof of concept / prototype and debt for market entry, given through incubators.',
    benefits: ['Grant up to ₹20 lakh for proof of concept, prototype or product trials', 'Up to ₹50 lakh as convertible debentures / debt for market entry, commercialisation or scaling', 'Mentoring and support from the incubator'],
    documents: ['DPIIT recognition certificate', 'Certificate of incorporation', 'Pitch deck and business plan with use of funds', 'Founder / team details and shareholding (cap table)', 'PAN, bank details, prototype photos / video if any'],
    process: ['Apply on seedfund.startupindia.gov.in and pick up to 3 incubators', 'Incubator screening, then a pitch to its Seed Management Committee', 'Agreement with the incubator', 'Money released in milestone-linked instalments'],
    checks(p, t) {
      const age = yearsSince(p.incorporated, t), prior = num(p.priorFunding)
      return [
        // only an entity DPIIT can recognise can get the Seed Fund
        ...(has(p.entity) && !RECOGNISABLE.includes(p.entity) ? [fail('Entity type', 'Must be a DPIIT-recognised startup — a private limited company, LLP, registered partnership or co-operative society (incorporate first)')] : []),
        p.dpiit === true ? pass('DPIIT recognition', 'DPIIT-recognised') : p.dpiit === false ? ask('DPIIT recognition', 'Needs DPIIT recognition first — apply for it, then for the Seed Fund') : ask('DPIIT recognition', 'Is the startup DPIIT-recognised?'),
        age === undefined ? ask('Age', 'Must be incorporated not more than 2 years before applying')
          : age < 2 ? pass('Age', `Incorporated ${age} year(s) ago — within 2 years`) : fail('Age', `Incorporated ${age} years ago — the limit is 2 years`),
        yesNo(p.innovative, 'Technology', 'Technology is used in the core product / service', 'Technology must be used in the core product, service or business model', 'Is technology used in the core product or service?'),
        prior === undefined ? ask('Earlier government money', 'Must not have received more than ₹10 lakh from other central / state schemes (prizes, subsidised space and lab access don’t count)')
          : prior <= 10 * LAKH ? pass('Earlier government money', `${inr(prior)} received — within ₹10 lakh`) : fail('Earlier government money', `${inr(prior)} received — above the ₹10 lakh limit`),
        yesNo(p.indian51, 'Indian promoters', 'Indian promoters hold at least 51% (confirm in the current guidelines)', 'Indian promoters should hold at least 51%', 'Do Indian promoters hold 51% or more? (confirm in the current guidelines)'),
      ]
    },
  },
  {
    id: 'PMEGP', name: 'PMEGP — Prime Minister’s Employment Generation Programme', kind: 'Loan + subsidy', agency: 'KVIC, KVIB and District Industries Centres', url: 'https://www.kviconline.gov.in/pmegpeportal',
    service: /pmegp/i,
    summary: 'Bank loan for a NEW micro unit with a government margin-money subsidy of 15–35% of the project cost.',
    benefits: ['Subsidy (margin money) of 15–35% of the project cost — 15% urban / 25% rural (general), 25% urban / 35% rural (special categories)', 'Own contribution only 10% (general) or 5% (special categories); the bank lends the rest', 'Projects up to ₹50 lakh (manufacturing) or ₹20 lakh (service / business)'],
    documents: ['Aadhaar and PAN', 'Project report with cost and quotations', 'Education certificate (VIII pass, for projects above ₹10 lakh manufacturing / ₹5 lakh service)', 'Caste / special-category certificate if claimed', 'Rural area certificate if claimed', 'Bank details; EDP training certificate (after sanction)'],
    process: ['Apply online on the PMEGP e-portal (kviconline.gov.in)', 'KVIC / KVIB / DIC scrutiny and task-force interview', 'Bank appraises and sanctions the loan', 'Complete the EDP training', 'Subsidy is kept as a 3-year deposit, then adjusted to the loan'],
    checks(p) {
      const out = [], cost = num(p.projectCost), age = num(p.age)
      if (!has(p.entity)) out.push(ask('Applicant', 'Individuals (18+), SHGs, societies, production co-operatives and charitable trusts'))
      else if (individualish(p.entity) || p.entity === 'COOPERATIVE' || p.entity === 'OTHER') out.push(pass('Applicant', 'Applicant type is covered'))
      else out.push(fail('Applicant', 'PMEGP is for individuals, SHGs, societies, co-operatives and trusts — not companies, LLPs or partnership firms'))
      if (individualish(p.entity) || !has(p.entity)) out.push(age === undefined ? ask('Age', 'The applicant must be 18 or older') : age >= 18 ? pass('Age', `${age} years`) : fail('Age', 'Must be 18 or older'))
      out.push(!has(p.stage) ? ask('New unit', 'Only new units (an existing PMEGP unit can take a 2nd loan to upgrade)')
        : p.stage === 'EXISTING' ? fail('New unit', 'Only new units — an existing business is not covered (except a 2nd loan for an existing PMEGP / MUDRA unit)') : pass('New unit', 'A new unit'))
      const cap = p.sector === 'MANUFACTURING' ? 50 * LAKH : 20 * LAKH
      out.push(cost === undefined || !has(p.sector) ? ask('Project cost', 'Up to ₹50 lakh (manufacturing) or ₹20 lakh (service / business)')
        : cost <= cap ? pass('Project cost', `${inr(cost)} — within ${inr(cap)}`) : fail('Project cost', `${inr(cost)} — above the ${inr(cap)} limit for ${p.sector === 'MANUFACTURING' ? 'manufacturing' : 'service / business'}`))
      const needs8 = cost !== undefined && cost > (p.sector === 'MANUFACTURING' ? 10 * LAKH : 5 * LAKH)
      if (needs8) out.push(!has(p.education) ? ask('Education', 'VIII pass needed for this project size') : p.education === 'BELOW_8' ? fail('Education', 'VIII pass is needed above ₹10 lakh (manufacturing) / ₹5 lakh (service)') : pass('Education', 'VIII pass or above'))
      out.push(p.priorSubsidy === true ? fail('Earlier subsidy', 'Units that already took a government subsidy under another scheme are not covered') : p.priorSubsidy === false ? pass('Earlier subsidy', 'No earlier government subsidy') : ask('Earlier subsidy', 'Has the applicant taken a government subsidy before?'))
      if (cost !== undefined && has(p.area)) {
        const special = SPECIAL.includes(p.category) || p.woman === true
        const rate = (special ? 25 : 15) + (p.area === 'RURAL' ? 10 : 0)
        out.push(pass('Subsidy estimate', `${rate}% of the project ≈ ${inr((cost * rate) / 100)} (${special ? 'special category' : 'general'}, ${p.area === 'RURAL' ? 'rural' : 'urban'}) — final amount set by the bank / KVIC`))
      }
      return out
    },
  },
  {
    id: 'MUDRA', name: 'PM Mudra Yojana', kind: 'Collateral-free loan', agency: 'Banks, NBFCs and MFIs (MUDRA)', url: 'https://www.mudra.org.in',
    service: /mudra/i,
    summary: 'Collateral-free business loans for non-corporate micro enterprises — Shishu, Kishore, Tarun and Tarun Plus.',
    benefits: ['No collateral', 'Shishu up to ₹50,000 · Kishore up to ₹5 lakh · Tarun up to ₹10 lakh', 'Tarun Plus ₹10–20 lakh for borrowers who repaid a Tarun loan', 'Term loan and / or working capital (Mudra card)'],
    documents: ['KYC: Aadhaar, PAN, photo', 'Proof of business address / registration (Udyam, GST, shop licence)', 'Quotations for machinery / items to buy', 'Last 2 years’ balance sheet and ITR (Kishore and above)', 'Bank statement (last 6 months); caste certificate if any'],
    process: ['Apply at a bank / NBFC / MFI branch, or online on jansamarth.in / udyamimitra.in', 'Bank appraises the business and repayment capacity', 'Loan sanctioned without collateral'],
    checks(p) {
      const cost = num(p.projectCost)
      return [
        !has(p.entity) ? ask('Applicant', 'Non-corporate micro enterprises (proprietors, partnerships, small firms)')
          : isCompany(p.entity) ? fail('Applicant', 'Companies are not covered — Mudra is for non-corporate units') : pass('Applicant', 'Non-corporate enterprise'),
        cost === undefined ? ask('Loan needed', 'Up to ₹10 lakh (₹20 lakh under Tarun Plus after repaying a Tarun loan)')
          : cost <= 50000 ? pass('Loan needed', `${inr(cost)} — Shishu`) : cost <= 5 * LAKH ? pass('Loan needed', `${inr(cost)} — Kishore`)
            : cost <= 10 * LAKH ? pass('Loan needed', `${inr(cost)} — Tarun`) : cost <= 20 * LAKH ? ask('Loan needed', `${inr(cost)} — Tarun Plus: only for borrowers who took and repaid a Tarun loan`)
              : fail('Loan needed', `${inr(cost)} — above the ₹20 lakh Mudra limit (look at CGTMSE or Stand-Up India)`),
        p.defaulter === true ? fail('Credit history', 'Defaulters are not covered') : p.defaulter === false ? pass('Credit history', 'No loan default') : ask('Credit history', 'Any default with a bank / NBFC?'),
      ]
    },
  },
  {
    id: 'STANDUP', name: 'Stand-Up India', kind: 'Bank loan', agency: 'Scheduled commercial banks (SIDBI portal)', url: 'https://www.standupmitra.in',
    service: /stand.?up/i,
    statusNote: 'Extended up to FY 2025 — confirm with the bank or standupmitra.in that it is still open.',
    summary: 'Bank loans of ₹10 lakh – ₹1 crore for a new enterprise of an SC / ST and / or woman entrepreneur.',
    benefits: ['Composite loan (term loan + working capital) of ₹10 lakh to ₹1 crore', 'For a greenfield enterprise in manufacturing, services, trading or agri-allied activities', 'Repayment up to 7 years with up to 18 months moratorium', 'Hand-holding through standupmitra.in'],
    documents: ['KYC: Aadhaar, PAN, photo', 'Caste certificate (SC / ST) where applicable', 'Project report and quotations', 'Proof of business premises', 'For a firm / company: partnership deed or MOA / AOA showing the 51% holding'],
    process: ['Register on standupmitra.in or visit a bank branch', 'Submit the project report and documents', 'Bank appraisal and sanction'],
    checks(p) {
      const cost = num(p.projectCost), age = num(p.age)
      const own = p.woman === true || p.category === 'SC' || p.category === 'ST'
      const out = []
      if (individualish(p.entity) || !has(p.entity)) {
        out.push(p.woman === undefined && !has(p.category) ? ask('Entrepreneur', 'For SC / ST and / or women entrepreneurs') : own ? pass('Entrepreneur', 'SC / ST and / or woman entrepreneur') : fail('Entrepreneur', 'Only for SC / ST and / or women entrepreneurs'))
        out.push(age === undefined ? ask('Age', '18 or older') : age >= 18 ? pass('Age', `${age} years`) : fail('Age', 'Must be 18 or older'))
      } else out.push(yesNo(p.reserved51, 'Shareholding', 'SC / ST and / or women hold at least 51%', 'In a firm / company, SC / ST and / or women must hold at least 51% and control', 'Do SC / ST and / or women hold 51% or more?'))
      out.push(!has(p.stage) ? ask('Greenfield', 'Only a new (first-time) enterprise') : p.stage === 'EXISTING' ? fail('Greenfield', 'Only a new (first-time) enterprise — not an existing business') : pass('Greenfield', 'New enterprise'))
      out.push(cost === undefined ? ask('Loan size', '₹10 lakh to ₹1 crore') : cost >= 10 * LAKH && cost <= CRORE ? pass('Loan size', `${inr(cost)} — within ₹10 lakh – ₹1 crore`) : fail('Loan size', `${inr(cost)} — the loan must be ₹10 lakh to ₹1 crore`))
      out.push(p.defaulter === true ? fail('Credit history', 'Must not be a defaulter to any bank / financial institution') : p.defaulter === false ? pass('Credit history', 'No default') : ask('Credit history', 'Any default with a bank / NBFC?'))
      return out
    },
  },
  {
    id: 'CGTMSE', name: 'CGTMSE — Credit Guarantee for Micro & Small Enterprises', kind: 'Loan guarantee', agency: 'CGTMSE (SIDBI & Ministry of MSME), through banks', url: 'https://www.cgtmse.in',
    service: /cgtmse|collateral/i,
    summary: 'Collateral-free bank credit for micro and small enterprises — the government trust guarantees the loan.',
    benefits: ['Loans without collateral or third-party guarantee, up to ₹10 crore', 'The trust covers most of the bank’s risk (cover depends on the loan and borrower)', 'For new and existing units; term loan and working capital'],
    documents: ['Udyam certificate', 'KYC of promoters and entity PAN', 'Project report / CMA data for the loan', 'Last 2–3 years’ financials and ITR (existing units)', 'Bank statements'],
    process: ['Apply for the loan at a bank / NBFC that is a CGTMSE member lending institution', 'The lender applies to CGTMSE for the guarantee cover', 'The annual guarantee fee is charged by the lender'],
    checks(p) {
      const c = msmeClass(p.investment, p.turnover), cost = num(p.projectCost)
      return [
        c === undefined ? ask('Micro / small', 'Only micro and small enterprises — enter investment and turnover')
          : c === 'MICRO' || c === 'SMALL' ? pass('Micro / small', `${CLASS_LABEL[c]} enterprise`) : fail('Micro / small', `${CLASS_LABEL[c]} — only micro and small enterprises are covered`),
        p.udyam === true ? pass('Udyam', 'Udyam-registered') : ask('Udyam', 'Needs Udyam registration (free) before the loan'),
        p.sector === 'AGRI_ALLIED' ? ask('Activity', 'Farm / agri-allied activities are generally outside CGTMSE — check with the bank') : has(p.sector) ? pass('Activity', 'Manufacturing, services or trading activity') : ask('Activity', 'What is the business activity?'),
        cost === undefined ? ask('Loan size', 'Up to ₹10 crore') : cost <= 10 * CRORE ? pass('Loan size', `${inr(cost)} — within ₹10 crore`) : fail('Loan size', `${inr(cost)} — above the ₹10 crore guarantee limit`),
        p.defaulter === true ? fail('Credit history', 'The bank will not lend to a defaulter') : p.defaulter === false ? pass('Credit history', 'No default') : ask('Credit history', 'Any default with a bank / NBFC?'),
      ]
    },
  },
  {
    id: 'ZED', name: 'MSME Sustainable ZED Certification', kind: 'Certification subsidy', agency: 'Ministry of MSME (QCI)', url: 'https://zed.msme.gov.in',
    service: /zed|iso|certif/i,
    summary: 'Quality & sustainability certification (Bronze, Silver, Gold) with most of the cost paid by the government.',
    benefits: ['Subsidy on the certification cost: 80% micro, 60% small, 50% medium', 'Extra support for women / SC-ST owned MSMEs and units in NER, hill and aspirational districts', '₹10,000 joining reward after the ZED pledge', 'Better standing with banks, buyers and in many state incentive schemes'],
    documents: ['Udyam certificate', 'Basic unit details and photos', 'Process / quality records for the assessment'],
    process: ['Register on the ZED portal with the Udyam number', 'Take the ZED pledge', 'Apply for Bronze (then Silver / Gold)', 'Assessment, then certificate; subsidy applied on the fee'],
    checks(p) {
      const c = msmeClass(p.investment, p.turnover)
      return [
        p.udyam === true ? pass('Udyam', 'Udyam-registered') : ask('Udyam', 'Needs Udyam registration first (free)'),
        c === undefined ? ask('MSME', 'Must be an MSME — enter investment and turnover') : c === 'LARGE' ? fail('MSME', 'Above MSME limits') : pass('MSME', `${CLASS_LABEL[c]} — ${c === 'MICRO' ? 80 : c === 'SMALL' ? 60 : 50}% subsidy on the certification cost`),
        p.sector === 'MANUFACTURING' ? pass('Activity', 'Manufacturing MSME') : has(p.sector) ? ask('Activity', 'ZED is built for manufacturing MSMEs — check the portal for service-sector coverage') : ask('Activity', 'What is the business activity?'),
        p.stage === 'EXISTING' ? pass('Running unit', 'A running unit can be assessed') : has(p.stage) ? ask('Running unit', 'Certification needs a running unit — apply once production starts') : ask('Running unit', 'Is the unit running?'),
      ]
    },
  },
]

/** Overall result of one scheme's checks: any fail → not eligible; all pass → eligible; else potentially eligible. */
export function verdict(checks) {
  if (checks.some((c) => c.status === 'fail')) return 'NOT_ELIGIBLE'
  if (checks.every((c) => c.status === 'pass')) return 'ELIGIBLE'
  return 'POSSIBLE'
}

/** Every scheme checked against the client's details, eligible first. `today` is YYYY-MM-DD (India). */
export function checkEligibility(profile, today) {
  const order = { ELIGIBLE: 0, POSSIBLE: 1, NOT_ELIGIBLE: 2 }
  return SCHEMES.map((s) => {
    const checks = s.checks(profile || {}, today)
    const status = verdict(checks)
    const failed = checks.filter((c) => c.status === 'fail'), open = checks.filter((c) => c.status === 'unknown')
    const why = status === 'ELIGIBLE' ? 'Meets every condition checked here'
      : status === 'NOT_ELIGIBLE' ? failed.map((c) => c.reason).join(' · ')
        : `To confirm: ${open.map((c) => c.label).join(', ')}`
    return { scheme: s, status, checks, why }
  }).sort((a, b) => order[a.status] - order[b.status])
}

/** How many details are filled in (to nudge the sales person to fill more for sharper results). */
export const PROFILE_KEYS = ['entity', 'stage', 'sector', 'incorporated', 'turnover', 'investment', 'projectCost', 'area', 'udyam', 'dpiit', 'innovative', 'age', 'education', 'category', 'woman', 'reserved51', 'indian51', 'priorFunding', 'priorSubsidy', 'defaulter']
export const filledCount = (p) => PROFILE_KEYS.filter((k) => has(p?.[k])).length

/** A short WhatsApp-friendly summary for the client (eligible and potentially eligible schemes only). */
export function clientSummary(results, clientName) {
  const lines = [`Government schemes${clientName ? ` for ${clientName}` : ''} — preliminary check`, '']
  const shown = results.filter((r) => r.status !== 'NOT_ELIGIBLE')
  if (!shown.length) lines.push('No scheme matched on the details shared so far. Let us discuss your plans in more detail.')
  for (const r of shown) {
    lines.push(`${r.status === 'ELIGIBLE' ? '✅' : '🟡'} ${r.scheme.name} (${STATUS[r.status].label})`, `   ${r.scheme.summary}`)
    if (r.status === 'POSSIBLE') lines.push(`   ${r.why}`)
  }
  lines.push('', 'This is a preliminary check on the details shared. The final decision is made by the bank / government agency after verifying documents — approval is not guaranteed.')
  return lines.join('\n')
}
