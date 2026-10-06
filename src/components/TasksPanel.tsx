import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellRing, Check, ListTodo, Plus } from 'lucide-react'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { addTask, TASK_REMIND_DAYS, toggleTask, userName, visibleBookings } from '../lib/actions'
import { fmtDate, today } from '../lib/format'
import { Button, Card, CardHeader, Checkbox, cx, Input, Modal, Select, useRun } from './ui'

/** Open tasks on client files (mine, or my files' tasks) with a 15-day repeating reminder option. */
export function TasksPanel({ className, scope = 'mine' }: { className?: string; scope?: 'mine' | 'all' }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ bookingId: '', title: '', assignee: '', due: '', remind: true })
  const files = useMemo(() => visibleBookings(db, me).filter((b) => !['COMPLETED', 'REJECTED'].includes(b.status) && b.opsMemberId), [db, me])
  const tasks = useMemo(() => files.flatMap((b) => b.tasks.filter((t) => !t.done).map((t) => ({ t, b })))
    .filter(({ t, b }) => scope === 'all' || t.assignee === me.id || t.by === me.id || b.opsMemberId === me.id || b.adminId === me.id)
    .sort((x, y) => (x.t.due ?? '9').localeCompare(y.t.due ?? '9')), [files, scope, me.id])
  const file = files.find((b) => b.id === f.bookingId)
  const people = file ? [file.opsMemberId, file.adminId].filter(Boolean) as string[] : []

  return (
    <Card className={cx('overflow-hidden', className)}>
      <CardHeader title="Tasks & reminders" subtitle={`Client process tasks · reminders every ${TASK_REMIND_DAYS} days until done`} icon={ListTodo}
        action={<Button size="sm" icon={Plus} onClick={() => { setF({ bookingId: '', title: '', assignee: '', due: '', remind: true }); setOpen(true) }}>Add task</Button>} />
      <ul className="max-h-96 divide-y divide-line/70 overflow-y-auto">
        {tasks.slice(0, 30).map(({ t, b }) => (
          <li key={t.id} className="flex items-start gap-3 px-5 py-3">
            <button aria-label="Mark done" onClick={() => run(() => toggleTask(me, b.id, t.id), 'Task done')} className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-2 border-line hover:border-ok"><Check className="size-3 text-transparent hover:text-ok" /></button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              <p className="text-xs text-mute"><Link to={`/bookings/${b.id}`} className="hover:underline">{b.companyName}</Link>{t.assignee ? ` · ${userName(db, t.assignee)}` : ''}{t.due ? ` · due ${fmtDate(t.due)}` : ''}</p>
            </div>
            {t.remindEveryDays && <span title={`Reminder every ${t.remindEveryDays} days`} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-semibold text-warn"><BellRing className="size-3" />{t.remindEveryDays}d</span>}
            {t.due && t.due < today() && <span className="shrink-0 rounded-full bg-bad-soft px-2 py-0.5 text-[10px] font-semibold text-bad">overdue</span>}
          </li>
        ))}
        {!tasks.length && <li className="px-5 py-6 text-center text-sm text-mute">No open tasks.</li>}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a task" size="sm"
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button icon={Plus} onClick={async () => {
          if (!f.bookingId) { await run(() => { throw new Error('Pick the client file.') }); return }
          if (await run(() => addTask(me, f.bookingId, f.title, f.due || undefined, { assignee: f.assignee || undefined, remind: f.remind }), 'Task added')) setOpen(false)
        }}>Add task</Button></>}>
        <div className="grid gap-4">
          <Select label="Client file" required value={f.bookingId} onChange={(e) => { const b = files.find((x) => x.id === e.target.value); setF({ ...f, bookingId: e.target.value, assignee: b?.adminId ?? b?.opsMemberId ?? '' }) }}>
            <option value="">— Select —</option>{files.map((b) => <option key={b.id} value={b.id}>{b.bookingId} · {b.companyName}</option>)}
          </Select>
          <Input label="Task" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Follow up for audited financials" />
          <Select label="Assign to" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} hint="The client's processing person (Operations) or admin person">
            <option value="">— Nobody specific —</option>
            {people.map((id) => <option key={id} value={id}>{userName(db, id)}{id === file?.adminId ? ' · Admin' : ' · Operations'}</option>)}
          </Select>
          <Input label="Due date" type="date" min={today()} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
          <Checkbox checked={f.remind} onChange={(v) => setF({ ...f, remind: v })} label={`Remind the processing and admin person every ${TASK_REMIND_DAYS} days until done`} />
        </div>
      </Modal>
    </Card>
  )
}
