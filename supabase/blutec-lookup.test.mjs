// Blutec lead lookup → client entry: fields read whatever Blutec names them, nothing invented, dispositions mapped.
import assert from 'node:assert/strict'
import { blutecLeadInfo } from './functions/_shared/blutec.ts'
import { entryStatusFromDisposition as st } from './functions/_shared/blutec.ts'

const x = blutecLeadInfo({
  lookup: { id: 990011, phone: '917487844433', name: 'Bob Johnson', lead_list_id: 12 },
  lead: { id: 990011, custom_data: { Company_Name: 'Acme Pvt Ltd', email: 'bob@acme.in' } },
  history: { history: [
    { created_at: '2026-11-03T10:00:00Z', disposition: { name: 'No Answer' }, duration_seconds: 0 },
    { created_at: '2026-11-04T06:31:00Z', disposition_name: 'Hot Prospect', agent_name: 'Dhairya Dave', campaign_name: 'IT Sample Camp.', talk_duration: '00:00:43', notes: 'call after 6' },
  ] },
})
assert.equal(x.blutecLeadId, 990011)
assert.equal(x.name, 'Bob Johnson'); assert.equal(x.company, 'Acme Pvt Ltd'); assert.equal(x.email, 'bob@acme.in')
assert.equal(x.disposition, 'Hot Prospect'); assert.equal(x.agent, 'Dhairya Dave'); assert.equal(x.campaign, 'IT Sample Camp.')
assert.equal(x.durationSec, 43); assert.equal(x.calledAt, '2026-11-04T06:31:00.000Z'); assert.equal(x.notes, 'call after 6')

// only what the docs promise: nothing made up
const bare = blutecLeadInfo({ lookup: { id: 5, phone: '919800000001', name: 'Rahul' }, lead: null, history: null })
assert.deepEqual([bare.company, bare.disposition, bare.calledAt, bare.durationSec], ['', '', '', null])
assert.equal(blutecLeadInfo({ lead: { first_name: 'A', last_name: 'B' } }).name, 'A B')

assert.equal(st('Hot Prospect'), 'HOT'); assert.equal(st('Interested'), 'INTERESTED'); assert.equal(st('Intro'), 'INTERESTED')
assert.equal(st('Not Interested'), 'NOT_INTERESTED'); assert.equal(st('Call Back'), 'CALL_BACK'); assert.equal(st('No Answer'), ''); assert.equal(st(), '')
console.log('✓ Blutec lookup: lead, company, latest call, duration, dispositions → client entry status, nothing invented')

// the lead takes Blutec's disposition: Intro and Hot Prospect are the qualifying ones
import { dispositionToStatus } from '../src/lib/workflow.ts'
import { blutecCallSummary } from './functions/_shared/blutec.ts'
assert.equal(dispositionToStatus('Intro'), 'INTRO'); assert.equal(dispositionToStatus('Hot Prospect'), 'HOT_PROSPECT'); assert.equal(dispositionToStatus('HOT PROSPECT'), 'HOT_PROSPECT')
assert.equal(dispositionToStatus(''), undefined)
assert.equal(blutecCallSummary({ disposition: 'Intro', calledAt: '2026-11-04T06:31:00Z', durationSec: 43, campaign: 'IT Sample Camp.', agent: 'Dhairya Dave' }),
  'Intro · 4 Nov 2026, 12:01 pm · 43s · IT Sample Camp. · by Dhairya Dave')
console.log('✓ Blutec dispositions → lead status (Intro, Hot Prospect), call summary in India time')
