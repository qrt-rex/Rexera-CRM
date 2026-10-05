import { useEffect, useState } from 'react'
import { UserPlus } from 'lucide-react'
import type { Lead } from '../lib/types'
import { useDb } from '../lib/store'
import { useAuth, useMe } from '../lib/auth'
import { createLead, updateLead, visibleLeads, type LeadInput } from '../lib/actions'
import { INDIAN_STATES } from '../lib/format'
import { LEAD_SOURCES } from '../lib/workflow'
import { rolesOf } from '../lib/rbac'
import { Button, Input, Modal, Select, Textarea, useRun } from './ui'

const empty: LeadInput = { name: '', company: '', phone: '', email: '', city: '', state: 'Gujarat', service: '', source: 'Website', notes: '' }

export function LeadFormModal({ open, onClose, lead }: { open: boolean; onClose: () => void; lead?: Lead }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [f, setF] = useState<LeadInput>(empty)
  const [price, setPrice] = useState('')
  useEffect(() => {
    if (!open) return
    if (lead) { setF({ ...lead, followUp: lead.followUp }); setPrice(lead.price == null ? '' : String(lead.price)) }
    else { setF(empty); setPrice('') }
  }, [open, lead])
  const set = <K extends keyof LeadInput>(k: K, v: LeadInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const canAssign = can('leads.assign', 'leads.manage')
  const assignees = db.users.filter((u) => u.active && rolesOf(u).some((r) => r === 'sales' || r === 'teamlead') && (can('leads.manage') || u.teamLeadId === me.id || u.id === me.id))
  const dup = !lead && f.phone.replace(/\D/g, '').length >= 10 ? visibleLeads(db, me).find((l) => l.phone === f.phone.replace(/\D/g, '').slice(-10)) : undefined

  const save = async () => {
    const input = { ...f, price: price === '' ? undefined : Number(price) }
    const ok = await run(() => (lead ? updateLead(me, lead.id, input) : createLead(me, input)), lead ? 'Lead updated' : 'Lead added')
    if (ok) onClose()
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" title={lead ? `Edit ${lead.code}` : 'New CRM lead'} subtitle="Phone numbers are stored as 10 digits; duplicates are blocked."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon={UserPlus} onClick={save}>{lead ? 'Save changes' : 'Add lead'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Client name" required value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        <Input label="Company" value={f.company} onChange={(e) => set('company', e.target.value)} />
        <Input label="Mobile" required inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="98XXXXXXXX"
          error={dup ? `Already a lead: ${dup.code} · ${dup.name}` : undefined} />
        <Input label="Email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        <Input label="City" value={f.city} onChange={(e) => set('city', e.target.value)} />
        <Select label="State" value={f.state} onChange={(e) => set('state', e.target.value)}>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select label="Service interest" value={f.service} onChange={(e) => set('service', e.target.value)}>
          <option value="">— Select —</option>
          {db.services.filter((s) => s.active).map((s) => <option key={s.id}>{s.name}</option>)}
        </Select>
        <Select label="Source" value={f.source} onChange={(e) => set('source', e.target.value)}>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Input label="Expected price (₹)" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} hint="Optional, before GST" />
        <Input label="Follow-up date" type="date" value={f.followUp ?? ''} onChange={(e) => set('followUp', e.target.value || undefined)} />
        {canAssign && (
          <Select label="Assign to" value={f.assignedTo ?? (lead?.assignedTo ?? me.id)} onChange={(e) => set('assignedTo', e.target.value)} className="sm:col-span-2">
            {assignees.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me.id ? ' (me)' : ''}</option>)}
          </Select>
        )}
        <Textarea label="Notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} className="sm:col-span-2" />
      </div>
    </Modal>
  )
}
