import type { DB, IncentiveRules, Perm, PfSettings, Role } from './types'
import { defaultAutomations } from './emailTemplates'

export const DEFAULT_PF: PfSettings = {
  enabled: true, employeePct: 12, employerPct: 12, epsPct: 8.33, ceilingEnabled: false, wageCeiling: 15000, ptEnabled: true, basicPct: 50, hraPct: 40,
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
  d.emailAutomations ??= defaultAutomations()
  for (const a of defaultAutomations()) if (!d.emailAutomations.some((x) => x.key === a.key)) d.emailAutomations.push(a)
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
        d.pfAccounts.push({ userId: u.id, uan: `1010${String(n).padStart(8, '0')}`, enrolled: true })
      }
    }
    d.upgrades.push('hr-suite-1')
  }
  if (!d.upgrades.includes('salary-structure-1')) {
    // Basic 50% · HRA 40% of basic · rest other allowance · PF 12% each side on the full basic
    d.pfSettings = { ...DEFAULT_PF, ...d.pfSettings, basicPct: 50, hraPct: 40, ceilingEnabled: false }
    d.upgrades.push('salary-structure-1')
  }
  return d
}
