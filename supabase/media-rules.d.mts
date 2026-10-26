import type { MediaItem, MediaType, MediaWork } from '../src/lib/types'

export type MediaWorkShown = MediaWork | 'LATE'
type Tone = 'green' | 'gray' | 'amber' | 'red' | 'violet'
export const MEDIA_TYPES: { id: MediaType; label: string }[]
export function mediaTypeLabel(id: string): string
export const MEDIA_FILE_TYPES: Record<string, string>
export const MEDIA_MAX_BYTES: number
export const MEDIA_ACCEPT: string
export function mediaFileType(name: string, declaredType: string): string | null
export function mediaFileProblem(name: string, declaredType: string, size: number): string | null
export const UPLOAD_STATUS: Record<'UPLOADED' | 'NOT_UPLOADED', { label: string; tone: Tone }>
export const WORK_STATUS: Record<MediaWorkShown, { label: string; tone: Tone }>
export function uploadStatus(m: Pick<MediaItem, 'files'>): 'UPLOADED' | 'NOT_UPLOADED'
export function mediaDeadline(m: Pick<MediaItem, 'assignDate' | 'assignTime'>): Date | null
export function workStatus(m: Pick<MediaItem, 'workStatus' | 'assignDate' | 'assignTime'>, now?: Date): MediaWorkShown
export function mediaProblems(m: Partial<MediaItem>, opts?: { submit?: boolean }): Record<string, string>
export function isLive(m: Pick<MediaItem, 'submitted' | 'files'>): boolean
export function forClient(m: Pick<MediaItem, 'submitted' | 'files' | 'external' | 'clientBookingIds'>, bookingIds: string[]): boolean
