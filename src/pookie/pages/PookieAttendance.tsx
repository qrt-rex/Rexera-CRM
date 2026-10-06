import { useState, useEffect } from 'react'
import {
  Clock,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Download,
  Check,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
} from 'lucide-react'

export default function PookieAttendance() {
  const [currentTime, setCurrentTime] = useState(new Date())
  const [isPunchedIn, setIsPunchedIn] = useState(true)
  const [punchTime, setPunchTime] = useState('09:12 AM')
  const [punchMessage, setPunchMessage] = useState<string | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const handlePunch = () => {
    if (isPunchedIn) {
      setIsPunchedIn(false)
      setPunchMessage('Punched out successfully at ' + currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } else {
      setIsPunchedIn(true)
      const nowStr = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      setPunchTime(nowStr)
      setPunchMessage('Punched in successfully at ' + nowStr + '! Have a wonderful day! ✨')
    }
  }

  return (
    <div className="space-y-6">
      {/* Hero Banner: Blue robotic cat wearing small employee badge and clock */}
      <div className="Pookie-card p-6 sm:p-8 bg-gradient-to-r from-blue-50/70 via-white to-emerald-50/60 dark:from-blue-950/20 dark:to-emerald-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-xl bg-blue-100 dark:bg-blue-950 text-[#1d5cc8] font-bold text-xs">
              <Clock className="size-4" />
            </span>
            <span className="text-xs font-bold text-slate-400">Live Attendance Log</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
            Attendance Board & Biometrics
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-1">
            Real-time biometric tracking, shifts, grace periods and monthly compliance.
          </p>
        </div>

        {/* Mascot: Blue robotic cat wearing employee badge & clock */}
        <div className="flex items-center gap-3">
          <div className="size-16 rounded-2xl bg-white dark:bg-slate-900 shadow-xs flex items-center justify-center">
            <img
              src="/mascots/bluecat.png"
              alt="Blue Cat Clock"
              className="size-14 object-contain anim-float-subtle"
            />
          </div>
        </div>
      </div>

      {/* Row 1: Punch In/Out card + Monthly Attendance Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Punch In / Punch Out Card */}
        <div className="Pookie-card p-6 flex flex-col justify-between relative overflow-hidden bg-gradient-to-b from-white to-blue-50/30 dark:from-[#131b30] dark:to-blue-950/20">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                Live Punch In / Out
              </h3>
              <span className="text-[10px] font-black uppercase text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                Shift: General (9:30 AM - 6:30 PM)
              </span>
            </div>

            {/* Digital Clock */}
            <div className="text-center py-6">
              <div className="text-3xl sm:text-4xl font-black text-slate-800 dark:text-white font-mono tracking-wider">
                {currentTime.toLocaleTimeString()}
              </div>
              <p className="text-xs text-slate-400 mt-1 font-semibold">
                {currentTime.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>

            {/* Punch Action */}
            <div className="text-center space-y-3">
              <button
                onClick={handlePunch}
                className={`w-full py-3.5 rounded-2xl font-black text-sm text-white shadow-md transition-all duration-200 ${
                  isPunchedIn
                    ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-200 dark:shadow-none'
                    : 'bg-[#1d5cc8] hover:bg-[#184ea8] shadow-blue-200 dark:shadow-none'
                }`}
              >
                {isPunchedIn ? 'Punch Out' : 'Punch In'}
              </button>

              <p className="text-xs text-slate-500 font-semibold">
                {isPunchedIn ? `Logged In since ${punchTime}` : 'Not punched in yet'}
              </p>
            </div>
          </div>

          {/* Feedback & Schoolgirl giving thumbs-up */}
          {punchMessage && (
            <div className="mt-4 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-2 anim-fade-up">
              <img
                src="/mascots/schoolgirl.png"
                alt="Schoolgirl Thumbs Up"
                className="size-8 object-contain shrink-0"
              />
              <span>{punchMessage}</span>
            </div>
          )}
        </div>

        {/* Attendance Calendar (with tiny panda in corner) */}
        <div className="lg:col-span-2 Pookie-card p-6 relative overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                October 2026 Calendar
              </h3>
              <span className="text-[11px] text-slate-400 font-bold">22 Working Days</span>
            </div>
            <div className="flex items-center gap-3 text-xs font-semibold">
              <span className="flex items-center gap-1 text-emerald-600">
                <span className="size-2 rounded-full bg-emerald-500" />
                Present
              </span>
              <span className="flex items-center gap-1 text-amber-500">
                <span className="size-2 rounded-full bg-amber-400" />
                Late
              </span>
              <span className="flex items-center gap-1 text-pink-500">
                <span className="size-2 rounded-full bg-pink-400" />
                Leave
              </span>
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-2 pt-4 text-center">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div key={day} className="text-[11px] font-extrabold text-slate-400 pb-1">
                {day}
              </div>
            ))}

            {Array.from({ length: 31 }, (_, i) => {
              const d = i + 1
              const isWeekend = (d % 7 === 6 || d % 7 === 0)
              const isToday = d === 5
              const isLate = d === 2 || d === 12
              const isLeave = d === 15

              return (
                <div
                  key={d}
                  className={`p-2 rounded-xl text-xs font-bold transition flex flex-col items-center justify-center relative ${
                    isToday
                      ? 'bg-blue-100 dark:bg-blue-900 text-[#1d5cc8] dark:text-blue-200 ring-2 ring-[#1d5cc8]'
                      : isWeekend
                      ? 'bg-slate-50 dark:bg-slate-800/40 text-slate-300 dark:text-slate-600'
                      : isLate
                      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700'
                      : isLeave
                      ? 'bg-pink-50 dark:bg-pink-950/40 text-pink-700'
                      : 'bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-700'
                  }`}
                >
                  <span>{d}</span>
                  {!isWeekend && (
                    <span
                      className={`size-1 rounded-full mt-1 ${
                        isLate ? 'bg-amber-400' : isLeave ? 'bg-pink-400' : 'bg-emerald-500'
                      }`}
                    />
                  )}
                </div>
              )
            })}
          </div>

          {/* Tiny Panda in corner of calendar */}
          <div className="absolute bottom-2 right-2 w-10 h-10 pointer-events-none opacity-85">
            <img
              src="/mascots/peek-panda.png"
              alt="Panda Calendar"
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      </div>

      {/* Row 2: Late / Half-Day Section (Funny schoolboy running toward office with clock) + Monthly Report */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Late / Half-Day tracking */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <span>Late Arrivals & Grace Log</span>
              </h3>
              <span className="text-[11px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                Grace: 15 Mins
              </span>
            </div>

            <div className="space-y-2.5 pt-3">
              {[
                { name: 'Kunal Deshmukh', time: '10:04 AM', delay: '19m late', reason: 'Metro delay' },
                { name: 'Tanmay Joshi', time: '09:58 AM', delay: '13m late', reason: 'Traffic jam' },
                { name: 'Pooja Iyer', time: '10:15 AM', delay: '30m late', reason: 'Personal errand' },
              ].map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-xs"
                >
                  <div>
                    <p className="font-bold text-slate-800 dark:text-white">{item.name}</p>
                    <p className="text-[10px] text-slate-400">{item.reason}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-amber-600">{item.time}</p>
                    <p className="text-[10px] text-slate-400">{item.delay}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Funny schoolboy running toward office mascot */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Running for morning punch-in!</span>
              <img
                src="/mascots/schoolboy.png"
                alt="Running Schoolboy"
                className="size-14 object-contain anim-float-subtle"
              />
            </div>
          </div>
        </div>

        {/* Monthly Report with Blonde character holding calendar */}
        <div className="Pookie-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                Monthly Attendance Report
              </h3>
              <button className="flex items-center gap-1 text-xs font-bold text-[#1d5cc8] hover:underline">
                <Download className="size-3.5" />
                <span>Export CSV</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3">
              <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 text-center">
                <p className="text-[10.5px] font-bold text-slate-500">Average On-Time</p>
                <p className="text-xl font-black text-emerald-600 mt-0.5">92.4%</p>
              </div>
              <div className="p-3 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 text-center">
                <p className="text-[10.5px] font-bold text-slate-500">Present Today</p>
                <p className="text-xl font-black text-[#1d5cc8] mt-0.5">102 / 125</p>
              </div>
              <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-100 text-center">
                <p className="text-[10.5px] font-bold text-slate-500">Late Arrivals</p>
                <p className="text-xl font-black text-amber-600 mt-0.5">6 Employees</p>
              </div>
              <div className="p-3 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-100 text-center">
                <p className="text-[10.5px] font-bold text-slate-500">Overtime Logged</p>
                <p className="text-xl font-black text-purple-600 mt-0.5">48.5 Hours</p>
              </div>
            </div>
          </div>

          {/* Blonde character mascot */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Monthly audit validated</span>
              <img
                src="/mascots/blonde.png"
                alt="Blonde Calendar"
                className="size-14 object-contain anim-float-subtle"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
