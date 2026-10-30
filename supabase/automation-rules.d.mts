import type { AutomationAction, AutomationCondition, AutomationRule } from '../src/lib/types'

type Opt = { id: string; label: string }
export type Facts = { values: Record<string, unknown>; text: Record<string, string | number> }
export type RuleLike = Partial<Pick<AutomationRule, 'name' | 'trigger' | 'entity' | 'match' | 'conditions' | 'actions' | 'repeatDays' | 'id'>>
export interface Template { name: string; trigger: string; entity?: string; repeatDays?: number; conditions: AutomationCondition[]; actions: AutomationAction[] }
export const TRIGGERS: { id: string; label: string; entity?: string; schedule?: boolean }[]
export const ENTITY_LABELS: { booking: string; lead: string; clientEntry: string; invoice: string; leave: string; user: string }
export function triggerOf(id: string | undefined): { id: string; label: string; entity?: string; schedule?: boolean } | undefined
export function ruleEntity(r: RuleLike): string
export const OPS: Record<'select' | 'text' | 'number' | 'bool', Opt[]>
export function opsFor(type: string): Opt[]
export const RECIPIENTS: { id: string; label: string; entity?: string }[]
export const ACTIONS: { id: AutomationAction['type']; label: string; entity?: string }[]
export const REPEAT: { id: number; label: string }[]
export const MAX_PER_RUN: number
export function testCondition(c: AutomationCondition, facts: Facts, type: string): boolean
export function ruleMatches(rule: RuleLike, facts: Facts, fields: Record<string, { type: string }>): boolean
export function fillText(text: string | undefined, facts: Facts): string
export function scheduleRunId(rule: { id: string; repeatDays?: number }, recordId: string, today: string): string
export function ruleProblems(rule: RuleLike, fieldsByEntity: Record<string, Record<string, { type: string }>>): string[]
export const BUILTINS: { key: string; name: string; where: string; desc: string }[]
export function builtinId(key: string): string
export const TEMPLATES: Template[]
