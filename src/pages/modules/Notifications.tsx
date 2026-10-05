import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, CheckCheck } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { markRead } from '../../lib/actions'
import { ago } from '../../lib/format'
import { Button, Card, cx, EmptyState, PageHeader, Tabs } from '../../components/ui'

export default function Notifications() {
  const db = useDb()
  const me = useMe()
  const nav = useNavigate()
  const [tab, setTab] = useState<'unread' | 'all' | 'action'>('unread')
  const mine = db.notices.filter((n) => n.userId === me.id)
  const list = mine.filter((n) => tab === 'all' || (tab === 'unread' ? !n.read : n.kind === 'action'))
  const dot = { info: 'bg-info', success: 'bg-ok', warning: 'bg-warn', action: 'bg-accent' }
  return (
    <div>
      <PageHeader title="Notifications" subtitle="Approvals waiting for you, outcomes of your requests and company updates" icon={BellRing}
        actions={<Button variant="outline" icon={CheckCheck} onClick={() => markRead(me)}>Mark all read</Button>} />
      <Card className="overflow-hidden">
        <div className="border-b border-line p-4"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'unread', label: 'Unread', count: mine.filter((n) => !n.read).length }, { id: 'action', label: 'Needs action', count: mine.filter((n) => n.kind === 'action').length }, { id: 'all', label: 'All', count: mine.length }]} /></div>
        {!list.length ? <EmptyState icon={BellRing} title="You're all caught up ✨" /> : (
          <ul>
            {list.map((n) => (
              <li key={n.id}>
                <button onClick={() => { markRead(me, n.id); if (n.link) nav(n.link) }} className={cx('flex w-full items-start gap-4 border-b border-line/60 px-5 py-4 text-left hover:bg-card2', !n.read && 'bg-brand-soft/30')}>
                  <span className={cx('mt-1.5 size-2.5 shrink-0 rounded-full', n.read ? 'bg-line' : dot[n.kind])} />
                  <span className="min-w-0 flex-1"><span className="block font-semibold">{n.title}</span><span className="block text-sm text-mute">{n.body}</span></span>
                  <span className="shrink-0 text-xs text-mute">{ago(n.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
