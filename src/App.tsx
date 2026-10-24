import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams, Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { AuthProvider, useAuth } from './lib/auth'
import { ToastProvider, Button, Skeleton, useToast } from './components/ui'
import { onSyncError } from './lib/store'
import { Shell } from './layout/Shell'
import { canOpenDashboard } from './lib/rbac'
import { moduleByKey, canSee } from './lib/modules'
import type { Perm, Role } from './lib/types'
import Login from './pages/Login'

const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const Dashboard = lazy(() => import('./pages/dashboards/Dashboard'))
const BranchDashboard = lazy(() => import('./pages/dashboards/BranchDashboard').then((m) => ({ default: m.BranchDashboard })))
const Leads = lazy(() => import('./pages/modules/Leads'))
const Dialer = lazy(() => import('./pages/modules/Dialer'))
const Bookings = lazy(() => import('./pages/modules/Bookings'))
const BookingForm = lazy(() => import('./pages/modules/BookingForm'))
const BookingDetail = lazy(() => import('./pages/modules/BookingDetail'))
const Approvals = lazy(() => import('./pages/modules/Approvals'))
const WorkBoard = lazy(() => import('./pages/modules/WorkBoard'))
const Documents = lazy(() => import('./pages/modules/Documents'))
const Schemes = lazy(() => import('./pages/modules/Schemes'))
const SalesKit = lazy(() => import('./pages/modules/SalesKit'))
const Website = lazy(() => import('./pages/modules/Website'))
const ClientPortal = lazy(() => import('./pages/modules/ClientPortal'))
const Portal = lazy(() => import('./pages/portal/Portal'))
const Content = lazy(() => import('./pages/modules/Content'))
const Broadcasts = lazy(() => import('./pages/modules/Broadcasts'))
const Billing = lazy(() => import('./pages/modules/Billing'))
const Refunds = lazy(() => import('./pages/modules/Refunds'))
const Commission = lazy(() => import('./pages/modules/Commission'))
const Services = lazy(() => import('./pages/modules/Services'))
const SalaryStatus = lazy(() => import('./pages/hr/SalaryStatus'))
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
const CloudIncentives = lazy(() => import('./pages/hr/CloudIncentives'))
const IncentiveSettings = lazy(() => import('./pages/hr/IncentiveSettings'))
const BreakSettings = lazy(() => import('./pages/hr/BreakSettings'))
const OpsDesk = lazy(() => import('./pages/modules/OpsDesk'))
const AssetsPage = lazy(() => import('./pages/hr/Assets'))
const Performance = lazy(() => import('./pages/hr/Performance'))
const Recruitment = lazy(() => import('./pages/hr/Recruitment'))
const ApiKeys = lazy(() => import('./pages/it/ApiKeys'))
const BackupPage = lazy(() => import('./pages/it/Backup'))
const LegacyImport = lazy(() => import('./pages/it/LegacyImport'))
const Candidates = lazy(() => import('./pages/hr/Candidates'))
const Letters = lazy(() => import('./pages/hr/Letters'))
const Apply = lazy(() => import('./pages/Apply'))
const PublicForm = lazy(() => import('./pages/PublicForm'))
const Forms = lazy(() => import('./pages/modules/Forms'))
const WorkflowSettings = lazy(() => import('./pages/modules/WorkflowSettings'))
const EmailCenter = lazy(() => import('./pages/hr/EmailCenter'))
const InboxPage = lazy(() => import('./pages/modules/Inbox'))

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const loc = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  return <>{children}</>
}

function Guard({ m, perm, children }: { m: string; perm?: Perm; children: ReactNode }) {
  const { can } = useAuth()
  return canSee(moduleByKey(m), can) && (!perm || can(perm)) ? <>{children}</> : <NotFound />
}

function DashboardRoute() {
  const { user } = useAuth()
  const { role } = useParams()
  if (!user) return null
  if (!role || !canOpenDashboard(user, role as Role)) return <Navigate to={`/dashboard/${user.role}`} replace />
  return <Dashboard role={role as Role} />
}

/** One branch's dashboard (/branches/:id) — Branch Directors (their own branches only, checked inside) and Super Admin / IT. */
function BranchRoute() {
  const { user } = useAuth()
  const { id } = useParams()
  if (!user) return null
  if (!id || !canOpenDashboard(user, 'branchdirector')) return <Navigate to={`/dashboard/${user.role}`} replace />
  return <BranchDashboard branchId={id} />
}

function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={user ? `/dashboard/${user.role}` : '/login'} replace />
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

