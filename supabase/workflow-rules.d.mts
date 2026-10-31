import type { AdminStageId, AdminWorkStatus, Booking, Role, Scheme, WorkflowSettings } from '../src/lib/types'

export const ADMIN_STAGES: { id: AdminStageId; label: string; short: string }[]
export const ADMIN_WORK_STATUSES: { id: AdminWorkStatus; label: string; tone: 'gray' | 'blue' | 'amber' | 'violet' | 'cyan' | 'green' | 'red' }[]
export const ADMIN_DONE: AdminWorkStatus[]
export function adminStatusLabel(s: AdminWorkStatus): string
export const ACTIVE_FILE_STATUSES: Booking['status'][]
export const CLOSED_FILE_STATUSES: Booking['status'][]
export const DEFAULT_WORKFLOW: WorkflowSettings
export function workflowSettings(w?: Partial<WorkflowSettings>): WorkflowSettings
export function istToday(now?: number): string
export function addDays(ymd: string, n: number): string
export function daysBetween(a: string, b: string): number
export function nextAfter(from: string, every: number, today: string): string
export function followUpDue(b: Pick<Booking, 'status' | 'followUp'>, today: string): boolean
export function precheckPending(b: Pick<Booking, 'status' | 'adminWork'>): boolean
export function precheckDue(b: Pick<Booking, 'status' | 'adminWork'>, today: string): boolean
export type SchemeState = 'UPCOMING' | 'ACTIVE' | 'EXPIRED' | 'INACTIVE' | 'NO_DATES'
export function schemeState(s: Pick<Scheme, 'active' | 'startDate' | 'endDate'>, today: string): SchemeState
export function schemeDuration(s: Pick<Scheme, 'startDate' | 'endDate'>): number | null
export function schemeDaysLeft(s: Pick<Scheme, 'endDate'>, today: string): number | null
export function schemeAlertDue(s: Pick<Scheme, 'active' | 'endDate'>, today: string): boolean
export interface ProgressCell { total: number; done: number; overdue: number; byStatus: Partial<Record<AdminWorkStatus, number>>; ids: string[]; updatedAt: string }
export interface ProgressRow { userId: string; stages: Record<AdminStageId, ProgressCell>; total: number; done: number; overdue: number; pct: number | null }
export function adminProgress(bookings: Pick<Booking, 'id' | 'status' | 'adminId' | 'adminWork'>[], today: string): ProgressRow[]
export function fillTemplate(text: string, vars: Record<string, string | number | undefined>): string
export const WELCOME_PLACEHOLDERS: string[]
export const WHATSAPP_WELCOME_VARS: string[]
export const WHATSAPP_INVOICE_VARS: string[]
export const WHATSAPP_FORM_VARS: string[]
export const WHATSAPP_NOTIFY_VARS: string[]
export function templateValues(names: string[], vars: Record<string, string | number | undefined>): string[]
export const WHATSAPP_NOTIFY_ROLES: string[]
export function mayWhatsappClient(roles: string[] | undefined): boolean
export const MAX_WHATSAPP_MESSAGE: number
export function whatsappLink(mobile: string | undefined | null, text: string): string
export type { Role }
