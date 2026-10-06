import { useState } from 'react'
import {
  TrendingUp,
  Award,
  Star,
  Target,
  FileCheck,
  CheckCircle2,
  Download,
  Building2,
  Sparkles,
  ChevronRight,
} from 'lucide-react'
import { CuteSparkle, CuteStar } from '../mascots'

export default function PookieePerformance() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="Pookiee-card p-6 sm:p-8 bg-gradient-to-r from-blue-50/60 via-white to-pink-50/40 dark:from-blue-950/20 dark:to-pink-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950 font-bold text-xs">
              <Award className="size-4" />
            </span>
            <span className="text-xs font-bold text-slate-400">Quarterly Reviews & OKRs</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <span>Performance Management</span>
            <CuteSparkle className="text-amber-400" size={16} />
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-1">
            Measure KPI achievements, set company OKRs, and generate comprehensive appraisal reports.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-center shadow-2xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Q3 Appraisal Health</span>
            <p className="text-sm font-black text-emerald-600">96.2% On Track</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Individual Performance: Schoolgirl holding a performance scorecard */}
        <div className="Pookiee-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <Star className="size-4 text-amber-500 fill-amber-400" />
                <span>Individual Scorecards & Star Performers</span>
              </h3>
              <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                Top Quartile
              </span>
            </div>

            <div className="space-y-3 pt-4">
              {[
                { name: 'Riya Mehta', role: 'Sales Executive', rating: 4.8, kpi: '118% Target Achieved' },
                { name: 'Aman Shah', role: 'Marketing Lead', rating: 4.9, kpi: '124% Leads Delivered' },
                { name: 'Rahul Verma', role: 'Frontend Engineer', rating: 4.6, kpi: '99.4% Bug-Free Releases' },
              ].map((person) => (
                <div
                  key={person.name}
                  className="p-3 rounded-2xl bg-slate-50/70 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between"
                >
                  <div>
                    <h4 className="font-bold text-xs text-slate-800 dark:text-white">
                      {person.name}
                    </h4>
                    <p className="text-[10.5px] text-slate-400">{person.role}</p>
                    <span className="text-[10px] font-extrabold text-emerald-600 mt-1 inline-block">
                      {person.kpi}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-amber-500 font-black text-xs justify-end">
                      <Star className="size-3.5 fill-amber-400" />
                      <span>{person.rating} / 5.0</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-400">Scorecard Final</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Schoolgirl mascot */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Appraisal scorecard ready</span>
              <img
                src="/mascots/schoolgirl.png"
                alt="Schoolgirl Scorecard"
                className="size-14 object-contain anim-float-subtle"
              />
            </div>
          </div>
        </div>

        {/* 2. Company Performance: Blue robotic cat presenting a company dashboard */}
        <div className="Pookiee-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <Building2 className="size-4 text-[#1d5cc8]" />
                <span>Company-Wide Performance Metrics</span>
              </h3>
              <span className="text-[11px] font-bold text-slate-400">FY 2026-27</span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-4">
              <div className="p-3.5 rounded-2xl bg-blue-50/60 dark:bg-blue-950/40 border border-blue-100 text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Retention Rate</span>
                <p className="text-xl font-black text-[#1d5cc8] mt-0.5">96.4%</p>
                <p className="text-[10px] text-slate-400">+2.1% YoY</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Goal Completion</span>
                <p className="text-xl font-black text-emerald-600 mt-0.5">91.8%</p>
                <p className="text-[10px] text-slate-400">Above target</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-purple-50/60 dark:bg-purple-950/40 border border-purple-100 text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Employee NPS</span>
                <p className="text-xl font-black text-purple-600 mt-0.5">+68 eNPS</p>
                <p className="text-[10px] text-slate-400">Excellent</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-pink-50/60 dark:bg-pink-950/40 border border-pink-100 text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Training Hours</span>
                <p className="text-xl font-black text-pink-600 mt-0.5">380 Hrs</p>
                <p className="text-[10px] text-slate-400">L&D logged</p>
              </div>
            </div>
          </div>

          {/* Blue cat mascot */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Executive dashboard view</span>
              <img
                src="/mascots/bluecat.png"
                alt="Bluecat Company Dashboard"
                className="size-14 object-contain anim-float-subtle"
              />
            </div>
          </div>
        </div>

        {/* 3. Goals: Funny schoolboy climbing a small staircase toward a star */}
        <div className="Pookiee-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <Target className="size-4 text-emerald-600" />
                <span>Strategic OKRs & Goal Milestones</span>
              </h3>
              <span className="text-[11px] font-bold text-emerald-600">Q3 Sprints</span>
            </div>

            <div className="space-y-3.5 pt-4">
              {[
                { title: 'Scale Engineering Capacity to 50 Engineers', progress: 84, color: 'bg-blue-500' },
                { title: 'Achieve 100% Statutory Compliance in PF & ESI', progress: 100, color: 'bg-emerald-500' },
                { title: 'Automate Employee Self-Service Onboarding', progress: 65, color: 'bg-amber-500' },
              ].map((g) => (
                <div key={g.title} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-800 dark:text-slate-200 truncate pr-2">{g.title}</span>
                    <span className="text-slate-500 shrink-0">{g.progress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div style={{ width: `${g.progress}%` }} className={`h-full ${g.color} rounded-full`} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Schoolboy climbing toward star mascot */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Aiming for 5-star target!</span>
              <img
                src="/mascots/schoolboy.png"
                alt="Schoolboy Climbing"
                className="size-14 object-contain anim-float-subtle"
              />
            </div>
          </div>
        </div>

        {/* 4. Reports: Panda holding a report document */}
        <div className="Pookiee-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <FileCheck className="size-4 text-purple-600" />
                <span>Performance Audit & Exports</span>
              </h3>
              <button className="flex items-center gap-1 text-xs font-bold text-[#1d5cc8] hover:underline">
                <Download className="size-3.5" />
                <span>Download All</span>
              </button>
            </div>

            <div className="space-y-2.5 pt-4">
              {[
                { name: 'Q3_Performance_Summary_2026.pdf', size: '2.4 MB', date: '01 Oct 2026' },
                { name: 'Annual_Promotion_Shortlist.xlsx', size: '890 KB', date: '28 Sep 2026' },
                { name: 'Manager_Feedback_Consolidation.pdf', size: '1.6 MB', date: '25 Sep 2026' },
              ].map((rep) => (
                <div
                  key={rep.name}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 text-xs"
                >
                  <div>
                    <p className="font-bold text-slate-800 dark:text-white">{rep.name}</p>
                    <p className="text-[10px] text-slate-400">{rep.size} • {rep.date}</p>
                  </div>
                  <button className="p-1.5 rounded-lg text-slate-400 hover:text-[#1d5cc8] transition">
                    <Download className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Panda holding report mascot */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Formal appraisal dossiers</span>
              <img
                src="/mascots/panda.png"
                alt="Panda Report"
                className="size-14 object-contain anim-float-subtle"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
