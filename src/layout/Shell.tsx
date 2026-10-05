import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell, ChevronDown, ChevronRight, Home, LayoutGrid, LogOut, Mail, Menu as MenuIcon, Moon, Search, Settings, ShieldCheck, Sun, UserCheck, X, Monitor,
} from 'lucide-react'
import { useDb } from '../lib/store'
import { applyTheme, getTheme, useAuth, useMe, type Theme } from '../lib/auth'
import { MODULES, canSee } from '../lib/modules'
import { ROLES, roleLabel } from '../lib/rbac'
import { markRead } from '../lib/actions'
import { ago } from '../lib/format'
import { Avatar, Button, cx, Menu, MenuItem } from '../components/ui'
import { Logo } from '../components/Logo'
import { MiniCalendar } from './MiniCalendar'
import { CommandPalette } from './CommandPalette'

export function useUnread() {
  const db = useDb()
  const me = useMe()
  return useMemo(() => ({
    notices: db.notices.filter((n) => n.userId === me.id && !n.read),
    messages: db.messages.filter((m) => m.to === me.id && !m.read).length,
  }), [db.notices, db.messages, me.id])
}

function pageTitle(path: string, role: string) {
  const dash = path.match(/^\/dashboard\/(\w+)/)
  if (dash) return `${roleLabel(dash[1] as never)} Dashboard`
  if (path.startsWith('/bookings/new')) return 'New CRM Entry'
  if (/^\/bookings\/.+/.test(path)) return 'CRM Entry'
  const m = [...MODULES].sort((a, b) => b.path.length - a.path.length).find((x) => path.startsWith(x.path.split('?')[0]!))
  return m?.label ?? `${roleLabel(role as never)} Dashboard`
}

