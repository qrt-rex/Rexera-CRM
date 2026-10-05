import { useState } from 'react'
import {
  CalendarDays,
  Send,
  AlertTriangle,
  ShieldCheck,
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  FileText,
} from 'lucide-react'
import { INITIAL_LEAVES, LeaveRequest } from '../data'

export default function PokieeLeave() {
  const [leaves, setLeaves] = useState<LeaveRequest[]>(INITIAL_LEAVES)
  const [applyForm, setApplyForm] = useState({
    leaveType: 'Casual Leave',
    startDate: '',
    endDate: '',
    reason: '',
  })
  const [appliedSuccess, setAppliedSuccess] = useState(false)

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault()
    const newLeave: LeaveRequest = {
      id: `LV-${Date.now().toString().slice(-3)}`,
      employeeName: 'Parv Shah',
      employeeRole: 'HR Admin',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
      dept: 'Human Resources',
      leaveType: applyForm.leaveType as never,
      days: 1,
      startDate: applyForm.startDate || '10 Oct 2026',
      endDate: applyForm.endDate || '10 Oct 2026',
      reason: applyForm.reason || 'Personal leave request',
      status: 'Pending',
    }
    setLeaves([newLeave, ...leaves])
    setAppliedSuccess(true)
    setTimeout(() => setAppliedSuccess(false), 2500)
    setApplyForm({ leaveType: 'Casual Leave', startDate: '', endDate: '', reason: '' })
  }

  const handleDecision = (id: string, status: 'Approved' | 'Rejected') => {
    setLeaves((prev) =>
      prev.map((l) => (l.id === id ? { ...l, status } : l))
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#12192e] p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-pink-50 text-[#ff4b72] dark:bg-pink-950 font-bold text-xs">
              <CalendarDays className="size-4" />
            </span>
            <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
              Leave Management
            </h1>
          </div>
          <p className="text-xs font-semibold text-slate-400 mt-1">
            Apply for time off, view statutory balances, and track multi-tier approval chains.
          </p>
        </div>
      </div>

      {/* Row 1: Leave Balances (Panda holding small CL, SL, EL and LOP cards) */}
      <div className="pokiee-card p-6 relative overflow-hidden bg-gradient-to-r from-blue-50/40 via-white to-pink-50/30 dark:from-blue-950/20 dark:to-pink-950/20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <img
              src="/mascots/panda.png"
              alt="Panda Balances"
              className="size-12 object-contain anim-float-subtle"
            />
            <div>
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                Available Leave Balances
              </h3>
              <p className="text-[11px] text-slate-400">Statutory annual quota (Jan - Dec 2026)</p>
            </div>
          </div>
          <span className="text-[11px] font-bold text-slate-500">
            Total Quota: 25 Days / Year
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
          <div className="p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/40">
            <span className="text-[10.5px] font-black uppercase text-blue-600">Casual Leave (CL)</span>
            <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">8 Days</p>
            <p className="text-[10px] text-slate-400 mt-0.5">4 of 12 used</p>
          </div>
          <div className="p-4 rounded-2xl bg-pink-50/60 dark:bg-pink-950/40 border border-pink-100 dark:border-pink-900/40">
            <span className="text-[10.5px] font-black uppercase text-pink-600">Sick Leave (SL)</span>
            <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">5 Days</p>
            <p className="text-[10px] text-slate-400 mt-0.5">2 of 7 used</p>
          </div>
          <div className="p-4 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
            <span className="text-[10.5px] font-black uppercase text-emerald-600">Earned Leave (EL)</span>
            <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">12 Days</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Carry-forward eligible</p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800">
            <span className="text-[10.5px] font-black uppercase text-slate-500">Loss of Pay (LOP)</span>
            <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">0 Days</p>
            <p className="text-[10px] text-slate-400 mt-0.5">No unpaid leaves</p>
          </div>
        </div>
      </div>

      {/* Row 2: Warnings
          - Medical certificate warning: Blue robotic cat holding a medical document and small shield.
          - Conflict warning: Funny schoolboy looking at a calendar with a warning icon. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Medical warning */}
        <div className="p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-900/60 flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-blue-800 dark:text-blue-300 font-bold text-xs">
              <ShieldCheck className="size-4" />
              <span>Medical Certificate Policy</span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              Medical certificate is mandatory for sick leaves extending beyond 2 consecutive business days.
            </p>
          </div>
          <img
            src="/mascots/bluecat.png"
            alt="Medical Shield Bluecat"
            className="size-14 object-contain shrink-0"
          />
        </div>

        {/* Conflict warning */}
        <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/60 flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-bold text-xs">
              <AlertTriangle className="size-4 text-amber-600" />
              <span>Team Availability Conflict</span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              3 members of Sales & BD are already on scheduled leave between Oct 12 and Oct 15.
            </p>
          </div>
          <img
            src="/mascots/schoolboy.png"
            alt="Schoolboy Calendar Warning"
            className="size-14 object-contain shrink-0"
          />
        </div>
      </div>

      {/* Row 3: Apply Leave (Schoolgirl filling out form) + Approval Workflow */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Apply Leave Form */}
        <div className="pokiee-card p-6">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-800 mb-4">
            <img
              src="/mascots/schoolgirl.png"
              alt="Schoolgirl Applying"
              className="size-10 object-contain"
            />
            <div>
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                Request Time Off
              </h3>
              <p className="text-[10.5px] text-slate-400">Submit request for manager review</p>
            </div>
          </div>

          {appliedSuccess && (
            <div className="p-3 mb-3 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold flex items-center gap-2">
              <CheckCircle className="size-4" />
              <span>Leave request submitted successfully!</span>
            </div>
          )}

          <form onSubmit={handleApply} className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Leave Type</label>
              <select
                value={applyForm.leaveType}
                onChange={(e) => setApplyForm({ ...applyForm, leaveType: e.target.value })}
                className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
              >
                <option value="Casual Leave">Casual Leave (CL)</option>
                <option value="Sick Leave">Sick Leave (SL)</option>
                <option value="Earned Leave">Earned Leave (EL)</option>
                <option value="Loss of Pay">Loss of Pay (LOP)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">From Date</label>
                <input
                  type="date"
                  required
                  value={applyForm.startDate}
                  onChange={(e) => setApplyForm({ ...applyForm, startDate: e.target.value })}
                  className="w-full h-9 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">To Date</label>
                <input
                  type="date"
                  required
                  value={applyForm.endDate}
                  onChange={(e) => setApplyForm({ ...applyForm, endDate: e.target.value })}
                  className="w-full h-9 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Reason</label>
              <textarea
                rows={2}
                required
                value={applyForm.reason}
                onChange={(e) => setApplyForm({ ...applyForm, reason: e.target.value })}
                placeholder="Brief reason for your time off..."
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white font-bold text-xs transition shadow-xs flex items-center justify-center gap-1.5"
            >
              <Send className="size-3.5" />
              <span>Submit Leave Request</span>
            </button>
          </form>
        </div>

        {/* Multi-tier Approval Workflow Diagram */}
        <div className="lg:col-span-2 pokiee-card p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                Approval Workflow Routing
              </h3>
              <span className="text-[10.5px] font-bold text-slate-400">
                Automatic Multi-Tier Routing
              </span>
            </div>

            {/* Workflow diagram with small cartoon characters passing documents */}
            <div className="py-4 space-y-4">
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300 w-24">Sales Dept:</span>
                <div className="flex-1 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-blue-100 text-[#1d5cc8] font-bold text-[11px]">Sales Team</span>
                  <ArrowRight className="size-3 text-slate-400" />
                  <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 font-bold text-[11px]">HR Review</span>
                  <ArrowRight className="size-3 text-slate-400" />
                  <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 font-bold text-[11px]">Admin Sign-Off</span>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300 w-24">Staff Level:</span>
                <div className="flex-1 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-pink-100 text-[#ff4b72] font-bold text-[11px]">Employee</span>
                  <ArrowRight className="size-3 text-slate-400" />
                  <span className="px-2 py-0.5 rounded-md bg-blue-100 text-[#1d5cc8] font-bold text-[11px]">Direct Lead</span>
                  <ArrowRight className="size-3 text-slate-400" />
                  <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 font-bold text-[11px]">HR Operation</span>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300 w-24">Admin / Exec:</span>
                <div className="flex-1 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 font-bold text-[11px]">HR Lead</span>
                  <ArrowRight className="size-3 text-slate-400" />
                  <span className="px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 font-bold text-[11px]">Super Admin</span>
                </div>
              </div>
            </div>
          </div>

          {/* Pending Applications List */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <h4 className="font-bold text-xs text-slate-600 dark:text-slate-300 mb-2">
              Action Required (Pending Requests)
            </h4>
            <div className="space-y-2">
              {leaves.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <img src={l.avatar} alt={l.employeeName} className="size-7 rounded-full object-cover" />
                    <div>
                      <p className="font-bold text-slate-800 dark:text-white">{l.employeeName}</p>
                      <p className="text-[10px] text-slate-400">{l.leaveType} ({l.days}d) • {l.startDate}</p>
                    </div>
                  </div>

                  {l.status === 'Pending' ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleDecision(l.id, 'Approved')}
                        className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 font-bold text-[11px] hover:bg-emerald-200 transition"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleDecision(l.id, 'Rejected')}
                        className="px-3 py-1 rounded-full bg-pink-100 text-pink-700 font-bold text-[11px] hover:bg-pink-200 transition"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-bold ${
                        l.status === 'Approved' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                      }`}
                    >
                      {l.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
