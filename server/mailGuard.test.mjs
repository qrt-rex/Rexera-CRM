// node server/mailGuard.test.mjs — nobody can use the company's mail server for phishing or spam
import assert from 'node:assert/strict'
import { checkClientSender, checkOtpRequest, checkResetRequest, escapeHtml } from './mailGuard.mjs'

// login codes: 6 digits, only to the person signing in
assert.equal(checkOtpRequest({ email: 'a@x.in', code: '123456' }, { cloud: true, authEmail: 'A@x.in' }), null)
assert.equal(checkOtpRequest({ email: 'a@x.in', code: '123456' }, { cloud: true, authEmail: null }).status, 401, 'no sign-in: refused')
assert.equal(checkOtpRequest({ email: 'victim@y.in', code: '123456' }, { cloud: true, authEmail: 'a@x.in' }).status, 403, 'never to someone else')
assert.equal(checkOtpRequest({ email: 'a@x.in', code: 'Your account is locked, visit evil.test' }, { cloud: true, authEmail: 'a@x.in' }).status, 400, 'no text in place of the code')
assert.equal(checkOtpRequest({ email: 'not-an-email', code: '123456' }, { cloud: false }).status, 400)
assert.equal(checkOtpRequest({ email: 'a@x.in', code: '123456' }, { cloud: false }), null, 'browser-only CRM: no sign-in to check')

// password reset links: never from the live (Supabase) server; otherwise only to this CRM's own page
assert.equal(checkResetRequest({ email: 'a@x.in', resetLink: 'https://crm.test/reset-password?t=1' }, { cloud: true, origins: ['https://crm.test'] }).status, 410)
assert.equal(checkResetRequest({ email: 'a@x.in', resetLink: 'https://crm.test/reset-password?t=1' }, { cloud: false, origins: ['https://crm.test'] }), null)
assert.equal(checkResetRequest({ email: 'a@x.in', resetLink: 'https://evil.test/reset-password' }, { cloud: false, origins: ['https://crm.test'] }).status, 400, 'no link to another website')
assert.equal(checkResetRequest({ email: 'a@x.in', resetLink: 'https://crm.test/login' }, { cloud: false, origins: ['https://crm.test'] }).status, 400)
assert.equal(checkResetRequest({ email: 'a@x.in', resetLink: 'javascript:alert(1)' }, { cloud: false, origins: ['https://crm.test'] }).status, 400)

// client emails: signed-in staff only
assert.equal(checkClientSender({ cloud: true, staff: false }).status, 401)
assert.equal(checkClientSender({ cloud: true, staff: true }), null)
assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;')
console.log('✓ mail guard: login codes only to the person signing in, no outside reset links, client emails by staff only')
