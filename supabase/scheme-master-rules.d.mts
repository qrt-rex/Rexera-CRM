import type { SchemeMaster } from '../src/lib/types'
export function normName(s: string | undefined | null): string
export function findMaster(master: SchemeMaster[], name: string | undefined | null): SchemeMaster | undefined
export type MasterSource = { kind: 'service' | 'salesKit' | 'scheme' | 'checker'; items: { id: string; name: string; category?: string; active?: boolean }[] }
export function buildMaster(existing: SchemeMaster[], sources: MasterSource[], newId: () => string, now: string): { master: SchemeMaster[]; added: number; linked: number }
export type MasterKind = 'service' | 'salesKit' | 'scheme' | 'checker'
export function linkNew(master: SchemeMaster[], kind: MasterKind, item: { id: string; name: string; category?: string }, newId: () => string, now: string): SchemeMaster | null
export function linkedMaster(master: SchemeMaster[], kind: MasterKind, id: string): SchemeMaster | undefined
export function renameInTitle(title: string, oldName: string, newName: string): string
export function masterProblem(v: { name: string; category: string }, master: SchemeMaster[], id?: string): string | null
