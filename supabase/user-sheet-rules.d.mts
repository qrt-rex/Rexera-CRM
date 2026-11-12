import type { Role, User } from '../src/lib/types'
export const PASSWORD_RULE: RegExp
export const PASSWORD_HINT: string
export const ALIASES: [string, string, string[]][]
export function titleCase(s: string): string
export function rolesFrom(dash: string, role: string): { roles: Role[]; skip?: string }
export interface PlanRow {
  line: string; name: string; email: string; alsoEmails: string[]
  roles: Role[]; designation: string; department: string
  branchKey?: string; director?: boolean
  password: string; action: 'create' | 'update' | 'skip'; existingId?: string
  problems: string[]; notes: string[]
}
export interface NewBranch { key: string; code: string; name: string }
export interface Plan { rows: PlanRow[]; branches: Map<string, string>; newBranches: NewBranch[]; remove: User[]; keepNote: string[] }
export function planUsers(sheets: { name: string; rows: unknown[][] }[], ctx: { users: User[]; branches: { id: string; code?: string; name: string; city: string }[]; me: Pick<User, 'id' | 'role' | 'extraRoles'> }): Plan
export function googleSheetId(url: string): string | null
