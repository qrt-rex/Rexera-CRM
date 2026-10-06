import { useState } from 'react'
import {
  ShieldCheck,
  BookOpen,
  Users,
  Calculator,
  FileSpreadsheet,
  Search,
  CheckCircle2,
  Download,
} from 'lucide-react'
import { INITIAL_EMPLOYEES } from '../data'

export default function PookiePF() {
  const [employees] = useState(INITIAL_EMPLOYEES)
  const [search, setSearch] = useState('')

  const filtered = employees.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.bank.uan.includes(search)
  )

  return (
    <div className="space-y-6">
      {/* Header / Dashboard: Blue robotic cat holding a shield and financial document */}
      <div className="Pookie-card p-6 sm:p-8 bg-gradient-to-r from-emerald-50/70 via-white to-blue-50/50 dark:from-emerald-950/20 dark:to-blue-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 font-bold text-xs">
              <ShieldCheck className="size-4" />
            </span>
            <span className="text-xs font-bold text-slate-400">Statutory EPFO Compliance</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
            Provident Fund (PF) Management
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-1">
            EPFO ECR electronic filing, KYC linking, employer/employee split contributions and statutory challans.
          </p>
        </div>

        {/* Mascot: Blue robotic cat holding shield and financial document */}
        <div className="flex items-center gap-3">
          <div className="size-16 rounded-2xl bg-white dark:bg-slate-900 shadow-xs flex items-center justify-center">
            <img
              src="/mascots/bluecat.png"
              alt="Bluecat PF Shield"
              className="size-14 object-contain anim-float-subtle"
            />
          </div>
        </div>
      </div>

      {/* Grid: 4 Core Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* 1. PF Rules: Panda holding a rulebook */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <BookOpen className="size-4 text-blue-600" />
                <span>EPFO Statutory Contribution Slabs</span>
              </h3>
            </div>

            <div className="space-y-2.5 pt-3 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Employee Share (EPF)</span>
                <span className="font-bold text-emerald-600">12.00%</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Employer EPF Share</span>
                <span className="font-bold text-blue-600">3.67%</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Employer Pension (EPS)</span>
                <span className="font-bold text-purple-600">8.33%</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
                <span className="font-semibold text-slate-600 dark:text-slate-300">EDLI & Admin Charges</span>
                <span className="font-bold text-slate-700 dark:text-slate-200">1.00%</span>
              </div>
            </div>
          </div>

          {/* Panda in corner */}
          <div className="pt-3 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">EPFO Rules 2026</span>
              <img src="/mascots/panda.png" alt="Panda Rules" className="size-12 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>

        {/* 2. PF Payroll: Funny schoolboy using a calculator */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <Calculator className="size-4 text-emerald-600" />
                <span>Monthly PF Contribution Pool</span>
              </h3>
              <span className="text-[11px] font-bold text-slate-400">Oct 2026</span>
            </div>

            <div className="space-y-3 pt-3">
              <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100">
                <span className="text-[10px] font-bold text-emerald-700 uppercase">Total Deposit Value</span>
                <p className="text-xl font-black text-emerald-700 dark:text-emerald-300 mt-0.5">₹4,28,400</p>
                <p className="text-[10px] text-slate-400">Combined employee + employer remittance</p>
              </div>

              <div className="flex items-center justify-between text-xs p-2 rounded-xl bg-slate-50 dark:bg-slate-900">
                <span className="text-slate-500">Challan Due Date:</span>
                <span className="font-bold text-rose-500">15 Oct 2026</span>
              </div>
            </div>
          </div>

          {/* Schoolboy calculator in corner */}
          <div className="pt-3 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">ECR File Computation</span>
              <img src="/mascots/schoolboy.png" alt="Schoolboy Calculator" className="size-12 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>

        {/* 3. Reports & Audit: Blonde character & Blue cat */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <FileSpreadsheet className="size-4 text-purple-600" />
                <span>ECR Filing & Challan Download</span>
              </h3>
            </div>

            <div className="space-y-2 pt-3">
              <button className="w-full py-2.5 rounded-xl bg-blue-50 text-[#1d5cc8] font-bold text-xs hover:bg-blue-100 transition flex items-center justify-center gap-2">
                <Download className="size-4" />
                <span>Download ECR Text File (.txt)</span>
              </button>
              <button className="w-full py-2.5 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs hover:bg-slate-200 transition flex items-center justify-center gap-2">
                <Download className="size-4" />
                <span>EPFO Challan Receipt (PDF)</span>
              </button>
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-emerald-600">100% Audit Verified</span>
              <img src="/mascots/blonde.png" alt="Blonde Audit" className="size-12 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>
      </div>

      {/* Employee PF Directory: Schoolgirl holding employee PF card */}
      <div className="Pookie-card p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <img src="/mascots/schoolgirl.png" alt="Schoolgirl PF Card" className="size-10 object-contain" />
            <div>
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                Employee PF & Universal Account Number (UAN) Directory
              </h3>
              <p className="text-[11px] text-slate-400">KYC verification status linked with EPFO portal</p>
            </div>
          </div>

          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search UAN or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto pt-3">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-[11px] font-extrabold text-slate-500 uppercase">
              <tr>
                <th className="py-2.5 px-3">Employee</th>
                <th className="py-2.5 px-3">UAN Number</th>
                <th className="py-2.5 px-3">PAN Linked</th>
                <th className="py-2.5 px-3">Monthly EPF</th>
                <th className="py-2.5 px-3">KYC Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50/50 transition">
                  <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <img src={emp.avatar} alt={emp.name} className="size-7 rounded-full object-cover" />
                    <span>{emp.name}</span>
                  </td>
                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-600 dark:text-slate-300">
                    {emp.bank.uan}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-500">{emp.bank.pan}</td>
                  <td className="py-2.5 px-3 font-bold text-emerald-600">
                    ₹{Math.round(emp.salary * 0.12).toLocaleString('en-IN')}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="size-3 text-emerald-600" />
                      EPFO Verified
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
