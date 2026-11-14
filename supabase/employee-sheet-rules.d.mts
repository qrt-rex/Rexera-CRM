export function cell(v: unknown): string
export function titleCase(s: string): string
export function dateOf(v: unknown): string
export function mobileOf(v: unknown): string
export function emailOf(v: unknown): string
export function moneyOf(v: unknown): number | null
export function accountOf(v: unknown): string
export function ifscOf(v: unknown): string
export function genderOf(v: unknown): string
export function branchKeyOf(v: unknown): string
export function norm(s: unknown): string
export const KNOWN: [string, string, RegExp][]
export function isDayColumn(h: unknown): boolean
export function columnsOf(row: unknown[]): Record<string, number> & { days: Record<number, number>; other: number[]; serial: number[] }
export function monthOf(name: string): string
export type FieldType = 'text' | 'number' | 'date' | 'email' | 'phone'
export const FIELD_TYPES: FieldType[]
export function fieldKey(label: string): string
export function detectType(heading: string, values: unknown[]): FieldType
export function valueFor(type: FieldType, raw: unknown): [string, boolean]
export interface SheetField { key: string; label: string; type: FieldType; aliases: string[]; isNew?: boolean; createdAt?: string; createdBy?: string }
export function findField(fields: SheetField[] | undefined, heading: string): SheetField | undefined
export function colLetter(i: number): string
export function splitDelimited(rows: unknown[][]): unknown[][]
export interface EmployeeValues {
  name: string; joinedOn: string; department: string; designation: string; branchKey: string; ctc: number | null; gender: string
  phone: string; personalPhone: string; email: string; personalEmail: string; address: string; bankName: string; bankAccount: string; bankIfsc: string
  basic: number | null; hra: number | null; allowance: number | null; pf: number | null; pt: number | null
  uan: string; custom: Record<string, string>
}
export interface EmployeePlanRow { line: string; v: EmployeeValues; marks: { date: string; mark: 'P' | 'H' | 'A' | 'L' }[]; action: 'new' | 'update' | 'same' | 'skip'; userId?: string; changes: string[]; problems: string[]; notes: string[] }
export interface SheetColumn { sheet: string; col: string; heading: string; to: 'crm' | 'custom' | 'attendance' | 'serial'; key?: string; label: string; type?: FieldType; isNew?: boolean }
export interface PlanCtx {
  users: { id: string; name: string; email: string; active: boolean; deletedAt?: string; joinedOn: string; department: string; designation: string; salary?: number; phone: string; address?: { line: string } }[]
  privates?: Record<string, { custom?: Record<string, string> } & object>; uans?: Record<string, string>; fields?: SheetField[]; month: string; monthDays?: number
}
export function planEmployees(sheets: { name: string; rows: unknown[][] }[], ctx: PlanCtx): EmployeePlanRow[]
export function planSheet(sheets: { name: string; rows: unknown[][] }[], ctx: PlanCtx): { rows: EmployeePlanRow[]; columns: SheetColumn[]; fields: SheetField[] }
