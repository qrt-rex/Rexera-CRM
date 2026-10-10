import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { RotateCcw, Send, Sparkles, Trash2, X } from 'lucide-react'
import { useDb } from '../lib/store'
import { useAuth, useMe } from '../lib/auth'
import { buildAiContext } from '../lib/aiContext'
import { Rexy } from './hr/Mascots'
import { cx } from './ui'

type Msg = { role: 'user' | 'assistant'; content: string; error?: boolean }
const KEY = (id: string) => `rexy-chat-${id}`
const load = (id: string): Msg[] => { try { return JSON.parse(sessionStorage.getItem(KEY(id)) || '[]') } catch { return [] } }
const save = (id: string, m: Msg[]) => { try { sessionStorage.setItem(KEY(id), JSON.stringify(m.slice(-30))) } catch { /* private mode */ } }

async function ask(messages: Msg[], context: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 50_000)
  try {
    // only the last turns (and no failed ones) go to the server, so requests stay small
    const history = messages.filter((m) => !m.error).slice(-12).map(({ role, content }) => ({ role, content: content.slice(0, 2000) }))
    const res = await fetch('/api/ai-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history, context }), signal: controller.signal })
    if ((res.headers.get('content-type') || '').includes('text/html')) throw new Error('The assistant needs the live server (server.mjs) — it is not available on this host.')
    const j = await res.json().catch(() => null) as { success?: boolean; reply?: string; message?: string } | null
    if (!res.ok || !j?.success || !j.reply) throw new Error(j?.message || `The assistant could not answer (${res.status}).`)
    return j.reply
  } catch (e) {
    throw new Error(e instanceof Error && e.name === 'AbortError' ? 'The assistant took too long — please try again.' : e instanceof Error ? e.message : 'Could not reach the assistant.')
  } finally { clearTimeout(timer) }
}

/** **bold** and [label](/path) — app links only; anything else stays plain text. */
function inline(text: string, onNav: () => void): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) out.push(<b key={k++}>{m[1]}</b>)
    else if (m[3]!.startsWith('/') && !m[3]!.startsWith('//')) out.push(<Link key={k++} to={m[3]!} onClick={onNav} className="font-semibold text-brand-ink underline decoration-brand/40 underline-offset-2 hover:decoration-brand">{m[2]}</Link>)
    else out.push(m[2])
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
function Rich({ text, onNav }: { text: string; onNav: () => void }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter((l) => l.trim())
        const list = lines.length > 0 && lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))
        if (list) {
          const ordered = /^\s*\d/.test(lines[0]!)
          const items = lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), onNav)}</li>)
          return ordered ? <ol key={i} className="my-1 list-decimal space-y-0.5 pl-5">{items}</ol> : <ul key={i} className="my-1 list-disc space-y-0.5 pl-5">{items}</ul>
        }
        return <p key={i} className="my-1">{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l.replace(/^#+\s*/, ''), onNav)}</Fragment>)}</p>
      })}
    </>
  )
}

/** Suggestions that make sense for this person's role. */
function useSuggestions() {
  const { can } = useAuth()
  return useMemo(() => {
    const s = ['What is waiting for me?', 'My attendance this month']
    if (can('leads.own', 'leads.manage')) s.push('Follow-ups due today')
    if (can('bookings.create')) s.push('My collections this month')
    if (can('bookings.process', 'bookings.admin', 'bookings.legal')) s.push('Which files are overdue?')
    if (can('bookings.accounts')) s.push('Payments to verify')
    if (can('attendance.all')) s.push('Who is on leave today?')
    if (can('leave.approve')) s.push('Pending leave requests')
    s.push('My latest payslip', 'Upcoming holidays & events', 'How do I apply for leave?')
    return s.slice(0, 7)
  }, [can])
}

