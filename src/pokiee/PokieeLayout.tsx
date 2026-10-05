import { useState, useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  Target,
  Clock,
  CalendarDays,
  Gauge,
  TrendingUp,
  IndianRupee,
  FileText,
  ShieldCheck,
  Sparkles,
  HandCoins,
  Megaphone,
  UploadCloud,
  Settings,
  DatabaseBackup,
  Search,
  Bell,
  Sun,
  Moon,
  Menu as MenuIcon,
  X,
  ExternalLink,
} from 'lucide-react'
import { CuteHeart, CuteSparkle, PokieeLogoMark } from './mascots'

export const POKIEE_NAV_ITEMS = [
  { path: '/hr', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/hr/employees', label: 'Employees', icon: Users },
  { path: '/hr/interns', label: 'Interns', icon: GraduationCap },
  { path: '/hr/recruitment', label: 'Recruitment', icon: Target },
  { path: '/hr/attendance', label: 'Attendance', icon: Clock },
  { path: '/hr/leave', label: 'Leave', icon: CalendarDays },
  { path: '/hr/productivity', label: 'Productivity', icon: Gauge },
  { path: '/hr/performance', label: 'Performance', icon: TrendingUp },
  { path: '/hr/payroll', label: 'Payroll', icon: IndianRupee },
  { path: '/hr/payslips', label: 'Payslips', icon: FileText },
  { path: '/hr/pf', label: 'PF Management', icon: ShieldCheck },
  { path: '/hr/incentives', label: 'Incentives', icon: Sparkles },
  { path: '/hr/loans', label: 'Advances & Loans', icon: HandCoins },
  { path: '/hr/broadcasts', label: 'Broadcasts', icon: Megaphone },
  { path: '/hr/import', label: 'Data Import', icon: UploadCloud },
  { path: '/hr/settings', label: 'Settings', icon: Settings },
  { path: '/hr/backup', label: 'Backup & Restore', icon: DatabaseBackup },
]

export function PokieeLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [notifOpen, setNotifOpen] = useState(false)
  const loc = useLocation()

  useEffect(() => {
    setMobileOpen(false)
  }, [loc.pathname])

  const toggleTheme = () => {
    const next = !isDark
    setIsDark(next)
    if (next) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f9fd] dark:bg-[#0c1222] font-pokiee text-slate-800 dark:text-slate-100 flex flex-col antialiased">
      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className="flex flex-1 min-h-screen">
        {/* Left Sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#12192e] transition-transform lg:static lg:translate-x-0 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {/* Logo Area */}
          <div className="flex h-16 items-center justify-between px-5 border-b border-slate-100 dark:border-slate-800/60">
            <Link to="/hr" className="flex items-center gap-2.5 group">
              <PokieeLogoMark size={36} />
              <div className="flex items-center gap-1 font-black text-2xl tracking-tight text-[#1e60d5]">
                <span>Pokiee</span>
                <CuteHeart className="text-[#ff4b72] anim-pulse-soft" size={16} />
              </div>
            </Link>
            <button
              onClick={() => setMobileOpen(false)}
              className="lg:hidden text-slate-400 hover:text-slate-600"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 overflow-y-auto px-3.5 py-4 space-y-1 scrollbar-thin">
            {POKIEE_NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive =
                item.path === '/hr'
                  ? loc.pathname === '/hr'
                  : loc.pathname.startsWith(item.path)

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13.5px] font-semibold transition-all duration-150 ${
                    isActive
                      ? 'bg-[#e8f2ff] dark:bg-blue-950/60 text-[#1d5cc8] dark:text-blue-300 shadow-xs translate-x-0.5'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100/60 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <Icon
                    className={`size-[18px] shrink-0 ${
                      isActive ? 'text-[#1d5cc8] dark:text-blue-300' : 'text-slate-400 dark:text-slate-500'
                    }`}
                    strokeWidth={isActive ? 2.3 : 1.9}
                  />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}

            {/* Quick public links */}
            <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800/60 px-1">
              <p className="px-2 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
                Portals
              </p>
              <Link
                to="/apply"
                target="_blank"
                className="flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-[#1e60d5] hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition"
              >
                <span>Candidate Portal</span>
                <ExternalLink className="size-3 opacity-60" />
              </Link>
              <Link
                to="/joining"
                target="_blank"
                className="flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-[#1e60d5] hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition"
              >
                <span>New Joiner Portal</span>
                <ExternalLink className="size-3 opacity-60" />
              </Link>
            </div>
          </nav>

          {/* Sleeping Cat Mascot at Bottom of Sidebar */}
          <div className="p-3 border-t border-slate-100 dark:border-slate-800/60 relative overflow-hidden bg-gradient-to-t from-blue-50/40 to-transparent dark:from-blue-950/20">
            <div className="flex items-center justify-center relative py-1">
              <img
                src="/mascots/sleeping-cat.png"
                alt="Sleeping Mascot"
                className="h-20 w-auto object-contain anim-float-subtle"
              />
              <span className="absolute top-2 right-6 text-xs font-black text-blue-400 tracking-wider anim-pulse-soft">
                z Z
              </span>
              <CuteSparkle className="absolute top-3 left-6 text-amber-300" size={12} />
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Header */}
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-[#12192e]/80 backdrop-blur-md px-4 sm:px-8">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileOpen(true)}
                className="lg:hidden p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <MenuIcon className="size-5" />
              </button>

              {/* Search Bar matching screenshot */}
              <div className="relative w-72 sm:w-96 md:w-[460px]">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search employees, tasks, leaves..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/60 text-xs sm:text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-[#1e60d5] focus:bg-white dark:focus:bg-slate-900 transition-all shadow-2xs"
                />
              </div>
            </div>

            {/* Header Right Items */}
            <div className="flex items-center gap-3">
              {/* Notification Bell */}
              <div className="relative">
                <button
                  onClick={() => setNotifOpen(!notifOpen)}
                  className="relative p-2.5 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  title="Notifications"
                >
                  <Bell className="size-5" />
                  <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff4b72] px-1 text-[10px] font-black text-white shadow-xs">
                    3
                  </span>
                </button>

                {/* Notifications Popup */}
                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#151d33] p-4 shadow-xl z-50 anim-fade-up">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                      <h4 className="font-bold text-sm">Notifications</h4>
                      <span className="text-[11px] font-bold text-[#1d5cc8] bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded-full">
                        3 new
                      </span>
                    </div>
                    <div className="space-y-2.5 pt-3">
                      <div className="p-2.5 rounded-xl bg-pink-50/60 dark:bg-pink-950/30 text-xs">
                        <p className="font-bold text-slate-800 dark:text-slate-200">
                          Leave Request pending
                        </p>
                        <p className="text-slate-500 text-[11px]">Riya Mehta applied for Casual Leave</p>
                      </div>
                      <div className="p-2.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 text-xs">
                        <p className="font-bold text-slate-800 dark:text-slate-200">
                          Birthday Today! 🎉
                        </p>
                        <p className="text-slate-500 text-[11px]">Kavya Sharma celebrates today</p>
                      </div>
                      <div className="p-2.5 rounded-xl bg-amber-50/60 dark:bg-amber-950/30 text-xs">
                        <p className="font-bold text-slate-800 dark:text-slate-200">
                          October Payroll Ready
                        </p>
                        <p className="text-slate-500 text-[11px]">Calculated for 125 employees</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className="p-2.5 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                title="Toggle Theme"
              >
                {isDark ? <Sun className="size-5 text-amber-400" /> : <Moon className="size-5" />}
              </button>

              {/* User Profile */}
              <div className="flex items-center gap-3 pl-2 sm:border-l border-slate-200 dark:border-slate-800">
                <img
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80"
                  alt="Parv Shah"
                  className="size-9 rounded-full object-cover ring-2 ring-blue-100 dark:ring-blue-900"
                />
                <div className="hidden sm:block text-left leading-tight">
                  <p className="text-xs font-black text-slate-900 dark:text-slate-100">Parv Shah</p>
                  <p className="text-[11px] font-semibold text-slate-400">HR Admin</p>
                </div>
              </div>
            </div>
          </header>

          {/* Page Outlet */}
          <main className="flex-1 p-4 sm:p-6 lg:p-7 max-w-[1600px] w-full mx-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
