import { useState } from 'react'
import {
  Target,
  Plus,
  Search,
  Filter,
  ArrowRight,
  Star,
  CheckCircle2,
  Clock,
  UserCheck,
  Building,
} from 'lucide-react'
import { INITIAL_CANDIDATES, Candidate } from '../data'

const PIPELINE_COLUMNS: {
  id: Candidate['stage']
  title: string
  mascot: string
  mascotAlt: string
  color: string
}[] = [
  { id: 'Applied', title: 'Applied', mascot: '/mascots/panda.png', mascotAlt: 'Panda Resume', color: 'border-t-blue-400' },
  { id: 'Screening', title: 'Screening', mascot: '/mascots/bluecat.png', mascotAlt: 'Blue Cat Magnifying', color: 'border-t-purple-400' },
  { id: 'Interview', title: 'Interview', mascot: '/mascots/schoolgirl.png', mascotAlt: 'Schoolgirl Interview', color: 'border-t-pink-400' },
  { id: 'Selected', title: 'Selected', mascot: '/mascots/blonde.png', mascotAlt: 'Blonde Celebrating', color: 'border-t-amber-400' },
  { id: 'Joined', title: 'Joined', mascot: '/mascots/schoolboy.png', mascotAlt: 'Schoolboy Joined', color: 'border-t-emerald-400' },
  { id: 'On Hold', title: 'On Hold', mascot: '/mascots/peek-panda.png', mascotAlt: 'Panda Clock', color: 'border-t-slate-400' },
  { id: 'Rejected', title: 'Archived', mascot: '/mascots/panda.png', mascotAlt: 'Neutral Panda Closed Folder', color: 'border-t-rose-300' },
]

export default function PokieeRecruitment() {
  const [candidates, setCandidates] = useState<Candidate[]>(INITIAL_CANDIDATES)
  const [search, setSearch] = useState('')
  const [activeStage, setActiveStage] = useState<string>('All')

  const moveStage = (candId: string, nextStage: Candidate['stage']) => {
    setCandidates((prev) =>
      prev.map((c) => (c.id === candId ? { ...c, stage: nextStage } : c))
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#12192e] p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950 font-bold text-xs">
              <Target className="size-4" />
            </span>
            <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
              Recruitment Pipeline
            </h1>
          </div>
          <p className="text-xs font-semibold text-slate-400 mt-1">
            Track candidates across 7 structured hiring stages with mascot checkpoints.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search candidate..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs focus:outline-none"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white text-xs font-bold transition shadow-xs">
            <Plus className="size-3.5" />
            <span>New Candidate</span>
          </button>
        </div>
      </div>

      {/* 7 Kanban Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-3.5 overflow-x-auto pb-4">
        {PIPELINE_COLUMNS.map((col) => {
          const colCandidates = candidates.filter(
            (c) =>
              c.stage === col.id &&
              c.name.toLowerCase().includes(search.toLowerCase())
          )

          return (
            <div
              key={col.id}
              className={`pokiee-card p-3 flex flex-col justify-between border-t-4 ${col.color} bg-slate-50/40 dark:bg-[#131b30] min-w-[210px]`}
            >
              <div>
                {/* Column Mascot Header matching prompt assignment */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800/80">
                  <div>
                    <h3 className="text-xs font-black text-slate-800 dark:text-white">
                      {col.title}
                    </h3>
                    <span className="text-[10px] font-bold text-slate-400">
                      {colCandidates.length} Candidates
                    </span>
                  </div>
                  {/* Mascot for this stage */}
                  <div className="size-9 rounded-xl bg-white dark:bg-slate-800 shadow-2xs flex items-center justify-center p-1">
                    <img
                      src={col.mascot}
                      alt={col.mascotAlt}
                      className="size-7 object-contain"
                      title={col.mascotAlt}
                    />
                  </div>
                </div>

                {/* Candidate Cards */}
                <div className="space-y-2.5 pt-3">
                  {colCandidates.map((cand) => (
                    <div
                      key={cand.id}
                      className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 shadow-2xs hover:shadow-xs transition"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <img
                          src={cand.avatar}
                          alt={cand.name}
                          className="size-7 rounded-full object-cover"
                        />
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-slate-800 dark:text-white truncate">
                            {cand.name}
                          </h4>
                          <p className="text-[10px] text-slate-400 truncate">{cand.role}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                        <span>Exp: {cand.experience}</span>
                        <span className="font-bold text-emerald-600">{cand.score}% Fit</span>
                      </div>

                      {/* Quick stage mover */}
                      <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-slate-100 dark:border-slate-800/60">
                        <span className="text-[9.5px] text-slate-400">{cand.appliedDate}</span>
                        <div className="flex items-center gap-1">
                          {col.id !== 'Joined' && col.id !== 'Rejected' && (
                            <button
                              onClick={() => {
                                const order: Candidate['stage'][] = [
                                  'Applied',
                                  'Screening',
                                  'Interview',
                                  'Selected',
                                  'Joined',
                                ]
                                const idx = order.indexOf(cand.stage)
                                if (idx >= 0 && idx < order.length - 1) {
                                  moveStage(cand.id, order[idx + 1])
                                }
                              }}
                              className="p-1 rounded-md bg-blue-50 text-[#1d5cc8] hover:bg-blue-100 transition"
                              title="Advance Candidate"
                            >
                              <ArrowRight className="size-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {colCandidates.length === 0 && (
                    <div className="py-6 text-center text-slate-400 text-[11px] font-semibold">
                      Empty stage
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
