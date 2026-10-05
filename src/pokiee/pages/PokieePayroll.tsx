import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  IndianRupee,
  CheckCircle2,
  FileCheck,
  Download,
  Mail,
  ArrowRight,
  ShieldCheck,
  FileSpreadsheet,
  Calculator,
  Building,
} from 'lucide-react'

export default function PokieePayroll() {
  const [stage, setStage] = useState<'Calculate' | 'Approve' | 'Finalise' | 'Paid'>('Finalise')
  const [bankExported, setBankExported] = useState(false)
  const [emailsSent, setEmailsSent] = useState(false)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pokiee-card p-6 sm:p-8 bg-gradient-to-r from-emerald-50/70 via-white to-blue-50/50 dark:from-emerald-950/20 dark:to-blue-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 font-bold text-xs">
              <IndianRupee className="size-4" />
            </span>
            <span className="text-xs font-bold text-slate-400">Monthly Compensation Run</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
            Payroll Processing (October 2026)
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-1">
            Execute gross-to-net calculations, statutory deductions, bank transfer batches and automated payslip dispatch.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/hr/payslips"
            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition shadow-2xs"
          >
            View All Payslips
          </Link>
          <button
            onClick={() => setStage('Paid')}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-sm"
          >
            Mark Run as Paid
          </button>
        </div>
      </div>

      {/* Payroll Workflow: 4-Stage Stepper with Character Progression */}
      <div className="pokiee-card p-6">
        <h3 className="font-black text-sm text-slate-800 dark:text-white mb-4">
          Payroll Stage Progression
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Calculate: Blue Cat with calculator */}
          <div
            onClick={() => setStage('Calculate')}
            className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
              stage === 'Calculate'
                ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-950/40 shadow-xs'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50/40'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="size-6 rounded-full bg-blue-600 text-white font-black text-xs flex items-center justify-center">
                1
              </span>
              <img
                src="/mascots/bluecat.png"
                alt="Bluecat Calculator"
                className="size-10 object-contain"
              />
            </div>
            <div>
              <h4 className="font-black text-xs text-slate-800 dark:text-white">Calculate</h4>
              <p className="text-[10.5px] text-slate-400 mt-0.5">Biometrics & Overtime Synced</p>
              <span className="text-[10px] font-bold text-emerald-600 mt-1 inline-block">
                ✓ 125/125 Complete
              </span>
            </div>
          </div>

          {/* 2. Approve: Schoolgirl checking document */}
          <div
            onClick={() => setStage('Approve')}
            className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
              stage === 'Approve'
                ? 'border-purple-400 bg-purple-50/50 dark:bg-purple-950/40 shadow-xs'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50/40'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="size-6 rounded-full bg-purple-600 text-white font-black text-xs flex items-center justify-center">
                2
              </span>
              <img
                src="/mascots/schoolgirl.png"
                alt="Schoolgirl Checking Document"
                className="size-10 object-contain"
              />
            </div>
            <div>
              <h4 className="font-black text-xs text-slate-800 dark:text-white">Approve</h4>
              <p className="text-[10.5px] text-slate-400 mt-0.5">Manager & HR Sign-Off</p>
              <span className="text-[10px] font-bold text-emerald-600 mt-1 inline-block">
                ✓ Approved by Parv Shah
              </span>
            </div>
          </div>

          {/* 3. Finalise: Blonde character holding approved file */}
          <div
            onClick={() => setStage('Finalise')}
            className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
              stage === 'Finalise'
                ? 'border-pink-400 bg-pink-50/50 dark:bg-pink-950/40 shadow-xs'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50/40'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="size-6 rounded-full bg-[#1d5cc8] text-white font-black text-xs flex items-center justify-center">
                3
              </span>
              <img
                src="/mascots/blonde.png"
                alt="Blonde Finalise"
                className="size-10 object-contain"
              />
            </div>
            <div>
              <h4 className="font-black text-xs text-slate-800 dark:text-white">Finalise</h4>
              <p className="text-[10.5px] text-slate-400 mt-0.5">Lock Ledger & Tax Deductions</p>
              <span className="text-[10px] font-bold text-[#1d5cc8] mt-1 inline-block">
                ● Current Active Stage
              </span>
            </div>
          </div>

          {/* 4. Paid: Panda holding small rupee symbol */}
          <div
            onClick={() => setStage('Paid')}
            className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
              stage === 'Paid'
                ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/40 shadow-xs'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50/40'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="size-6 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center">
                4
              </span>
              <img
                src="/mascots/panda.png"
                alt="Panda Paid Rupee"
                className="size-10 object-contain"
              />
            </div>
            <div>
              <h4 className="font-black text-xs text-slate-800 dark:text-white">Paid</h4>
              <p className="text-[10.5px] text-slate-400 mt-0.5">Bank Dispatched & Verified</p>
              <span className="text-[10px] font-bold text-slate-400 mt-1 inline-block">
                Ready for release
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Payroll Summary (Funny schoolboy with calculator) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 pokiee-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <Calculator className="size-4 text-emerald-600" />
                <span>Financial Summary Breakdown (October 2026)</span>
              </h3>
              <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                125 Total Payees
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-5">
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                <span className="text-[10.5px] font-bold text-slate-400 uppercase">Gross Salary</span>
                <p className="text-xl font-black text-slate-800 dark:text-white mt-1">₹24,50,000</p>
                <p className="text-[10px] text-slate-400">Total base pay</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                <span className="text-[10.5px] font-bold text-slate-400 uppercase">Total Deductions</span>
                <p className="text-xl font-black text-rose-500 mt-1">₹3,25,000</p>
                <p className="text-[10px] text-slate-400">PF, ESI & TDS</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                <span className="text-[10.5px] font-bold text-slate-400 uppercase">Incentives & OT</span>
                <p className="text-xl font-black text-emerald-600 mt-1">₹1,50,000</p>
                <p className="text-[10px] text-slate-400">Variable additions</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/40">
                <span className="text-[10.5px] font-black text-emerald-700 dark:text-emerald-300 uppercase">Net Disbursal</span>
                <p className="text-xl font-black text-emerald-700 dark:text-emerald-300 mt-1">₹22,75,000</p>
                <p className="text-[10px] text-emerald-600">Final payout</p>
              </div>
            </div>
          </div>

          {/* Schoolboy holding calculator mascot */}
          <div className="pt-2 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Recalculated with exact days</span>
              <img
                src="/mascots/schoolboy.png"
                alt="Schoolboy Calculator"
                className="size-14 object-contain anim-float-subtle"
              />
            </div>
          </div>
        </div>

        {/* Bank Export & Payslip Email Actions */}
        <div className="space-y-4">
          {/* Bank export: Blue cat with secure bank-transfer document */}
          <div className="pokiee-card p-5 relative overflow-hidden flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2 font-black text-xs text-slate-800 dark:text-white">
                <Building className="size-4 text-[#1d5cc8]" />
                <span>Bank Transfer Export</span>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Download structured NEFT/RTGS batch file for HDFC / ICICI corporate portal.
              </p>
              <button
                onClick={() => setBankExported(true)}
                className="w-full py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-[#1d5cc8] font-bold text-xs transition flex items-center justify-center gap-1.5"
              >
                <Download className="size-4" />
                <span>Download Bank File (CSV)</span>
              </button>
              {bankExported && (
                <span className="block text-[10.5px] font-bold text-emerald-600 mt-2 text-center">
                  ✓ File generated: pokiee_batch_oct2026.csv
                </span>
              )}
            </div>
            {/* Mascot in corner */}
            <div className="absolute -bottom-1 right-1 w-12 h-12 pointer-events-none opacity-80">
              <img src="/mascots/bluecat.png" alt="Bluecat Bank" className="w-full h-full object-contain" />
            </div>
          </div>

          {/* Payslip email: Panda holding an envelope */}
          <div className="pokiee-card p-5 relative overflow-hidden flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2 font-black text-xs text-slate-800 dark:text-white">
                <Mail className="size-4 text-purple-600" />
                <span>Bulk Email Payslips</span>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Dispatch password-protected PDF payslips directly to employee inboxes.
              </p>
              <button
                onClick={() => setEmailsSent(true)}
                className="w-full py-2.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold text-xs transition flex items-center justify-center gap-1.5"
              >
                <Mail className="size-4" />
                <span>Send 125 Payslips</span>
              </button>
              {emailsSent && (
                <span className="block text-[10.5px] font-bold text-emerald-600 mt-2 text-center">
                  ✓ Sent to all 125 employees via SMTP!
                </span>
              )}
            </div>
            {/* Mascot in corner */}
            <div className="absolute -bottom-1 right-1 w-12 h-12 pointer-events-none opacity-80">
              <img src="/mascots/panda.png" alt="Panda Envelope" className="w-full h-full object-contain" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
