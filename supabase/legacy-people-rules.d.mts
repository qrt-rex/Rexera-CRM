import type { BookingStatus, DB, User } from '../src/lib/types'

export const OPS_STATUSES: BookingStatus[]
export function rolesOf(u: User | undefined | null): string[]
export function live(u: User | undefined | null): u is User
export function oldKey(v: unknown): string

export interface People {
  byId: Map<string, User>
  follow(u: User | undefined): User | undefined
  accountOf(k: unknown): User | undefined
  accountByEmail(e: string | null | undefined): User | undefined
  byOldId(v: unknown): User | undefined
  byEmail(e: string | null | undefined): User | undefined
  byName(n: string | null | undefined): User | undefined
  ownerOf(r: Record<string, string | null> | undefined): User | undefined
  manager(): User | undefined
}
export function makePeople(users: User[], map?: Record<string, string>): People
export function placeAssignee(status: BookingStatus, person: User | undefined): { opsMemberId?: string; adminId?: string; status?: BookingStatus; holdFrom?: BookingStatus } | null
export function teamLeadFor(owner: User | undefined, manager: User | undefined, byId: Map<string, User>): string | undefined

export interface Change { kind: 'owner' | 'ops' | 'admin' | 'teamlead' | 'lead' | 'history'; record: 'booking' | 'lead' | 'notice' | 'invoice'; id: string; field: string; from: unknown; to: unknown }
export function realign(db: DB, map?: Record<string, string>, opts?: { apply?: boolean }): Change[]

export interface PersonRow {
  oldId: string; account?: User; owned: number; ops: number; leads: number
  name: string; email: string; oldRole: string; mappedTo?: string; nowId?: string
  state: 'ok' | 'inactive' | 'unknown' | 'role' | 'no-password'
  suggestion?: { userId: string; why: string }
}
export function peopleRows(db: DB, map?: Record<string, string>): PersonRow[]
export function mapProblem(map: Record<string, string>, users: User[]): string | null
