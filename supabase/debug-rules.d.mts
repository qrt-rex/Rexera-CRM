export type ErrorSource = 'browser' | 'save' | 'server' | 'sync'
export interface Diagnosis { code: string; title: string; diagnosis: string; fix: string; auto: string | null }
export const SOURCES: ErrorSource[]
export const RULES: { code: string; test: RegExp; title: string; diagnosis: string; fix: string; auto?: string }[]
export function diagnose(message: unknown): Diagnosis
export function normalize(message: unknown): string
export function placeOf(path: unknown): string
export function errorKey(source: string, message: unknown, place: unknown): string
export function isNoise(message: unknown, file?: string): boolean
export interface ErrorRecord {
  p_key: string; p_source: ErrorSource; p_code: string; p_title: string; p_message: string; p_detail: string | null; p_place: string | null
  p_user: string | null; p_diagnosis: string; p_fix: string; p_auto_fix: string | null; p_status: 'open' | 'auto_fixed'; p_count: number
}
export function toRecord(report: { source?: string; message?: unknown; detail?: unknown; place?: unknown; autoFixed?: unknown; count?: unknown }, userId?: string | null): ErrorRecord | null
