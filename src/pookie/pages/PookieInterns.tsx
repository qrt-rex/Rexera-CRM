import { useState } from 'react'
import {
  GraduationCap,
  Users,
  Award,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Calendar,
  IndianRupee,
  UserCheck,
} from 'lucide-react'
import { INITIAL_INTERNS, Intern } from '../data'

export default function PookieInterns() {
  const [interns, setInterns] = useState<Intern[]>(INITIAL_INTERNS)
  const [convertedId, setConvertedId] = useState<string | null>(null)

  const handleConvert = (id: string) => {
    setConvertedId(id)
    setInterns((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: 'Completed' } : i))
    )
  }

  return (
    <div className="space-y-6">
      {/* Hero Banner matching spec:
          "Funny schoolboy and schoolgirl wearing small internship badges.
           Panda holding an 'Intern' folder." */}
      <div className="Pookie-card p-6 sm:p-8 bg-gradient-to-r from-amber-50/60 via-white to-blue-50/50 dark:from-amber-950/20 dark:to-blue-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
        <div className="space-y-1.5 max-w-xl">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-700 font-bold text-xs flex items-center gap-1">
              <GraduationCap className="size-4" />
              <span>Campus & Early Talent</span>
            </span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
            Internship Management & Conversion
          </h1>
          <p className="text-xs font-semibold text-slate-500">
            Nurture apprentices, track mentor feedback, and seamlessly transition interns into full-time staff.
          </p>
        </div>

        {/* Hero Mascots */}
        <div className="flex items-center gap-3">
          <div className="text-center">
            <img
              src="/mascots/schoolboy.png"
              alt="Schoolboy Badge"
              className="size-16 object-contain anim-float-subtle"
            />
          </div>
          <div className="text-center">
            <img
              src="/mascots/schoolgirl.png"
              alt="Schoolgirl Badge"
              className="size-16 object-contain anim-float-subtle"
            />
          </div>
          <div className="text-center">
            <img
              src="/mascots/panda.png"
              alt="Panda Intern Folder"
              className="size-16 object-contain anim-float-subtle"
            />
          </div>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="Pookie-card p-4">
          <p className="text-[11px] font-bold text-slate-400">Active Interns</p>
          <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">18</p>
          <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full mt-2 inline-block">
            4 Cohorts Active
          </span>
        </div>
        <div className="Pookie-card p-4">
          <p className="text-[11px] font-bold text-slate-400">Mentors Assigned</p>
          <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">12</p>
          <span className="text-[10px] font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full mt-2 inline-block">
            100% Coverage
          </span>
        </div>
        <div className="Pookie-card p-4">
          <p className="text-[11px] font-bold text-slate-400">Conversion Rate</p>
          <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">84%</p>
          <span className="text-[10px] font-extrabold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full mt-2 inline-block">
            Top Quartile
          </span>
        </div>
        <div className="Pookie-card p-4">
          <p className="text-[11px] font-bold text-slate-400">Avg Monthly Stipend</p>
          <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">₹18,000</p>
          <span className="text-[10px] font-extrabold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full mt-2 inline-block">
            Market Competitive
          </span>
        </div>
      </div>

      {/* Conversion Section matching spec:
          "Blue robotic cat holding an arrow pointing from 'Intern' to 'Employee.'" */}
      <div className="Pookie-card p-6 bg-gradient-to-r from-blue-50/80 via-white to-emerald-50/60 dark:from-blue-950/30 dark:to-emerald-950/30 border border-blue-200/70 dark:border-blue-900/50 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="size-16 rounded-2xl bg-white dark:bg-slate-900 shadow-xs flex items-center justify-center shrink-0">
            <img
              src="/mascots/bluecat.png"
              alt="Blue Cat Conversion"
              className="size-12 object-contain anim-float-subtle"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-[#1d5cc8] text-[10px] font-black uppercase">
                Fast-Track Pipeline
              </span>
              <span className="text-xs font-bold text-emerald-600">
                2 Interns Eligible for Full-Time Offer
              </span>
            </div>
            <h3 className="text-base font-black text-slate-800 dark:text-white mt-1 flex items-center gap-2">
              <span>Intern</span>
              <ArrowRight className="size-4 text-[#1d5cc8]" />
              <span>Full-Time Employee</span>
            </h3>
            <p className="text-xs text-slate-500">
              Generate FTE offer letter, configure salary slab, and assign reporting manager with 1 click.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleConvert('INT-01')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white text-xs font-bold transition shadow-sm"
          >
            <UserCheck className="size-4" />
            <span>Convert Top Interns</span>
          </button>
        </div>
      </div>

      {/* Intern Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {interns.map((item) => (
          <div
            key={item.id}
            className="Pookie-card p-5 flex flex-col justify-between hover:-translate-y-1 transition duration-200 group"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold text-slate-400 font-mono">
                  {item.id}
                </span>
                <span
                  className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${
                    item.status === 'Completed'
                      ? 'bg-emerald-100 text-emerald-700'
                      : item.status === 'Ready to Convert'
                      ? 'bg-blue-100 text-[#1d5cc8]'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {item.status}
                </span>
              </div>

              <div className="flex items-center gap-3 mb-3">
                <img
                  src={item.avatar}
                  alt={item.name}
                  className="size-11 rounded-2xl object-cover ring-2 ring-slate-100"
                />
                <div>
                  <h4 className="font-bold text-sm text-slate-800 dark:text-white group-hover:text-[#1d5cc8] transition">
                    {item.name}
                  </h4>
                  <p className="text-[11px] text-slate-400 font-semibold">{item.domain}</p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5 my-3">
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <span className="text-slate-500">Learning Progress</span>
                  <span className="text-[#1d5cc8]">{item.progress}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    style={{ width: `${item.progress}%` }}
                    className="h-full bg-gradient-to-r from-blue-400 to-[#1d5cc8] rounded-full"
                  />
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span>Mentor:</span>
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    {item.mentor}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Tenure:</span>
                  <span className="font-semibold text-slate-600">{item.duration}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Stipend:</span>
                  <span className="font-bold text-emerald-600">
                    ₹{item.stipend.toLocaleString('en-IN')}/mo
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-4 mt-2">
              {item.status === 'Ready to Convert' ? (
                <button
                  onClick={() => handleConvert(item.id)}
                  className="w-full py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-[#1d5cc8] font-bold text-xs transition"
                >
                  Convert to Full-Time
                </button>
              ) : item.status === 'Completed' ? (
                <span className="w-full block py-2 rounded-xl bg-emerald-50 text-emerald-600 font-bold text-xs text-center">
                  ✓ Converted to FTE
                </span>
              ) : (
                <button className="w-full py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition">
                  View Learning Plan
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