/** Rexy: the floating AI assistant on every page (bottom-right). */
export function AiAssistant() {
  const db = useDb()
  const me = useMe()
  const suggestions = useSuggestions()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>(() => load(me.id))
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const first = me.name.split(' ')[0]

  useEffect(() => { setMsgs(load(me.id)) }, [me.id])
  useEffect(() => { save(me.id, msgs) }, [me.id, msgs])
  useEffect(() => { if (open) { endRef.current?.scrollIntoView({ block: 'end' }); inputRef.current?.focus() } }, [open, msgs.length, busy])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const send = async (q: string, base = msgs) => {
    const question = q.trim()
    if (!question || busy) return
    const next: Msg[] = [...base, { role: 'user', content: question.slice(0, 2000) }]
    setMsgs(next); setText(''); setBusy(true)
    try {
      const reply = await ask(next, buildAiContext(db, me))
      setMsgs((m) => [...m, { role: 'assistant', content: reply }])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: e instanceof Error ? e.message : 'Something went wrong.', error: true }])
    } finally { setBusy(false) }
  }
  const retry = () => {
    const lastUser = [...msgs].reverse().findIndex((m) => m.role === 'user')
    if (lastUser < 0) return
    const idx = msgs.length - 1 - lastUser
    send(msgs[idx]!.content, msgs.slice(0, idx))
  }
  const close = () => setOpen(false)

  return (
    <div className="no-print">
      {open && (
        <section role="dialog" aria-label="Rexy, your CRM assistant"
          className="anim-pop fixed bottom-24 right-3 z-[75] flex h-[min(640px,calc(100dvh-7.5rem))] w-[min(410px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-3xl border border-line bg-card shadow-pop sm:right-6">
          <header className="flex items-center gap-3 bg-gradient-to-r from-[#2E3A8C] via-[#4453b5] to-[#0891b2] px-4 py-3 text-white">
            <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/95 shadow-sm"><Rexy pose="wave" className="h-10 w-10" /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-extrabold">Rexy <Sparkles className="size-3.5 text-amber-300" /></span>
              <span className="block text-xs text-white/80">Your AI CRM assistant</span>
            </span>
            <button aria-label="Clear chat" title="Clear chat" disabled={!msgs.length || busy} onClick={() => setMsgs([])} className="grid size-9 place-items-center rounded-xl text-white/85 hover:bg-white/15 hover:text-white disabled:opacity-40"><Trash2 className="size-[18px]" /></button>
            <button aria-label="Close" onClick={close} className="grid size-9 place-items-center rounded-xl text-white/85 hover:bg-white/15 hover:text-white"><X className="size-5" /></button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-card2/50 px-4 py-4 text-sm" aria-live="polite">
            <div className="max-w-[88%] rounded-2xl rounded-tl-md border border-line bg-card px-3.5 py-2.5 font-semibold shadow-sm">
              Hi {first}! I'm Rexy 👋 How can I help you today?
              <span className="mt-0.5 block text-xs font-normal text-mute">I can see what your role can see in the CRM: files, leads, attendance, leave and more.</span>
            </div>
            {!msgs.length && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-full border border-brand/40 bg-card px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:border-brand hover:bg-brand-soft">{s}</button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-tr-md bg-brand px-3.5 py-2 text-white shadow-sm">{m.content}</p>
              </div>
            ) : (
              <div key={i} className={cx('max-w-[92%] rounded-2xl rounded-tl-md border px-3.5 py-2 leading-relaxed shadow-sm', m.error ? 'border-bad/30 bg-bad-soft text-bad' : 'border-line bg-card')}>
                {m.error ? m.content : <Rich text={m.content} onNav={() => { if (window.innerWidth < 640) close() }} />}
                {m.error && i === msgs.length - 1 && <button onClick={retry} className="mt-1.5 flex items-center gap-1 text-xs font-bold underline"><RotateCcw className="size-3" />Try again</button>}
              </div>
            ))}
            {busy && (
              <div className="flex w-16 items-center justify-center gap-1 rounded-2xl rounded-tl-md border border-line bg-card px-3 py-3 shadow-sm" aria-label="Rexy is typing">
                {[0, 1, 2].map((d) => <span key={d} className="size-1.5 animate-bounce rounded-full bg-brand/70" style={{ animationDelay: `${d * 150}ms` }} />)}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form className="flex items-end gap-2 border-t border-line bg-card p-3" onSubmit={(e) => { e.preventDefault(); send(text) }}>
            <textarea ref={inputRef} rows={1} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }}
              placeholder="Ask about files, leads, leave, attendance…" aria-label="Message Rexy"
              className="max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-line bg-card2 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand focus:bg-card focus:ring-4 focus:ring-brand/10" />
            <button type="submit" disabled={!text.trim() || busy} aria-label="Send"
              className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-white shadow-sm transition hover:brightness-110 disabled:opacity-40"><Send className="size-[18px]" /></button>
          </form>
          <p className="bg-card px-4 pb-2 text-center text-[10px] text-mute">AI answers can be wrong — check important details on the page.</p>
        </section>
      )}

      <button onClick={() => setOpen(!open)} aria-label={open ? 'Close Rexy' : 'Open Rexy, your AI assistant'} title="Ask Rexy"
        className="group fixed bottom-5 right-4 z-[75] grid size-14 place-items-center rounded-full bg-gradient-to-br from-[#4453b5] to-[#0891b2] text-white shadow-lg shadow-brand/30 ring-4 ring-white/70 transition hover:scale-105 dark:ring-white/10 sm:right-6 sm:size-16">
        {open ? <X className="size-6" /> : <span className="grid size-12 place-items-center overflow-hidden rounded-full bg-white/95 sm:size-[52px]"><Rexy pose="wave" className="h-11 w-11 transition group-hover:rotate-6" /></span>}
        {!open && !msgs.length && <span className="absolute -right-0.5 -top-0.5 flex size-4"><span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex size-4 rounded-full border-2 border-white bg-accent" /></span>}
      </button>
    </div>
  )
}
