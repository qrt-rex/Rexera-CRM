import { useEffect, useMemo, useRef, useState } from 'react'
import { MessagesSquare, Paperclip, Send, X } from 'lucide-react'
import type { FileRef } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { markThreadRead, sendMessage } from '../../lib/actions'
import { roleLabel } from '../../lib/rbac'
import { ago, fmtTime } from '../../lib/format'
import { checkFile, deleteFile, fileSize, saveFile } from '../../lib/files'
import { FileLink } from '../../components/FileField'
import { ZoomAvatar } from '../../components/PhotoZoom'
import { Button, Card, cx, EmptyState, PageHeader, SearchBox, useRun, useToast } from '../../components/ui'

/** Documents that can be shared in chat. */
const SHARE_TYPES = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,image/png,image/jpeg,image/webp,application/pdf'

export default function Messages() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const [peer, setPeer] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<FileRef[]>([])
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const people = useMemo(() => db.users.filter((u) => u.id !== me.id && u.active).map((u) => {
    const thread = db.messages.filter((m) => (m.from === u.id && m.to === me.id) || (m.from === me.id && m.to === u.id))
    return { u, last: thread[thread.length - 1], unread: thread.filter((m) => m.to === me.id && !m.read).length }
  }).filter((p) => !q || `${p.u.name} ${p.u.designation}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? '') || a.u.name.localeCompare(b.u.name)), [db, me.id, q])
  const thread = peer ? db.messages.filter((m) => (m.from === peer && m.to === me.id) || (m.from === me.id && m.to === peer)) : []
  const other = db.users.find((u) => u.id === peer)
  useEffect(() => { if (peer && thread.some((m) => m.to === me.id && !m.read)) markThreadRead(me, peer) }, [peer, thread, me])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread.length, peer])
  useEffect(() => { setFiles([]); setText('') }, [peer])

  const attach = async (list: FileList) => {
    setBusy(true)
    try {
      const added: FileRef[] = []
      for (const f of Array.from(list).slice(0, 5)) { checkFile(f, SHARE_TYPES, f.name); added.push(await saveFile(f)) }
      setFiles((x) => [...x, ...added].slice(0, 5))
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Could not attach the file.') } finally { setBusy(false) }
  }
  const send = async () => { if (peer && await run(() => sendMessage(me, peer, text, files))) { setText(''); setFiles([]) } }
  const last = (m?: { body: string; attachments?: FileRef[] }) => m ? (m.body || `📎 ${m.attachments?.length ?? 0} document(s)`) : ''

  return (
    <div>
      <PageHeader title="Messages" subtitle="Internal team chat — share documents too. Tap a photo to see it larger." icon={MessagesSquare} />
      <Card className="grid h-[calc(100vh-220px)] min-h-[480px] overflow-hidden md:grid-cols-[300px_1fr]">
        <div className={cx('flex min-h-0 flex-col border-r border-line', peer && 'hidden md:flex')}>
          <div className="p-3"><SearchBox value={q} onChange={setQ} placeholder="Search people…" /></div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {people.map(({ u, last: lm, unread }) => (
              <li key={u.id} className={cx('flex items-center gap-3 px-4 py-3 hover:bg-card2', peer === u.id && 'bg-brand-soft')}>
                <ZoomAvatar name={u.name} photo={u.photo} size={40} sub={`${roleLabel(u.role)} · ${u.designation}`} />
                <button onClick={() => setPeer(u.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{u.name}</span>{lm && <span className="shrink-0 text-[10px] text-mute">{ago(lm.at)}</span>}</span>
                    <span className="block truncate text-xs text-mute">{lm ? `${lm.from === me.id ? 'You: ' : ''}${last(lm)}` : roleLabel(u.role)}</span></span>
                  {unread > 0 && <span className="grid size-5 place-items-center rounded-full bg-accent text-[10px] font-bold text-white">{unread}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {other ? (
          <div className="flex min-h-0 flex-col">
            <div className="flex items-center gap-3 border-b border-line px-5 py-3">
              <button className="text-sm text-mute md:hidden" onClick={() => setPeer(null)}>←</button>
              <ZoomAvatar name={other.name} photo={other.photo} sub={`${roleLabel(other.role)} · ${other.designation}`} />
              <div><p className="font-bold">{other.name}</p><p className="text-xs text-mute">{roleLabel(other.role)} · {other.designation}</p></div>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-card2/40 p-5">
              {!thread.length && <p className="pt-10 text-center text-sm text-mute">Say hello to {other.name.split(' ')[0]} 👋</p>}
              {thread.map((m) => {
                const mine = m.from === me.id
                const sender = mine ? me : other
                return (
                  <div key={m.id} className={cx('flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}>
                    {!mine && <ZoomAvatar name={sender.name} photo={sender.photo} size={28} sub={roleLabel(sender.role)} />}
                    <div className={cx('max-w-[75%] rounded-2xl px-4 py-2 text-sm', mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md border border-line bg-card')}>
                      {m.body && <p className="whitespace-pre-line">{m.body}</p>}
                      {m.attachments?.map((f) => (
                        <div key={f.id} className={cx('mt-1.5 flex items-center gap-2 rounded-xl px-2.5 py-1.5', mine ? 'bg-white/15' : 'bg-card2')}>
                          <span className={cx('min-w-0 flex-1', mine && '[&_button]:text-white')}><FileLink file={f} /></span>
                          <span className={cx('shrink-0 text-[10px]', mine ? 'text-white/70' : 'text-mute')}>{fileSize(f.size)}</span>
                        </div>
                      ))}
                      <p className={cx('mt-0.5 text-right text-[10px]', mine ? 'text-white/70' : 'text-mute')}>{fmtTime(m.at)}</p>
                    </div>
                  </div>
                )
              })}
              <div ref={endRef} />
            </div>
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-line px-3 pt-3">
                {files.map((f) => (
                  <span key={f.id} className="flex max-w-56 items-center gap-1.5 rounded-full border border-line bg-card2 py-1 pl-3 pr-1 text-xs">
                    <Paperclip className="size-3.5 shrink-0 text-mute" /><span className="truncate">{f.name}</span>
                    <button aria-label={`Remove ${f.name}`} onClick={() => { deleteFile(f.id).catch(() => {}); setFiles((x) => x.filter((y) => y.id !== f.id)) }} className="grid size-5 place-items-center rounded-full hover:bg-card"><X className="size-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2 border-t border-line p-3">
              <input ref={fileInput} type="file" multiple accept={SHARE_TYPES} className="hidden" onChange={(e) => { if (e.target.files?.length) attach(e.target.files); e.target.value = '' }} />
              <Button variant="outline" icon={Paperclip} aria-label="Attach documents" title="Share documents (PDF, Word, Excel, images · up to 5 MB each)" loading={busy} onClick={() => fileInput.current?.click()} />
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()} placeholder="Type a message…" className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-card px-4 text-sm outline-none focus:border-brand" />
              <Button icon={Send} onClick={send} aria-label="Send" disabled={!text.trim() && !files.length} />
            </div>
          </div>
        ) : <div className="hidden md:block"><EmptyState icon={MessagesSquare} title="Pick a conversation" text="Choose a teammate on the left." /></div>}
      </Card>
    </div>
  )
}
