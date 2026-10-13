import type { Lead } from './types'

/**
 * Lead sheet upload (Super Admin → CRM Leads → Upload), ported from the old CRM's leads/upload_process.php:
 * columns are matched to lead fields by name (many spellings), then by looking at the values (a column of phone
 * numbers / emails); every row is checked (valid · invalid · duplicate) before anything is imported.
 */
export type LeadField =
  | 'name' | 'phone' | 'altPhone' | 'company' | 'email' | 'city' | 'state' | 'location' | 'source' | 'service' | 'requirement'
  | 'notes' | 'industry' | 'businessType' | 'turnover' | 'fundingAmount' | 'fundingCategory' | 'formAt'

/** Field → label and the header spellings that mean it (compared without case, spaces or punctuation). */
export const LEAD_FIELDS: { id: LeadField; label: string; required?: boolean; aliases: string[] }[] = [
  { id: 'name', label: 'Name', required: true, aliases: ['name', 'fullname', 'clientname', 'contactname', 'customername', 'leadname', 'lead', 'client', 'customer', 'personname', 'partyname', 'party', 'prospect', 'candidate', 'contactperson'] },
  { id: 'phone', label: 'Phone', required: true, aliases: ['phone', 'phonenumber', 'phoneno', 'phonenum', 'ph', 'phno', 'mobile', 'mobilenumber', 'mobileno', 'mob', 'mobno', 'contact', 'contactno', 'contactnumber', 'cell', 'cellno', 'cellnumber', 'telephone', 'tel', 'telno', 'whatsapp', 'whatsappno', 'whatsappnumber', 'number', 'callingno', 'primaryphone', 'primarymobile', 'phone1', 'mobile1', 'contact1', 'clientphone', 'customermobile', 'customerphone', 'phonemobile', 'companymobile'] },
  { id: 'altPhone', label: 'Alternate phone', aliases: ['alternatephone', 'altphone', 'alternatemobile', 'altmobile', 'secondphone', 'secondmobile', 'otherphone', 'othermobile', 'phone2', 'mobile2', 'contact2', 'altno', 'secondaryphone', 'secondarymobile', 'landline', 'officephone'] },
  { id: 'company', label: 'Company', aliases: ['companyname', 'company', 'organization', 'organisation', 'businessname', 'business', 'firmname', 'firm', 'agency', 'enterprise', 'brandname', 'brand', 'shopname', 'shop', 'corporation', 'clientcompany', 'startupname'] },
  { id: 'email', label: 'Email', aliases: ['email', 'emailaddress', 'mail', 'emailid', 'mailid', 'clientemail', 'customeremail', 'companyemail'] },
  { id: 'city', label: 'City', aliases: ['city', 'town', 'district', 'citytown'] },
  { id: 'state', label: 'State', aliases: ['state', 'province', 'region'] },
  { id: 'location', label: 'Address / location', aliases: ['location', 'address', 'area', 'locality', 'street', 'fulladdress'] },
  { id: 'source', label: 'Lead source', aliases: ['leadsource', 'source', 'channel', 'platform', 'datasource', 'campaign', 'sourcename', 'formsource', 'sourceform', 'form', 'reference', 'referral', 'ref', 'leadorigin', 'medium'] },
  { id: 'service', label: 'Product / service', aliases: ['productservice', 'product', 'service', 'services', 'products', 'offering', 'serviceplan', 'servicerequired', 'interestedin', 'scheme'] },
  { id: 'requirement', label: 'Requirement', aliases: ['requirement', 'requirements', 'need', 'needs', 'details', 'inquiry', 'enquiry', 'query', 'description'] },
  { id: 'notes', label: 'Notes', aliases: ['notes', 'note', 'remark', 'remarks', 'comment', 'comments', 'feedback', 'messagenotes', 'message', 'clientmessage'] },
  { id: 'industry', label: 'Industry', aliases: ['industry', 'sector', 'businesssector', 'industrytype'] },
  { id: 'businessType', label: 'Business type', aliases: ['businesstype', 'constitution', 'entitytype', 'organizationtype', 'firmtype', 'leadtype', 'type'] },
  { id: 'turnover', label: 'Annual turnover', aliases: ['annualturnover', 'turnover', 'turnoverinr', 'sales', 'revenue'] },
  { id: 'fundingAmount', label: 'Funding amount', aliases: ['fundingamount', 'loanrequired', 'loanamount', 'requestedamount', 'requiredfunding', 'fundingreq'] },
  { id: 'fundingCategory', label: 'Funding category', aliases: ['fundingcategory', 'fundingtype', 'fundcategory', 'categoryoffunding'] },
  { id: 'formAt', label: 'Form timestamp', aliases: ['timestamp', 'formtimestamp', 'submissiontime', 'submissiondate', 'submittedat', 'datetime', 'time', 'entrytime', 'leaddate', 'date', 'createddate', 'entrydate'] },
]
export type Mapping = Partial<Record<LeadField, string>>
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const PLACEHOLDER = new Set(['', 'na', 'n/a', '#n/a', '-', '—', 'none', 'null', 'nil', 'noemail', 'no email', 'notavailable', 'not available', 'notprovided', 'not provided', '0'])
const blank = (v?: string) => !v || PLACEHOLDER.has(v.trim().toLowerCase())

