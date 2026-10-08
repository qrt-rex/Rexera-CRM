// Branded email to a client (Operation team / Admin → client). One file shared by server.mjs, the Vite dev relay,
// the Supabase send-email function and the CRM's preview, so the preview is exactly what the client receives.
// Everything comes in as plain text and is escaped here: no HTML from the browser ever reaches the email.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const isEmail = (s) => typeof s === 'string' && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(s) && s.length <= 254
const str = (v, max) => typeof v === 'string' && v.length <= max

export const CLIENT_EMAIL_LIMITS = { subject: 200, message: 6000, details: 12, cc: 3, steps: 12 }

/** Returns what is wrong with a client email request, or null when it can be sent. */
export function checkClientEmail(p) {
  const L = CLIENT_EMAIL_LIMITS
  if (!p || typeof p !== 'object') return 'Bad request.'
  if (!isEmail(p.to)) return 'Enter a valid client email address.'
  if (p.cc != null && (!Array.isArray(p.cc) || p.cc.length > L.cc || !p.cc.every(isEmail))) return `CC: up to ${L.cc} valid email addresses.`
  if (p.replyTo != null && p.replyTo !== '' && !isEmail(p.replyTo)) return 'Reply-to must be an email address.'
  if (!str(p.subject, L.subject) || p.subject.trim().length < 3) return 'Write a subject (3–200 characters).'
  if (!str(p.message, L.message) || !p.message.trim()) return 'Write the message (up to 6000 characters).'
  if (p.heading != null && !str(p.heading, 200)) return 'Heading is too long.'
  if (p.details != null && (!Array.isArray(p.details) || p.details.length > L.details || !p.details.every((d) => Array.isArray(d) && str(d[0], 60) && str(d[1], 300)))) return 'Too many or too long file details.'
  if (p.steps != null && (!Array.isArray(p.steps) || p.steps.length > L.steps || !p.steps.every((s) => s && str(s.label, 80) && ['done', 'current', 'todo'].includes(s.state)))) return 'Bad progress tracker.'
  const s = p.sender
  if (!s || !str(s.name, 80) || !s.name.trim() || (s.role != null && !str(s.role, 60)) || (s.phone != null && !str(s.phone, 20)) || (s.email != null && s.email !== '' && !isEmail(s.email))) return 'Sender details are missing.'
  if (p.company != null && !str(p.company, 120)) return 'Company name is too long.'
  return null
}

/** Blank-line separated paragraphs; a paragraph whose lines all start with •, - or * becomes a bullet list. */
function blocks(message) {
  return message.replace(/\r\n/g, '\n').trim().split(/\n{2,}/).map((b) => {
    const lines = b.split('\n').map((l) => l.trimEnd()).filter(Boolean)
    const bullets = lines.length > 0 && lines.every((l) => /^\s*[•\-*]\s+/.test(l))
    return bullets ? { list: lines.map((l) => l.replace(/^\s*[•\-*]\s+/, '')) } : { text: lines.join('\n') }
  })
}

