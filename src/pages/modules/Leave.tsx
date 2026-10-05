import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarCheck2, Check, Plus, X } from 'lucide-react'
import type { LeaveType } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { applyLeave, canDecideLeave, cancelLeave, decideLeave, leaveApprovers, userName } from '../../lib/actions'
import { daysBetween, fmtDate, today } from '../../lib/format'
import { roleLabel } from '../../lib/rbac'
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Table, Tabs, Td, Textarea, Th, useRun } from '../../components/ui'

const QUOTA: Record<LeaveType, number> = { CL: 12, SL: 8, EL: 15, LOP: 0 }
const NAMES: Record<LeaveType, string> = { CL: 'Casual leave', SL: 'Sick leave', EL: 'Earned leave', LOP: 'Loss of pay' }
const tone = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', CANCELLED: 'gray' } as const

export default function Leave() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ type: 'CL' as LeaveType, from: today(), to: today(), reason: '' })
  const [decide, setDecide] = useState<{ id: string; approve: boolean } | null>(null)
  const [remark, setRemark] = useState('')
  useEffect(() => { if (params.get('new')) { setOpen(true); setParams({}, { replace: true }) } }, [params, setParams])

  const mine = db.leaves.filter((l) => l.userId === me.id)
  const toDecide = db.leaves.filter((l) => canDecideLeave(db, me, l))
  const decidedByMe = db.leaves.filter((l) => l.decidedBy === me.id)
  const [tab, setTab] = useState<'mine' | 'approve' | 'history'>(toDecide.length ? 'approve' : 'mine')
  const used = useMemo(() => {
    const u: Record<LeaveType, number> = { CL: 0, SL: 0, EL: 0, LOP: 0 }
    for (const l of mine) if (l.status === 'APPROVED' && l.from.slice(0, 4) === today().slice(0, 4)) u[l.type] += l.days
    return u
  }, [mine])
  const days = f.to >= f.from ? daysBetween(f.from, f.to) + 1 : 0

  return (
    <div>
      <PageHeader title="Leave" subtitle={`Your requests go to: ${leaveApprovers(me.role).map(roleLabel).join(' / ')}`} icon={CalendarCheck2}
        actions={<Button variant="accent" icon={Plus} onClick={() => setOpen(true)}>Request my leave</Button>} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(Object.keys(QUOTA) as LeaveType[]).map((t) => (
          <Card key={t} className="p-4">
            <p className="text-xs font-semibold text-mute">{NAMES[t]}</p>
            <p className="mt-1 text-2xl font-extrabold">{t === 'LOP' ? used.LOP : QUOTA[t] - used[t]}<span className="text-sm font-medium text-mute"> {t === 'LOP' ? 'days taken' : `of ${QUOTA[t]} left`}</span></p>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="border-b border-line p-4"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'mine', label: 'My requests', count: mine.length }, { id: 'approve', label: 'To approve', count: toDecide.length }, { id: 'history', label: 'Decided by me', count: decidedByMe.length }]} /></div>
        {(() => {
          const list = tab === 'mine' ? mine : tab === 'approve' ? toDecide : decidedByMe
          if (!list.length) return <EmptyState icon={CalendarCheck2} title={tab === 'approve' ? 'Nothing to approve' : 'No requests'} />
          return (
            <Table>
              <thead><tr>{tab !== 'mine' && <Th>Employee</Th>}<Th>Type</Th><Th>Dates</Th><Th>Days</Th><Th>Reason</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>
                {list.map((l) => (
                  <tr key={l.id}>
                    {tab !== 'mine' && <Td className="font-semibold">{userName(db, l.userId)}</Td>}
                    <Td><Badge tone="violet">{l.type}</Badge></Td>
                    <Td className="text-sm">{fmtDate(l.from)} → {fmtDate(l.to)}</Td>
                    <Td>{l.days}</Td>
                    <Td className="max-w-64 text-sm"><span className="line-clamp-2">{l.reason}</span>{l.remark && <span className="block text-xs text-mute">“{l.remark}” — {userName(db, l.decidedBy)}</span>}</Td>
                    <Td><Badge tone={tone[l.status]}>{l.status.toLowerCase()}</Badge></Td>
                    <Td className="text-right">
                      {tab === 'approve' && <span className="inline-flex gap-1"><Button size="sm" variant="success" icon={Check} onClick={() => { setDecide({ id: l.id, approve: true }); setRemark('') }}>Approve</Button><Button size="sm" variant="outline" icon={X} onClick={() => { setDecide({ id: l.id, approve: false }); setRemark('') }}>Reject</Button></span>}
                      {tab === 'mine' && l.status === 'PENDING' && <Button size="sm" variant="ghost" onClick={() => run(() => cancelLeave(me, l.id), 'Request cancelled')}>Cancel</Button>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        })()}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Request my leave"
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={async () => { if (await run(() => applyLeave(me, f), 'Leave requested')) { setOpen(false); setF({ type: 'CL', from: today(), to: today(), reason: '' }) } }}>Submit request</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Leave type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as LeaveType })} className="sm:col-span-2">{(Object.keys(NAMES) as LeaveType[]).map((t) => <option key={t} value={t}>{NAMES[t]}{t !== 'LOP' ? ` · ${QUOTA[t] - used[t]} left` : ''}</option>)}</Select>
          <Input label="From" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: e.target.value > f.to ? e.target.value : f.to })} />
          <Input label="To" type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} hint={`${days} day(s)`} />
          <Textarea label="Reason" required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className="sm:col-span-2" hint={f.type === 'SL' && days > 2 ? 'Sick leave over 2 days needs a medical certificate — mention it here.' : undefined} />
        </div>
      </Modal>
      <Modal open={!!decide} onClose={() => setDecide(null)} title={decide?.approve ? 'Approve leave' : 'Reject leave'} size="sm"
        footer={<><Button variant="outline" onClick={() => setDecide(null)}>Cancel</Button><Button variant={decide?.approve ? 'success' : 'danger'} onClick={async () => { if (decide && await run(() => decideLeave(me, decide.id, decide.approve, remark), decide.approve ? 'Approved' : 'Rejected')) setDecide(null) }}>{decide?.approve ? 'Approve' : 'Reject'}</Button></>}>
        <Textarea label={decide?.approve ? 'Remark (optional)' : 'Reason'} value={remark} onChange={(e) => setRemark(e.target.value)} />
      </Modal>
    </div>
  )
}
