export type MessageStageId = 'WELCOME' | 'ACCOUNT_CLEARED' | 'LEGAL_CLEARED' | 'DOCUMENTS' | 'STAGE_UPDATE' | 'SUBMITTED' | 'COMPLETED' | 'PAYMENT_REMINDER' | 'GENERAL'
export type Channel = 'EMAIL' | 'WHATSAPP'
export type MessageStatus = 'SENT' | 'MANUAL' | 'FAILED' | 'NOT_CONFIGURED'
export interface MessageStage { id: MessageStageId; label: string; desc: string; teams: string[]; on: 'any' | 'booking' }
export interface MessageRecord { kind: 'booking' | 'entry'; status: string; stage?: number; holdFrom?: string; ownerId?: string; teamLeadId?: string }
export interface MessageTemplate { subject: string; email: string; whatsapp: string }
export const MESSAGE_STAGES: MessageStage[]
export function stageOf(id: string): MessageStage | undefined
export const CHANNELS: Record<Channel, string>
export const MESSAGE_STATUS: Record<MessageStatus, { label: string; tone: 'green' | 'blue' | 'red' | 'amber' }>
export const DUPLICATE_WINDOW_MS: number
export function stageClosed(stageId: string, rec: MessageRecord): string | null
export function stageDenied(stageId: string, roles: string[], userId: string, rec: MessageRecord): string | null
export function stagesFor(roles: string[], userId: string, rec: MessageRecord): MessageStage[]
export function canEditTemplates(roles: string[]): boolean
export const PLACEHOLDERS: [string, string][]
export const DEFAULT_TEMPLATES: Record<MessageStageId, MessageTemplate>
export function templatesWith(saved?: Partial<Record<string, Partial<MessageTemplate>>>): Record<MessageStageId, MessageTemplate>
export function fillMessage(text: string, vars: Record<string, string | number | undefined>): string
export function leftovers(text: string): string[]
export const WHATSAPP_UPDATE_VARS: string[]
export function oneLine(s: string): string
export function messageProblem(m: { stage?: string; channel?: string; subject?: string; body?: string; bookingId?: string; clientEntryId?: string }): string | null