/** Header → field, as the old CRM did: exact spellings first, then words inside the header, then the values. */
export function autoMap(headers: string[], rows: Record<string, string>[] = []): Mapping {
  const m: Mapping = {}
  const used = () => new Set(Object.values(m))
  for (const h of headers) {
    const n = norm(h)
    const f = n && LEAD_FIELDS.find((x) => !m[x.id] && (x.aliases.includes(n) || norm(x.id) === n))
    if (f) m[f.id] = h
  }
  const has = (n: string, ...w: string[]) => w.some((x) => n.includes(x))
  for (const h of headers) {
    const n = norm(h)
    if (!n || used().has(h)) continue
    const set = (f: LeadField) => { if (!m[f]) m[f] = h }
    if (has(n, 'timestamp', 'submission')) set('formAt')
    else if (has(n, 'industry')) set('industry')
    else if (has(n, 'funding') && has(n, 'amount')) set('fundingAmount')
    else if (has(n, 'funding') && has(n, 'cat', 'type')) set('fundingCategory')
    else if (has(n, 'turnover')) set('turnover')
    else if (has(n, 'business') && has(n, 'type')) set('businessType')
    else if (has(n, 'phone', 'mobile', 'cell', 'contact', 'whatsapp')) set(has(n, 'alt', 'sec', 'other', '2') ? 'altPhone' : 'phone')
    else if (has(n, 'email', 'mail')) set('email')
    else if (has(n, 'company', 'firm', 'business', 'org')) set('company')
    else if (has(n, 'source', 'campaign', 'channel')) set('source')
    else if (has(n, 'name')) set('name')
  }
  // a column that mostly holds phone numbers / emails, whatever it's called
  const sample = rows.slice(0, 25)
  const sniff = (field: LeadField, test: (v: string) => boolean) => {
    if (m[field]) return
    for (const h of headers) {
      if (used().has(h)) continue
      const vals = sample.map((r) => (r[h] ?? '').trim()).filter(Boolean)
      if (vals.length && vals.filter(test).length / vals.length >= 0.5) { m[field] = h; return }
    }
  }
  sniff('phone', (v) => { const d = v.replace(/\D/g, ''); return d.length >= 8 && d.length <= 15 })
  sniff('email', (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
  return m
}

/** Indian mobile as the CRM stores it (10 digits), from "+91 98…", "098…", "9.87654E+09"; '' when it isn't one. */
export function cleanPhone(raw: string) {
  let v = raw.trim()
  if (/^\d+(\.\d+)?e\+\d+$/i.test(v)) v = Number(v).toFixed(0)
  let d = v.replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? d : ''
}

/** Sheet time (Excel serial day number, or text) → ISO time; undefined when it isn't a date. */
export function sheetTime(raw?: string): string | undefined {
  const v = (raw ?? '').trim()
  if (!v) return undefined
  const n = Number(v)
  // Excel stores dates as days since 1899-12-30 (≈ 30000–70000 for 1982–2091)
  if (Number.isFinite(n) && n > 30000 && n < 70000) return new Date(Math.round((n - 25569) * 86400000)).toISOString()
  const dmy = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/) // 13/10/2026 10:15 (Indian order)
  const t = dmy ? new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), Number(dmy[4] ?? 0), Number(dmy[5] ?? 0), Number(dmy[6] ?? 0)) : new Date(v)
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString()
}

