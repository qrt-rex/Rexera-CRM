// node supabase/media-rules.test.mjs — Digital Media: statuses (Late from the deadline), form checks, files, audience
import assert from 'node:assert/strict'
import { forClient, isLive, mediaFileProblem, mediaProblems, uploadStatus, workStatus } from './media-rules.mjs'

// upload status and work status are separate
assert.equal(uploadStatus({ files: [] }), 'NOT_UPLOADED')
assert.equal(uploadStatus({ files: [{ id: 'media-1' }] }), 'UPLOADED')
const due = { assignDate: '2026-10-26', assignTime: '15:00' }
const before = new Date('2026-10-26T09:29:00Z'), after = new Date('2026-10-26T09:31:00Z') // 15:00 India = 09:30 UTC
assert.equal(workStatus({ ...due, workStatus: 'PENDING' }, before), 'PENDING')
assert.equal(workStatus({ ...due, workStatus: 'PENDING' }, after), 'LATE', 'pending work turns late once the deadline passes')
assert.equal(workStatus({ ...due, workStatus: 'ON_HOLD' }, after), 'ON_HOLD', 'on hold never turns late')
assert.equal(workStatus({ ...due, workStatus: 'COMPLETED' }, after), 'COMPLETED')
assert.equal(workStatus({ assignDate: '2026-10-26', workStatus: 'PENDING' }, new Date('2026-10-26T18:00:00Z')), 'PENDING', 'no time: due at the end of the day in India')
assert.equal(workStatus({ assignDate: '2026-10-26', workStatus: 'PENDING' }, new Date('2026-10-26T18:30:00Z')), 'LATE')
assert.equal(workStatus({ workStatus: 'PENDING' }, after), 'PENDING', 'no date: never late')

// form checks: a draft needs the basics; submitting also needs where it is published
const base = { schemeName: 'Seed Fund', title: 'Diwali flyer', description: '', mediaType: 'FLYER', workStatus: 'PENDING' }
assert.deepEqual(mediaProblems(base), {})
assert.ok(mediaProblems(base, { submit: true }).publication)
assert.deepEqual(mediaProblems({ ...base, internal: true }, { submit: true }), {})
assert.ok(mediaProblems({ ...base, schemeName: ' ' }).schemeName)
assert.ok(mediaProblems({ ...base, mediaType: 'GIF' }).mediaType)
assert.ok(mediaProblems({ ...base, assignTime: '10:00' }).assignDate, 'a time needs a date')

// files
assert.equal(mediaFileProblem('a.mp4', 'video/mp4', 10), null)
assert.equal(mediaFileProblem('a.png', '', 10), null, 'type from the extension when the browser gives none')
assert.match(mediaFileProblem('a.exe', 'application/x-msdownload', 10), /isn't supported/)
assert.match(mediaFileProblem('big.mp4', 'video/mp4', 51 * 1024 * 1024), /50 MB/)

// shown once published and uploaded; external audience
const live = { submitted: true, files: [{ id: 'media-1' }], external: true }
assert.equal(isLive({ submitted: true, files: [] }), false, 'published without a file: nothing to show yet')
assert.equal(forClient(live, ['b1']), true)
assert.equal(forClient({ ...live, clientBookingIds: ['b2'] }, ['b1']), false)
assert.equal(forClient({ ...live, clientBookingIds: ['b2'] }, ['b1', 'b2']), true)
assert.equal(forClient({ ...live, external: false }, ['b1']), false)
console.log('✓ digital media: upload vs work status, Late from the deadline, form checks, files, client audience')
