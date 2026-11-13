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
export function columnsOf(row: unknown[]): Record<string, number> & { days: Record<number, number> }
export function monthOf(name: string): string
export interface EmployeeValues {
  name: string; joinedOn: string; department: string; designation: string; branchKey: string; ctc: number | null; gender: string
  phone: string; personalPhone: string; email: string; personalEmail: string; address: string; bankName: string; bankAccount: string; bankIfsc: string
  basic: number | null; hra: number | null; allowance: number | null; pf: number | null; pt: number | null
}
export interface EmployeePlanRow { line: string; v: EmployeeValues; marks: { date: string; mark: 'P' | 'H' | 'A' | 'L' }[]; action: 'new' | 'update' | 'same' | 'skip'; userId?: string; changes: string[]; problems: string[]; notes: string[] }
export function planEmployees(sheets: { name: string; rows: unknown[][] }[], ctx: { users: { id: string; name: string; email: string; active: boolean; deletedAt?: string; joinedOn: string; department: string; designation: string; salary?: number; phone: string; address?: { line: string } }[]; privates?: Record<string, object>; month: string; monthDays?: number }): EmployeePlanRow[]
