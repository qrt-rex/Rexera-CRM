import type { Role, SalesKitItem, SchemeFilter, SchemeKit } from '../src/lib/types'
export const SCHEME_EDITORS: Role[]
export function canEditSchemes(roles: Role[]): boolean
export function lastDateOf(text: string | undefined): string | null
export type Closing = 'open' | 'week' | 'month' | 'rolling' | 'closed' | 'unknown'
export function closingOf(item: Pick<SalesKitItem, 'lastDate'>, today: string): Closing
export const CLOSING: [Closing, string][]
export function amountOf(text: string | undefined): number | null
export const AMOUNT_BANDS: [string, string][]
export function inAmountBand(v: number | null, band: string): boolean
export function tokens(text: string | undefined): string[]
export function optionsOf(items: SalesKitItem[], field: keyof SalesKitItem): { label: string; count: number }[]
export function emptyFilter(): SchemeFilter
export function filterCount(f: SchemeFilter): number
export function chargeOf(text: string | undefined): number | null
export const CHARGE_BANDS: [string, string][]
export function inChargeBand(text: string | undefined, band: string): boolean
export function matches(item: SalesKitItem, f: SchemeFilter | undefined, today: string): boolean
export const SORTS: [string, string][]
export function sortItems(list: SalesKitItem[], sort: string, today: string): SalesKitItem[]
export function kitItems(kit: Pick<SchemeKit, 'schemeIds' | 'excludedIds' | 'filter'>, items: SalesKitItem[], today: string): SalesKitItem[]
export function kitProblem(kit: Partial<SchemeKit>, kits: SchemeKit[]): string | null
export type SchemeInput = Omit<SalesKitItem, 'id' | 'position' | 'updatedAt' | 'updatedBy'>
export interface ImportRow { line: string; v: SchemeInput; id?: string; action: 'new' | 'update' | 'same' | 'skip'; changes: string[]; problem?: string; fromDefault?: boolean }
export function columnsOf(header: unknown[]): Partial<Record<keyof SchemeInput, number>>
export function genericSheet(name: string): boolean
export function planSchemeImport(sheets: { name: string; rows: unknown[][] }[], existing: SalesKitItem[], opts?: { defaultCategory?: string }): ImportRow[]
