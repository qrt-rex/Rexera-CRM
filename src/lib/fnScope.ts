import { createContext, useContext } from 'react'
import { Download, FilePlus, FilePlus2, Pencil, PencilLine, Plus, Send, SquarePen, Trash, Trash2, Upload, UserPlus, type LucideIcon } from 'lucide-react'
import type { FnAction } from './types'

/**
 * Function-level access (IT Support → Access Control): inside a module page, every Button / IconButton works out what
 * it does (delete, export, download, create, edit, approve, send) from its label and icon, and is disabled when that
 * function is switched off for the person. Exports and downloads are also stopped where the file is made (fnGate).
 * The database checks the same functions for deletes and new records (app.fn_allowed).
 */
export interface FnScope { module: string; allowed: (a: FnAction) => boolean }
export const FnScopeCtx = createContext<FnScope | null>(null)
export const useFnScope = () => useContext(FnScopeCtx)

const ICONS = new Map<unknown, FnAction>([
  [Trash2, 'delete'], [Trash, 'delete'], [Download, 'download'], [Pencil, 'edit'], [PencilLine, 'edit'], [SquarePen, 'edit'],
  [Plus, 'create'], [UserPlus, 'create'], [FilePlus, 'create'], [FilePlus2, 'create'], [Upload, 'create'], [Send, 'send'],
])
/** What a button does, from its words first, then its icon (null = not a controlled function: open, close, save…). */
export function inferAction(text: string, icon?: LucideIcon): FnAction | null {
  const t = text.trim()
  if (/\b(delete|remove|purge)\b/i.test(t)) return 'delete'
  if (/\b(export|csv|excel)\b/i.test(t)) return 'export'
  if (/\bdownload\b/i.test(t)) return 'download'
  if (/\bapprove\b/i.test(t)) return 'approve'
  if (/^(send|share|resend)\b|\bwhatsapp\b|^e-?mail\b|send (from|on|to|offer|joining|letter|message|email|whatsapp)/i.test(t)) return 'send'
  if (/^(edit|rename)\b/i.test(t)) return 'edit'
  if (/^\+?\s*(add|new|create|upload)\b/i.test(t)) return 'create'
  return icon ? ICONS.get(icon) ?? null : null
}
/** A button's words: its text children, aria-label or title. */
export function textOf(children: unknown, ...labels: unknown[]): string {
  const parts: string[] = []
  const walk = (c: unknown) => { if (typeof c === 'string' || typeof c === 'number') parts.push(String(c)); else if (Array.isArray(c)) c.forEach(walk) }
  walk(children)
  for (const l of labels) if (typeof l === 'string') parts.push(l)
  return parts.join(' ')
}
/** The function this button would use, when it is switched off for the person in this module (else null). */
export function useBlocked(text: string, icon?: LucideIcon): FnAction | null {
  const scope = useFnScope()
  if (!scope) return null
  const a = inferAction(text, icon)
  return a && !scope.allowed(a) ? a : null
}

export { DENIED_EVENT, deniedText, fnGate, setFnGate } from './fnGate'
