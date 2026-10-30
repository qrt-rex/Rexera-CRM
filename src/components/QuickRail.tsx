import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  BookMarked, CalendarClock, CalendarDays, Check, ChevronDown, ExternalLink, Images, Layers, Megaphone, PanelRightClose, PanelRightOpen, Search, Sparkles, X, type LucideIcon,
} from 'lucide-react'
import { useDb } from '../lib/store'
import { useAuth, useMe } from '../lib/auth'
import { ackBroadcast, userName } from '../lib/actions'
import { MODULES, canSee } from '../lib/modules'
import { rolesOf } from '../lib/rbac'
import { companyMedia } from '../lib/media'
import { CLIENT_ENTRY_STATUS, followUpDue, visibleClientEntries } from '../lib/clientEntries'
import { ago, daysBetween, fmtDate, inr, today } from '../lib/format'
import { Badge, cx, useRun } from './ui'

type Key = 'services' | 'schemes' | 'sales-kit' | 'content' | 'broadcasts' | 'events' | 'follow-ups'
interface Item { key: Key; label: string; desc: string; icon: LucideIcon; to: string; badge?: number }
const OPEN_KEY = 'rexera-quickrail'
const has = (q: string, ...parts: (string | number | undefined)[]) => !q || parts.join(' ').toLowerCase().includes(q)

/**
 * The right-hand quick menu: a button on the right edge opens an icon bar (like the left menu when it shows icons
 * only); each icon opens its information in a panel beside it — services and prices, schemes, the Sales Kit, flyers
 * and posts, broadcasts, events and follow-ups — to read at a glance without leaving the page. Each item follows the
 * same access as its page.
 */
