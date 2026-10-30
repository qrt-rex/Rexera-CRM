type Opt = { id: string; label: string }
export type Verdict = 'ELIGIBLE' | 'POSSIBLE' | 'NOT_ELIGIBLE'
export type CheckStatus = 'pass' | 'fail' | 'unknown'
export interface EligibilityProfile {
  clientName?: string
  entity?: string; stage?: string; sector?: string; area?: 'URBAN' | 'RURAL' | ''
  /** YYYY-MM-DD */
  incorporated?: string
  /** ₹ */
  turnover?: number | ''; investment?: number | ''; projectCost?: number | ''; priorFunding?: number | ''; age?: number | ''
  udyam?: boolean; dpiit?: boolean; innovative?: boolean; woman?: boolean; reserved51?: boolean; indian51?: boolean; priorSubsidy?: boolean; defaulter?: boolean
  education?: string; category?: string
}
export interface Check { label: string; status: CheckStatus; reason: string }
export interface SchemeRule {
  id: string; name: string; kind: string; agency: string; url: string; service: RegExp; statusNote?: string
  summary: string; benefits: string[]; documents: string[]; process: string[]
  checks(p: EligibilityProfile, today: string): Check[]
}
export interface SchemeResult { scheme: SchemeRule; status: Verdict; checks: Check[]; why: string }
export const RULES_CHECKED: string
export const ENTITIES: Opt[]
export const SECTORS: Opt[]
export const STAGES: Opt[]
export const EDUCATION: Opt[]
export const CATEGORIES: Opt[]
export const STATUS: Record<Verdict, { label: string; tone: 'green' | 'amber' | 'red' }>
export const SCHEMES: SchemeRule[]
export const PROFILE_KEYS: (keyof EligibilityProfile)[]
export function yearsSince(date: string | undefined, today: string): number | undefined
export function msmeClass(investment: unknown, turnover: unknown): 'MICRO' | 'SMALL' | 'MEDIUM' | 'LARGE' | undefined
export function verdict(checks: Check[]): Verdict
export function checkEligibility(profile: EligibilityProfile, today: string): SchemeResult[]
export function filledCount(p: EligibilityProfile): number
export function clientSummary(results: SchemeResult[], clientName?: string): string
