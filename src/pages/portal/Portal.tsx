import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, CheckCircle2, Clock3, FileText, Flag, KeyRound, Loader2, LogOut, Mail, Megaphone, Phone, RefreshCw, Upload, User as UserIcon } from 'lucide-react'
import { getPortalSupabase } from '../../lib/supabase'
import { CLIENT_DOC_STATUS, type ClientDocState } from '../../../supabase/portal-rules.mjs'
import { fileSize } from '../../lib/files'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { Logo } from '../../components/Logo'
import { Badge, Button, Card, CardHeader, cx, Input, Progress, Textarea, useToast } from '../../components/ui'

// ------------------------------------------------------------------ what /api/portal/me answers (server/portal.mjs)
interface PFile { id: string; name: string; size: number; at?: string }
interface PDoc { category: string; label: string; status: ClientDocState; remark: string | null; canUpload: boolean; files: PFile[]; history: { at: string; action: string; note: string | null }[] }
interface PMilestone { id: string; title: string; due: string | null; status: 'PENDING' | 'IN_PROGRESS' | 'DONE'; doneAt: string | null; tasksDone: number; tasksTotal: number }
interface PUpdate { id: string; at: string; title: string; text: string; file: PFile | null }
interface PPerson { name: string; email: string | null; phone: string | null }
interface PProject { id: string; code: string; company: string; service: string; since: string; contact: PPerson | null; progress: number | null; docs: PDoc[]; milestones: PMilestone[]; updates: PUpdate[] }
interface Me {
  account: { name: string; email: string; phone: string | null; status: string; lastLoginAt: string | null }
  contact: PPerson | null; projects: PProject[]; notices: { at: string; tone: 'amber' | 'red' | 'green' | 'blue'; text: string }[]; activity: { at: string; text: string; detail: string | null }[]
  /** posts, flyers, videos the Rexera team published for clients (Digital Media → External) */
  media: { id: string; title: string; description: string | null; scheme: string; type: string; at: string; files: (PFile & { type: string })[] }[]
}

class SignedOut extends Error {}
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,application/pdf,image/png,image/jpeg,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const token = async () => (await (await getPortalSupabase()).auth.getSession()).data.session?.access_token ?? ''

