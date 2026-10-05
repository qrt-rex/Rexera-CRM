import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams, Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { AuthProvider, useAuth } from './lib/auth'
import { ToastProvider, Button, Skeleton } from './components/ui'
import { Shell } from './layout/Shell'
import { canOpenDashboard } from './lib/rbac'
import { moduleByKey, canSee } from './lib/modules'
import type { Role } from './lib/types'
import Login from './pages/Login'

const Dashboard = lazy(() => import('./pages/dashboards/Dashboard'))
const Leads = lazy(() => import('./pages/modules/Leads'))
const Dialer = lazy(() => import('./pages/modules/Dialer'))
const Bookings = lazy(() => import('./pages/modules/Bookings'))
const BookingForm = lazy(() => import('./pages/modules/BookingForm'))
const BookingDetail = lazy(() => import('./pages/modules/BookingDetail'))
const Approvals = lazy(() => import('./pages/modules/Approvals'))
const WorkBoard = lazy(() => import('./pages/modules/WorkBoard'))
const Documents = lazy(() => import('./pages/modules/Documents'))
const Schemes = lazy(() => import('./pages/modules/Schemes'))
const Content = lazy(() => import('./pages/modules/Content'))
const Broadcasts = lazy(() => import('./pages/modules/Broadcasts'))
const Billing = lazy(() => import('./pages/modules/Billing'))
const InvoiceView = lazy(() => import('./pages/modules/InvoiceView'))
const Attendance = lazy(() => import('./pages/modules/Attendance'))
const Leave = lazy(() => import('./pages/modules/Leave'))
const Employees = lazy(() => import('./pages/modules/Employees'))
const Events = lazy(() => import('./pages/modules/Events'))
const Messages = lazy(() => import('./pages/modules/Messages'))
const Reports = lazy(() => import('./pages/modules/Reports'))
const TeamProgress = lazy(() => import('./pages/modules/TeamProgress'))
const Assign = lazy(() => import('./pages/modules/Assign'))
const Notifications = lazy(() => import('./pages/modules/Notifications'))
const Access = lazy(() => import('./pages/modules/Access'))
const Audit = lazy(() => import('./pages/modules/Audit'))
const Settings = lazy(() => import('./pages/modules/Settings'))
const Payroll = lazy(() => import('./pages/hr/Payroll'))
const Payslips = lazy(() => import('./pages/hr/Payslips'))
const Pf = lazy(() => import('./pages/hr/Pf'))
const Incentives = lazy(() => import('./pages/hr/Incentives'))
const IncentiveSettings = lazy(() => import('./pages/hr/IncentiveSettings'))
const Performance = lazy(() => import('./pages/hr/Performance'))
const Recruitment = lazy(() => import('./pages/hr/Recruitment'))
const ApiKeys = lazy(() => import('./pages/it/ApiKeys'))
const BackupPage = lazy(() => import('./pages/it/Backup'))
const EmailCenter = lazy(() => import('./pages/hr/EmailCenter'))
const InboxPage = lazy(() => import('./pages/modules/Inbox'))

