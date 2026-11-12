/**
 * IT dashboard → Add users from a sheet → Google Sheets link: the server downloads the sheet as .xlsx (the browser
 * can't — Google doesn't allow it from other sites) and hands it back to be checked in the preview. IT Support / Super
 * Admin only; only docs.google.com spreadsheet links; nothing is kept on the server.
 */
import { googleSheetId } from '../supabase/user-sheet-rules.mjs'
import { crmUser } from './users.mjs'

const MAX_BYTES = 10 * 1048576

export async function handleUserSheet(env, authorization, body) {
  const me = await crmUser(env, authorization).catch(() => null)
  if (!me) return { status: 401, body: { success: false, message: 'Sign in again.' } }
  if (!me.roles.some((r) => r === 'it' || r === 'superadmin')) return { status: 403, body: { success: false, message: 'Adding users from a sheet is for IT Support and Super Admin.' } }
  const id = googleSheetId(body?.url)
  if (!id) return { status: 422, body: { success: false, message: 'Paste a Google Sheets link (https://docs.google.com/spreadsheets/d/…).' } }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: 'follow', signal: ctrl.signal })
    const type = res.headers.get('content-type') ?? ''
    // a sheet that isn't shared answers with Google's sign-in page (HTML) instead of the file
    if (!res.ok || !/spreadsheetml|octet-stream/.test(type)) {
      return { status: 422, body: { success: false, message: 'Google did not give the sheet — in Google Sheets press Share → General access → "Anyone with the link" (Viewer), then try again. Or download it as .xlsx and choose the file.' } }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES) return { status: 413, body: { success: false, message: 'The sheet is larger than 10 MB.' } }
    return { status: 200, body: { success: true, xlsx: buf.toString('base64') } }
  } catch (e) {
    return { status: 502, body: { success: false, message: e.name === 'AbortError' ? 'Google did not answer in time — try again.' : `Could not reach Google: ${e.message}` } }
  } finally { clearTimeout(t) }
}
