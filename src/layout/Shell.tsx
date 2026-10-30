import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BadgeCheck, Bell, ChevronDown, ChevronRight, Home, LayoutGrid, LogOut, Mail, Menu as MenuIcon, Moon, Search, Settings, ShieldCheck, Sun, UserCheck, X, Monitor,
  HelpCircle, SlidersHorizontal, Users, CalendarCheck2, TrendingUp, GraduationCap, FileText, Inbox, PartyPopper, BarChart3,
  Wallet, Receipt, Landmark, Trophy, Briefcase, Wrench, MailPlus, ClipboardList, FilePen, Coffee, Package, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react'
import type { Perm, User } from '../lib/types'
import { Rexy } from '../components/hr/Mascots'
import { getDb, useDb } from '../lib/store'
import { builtinOn, runScheduledRules, startAutomations } from '../lib/automation'
import { startActivity, stopActivity, track } from '../lib/activity'
import { applyTheme, getTheme, useAuth, useMe, type Theme } from '../lib/auth'
import { MESSAGES_ENABLED, MODULES, canSee, moduleLabel } from '../lib/modules'
import { canOpenDashboard, isMaster, ROLES, roleLabel } from '../lib/rbac'
import { CLOUD } from '../lib/cloud'
import { markRead, overdueLeadsOf, runBreakMonitor, runComboReminders, runFollowUpReminders, runPrecheckReminders, runSchemeAlerts, runTaskReminders, unseenLeadsOf } from '../lib/actions'
import { runScheduledAutomations } from '../lib/email'
import { ago, today } from '../lib/format'
import { Avatar, Button, cx, Menu, MenuItem, Modal } from '../components/ui'
import { Logo, Mark } from '../components/Logo'
import { useMedia } from '../components/LoginShowcase'
import { MiniCalendar } from './MiniCalendar'
import { BreakBanner, BreakReminder } from '../pages/dashboards/widgets'
import { BreakPrompt } from '../components/BreakPrompt'
import { CommandPalette } from './CommandPalette'
import { AiAssistant } from '../components/AiAssistant'
import { QuickRail } from '../components/QuickRail'
import { ErrorBoundary } from '../components/ErrorBoundary'

export function useUnread() {
  const db = useDb()
  const me = useMe()
  return useMemo(() => ({
    notices: db.notices.filter((n) => n.userId === me.id && !n.read),
    messages: db.messages.filter((m) => m.to === me.id && !m.read).length,
    emails: db.emails.filter((e) => e.to === me.id && !e.read).length,
  }), [db.notices, db.messages, db.emails, me.id])
}

function pageTitle(path: string, me: User) {
  const role = me.role
  const dash = path.match(/^\/dashboard\/(\w+)/)
  if (dash) return `${roleLabel(dash[1] as never)} Dashboard`
  if (path.startsWith('/bookings/new')) return 'New CRM Entry'
  if (/^\/bookings\/.+/.test(path)) return 'CRM Entry'
  const m = [...MODULES].sort((a, b) => b.path.length - a.path.length).find((x) => path.startsWith(x.path.split('?')[0]!))
  return m ? moduleLabel(m, me) : `${roleLabel(role as never)} Dashboard`
}

