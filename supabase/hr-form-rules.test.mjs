import assert from 'node:assert/strict'
import {
  analytics, answerProblem, answerProblems, answerText, canFill, canStep, dueSoon, fileProblem, filterRows, formProblems, isAssigned, isOverdue, progressOf, responseRows, statusOf, tidyField,
} from './hr-form-rules.mjs'

// made-up people and forms
const U = (id, name, extra = {}) => ({ id, name, username: id.replace('u-', ''), email: `${id}@example.test`, role: 'sales', extraRoles: [], active: true, department: 'Sales', ...extra })
const users = [
  U('u-a', 'Asha', { branchId: 'br-1' }), U('u-b', 'Bina', { department: 'Accounts', role: 'accounts', branchId: 'br-2' }), U('u-c', 'Chirag', { department: 'HR', role: 'hr' }),
  U('u-x', 'Gone', { active: false }), U('u-d', 'Dev', { department: 'sales', branchId: 'br-2' }),
]
const T = '2026-11-16'

// ---------------------------------------------------------------- fields
assert.deepEqual(tidyField({ id: 'f1', type: 'text', label: '  Name  ', required: 1, placeholder: ' Your name ', options: ['x'], maxSizeMb: 4, minLength: '2', maxLength: '' }),
  { id: 'f1', type: 'text', label: 'Name', required: true, placeholder: 'Your name', minLength: 2 }, 'text keeps only what text uses')
assert.deepEqual(tidyField({ id: 'f2', type: 'checkbox', label: 'Docs', required: false, options: [' A ', '', 'B'], placeholder: 'no' }), { id: 'f2', type: 'checkbox', label: 'Docs', required: false, options: ['A', 'B'] })
assert.deepEqual(tidyField({ id: 'f3', type: 'files', label: 'Proofs', required: true, maxSizeMb: 99, maxFiles: 50, accept: ['pdf', 'zip'] }), { id: 'f3', type: 'files', label: 'Proofs', required: true, maxSizeMb: 25, accept: ['pdf'], maxFiles: 20 }, 'limits capped, unknown formats dropped')
assert.deepEqual(tidyField({ id: 'f4', type: 'image', label: 'Photo', required: false, accept: ['pdf'] }), { id: 'f4', type: 'image', label: 'Photo', required: false, maxSizeMb: 10 }, 'images only for an image field')
assert.equal(tidyField({ id: 'f5', type: 'number', label: 'Age', required: false, min: '18', max: '60', minLength: 3 }).min, 18)

// ---------------------------------------------------------------- publishing
assert.deepEqual(formProblems({ title: '', fields: [] }), ['Give the form a name.', 'Add at least one field.', 'Choose who fills the form (employees, departments, branches or groups).'])
const bad = formProblems({ title: 'X', fields: [{ id: 'a', type: 'select', label: '', options: [] }, { id: 'b', type: 'radio', label: 'R', options: ['Yes', 'yes'] }, { id: 'c', type: 'text', label: 'T', minLength: 5, maxLength: 2, pattern: '[' }], assign: { everyone: true }, deadline: '2026-01-01' }, { today: T })
for (const m of ['Field 1 needs a name.', 'Field 1: add at least one option.', 'R: the options must be different.', 'T: the minimum is more than the maximum.', 'T: the validation pattern is not valid.', 'The deadline is already past.']) assert.ok(bad.includes(m), m)
assert.deepEqual(formProblems({ title: 'Draft', fields: [{ id: 'a', type: 'text', label: 'A' }] }, { forPublish: false }), [], 'a draft needs no assignment')

// ---------------------------------------------------------------- assignment
assert.equal(isAssigned({ assign: { everyone: true } }, users[3]), false, 'never an inactive person')
assert.equal(isAssigned({ assign: { departments: ['Sales'] } }, users[4]), true, 'department matched without case')
assert.equal(isAssigned({ assign: { branchIds: ['br-2'] } }, users[1]), true)
assert.equal(isAssigned({ assign: { roles: ['hr'] } }, users[2]), true)
assert.equal(isAssigned({ assign: { userIds: ['u-b'] } }, users[0]), false)