export function Shell() {
  const me = useMe()
  const { can, signOut, warnIn, stayActive } = useAuth()
  const loc = useLocation()
  const nav = useNavigate()
  const unread = useUnread()
  const [mobileNav, setMobileNav] = useState(false)
  const [palette, setPalette] = useState(false)
  const [theme, setTheme] = useState<Theme>(getTheme)

  useEffect(() => { setMobileNav(false); window.scrollTo(0, 0) }, [loc.pathname])
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true) } }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  const title = pageTitle(loc.pathname, me.role)
  useEffect(() => { document.title = `${title} · Rexera CRM` }, [title])

  const cycleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    setTheme(next); applyTheme(next)
  }
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

  return (
    <div className="flex min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2">Skip to content</a>

      {/* Sidebar */}
      <div className={cx('fixed inset-0 z-40 bg-black/40 lg:hidden', mobileNav ? 'block' : 'hidden')} onClick={() => setMobileNav(false)} />
      <aside className={cx('no-print fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-r border-line bg-card transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
        mobileNav ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-16 items-center justify-between px-5">
          <Link to="/dashboard" aria-label="Home"><Logo /></Link>
          <button className="lg:hidden text-mute" onClick={() => setMobileNav(false)} aria-label="Close menu"><X className="size-5" /></button>
        </div>
        <Sidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-card/85 px-4 backdrop-blur-xl sm:px-6">
          <button className="text-mute lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open menu"><MenuIcon className="size-6" /></button>
          <h1 className="hidden min-w-0 truncate text-lg font-extrabold tracking-tight md:block md:w-64">{title}</h1>
          <button onClick={() => setPalette(true)} className="mx-auto flex h-11 w-full max-w-md items-center gap-3 rounded-full border-2 border-ink/80 bg-card px-4 text-sm text-mute transition hover:border-brand dark:border-line">
            <span className="flex-1 truncate text-left">Search clients, leads, pages…</span>
            <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[10px] sm:inline">Ctrl K</kbd>
            <Search className="size-5 text-ink" strokeWidth={2.5} />
          </button>
          <div className="flex items-center gap-1">
            <button onClick={cycleTheme} title={`Theme: ${theme}`} aria-label="Change theme" className="hidden size-10 place-items-center rounded-xl text-mute hover:bg-card2 hover:text-ink sm:grid"><ThemeIcon className="size-5" /></button>
            {can('messages.use') && (
              <Link to="/messages" aria-label="Messages" className="relative hidden size-10 place-items-center rounded-xl text-mute hover:bg-card2 hover:text-ink sm:grid">
                <Mail className="size-5" />
                {unread.messages > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white ring-2 ring-card">{unread.messages}</span>}
              </Link>
            )}
            <BellMenu />
            <Menu width="w-72" trigger={(open) => (
              <button className="ml-1 flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-card2" aria-expanded={open} aria-label="Account menu">
                <Avatar name={me.name} photo={me.photo} size={36} />
                <span className="hidden text-left leading-tight lg:block">
                  <span className="block max-w-32 truncate text-sm font-bold">{me.name}</span>
                  <span className="block text-[11px] text-mute">{roleLabel(me.role)}</span>
                </span>
                <ChevronDown className="hidden size-4 text-mute lg:block" />
              </button>
            )}>
              {(close) => (
                <>
                  <div className="flex items-center gap-3 border-b border-line p-4">
                    <Avatar name={me.name} photo={me.photo} size={44} />
                    <div className="min-w-0"><p className="truncate font-bold">{me.name}</p><p className="truncate text-xs text-mute">{me.email}</p></div>
                  </div>
                  <MenuItem icon={Settings} onClick={() => { close(); nav('/settings') }}>Profile settings</MenuItem>
                  <MenuItem icon={ShieldCheck} onClick={() => { close(); nav('/settings?tab=security') }}>Security</MenuItem>
                  <MenuItem icon={ThemeIcon} onClick={cycleTheme}>Theme: {theme}</MenuItem>
                  <div className="border-t border-line" />
                  <MenuItem icon={LogOut} danger onClick={() => { close(); signOut() }}>Sign out</MenuItem>
                </>
              )}
            </Menu>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <NotificationBubble />
      {warnIn !== null && (
        <div className="anim-pop fixed bottom-6 left-1/2 z-[95] flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-line bg-card px-5 py-3 shadow-pop">
          <span className="text-sm">You'll be signed out in <b>{Math.ceil(warnIn / 1000)}s</b> for inactivity.</span>
          <Button size="sm" onClick={stayActive}>Stay signed in</Button>
        </div>
      )}
    </div>
  )
}

function Sidebar() {
  const me = useMe()
  const { can } = useAuth()
  const unread = useUnread()
  const loc = useLocation()
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('rexera-nav') || '{}') } catch { return {} }
  })
  const toggle = (g: string) => setOpenGroups((s) => {
    const n = { ...s, [g]: !(s[g] ?? true) }
    try { localStorage.setItem('rexera-nav', JSON.stringify(n)) } catch { /* ignore */ }
    return n
  })
  const visible = MODULES.filter((m) => canSee(m, can) && !['attendance', 'notifications', 'security', 'users', 'system'].includes(m.key))
  const groups = [...new Set(visible.map((m) => m.group))]
  const item = 'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition'
  const active = 'bg-brand-soft text-brand-ink'
  const idle = 'text-ink/80 hover:bg-card2 hover:text-ink'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3" aria-label="Main">
        <NavLink to={`/dashboard/${me.role}`} className={({ isActive }) => cx(item, isActive ? active : idle)}><Home className="size-[18px]" />Dashboard</NavLink>
        <NavLink to="/attendance" className={({ isActive }) => cx(item, isActive ? active : idle)}><UserCheck className="size-[18px]" />Attendance Board</NavLink>
        {me.role === 'superadmin' && (
          <SideGroup label="All dashboards" open={openGroups['dash'] ?? false} onToggle={() => toggle('dash')} icon={LayoutGrid}>
            {ROLES.map((r) => (
              <NavLink key={r.id} to={`/dashboard/${r.id}`} className={({ isActive }) => cx(item, 'py-1.5 pl-9 text-[13px]', isActive ? active : idle)}>
                <span className="size-2 rounded-full" style={{ background: r.color }} />{r.label}
              </NavLink>
            ))}
          </SideGroup>
        )}
        {groups.map((g) => (
          <SideGroup key={g} label={g} open={openGroups[g] ?? true} onToggle={() => toggle(g)}>
            {visible.filter((m) => m.group === g).map((m) => (
              <NavLink key={m.key} to={m.path} className={() => cx(item, 'py-1.5 text-[13px]', loc.pathname.startsWith(m.path) ? active : idle)}>
                <m.icon className="size-4 opacity-80" />{m.label}
              </NavLink>
            ))}
          </SideGroup>
        ))}
        <div className="pt-3"><MiniCalendar /></div>
      </nav>
      <div className="space-y-0.5 border-t border-line p-3">
        <NavLink to="/settings" className={({ isActive }) => cx(item, isActive ? active : idle)}><Settings className="size-5" />Profile setting</NavLink>
        <NavLink to={can('messages.use') ? '/messages' : '/broadcasts'} className={({ isActive }) => cx(item, isActive ? active : idle)}>
          <Mail className="size-5" /><span className="flex-1">Email</span>
          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-brand-soft px-1.5 text-[11px] font-bold text-brand-ink">{unread.messages}</span>
        </NavLink>
        <NavLink to="/notifications" className={({ isActive }) => cx(item, isActive ? active : idle)}>
          <Bell className="size-5" /><span className="flex-1">Notification</span>
          <span className={cx('grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[11px] font-bold', unread.notices.length ? 'bg-bad text-white' : 'bg-card2 text-mute')}>{unread.notices.length}</span>
        </NavLink>
      </div>
    </div>
  )
}

