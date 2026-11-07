import assert from 'node:assert/strict'
import { diagnose, errorKey, isNoise, normalize, placeOf, toRecord } from './debug-rules.mjs'

// diagnoses
assert.equal(diagnose('Failed to fetch dynamically imported module: https://crm/assets/Leads-abc.js').code, 'new-version')
assert.ok(diagnose('Loading chunk 12 failed').auto, 'a new version is fixed by reloading')
assert.equal(diagnose('new row violates row-level security policy for table "bookings"').code, 'access-denied')
assert.equal(diagnose('relation "public.app_errors" does not exist').code, 'database-update-missing')
assert.equal(diagnose('Could not find the \'admin_ids\' column of \'bookings\' in the schema cache').code, 'database-update-missing')
assert.equal(diagnose('duplicate key value violates unique constraint "bookings_pkey"').code, 'duplicate')
assert.equal(diagnose('insert or update on table "booking_payments" violates foreign key constraint "x"').code, 'data-rule')
assert.equal(diagnose('Wrong signature — the secret on the two servers is different.').code, 'sync-wrong-secret')
assert.equal(diagnose('Could not reach the old CRM: getaddrinfo ENOTFOUND crm.rexera.in').code, 'connection')
assert.equal(diagnose('File not found.').code, 'sync-file-missing')
assert.equal(diagnose("Cannot read properties of undefined (reading 'name')").code, 'code-error')
assert.equal(diagnose('JWT expired').code, 'sign-in-expired')
assert.equal(diagnose('something odd').code, 'unknown')

// the same error groups under one key; different pages / kinds don't
assert.equal(normalize('Payment 12,500 for lg-b-1201 failed at https://x.y/z'), 'Payment # for <id> failed at <url>')
assert.equal(placeOf('/bookings/lg-b-1201?tab=docs'), '/bookings/:id')
assert.equal(placeOf('/dashboard/it'), '/dashboard/it')
assert.equal(errorKey('browser', 'Cannot read x of lg-b-1', '/bookings/lg-b-1'), errorKey('browser', 'Cannot read x of lg-b-2', '/bookings/lg-b-2'))
assert.notEqual(errorKey('browser', 'Cannot read x', '/leads'), errorKey('browser', 'Cannot read x', '/bookings'))
assert.notEqual(errorKey('save', 'Cannot read x', '/leads'), errorKey('browser', 'Cannot read x', '/leads'))

// noise is not logged; records are checked and sized
assert.ok(isNoise('ResizeObserver loop completed with undelivered notifications.'))
assert.ok(isNoise('x', 'chrome-extension://abc/content.js'))
assert.equal(toRecord({ message: '   ' }), null)
const r = toRecord({ source: 'evil', message: 'Loading chunk 3 failed', place: '/leads', autoFixed: 'Reloaded', count: 99999 }, 'u-1')
assert.equal(r.p_source, 'browser'); assert.equal(r.p_status, 'auto_fixed'); assert.equal(r.p_count, 1000); assert.equal(r.p_user, 'u-1')
assert.equal(toRecord({ source: 'save', message: 'permission denied for table x' }).p_status, 'open')

console.log('✓ auto-debug: diagnoses, grouping keys, noise filter, report checks')