// ---------------------------------------------------------------- answers
const F = (type, extra = {}) => ({ id: type, type, label: type, required: true, ...extra })
assert.equal(answerProblem(F('text'), '  '), 'text is required.')
assert.equal(answerProblem(F('text', { required: false }), ''), null)
assert.equal(answerProblem(F('text', { minLength: 3 }), 'ab'), 'text: at least 3 characters.')
assert.equal(answerProblem(F('text', { pattern: '[A-Z]{5}[0-9]{4}[A-Z]', patternMessage: 'Bad PAN' }), 'abcde1234f'), 'Bad PAN')
assert.equal(answerProblem(F('text', { pattern: '[A-Z]{5}[0-9]{4}[A-Z]' }), 'ABCDE1234F'), null, 'the whole answer must match')
assert.equal(answerProblem(F('email'), 'a@b'), 'email: enter a valid email address.')
assert.equal(answerProblem(F('phone'), '+91 98765-43210'), null)
assert.equal(answerProblem(F('phone'), '12345'), 'phone: enter a valid phone number (10–15 digits).')
assert.equal(answerProblem(F('number', { min: 1, max: 5 }), 7), 'number: at most 5.')
assert.equal(answerProblem(F('date'), '2026-02-30'), null, 'calendar check left to the date picker')
assert.equal(answerProblem(F('date'), '30/02/2026'), 'date: enter a valid date.')
assert.equal(answerProblem(F('select', { options: ['A', 'B'] }), 'C'), 'select: pick one of the options.')
assert.equal(answerProblem(F('checkbox', { options: ['A', 'B', 'C'], minLength: 2 }), ['A']), 'checkbox: pick at least 2.')
assert.equal(answerProblem(F('checkbox', { options: ['A'] }), []), 'checkbox is required.')
assert.equal(answerProblem(F('employee'), 'u-x', { users }), 'employee: pick an active employee.')
assert.equal(answerProblem(F('employee'), 'u-a', { users }), null)
const pdf = { id: 'hrf-u-a~1', name: 'pan.PDF', type: 'application/pdf', size: 2 * 1048576, at: '' }
assert.equal(answerProblem(F('files', { accept: ['pdf'], maxSizeMb: 5, maxFiles: 2 }), [pdf, pdf]), null)
assert.equal(answerProblem(F('files', { maxFiles: 1 }), [pdf, pdf]), 'files: at most 1 file(s).')
assert.match(fileProblem(F('image'), pdf), /isn't allowed/)
assert.match(fileProblem(F('file', { maxSizeMb: 1 }), pdf), /too large \(max 1 MB\)/)
assert.equal(fileProblem(F('file', { accept: ['word', 'excel'] }), { name: 'x.xlsx', size: 10 }), null)
assert.deepEqual(Object.keys(answerProblems([F('text'), F('email', { required: false })], { email: 'nope' })), ['text', 'email'])
assert.equal(progressOf([F('text'), F('email'), F('date', { required: false })], { text: 'x' }), 50, 'progress counts required fields')
assert.equal(answerText(F('employee'), 'u-a', { users }), 'Asha (a)')
assert.equal(answerText(F('files'), [pdf]), 'pan.PDF')

// ---------------------------------------------------------------- statuses
const form = { id: 'fm1', title: 'Bank details', status: 'PUBLISHED', fields: [F('text')], version: 1, versions: [], assign: { departments: ['Sales'] }, deadline: '2026-11-17', allowDraft: true, reviewerIds: [], createdAt: '2026-11-01T00:00:00Z', publishedAt: '2026-11-01T00:00:00Z' }
const sub = (userId, status, extra = {}) => ({ id: `s-${userId}`, formId: 'fm1', formVersion: 1, userId, status, fields: form.fields, answers: { text: 'x' }, startedAt: '2026-11-10T00:00:00Z', history: [], ...extra })
assert.equal(statusOf(undefined), 'PENDING')
assert.equal(canFill(form, undefined, T), true)
assert.equal(canFill(form, sub('u-a', 'SUBMITTED'), T), false, 'sent: closed for the employee')
assert.equal(canFill({ ...form, deadline: '2026-11-15' }, sub('u-a', 'IN_PROGRESS'), T), false, 'past the deadline')
assert.equal(canFill({ ...form, deadline: '2026-11-15' }, sub('u-a', 'CHANGES_REQUESTED'), T), true, 'a correction can be sent after the deadline')
assert.equal(canFill({ ...form, status: 'UNPUBLISHED' }, sub('u-a', 'CHANGES_REQUESTED'), T), true)
assert.equal(canFill({ ...form, status: 'UNPUBLISHED' }, undefined, T), false)
assert.equal(isOverdue({ ...form, deadline: '2026-11-15' }, undefined, T), true)
assert.equal(isOverdue({ ...form, deadline: '2026-11-15' }, sub('u-a', 'SUBMITTED'), T), false)
assert.ok(canStep('IN_PROGRESS', 'SUBMITTED', false) && !canStep('SUBMITTED', 'APPROVED', false), 'an employee never approves')
assert.ok(canStep('SUBMITTED', 'APPROVED', true) && canStep('UNDER_REVIEW', 'CHANGES_REQUESTED', true) && !canStep('IN_PROGRESS', 'APPROVED', true), 'HR reviews only what was sent')

// ---------------------------------------------------------------- responses, filters, analytics
const draft = { ...form, id: 'fm0', status: 'DRAFT' }
const archived = { ...form, id: 'fm2', status: 'ARCHIVED', title: 'Old' }
const subs = [sub('u-a', 'SUBMITTED', { submittedAt: '2026-11-12T10:00:00Z' }), { ...sub('u-b', 'APPROVED', { submittedAt: '2026-11-05T10:00:00Z' }), formId: 'fm2' }]
const rows = responseRows({ forms: [draft, form, archived], subs, users, today: T })
assert.deepEqual(rows.map((r) => `${r.form.id}:${r.user.id}:${r.status}`).sort(), ['fm1:u-a:SUBMITTED', 'fm1:u-d:PENDING', 'fm2:u-b:APPROVED'],
  'drafts never; a published form: every assignee (pending too); an archived one: only who sent it, even if no longer assigned')
assert.equal(rows[0].files, 0)
assert.deepEqual(filterRows(rows, { q: 'DEV' }).map((r) => r.user.id), ['u-d'], 'search by name')
assert.deepEqual(filterRows(rows, { q: 'b' }).map((r) => r.user.id), ['u-b'], 'search by employee ID')
assert.deepEqual(filterRows(rows, { status: 'OPEN' }).map((r) => r.user.id), ['u-d'])
assert.deepEqual(filterRows(rows, { status: 'DONE', sort: 'old' }).map((r) => r.user.id), ['u-b', 'u-a'], 'oldest first')
assert.deepEqual(filterRows(rows, { from: '2026-11-10', to: '2026-11-30' }).map((r) => r.user.id), ['u-a'], 'date range on the submission date')
assert.deepEqual(filterRows(rows, { branchId: 'br-2', formId: 'fm1' }).map((r) => r.user.id), ['u-d'])
const a = analytics({ forms: [draft, form, archived], rows })
assert.deepEqual([a.totalForms, a.activeForms, a.assigned, a.pending, a.completed, a.approved, a.rejected, a.underReview], [3, 1, 3, 1, 2, 1, 0, 1])
assert.deepEqual(a.byDepartment.find((g) => g.key === 'Sales'), { key: 'Sales', assigned: 1, sent: 1, approved: 0 })

// ---------------------------------------------------------------- reminders
assert.deepEqual(dueSoon({ forms: [form], subs: [], user: users[0], today: T }).map((f) => f.id), ['fm1'], 'due tomorrow, not sent')
assert.deepEqual(dueSoon({ forms: [form], subs: [sub('u-a', 'SUBMITTED')], user: users[0], today: T }), [], 'already sent')
assert.deepEqual(dueSoon({ forms: [{ ...form, deadline: '2026-11-30' }], subs: [], user: users[0], today: T }), [], 'not yet')

console.log('✓ HR forms: fields, publishing checks, assignment, answer validation, files, statuses and deadlines, responses, filters, analytics, reminders')