export function Shell() {
  const me = useMe()
  const { can, signOut, warnIn, stayActive } = useAuth()
  const loc = useLocation()
  const nav = useNavigate()
  const unread = useUnread()
  const [mobileNav, setMobileNav] = useState(false)
  // desktop: the sidebar can shrink to its icons (remembered on this computer); phones keep the slide-in menu
  const desktop = useMedia('(min-width: 1024px)')
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('rexera-sidebar') === 'icons' } catch { return false } })
  const mini = collapsed && desktop
  const toggleSidebar = () => setCollapsed((c) => {
    try { localStorage.setItem('rexera-sidebar', c ? 'full' : 'icons') } catch { /* ignore */ }
    return !c
  })
  const [palette, setPalette] = useState(false)
  const [theme, setTheme] = useState<Theme>(getTheme)

  useEffect(() => { setMobileNav(false); window.scrollTo(0, 0) }, [loc.pathname])
  // Company-wide jobs (scheduled emails, task / combo reminders, lunch-break monitoring) change other people's records.
  // With Supabase only Super Admin / IT may do that, so only their browsers run them (in browser mode: everyone's).
  // ponytail: needs a Super Admin / IT browser open; a scheduled server job if they must run with nobody signed in
  const companyJobs = !CLOUD || isMaster(me)
  // scheduled email automations (daily reminders, monthly summaries) run while anyone has the app open
  useEffect(() => {
    if (!companyJobs) return
    // each built-in automation can be switched off by IT Support (Automation Center); daily-check rules run here too
    const jobs: [string, () => unknown][] = [
      ['scheduled-emails', runScheduledAutomations], ['task-reminders', runTaskReminders], ['combo-reminders', runComboReminders],
      ['file-follow-ups', runFollowUpReminders], ['pitch-deck-reminders', runPrecheckReminders], ['scheme-expiry-alerts', runSchemeAlerts], ['custom-rules', runScheduledRules],
    ]
    const tick = () => { for (const [key, run] of jobs) { try { if (builtinOn(getDb(), key)) run() } catch { /* never block the app */ } } }
    tick()
    const t = setInterval(tick, 5 * 60000)
    return () => clearInterval(t)
  }, [companyJobs])
  // event rules: run in this browser right after the change that starts them
  useEffect(() => { startAutomations() }, [])
  // user activity (IT Support → User activity): every page and click of the signed-in person
  useEffect(() => { startActivity(me); return () => stopActivity() }, [me.id, me.role])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { track('page', title || loc.pathname, { path: `${loc.pathname}${loc.search}` }) }, [loc.pathname, loc.search])  // eslint-disable-line react-hooks/exhaustive-deps
  // a new day starts at midnight even when the CRM was left open: redraw every page so dates, "today" and the
  // login / logout card move to the new day (checked every 30 s; nothing re-renders while the day is the same)
  const [, setDay] = useState(today)
  useEffect(() => {
    const i = setInterval(() => setDay((d) => (today() === d ? d : today())), 30000)
    const onShow = () => { if (document.visibilityState === 'visible') setDay((d) => (today() === d ? d : today())) }
    document.addEventListener('visibilitychange', onShow)
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', onShow) }
  }, [])
  // lunch break: reminder at the start, late warning a couple of minutes after the end — needs to be on time
  useEffect(() => {
    if (!companyJobs) return
    const tick = () => { try { if (builtinOn(getDb(), 'break-monitor')) runBreakMonitor() } catch { /* never block the app */ } }
    tick()
    const t = setInterval(tick, 30000)
    return () => clearInterval(t)
  }, [companyJobs])
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true) } }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  const maintenance = useDb().settings.maintenance
  const hrMode = me.role === 'hr' || loc.pathname.startsWith('/dashboard/hr') || HR_PATHS.some((p) => loc.pathname.startsWith(p))
  const [help, setHelp] = useState(false)
  const title = pageTitle(loc.pathname, me)
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
      <aside className={cx('no-print fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-line transition-[transform,width] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
        hrMode ? 'bg-gradient-to-b from-sky-50 via-sky-100/70 to-indigo-50 dark:from-[#0f1830] dark:via-[#111c38] dark:to-[#141a33]' : 'bg-card',
        mini ? 'w-[72px]' : hrMode ? 'w-64' : 'w-[272px]',
        mobileNav ? 'translate-x-0' : '-translate-x-full')}>
        <div className={cx('flex h-16 items-center', mini ? 'justify-center' : 'justify-between px-5')}>
          <Link to={`/dashboard/${me.role}`} aria-label="Home" title={mini ? 'Dashboard' : undefined}>{mini ? <Mark className="h-9" /> : <Logo />}</Link>
          <button className="lg:hidden text-mute" onClick={() => setMobileNav(false)} aria-label="Close menu"><X className="size-5" /></button>
        </div>
        {hrMode ? <HrSidebar mini={mini} /> : <Sidebar mini={mini} onExpand={toggleSidebar} />}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-card/85 px-4 backdrop-blur-xl sm:px-6">
          <button className="text-mute lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open menu"><MenuIcon className="size-6" /></button>
          <button onClick={toggleSidebar} aria-label={collapsed ? 'Show the full menu' : 'Hide the menu (icons only)'} title={collapsed ? 'Show the full menu' : 'Hide the menu (icons only)'} aria-pressed={collapsed}
            className="-ml-1 hidden size-10 shrink-0 place-items-center rounded-xl text-mute hover:bg-card2 hover:text-ink lg:grid">
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
          <h1 className="hidden min-w-0 truncate text-lg font-extrabold tracking-tight md:block md:w-64">{title}</h1>
          <button onClick={() => setPalette(true)} className="mx-auto flex h-10 w-full max-w-md items-center gap-3 rounded-xl border border-line bg-card2 px-3.5 text-sm text-mute transition hover:border-brand/50 hover:bg-card hover:shadow-card">
            <Search className="size-4 shrink-0 text-mute" />
            <span className="flex-1 truncate text-left">{hrMode ? 'Search employees, leads, pages…' : 'Search clients, leads, people…'}</span>
            <kbd className="hidden rounded-md border border-line bg-card px-1.5 py-0.5 text-[10px] font-semibold sm:inline">Ctrl K</kbd>
          </button>
          <div className="flex items-center gap-1">
            <button onClick={cycleTheme} title={`Theme: ${theme}`} aria-label="Change theme" className="hidden size-10 place-items-center rounded-xl text-mute hover:bg-card2 hover:text-ink sm:grid"><ThemeIcon className="size-5" /></button>
            {MESSAGES_ENABLED && can('messages.use') && (
              <Link to="/messages" aria-label="Messages" className="relative hidden size-10 place-items-center rounded-xl text-mute hover:bg-card2 hover:text-ink sm:grid">
                <Mail className="size-5" />
                {unread.messages > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white ring-2 ring-card">{unread.messages}</span>}
              </Link>
            )}
            <BellMenu />
            <button onClick={() => setHelp(true)} aria-label="Help" title="Help" className="hidden size-10 place-items-center rounded-xl text-mute hover:bg-card2 hover:text-ink sm:grid"><HelpCircle className="size-5" /></button>
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
                  <MenuItem icon={Settings} onClick={() => { close(); nav('/settings') }}>Profile</MenuItem>
                  <MenuItem icon={SlidersHorizontal} onClick={() => { close(); nav('/settings?tab=appearance') }}>Preferences</MenuItem>
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
          <BreakBanner />
          <BreakPrompt />
          {loc.pathname.startsWith('/dashboard') && <OverdueLeadsBanner />}
          {maintenance?.on && isMaster(me) && (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
              <Wrench className="size-4" /><b>Maintenance mode is on</b><span className="text-ink/70">Only IT Support and Super Admin can use the app.{maintenance.message ? ` Message: “${maintenance.message}”` : ''}</span>
              {canOpenDashboard(me, 'it') && <Link to="/dashboard/it" className="ml-auto font-semibold underline">Manage</Link>}
            </div>
          )}
          {maintenance?.on && !isMaster(me) ? (
            <div className="grid place-items-center py-16 text-center">
              {/* the company's maintenance picture: public/maintenance.jpg (hidden until that file is added) */}
              <img src="/maintenance.jpg" alt="Rexera CRM is under maintenance" className="mb-6 max-h-[45vh] w-auto max-w-full rounded-2xl object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none' }} />
              <span className="mb-4 grid size-16 place-items-center rounded-2xl bg-warn-soft text-warn"><Wrench className="size-8" /></span>
              <h2 className="text-xl font-extrabold">We'll be right back</h2>
              <p className="mt-1 max-w-md text-sm text-mute">Rexera CRM is under maintenance{maintenance.message ? `: ${maintenance.message}` : '.'} Your work is saved — please check back shortly.</p>
              <Button className="mt-5" variant="outline" icon={LogOut} onClick={() => signOut()}>Sign out</Button>
            </div>
          ) : <ErrorBoundary resetKey={loc.pathname} home={`/dashboard/${me.role}`}><Outlet /></ErrorBoundary>}
        </main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <Modal open={help} onClose={() => setHelp(false)} title="Help" size="sm">
        <ul className="space-y-3 text-sm">
          <li className="flex items-center justify-between gap-3"><span>Search anything</span><kbd className="rounded-md border border-line px-2 py-0.5 text-xs">Ctrl K</kbd></li>
          <li className="flex items-center justify-between gap-3"><span>Close a dialog</span><kbd className="rounded-md border border-line px-2 py-0.5 text-xs">Esc</kbd></li>
          <li className="text-mute">Missing a page or permission? Ask a Super Admin to update your access in Access Management.</li>
        </ul>
      </Modal>
      <NotificationBubble />
      <BreakReminder />
      <AiAssistant />
      <QuickRail />
      {warnIn !== null && (
        <div className="anim-pop fixed bottom-6 left-1/2 z-[95] flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-line bg-card px-5 py-3 shadow-pop">
          <span className="text-sm">You'll be signed out in <b>{Math.ceil(warnIn / 1000)}s</b> for inactivity.</span>
          <Button size="sm" onClick={stayActive}>Stay signed in</Button>
        </div>
      )}
    </div>
  )
}

