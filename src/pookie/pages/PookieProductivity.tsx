import { useState } from 'react'
import {
  Gauge,
  CheckCircle2,
  Clock,
  AlertOctagon,
  TrendingUp,
  Laptop,
  Calendar,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react'

export default function PookieProductivity() {
  const [tasks, setTasks] = useState([
    { id: 'TSK-1', client: 'Acme Retail Corp', title: 'Q3 Tax Deductions & Filing', due: 'Today', status: 'In Progress', progress: 75 },
    { id: 'TSK-2', client: 'Starlight Tech', title: 'Payroll Slips Generation & Dispatch', due: 'Tomorrow', status: 'Completed', progress: 100 },
    { id: 'TSK-3', client: 'Zenith Logistics', title: 'PF ECR File Submission', due: '08 Oct', status: 'In Progress', progress: 40 },
    { id: 'TSK-4', client: 'Nexus Retailers', title: 'Biometric Attendance Reconciliation', due: '10 Oct', status: 'Pending', progress: 10 },
  ])

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="Pookie-card p-6 sm:p-8 bg-gradient-to-r from-blue-50/60 via-white to-purple-50/50 dark:from-blue-950/20 dark:to-purple-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-xl bg-blue-100 dark:bg-blue-950 text-[#1d5cc8] font-bold text-xs">
              <Gauge className="size-4" />
            </span>
            <span className="text-xs font-bold text-slate-400">Efficiency & Velocity</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
            Productivity & Client Tasks
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-1">
            Monitor client deliverables, log billable timesheets, and resolve workflow bottlenecks.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-4 py-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-right shadow-2xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Team Velocity</span>
            <p className="text-sm font-black text-emerald-600 flex items-center gap-1 justify-end">
              <TrendingUp className="size-3.5" />
              94.8% SLA Met
            </p>
          </div>
        </div>
      </div>

      {/* Grid: 4 Core Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Client Tasks: Funny schoolboy working on a laptop in card corner */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <Laptop className="size-4 text-blue-600" />
                <span>Active Client Deliverables</span>
              </h3>
              <span className="text-[11px] font-bold text-slate-400">4 In Queue</span>
            </div>

            <div className="space-y-3 pt-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase text-[#1d5cc8]">
                      {task.client}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        task.status === 'Completed'
                          ? 'bg-emerald-100 text-emerald-700'
                          : task.status === 'In Progress'
                          ? 'bg-blue-100 text-[#1d5cc8]'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {task.status}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-white mt-1">
                    {task.title}
                  </h4>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200/50 dark:border-slate-800 text-[10.5px] text-slate-400">
                    <span>Due: {task.due}</span>
                    <span className="font-bold text-slate-600 dark:text-slate-300">
                      {task.progress}% Done
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Schoolboy on laptop in corner */}
          <div className="absolute bottom-2 right-2 w-14 h-14 pointer-events-none opacity-85">
            <img
              src="/mascots/schoolboy.png"
              alt="Schoolboy Laptop"
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        {/* 2. Timesheets: Blue robotic cat beside a clock and timesheet in corner */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <Clock className="size-4 text-purple-600" />
                <span>Weekly Logged Timesheets</span>
              </h3>
              <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                42.5 hrs / target
              </span>
            </div>

            <div className="space-y-3 pt-3">
              {[
                { day: 'Monday (Oct 05)', billable: '7.5 hrs', nonBillable: '1.0 hr', project: 'Rexera Client Invoicing' },
                { day: 'Tuesday (Oct 06)', billable: '8.0 hrs', nonBillable: '0.5 hr', project: 'Staff PF Reconciliation' },
                { day: 'Wednesday (Oct 07)', billable: '7.0 hrs', nonBillable: '1.5 hrs', project: 'Payroll Slabs Review' },
                { day: 'Thursday (Oct 08)', billable: '8.5 hrs', nonBillable: '0.0 hr', project: 'Auditing Q3 Advances' },
              ].map((row) => (
                <div
                  key={row.day}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 text-xs"
                >
                  <div>
                    <p className="font-bold text-slate-800 dark:text-white">{row.day}</p>
                    <p className="text-[10px] text-slate-400">{row.project}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-emerald-600">{row.billable}</p>
                    <p className="text-[10px] text-slate-400">Billable</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Blue cat in corner */}
          <div className="absolute bottom-2 right-2 w-14 h-14 pointer-events-none opacity-85">
            <img
              src="/mascots/bluecat.png"
              alt="Bluecat Timesheet"
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        {/* 3. Blockers: Panda sitting beside small roadblock sign in corner */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <AlertOctagon className="size-4 text-rose-500" />
                <span>Workflow Roadblocks & Escalations</span>
              </h3>
              <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                2 Open
              </span>
            </div>

            <div className="space-y-3 pt-3">
              <div className="p-3 rounded-2xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-900/40">
                <span className="text-[10px] font-black text-rose-600 uppercase">
                  Bank IFSC Sync Failure
                </span>
                <p className="text-xs font-bold text-slate-800 dark:text-white mt-1">
                  Kotak Mahindra API webhook returned timeout during batch transfer preview.
                </p>
                <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500">
                  <span>Assigned to: Parv Shah</span>
                  <span className="font-bold text-rose-600">Urgent P1</span>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40">
                <span className="text-[10px] font-black text-amber-600 uppercase">
                  Pending Document Sign-off
                </span>
                <p className="text-xs font-bold text-slate-800 dark:text-white mt-1">
                  Aman Shah missing employment bond countersignature for Q4.
                </p>
                <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500">
                  <span>Assigned to: Neha Patel</span>
                  <span className="font-bold text-amber-600">P2 Review</span>
                </div>
              </div>
            </div>
          </div>

          {/* Panda in corner */}
          <div className="absolute bottom-2 right-2 w-14 h-14 pointer-events-none opacity-85">
            <img
              src="/mascots/panda.png"
              alt="Panda Roadblock"
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        {/* 4. Productivity Charts: Blonde character holding upward-trending chart */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <TrendingUp className="size-4 text-emerald-600" />
                <span>Department Velocity Index</span>
              </h3>
              <span className="text-[11px] font-bold text-[#1d5cc8]">Oct 2026</span>
            </div>

            <div className="space-y-4 pt-4">
              {[
                { name: 'Engineering', score: 96, color: 'bg-blue-500' },
                { name: 'Sales & BD', score: 92, color: 'bg-emerald-500' },
                { name: 'Marketing', score: 88, color: 'bg-purple-500' },
                { name: 'Human Resources', score: 95, color: 'bg-pink-500' },
              ].map((d) => (
                <div key={d.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-700 dark:text-slate-300">{d.name}</span>
                    <span className="text-slate-500">{d.score}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      style={{ width: `${d.score}%` }}
                      className={`h-full ${d.color} rounded-full`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Blonde character in corner */}
          <div className="absolute bottom-2 right-2 w-14 h-14 pointer-events-none opacity-85">
            <img
              src="/mascots/blonde.png"
              alt="Blonde Productivity Chart"
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
