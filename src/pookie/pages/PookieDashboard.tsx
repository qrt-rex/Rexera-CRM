import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Calendar,
  Clock,
  ArrowRight,
  CalendarDays,
  Target,
  IndianRupee,
  Gift,
  Megaphone,
  Zap,
  UserPlus,
  GraduationCap,
  FileCheck,
  CheckCircle2,
  Send,
  FileSpreadsheet,
  Award,
  ShieldCheck,
  Database,
  Users,
} from 'lucide-react'
import { CuteSparkle, CuteStar } from '../mascots'
import { INITIAL_LEAVES, INITIAL_ANNOUNCEMENTS } from '../data'

export default function PookieDashboard() {
  const [leaves, setLeaves] = useState(INITIAL_LEAVES)
  const [approvedCount, setApprovedCount] = useState(0)

  const handleLeaveAction = (id: string, action: 'Approved' | 'Rejected') => {
    setLeaves((prev) =>
      prev.map((l) => (l.id === id ? { ...l, status: action } : l))
    )
    if (action === 'Approved') setApprovedCount((c) => c + 1)
  }

  return (
    <div className="space-y-6 pb-8">
      {/* 1. Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl Pookie-hero-gradient border border-blue-100/70 dark:border-blue-900/40 p-6 sm:p-8 shadow-xs">
        {/* Decorative Floating Clouds and Sparkles */}
        <div className="absolute top-3 left-12 text-white/70">
          <svg width="40" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
        </div>
        <CuteSparkle className="absolute top-6 left-1/3 text-pink-400" size={18} />
        <CuteStar className="absolute bottom-5 left-1/4 text-amber-300" size={16} />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          {/* Greeting text */}
          <div className="space-y-1 max-w-md">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
              <span>Good Evening, Parv!</span>
              <span className="text-xl">✨</span>
            </h1>
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              Let's make today productive and people-happy!
            </p>
          </div>

          {/* Mascot Team Group (Center-Right) */}
          <div className="flex-1 flex justify-center md:justify-end items-end relative min-h-[110px] sm:min-h-[130px]">
            <img
              src="/mascots/hero-team-strip.png"
              alt="Pookie Mascot Team"
              className="h-28 sm:h-36 md:h-40 w-auto object-contain filter drop-shadow-md select-none transition-transform hover:scale-[1.02] duration-300"
            />
          </div>

          {/* Date Card on the far right */}
          <div className="shrink-0 flex md:block self-start md:self-auto">
            <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-white/90 dark:bg-slate-900/80 backdrop-blur-sm border border-white/60 dark:border-slate-800 shadow-sm text-xs font-bold text-slate-700 dark:text-slate-200">
              <Calendar className="size-4 text-[#1e60d5]" />
              <div className="leading-tight">
                <div>Oct 05, 2026</div>
                <div className="text-[10.5px] font-semibold text-slate-400">Monday</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. KPI Cards Row (6 Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 sm:gap-4">
        {/* Card 1: Total Employees */}
        <Link
          to="/hr/employees"
          className="Pookie-card p-4 relative overflow-hidden flex flex-col justify-between hover:-translate-y-1 transition duration-200 group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-[#1d5cc8]">
              <Users className="size-4" />
            </div>
            <span className="text-[11px] font-extrabold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">
              ↑ 8%
            </span>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400">Total Employees</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white">125</p>
          </div>
          {/* Mascot in card corner */}
          <div className="absolute bottom-1 right-2 w-12 h-12 pointer-events-none">
            <img
              src="/mascots/kpi-schoolgirls.png"
              alt="Schoolgirls"
              className="w-full h-full object-contain filter drop-shadow-xs group-hover:scale-110 transition duration-200"
            />
          </div>
        </Link>

        {/* Card 2: Interns */}
        <Link
          to="/hr/interns"
          className="Pookie-card p-4 relative overflow-hidden flex flex-col justify-between hover:-translate-y-1 transition duration-200 group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600">
              <GraduationCap className="size-4" />
            </div>
            <span className="text-[11px] font-extrabold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">
              ↑ 12%
            </span>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400">Interns</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white">18</p>
          </div>
          <div className="absolute bottom-1 right-2 w-12 h-12 pointer-events-none">
            <img
              src="/mascots/kpi-shinchan.png"
              alt="Schoolboy"
              className="w-full h-full object-contain filter drop-shadow-xs group-hover:scale-110 transition duration-200"
            />
          </div>
        </Link>

        {/* Card 3: On Leave Today */}
        <Link
          to="/hr/leave"
          className="Pookie-card p-4 relative overflow-hidden flex flex-col justify-between hover:-translate-y-1 transition duration-200 group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600">
              <CalendarDays className="size-4" />
            </div>
            <span className="text-[11px] font-extrabold text-rose-500 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded-full">
              ↓ 2%
            </span>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400">On Leave Today</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white">12</p>
          </div>
          <div className="absolute bottom-1 right-2 w-12 h-12 pointer-events-none">
            <img
              src="/mascots/kpi-coffee-girl.png"
              alt="Schoolgirl Coffee"
              className="w-full h-full object-contain filter drop-shadow-xs group-hover:scale-110 transition duration-200"
            />
          </div>
        </Link>

        {/* Card 4: Present Today */}
        <Link
          to="/hr/attendance"
          className="Pookie-card p-4 relative overflow-hidden flex flex-col justify-between hover:-translate-y-1 transition duration-200 group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-[#1d5cc8]">
              <CheckCircle2 className="size-4" />
            </div>
            <span className="text-[11px] font-extrabold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">
              ↑ 5%
            </span>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400">Present Today</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white">102</p>
          </div>
          <div className="absolute bottom-1 right-2 w-12 h-12 pointer-events-none">
            <img
              src="/mascots/kpi-bluecat-thumb.png"
              alt="Blue Cat Thumb"
              className="w-full h-full object-contain filter drop-shadow-xs group-hover:scale-110 transition duration-200"
            />
          </div>
        </Link>

        {/* Card 5: Pending Approvals */}
        <Link
          to="/hr/leave"
          className="Pookie-card p-4 relative overflow-hidden flex flex-col justify-between hover:-translate-y-1 transition duration-200 group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-xl bg-pink-50 dark:bg-pink-950/50 text-[#ff4b72]">
              <Clock className="size-4" />
            </div>
            <span className="p-1 rounded-full bg-pink-100 dark:bg-pink-950 text-[#ff4b72] group-hover:translate-x-0.5 transition">
              <ArrowRight className="size-3" />
            </span>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400">Pending Approvals</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white">7</p>
          </div>
        </Link>

        {/* Card 6: Recruitment Pipeline */}
        <Link
          to="/hr/recruitment"
          className="Pookie-card p-4 relative overflow-hidden flex flex-col justify-between hover:-translate-y-1 transition duration-200 group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600">
              <Target className="size-4" />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400">Recruitment Pipeline</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white">28</p>
          </div>
          <div className="absolute bottom-1 right-2 w-12 h-12 pointer-events-none">
            <img
              src="/mascots/kpi-panda-kpi.png"
              alt="Panda"
              className="w-full h-full object-contain filter drop-shadow-xs group-hover:scale-110 transition duration-200"
            />
          </div>
        </Link>
      </div>

      {/* 3. Row 2: Attendance Overview + Leave Requests + Recruitment Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Card 1: Attendance Overview */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 font-black text-sm text-slate-800 dark:text-slate-100">
              <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950 text-[#1d5cc8]">
                <Calendar className="size-4" />
              </div>
              <span>Attendance Overview</span>
            </div>
            <Link
              to="/hr/attendance"
              className="text-xs font-bold text-[#1d5cc8] hover:underline flex items-center gap-1"
            >
              <span>View Details</span>
              <ArrowRight className="size-3" />
            </Link>
          </div>

          <div className="flex items-center justify-around py-5">
            {/* Donut Chart representation */}
            <div className="relative flex items-center justify-center size-36">
              <svg className="size-full -rotate-90" viewBox="0 0 36 36">
                {/* Background Ring */}
                <path
                  className="text-slate-100 dark:text-slate-800"
                  strokeWidth="4"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                {/* Present 82% */}
                <path
                  className="text-emerald-500"
                  strokeDasharray="82, 100"
                  strokeWidth="4"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                {/* On Leave 10% */}
                <path
                  className="text-amber-400"
                  strokeDasharray="10, 100"
                  strokeDashoffset="-82"
                  strokeWidth="4"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                {/* Late 5% */}
                <path
                  className="text-pink-400"
                  strokeDasharray="5, 100"
                  strokeDashoffset="-92"
                  strokeWidth="4"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-xl font-black text-slate-800 dark:text-white">125</span>
                <span className="text-[10px] font-bold text-slate-400">Total</span>
              </div>
            </div>

            {/* Legend */}
            <div className="space-y-2 text-xs font-semibold">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-emerald-500" />
                <span className="text-slate-500">Present</span>
                <span className="font-bold text-slate-800 dark:text-white">102 (82%)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-amber-400" />
                <span className="text-slate-500">On Leave</span>
                <span className="font-bold text-slate-800 dark:text-white">12 (10%)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-pink-400" />
                <span className="text-slate-500">Late</span>
                <span className="font-bold text-slate-800 dark:text-white">6 (5%)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-purple-400" />
                <span className="text-slate-500">Absent</span>
                <span className="font-bold text-slate-800 dark:text-white">5 (4%)</span>
              </div>
            </div>
          </div>

          {/* Peeking Shin-chan Mascot */}
          <div className="absolute -bottom-1 right-2 w-14 h-12 pointer-events-none">
            <img
              src="/mascots/peek-shinchan.png"
              alt="Peeking Mascot"
              className="w-full h-full object-contain filter drop-shadow-xs"
            />
          </div>
        </div>

        {/* Card 2: Leave Requests */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 font-black text-sm text-slate-800 dark:text-slate-100">
              <div className="p-1.5 rounded-lg bg-pink-50 dark:bg-pink-950 text-[#ff4b72]">
                <Clock className="size-4" />
              </div>
              <span>Leave Requests</span>
            </div>
            <Link
              to="/hr/leave"
              className="text-xs font-bold text-[#1d5cc8] hover:underline flex items-center gap-1"
            >
              <span>View All</span>
              <ArrowRight className="size-3" />
            </Link>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/60 flex-1">
            {leaves.slice(0, 3).map((item) => (
              <div key={item.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={item.avatar}
                    alt={item.employeeName}
                    className="size-8 rounded-full object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 dark:text-white truncate">
                      {item.employeeName}
                    </p>
                    <p className="text-[10.5px] text-slate-400 truncate">{item.employeeRole}</p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    {item.leaveType}
                  </p>
                  <p className="text-[10px] text-slate-400">{item.days} Day</p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {item.status === 'Pending' ? (
                    <>
                      <button
                        onClick={() => handleLeaveAction(item.id, 'Approved')}
                        className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 transition"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleLeaveAction(item.id, 'Rejected')}
                        className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-pink-100 dark:bg-pink-950 text-pink-700 dark:text-pink-300 hover:bg-pink-200 transition"
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${
                        item.status === 'Approved'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-rose-50 text-rose-600'
                      }`}
                    >
                      {item.status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Card 3: Recruitment Pipeline Bar Chart */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 font-black text-sm text-slate-800 dark:text-slate-100">
              <div className="p-1.5 rounded-lg bg-purple-50 dark:bg-purple-950 text-purple-600">
                <Target className="size-4" />
              </div>
              <span>Recruitment Pipeline</span>
            </div>
            <Link
              to="/hr/recruitment"
              className="text-xs font-bold text-[#1d5cc8] hover:underline flex items-center gap-1"
            >
              <span>View All</span>
              <ArrowRight className="size-3" />
            </Link>
          </div>

          {/* Bar Chart matching screenshot */}
          <div className="flex items-end justify-between gap-2 pt-6 pb-2 h-36 px-2">
            {[
              { label: 'Applied', val: 28, color: 'bg-blue-400' },
              { label: 'Screening', val: 18, color: 'bg-purple-300' },
              { label: 'Interview', val: 12, color: 'bg-pink-300' },
              { label: 'Selected', val: 8, color: 'bg-amber-300' },
              { label: 'Joined', val: 6, color: 'bg-emerald-300' },
              { label: 'On Hold', val: 4, color: 'bg-sky-200' },
            ].map((col) => {
              const heightPct = Math.round((col.val / 28) * 100)
              return (
                <div key={col.label} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    {col.val}
                  </span>
                  <div
                    style={{ height: `${heightPct}%` }}
                    className={`w-full max-w-[28px] rounded-t-lg ${col.color} transition-all duration-500`}
                  />
                  <span className="text-[9.5px] font-bold text-slate-400 truncate w-full text-center">
                    {col.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Peeking Panda Mascot with star */}
          <div className="absolute bottom-2 right-1 w-12 h-14 pointer-events-none">
            <img
              src="/mascots/peek-pipeline-panda.png"
              alt="Pipeline Panda"
              className="w-full h-full object-contain filter drop-shadow-xs"
            />
          </div>
        </div>
      </div>

      {/* 4. Row 3: Payroll Status + Upcoming Birthdays + Announcements */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: Payroll Status */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 font-black text-sm text-slate-800 dark:text-slate-100">
                <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-600">
                  <IndianRupee className="size-4" />
                </div>
                <span>Payroll Status (Oct 2026)</span>
              </div>
              <Link
                to="/hr/payroll"
                className="text-xs font-bold text-[#1d5cc8] hover:underline flex items-center gap-1"
              >
                <span>View Details</span>
                <ArrowRight className="size-3" />
              </Link>
            </div>

            {/* Stepper matching screenshot */}
            <div className="py-4">
              <div className="flex items-center justify-between relative px-2">
                {/* Connecting Line */}
                <div className="absolute top-4 left-6 right-6 h-0.5 bg-slate-200 dark:bg-slate-700 -z-0" />
                <div className="absolute top-4 left-6 w-2/3 h-0.5 bg-[#1d5cc8] -z-0" />

                {/* Step 1 */}
                <div className="flex flex-col items-center gap-1 relative z-10">
                  <div className="size-8 rounded-full bg-emerald-500 text-white font-bold text-xs flex items-center justify-center ring-4 ring-white dark:ring-slate-900 shadow-xs">
                    1
                  </div>
                  <span className="text-[10px] font-bold text-emerald-600">Calculated</span>
                </div>

                {/* Step 2 */}
                <div className="flex flex-col items-center gap-1 relative z-10">
                  <div className="size-8 rounded-full bg-teal-500 text-white font-bold text-xs flex items-center justify-center ring-4 ring-white dark:ring-slate-900 shadow-xs">
                    2
                  </div>
                  <span className="text-[10px] font-bold text-teal-600">Approved</span>
                </div>

                {/* Step 3 */}
                <div className="flex flex-col items-center gap-1 relative z-10">
                  <div className="size-8 rounded-full bg-[#1d5cc8] text-white font-bold text-xs flex items-center justify-center ring-4 ring-white dark:ring-slate-900 shadow-xs">
                    3
                  </div>
                  <span className="text-[10px] font-bold text-[#1d5cc8]">Finalised</span>
                </div>

                {/* Step 4 */}
                <div className="flex flex-col items-center gap-1 relative z-10">
                  <div className="size-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 font-bold text-xs flex items-center justify-center ring-4 ring-white dark:ring-slate-900">
                    4
                  </div>
                  <span className="text-[10px] font-bold text-slate-400">Paid</span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom stats row */}
          <div className="grid grid-cols-4 gap-2 pt-3 border-t border-slate-100 dark:border-slate-800 text-center">
            <div>
              <p className="text-[10px] font-bold text-slate-400">Employees</p>
              <p className="text-xs font-black text-slate-800 dark:text-white">125</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400">Total Payout</p>
              <p className="text-xs font-black text-slate-800 dark:text-white">₹18,75,000</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400">Paid</p>
              <p className="text-xs font-black text-slate-800 dark:text-white">0</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400">Pending</p>
              <p className="text-xs font-black text-slate-800 dark:text-white">125</p>
            </div>
          </div>
        </div>

        {/* Column 2: Upcoming Birthdays */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 font-black text-sm text-slate-800 dark:text-slate-100">
              <div className="p-1.5 rounded-lg bg-pink-50 dark:bg-pink-950 text-[#ff4b72]">
                <Gift className="size-4" />
              </div>
              <span>Upcoming Birthdays</span>
            </div>
            <Link
              to="/hr/employees"
              className="text-xs font-bold text-[#1d5cc8] hover:underline flex items-center gap-1"
            >
              <span>View All</span>
              <ArrowRight className="size-3" />
            </Link>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/60 my-2">
            {[
              { name: 'Kavya Sharma', dept: 'Marketing', date: 'Oct 07', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80' },
              { name: 'Rahul Verma', dept: 'Development', date: 'Oct 09', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&auto=format&fit=crop&q=80' },
              { name: 'Meera Jain', dept: 'Finance', date: 'Oct 12', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&auto=format&fit=crop&q=80' },
            ].map((b) => (
              <div key={b.name} className="py-2 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <img src={b.avatar} alt={b.name} className="size-7 rounded-full object-cover" />
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{b.name}</p>
                    <p className="text-[10px] text-slate-400">{b.dept}</p>
                  </div>
                </div>
                <span className="text-[11px] font-extrabold text-pink-600 bg-pink-50 dark:bg-pink-950/40 px-2 py-0.5 rounded-full">
                  {b.date}
                </span>
              </div>
            ))}
          </div>

          {/* Blonde character with birthday cake */}
          <div className="absolute bottom-2 right-2 w-16 h-16 pointer-events-none">
            <img
              src="/mascots/birthday-girl.png"
              alt="Birthday Mascot"
              className="w-full h-full object-contain filter drop-shadow-xs"
            />
          </div>
        </div>

        {/* Column 3: Announcements */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 font-black text-sm text-slate-800 dark:text-slate-100">
              <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600">
                <Megaphone className="size-4" />
              </div>
              <span>Announcements</span>
            </div>
            <Link
              to="/hr/broadcasts"
              className="text-xs font-bold text-[#1d5cc8] hover:underline flex items-center gap-1"
            >
              <span>New</span>
              <ArrowRight className="size-3" />
            </Link>
          </div>

          <div className="space-y-2.5 my-2">
            {INITIAL_ANNOUNCEMENTS.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between p-2 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 hover:bg-slate-100/70 transition"
              >
                <div className="min-w-0 pr-2">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                    {a.title}
                  </p>
                  <p className="text-[10px] text-slate-400">{a.date}</p>
                </div>
                <span
                  className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ${
                    a.priority === 'High'
                      ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300'
                      : a.priority === 'Medium'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                  }`}
                >
                  {a.priority}
                </span>
              </div>
            ))}
          </div>

          {/* Cheering Blue Cat Mascot */}
          <div className="absolute bottom-2 right-2 w-16 h-16 pointer-events-none">
            <img
              src="/mascots/cheer-cat.png"
              alt="Cheer Cat Mascot"
              className="w-full h-full object-contain filter drop-shadow-xs anim-float-subtle"
            />
          </div>
        </div>
      </div>

      {/* 5. Bottom Quick Access */}
      <div className="Pookie-card p-5 relative overflow-hidden">
        <div className="flex items-center gap-2 mb-4 font-black text-sm text-slate-800 dark:text-slate-100">
          <Zap className="size-4 text-amber-500 fill-amber-500" />
          <span>Quick Access</span>
        </div>

        {/* 12 Pill Buttons matching screenshot */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2.5">
          {[
            { label: 'Add Employee', path: '/hr/employees/new', icon: UserPlus, color: 'bg-blue-50 text-blue-600 dark:bg-blue-950' },
            { label: 'Add Intern', path: '/hr/interns', icon: GraduationCap, color: 'bg-purple-50 text-purple-600 dark:bg-purple-950' },
            { label: 'New Candidate', path: '/hr/recruitment', icon: Target, color: 'bg-amber-50 text-amber-600 dark:bg-amber-950' },
            { label: 'Mark Attendance', path: '/hr/attendance', icon: CheckCircle2, color: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950' },
            { label: 'Apply Leave', path: '/hr/leave', icon: CalendarDays, color: 'bg-pink-50 text-pink-600 dark:bg-pink-950' },
            { label: 'Run Payroll', path: '/hr/payroll', icon: IndianRupee, color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950' },
            { label: 'Generate Payslips', path: '/hr/payslips', icon: FileCheck, color: 'bg-sky-50 text-sky-600 dark:bg-sky-950' },
            { label: 'PF Dashboard', path: '/hr/pf', icon: ShieldCheck, color: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950' },
            { label: 'Incentive Settings', path: '/hr/incentives', icon: Award, color: 'bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-950' },
            { label: 'Broadcast', path: '/hr/broadcasts', icon: Send, color: 'bg-rose-50 text-rose-600 dark:bg-rose-950' },
            { label: 'Import Data', path: '/hr/import', icon: FileSpreadsheet, color: 'bg-teal-50 text-teal-600 dark:bg-teal-950' },
            { label: 'Backup HR Data', path: '/hr/backup', icon: Database, color: 'bg-slate-100 text-slate-700 dark:bg-slate-800' },
          ].map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.label}
                to={item.path}
                className="flex flex-col items-center justify-center p-2.5 rounded-2xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/20 hover:bg-white dark:hover:bg-slate-800 hover:shadow-sm hover:-translate-y-0.5 transition duration-150 text-center group"
              >
                <div className={`p-2 rounded-xl mb-1.5 ${item.color} group-hover:scale-110 transition`}>
                  <Icon className="size-4" />
                </div>
                <span className="text-[10.5px] font-bold text-slate-600 dark:text-slate-300 leading-tight">
                  {item.label}
                </span>
              </Link>
            )
          })}
        </div>

        {/* Decorative Mascot in Bottom Corner */}
        <div className="absolute bottom-1 right-2 w-10 h-10 pointer-events-none opacity-80">
          <img
            src="/mascots/peek-panda.png"
            alt="Bottom Panda"
            className="w-full h-full object-contain"
          />
        </div>
      </div>
    </div>
  )
}
