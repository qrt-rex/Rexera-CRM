import { useState } from 'react'
import {
  FileText,
  Download,
  Mail,
  Printer,
  Search,
  CheckCircle2,
  X,
  FileSpreadsheet,
} from 'lucide-react'
import { INITIAL_EMPLOYEES, Employee } from '../data'

export default function PookiePayslips() {
  const [employees] = useState<Employee[]>(INITIAL_EMPLOYEES)
  const [search, setSearch] = useState('')
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null)
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null)

  const filtered = employees.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.id.toLowerCase().includes(search.toLowerCase())
  )

  const sendEmail = (name: string) => {
    setEmailSuccess(`Payslip successfully emailed to ${name}`)
    setTimeout(() => setEmailSuccess(null), 2500)
  }

  return (
    <div className="space-y-6">
      {/* Header with Panda holding payslip */}
      <div className="Pookie-card p-6 sm:p-8 bg-gradient-to-r from-purple-50/60 via-white to-blue-50/50 dark:from-purple-950/20 dark:to-blue-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="size-16 rounded-2xl bg-purple-50 dark:bg-purple-950 flex items-center justify-center shrink-0">
            <img
              src="/mascots/panda.png"
              alt="Panda Payslip"
              className="size-12 object-contain anim-float-subtle"
            />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
              Payslips & Salary Certificates
            </h1>
            <p className="text-xs font-semibold text-slate-500 mt-1">
              Preview, generate official PDF slips, and export the comprehensive salary register.
            </p>
          </div>
        </div>

        {/* Salary Register export with Funny schoolboy */}
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition shadow-2xs">
            <FileSpreadsheet className="size-4 text-emerald-600" />
            <span>Export Salary Register</span>
          </button>
        </div>
      </div>

      {emailSuccess && (
        <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-700 font-bold text-xs flex items-center gap-2 border border-emerald-200 anim-fade-up">
          <CheckCircle2 className="size-4 text-emerald-600" />
          <span>{emailSuccess}</span>
        </div>
      )}

      {/* Payslip Cards Grid with tiny blue robotic cat in corner */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by employee name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
            />
          </div>
          <span className="text-xs font-bold text-slate-400">
            Showing {filtered.length} Payslips (October 2026)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((emp) => {
            const basic = emp.salary
            const hra = Math.round(basic * 0.4)
            const allowances = 8000
            const gross = basic + hra + allowances
            const pf = Math.round(basic * 0.12)
            const tax = 2500
            const net = gross - pf - tax

            return (
              <div
                key={emp.id}
                className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between hover:-translate-y-1 transition duration-200"
              >
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2.5">
                      <img src={emp.avatar} alt={emp.name} className="size-9 rounded-full object-cover" />
                      <div>
                        <h4 className="font-bold text-xs text-slate-800 dark:text-white">
                          {emp.name}
                        </h4>
                        <span className="text-[10px] text-slate-400">{emp.id} • {emp.dept}</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">
                      Disbursed
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 my-3 text-xs">
                    <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-900">
                      <span className="text-[10px] text-slate-400 block">Gross Pay</span>
                      <span className="font-bold text-slate-800 dark:text-white">
                        ₹{gross.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-900">
                      <span className="text-[10px] text-slate-400 block">Deductions</span>
                      <span className="font-bold text-rose-500">
                        ₹{(pf + tax).toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
                    <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-200">
                      Net Take Home:
                    </span>
                    <span className="font-black text-sm text-emerald-700 dark:text-emerald-300">
                      ₹{net.toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-4 mt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    onClick={() => setSelectedEmp(emp)}
                    className="flex-1 py-1.5 rounded-xl bg-blue-50 text-[#1d5cc8] font-bold text-xs hover:bg-blue-100 transition flex items-center justify-center gap-1"
                  >
                    <Printer className="size-3.5" />
                    <span>Generate PDF</span>
                  </button>
                  <button
                    onClick={() => sendEmail(emp.name)}
                    className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-purple-600 hover:bg-purple-50 transition"
                    title="Email Payslip"
                  >
                    <Mail className="size-4" />
                  </button>
                </div>

                {/* Tiny Blue cat holding document in card corner */}
                <div className="absolute top-2 right-2 w-8 h-8 pointer-events-none opacity-60">
                  <img
                    src="/mascots/bluecat.png"
                    alt="Bluecat Document"
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* PDF Generator Modal (Blonde character beside printer) */}
      {selectedEmp && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="Pookie-card max-w-xl w-full p-6 sm:p-8 bg-white dark:bg-[#12192e] relative max-h-[90vh] overflow-y-auto anim-pop">
            <button
              onClick={() => setSelectedEmp(null)}
              className="absolute top-5 right-5 text-slate-400 hover:text-slate-600"
            >
              <X className="size-5" />
            </button>

            {/* Modal Header with Blonde Printer mascot */}
            <div className="flex items-center gap-4 pb-4 border-b border-slate-100 dark:border-slate-800 mb-6">
              <img
                src="/mascots/blonde.png"
                alt="Blonde Printer Mascot"
                className="size-14 object-contain anim-float-subtle"
              />
              <div>
                <h3 className="font-black text-lg text-slate-800 dark:text-white">
                  Salary Slip Preview
                </h3>
                <p className="text-xs text-slate-400">
                  Pookie Technologies Pvt Ltd • Month of October 2026
                </p>
              </div>
            </div>

            {/* Structured Payslip layout */}
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4 p-3 rounded-2xl bg-slate-50 dark:bg-slate-900">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block">Employee Name</span>
                  <span className="font-bold text-slate-800 dark:text-white">{selectedEmp.name}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block">Employee ID</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-white">{selectedEmp.id}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block">Department</span>
                  <span className="font-bold text-slate-800 dark:text-white">{selectedEmp.dept}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block">Bank Account</span>
                  <span className="font-mono text-slate-800 dark:text-white">{selectedEmp.bank.accountNo}</span>
                </div>
              </div>

              {/* Earnings & Deductions Table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800 font-bold text-[11px] text-slate-600">
                    <tr>
                      <th className="p-2.5">Earnings</th>
                      <th className="p-2.5 text-right">Amount (₹)</th>
                      <th className="p-2.5">Deductions</th>
                      <th className="p-2.5 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
                    <tr>
                      <td className="p-2.5">Basic Salary</td>
                      <td className="p-2.5 text-right font-semibold">{selectedEmp.salary.toLocaleString('en-IN')}</td>
                      <td className="p-2.5">Provident Fund (12%)</td>
                      <td className="p-2.5 text-right font-semibold">{(selectedEmp.salary * 0.12).toLocaleString('en-IN')}</td>
                    </tr>
                    <tr>
                      <td className="p-2.5">House Rent Allowance (HRA)</td>
                      <td className="p-2.5 text-right font-semibold">{(selectedEmp.salary * 0.4).toLocaleString('en-IN')}</td>
                      <td className="p-2.5">Professional Tax</td>
                      <td className="p-2.5 text-right font-semibold">200</td>
                    </tr>
                    <tr>
                      <td className="p-2.5">Special Allowance</td>
                      <td className="p-2.5 text-right font-semibold">8,000</td>
                      <td className="p-2.5">Income Tax (TDS)</td>
                      <td className="p-2.5 text-right font-semibold">2,300</td>
                    </tr>
                    <tr className="bg-emerald-50/70 dark:bg-emerald-950/40 font-black">
                      <td className="p-2.5 text-emerald-800">Total Gross Pay</td>
                      <td className="p-2.5 text-right text-emerald-800">
                        ₹{(selectedEmp.salary + selectedEmp.salary * 0.4 + 8000).toLocaleString('en-IN')}
                      </td>
                      <td className="p-2.5 text-emerald-800">Net Take Home</td>
                      <td className="p-2.5 text-right text-emerald-800">
                        ₹{(selectedEmp.salary + selectedEmp.salary * 0.4 + 8000 - selectedEmp.salary * 0.12 - 2500).toLocaleString('en-IN')}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setSelectedEmp(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Close
              </button>
              <button
                onClick={() => {
                  alert('Printing PDF Payslip with official digital seal...')
                  setSelectedEmp(null)
                }}
                className="px-5 py-2 rounded-xl bg-[#1d5cc8] text-white text-xs font-bold hover:bg-[#184ea8] transition flex items-center gap-1.5"
              >
                <Download className="size-4" />
                <span>Download PDF Payslip</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
