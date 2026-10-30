import type { EligibilityCondition, EligibilityRule, EligibilityScheme } from '../src/lib/types'

type Opt = { id: string; label: string }
export type Verdict = 'ELIGIBLE' | 'POSSIBLE' | 'NOT_ELIGIBLE'
export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'info'
export type FieldType = 'select' | 'bool' | 'money' | 'years'
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
export interface SchemeResult { scheme: EligibilityScheme; status: Verdict; checks: Check[]; why: string }
export const DEFAULTS_CHECKED: string
export const ENTITIES: Opt[]
export const SECTORS: Opt[]
export const STAGES: Opt[]
export const EDUCATION: Opt[]
export const CATEGORIES: Opt[]
export const AREAS: Opt[]
export const MSME_CLASSES: Opt[]
export const SPECIAL_CATEGORIES: string[]
export const STATUS: Record<Verdict, { label: string; tone: 'green' | 'amber' | 'red' }>
export const FIELDS: Record<string, { label: string; type: FieldType; options?: Opt[]; derived?: boolean }>
export const OPS: Record<FieldType, Opt[]>
export const DEFAULT_SCHEMES: EligibilityScheme[]
export const PROFILE_KEYS: (keyof EligibilityProfile)[]
export function inr(n: number): string
export function yearsSince(date: string | undefined, today: string): number | undefined
export function msmeClass(investment: unknown, turnover: unknown): 'MICRO' | 'SMALL' | 'MEDIUM' | 'LARGE' | undefined
export function fieldValue(p: EligibilityProfile, field: string, today: string): string | number | boolean | undefined
export function showValue(field: string, v: unknown): string
export function describeRule(c: EligibilityRule): string
export function showLimit(c: EligibilityRule): string
export function testRule(c: EligibilityRule, v: unknown): boolean
export function evaluateCondition(c: EligibilityCondition, p: EligibilityProfile, today: string): Check | null
export function verdict(checks: Check[]): Verdict
export function checkScheme(s: EligibilityScheme, p: EligibilityProfile, today: string): SchemeResult
export function checkEligibility(profile: EligibilityProfile, today: string, schemes?: EligibilityScheme[]): SchemeResult[]
export function schemeProblems(s: Partial<EligibilityScheme>): string[]
export function filledCount(p: EligibilityProfile): number
export function clientSummary(results: SchemeResult[], clientName?: string): string
