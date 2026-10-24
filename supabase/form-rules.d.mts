import type { DocForm, FormField, FormFieldType } from '../src/lib/types'

export const FIELD_TYPES: { id: FormFieldType; label: string }[]
export const UPLOAD_TYPES: Record<string, string>
export const MAX_UPLOAD_BYTES: number
export const MAX_SUBMISSION_BYTES: number
export const MAX_FIELDS: number
export function sniffType(bytes: Uint8Array): string | null
export function fileProblem(name: string, declaredType: string, size: number, bytes: Uint8Array): string | null
export function formProblems(f: Partial<DocForm>): string[]
export function normMobile(v: unknown): string
export function checkAnswers(fields: FormField[], answers: Record<string, unknown>, files?: { fieldId: string; name?: string; type?: string; size?: number }[]): { errors: Record<string, string>; clean: Record<string, string | number | boolean> }
export interface JobBranch { name: string; area: string; address: string }
export const JOB_BRANCH_INFO: JobBranch[]
export const JOB_BRANCHES: string[]
export function jobBranch(name?: string): JobBranch | undefined
export const RESUME_MIME: string[]
export const JOB_POSITIONS: string[]
export const CANDIDATE_TYPES: { id: 'INTERNSHIP' | 'FRESHER' | 'EXPERIENCED'; label: string }[]
export function candidateTypeLabel(id?: string): string
export function istNowLocal(now?: number): string
export function applicationProblems(a: Record<string, unknown>, now?: number): Record<string, string>
export function formOpen(f: Pick<DocForm, 'status' | 'expiresOn'>, today: string): boolean
