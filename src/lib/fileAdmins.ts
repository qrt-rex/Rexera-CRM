import type { Booking } from './types'

/**
 * A client file's Admin members: its main Admin (adminId) and the others the Operations Team added (adminIds).
 * Every member works the file like the main Admin — dashboards, actions and access all use these two helpers.
 */
export const fileAdmins = (b: Pick<Booking, 'adminId' | 'adminIds'>): string[] =>
  [...new Set([b.adminId, ...(b.adminIds ?? [])].filter(Boolean) as string[])]
export const isFileAdmin = (b: Pick<Booking, 'adminId' | 'adminIds'>, userId?: string | null) =>
  !!userId && (b.adminId === userId || !!b.adminIds?.includes(userId))
