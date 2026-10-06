import { useState } from 'react'
import {
  HandCoins,
  FileCheck,
  Search,
  CheckCircle2,
  Calendar,
  AlertCircle,
  IndianRupee,
  Clock,
} from 'lucide-react'

export default function PookieLoans() {
  const [loans, setLoans] = useState([
    { id: 'LN-201', employee: 'Rahul Verma', amount: 50000, type: 'Medical Emergency Loan', emi: 5000, tenure: '10 Months', status: 'Active', paidEmi: 4 },
    { id: 'LN-202', employee: 'Meera Jain', amount: 30000, type: 'Salary Advance', emi: 10000, tenure: '3 Months', status: 'Approved', paidEmi: 1 },
    { id: 'LN-203', employee: 'Aman Shah', amount: 75000, type: 'Home Relocation Advance', emi: 7500, tenure: '10 Months', status: 'Pending Review', paidEmi: 0 },
  ])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="Pookie-card p-6 sm:p-8 bg-gradient-to-r from-blue-50/60 via-white to-emerald-50/50 dark:from-blue-950/20 dark:to-emerald-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-xl bg-blue-100 text-[#1d5cc8] dark:bg-blue-950 font-bold text-xs">
              <HandCoins className="size-4" />
            </span>
            <span className="text-xs font-bold text-slate-400">Employee Financial Support</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
            Advances & Personal Loans
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-1">
            Interest-free staff emergency advances, EMI repayment schedules and automatic payroll deductions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-center shadow-2xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Outstanding Book</span>
            <p className="text-sm font-black text-blue-600">₹1,55,000</p>
          </div>
        </div>
      </div>

      {/* Row 1: Advance request (Schoolgirl) + Loan agreement (Panda) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Advance Request: Schoolgirl submitting document */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                Submit Salary Advance Request
              </h3>
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                Up to 1 Month Salary
              </span>
            </div>

            <form className="space-y-3 pt-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Requested Amount (₹)</label>
                <input
                  type="number"
                  placeholder="e.g. 25000"
                  defaultValue={25000}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Deduction Tenure</label>
                  <select className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:outline-none">
                    <option>1 Month (Full)</option>
                    <option>2 Months</option>
                    <option>3 Months</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Reason</label>
                  <input
                    type="text"
                    placeholder="Medical / Personal"
                    defaultValue="Emergency travel"
                    className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:outline-none"
                  />
                </div>
              </div>
              <button
                type="button"
                className="w-full py-2.5 rounded-xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white font-bold text-xs transition shadow-2xs"
              >
                Submit for Approval
              </button>
            </form>
          </div>

          {/* Schoolgirl mascot */}
          <div className="pt-3 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Formal advance application</span>
              <img src="/mascots/schoolgirl.png" alt="Schoolgirl Advance" className="size-12 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>

        {/* Loan Policy & Agreement: Panda holding small agreement */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                Company Loan Agreement Terms
              </h3>
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                0% Interest Policy
              </span>
            </div>

            <div className="space-y-2.5 pt-3 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900">
                <p className="font-bold text-slate-800 dark:text-white">Eligibility Criteria</p>
                <p className="text-[11px] text-slate-500">Minimum 6 months completed service with confirmed probation.</p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900">
                <p className="font-bold text-slate-800 dark:text-white">Maximum Cap</p>
                <p className="text-[11px] text-slate-500">Up to 3x monthly gross salary with maximum 12 EMIs.</p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900">
                <p className="font-bold text-slate-800 dark:text-white">Payroll Deductions</p>
                <p className="text-[11px] text-slate-500">Auto-debited on the last working day of each calendar month.</p>
              </div>
            </div>
          </div>

          {/* Panda mascot */}
          <div className="pt-3 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Formal agreement signed</span>
              <img src="/mascots/panda.png" alt="Panda Agreement" className="size-12 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Active Advances Ledger + Approval (Bluecat) & Repayment (Schoolboy) */}
      <div className="Pookie-card p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-4">
          <div className="flex items-center gap-3">
            <img src="/mascots/bluecat.png" alt="Bluecat Approval" className="size-10 object-contain" />
            <div>
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                Active Advances & Repayment Ledger
              </h3>
              <p className="text-[11px] text-slate-400">Review status, tenure and monthly salary deduction progress</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <img src="/mascots/schoolboy.png" alt="Schoolboy Repayment" className="size-10 object-contain" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-[11px] font-extrabold text-slate-500 uppercase">
              <tr>
                <th className="py-2.5 px-3">Employee</th>
                <th className="py-2.5 px-3">Loan Type</th>
                <th className="py-2.5 px-3">Sanctioned</th>
                <th className="py-2.5 px-3">Monthly EMI</th>
                <th className="py-2.5 px-3">Repayment Progress</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loans.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50 transition">
                  <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-white">
                    {item.employee}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                    {item.type}
                  </td>
                  <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-white">
                    ₹{item.amount.toLocaleString('en-IN')}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-emerald-600">
                    ₹{item.emi.toLocaleString('en-IN')}/mo
                  </td>
                  <td className="py-2.5 px-3 text-slate-500">
                    {item.paidEmi} EMIs cleared ({item.tenure})
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        item.status === 'Active'
                          ? 'bg-emerald-50 text-emerald-600'
                          : item.status === 'Approved'
                          ? 'bg-blue-50 text-[#1d5cc8]'
                          : 'bg-amber-50 text-amber-600'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