// Pokiee Cute Cartoon HR Suite
const PokieeDashboard = lazy(() => import('./pokiee/pages/PokieeDashboard'))
const PokieeEmployees = lazy(() => import('./pokiee/pages/PokieeEmployees'))
const PokieeEmployeeProfile = lazy(() => import('./pokiee/pages/PokieeEmployeeProfile'))
const PokieeEmployeeForm = lazy(() => import('./pokiee/pages/PokieeEmployeeForm'))
const PokieeInterns = lazy(() => import('./pokiee/pages/PokieeInterns'))
const PokieeRecruitment = lazy(() => import('./pokiee/pages/PokieeRecruitment'))
const PokieeAttendance = lazy(() => import('./pokiee/pages/PokieeAttendance'))
const PokieeLeave = lazy(() => import('./pokiee/pages/PokieeLeave'))
const PokieeProductivity = lazy(() => import('./pokiee/pages/PokieeProductivity'))
const PokieePerformance = lazy(() => import('./pokiee/pages/PokieePerformance'))
const PokieePayroll = lazy(() => import('./pokiee/pages/PokieePayroll'))
const PokieePayslips = lazy(() => import('./pokiee/pages/PokieePayslips'))
const PokieePF = lazy(() => import('./pokiee/pages/PokieePF'))
const PokieeIncentives = lazy(() => import('./pokiee/pages/PokieeIncentives'))
const PokieeLoans = lazy(() => import('./pokiee/pages/PokieeLoans'))
const PokieeBonuses = lazy(() => import('./pokiee/pages/PokieeBonuses'))
const PokieeBroadcasts = lazy(() => import('./pokiee/pages/PokieeBroadcasts'))
const PokieeImport = lazy(() => import('./pokiee/pages/PokieeImport'))
const PokieeSettings = lazy(() => import('./pokiee/pages/PokieeSettings'))
const PokieeBackup = lazy(() => import('./pokiee/pages/PokieeBackup'))
const PokieeCandidatePortal = lazy(() => import('./pokiee/pages/PokieeCandidatePortal'))
const PokieeNewJoinerPortal = lazy(() => import('./pokiee/pages/PokieeNewJoinerPortal'))
import { PokieeLayout } from './pokiee/PokieeLayout'

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const loc = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  return <>{children}</>
}

function Guard({ m, children }: { m: string; children: ReactNode }) {
  const { can } = useAuth()
  return canSee(moduleByKey(m), can) ? <>{children}</> : <NotFound />
}

function DashboardRoute() {
  const { user } = useAuth()
  const { role } = useParams()
  if (!user) return null
  if (!role || !canOpenDashboard(user, role as Role)) return <Navigate to={`/dashboard/${user.role}`} replace />
  return <Dashboard role={role as Role} />
}

function HomeRedirect() {
  return <Navigate to="/hr" replace />
}

function NotFound() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <span className="mb-4 grid size-16 place-items-center rounded-2xl bg-brand-soft text-brand-ink"><Compass className="size-8" /></span>
      <h2 className="text-xl font-extrabold">Page not found</h2>
      <p className="mt-1 text-sm text-mute">It doesn't exist, or your role doesn't have access to it.</p>
      <Link to="/dashboard" className="mt-5"><Button>Back to dashboard</Button></Link>
    </div>
  )
}

