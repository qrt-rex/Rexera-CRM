import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Save,
  CheckCircle2,
  UploadCloud,
  FileText,
} from 'lucide-react'
import { INITIAL_EMPLOYEES } from '../data'

export default function PokieeEmployeeForm() {
  const { id } = useParams()
  const nav = useNavigate()
  const isEdit = Boolean(id)
  const existing = INITIAL_EMPLOYEES.find((e) => e.id === id)

  const [form, setForm] = useState({
    name: existing?.name || '',
    email: existing?.email || '',
    phone: existing?.phone || '',
    dob: existing?.personal.dob || '',
    gender: existing?.personal.gender || 'Female',
    address: existing?.personal.address || '',
    role: existing?.role || '',
    dept: existing?.dept || 'Engineering',
    joinDate: existing?.joinDate || '01 Nov 2026',
    salary: existing?.salary || 50000,
    bankName: existing?.bank.bankName || 'HDFC Bank Ltd',
    accountNo: existing?.bank.accountNo || '',
    ifsc: existing?.bank.ifsc || '',
    pan: existing?.bank.pan || '',
    uan: existing?.bank.uan || '',
  })

  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setTimeout(() => {
      nav('/hr/employees')
    }, 1200)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header with Cute schoolgirl sitting beside laptop entering employee information */}
      <div className="flex items-center justify-between">
        <Link
          to="/hr/employees"
          className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-[#1d5cc8] transition"
        >
          <ArrowLeft className="size-4" />
          <span>Back to Directory</span>
        </Link>
      </div>

      <div className="pokiee-card p-6 sm:p-8 bg-gradient-to-r from-pink-50/50 via-white to-blue-50/40 dark:from-pink-950/20 dark:to-blue-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
            {isEdit ? 'Edit Employee Record' : 'Onboard New Employee'}
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-1">
            Complete the standard personnel profile and statutory payroll enrollment.
          </p>
        </div>
        {/* Mascot beside title */}
        <div className="shrink-0 flex items-center gap-2">
          <img
            src="/mascots/schoolgirl.png"
            alt="Schoolgirl Entering Info"
            className="size-16 object-contain anim-float-subtle"
          />
        </div>
      </div>

      {submitted && (
        <div className="p-4 rounded-2xl bg-emerald-50 text-emerald-700 font-bold text-sm flex items-center gap-2 border border-emerald-200 anim-fade-up">
          <CheckCircle2 className="size-5 text-emerald-600" />
          <span>Employee profile successfully saved! Redirecting to directory...</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Personal Details with Schoolgirl mascot header */}
        <div className="pokiee-card p-6">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-800 mb-5">
            <div className="size-8 rounded-lg bg-pink-100 dark:bg-pink-950 flex items-center justify-center">
              <img
                src="/mascots/schoolgirl.png"
                alt="Personal Details"
                className="size-6 object-contain"
              />
            </div>
            <h3 className="font-black text-sm text-slate-800 dark:text-white">
              1. Personal Details
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Riya Mehta"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Work Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="riya@pokiee.com"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Phone Number</label>
              <input
                type="text"
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+91 98765 43210"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Date of Birth</label>
              <input
                type="text"
                value={form.dob}
                onChange={(e) => setForm({ ...form, dob: e.target.value })}
                placeholder="14 Aug 1998"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Gender</label>
              <select
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
              >
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Non-binary">Non-binary</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Address</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Bandra West, Mumbai"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Employment Details with Schoolboy mascot header */}
        <div className="pokiee-card p-6">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-800 mb-5">
            <div className="size-8 rounded-lg bg-amber-100 dark:bg-amber-950 flex items-center justify-center">
              <img
                src="/mascots/schoolboy.png"
                alt="Employment Details"
                className="size-6 object-contain"
              />
            </div>
            <h3 className="font-black text-sm text-slate-800 dark:text-white">
              2. Employment & Role Details
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Designation</label>
              <input
                type="text"
                required
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="e.g. Sales Executive"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Department</label>
              <select
                value={form.dept}
                onChange={(e) => setForm({ ...form, dept: e.target.value })}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
              >
                <option value="Engineering">Engineering</option>
                <option value="Sales">Sales</option>
                <option value="Marketing">Marketing</option>
                <option value="Finance">Finance</option>
                <option value="Human Resources">Human Resources</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Monthly Basic (₹)</label>
              <input
                type="number"
                value={form.salary}
                onChange={(e) => setForm({ ...form, salary: Number(e.target.value) })}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>
          </div>
        </div>

        {/* Section 3: Bank Details with Blue Cat security lock */}
        <div className="pokiee-card p-6">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-800 mb-5">
            <div className="size-8 rounded-lg bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
              <img
                src="/mascots/bluecat.png"
                alt="Bank Security"
                className="size-6 object-contain"
              />
            </div>
            <h3 className="font-black text-sm text-slate-800 dark:text-white">
              3. Bank & Statutory Details
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Bank Name</label>
              <input
                type="text"
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Account Number</label>
              <input
                type="text"
                value={form.accountNo}
                onChange={(e) => setForm({ ...form, accountNo: e.target.value })}
                placeholder="50100293847"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs font-mono focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">IFSC Code</label>
              <input
                type="text"
                value={form.ifsc}
                onChange={(e) => setForm({ ...form, ifsc: e.target.value })}
                placeholder="HDFC0001234"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs font-mono focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">PAN Card</label>
              <input
                type="text"
                value={form.pan}
                onChange={(e) => setForm({ ...form, pan: e.target.value })}
                placeholder="ABCDE1234F"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs font-mono focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Provident Fund (UAN)</label>
              <input
                type="text"
                value={form.uan}
                onChange={(e) => setForm({ ...form, uan: e.target.value })}
                placeholder="100928374612"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs font-mono focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>
          </div>
        </div>

        {/* Section 4: Documents with Panda mascot */}
        <div className="pokiee-card p-6">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-800 mb-5">
            <div className="size-8 rounded-lg bg-purple-100 dark:bg-purple-950 flex items-center justify-center">
              <img
                src="/mascots/panda.png"
                alt="Documents Mascot"
                className="size-6 object-contain"
              />
            </div>
            <h3 className="font-black text-sm text-slate-800 dark:text-white">
              4. Documents & Onboarding Uploads
            </h3>
          </div>

          <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-6 text-center hover:bg-slate-50/50 transition cursor-pointer">
            <UploadCloud className="size-8 text-slate-400 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Drag and drop ID proofs, Resume, or Offer Letter
            </p>
            <p className="text-[10px] text-slate-400 mt-1">Supports PDF, JPG, PNG up to 10MB</p>
          </div>
        </div>

        {/* Submit Bar */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => nav('/hr/employees')}
            className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white text-xs font-bold transition shadow-sm"
          >
            <Save className="size-4" />
            <span>Save Employee Record</span>
          </button>
        </div>
      </form>
    </div>
  )
}
