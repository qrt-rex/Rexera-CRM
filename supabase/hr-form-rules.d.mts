import type { HrForm, HrFormField, HrFormSubmission, HrFieldType, HrSubStatus, User } from '../src/lib/types'

export type FormatKey = 'pdf' | 'word' | 'excel' | 'image'
export const FIELD_TYPES: [HrFieldType, string, string][]
export const TYPE_LABEL: Record<HrFieldType, string>
export const CHOICE_TYPES: HrFieldType[]
export const MULTI_TYPES: HrFieldType[]
export const FILE_TYPES: HrFieldType[]
export const TEXT_TYPES: HrFieldType[]
export const FORMATS: [FormatKey, string, string[], string[]][]
export const MAX_FILE_MB: number
export const DEFAULT_FILE_MB: number
export const MAX_FILES: number
export type ViewStatus = HrSubStatus | 'PENDING'
export const STATUS_LABEL: Record<ViewStatus, string>
export const EDITABLE: HrSubStatus[]
export const SENT: HrSubStatus[]

export function formatsOf(f: HrFormField): FormatKey[]
export function acceptAttr(f: HrFormField): string
export function maxFilesOf(f: HrFormField): number
export function maxMbOf(f: HrFormField): number
export function fileProblem(f: HrFormField, file: { name: string; size: number; type?: string }): string | null
export function tidyField(f: HrFormField): HrFormField
export function formProblems(form: Partial<HrForm>, opts?: { forPublish?: boolean; today?: string }): string[]
export function isAssigned(form: Pick<HrForm, 'assign'>, u: User): boolean
export function assignees(form: Pick<HrForm, 'assign'>, users: User[]): User[]
export function statusOf(sub?: HrFormSubmission | null): ViewStatus
export function isOverdue(form: HrForm, sub: HrFormSubmission | null | undefined, today: string): boolean
export function canFill(form: HrForm, sub: HrFormSubmission | null | undefined, today: string): boolean
export function answerProblem(f: HrFormField, v: unknown, ctx?: { users?: User[] }): string | null
export function answerProblems(fields: HrFormField[], answers: Record<string, unknown> | undefined, ctx?: { users?: User[] }): Record<string, string>
export function progressOf(fields: HrFormField[], answers: Record<string, unknown> | undefined): number
export function answerText(f: HrFormField, v: unknown, ctx?: { users?: User[] }): string
export interface ResponseRow { key: string; form: HrForm; user: User; sub?: HrFormSubmission; status: ViewStatus; overdue: boolean; at?: string; files: number }
export function responseRows(x: { forms: HrForm[]; subs: HrFormSubmission[]; users: User[]; today: string }): ResponseRow[]
export function fileCount(sub: HrFormSubmission): number
export interface RowFilters { q?: string; formId?: string; department?: string; branchId?: string; status?: string; from?: string; to?: string; sort?: 'new' | 'old' }
export function filterRows(rows: ResponseRow[], f?: RowFilters): ResponseRow[]
export interface Group { key: string; assigned: number; sent: number; approved: number }
export function analytics(x: { forms: HrForm[]; rows: ResponseRow[] }): {
  totalForms: number; activeForms: number; assigned: number; pending: number; completed: number; approved: number; rejected: number; underReview: number; overdue: number
  byDepartment: Group[]; byBranch: Group[]
}
export const EMPLOYEE_STEPS: Partial<Record<HrSubStatus, HrSubStatus[]>>
export const HR_STEPS: Partial<Record<HrSubStatus, HrSubStatus[]>>
export function canStep(from: HrSubStatus, to: HrSubStatus, hr: boolean): boolean
export function dueSoon(x: { forms: HrForm[]; subs: HrFormSubmission[]; user: User; today: string; days?: number }): HrForm[]
