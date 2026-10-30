/*
 * Rexera website ↔ CRM connector (served by the CRM at /website-connect.js).
 *
 * Add ONE line to every page of rexera.co.in, just before </body>:
 *   <script src="https://rexera-crm.onrender.com/website-connect.js" defer></script>
 * (when the CRM has a WEBSITE_LEAD_KEY set on the server, add it:  data-key="the key")
 *
 * What it does:
 *  1. Every enquiry form with a phone number (Talk to an advisor, Help, Contact …) is ALSO saved as a CRM lead
 *     (source "Website (rexera.co.in)"), shared out by the CRM's lead rules. The site's own email (send_mail.php)
 *     keeps working exactly as before — this only adds a copy for the CRM. A form with data-crm="off" is skipped.
 *  2. A "Client Login" button in the header (next to the Call button) opens the client portal, where clients see
 *     their files' progress, documents and updates. data-login="off" on the script tag leaves it out.
 */
(function () {
  'use strict'
  var me = document.currentScript
  var CRM = 'https://rexera-crm.onrender.com'
  try { if (me && me.src) CRM = new URL(me.src).origin } catch (_) { /* keep the default */ }
  var KEY = (me && me.getAttribute('data-key')) || ''
  var LOGIN = !(me && me.getAttribute('data-login') === 'off')

  // ------------------------------------------------------------------ 1. enquiries → CRM leads
  function sendLead(form) {
    var data = new FormData(form)
    var phone = data.get('phone') || data.get('mobile') || data.get('mobile_number') || data.get('tel')
    if (!phone) return // not an enquiry (search box, newsletter …)
    var body = new URLSearchParams()
    data.forEach(function (v, k) { if (typeof v === 'string' && !/pass|card|cvv|otp/i.test(k)) body.append(k, v.slice(0, 2000)) })
    body.set('page', location.href.split('#')[0] + (form.id ? ' (' + form.id + ')' : ''))
    if (KEY) body.set('key', KEY)
    var url = CRM + '/api/website-lead'
    // a beacon still goes out when the page moves on to a thank-you screen
    var sent = false
    try { sent = navigator.sendBeacon && navigator.sendBeacon(url, body) } catch (_) { sent = false }
    if (!sent) { try { fetch(url, { method: 'POST', body: body, mode: 'no-cors', keepalive: true }) } catch (_) { /* the site's own email still goes */ } }
  }
  document.addEventListener('submit', function (e) {
    var form = e.target
    if (!form || form.tagName !== 'FORM' || form.getAttribute('data-crm') === 'off') return
    // only once per submit, even when the site's own script submits the form again
    var now = Date.now()
    if (form.__crmAt && now - form.__crmAt < 5000) return
    form.__crmAt = now
    try { sendLead(form) } catch (_) { /* never break the site's form */ }
  }, true)

  // ------------------------------------------------------------------ 2. Client Login button
  function addLogin() {
    if (!LOGIN || document.querySelector('[data-rexera-login]')) return
    var a = document.createElement('a')
    a.href = CRM + '/portal'
    a.setAttribute('data-rexera-login', '')
    a.setAttribute('aria-label', 'Client login — see your project progress')
    a.textContent = 'Client Login'
    var actions = document.querySelector('.nav-actions')
    var call = actions && actions.querySelector('.btn-nav-call')
    if (actions) {
      // looks like the Call button next to it, in the outline style
      a.className = call ? call.className : ''
      a.style.cssText = 'background:transparent;border:1.5px solid currentColor;margin-right:8px;white-space:nowrap'
      actions.insertBefore(a, actions.firstChild)
      return
    }
    // pages without the usual header: a small floating button
    a.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9999;padding:10px 16px;border-radius:999px;background:#2E3A8C;color:#fff;font:600 14px/1 system-ui,sans-serif;text-decoration:none;box-shadow:0 6px 20px rgba(46,58,140,.35)'
    document.body.appendChild(a)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLogin)
  else addLogin()
})()