const Loading = () => (
  <div className="space-y-4">
    <Skeleton className="h-12 w-72" />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
    <Skeleton className="h-80" />
  </div>
)

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            {/* Standalone Public Portals (No HR admin sidebar) */}
            <Route path="/apply" element={<S><PokieeCandidatePortal /></S>} />
            <Route path="/joining" element={<S><PokieeNewJoinerPortal /></S>} />

            {/* Pokiee Cute Cartoon HR Suite */}
            <Route path="/hr" element={<PokieeLayout />}>
              <Route index element={<S><PokieeDashboard /></S>} />
              <Route path="employees" element={<S><PokieeEmployees /></S>} />
              <Route path="employees/new" element={<S><PokieeEmployeeForm /></S>} />
              <Route path="employees/:id" element={<S><PokieeEmployeeProfile /></S>} />
              <Route path="employees/:id/edit" element={<S><PokieeEmployeeForm /></S>} />
              <Route path="interns" element={<S><PokieeInterns /></S>} />
              <Route path="recruitment" element={<S><PokieeRecruitment /></S>} />
              <Route path="attendance" element={<S><PokieeAttendance /></S>} />
              <Route path="leave" element={<S><PokieeLeave /></S>} />
              <Route path="productivity" element={<S><PokieeProductivity /></S>} />
              <Route path="performance" element={<S><PokieePerformance /></S>} />
              <Route path="payroll" element={<S><PokieePayroll /></S>} />
              <Route path="payslips" element={<S><PokieePayslips /></S>} />
              <Route path="pf" element={<S><PokieePF /></S>} />
              <Route path="incentives" element={<S><PokieeIncentives /></S>} />
              <Route path="loans" element={<S><PokieeLoans /></S>} />
              <Route path="bonuses" element={<S><PokieeBonuses /></S>} />
              <Route path="broadcasts" element={<S><PokieeBroadcasts /></S>} />
              <Route path="import" element={<S><PokieeImport /></S>} />
              <Route path="settings" element={<S><PokieeSettings /></S>} />
              <Route path="backup" element={<S><PokieeBackup /></S>} />
            </Route>

            {/* Direct Home Redirects to Pokiee HR */}
            <Route path="/" element={<HomeRedirect />} />

            <Route path="/login" element={<Login />} />
            <Route element={<RequireAuth><Shell /></RequireAuth>}>
              <Route path="/dashboard" element={<HomeRedirect />} />
              <Route path="/dashboard/:role" element={<S><DashboardRoute /></S>} />
              <Route path="/leads" element={<Guard m="leads"><S><Leads /></S></Guard>} />
              <Route path="/dialer" element={<Guard m="dialer"><S><Dialer /></S></Guard>} />
              <Route path="/team" element={<Guard m="team"><S><TeamProgress /></S></Guard>} />
              <Route path="/assign" element={<Guard m="assign"><S><Assign /></S></Guard>} />
              <Route path="/bookings" element={<Guard m="bookings"><S><Bookings /></S></Guard>} />
              <Route path="/bookings/new" element={<Guard m="bookings"><S><BookingForm /></S></Guard>} />
              <Route path="/bookings/:id/edit" element={<Guard m="bookings"><S><BookingForm /></S></Guard>} />
              <Route path="/bookings/:id" element={<Guard m="bookings"><S><BookingDetail /></S></Guard>} />
              <Route path="/approvals" element={<Guard m="approvals"><S><Approvals /></S></Guard>} />
              <Route path="/work" element={<Guard m="work"><S><WorkBoard /></S></Guard>} />
              <Route path="/documents" element={<Guard m="documents"><S><Documents /></S></Guard>} />
              <Route path="/schemes" element={<Guard m="schemes"><S><Schemes /></S></Guard>} />
              <Route path="/content" element={<Guard m="content"><S><Content /></S></Guard>} />
              <Route path="/broadcasts" element={<Guard m="broadcasts"><S><Broadcasts /></S></Guard>} />
              <Route path="/billing" element={<Guard m="billing"><S><Billing /></S></Guard>} />
              <Route path="/billing/:id" element={<Guard m="billing"><S><InvoiceView /></S></Guard>} />
              <Route path="/attendance" element={<S><Attendance /></S>} />
              <Route path="/leave" element={<S><Leave /></S>} />
              <Route path="/employees" element={<Guard m="employees"><S><Employees /></S></Guard>} />
              <Route path="/events" element={<S><Events /></S>} />
              <Route path="/messages" element={<Guard m="messages"><S><Messages /></S></Guard>} />
              <Route path="/reports" element={<Guard m="reports"><S><Reports /></S></Guard>} />
              <Route path="/notifications" element={<S><Notifications /></S>} />
              <Route path="/access" element={<Guard m="access"><S><Access /></S></Guard>} />
              <Route path="/audit" element={<Guard m="audit"><S><Audit /></S></Guard>} />
              <Route path="/settings" element={<S><Settings /></S>} />
              <Route path="/payroll" element={<Guard m="payroll"><S><Payroll /></S></Guard>} />
              <Route path="/payslips" element={<Guard m="payslips"><S><Payslips /></S></Guard>} />
              <Route path="/pf" element={<Guard m="pf"><S><Pf /></S></Guard>} />
              <Route path="/incentives" element={<Guard m="incentives"><S><Incentives /></S></Guard>} />
              <Route path="/incentive-settings" element={<Guard m="incentive-settings"><S><IncentiveSettings /></S></Guard>} />
              <Route path="/performance" element={<Guard m="performance"><S><Performance /></S></Guard>} />
              <Route path="/recruitment" element={<Guard m="recruitment"><S><Recruitment /></S></Guard>} />
              <Route path="/api-keys" element={<Guard m="api-keys"><S><ApiKeys /></S></Guard>} />
              <Route path="/backup" element={<Guard m="backup"><S><BackupPage /></S></Guard>} />
              <Route path="/email-center" element={<Guard m="email-center"><S><EmailCenter /></S></Guard>} />
              <Route path="/inbox" element={<S><InboxPage /></S>} />
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route path="*" element={<Navigate to="/hr" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}

function S({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>
}
