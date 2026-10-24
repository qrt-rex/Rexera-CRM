import { CLOUD } from './cloud'
import { getSupabase } from './supabase'

/** An error answer from the live server, with its `code` when it sent one (e.g. EMAIL_MISMATCH). */
export class ServerError extends Error {
  constructor(message: string, readonly code?: string) { super(message) }
}

/**
 * POST to the live server with this person's own Supabase sign-in: the server checks who is asking, and keys
 * (Interakt, mail server, Supabase secret) never reach the browser. Needs the live CRM (Supabase).
 */
export async function serverPost<T>(url: string, body: unknown): Promise<T> {
  if (!CLOUD) throw new Error('This works on the live CRM (connected to Supabase).')
  const { data: { session } } = await (await getSupabase()).auth.getSession()
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` }, body: JSON.stringify(body) })
    .catch(() => { throw new Error('The CRM server could not be reached — check the connection and try again.') })
  if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new Error('This copy of the CRM has no server for this.')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ServerError(data.message || `The server answered ${res.status}.`, data.code)
  return data as T
}