/** Calls the live server for the signed-in client. GET without a body. */
async function api<T>(action: string, body?: unknown, query = ''): Promise<T> {
  const res = await fetch(`/api/portal/${action}${query}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => { throw new Error('We could not reach the server — check your internet connection and try again.') })
  if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new Error('The client portal is not available on this copy.')
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) throw new SignedOut(data.message || 'Please sign in.')
  if (!res.ok) throw new Error(data.message || `Something went wrong (${res.status}).`)
  return data as T
}
const toBase64 = (f: File) => new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => fail(new Error('Could not read the file.')); r.readAsDataURL(f) })
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('')
const PASSWORD_OK = (p: string) => p.length >= 8 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p)

export default function Portal() {
  return (
    <Routes>
      <Route index element={<SignIn />} />
      <Route path="welcome" element={<Welcome />} />
      <Route path="home" element={<Home />} />
      <Route path="*" element={<Navigate to="/portal" replace />} />
    </Routes>
  )
}

function Frame({ children, wide, right }: { children: ReactNode; wide?: boolean; right?: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-card">
        <div className={cx('mx-auto flex items-center gap-3 px-4 py-3', wide ? 'max-w-6xl' : 'max-w-md')}>
          <Logo />
          <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[11px] font-semibold text-brand-ink">Client portal</span>
          <span className="ml-auto">{right}</span>
        </div>
      </header>
      <main className={cx('mx-auto px-4 py-6', wide ? 'max-w-6xl' : 'max-w-md')}>{children}</main>
    </div>
  )
}

// ================================================================== sign in / forgot password
function SignIn() {
  const nav = useNavigate()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [forgot, setForgot] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState(false)
  useEffect(() => { void token().then((t) => (t ? nav('/portal/home', { replace: true }) : setChecked(true)), () => setChecked(true)) }, [nav])
  const submit = async () => {
    setBusy(true); setError('')
    try {
      if (forgot) {
        const r = await api<{ message: string }>('forgot', { email: email.trim() })
        toast('success', r.message); setForgot(false)
      } else {
        const { error: e } = await (await getPortalSupabase()).auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
        if (e) throw new Error(/invalid/i.test(e.message) ? 'Wrong email or password.' : /banned/i.test(e.message) ? 'Your portal access is switched off — please contact us.' : e.message)
        try { await api('session', {}) } catch (x) { await (await getPortalSupabase()).auth.signOut(); throw x }
        nav('/portal/home', { replace: true })
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  if (!checked) return <Frame><Loader2 className="mx-auto mt-16 size-6 animate-spin text-mute" /></Frame>
  return (
    <Frame>
      <Card className="p-6">
        <h1 className="text-xl font-extrabold">{forgot ? 'Reset your password' : 'Sign in to your client portal'}</h1>
        <p className="mt-1 text-sm text-mute">{forgot ? 'We’ll email you a link to choose a new password.' : 'Follow your project, upload documents and see updates from the Rexera team.'}</p>
        <form className="mt-5 grid gap-3" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {!forgot && <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
          {error && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
          <Button type="submit" loading={busy} disabled={!email.trim() || (!forgot && !password)}>{forgot ? 'Send reset link' : 'Sign in'}</Button>
          <button type="button" className="text-sm font-semibold text-brand-ink hover:underline" onClick={() => { setForgot(!forgot); setError('') }}>{forgot ? 'Back to sign in' : 'Forgot password?'}</button>
        </form>
      </Card>
      <p className="mt-4 text-center text-xs text-mute">No account yet? Your Rexera contact sends you an invite by email.</p>
    </Frame>
  )
}

// ================================================================== set a password (invite or reset link)
function Welcome() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const reset = params.has('reset')
  const [state, setState] = useState<'wait' | 'ready' | 'expired'>('wait')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let done = false, unsub = () => {}, timer: ReturnType<typeof setTimeout> | undefined
    const ready = (mail?: string) => { if (done) return; done = true; setEmail(mail ?? ''); setState('ready') }
    // the link's sign-in arrives in the address (#access_token=…); the library reads it on start-up
    const hashError = new URLSearchParams(location.hash.slice(1)).get('error_description')
    void getPortalSupabase().then(async (sb) => {
      const { data: { subscription } } = sb.auth.onAuthStateChange((_e, s) => { if (s) ready(s.user.email) })
      unsub = () => subscription.unsubscribe()
      const { data: { session } } = await sb.auth.getSession()
      if (session) ready(session.user.email)
      timer = setTimeout(() => { if (!done) setState('expired') }, hashError ? 0 : 4000)
    }, () => setState('expired'))
    return () => { unsub(); clearTimeout(timer) }
  }, [])
  const save = async () => {
    setBusy(true); setError('')
    try {
      const { error: e } = await (await getPortalSupabase()).auth.updateUser({ password })
      if (e) throw new Error(e.message)
      await api('session', {})
      nav('/portal/home', { replace: true })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <Frame>
      <Card className="p-6">
        {state === 'wait' && <p className="flex items-center gap-2 text-sm text-mute"><Loader2 className="size-4 animate-spin" />Checking your link…</p>}
        {state === 'expired' && <>
          <h1 className="text-xl font-extrabold">This link has expired</h1>
          <p className="mt-2 text-sm text-mute">Links work once and for a short time. Ask for a new one on the sign-in page (“Forgot password?”) or from your Rexera contact.</p>
          <Link to="/portal"><Button className="mt-4">Go to sign in</Button></Link>
        </>}
        {state === 'ready' && <>
          <h1 className="text-xl font-extrabold">{reset ? 'Choose a new password' : 'Welcome — set your password'}</h1>
          <p className="mt-1 text-sm text-mute">For {email}. At least 8 characters, with letters and a number.</p>
          <form className="mt-5 grid gap-3" onSubmit={(e) => { e.preventDefault(); void save() }}>
            <Input label="New password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={password && !PASSWORD_OK(password) ? 'At least 8 characters with letters and a number.' : undefined} />
            <Input label="Repeat the password" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} error={again && again !== password ? 'The two don’t match.' : undefined} />
            {error && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
            <Button type="submit" icon={KeyRound} loading={busy} disabled={!PASSWORD_OK(password) || password !== again}>Save and continue</Button>
          </form>
        </>}
      </Card>
    </Frame>
  )
}

// ================================================================== the portal
function Home() {
  const nav = useNavigate()
  const toast = useToast()
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState('')
  const [pid, setPid] = useState('')
  const load = useCallback(async () => {
    try { const r = await api<Me>('me'); setMe(r); setError('') } catch (e) {
      if (e instanceof SignedOut) { await (await getPortalSupabase()).auth.signOut().catch(() => undefined); nav('/portal', { replace: true }); return }
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [nav])
  useEffect(() => {
    void load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [load])
  const signOut = async () => { await (await getPortalSupabase()).auth.signOut().catch(() => undefined); nav('/portal', { replace: true }) }
  const right = <Button size="sm" variant="ghost" icon={LogOut} onClick={signOut}>Sign out</Button>
  if (!me) return <Frame wide right={right}>{error ? <Card className="p-6"><p className="text-sm text-bad">{error}</p><Button className="mt-3" icon={RefreshCw} onClick={load}>Try again</Button></Card> : <Loader2 className="mx-auto mt-16 size-6 animate-spin text-mute" />}</Frame>
  const p = me.projects.find((x) => x.id === pid) ?? me.projects[0]
  return (
    <Frame wide right={right}>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1"><h1 className="text-2xl font-extrabold">Hello, {me.account.name.split(' ')[0]}</h1><p className="text-sm text-mute">{me.account.lastLoginAt ? `Last signed in ${fmtDateTime(me.account.lastLoginAt)}` : 'Welcome to your client portal'}</p></div>
        {me.projects.length > 1 && (
          <select aria-label="Project" value={p?.id} onChange={(e) => setPid(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-3 text-sm">
            {me.projects.map((x) => <option key={x.id} value={x.id}>{x.company} · {x.service}</option>)}
          </select>
        )}
      </div>
      {me.notices.length > 0 && (
        <Card className="mb-5 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold"><Bell className="size-4" />For you</p>
          <ul className="grid gap-1.5">{me.notices.slice(0, 8).map((n, i) => <li key={i} className="flex items-start gap-2 text-sm"><Badge tone={n.tone} dot>{fmtDate(n.at)}</Badge><span>{n.text}</span></li>)}</ul>
        </Card>
      )}
      {!p ? <Card className="p-6 text-sm text-mute">No project is linked to your account yet. Your Rexera contact will add it.</Card> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid min-w-0 content-start gap-5">
            <Card className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-mute">{p.code}</p>
              <h2 className="text-lg font-extrabold">{p.company}</h2>
              <p className="text-sm text-mute">{p.service} · since {fmtDate(p.since)}</p>
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-sm"><b>Progress</b><span className="font-semibold">{p.progress == null ? 'Getting started' : `${p.progress}%`}</span></div>
                <Progress value={p.progress ?? 0} tone={p.progress === 100 ? 'green' : 'orange'} />
              </div>
            </Card>
            <Documents p={p} onChange={load} toast={toast} />
            <Milestones p={p} />
            <Updates p={p} toast={toast} />
            <FromRexera media={me.media ?? []} toast={toast} />
          </div>
          <div className="grid content-start gap-5">
            <ContactCard person={p.contact ?? me.contact} />
            <Profile me={me} onSaved={load} toast={toast} />
            <Card className="overflow-hidden">
              <CardHeader title="Recent activity" icon={Clock3} />
              <ul className="divide-y divide-line/70">
                {me.activity.slice(0, 12).map((a, i) => <li key={i} className="px-5 py-2 text-xs"><span className="text-mute">{fmtDateTime(a.at)}</span><span className="block font-semibold">{a.text}</span>{a.detail && <span className="block text-mute">{a.detail}</span>}</li>)}
                {!me.activity.length && <li className="px-5 py-3 text-xs text-mute">Nothing yet.</li>}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </Frame>
  )
}

type Toast = ReturnType<typeof useToast>
const openPortalFile = async (id: string, toast: Toast) => {
  // the tab opens at the click (browsers block tabs opened later); the short-lived link is filled in once it arrives
  const w = window.open('', '_blank')
  try { const r = await api<{ url: string }>('file', undefined, `?id=${encodeURIComponent(id)}`); if (w) { w.opener = null; w.location.href = r.url } else location.href = r.url }
  catch (e) { w?.close(); toast('error', e instanceof Error ? e.message : String(e)) }
}

function Documents({ p, onChange, toast }: { p: PProject; onChange: () => Promise<void>; toast: Toast }) {
  const [busy, setBusy] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const target = useRef<PDoc | null>(null)
  const upload = async (f: File) => {
    const d = target.current
    if (!d) return
    if (f.size > 5 * 1024 * 1024) { toast('error', `${f.name} is larger than 5 MB.`); return }
    setBusy(d.category)
    try {
      const r = await api<{ message: string }>('upload', { bookingId: p.id, category: d.category, uploadId: `cu-${randomId()}`, file: { name: f.name, type: f.type, data: await toBase64(f) } })
      toast('success', r.message)
      await onChange()
    } catch (e) { toast('error', e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Your documents" icon={FileText} subtitle="Upload what we ask for — our team reviews each file" />
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} />
      {!p.docs.length ? <p className="px-5 py-4 text-sm text-mute">Nothing to upload right now.</p> : (
        <ul className="divide-y divide-line/70">
          {p.docs.map((d) => {
            const s = CLIENT_DOC_STATUS[d.status]
            return (
              <li key={d.category} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <b className="text-sm">{d.label}</b>
                  {d.remark && <span className={cx('mt-1 block rounded-lg px-2.5 py-1.5 text-xs', d.status === 'RESUBMISSION' ? 'bg-bad-soft text-bad' : 'bg-card2')}>{d.remark}</span>}
                  {d.files.length > 0 && <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">{d.files.map((f) => <button key={f.id} type="button" onClick={() => openPortalFile(f.id, toast)} className="text-xs font-semibold text-brand-ink hover:underline">{f.name}<span className="font-normal text-mute"> · {fileSize(f.size)} · {f.at ? fmtDate(f.at) : ''}</span></button>)}</span>}
                </span>
                <Badge tone={s.tone}>{s.label}</Badge>
                {d.canUpload && <Button size="sm" variant={d.status === 'SUBMITTED' ? 'outline' : 'primary'} icon={Upload} loading={busy === d.category} onClick={() => { target.current = d; input.current?.click() }}>{d.status === 'SUBMITTED' ? 'Replace' : 'Upload'}</Button>}
              </li>
            )
          })}
        </ul>
      )}
      <p className="border-t border-line px-5 py-2 text-[11px] text-mute">PDF, image or Word, up to 5 MB each.</p>
    </Card>
  )
}

function Milestones({ p }: { p: PProject }) {
  if (!p.milestones.length) return null
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Milestones" icon={Flag} />
      <ol className="px-5 py-3">
        {p.milestones.map((m, i) => (
          <li key={m.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < p.milestones.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-line" />}
            <span className={cx('z-10 grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white', m.status === 'DONE' ? 'bg-ok' : m.status === 'IN_PROGRESS' ? 'bg-accent' : 'bg-line text-mute')}>{m.status === 'DONE' ? <CheckCircle2 className="size-4" /> : i + 1}</span>
            <span className="min-w-0 flex-1 text-sm"><b>{m.title}</b>
              <span className="block text-xs text-mute">{m.status === 'DONE' ? `Done${m.doneAt ? ` ${fmtDate(m.doneAt)}` : ''}` : m.status === 'IN_PROGRESS' ? 'In progress' : 'Coming up'}{m.due && m.status !== 'DONE' ? ` · target ${fmtDate(m.due)}` : ''}{m.tasksTotal ? ` · ${m.tasksDone} of ${m.tasksTotal} steps` : ''}</span></span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function Updates({ p, toast }: { p: PProject; toast: Toast }) {
  if (!p.updates.length) return null
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Updates from the team" icon={Megaphone} />
      <ul className="divide-y divide-line/70">
        {p.updates.map((u) => (
          <li key={u.id} className="px-5 py-3 text-sm"><p className="flex flex-wrap items-baseline gap-2"><b>{u.title}</b><span className="text-xs text-mute">{fmtDateTime(u.at)}</span></p>
            <p className="mt-1 whitespace-pre-line text-ink/85">{u.text}</p>
            {u.file && <button type="button" onClick={() => openPortalFile(u.file!.id, toast)} className="mt-1 text-xs font-semibold text-brand-ink hover:underline">{u.file.name}</button>}</li>
        ))}
      </ul>
    </Card>
  )
}

function FromRexera({ media, toast }: { media: Me['media']; toast: Toast }) {
  if (!media.length) return null
  return (
    <Card className="overflow-hidden">
      <CardHeader title="From Rexera" icon={Megaphone} subtitle="Posts, flyers and videos for you" />
      <ul className="divide-y divide-line/70">
        {media.map((m) => (
          <li key={m.id} className="px-5 py-3 text-sm">
            <p className="flex flex-wrap items-baseline gap-2"><b>{m.title}</b><span className="text-xs text-mute">{m.scheme} · {fmtDate(m.at)}</span></p>
            {m.description && <p className="mt-1 whitespace-pre-line text-ink/85">{m.description}</p>}
            <span className="mt-1 flex flex-wrap gap-x-3">{m.files.map((f) => <button key={f.id} type="button" onClick={() => openPortalFile(f.id, toast)} className="text-xs font-semibold text-brand-ink hover:underline">{f.name} <span className="font-normal text-mute">· {fileSize(f.size)}</span></button>)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function ContactCard({ person }: { person: PPerson | null }) {
  if (!person) return null
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-mute">Your contact at Rexera</p>
      <p className="mt-1 font-bold">{person.name}</p>
      {person.phone && <a href={`tel:${person.phone}`} className="mt-1 flex items-center gap-2 text-sm text-brand-ink hover:underline"><Phone className="size-4" />{person.phone}</a>}
      {person.email && <a href={`mailto:${person.email}`} className="mt-1 flex items-center gap-2 text-sm text-brand-ink hover:underline"><Mail className="size-4" />{person.email}</a>}
    </Card>
  )
}

function Profile({ me, onSaved, toast }: { me: Me; onSaved: () => Promise<void>; toast: Toast }) {
  const [name, setName] = useState(me.account.name)
  const [phone, setPhone] = useState(me.account.phone ?? '')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { const r = await api<{ message: string }>('profile', { name, phone, message }); toast('success', r.message); setMessage(''); await onSaved() }
    catch (e) { toast('error', e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Your profile" icon={UserIcon} subtitle={me.account.email} />
      <form className="grid gap-3 p-5" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Mobile" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Textarea label="Message to the team (optional)" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} hint="e.g. a change to your company details" />
        <Button type="submit" variant="outline" loading={busy} disabled={name.trim().length < 2}>Save</Button>
      </form>
    </Card>
  )
}