/** Shows a message when Supabase refuses a change (the screen then reloads from the database). */
function SyncErrors() {
  const toast = useToast()
  useEffect(() => onSyncError((m) => toast('error', m)), [toast])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <SyncErrors />
        <AuthProvider>
          <Routes>
            {/* Direct Home Redirects */}
            <Route path="/" element={<HomeRedirect />} />

            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<S><ResetPassword /></S>} />
            {/* public: candidates apply without signing in */}
            <Route path="/apply/:token" element={<S><Apply /></S>} />
            {/* public: clients fill in a form from a secure link (the live server checks and stores it) */}
            <Route path="/f/:token" element={<S><PublicForm /></S>} />
            {/* clients sign in to their own portal (a separate sign-in from the CRM; the live server answers for them) */}
            <Route path="/portal/*" element={<S><Portal /></S>} />
            <Route element={<RequireAuth><Shell /></RequireAuth>}>
              <Route index element={<HomeRedirect />} />
              <Route path="/dashboard" element={<HomeRedirect />} />
              <Route path="/dashboard/:role" element={<S><DashboardRoute /></S>} />
              <Route path="/branches/:id" element={<S><BranchRoute /></S>} />
              <Route path="/leads" element={<Guard m="leads"><S><Leads /></S></Guard>} />
              <Route path="/dialer" element={<Guard m="dialer"><S><Dialer /></S></Guard>} />
              <Route path="/team" element={<Guard m="team"><S><TeamProgress /></S></Guard>} />
              <Route path="/assign" element={<Guard m="assign"><S><Assign /></S></Guard>} />
              <Route path="/bookings" element={<Guard m="bookings"><S><Bookings /></S></Guard>} />
              <Route path="/bookings/new" element={<Guard m="bookings" perm="bookings.create"><S><BookingForm /></S></Guard>} />
              <Route path="/bookings/:id/edit" element={<Guard m="bookings"><S><BookingForm /></S></Guard>} />
              <Route path="/bookings/:id" element={<Guard m="bookings"><S><BookingDetail /></S></Guard>} />
              <Route path="/approvals" element={<Guard m="approvals"><S><Approvals /></S></Guard>} />
              <Route path="/work" element={<Guard m="work"><S><WorkBoard /></S></Guard>} />
              <Route path="/documents" element={<Guard m="documents"><S><Documents /></S></Guard>} />
              <Route path="/schemes" element={<Guard m="schemes"><S><Schemes /></S></Guard>} />
              <Route path="/sales-kit" element={<Guard m="sales-kit"><S><SalesKit /></S></Guard>} />
              <Route path="/website" element={<Guard m="website"><S><Website /></S></Guard>} />
              <Route path="/client-portal" element={<Guard m="client-portal"><S><ClientPortal /></S></Guard>} />
              <Route path="/content" element={<Guard m="content"><S><Content /></S></Guard>} />
              <Route path="/broadcasts" element={<Guard m="broadcasts"><S><Broadcasts /></S></Guard>} />
              <Route path="/billing" element={<Guard m="billing"><S><Billing /></S></Guard>} />
              <Route path="/refunds" element={<Guard m="refunds"><S><Refunds /></S></Guard>} />
              <Route path="/commission" element={<Guard m="commission"><S><Commission /></S></Guard>} />
              <Route path="/services" element={<Guard m="services"><S><Services /></S></Guard>} />
              <Route path="/forms" element={<Guard m="forms"><S><Forms /></S></Guard>} />
              <Route path="/workflow-settings" element={<Guard m="workflow-settings"><S><WorkflowSettings /></S></Guard>} />
              <Route path="/salary-status" element={<Guard m="salary-status"><S><SalaryStatus /></S></Guard>} />
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
              <Route path="/incentives/supabase" element={<Guard m="incentives-cloud"><S><CloudIncentives /></S></Guard>} />
              <Route path="/incentive-settings" element={<Guard m="incentive-settings"><S><IncentiveSettings /></S></Guard>} />
              <Route path="/break-settings" element={<Guard m="break-settings"><S><BreakSettings /></S></Guard>} />
              <Route path="/ops-desk" element={<Guard m="ops-desk"><S><OpsDesk /></S></Guard>} />
              <Route path="/assets" element={<Guard m="assets"><S><AssetsPage /></S></Guard>} />
              <Route path="/performance" element={<Guard m="performance"><S><Performance /></S></Guard>} />
              <Route path="/recruitment" element={<Guard m="recruitment"><S><Recruitment /></S></Guard>} />
              <Route path="/candidates" element={<Guard m="candidates"><S><Candidates /></S></Guard>} />
              <Route path="/letters" element={<Guard m="letters"><S><Letters /></S></Guard>} />
              <Route path="/api-keys" element={<Guard m="api-keys"><S><ApiKeys /></S></Guard>} />
              <Route path="/backup" element={<Guard m="backup"><S><BackupPage /></S></Guard>} />
              <Route path="/legacy-import" element={<Guard m="legacy-import"><S><LegacyImport /></S></Guard>} />
              <Route path="/email-center" element={<Guard m="email-center"><S><EmailCenter /></S></Guard>} />
              <Route path="/inbox" element={<S><InboxPage /></S>} />
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}

function S({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>
}
