import { useState } from 'react'
import {
  Settings as SettingsIcon,
  Mail,
  FileCode,
  ShieldAlert,
  Server,
  Save,
  CheckCircle2,
} from 'lucide-react'

export default function PookieeSettings() {
  const [saved, setSaved] = useState(false)

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="Pookiee-card p-6 sm:p-8 bg-gradient-to-r from-slate-50 via-white to-blue-50/50 dark:from-slate-900/40 dark:to-blue-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-xl bg-blue-100 text-[#1d5cc8] dark:bg-blue-950 font-bold text-xs">
              <SettingsIcon className="size-4" />
            </span>
            <span className="text-xs font-bold text-slate-400">System Configuration</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
            Payroll & HR Settings
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-1">
            Configure pay frequency rules, SMTP server credentials, PDF payslip templates and audit logs.
          </p>
        </div>

        {saved && (
          <span className="px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center gap-1.5 anim-pop">
            <CheckCircle2 className="size-4" />
            <span>Settings Saved!</span>
          </span>
        )}
      </div>

      <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Rules: Blue robotic cat holding a settings gear */}
        <div className="Pookiee-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                1. Pay Cycle & Cut-Off Rules
              </h3>
            </div>

            <div className="space-y-3 pt-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Pay Cycle Range</label>
                <select className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                  <option>1st to Last Day of Month (Standard)</option>
                  <option>25th to 24th of Next Month</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Cut-Off Day for Leaves</label>
                <input
                  type="number"
                  defaultValue={28}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Tax Regime Default</label>
                <select className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                  <option>New Tax Regime (Sec 115BAC)</option>
                  <option>Old Tax Regime</option>
                </select>
              </div>
            </div>
          </div>

          {/* Blue cat with gear mascot */}
          <div className="pt-3 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400">Rules Engine</span>
              <img src="/mascots/bluecat.png" alt="Bluecat Gear" className="size-10 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>

        {/* 2. SMTP: Panda holding email envelope */}
        <div className="Pookiee-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                2. SMTP & Email Gateway
              </h3>
            </div>

            <div className="space-y-3 pt-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">SMTP Host</label>
                <input
                  type="text"
                  defaultValue="smtp.sendgrid.net"
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Port</label>
                  <input
                    type="number"
                    defaultValue={587}
                    className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Security</label>
                  <select className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                    <option>STARTTLS</option>
                    <option>SSL/TLS</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">From Email Address</label>
                <input
                  type="email"
                  defaultValue="payroll@Pookiee.com"
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>
            </div>
          </div>

          {/* Panda with envelope mascot */}
          <div className="pt-3 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400">SMTP Active</span>
              <img src="/mascots/panda.png" alt="Panda SMTP" className="size-10 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>

        {/* 3. Templates: Schoolgirl editing document template */}
        <div className="Pookiee-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                3. Payslip & Letter Templates
              </h3>
            </div>

            <div className="space-y-3 pt-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Active Payslip Theme</label>
                <select className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                  <option>Pookiee Modern Pastel (Default)</option>
                  <option>Corporate Minimalist</option>
                  <option>Detailed Tax Breakdown</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Company Seal & Signature</label>
                <div className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
                  <span className="font-bold text-emerald-600">✓ Digital Seal Loaded</span>
                  <button type="button" className="text-xs text-[#1d5cc8] font-bold">Replace</button>
                </div>
              </div>
            </div>
          </div>

          {/* Schoolgirl mascot */}
          <div className="pt-3 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400">Template Editor</span>
              <img src="/mascots/schoolgirl.png" alt="Schoolgirl Template" className="size-10 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>

        {/* 4. Audit & Email Logs: Funny schoolboy & Blonde */}
        <div className="Pookiee-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                4. Audit Trail & Dispatch Logs
              </h3>
            </div>

            <div className="space-y-2 pt-3 text-xs">
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
                <span>Parv Shah updated TDS slabs</span>
                <span className="text-[10px] text-slate-400">2h ago</span>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
                <span>Auto-backup completed</span>
                <span className="text-[10px] text-slate-400">Yesterday</span>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
                <span>125 Payslips sent without error</span>
                <span className="text-[10px] text-emerald-600 font-bold">Success</span>
              </div>
            </div>
          </div>

          <div className="pt-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <img src="/mascots/schoolboy.png" alt="Schoolboy Audit" className="size-8 object-contain" />
              <img src="/mascots/blonde.png" alt="Blonde Email Logs" className="size-8 object-contain" />
            </div>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white font-bold text-xs transition flex items-center gap-1.5 shadow-xs"
            >
              <Save className="size-3.5" />
              <span>Save Settings</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