const NAVY = '#2E3A8C', ORANGE = '#F47B20', INK = '#1F2937', MUTE = '#6B7280', LINE = '#E5E7EB', SOFT = '#F5F7FB', GREEN = '#0E9F6E'
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** { html, text } for a client email. Input: { subject, heading?, message, details?, steps?, sender, company? } */
export function renderClientEmail(p) {
  const company = p.company || 'Rexera'
  const heading = p.heading || p.subject
  const s = p.sender || {}
  const body = blocks(p.message || '').map((b) => b.list
    ? `<ul style="margin:0 0 16px;padding-left:20px;color:${INK};font-size:15px;line-height:1.7">${b.list.map((li) => `<li style="margin:0 0 4px">${esc(li)}</li>`).join('')}</ul>`
    : `<p style="margin:0 0 16px;color:${INK};font-size:15px;line-height:1.7">${esc(b.text).replace(/\n/g, '<br>')}</p>`).join('')
  const details = (p.details || []).filter((d) => d[1])
  const detailsHtml = details.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 22px;background:${SOFT};border:1px solid ${LINE};border-radius:12px">
      ${details.map(([k, v], i) => `<tr>
        <td style="padding:10px 16px;${i ? `border-top:1px solid ${LINE};` : ''}color:${MUTE};font-size:13px;width:38%;vertical-align:top">${esc(k)}</td>
        <td style="padding:10px 16px;${i ? `border-top:1px solid ${LINE};` : ''}color:${INK};font-size:14px;font-weight:600;vertical-align:top">${esc(v)}</td></tr>`).join('')}
    </table>` : ''
  const steps = p.steps || []
  const stepsHtml = steps.length ? `
    <p style="margin:6px 0 10px;color:${NAVY};font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">Your file progress</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px">
      ${steps.map((st, i) => {
        const dot = st.state === 'done' ? GREEN : st.state === 'current' ? ORANGE : '#CBD5E1'
        const mark = st.state === 'done' ? '&#10003;' : String(i + 1)
        const label = st.state === 'current' ? `<b style="color:${INK}">${esc(st.label)}</b> <span style="color:${ORANGE};font-size:12px;font-weight:700">&nbsp;IN PROGRESS</span>` : `<span style="color:${st.state === 'done' ? INK : MUTE}">${esc(st.label)}</span>`
        return `<tr><td style="width:30px;padding:4px 0;vertical-align:middle">
          <div style="width:22px;height:22px;border-radius:11px;background:${dot};color:#fff;font-size:11px;font-weight:700;line-height:22px;text-align:center">${mark}</div></td>
          <td style="padding:4px 0 4px 6px;font-size:14px;vertical-align:middle">${label}</td></tr>`
      }).join('')}
    </table>` : ''
  const contact = [s.phone, s.email].filter(Boolean).map(esc).join(' &middot; ')
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.subject)}</title></head>
<body style="margin:0;padding:0;background:#EEF1F7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F7;padding:24px 12px;font-family:${FONT}">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${LINE}">
    <tr><td style="background:${NAVY};padding:22px 28px">
      <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:.18em">REXERA</span>
      <span style="display:block;color:#C7CDF0;font-size:12px;margin-top:2px">${esc(company)}</span>
    </td></tr>
    <tr><td style="height:4px;background:${ORANGE};font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:28px 28px 8px">
      <h1 style="margin:0 0 18px;color:${NAVY};font-size:21px;line-height:1.35">${esc(heading)}</h1>
      ${body}
      ${detailsHtml}
      ${stepsHtml}
      <p style="margin:0 0 4px;color:${INK};font-size:15px">Warm regards,</p>
      <p style="margin:0;color:${INK};font-size:15px;font-weight:700">${esc(s.name)}</p>
      <p style="margin:2px 0 0;color:${MUTE};font-size:13px">${esc([s.role, company].filter(Boolean).join(' · '))}</p>
      ${contact ? `<p style="margin:2px 0 0;color:${MUTE};font-size:13px">${contact}</p>` : ''}
    </td></tr>
    <tr><td style="padding:20px 28px 24px">
      <p style="margin:0;padding-top:16px;border-top:1px solid ${LINE};color:#9CA3AF;font-size:12px;line-height:1.6">
        You are receiving this email because you are a client of ${esc(company.replace(/\.+$/, ''))}. Reply to this email to reach your case manager directly.
      </p>
    </td></tr>
  </table>
</td></tr></table></body></html>`

  const text = [
    heading, '',
    p.message.trim(), '',
    ...(details.length ? [...details.map(([k, v]) => `${k}: ${v}`), ''] : []),
    ...(steps.length ? ['Your file progress:', ...steps.map((st, i) => `${st.state === 'done' ? '[x]' : st.state === 'current' ? '[>]' : '[ ]'} ${i + 1}. ${st.label}`), ''] : []),
    'Warm regards,', s.name, [s.role, company].filter(Boolean).join(' · '), [s.phone, s.email].filter(Boolean).join(' · '),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim()

  return { html, text }
}
