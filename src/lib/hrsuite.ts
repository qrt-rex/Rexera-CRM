import type { DB, IncentiveRules, Perm, PfSettings, Role } from './types'
import { defaultAutomations } from './emailTemplates'

export const DEFAULT_PF: PfSettings = {
  enabled: true, employeePct: 12, employerPct: 12, epsPct: 8.33, ceilingEnabled: false, wageCeiling: 15000, floorEnabled: false, wageFloor: 0, ptEnabled: true, basicPct: 50, hraPct: 40,
}

export const DEFAULT_INCENTIVE: IncentiveRules = {
  version: 1,
  eligibilityMultiple: 3,
  dailyThreshold: 10000,
  dailyPct: 5,
  weeklyThreshold: 50000,
  weeklyPct: 5,
  monthlyMultiple: 4,
  slabs: [
    { upTo: 200000, pct: 20 }, { upTo: 300000, pct: 25 }, { upTo: 400000, pct: 27.5 }, { upTo: 500000, pct: 30 },
    { upTo: 600000, pct: 32.5 }, { upTo: 700000, pct: 35 }, { upTo: 800000, pct: 37.5 }, { upTo: null, pct: 40 },
  ],
  updatedAt: new Date(0).toISOString(),
  updatedBy: 'system',
}

/** Sample monthly salaries for seeded people who have none (demo data only). */
const SAMPLE_SALARY: Partial<Record<Role, number>> = {
  superadmin: 150000, admin: 32000, accounts: 45000, legal: 60000, operations: 28000, hr: 40000, it: 38000, support: 24000,
}
const HR_SUITE_PERMS: Perm[] = ['payroll.view', 'payroll.manage', 'incentives.manage', 'recruitment.manage', 'performance.view']

/** Sample 12-digit UAN for seeded people (demo data). */
const sampleUan = (id: string) => `1010${String([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1e8, 7)).padStart(8, '0')}`

/** Brings data saved by an older build up to date. Safe to run repeatedly. */
export function upgradeDb(d: DB): DB {
  d.payrollRuns ??= []
  d.pfSettings ??= { ...DEFAULT_PF }
  d.pfAccounts ??= []
  d.incentiveRules ??= { ...DEFAULT_INCENTIVE, slabs: DEFAULT_INCENTIVE.slabs.map((s) => ({ ...s })) }
  d.incentiveHistory ??= []
  d.manualIncentives ??= []
  d.apiKeys ??= []
  d.backupLog ??= []
  d.emails ??= []
  // invoice branches — addresses are filled in by Super Admin / IT under Access → Settings
  d.settings.branches ??= [
    { id: 'br-amd-a', name: 'Ahmedabad (A)', address: '', city: 'Ahmedabad', state: 'Gujarat', pin: '', gstin: d.settings.companyGstin ?? '', phone: '', email: '' },
    { id: 'br-amd-y', name: 'Ahmedabad (Y)', address: '', city: 'Ahmedabad', state: 'Gujarat', pin: '', gstin: d.settings.companyGstin ?? '', phone: '', email: '' },
    { id: 'br-vdr', name: 'Vadodara', address: '', city: 'Vadodara', state: 'Gujarat', pin: '', gstin: d.settings.companyGstin ?? '', phone: '', email: '' },
  ]
  d.candidateForms ??= []
  d.candidates ??= []
  d.emailAutomations ??= defaultAutomations()
  for (const a of defaultAutomations()) if (!d.emailAutomations.some((x) => x.key === a.key)) d.emailAutomations.push(a)
  if (!d.upgrades.includes('uan-fix-1')) {
    // an earlier build generated 13-digit sample UANs; a UAN has 12 digits
    for (const a of d.pfAccounts) if (a.uan && !/^\d{12}$/.test(a.uan) && a.userId.startsWith('u-')) a.uan = sampleUan(a.userId)
    d.upgrades.push('uan-fix-1')
  }
  if (!d.upgrades.includes('email-1')) {
    d.rolePerms.hr = [...new Set([...(d.rolePerms.hr ?? []), 'email.send' as Perm])]
    d.upgrades.push('email-1')
  }
  d.upgrades ??= []
  if (!d.upgrades.includes('hr-suite-1')) {
    d.rolePerms.hr = [...new Set([...(d.rolePerms.hr ?? []), ...HR_SUITE_PERMS])]
    for (const u of d.users) {
      if (u.salary == null && u.id.startsWith('u-')) u.salary = SAMPLE_SALARY[u.role]
      if (!d.pfAccounts.some((a) => a.userId === u.id)) {
        const n = [...u.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1e9, 7)
        d.pfAccounts.push({ userId: u.id, uan: sampleUan(u.id), enrolled: true })
      }
    }
    d.upgrades.push('hr-suite-1')
  }
  if (!d.upgrades.includes('stages-11')) {
    // 9 → 11 work stages: "Company Information Under Process" was inserted at 8 (and "Hold – client not responding" added at 11),
    // so saved stages 8 (Approved/Rejected) and 9 (Re-submission) move up by one
    const up = (n: number) => (n >= 8 ? n + 1 : n)
    for (const b of d.bookings) {
      b.stage = up(b.stage)
      b.maxStage = b.maxStage >= 9 ? 11 : up(b.maxStage)
      for (const h of b.stageHistory) h.stage = up(h.stage)
      for (const doc of b.documents) if (doc.category === 'Pitch deck / DPR') doc.category = 'Pitch deck'
    }
    d.upgrades.push('stages-11')
  }
  if (!d.upgrades.includes('doc-categories-2')) {
    const rename: Record<string, string> = { 'PAN card': 'Company PAN card', 'GSTIN certificate': 'GST certificate' }
    for (const b of d.bookings) for (const doc of b.documents) if (rename[doc.category]) doc.category = rename[doc.category]!
    d.upgrades.push('doc-categories-2')
  }
  if (!d.upgrades.includes('salary-structure-1')) {
    // Basic 50% · HRA 40% of basic · rest other allowance · PF 12% each side on the full basic
    d.pfSettings = { ...DEFAULT_PF, ...d.pfSettings, basicPct: 50, hraPct: 40, ceilingEnabled: false }
    d.upgrades.push('salary-structure-1')
  }
  return d
}
