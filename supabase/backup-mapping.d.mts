import type { DB } from '../src/lib/types'

export type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>
export declare function mapAll(backup: { db: DB; imports?: unknown[] }): Tables
export declare function rowsToDb(tables: Tables): { db: DB; imports: unknown[] }
export declare function normalizeRow(r: Row): Row
export declare const ORDER: [string, string][]
export declare const APPEND_ONLY: string[]
