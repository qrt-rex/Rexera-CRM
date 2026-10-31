import type { ClientDocItem, ClientUpload, Milestone } from '../src/lib/types'

export type ClientDocState = 'PENDING_UPLOAD' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'RESUBMISSION'
export const CLIENT_DOC_STATUS: Record<ClientDocState, { label: string; tone: 'amber' | 'blue' | 'violet' | 'green' | 'red' }>
export function latestUpload(uploads: Pick<ClientUpload, 'category' | 'at'>[] | undefined, cat: string): ClientUpload | null
export function docStatus(item: ClientDocItem | undefined, uploads: Pick<ClientUpload, 'category' | 'at'>[] | undefined, cat: string): ClientDocState | null
export function clientMayUpload(status: ClientDocState | null): boolean
export function reviewSteps(status: ClientDocState | null): ('START' | 'APPROVE' | 'REJECT')[]
export function projectProgress(milestones: Pick<Milestone, 'status' | 'visible' | 'tasks'>[] | undefined, onlyVisible?: boolean): number | null
export const PORTAL_LOGIN_ROLES: string[]
export function mayManagePortalLogins(roles: string[] | undefined): boolean
export function portalPasswordProblem(pw: unknown, email?: string): string | null