function SideGroup({ label, open, onToggle, children, icon: Icon }: { label: string; open: boolean; onToggle: () => void; children: ReactNode; icon?: typeof Home }) {
  return (
    <div className="pt-2">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-mute hover:text-ink">
        {Icon && <Icon className="size-4" />}<span className="flex-1 text-left">{label}</span>
        <ChevronRight className={cx('size-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  )
}

function BellMenu() {
  const me = useMe()
  const db = useDb()
  const nav = useNavigate()
  const unread = useUnread()
  const list = useMemo(() => db.notices.filter((n) => n.userId === me.id).slice(0, 8), [db.notices, me.id])
  const dot = { info: 'bg-info', success: 'bg-ok', warning: 'bg-warn', action: 'bg-accent' }
  return (
    <Menu width="w-[min(92vw,380px)]" trigger={() => (
      <button aria-label="Notifications" className="relative grid size-10 place-items-center rounded-xl text-mute hover:bg-card2 hover:text-ink">
        <Bell className="size-5" />
        {unread.notices.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white ring-2 ring-card">{unread.notices.length}</span>}
      </button>
    )}>
      {(close) => (
        <>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-bold">Notifications</p>
            {unread.notices.length > 0 && <button className="text-xs font-semibold text-brand-ink hover:underline" onClick={() => markRead(me)}>Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!list.length && <p className="p-8 text-center text-sm text-mute">You're all caught up ✨</p>}
            {list.map((n) => (
              <button key={n.id} onClick={() => { markRead(me, n.id); close(); if (n.link) nav(n.link) }}
                className={cx('flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left hover:bg-card2', !n.read && 'bg-brand-soft/40')}>
                <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-line' : dot[n.kind])} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{n.title}</span>
                  <span className="block truncate text-xs text-mute">{n.body}</span>
                  <span className="text-[10px] text-mute">{ago(n.at)}</span>
                </span>
              </button>
            ))}
          </div>
          <button onClick={() => { close(); nav('/notifications') }} className="w-full py-2.5 text-center text-sm font-semibold text-brand-ink hover:bg-card2">View all</button>
        </>
      )}
    </Menu>
  )
}

export const POPUP_KEY = 'rexera-popup-off'
function NotificationBubble() {
  const me = useMe()
  const nav = useNavigate()
  const unread = useUnread()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [off] = useState(() => { try { return localStorage.getItem(POPUP_KEY) === '1' } catch { return false } })
  const n = unread.notices[0]
  if (off || !n || dismissed === n.id) return null
  return (
    <div className="no-print anim-fade-up fixed bottom-5 right-5 z-[60] w-[min(88vw,320px)]">
      <div className="relative rounded-[28px] border-[3px] border-ink bg-card p-4 pr-9 shadow-[6px_6px_0_var(--ink)] dark:border-line dark:shadow-pop">
        <button aria-label="Dismiss" className="absolute right-3 top-3 text-mute hover:text-ink" onClick={() => setDismissed(n.id)}><X className="size-4" /></button>
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-accent"><Bell className="size-3.5 anim-float" />New notification</p>
        <p className="mt-1 text-sm font-bold">{n.title}</p>
        <p className="line-clamp-2 text-xs text-mute">{n.body}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="accent" onClick={() => { markRead(me, n.id); if (n.link) nav(n.link) }}>View</Button>
          <Button size="sm" variant="ghost" onClick={() => markRead(me, n.id)}>Mark read</Button>
        </div>
        <svg className="absolute -bottom-[22px] right-8 text-ink dark:text-line" width="34" height="24" viewBox="0 0 34 24"><path d="M2 0 L30 22 L20 0" fill="var(--card)" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" /></svg>
      </div>
    </div>
  )
}
