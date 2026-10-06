import { useState } from 'react'
import {
  Gift,
  Clock,
  CheckCircle2,
  FileCheck,
  Sparkles,
  ArrowRight,
  TrendingUp,
} from 'lucide-react'
import { CuteSparkle, CuteStar } from '../mascots'

export default function PookieBonuses() {
  const [bonuses, setBonuses] = useState([
    { id: 'B-1', employee: 'Riya Mehta', type: 'Diwali Festive Bonus', amount: 25000, status: 'Approved' },
    { id: 'B-2', employee: 'Aman Shah', type: 'Q3 Star Campaign Bonus', amount: 35000, status: 'Approved' },
    { id: 'B-3', employee: 'Rahul Verma', type: 'Critical Bug Bounty Award', amount: 15000, status: 'Pending Review' },
  ])

  const [overtimes, setOvertimes] = useState([
    { id: 'OT-1', employee: 'Kunal Deshmukh', hours: 14.5, rate: '1.5x (₹450/hr)', total: 6525, status: 'Approved' },
    { id: 'OT-2', employee: 'Sneha Rao', hours: 8.0, rate: '1.5x (₹400/hr)', total: 3200, status: 'Approved' },
    { id: 'OT-3', employee: 'Tanmay Joshi', hours: 12.0, rate: '1.5x (₹450/hr)', total: 5400, status: 'Pending Sign-Off' },
  ])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="Pookie-card p-6 sm:p-8 bg-gradient-to-r from-pink-50/60 via-white to-amber-50/50 dark:from-pink-950/20 dark:to-amber-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-xl bg-pink-100 text-[#ff4b72] dark:bg-pink-950 font-bold text-xs">
              <Gift className="size-4" />
            </span>
            <span className="text-xs font-bold text-slate-400">Festive & Discretionary Compensation</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <span>Bonuses & Overtime</span>
            <CuteSparkle className="text-pink-400" size={16} />
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-1">
            Review special festive payouts, approve overtime extra hours, and synchronize with the next payroll run.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-center shadow-2xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Approved Bonus Pool</span>
            <p className="text-sm font-black text-emerald-600">₹75,000</p>
          </div>
        </div>
      </div>

      {/* Row 1: Bonus Pool (Blonde with gift box) + Overtime (Schoolboy beside clock) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Bonus Pool: Blonde character holding small gift box */}
        <div className="Pookie-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <Gift className="size-4 text-pink-500" />
                <span>Special & Festive Bonuses</span>
              </h3>
              <span className="text-[10.5px] font-bold text-[#ff4b72] bg-pink-50 px-2 py-0.5 rounded-full">
                Diwali 2026 Ready
              </span>
            </div>

            <div className="space-y-3 pt-4">
              {bonuses.map((b) => (
                <div
                  key={b.id}
                  className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs"
                >
                  <div>
                    <h4 className="font-bold text-slate-800 dark:text-white">{b.employee}</h4>
                    <p className="text-[10.5px] text-slate-400">{b.type}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-black text-emerald-600">
                      ₹{b.amount.toLocaleString('en-IN')}
                    </span>
                    <span
                      className={`block text-[10px] font-bold ${
                        b.status === 'Approved' ? 'text-emerald-500' : 'text-amber-500'
                      }`}
                    >
                      {b.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Blonde mascot with gift box */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Gift rewards approved</span>
              <img src="/mascots/blonde.png" alt="Blonde Gift Box" className="size-14 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>

        {/* Overtime Tracker: Funny schoolboy working beside clock */}
        <div className="Pookie-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <Clock className="size-4 text-amber-500" />
                <span>Overtime Hours Tracker (1.5x)</span>
              </h3>
              <span className="text-[10.5px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                34.5 Total Hours
              </span>
            </div>

            <div className="space-y-3 pt-4">
              {overtimes.map((o) => (
                <div
                  key={o.id}
                  className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs"
                >
                  <div>
                    <h4 className="font-bold text-slate-800 dark:text-white">{o.employee}</h4>
                    <p className="text-[10.5px] text-slate-400">{o.hours} hrs logged @ {o.rate}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-black text-slate-800 dark:text-white">
                      ₹{o.total.toLocaleString('en-IN')}
                    </span>
                    <span
                      className={`block text-[10px] font-bold ${
                        o.status === 'Approved' ? 'text-emerald-500' : 'text-amber-500'
                      }`}
                    >
                      {o.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Schoolboy working beside clock mascot */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Night shift extra hours</span>
              <img src="/mascots/schoolboy.png" alt="Schoolboy Clock" className="size-14 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Approval (Blue Cat) & Payroll Integration (Panda carrying payroll file) */}
      <div className="Pookie-card p-6 flex flex-col md:flex-row items-center justify-between gap-6 bg-gradient-to-r from-blue-50/50 via-white to-purple-50/50 dark:from-blue-950/20 dark:to-purple-950/20">
        <div className="flex items-center gap-4">
          <img src="/mascots/bluecat.png" alt="Bluecat Approval" className="size-14 object-contain anim-float-subtle" />
          <div>
            <h3 className="text-base font-black text-slate-800 dark:text-white">
              HR Sign-Off & Automated Payroll Sync
            </h3>
            <p className="text-xs text-slate-500">
              All approved festive bonuses and verified overtime allowances are staged for inclusion in the upcoming October payslip run.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <img src="/mascots/panda.png" alt="Panda Payroll File" className="size-12 object-contain" />
          <button className="px-5 py-2.5 rounded-xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white font-bold text-xs transition shadow-sm">
            Push to Payroll Run
          </button>
        </div>
      </div>
    </div>
  )
}
