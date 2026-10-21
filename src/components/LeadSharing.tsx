import { useMemo, useState } from 'react'
import { Shuffle, Users } from 'lucide-react'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { distributeLeads, leadTakers, overdueLeadsOf, roundRobin, saveLeadAssign, userName } from '../lib/actions'
import { branchCode } from '../lib/branches'
import { rolesOf } from '../lib/rbac'
import { Button, Checkbox, Modal, Toggle, useRun } from './ui'

/** People to share leads with, grouped by branch, ticked in the order they get leads. */
function PeoplePicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const db = useDb()
  const people = useMemo(() => leadTakers(db).sort((a, b) => (a.branchId ?? '~').localeCompare(b.branchId ?? '~') || a.name.localeCompare(b.name)), [db])
  const groups = useMemo(() => {
    const m = new Map<string, typeof people>()
    for (const u of people) { const k = u.branchId ? branchCode(db, u.branchId) : 'No branch'; m.set(k, [...(m.get(k) ?? []), u]) }
    return [...m.entries()]
  }, [db, people])
  const all = people.length > 0 && people.every((u) => value.includes(u.id))
  return (
    <div className="rounded-2xl border border-line">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-sm">
        <b>{value.length} of {people.length} people</b>
        <Checkbox label="Everyone" checked={all} onChange={(v) => onChange(v ? people.map((u) => u.id) : [])} />
      </div>
      <div className="max-h-72 space-y-3 overflow-y-auto p-4">
        {groups.map(([g, list]) => (
          <div key={g}>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-mute">{g}</p>
            <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {list.map((u) => {
                const overdue = overdueLeadsOf(db, u.id).length
                return <Checkbox key={u.id} checked={value.includes(u.id)} onChange={(v) => onChange(v ? [...value, u.id] : value.filter((x) => x !== u.id))}
                  label={<span>{u.name} <span className="text-[11px] text-mute">· {rolesOf(u).includes('teamlead') ? 'TL' : 'Sales'}</span>{overdue > 0 && <span className="ml-1 text-[11px] font-semibold text-bad">· {overdue} overdue (skipped)</span>}</span>} />
              })}
            </div>
          </div>
        ))}
        {!people.length && <p className="text-sm text-mute">No active sales people or team leaders yet.</p>}
      </div>
    </div>
  )
}

/** "20 each" / "first 5 get 21, the rest 20" */
function splitText(leads: number, people: number) {
  if (!people || !leads) return ''
  const each = Math.floor(leads / people), extra = leads % people
  if (!extra) return `${each} each`
  return `${extra} ${extra === 1 ? 'person gets' : 'people get'} ${each + 1}, ${people - extra} get ${each}${each ? '' : ' (none)'} — the remainder starts again from the first person`
}

/** Super Admin: automatic round-robin assignment for new leads (website, CSV, manual). */
export function AutoAssignModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const cur = db.settings.leadAssign
  const [on, setOn] = useState(cur?.on ?? false)
  const [ids, setIds] = useState<string[]>(cur?.userIds ?? [])
  const nextName = cur?.userIds.length ? userName(db, roundRobin(db, cur.userIds, cur.next, 1).to[0]) : ''
  return (
    <Modal open={open} onClose={onClose} title="Automatic lead assignment" size="lg"
      subtitle="New leads (website, CSV upload, added by hand without an owner) are shared out in turn: person 1, 2, 3 … and back to person 1."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon={Shuffle} onClick={async () => { if (await run(() => saveLeadAssign(me, on, ids), on ? 'Auto-assign is on' : 'Auto-assign is off')) onClose() }}>Save</Button></>}>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-2xl bg-card2 px-4 py-3">
          <span><b className="block text-sm">Assign new leads automatically</b><span className="text-xs text-mute">{on ? 'On — nobody has to hand them out' : 'Off — new leads wait in Unassigned'}</span></span>
          <Toggle checked={on} onChange={setOn} label="Automatic assignment" />
        </div>
        <PeoplePicker value={ids} onChange={setIds} />
        <p className="text-xs text-mute">People with leads still on “New” from before today are skipped until they update them (the same rule as handing leads out by hand).{nextName && cur?.on ? ` Next lead goes to ${nextName}.` : ''}</p>
      </div>
    </Modal>
  )
}

/** How to connect the website's enquiry form (rexera.co.in) to the CRM. */
export function WebsiteFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const url = `${window.location.origin}/api/website-lead`
  const html = `<form action="${url}" method="POST">
  <input name="name" placeholder="Your name" required>
  <input name="phone" placeholder="Mobile number" required>
  <input name="email" type="email" placeholder="Email">
  <input name="company" placeholder="Company">
  <input name="city" placeholder="City">
  <input name="service" placeholder="Service / scheme">
  <textarea name="message" placeholder="Message"></textarea>
  <!-- spam trap: keep hidden and empty -->
  <input name="website" style="display:none" tabindex="-1" autocomplete="off">
  <input type="hidden" name="_redirect" value="https://rexera.co.in/thank-you">
  <button>Send enquiry</button>
</form>`
  return (
    <Modal open={open} onClose={onClose} title="Website enquiries → CRM leads" size="lg"
      subtitle="Every enquiry form on rexera.co.in can send its entries here. They arrive in CRM Leads with the source “Website (rexera.co.in)” and are shared out automatically when Auto-assign is on."
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-4 text-sm">
        <div><p className="mb-1 font-semibold">Form address (POST)</p><code className="block break-all rounded-xl bg-card2 px-3 py-2 text-xs">{url}</code></div>
        <div><p className="mb-1 font-semibold">Plain HTML form</p><pre className="max-h-60 overflow-auto rounded-xl bg-card2 p-3 text-[11px] leading-relaxed">{html}</pre></div>
        <ul className="list-disc space-y-1 pl-5 text-mute">
          <li>WordPress (Contact Form 7, Elementor, WPForms): add a webhook to the address above. Fields called name / your-name, phone / mobile / your-phone, email, company, city, service, message are all understood.</li>
          <li>A 10-digit mobile number is required. The same number twice adds a note to the existing lead instead of a duplicate.</li>
          <li>Optional: set <b>WEBSITE_LEAD_KEY</b> on the server and send it as the field <b>key</b> (or the X-Website-Key header).</li>
          <li>Needs the live server connected to Supabase (SUPABASE_URL and SUPABASE_SECRET_KEY on Render).</li>
        </ul>
      </div>
    </Modal>
  )
}

/** Super Admin: share picked leads equally right now (round robin). */
export function ShareLeadsModal({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [people, setPeople] = useState<string[]>(() => db.settings.leadAssign?.userIds.length ? db.settings.leadAssign.userIds : leadTakers(db).map((u) => u.id))
  const free = people.filter((id) => !overdueLeadsOf(db, id).length).length
  return (
    <Modal open={ids.length > 0} onClose={onClose} title={`Share ${ids.length} lead${ids.length === 1 ? '' : 's'} equally`} size="lg"
      subtitle="Each person gets the same number in turn; when it doesn't divide evenly, the extra leads go from the first person on."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon={Users} disabled={!free} onClick={async () => {
        const r = await run(() => distributeLeads(me, ids, people), 'Leads shared equally')
        if (r && typeof r === 'object') { onDone(); onClose() }
      }}>Share now</Button></>}>
      <div className="space-y-3">
        <PeoplePicker value={people} onChange={setPeople} />
        <p className="rounded-xl bg-info-soft px-3 py-2 text-sm text-info">{free ? splitText(ids.length, free) : 'Pick at least one person who can take leads now.'}</p>
      </div>
    </Modal>
  )
}