/** A menu item's name: hidden (but read out and shown on hover) when the menu is icons only. */
const Label = ({ mini, children }: { mini?: boolean; children: ReactNode }) => <span className={mini ? 'sr-only' : 'flex-1 truncate'}>{children}</span>

function Sidebar({ mini, onExpand }: { mini: boolean; onExpand: () => void }) {
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
  const visible = MODULES.filter((m) => canSee(m, can, me) && !m.hrOnly && !['attendance', 'notifications', 'security', 'users', 'system', 'inbox'].includes(m.key))
  const groups = [...new Set(visible.map((m) => m.group))]
  const item = cx('relative flex items-center gap-3 rounded-xl py-2 text-sm font-semibold transition', mini ? 'justify-center px-0' : 'px-3')
  const active = 'bg-brand-soft text-brand-ink'
  const idle = 'text-ink/80 hover:bg-card2 hover:text-ink'

  if (mini) return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-3" aria-label="Main">
        <NavLink to={`/dashboard/${me.role}`} title="Dashboard" className={({ isActive }) => cx(item, isActive ? active : idle)}><Home className="size-[18px]" /><Label mini>Dashboard</Label></NavLink>
        <NavLink to="/attendance" title="Attendance Board" className={({ isActive }) => cx(item, isActive ? active : idle)}><UserCheck className="size-[18px]" /><Label mini>Attendance Board</Label></NavLink>
        {isMaster(me) && <button onClick={() => { if (!(openGroups['dash'] ?? false)) toggle('dash'); onExpand() }} title="All dashboards" className={cx(item, 'w-full', idle)}><LayoutGrid className="size-[18px]" /><Label mini>All dashboards</Label></button>}
        {groups.map((g) => (
          <div key={g} className="space-y-0.5 border-t border-line/70 pt-1.5 mt-1.5" role="group" aria-label={g}>
            {visible.filter((m) => m.group === g).map((m) => (
              <NavLink key={m.key} to={m.path} title={moduleLabel(m, me)} className={() => cx(item, loc.pathname.startsWith(m.path) ? active : idle)}>
                <m.icon className="size-[18px] opacity-80" /><Label mini>{moduleLabel(m, me)}</Label>
                {m.key === 'leads' && <LeadsDot />}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-line p-2.5">
        <NavLink to="/settings" title="Profile Settings" className={({ isActive }) => cx(item, isActive ? active : idle)}><Settings className="size-5" /><Label mini>Profile Settings</Label></NavLink>
        <NavLink to="/inbox" title={`Email${unread.emails ? ` (${unread.emails} unread)` : ''}`} className={({ isActive }) => cx(item, isActive ? active : idle)}>
          <Mail className="size-5" /><Label mini>Email</Label>
          {unread.emails > 0 && <span className="absolute right-2 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">{unread.emails}</span>}
        </NavLink>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3" aria-label="Main">
        <NavLink to={`/dashboard/${me.role}`} className={({ isActive }) => cx(item, isActive ? active : idle)}><Home className="size-[18px]" />Dashboard</NavLink>
        <NavLink to="/attendance" className={({ isActive }) => cx(item, isActive ? active : idle)}><UserCheck className="size-[18px]" />Attendance Board</NavLink>
        {isMaster(me) && (
          <SideGroup label="All dashboards" open={openGroups['dash'] ?? false} onToggle={() => toggle('dash')} icon={LayoutGrid}>
            {ROLES.filter((r) => canOpenDashboard(me, r.id)).map((r) => (
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
                <m.icon className="size-4 opacity-80" /><span className="flex-1">{moduleLabel(m, me)}</span>
                {m.key === 'leads' && <LeadsBadge />}
              </NavLink>
            ))}
          </SideGroup>
        ))}
        <div className="pt-3"><MiniCalendar /></div>
      </nav>
      <div className="space-y-0.5 border-t border-line p-3">
        <NavLink to="/settings" className={({ isActive }) => cx(item, isActive ? active : idle)}><Settings className="size-5" />Profile Settings</NavLink>
        <NavLink to="/inbox" className={({ isActive }) => cx(item, isActive ? active : idle)}>
          <Mail className="size-5" /><span className="flex-1">Email</span>
          <span className={cx('grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[11px] font-bold', unread.emails ? 'bg-accent text-white' : 'bg-brand-soft text-brand-ink')}>{unread.emails}</span>
        </NavLink>
      </div>
    </div>
  )
}

// Email Center is a workspace page: it opens in the normal layout (HR still sees it in their own menu)
const HR_PATHS = ['/payroll', '/payslips', '/pf', '/incentives', '/incentive-settings', '/break-settings', '/assets', '/recruitment', '/candidates', '/letters', '/performance', '/salary-status']

/** HR navigation: each item keeps its own colour; only pages that exist and the user may open are listed. */
const HR_MENU: { label: string; to: string; icon: typeof Home; color: string; perms: Perm[] }[] = [
  { label: 'Employees', to: '/employees', icon: Users, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300', perms: ['employees.view', 'employees.manage'] },
  { label: 'Attendance', to: '/attendance', icon: UserCheck, color: 'text-orange-600 bg-orange-100 dark:bg-orange-500/15 dark:text-orange-300', perms: [] },
  { label: 'Break Time', to: '/break-settings', icon: Coffee, color: 'text-amber-600 bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300', perms: ['employees.manage'] },
  { label: 'Leave Management', to: '/leave', icon: CalendarCheck2, color: 'text-rose-600 bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300', perms: [] },
  { label: 'Payroll', to: '/payroll', icon: Wallet, color: 'text-sky-600 bg-sky-100 dark:bg-sky-500/15 dark:text-sky-300', perms: ['payroll.view', 'payroll.manage'] },
  { label: 'Salary Paid / Not Paid', to: '/salary-status', icon: BadgeCheck, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300', perms: ['payroll.view', 'payroll.manage'] },
  { label: 'Payslips', to: '/payslips', icon: Receipt, color: 'text-cyan-600 bg-cyan-100 dark:bg-cyan-500/15 dark:text-cyan-300', perms: [] },
  { label: 'PF Management', to: '/pf', icon: Landmark, color: 'text-green-600 bg-green-100 dark:bg-green-500/15 dark:text-green-300', perms: ['payroll.view', 'payroll.manage'] },
  { label: 'Sales Incentives', to: '/incentives', icon: Trophy, color: 'text-orange-600 bg-orange-100 dark:bg-orange-500/15 dark:text-orange-300', perms: ['incentives.manage', 'payroll.view'] },
  { label: 'Incentive Settings', to: '/incentive-settings', icon: SlidersHorizontal, color: 'text-amber-600 bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300', perms: ['incentives.manage'] },
  { label: 'Assets & Expenses', to: '/assets', icon: Package, color: 'text-violet-600 bg-violet-100 dark:bg-violet-500/15 dark:text-violet-300', perms: ['assets.manage'] },
  { label: 'Recruitment', to: '/recruitment', icon: Briefcase, color: 'text-blue-600 bg-blue-100 dark:bg-blue-500/15 dark:text-blue-300', perms: ['recruitment.manage'] },
  { label: 'Candidate Forms', to: '/candidates', icon: ClipboardList, color: 'text-indigo-600 bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300', perms: ['recruitment.manage'] },
  { label: 'Letters', to: '/letters', icon: FilePen, color: 'text-fuchsia-600 bg-fuchsia-100 dark:bg-fuchsia-500/15 dark:text-fuchsia-300', perms: ['employees.manage'] },
  { label: 'Performance', to: '/performance', icon: TrendingUp, color: 'text-violet-600 bg-violet-100 dark:bg-violet-500/15 dark:text-violet-300', perms: ['performance.view'] },
  { label: 'Training & Development', to: '/events', icon: GraduationCap, color: 'text-amber-600 bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300', perms: [] },
  { label: 'Policies & Documents', to: '/documents', icon: FileText, color: 'text-teal-600 bg-teal-100 dark:bg-teal-500/15 dark:text-teal-300', perms: ['documents.forms'] },
  { label: 'Email Center', to: '/email-center', icon: MailPlus, color: 'text-orange-600 bg-orange-100 dark:bg-orange-500/15 dark:text-orange-300', perms: ['email.send'] },
  { label: 'HR Requests', to: '/messages', icon: Inbox, color: 'text-indigo-600 bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300', perms: ['messages.use'] },
  { label: 'Events & Announcements', to: '/broadcasts', icon: PartyPopper, color: 'text-pink-600 bg-pink-100 dark:bg-pink-500/15 dark:text-pink-300', perms: ['broadcasts.view', 'broadcasts.manage'] },
  { label: 'Reports & Analytics', to: '/reports', icon: BarChart3, color: 'text-purple-600 bg-purple-100 dark:bg-purple-500/15 dark:text-purple-300', perms: ['reports.view'] },
  { label: 'Settings', to: '/settings', icon: Settings, color: 'text-cyan-600 bg-cyan-100 dark:bg-cyan-500/15 dark:text-cyan-300', perms: [] },
]

function HrSidebar({ mini }: { mini: boolean }) {
  const me = useMe()
  const { can } = useAuth()
  const unread = useUnread()
  const loc = useLocation()
  const here = loc.pathname + loc.search
  const item = cx('relative flex items-center gap-3 rounded-xl py-2 text-[13px] font-semibold transition', mini ? 'justify-center px-0' : 'px-3')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className={cx('min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-3', mini ? 'px-2.5' : 'px-3')} aria-label="HR">
        <NavLink to={`/dashboard/${isMaster(me) ? 'hr' : me.role}`} title={mini ? 'Dashboard' : undefined} className={({ isActive }) => cx(item, 'mb-2 py-2.5 text-sm', isActive ? 'bg-brand text-white shadow-md shadow-brand/25' : 'text-ink/80 hover:bg-white/70 dark:hover:bg-white/5')}>
          <Home className="size-[18px]" /><Label mini={mini}>Dashboard</Label>
        </NavLink>
        {HR_MENU.filter((m) => (m.to !== '/messages' || MESSAGES_ENABLED) && (!m.perms.length || can(...m.perms))).map((m) => {
          const active = m.to.includes('?') ? here === m.to : loc.pathname === m.to
          return (
            <Link key={m.label} to={m.to} title={mini ? m.label : undefined} className={cx(item, active ? 'bg-white text-ink shadow-sm dark:bg-white/10' : 'text-ink/80 hover:bg-white/70 dark:hover:bg-white/5')}>
              <span className={cx('grid size-7 shrink-0 place-items-center rounded-lg', m.color)}><m.icon className="size-4" /></span><Label mini={mini}>{m.label}</Label>
            </Link>
          )
        })}
        {!mini && (
          <div className="flex flex-col items-center pt-4 text-center">
            <Rexy pose="wave" className="h-24 w-20" />
            <p className="mt-1 text-sm font-extrabold">Good <span className="underline decoration-accent decoration-[3px] underline-offset-4">Work!</span></p>
          </div>
        )}
      </nav>
      <div className={cx('space-y-0.5 border-t border-line/70', mini ? 'p-2.5' : 'p-3')}>
        <NavLink to="/settings" title={mini ? 'Profile Settings' : undefined} className={({ isActive }) => cx(item, 'text-sm', isActive ? 'bg-white dark:bg-white/10' : 'text-ink/80 hover:bg-white/70 dark:hover:bg-white/5')}><Settings className="size-5" /><Label mini={mini}>Profile Settings</Label></NavLink>
        <NavLink to="/inbox" title={mini ? `Email${unread.emails ? ` (${unread.emails} unread)` : ''}` : undefined} className={({ isActive }) => cx(item, 'text-sm', isActive ? 'bg-white dark:bg-white/10' : 'text-ink/80 hover:bg-white/70 dark:hover:bg-white/5')}>
          <Mail className="size-5" /><Label mini={mini}>Email</Label>
          {mini ? unread.emails > 0 && <span className="absolute right-2 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">{unread.emails}</span>
            : <span className={cx('grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[11px] font-bold', unread.emails ? 'bg-accent text-white' : 'bg-white text-brand-ink dark:bg-white/10')}>{unread.emails}</span>}
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

/** On the dashboard (as in the old CRM): leads still on New from before today block new leads until updated. */
function OverdueLeadsBanner() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const n = overdueLeadsOf(db, me.id).length
  if (!n) return null
  return (
    <div role="alert" className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-bad/40 bg-bad-soft px-4 py-3 text-sm text-bad">
      <b>Action required: {n} lead(s) without a disposition since yesterday.</b>
      <span className="text-ink/75">Update them now — until you do, no new leads can be given to you.</span>
      <Link to={can('leads.admin') ? '/leads' : '/dialer'} className="ml-auto rounded-full bg-bad px-4 py-1.5 text-xs font-bold text-white">Open my leads</Link>
    </div>
  )
}

/** CRM Leads in the menu: leads still on New from before today (red), or new ones not opened yet. */
function LeadsBadge() {
  const db = useDb()
  const me = useMe()
  const overdue = overdueLeadsOf(db, me.id).length, fresh = unseenLeadsOf(db, me.id).length
  if (!overdue && !fresh) return null
  return <span className={cx('rounded-full px-1.5 text-[10px] font-bold leading-5', overdue ? 'bg-bad text-white' : 'bg-info text-white')} title={overdue ? `${overdue} overdue lead(s)` : `${fresh} new lead(s)`}>{overdue ? `${overdue} pending` : `${fresh} new`}</span>
}
/** The same count on the icons-only menu: a small number on the Leads icon. */
function LeadsDot() {
  const db = useDb()
  const me = useMe()
  const overdue = overdueLeadsOf(db, me.id).length, fresh = unseenLeadsOf(db, me.id).length
  if (!overdue && !fresh) return null
  return <span className={cx('absolute right-1.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold text-white', overdue ? 'bg-bad' : 'bg-info')}>{overdue || fresh}</span>
}

export const POPUP_KEY = 'rexera-popup-off'
function NotificationBubble() {
  const me = useMe()
  const nav = useNavigate()
  const unread = useUnread()
  // once the newest notification is read or closed, the popup stays away until a newer one arrives
  const seenKey = `rexera-popup-seen-${me.id}`
  const [seenAt, setSeenAt] = useState(() => { try { return localStorage.getItem(seenKey) ?? '' } catch { return '' } })
  const [off] = useState(() => { try { return localStorage.getItem(POPUP_KEY) === '1' } catch { return false } })
  const n = unread.notices.reduce<typeof unread.notices[number] | undefined>((a, x) => (!a || x.at > a.at ? x : a), undefined) // newest unread
  if (off || !n || n.at <= seenAt) return null
  const done = () => { setSeenAt(n.at); try { localStorage.setItem(seenKey, n.at) } catch { /* ignore */ } }
  return (
    // sits just under the header's bell icon, pointing up at it
    <div className="no-print anim-fade-up fixed right-3 top-[76px] z-[60] w-[min(88vw,320px)] sm:right-20 lg:right-[168px]">
      <div className="relative rounded-[28px] border-[3px] border-ink bg-card p-4 pr-9 shadow-[6px_6px_0_var(--ink)] dark:border-line dark:shadow-pop">
        <svg className="absolute -top-[22px] right-8 text-ink dark:text-line" width="34" height="24" viewBox="0 0 34 24"><path d="M2 24 L30 2 L20 24" fill="var(--card)" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" /></svg>
        <button aria-label="Dismiss" className="absolute right-3 top-3 text-mute hover:text-ink" onClick={done}><X className="size-4" /></button>
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-accent"><Bell className="size-3.5 anim-float" />New notification</p>
        <p className="mt-1 text-sm font-bold">{n.title}</p>
        <p className="line-clamp-2 text-xs text-mute">{n.body}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="accent" onClick={() => { done(); markRead(me, n.id); if (n.link) nav(n.link) }}>View</Button>
          <Button size="sm" variant="ghost" onClick={() => { done(); markRead(me, n.id) }}>Mark read</Button>
        </div>
      </div>
    </div>
  )
}
