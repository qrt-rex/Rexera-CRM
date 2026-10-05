import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText, MessagesSquare, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { deleteTemplate, markThreadRead, sendMessage, upsertTemplate } from '../../lib/actions'
import { roleLabel } from '../../lib/rbac'
import { ago, fmtTime } from '../../lib/format'
import { Avatar, Button, Card, cx, EmptyState, Input, Modal, PageHeader, SearchBox, Tabs, Textarea, useRun } from '../../components/ui'

export default function Messages() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'templates' ? 'templates' : 'chat'
  const [peer, setPeer] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [tpl, setTpl] = useState<{ id?: string; name: string; body: string } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const people = useMemo(() => db.users.filter((u) => u.id !== me.id && u.active).map((u) => {
    const thread = db.messages.filter((m) => (m.from === u.id && m.to === me.id) || (m.from === me.id && m.to === u.id))
    return { u, last: thread[thread.length - 1], unread: thread.filter((m) => m.to === me.id && !m.read).length }
  }).filter((p) => !q || p.u.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? '') || a.u.name.localeCompare(b.u.name)), [db, me.id, q])
  const thread = peer ? db.messages.filter((m) => (m.from === peer && m.to === me.id) || (m.from === me.id && m.to === peer)) : []
  const other = db.users.find((u) => u.id === peer)
  useEffect(() => { if (peer && thread.some((m) => m.to === me.id && !m.read)) markThreadRead(me, peer) }, [peer, thread, me])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread.length, peer])
  const send = async () => { if (peer && await run(() => sendMessage(me, peer, text))) setText('') }

  return (
    <div>
      <PageHeader title="Messages" subtitle="Message to message — internal team chat and templates" icon={MessagesSquare}
        actions={<Tabs value={tab} onChange={(t) => setParams(t === 'chat' ? {} : { tab: t })} tabs={[{ id: 'chat', label: 'Chat', icon: MessagesSquare }, { id: 'templates', label: 'Templates', icon: FileText }]} />} />
      {tab === 'chat' ? (
        <Card className="grid h-[calc(100vh-220px)] min-h-[480px] overflow-hidden md:grid-cols-[300px_1fr]">
          <div className={cx('flex min-h-0 flex-col border-r border-line', peer && 'hidden md:flex')}>
            <div className="p-3"><SearchBox value={q} onChange={setQ} placeholder="Search people…" /></div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {people.map(({ u, last, unread }) => (
                <li key={u.id}><button onClick={() => setPeer(u.id)} className={cx('flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-card2', peer === u.id && 'bg-brand-soft')}>
                  <Avatar name={u.name} photo={u.photo} size={40} />
                  <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{u.name}</span>{last && <span className="shrink-0 text-[10px] text-mute">{ago(last.at)}</span>}</span>
                    <span className="block truncate text-xs text-mute">{last ? `${last.from === me.id ? 'You: ' : ''}${last.body}` : roleLabel(u.role)}</span></span>
                  {unread > 0 && <span className="grid size-5 place-items-center rounded-full bg-accent text-[10px] font-bold text-white">{unread}</span>}
                </button></li>
              ))}
            </ul>
          </div>
          {other ? (
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center gap-3 border-b border-line px-5 py-3">
                <button className="text-sm text-mute md:hidden" onClick={() => setPeer(null)}>←</button>
                <Avatar name={other.name} photo={other.photo} /><div><p className="font-bold">{other.name}</p><p className="text-xs text-mute">{roleLabel(other.role)} · {other.designation}</p></div>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-card2/40 p-5">
                {!thread.length && <p className="pt-10 text-center text-sm text-mute">Say hello to {other.name.split(' ')[0]} 👋</p>}
                {thread.map((m) => (
                  <div key={m.id} className={cx('flex', m.from === me.id ? 'justify-end' : 'justify-start')}>
                    <div className={cx('max-w-[75%] rounded-2xl px-4 py-2 text-sm', m.from === me.id ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md border border-line bg-card')}>
                      <p className="whitespace-pre-line">{m.body}</p><p className={cx('mt-0.5 text-right text-[10px]', m.from === me.id ? 'text-white/70' : 'text-mute')}>{fmtTime(m.at)}</p>
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <div className="flex gap-2 border-t border-line p-3">
                {db.templates.length > 0 && <select aria-label="Insert template" className="h-10 w-32 rounded-xl border border-line bg-card px-2 text-xs" value="" onChange={(e) => { const t = db.templates.find((x) => x.id === e.target.value); if (t) setText(t.body) }}><option value="">Template…</option>{db.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
                <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()} placeholder="Type a message…" className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-card px-4 text-sm outline-none focus:border-brand" />
                <Button icon={Send} onClick={send} aria-label="Send" />
              </div>
            </div>
          ) : <div className="hidden md:block"><EmptyState icon={MessagesSquare} title="Pick a conversation" text="Choose a teammate on the left." /></div>}
        </Card>
      ) : (
        <div>
          {can('templates.manage') && <Button className="mb-4" variant="accent" icon={Plus} onClick={() => setTpl({ name: '', body: '' })}>New template</Button>}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {db.templates.map((t) => (
              <Card key={t.id} className="p-5">
                <div className="flex items-center gap-2"><FileText className="size-4 text-brand-ink" /><h3 className="flex-1 font-bold">{t.name}</h3>
                  {can('templates.manage') && <><Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setTpl(t)} /><Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete" className="text-bad" onClick={() => run(() => deleteTemplate(me, t.id), 'Deleted')} /></>}</div>
                <p className="mt-2 text-sm text-mute">{t.body.split(/(\{\w+\})/g).map((p, i) => p.startsWith('{') ? <b key={i} className="rounded bg-accent-soft px-1 text-accent">{p}</b> : p)}</p>
              </Card>
            ))}
          </div>
          <Modal open={!!tpl} onClose={() => setTpl(null)} title={tpl?.id ? 'Edit template' : 'New template'} footer={<><Button variant="outline" onClick={() => setTpl(null)}>Cancel</Button><Button onClick={async () => { if (tpl && await run(() => upsertTemplate(me, tpl), 'Saved')) setTpl(null) }}>Save</Button></>}>
            {tpl && <div className="grid gap-4"><Input label="Name" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} /><Textarea label="Text" rows={5} value={tpl.body} onChange={(e) => setTpl({ ...tpl, body: e.target.value })} hint="Placeholders: {client} {amount} {service} {booking} {employee} {documents}" /></div>}
          </Modal>
        </div>
      )}
    </div>
  )
}
