import { useState } from 'react'
import {
  Sparkles,
  Trophy,
  TrendingUp,
  Award,
  IndianRupee,
  Sliders,
  CheckCircle2,
  Calendar,
} from 'lucide-react'
import { CuteSparkle, CuteStar } from '../mascots'

export default function PokieeIncentives() {
  const [activeTab, setActiveTab] = useState<'Daily' | 'Weekly' | 'Monthly'>('Monthly')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pokiee-card p-6 sm:p-8 bg-gradient-to-r from-amber-50/70 via-white to-pink-50/50 dark:from-amber-950/20 dark:to-pink-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950 font-bold text-xs">
              <Trophy className="size-4" />
            </span>
            <span className="text-xs font-bold text-slate-400">Commission & Performance Rewards</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <span>Sales Incentives & Slabs</span>
            <CuteStar className="text-amber-400" size={16} />
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-1">
            Dynamic milestone slabs, revenue tiers, peer recognition and payroll credit synchronization.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-center shadow-2xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase">October Payout Pool</span>
            <p className="text-sm font-black text-emerald-600">₹3,45,000</p>
          </div>
        </div>
      </div>

      {/* Row 1: Slabs (Schoolboy climbing 3 steps) + Settings (Blonde) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily / Weekly / Monthly slabs with Funny schoolboy */}
        <div className="lg:col-span-2 pokiee-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <Award className="size-4 text-amber-500" />
                <span>Tiered Incentive Milestone Slabs</span>
              </h3>

              {/* 3 Step Tabs: Daily, Weekly, Monthly */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                {(['Daily', 'Weekly', 'Monthly'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                      activeTab === tab
                        ? 'bg-white dark:bg-slate-900 text-[#1d5cc8] shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-4">
              <div className="p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-950/40 border border-blue-100">
                <span className="text-[10px] font-black uppercase text-[#1d5cc8]">Step 1: Silver Slab</span>
                <p className="text-lg font-black text-slate-800 dark:text-white mt-1">₹5L - ₹10L Rev</p>
                <p className="text-xs font-bold text-emerald-600 mt-1">3.0% Commission</p>
                <p className="text-[10.5px] text-slate-400 mt-0.5">Base tier incentive</p>
              </div>

              <div className="p-4 rounded-2xl bg-purple-50/60 dark:bg-purple-950/40 border border-purple-100">
                <span className="text-[10px] font-black uppercase text-purple-600">Step 2: Gold Slab</span>
                <p className="text-lg font-black text-slate-800 dark:text-white mt-1">₹10L - ₹25L Rev</p>
                <p className="text-xs font-bold text-emerald-600 mt-1">5.5% Commission</p>
                <p className="text-[10.5px] text-slate-400 mt-0.5">+ ₹5,000 cash bonus</p>
              </div>

              <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/40 border border-amber-100">
                <span className="text-[10px] font-black uppercase text-amber-600">Step 3: Diamond Slab</span>
                <p className="text-lg font-black text-slate-800 dark:text-white mt-1">₹25L+ Milestone</p>
                <p className="text-xs font-bold text-emerald-600 mt-1">8.0% Commission</p>
                <p className="text-[10.5px] text-slate-400 mt-0.5">Top-performer accelerator</p>
              </div>
            </div>
          </div>

          {/* Funny schoolboy climbing steps mascot */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Climbing Daily, Weekly & Monthly slabs</span>
              <img
                src="/mascots/schoolboy.png"
                alt="Schoolboy Climbing Steps"
                className="size-14 object-contain anim-float-subtle"
              />
            </div>
          </div>
        </div>

        {/* Incentive Settings with Blonde Character */}
        <div className="pokiee-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <Sliders className="size-4 text-purple-600" />
                <span>Incentive Configuration</span>
              </h3>
            </div>

            <div className="space-y-3 pt-3 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">Credit Cycle</span>
                <span className="font-bold text-[#1d5cc8]">With October Payroll</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">Target Benchmark</span>
                <span className="font-bold text-slate-800 dark:text-white">Quarterly SMR</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">Accelerators Enabled</span>
                <span className="font-bold text-emerald-600">Yes (Diamond Tier)</span>
              </div>
            </div>
          </div>

          {/* Blonde mascot */}
          <div className="pt-3 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Policy settings locked</span>
              <img src="/mascots/blonde.png" alt="Blonde Settings" className="size-12 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Sales Performance Leaderboard (Schoolgirl celebrating) + Payout (Panda with reward card) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales Performance Leaderboard */}
        <div className="lg:col-span-2 pokiee-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <TrendingUp className="size-4 text-emerald-600" />
                <span>Sales Performance Leaderboard</span>
              </h3>
              <span className="text-xs font-bold text-[#1d5cc8]">Top Revenue Earners</span>
            </div>

            <div className="space-y-3 pt-4">
              {[
                { rank: '1', name: 'Riya Mehta', deals: 18, rev: '₹28,50,000', bonus: '₹1,42,500', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&auto=format&fit=crop&q=80' },
                { rank: '2', name: 'Aman Shah', deals: 14, rev: '₹19,20,000', bonus: '₹96,000', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80' },
                { rank: '3', name: 'Tanmay Joshi', deals: 11, rev: '₹14,80,000', bonus: '₹74,000', avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=120&auto=format&fit=crop&q=80' },
              ].map((p) => (
                <div
                  key={p.name}
                  className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="size-6 rounded-full bg-amber-100 text-amber-700 font-black text-xs flex items-center justify-center">
                      #{p.rank}
                    </span>
                    <img src={p.avatar} alt={p.name} className="size-8 rounded-full object-cover" />
                    <div>
                      <p className="font-bold text-slate-800 dark:text-white">{p.name}</p>
                      <p className="text-[10px] text-slate-400">{p.deals} Closed Deals</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-slate-800 dark:text-white">{p.rev}</p>
                    <p className="text-[10px] font-black text-emerald-600">Earned: {p.bonus}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Schoolgirl celebrating beside upward graph */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Celebrating Q3 milestones!</span>
              <img
                src="/mascots/schoolgirl.png"
                alt="Schoolgirl Upward Graph"
                className="size-14 object-contain anim-float-subtle"
              />
            </div>
          </div>
        </div>

        {/* Payout Card (Panda holding small reward card) */}
        <div className="pokiee-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                Pending Payout Approvals
              </h3>
            </div>

            <div className="space-y-3 pt-4">
              <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100">
                <span className="text-[10px] font-bold text-emerald-700 uppercase">Ready for Transfer</span>
                <p className="text-xl font-black text-emerald-700 dark:text-emerald-300 mt-1">₹3,12,500</p>
                <p className="text-[10px] text-slate-400 mt-0.5">3 Team Leads approved</p>
              </div>

              <button className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition shadow-xs">
                Approve & Sync with Payroll
              </button>
            </div>
          </div>

          {/* Panda with reward card mascot */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Verified incentive vouchers</span>
              <img
                src="/mascots/panda.png"
                alt="Panda Reward Card"
                className="size-14 object-contain anim-float-subtle"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
