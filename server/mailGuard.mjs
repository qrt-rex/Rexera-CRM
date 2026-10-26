// Who may make the live server send an email. Without these checks anyone on the internet could use the company's
// mail server: reset "links" to any website, "login codes" with any text, client emails to anyone.
//  * login code: only to the person who just signed in (their Supabase sign-in comes with the request), 6 digits only;
//  * password reset: with Supabase the CRM uses Supabase's own reset email, so this server never sends one; without
//    Supabase (browser-only CRM) the link must be this CRM's own /reset-password page;
//  * client email: only CRM staff who are signed in (when the CRM signs in with Supabase).
// `cloud` = the server can check sign-ins (SUPABASE_URL + SUPABASE_SECRET_KEY set).

const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(s)
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const deny = (status, message) => ({ status, message })

/** { email, code } — `authEmail` = the email of the Supabase sign-in sent with the request (null if none). */
export function checkOtpRequest(body, { cloud, authEmail }) {
  const email = String(body?.email ?? '').trim()
  if (!isEmail(email)) return deny(400, 'A valid email is required.')
  if (!/^\d{6}$/.test(String(body?.code ?? ''))) return deny(400, 'The code must be 6 digits.')
  if (cloud) {
    if (!authEmail) return deny(401, 'Sign in again.')
    if (authEmail.toLowerCase() !== email.toLowerCase()) return deny(403, 'A login code can only be sent to the account that is signing in.')
  }
  return null
}

/** { email, resetLink } — `origins` = this CRM's own addresses (APP_URL, the request's host). */
export function checkResetRequest(body, { cloud, origins }) {
  if (cloud) return deny(410, 'Password resets are sent by Supabase — use “Forgot password?” on the sign-in page.')
  const email = String(body?.email ?? '').trim()
  if (!isEmail(email)) return deny(400, 'A valid email is required.')
  let url
  try { url = new URL(String(body?.resetLink ?? '')) } catch { return deny(400, 'Bad reset link.') }
  if (!origins.includes(url.origin) || url.pathname !== '/reset-password') return deny(400, 'The reset link must point to this CRM’s own reset page.')
  return null
}

/** Client emails: staff only when sign-ins can be checked. */
export const checkClientSender = ({ cloud, staff }) => (cloud && !staff ? deny(401, 'Sign in to the CRM to email clients.') : null)
