import type { FnAction } from './types'

/**
 * The module page on screen now (set by the route guard), for exports and downloads made outside React — CSV files,
 * uploaded files. No React here, so the shared helpers (format.ts, files.ts) can ask it.
 */
export interface FnGateScope { module: string; allowed: (a: FnAction) => boolean }
let gate: FnGateScope | null = null
export const setFnGate = (g: FnGateScope | null) => { gate = g }
export const DENIED_EVENT = 'rexera-fn-denied'
/** Exports / downloads ask first: false = switched off for this person by IT Support (a message says so). */
export function fnGate(action: FnAction): boolean {
  if (!gate || gate.allowed(action)) return true
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DENIED_EVENT, { detail: action }))
  return false
}
export const deniedText = (a: FnAction) => `You don't have access to ${a === 'view' ? 'this page' : `${a} here`} — IT Support manages access.`
