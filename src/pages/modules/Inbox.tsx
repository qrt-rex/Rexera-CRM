import { useMemo, useState } from 'react'
import { Bot, CheckCheck, Inbox as InboxIcon, Mail, MailOpen } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { markEmailRead } from '../../lib/email'
import { ago, fmtDateTime } from '../../lib/format'
import { Button, Card, cx, EmptyState, PageHeader, SearchBox } from '../../components/ui'

export default function Inbox() {
  const db = useDb()
  const me = useMe()
  const [q, setQ] = useState('')
  const mine = useMemo(() => db.emails.filter((e) => e.to === me.id && (!q || `${e.subject} ${e.body}`.toLowerCase().includes(q.toLowerCase()))), [db.emails, me.id, q])
  const [openId, setOpenId] = useState<string | null>(null)
  const open = mine.find((e) => e.id === openId) ?? null
  const unread = mine.filter((e) => !e.read).length
  const sender = (from: string) => (from === 'system' ? 'Rexera CRM' : userName(db, from))

  return (
    <div>
      <PageHeader title="Email" subtitle={`Sent to ${me.email}`} icon={InboxIcon}
        actions={unread > 0 && <Button variant="outline" icon={CheckCheck} onClick={() => markEmailRead(me)}>Mark all read</Button>} />
      <Card className="grid min-h-[60vh] overflow-hidden md:grid-cols-[360px_1fr]">
        <div className={cx('flex min-h-0 flex-col border-r border-line', open && 'hidden md:flex')}>
          <div className="p-3"><SearchBox value={q} onChange={setQ} placeholder="Search email…" /></div>
          {!mine.length ? <EmptyState icon={Mail} title="No email yet" text="Messages from HR and automatic emails land here." /> : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {mine.map((e) => (
                <li key={e.id}>
                  <button onClick={() => { setOpenId(e.id); if (!e.read) markEmailRead(me, e.id) }} className={cx('flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left hover:bg-card2', openId === e.id && 'bg-brand-soft', !e.read && 'bg-brand-soft/30')}>
                    <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', e.read ? 'bg-transparent' : 'bg-accent')} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2"><span className={cx('truncate text-sm', !e.read && 'font-bold')}>{sender(e.from)}</span><span className="shrink-0 text-[10px] text-mute">{ago(e.at)}</span></span>
                      <span className={cx('block truncate text-sm', e.read ? 'text-mute' : 'font-semibold')}>{e.subject}</span>
                      <span className="block truncate text-xs text-mute">{e.body.replace(/\s+/g, ' ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {open ? (
          <article className="min-w-0 p-6">
            <button className="mb-3 text-sm text-mute md:hidden" onClick={() => setOpenId(null)}>← Back</button>
            <h2 className="text-xl font-extrabold">{open.subject}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-mute">{open.from === 'system' && <Bot className="size-3.5" />}From {sender(open.from)} · to {open.toEmail} · {fmtDateTime(open.at)}</p>
            <div className="mt-5 whitespace-pre-line text-sm leading-relaxed">{open.body.split(/(https?:\/\/\S+)/g).map((part, i) => /^https?:\/\//.test(part) ? <a key={i} href={part} className="font-semibold text-brand-ink underline">{part}</a> : part)}</div>
          </article>
        ) : <div className="hidden place-items-center text-sm text-mute md:grid"><span className="flex flex-col items-center gap-2"><MailOpen className="size-8" />Select an email to read it</span></div>}
      </Card>
    </div>
  )
}