export function QuickRail() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const loc = useLocation()
  const [rail, setRail] = useState(() => { try { return localStorage.getItem(OPEN_KEY) === 'open' } catch { return false } })
  const [open, setOpen] = useState<Key | null>(null)
  const toggleRail = () => setRail((v) => {
    try { localStorage.setItem(OPEN_KEY, v ? 'closed' : 'open') } catch { /* private mode */ }
    if (v) setOpen(null)
    return !v
  })
  // another page: the panel closes (the bar stays as it was)
  useEffect(() => { setOpen(null) }, [loc.pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const page = (k: string) => MODULES.find((m) => m.key === k)
  const allowed = (k: string) => { const m = page(k); return !!m && canSee(m, can, me) }
  const unacked = db.broadcasts.filter((b) => (b.audience === 'ALL' || b.audience.some((r) => rolesOf(me).includes(r))) && !b.acks.includes(me.id)).length
  const seller = rolesOf(me).some((r) => r === 'sales' || r === 'teamlead')
  const t = today()
  const dueEntries = seller ? visibleClientEntries(db, me).filter((e) => e.ownerId === me.id && followUpDue(e, t)).length : 0
  const dueLeads = seller ? db.leads.filter((l) => l.assignedTo === me.id && l.followUp && l.followUp <= t && !['CONVERTED', 'NOT_INTERESTED', 'WRONG_NUMBER', 'DND', 'SCRAP'].includes(l.status)).length : 0
  const items: Item[] = ([
    allowed('services') && { key: 'services', label: 'Services & prices', desc: 'Every service with its price', icon: Layers, to: '/services' },
    allowed('schemes') && { key: 'schemes', label: 'Schemes', desc: 'Government schemes & offers', icon: Sparkles, to: '/schemes' },
    allowed('sales-kit') && { key: 'sales-kit', label: 'Sales Kit', desc: 'Benefits, eligibility, last date, our charge', icon: BookMarked, to: '/sales-kit' },
    allowed('content') && { key: 'content', label: 'Flyers & posts', desc: 'Latest marketing material', icon: Images, to: '/content?tab=FLYER' },
    allowed('broadcasts') && { key: 'broadcasts', label: 'Broadcasts', desc: 'Company updates', icon: Megaphone, to: '/broadcasts', badge: unacked },
    allowed('events') && { key: 'events', label: 'Events', desc: 'Meetings, trainings, holidays', icon: CalendarDays, to: '/events' },
    seller && { key: 'follow-ups', label: 'My follow-ups', desc: 'Client entries and leads due today', icon: CalendarClock, to: '/client-entries', badge: dueEntries + dueLeads },
  ] as (Item | false)[]).filter(Boolean) as Item[]
  const cur = items.find((i) => i.key === open)
  if (!items.length) return null

  return (
    <div className="no-print">
      {/* the bar and its button on the right edge */}
      <div className="fixed right-0 top-1/2 z-[65] flex -translate-y-1/2 items-center">
        {!rail && (
          <button type="button" onClick={toggleRail} aria-expanded={false} aria-label="Show the quick menu" title="Quick menu"
            className="relative grid h-14 w-7 place-items-center rounded-l-2xl border border-r-0 border-line bg-card text-mute shadow-card transition hover:w-8 hover:text-brand-ink">
            <PanelRightOpen className="size-4" />
            {items.some((i) => i.badge) && <span className="absolute -left-1 -top-1 size-2.5 rounded-full bg-accent ring-2 ring-card" />}
          </button>
        )}
        {rail && (
          <nav aria-label="Quick menu" className="anim-fade-up flex flex-col gap-0.5 rounded-l-2xl border border-r-0 border-line bg-card p-2 shadow-pop">
            <button type="button" onClick={toggleRail} aria-expanded aria-label="Hide the quick menu" title="Hide the quick menu"
              className="grid size-11 place-items-center rounded-xl text-mute transition hover:bg-card2 hover:text-ink"><PanelRightClose className="size-[18px]" /></button>
            <span className="mx-2 my-1 h-px bg-line" aria-hidden />
            {items.map((i) => (
              <button key={i.key} type="button" onClick={() => setOpen(open === i.key ? null : i.key)} aria-pressed={open === i.key} title={i.label}
                className={cx('relative grid size-11 place-items-center rounded-xl transition', open === i.key ? 'bg-brand-soft text-brand-ink' : 'text-ink/80 hover:bg-card2 hover:text-ink')}>
                <i.icon className="size-[18px]" /><span className="sr-only">{i.label}</span>
                {!!i.badge && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">{i.badge > 9 ? '9+' : i.badge}</span>}
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* the information of the picked item, beside the bar */}
      {rail && cur && (
        <section role="dialog" aria-label={cur.label}
          className="anim-pop fixed right-[68px] top-20 z-[66] flex max-h-[calc(100dvh-6.5rem)] w-[min(420px,calc(100vw-84px))] flex-col overflow-hidden rounded-3xl border border-line bg-card shadow-pop">
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink"><cur.icon className="size-5" /></span>
            <span className="min-w-0 flex-1"><b className="block truncate">{cur.label}</b><span className="block truncate text-xs text-mute">{cur.desc}</span></span>
            <Link to={cur.to} title="Open the full page" aria-label="Open the full page" className="grid size-9 place-items-center rounded-xl text-mute hover:bg-card2 hover:text-ink"><ExternalLink className="size-4" /></Link>
            <button type="button" aria-label="Close" onClick={() => setOpen(null)} className="grid size-9 place-items-center rounded-xl text-mute hover:bg-card2 hover:text-ink"><X className="size-4" /></button>
          </header>
          <Panel k={cur.key} />
        </section>
      )}
    </div>
  )
}

/** Search box + scrolling body, shared by every panel. */
function Body({ q, setQ, placeholder, children, footer }: { q?: string; setQ?: (v: string) => void; placeholder?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      {setQ && (
        <label className="relative mx-4 mt-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mute" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder}
            className="h-9 w-full rounded-xl border border-line bg-card2 pl-9 pr-3 text-sm outline-none focus:border-brand focus:bg-card" />
        </label>
      )}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">{children}</div>
      {footer && <div className="border-t border-line px-4 py-2.5 text-xs text-mute">{footer}</div>}
    </>
  )
}
const Empty = ({ text }: { text: string }) => <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-mute">{text}</p>
/** One information box: title line, a few labelled facts, more on click. */
function Box({ title, right, sub, facts, more, accent }: { title: ReactNode; right?: ReactNode; sub?: ReactNode; facts?: [string, ReactNode][]; more?: ReactNode; accent?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <article className={cx('rounded-2xl border border-line bg-card p-3 shadow-sm transition hover:border-brand/30', accent)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1"><p className="text-sm font-bold leading-snug">{title}</p>{sub && <p className="mt-0.5 text-[11px] text-mute">{sub}</p>}</div>
        {right}
      </div>
      {facts && facts.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {facts.map(([k, v]) => <div key={k} className="contents"><dt className="font-semibold text-mute">{k}</dt><dd className={cx(!open && 'line-clamp-2')}>{v}</dd></div>)}
        </dl>
      )}
      {(more || (facts?.length ?? 0) > 0) && (
        <>
          {open && more && <div className="mt-2 text-xs">{more}</div>}
          <button type="button" onClick={() => setOpen(!open)} className="mt-1.5 inline-flex items-center gap-0.5 text-[11px] font-semibold text-brand-ink hover:underline">{open ? 'Less' : 'More'}<ChevronDown className={cx('size-3 transition', open && 'rotate-180')} /></button>
        </>
      )}
    </article>
  )
}

function Panel({ k }: { k: Key }) {
  switch (k) {
    case 'services': return <ServicesPanel />
    case 'schemes': return <SchemesPanel />
    case 'sales-kit': return <SalesKitPanel />
    case 'content': return <ContentPanel />
    case 'broadcasts': return <BroadcastsPanel />
    case 'events': return <EventsPanel />
    case 'follow-ups': return <FollowUpsPanel />
  }
}

function ServicesPanel() {
  const db = useDb()
  const [q, setQ] = useState('')
  const ql = q.trim().toLowerCase()
  const list = db.services.filter((s) => s.active && has(ql, s.name, s.category))
  const cats = [...new Set(list.map((s) => s.category))]
  return (
    <Body q={q} setQ={setQ} placeholder="Search services…" footer={`${list.length} services · prices before GST`}>
      {!list.length ? <Empty text="No service matches." /> : cats.map((c) => (
        <div key={c}>
          <p className="mb-1 mt-1 text-[11px] font-bold uppercase tracking-wide text-brand-ink">{c}</p>
          <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line">
            {list.filter((s) => s.category === c).map((s) => {
              const extra = Object.entries(s.prices ?? {}).filter(([, v]) => v && v !== s.price)
              return (
                <li key={s.id} className="flex items-start gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 text-sm"><span className="block font-semibold leading-snug">{s.name}</span>
                    {extra.length > 0 && <span className="mt-0.5 flex flex-wrap gap-1">{extra.map(([t, v]) => <span key={t} className="rounded-md bg-card2 px-1.5 py-0.5 text-[10px] text-mute">{t.replace('_', ' ').toLowerCase()} {inr(Number(v))}</span>)}</span>}
                  </span>
                  <span className="text-right"><b className="text-sm tabular-nums">{inr(s.price)}</b><span className="block text-[10px] text-mute">GST {s.gstRate}%</span></span>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </Body>
  )
}

function SchemesPanel() {
  const db = useDb()
  const [q, setQ] = useState('')
  const ql = q.trim().toLowerCase()
  const t = today()
  const list = db.schemes.filter((s) => s.active && (!s.endDate || s.endDate >= t) && has(ql, s.title, s.category, s.benefit, s.eligibility))
    .sort((a, b) => (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999'))
  return (
    <Body q={q} setQ={setQ} placeholder="Search schemes…" footer={`${list.length} open schemes · closing soonest first`}>
      {!list.length ? <Empty text="No open scheme matches." /> : list.map((s) => {
        const left = s.endDate ? daysBetween(t, s.endDate) : null
        return (
          <Box key={s.id} title={s.title} sub={s.category}
            right={left !== null ? <Badge tone={left <= 7 ? 'red' : left <= 30 ? 'amber' : 'green'}>{left === 0 ? 'Ends today' : `${left}d left`}</Badge> : <Badge tone="green">Open</Badge>}
            facts={[['Benefit', s.benefit], ['Eligibility', s.eligibility], ...(s.price ? [['Our price', inr(s.price)] as [string, ReactNode]] : []), ...(s.endDate ? [['Closes', fmtDate(s.endDate)] as [string, ReactNode]] : [])]}
            more={s.summary && <p className="whitespace-pre-line text-mute">{s.summary}</p>} />
        )
      })}
    </Body>
  )
}

function SalesKitPanel() {
  const db = useDb()
  const [q, setQ] = useState('')
  const kit = useMemo(() => db.salesKit ?? [], [db.salesKit])
  const cats = [...new Set(kit.map((x) => x.category))]
  const [cat, setCat] = useState('')
  const ql = q.trim().toLowerCase()
  const list = kit.filter((x) => (!cat || x.category === cat) && has(ql, x.name, x.benefits, x.eligibility, x.sectors, x.organisation)).sort((a, b) => a.category.localeCompare(b.category) || a.position - b.position)
  return (
    <Body q={q} setQ={setQ} placeholder="Search the Sales Kit…" footer={`${list.length} of ${kit.length} schemes`}>
      <div className="-mt-1 flex flex-wrap gap-1.5 pb-1">
        {['', ...cats].map((c) => <button key={c || 'all'} type="button" onClick={() => setCat(c)} className={cx('rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', cat === c ? 'border-brand bg-brand text-white' : 'border-line hover:bg-card2')}>{c || 'All'}</button>)}
      </div>
      {!list.length ? <Empty text="Nothing matches." /> : list.map((x) => (
        <Box key={x.id} title={x.name} sub={[x.category, x.schemeType, x.organisation].filter(Boolean).join(' · ')}
          right={x.minCharge && <span className="max-w-28 text-right text-[11px] font-semibold text-brand-ink">{x.minCharge}</span>}
          facts={[['Benefits', <span className="whitespace-pre-line">{x.benefits}</span>], ['Eligibility', <span className="whitespace-pre-line">{x.eligibility}</span>], ['Last date', x.lastDate || '—']]}
          more={<>{x.sectors && <p><b>Sectors:</b> <span className="whitespace-pre-line">{x.sectors}</span></p>}{x.applicableFor && <p className="mt-1"><b>For:</b> {x.applicableFor}</p>}{x.registrationCharge && <p className="mt-1"><b>Registration:</b> {x.registrationCharge}</p>}</>} />
      ))}
    </Body>
  )
}

const POST_TONE: Record<string, string> = { navy: 'from-[#2E3A8C] to-[#4453b5]', orange: 'from-[#F47B20] to-[#f59e0b]', green: 'from-emerald-600 to-teal-500', violet: 'from-violet-600 to-fuchsia-500', red: 'from-rose-600 to-orange-500', blue: 'from-sky-600 to-indigo-500' }
function ContentPanel() {
  const db = useDb()
  const me = useMe()
  const nav = useNavigate()
  const [kind, setKind] = useState<'FLYER' | 'POST'>('FLYER')
  const posts = db.posts.filter((p) => p.kind === kind).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt.localeCompare(a.createdAt))
  const media = companyMedia(db, me).filter((m) => (kind === 'FLYER' ? m.mediaType === 'FLYER' || m.mediaType === 'POSTER' : m.mediaType === 'POST'))
  return (
    <Body footer="Download, share or copy them on the full page">
      <div className="flex gap-1.5">{(['FLYER', 'POST'] as const).map((k) => <button key={k} type="button" onClick={() => setKind(k)} className={cx('rounded-full border px-3 py-1 text-xs font-semibold', kind === k ? 'border-brand bg-brand text-white' : 'border-line hover:bg-card2')}>{k === 'FLYER' ? 'Flyers' : 'Posts'}</button>)}</div>
      {!posts.length && !media.length ? <Empty text={`No ${kind === 'FLYER' ? 'flyers' : 'posts'} yet.`} /> : (
        <div className="grid grid-cols-2 gap-2">
          {media.map((m) => (
            <button key={m.id} type="button" onClick={() => nav(`/content?tab=${kind}`)} className="overflow-hidden rounded-xl border border-line text-left hover:border-brand/40">
              <span className="grid aspect-[4/3] place-items-center bg-card2 text-[10px] font-semibold uppercase text-mute">{m.mediaType.toLowerCase()} · Digital Media</span>
              <span className="block truncate px-2 py-1.5 text-xs font-semibold">{m.title}</span>
            </button>
          ))}
          {posts.map((p) => (
            <button key={p.id} type="button" onClick={() => nav(`/content?tab=${kind}`)} className="overflow-hidden rounded-xl border border-line text-left hover:border-brand/40">
              <span className={cx('flex aspect-[4/3] flex-col justify-end bg-gradient-to-br p-2 text-white', POST_TONE[p.theme] ?? POST_TONE.navy)}>
                <span className="line-clamp-3 text-xs font-extrabold leading-tight">{p.title}</span>
              </span>
              <span className="block truncate px-2 py-1.5 text-[11px] text-mute">{userName(db, p.by)} · {ago(p.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
    </Body>
  )
}

function BroadcastsPanel() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const mine = rolesOf(me)
  const list = db.broadcasts.filter((b) => b.audience === 'ALL' || b.audience.some((r) => mine.includes(r))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20)
  const tone = { NORMAL: 'gray', HIGH: 'amber', URGENT: 'red' } as const
  return (
    <Body footer={`${list.filter((b) => !b.acks.includes(me.id)).length} not acknowledged yet`}>
      {!list.length ? <Empty text="No broadcasts." /> : list.map((b) => {
        const acked = b.acks.includes(me.id)
        return (
          <Box key={b.id} title={b.title} sub={`${userName(db, b.by)} · ${ago(b.at)}`} accent={!acked ? 'border-l-4 border-l-accent' : undefined}
            right={<Badge tone={tone[b.priority]}>{b.priority.toLowerCase()}</Badge>}
            facts={[['Message', <span className="whitespace-pre-line">{b.body}</span>]]}
            more={acked ? <p className="flex items-center gap-1 text-ok"><Check className="size-3.5" />You acknowledged this</p>
              : <button type="button" onClick={() => run(() => ackBroadcast(me, b.id), 'Acknowledged')} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110">Acknowledge</button>} />
        )
      })}
    </Body>
  )
}

function EventsPanel() {
  const db = useDb()
  const t = today()
  const list = db.events.filter((e) => e.date >= t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 25)
  const tone = { MEETING: 'navy', TRAINING: 'blue', HOLIDAY: 'red', DEADLINE: 'amber', CELEBRATION: 'orange' } as const
  return (
    <Body footer="Upcoming, soonest first">
      {!list.length ? <Empty text="Nothing scheduled." /> : list.map((e) => {
        const d = new Date(`${e.date}T00:00:00`)
        return (
          <div key={e.id} className="flex items-start gap-3 rounded-2xl border border-line p-3">
            <span className="grid w-12 shrink-0 rounded-xl bg-card2 py-1 text-center leading-tight"><span className="text-[10px] font-bold uppercase text-accent">{d.toLocaleDateString('en-IN', { month: 'short' })}</span><span className="text-lg font-extrabold">{d.getDate()}</span></span>
            <span className="min-w-0 flex-1"><b className="block text-sm leading-snug">{e.title}</b><span className="block text-xs text-mute">{e.kind === 'HOLIDAY' ? 'All day' : e.time}{e.date === t ? ' · today' : ` · in ${daysBetween(t, e.date)} day(s)`}</span>{e.description && <span className="mt-0.5 block text-xs">{e.description}</span>}</span>
            <Badge tone={tone[e.kind]}>{e.kind.toLowerCase()}</Badge>
          </div>
        )
      })}
    </Body>
  )
}

function FollowUpsPanel() {
  const db = useDb()
  const me = useMe()
  const t = today()
  const entries = visibleClientEntries(db, me).filter((e) => e.ownerId === me.id && followUpDue(e, t)).sort((a, b) => (a.followUp ?? '').localeCompare(b.followUp ?? ''))
  const leads = db.leads.filter((l) => l.assignedTo === me.id && l.followUp && l.followUp <= t && !['CONVERTED', 'NOT_INTERESTED', 'WRONG_NUMBER', 'DND', 'SCRAP'].includes(l.status)).sort((a, b) => (a.followUp ?? '').localeCompare(b.followUp ?? ''))
  const late = (d?: string) => (d && d < t ? <Badge tone="red">{daysBetween(d, t)}d late</Badge> : <Badge tone="amber">Today</Badge>)
  return (
    <Body footer={<span className="flex justify-between"><Link to="/client-entries" className="font-semibold text-brand-ink hover:underline">Client entries</Link><Link to="/dialer" className="font-semibold text-brand-ink hover:underline">Dialer</Link></span>}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink">Client entries · {entries.length}</p>
      {!entries.length ? <Empty text="No client entry follow-up due." /> : entries.map((e) => (
        <Box key={e.id} title={`${e.clientName} · ${e.companyName}`} sub={`${e.scheme} · pitched ${inr(e.pitchedPrice)}`} right={late(e.followUp)}
          facts={[['Status', CLIENT_ENTRY_STATUS[e.status].label], ['Number', <span className="font-mono">{e.phone}</span>], ['Last note', e.followUps[0]?.note ?? e.note]]} />
      ))}
      <p className="pt-2 text-[11px] font-bold uppercase tracking-wide text-brand-ink">Leads · {leads.length}</p>
      {!leads.length ? <Empty text="No lead follow-up due." /> : leads.map((l) => (
        <Box key={l.id} title={`${l.name}${l.company ? ` · ${l.company}` : ''}`} sub={`${l.code} · ${l.service}`} right={late(l.followUp)}
          facts={[['Number', <span className="font-mono">{l.phone}</span>], ['Calls', l.calls.length], ['Notes', l.notes || '—']]} />
      ))}
    </Body>
  )
}