export type RowCheck = { status: 'Valid' | 'Invalid' | 'Duplicate'; reason: string; lead: Partial<Lead> & { name: string; phone: string } }

/** Checks every row like the old CRM: a name (or company) and a valid mobile are required; repeats are duplicates. */
export function checkRows(rows: Record<string, string>[], m: Mapping, existing: { phones: Set<string>; emails: Set<string> }, fileName: string): RowCheck[] {
  const seenPhones = new Set<string>(), seenEmails = new Set<string>()
  const pick = (r: Record<string, string>, f: LeadField) => { const v = m[f] ? (r[m[f]!] ?? '').trim() : ''; return blank(v) ? '' : v }
  const mapped = new Set(Object.values(m))
  return rows.map((r) => {
    const phone = cleanPhone(pick(r, 'phone'))
    const rawPhone = pick(r, 'phone')
    const email = pick(r, 'email').toLowerCase()
    const name = pick(r, 'name') || pick(r, 'company')
    // the rest of the row is kept as it was (except IP addresses)
    const extra = Object.fromEntries(Object.entries(r).filter(([k, v]) => !mapped.has(k) && !blank(v) && !/^ip(address|addr)?$/i.test(norm(k))).map(([k, v]) => [k.trim(), v.trim()]))
    const parts = { industry: pick(r, 'industry'), businessType: pick(r, 'businessType'), turnover: pick(r, 'turnover'), fundingAmount: pick(r, 'fundingAmount'), notes: pick(r, 'notes') }
    const requirement = pick(r, 'requirement') || [parts.industry && `Industry: ${parts.industry}`, parts.businessType && `Business type: ${parts.businessType}`, parts.turnover && `Turnover: ${parts.turnover}`, parts.fundingAmount && `Funding: ${parts.fundingAmount}`].filter(Boolean).join(' | ')
    const lead: RowCheck['lead'] = {
      name, phone, company: pick(r, 'company'), email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
      city: pick(r, 'city'), state: pick(r, 'state'), location: pick(r, 'location') || undefined,
      source: pick(r, 'source') || `Uploaded: ${fileName.replace(/\.[^.]+$/, '')}`, service: pick(r, 'service'),
      requirement: requirement || undefined, notes: parts.notes, altPhone: cleanPhone(pick(r, 'altPhone')) || pick(r, 'altPhone') || undefined,
      industry: parts.industry || undefined, businessType: parts.businessType || undefined, turnover: parts.turnover || undefined,
      fundingAmount: parts.fundingAmount || undefined, fundingCategory: pick(r, 'fundingCategory') || pick(r, 'service') || undefined,
      formAt: sheetTime(pick(r, 'formAt')), extra: Object.keys(extra).length ? extra : undefined,
    }
    const problems = [!rawPhone ? 'Missing phone number' : !phone ? `Not a valid mobile (${rawPhone})` : '', !name ? 'Missing name' : ''].filter(Boolean)
    if (problems.length) return { status: 'Invalid', reason: problems.join(', '), lead }
    const dupPhone = existing.phones.has(phone) || seenPhones.has(phone)
    const dupEmail = !!lead.email && (existing.emails.has(lead.email) || seenEmails.has(lead.email))
    seenPhones.add(phone)
    if (lead.email) seenEmails.add(lead.email)
    if (dupPhone) return { status: 'Duplicate', reason: existing.phones.has(phone) ? 'Phone already in the CRM' : 'Phone repeated in this file', lead }
    if (dupEmail) return { status: 'Duplicate', reason: existing.emails.has(lead.email!) ? 'Email already in the CRM' : 'Email repeated in this file', lead }
    return { status: 'Valid', reason: '', lead }
  })
}
