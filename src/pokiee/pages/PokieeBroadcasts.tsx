import { useState } from 'react'
import {
  Megaphone,
  Plus,
  Send,
  Eye,
  Mail,
  AlertCircle,
  CheckCircle2,
  Calendar,
} from 'lucide-react'
import { INITIAL_ANNOUNCEMENTS, Announcement } from '../data'

export default function PokieeBroadcasts() {
  const [announcements, setAnnouncements] = useState<Announcement[]>(INITIAL_ANNOUNCEMENTS)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newPriority, setNewPriority] = useState<'High' | 'Medium' | 'Low'>('High')
  const [sendEmail, setSendEmail] = useState(true)

  const handlePost = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle) return
    const newAnn: Announcement = {
      id: `ANN-${Date.now().toString().slice(-2)}`,
      title: newTitle,
      date: 'Today',
      priority: newPriority,
      content: newContent,
      readCount: 1,
      totalCount: 125,
    }
    setAnnouncements([newAnn, ...announcements])
    setNewTitle('')
    setNewContent('')
  }

  return (
    <div className="space-y-6">
      {/* Header: Blue robotic cat holding a megaphone */}
      <div className="pokiee-card p-6 sm:p-8 bg-gradient-to-r from-blue-50/70 via-white to-pink-50/50 dark:from-blue-950/20 dark:to-pink-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="size-16 rounded-2xl bg-blue-50 dark:bg-blue-950 flex items-center justify-center shrink-0">
            <img
              src="/mascots/bluecat.png"
              alt="Bluecat Megaphone"
              className="size-14 object-contain anim-float-subtle"
            />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
              Broadcasts & Announcements
            </h1>
            <p className="text-xs font-semibold text-slate-500 mt-1">
              Publish critical company-wide updates, policy notices, and track mandatory employee read acknowledgements.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Broadcast Form (with Blonde holding envelope option) */}
        <div className="pokiee-card p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <Megaphone className="size-4 text-[#1d5cc8]" />
                <span>Compose New Announcement</span>
              </h3>
            </div>

            <form onSubmit={handlePost} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Headline</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Office Holiday - Diwali Celebration"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 focus:outline-none focus:border-[#1d5cc8]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Urgency Priority</label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value as never)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 focus:outline-none"
                >
                  <option value="High">🔴 High Priority (Pinned Notification)</option>
                  <option value="Medium">🟡 Medium Priority (General)</option>
                  <option value="Low">🟢 Low Priority (Fun & Events)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Message Content</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Type the detailed message here..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 focus:outline-none focus:border-[#1d5cc8]"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="emailBox"
                  checked={sendEmail}
                  onChange={(e) => setSendEmail(e.target.checked)}
                  className="rounded text-[#1d5cc8]"
                />
                <label htmlFor="emailBox" className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  Also dispatch instant email to all 125 employees
                </label>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white font-bold text-xs transition shadow-xs flex items-center justify-center gap-1.5"
              >
                <Send className="size-3.5" />
                <span>Publish Broadcast</span>
              </button>
            </form>
          </div>

          {/* Blonde with envelope in corner */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Email delivery ready</span>
              <img src="/mascots/blonde.png" alt="Blonde Envelope" className="size-12 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>

        {/* Announcements List with High Priority (Schoolgirl), Normal (Panda), Read Receipts (Schoolboy) */}
        <div className="lg:col-span-2 space-y-4">
          {announcements.map((item) => (
            <div
              key={item.id}
              className={`pokiee-card p-5 relative overflow-hidden transition ${
                item.priority === 'High'
                  ? 'border-l-4 border-l-rose-500 bg-rose-50/20 dark:bg-rose-950/10'
                  : 'border-l-4 border-l-blue-400'
              }`}
            >
              <div className="flex items-center justify-between pb-2 mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-black px-2.5 py-0.5 rounded-full ${
                      item.priority === 'High'
                        ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/60'
                        : item.priority === 'Medium'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60'
                    }`}
                  >
                    {item.priority} Priority
                  </span>
                  <span className="text-xs text-slate-400">{item.date}</span>
                </div>

                {/* Read receipts: Schoolboy checking list of viewers */}
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                  <Eye className="size-3.5 text-slate-400" />
                  <span>
                    {item.readCount} / {item.totalCount} Acknowledged
                  </span>
                </div>
              </div>

              <h3 className="font-black text-sm text-slate-800 dark:text-white mb-1.5">
                {item.title}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {item.content}
              </p>

              {/* Character assignment per priority:
                  High priority: Schoolgirl holding announcement card
                  Normal announcement: Panda reading notice */}
              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400">
                  Published by Parv Shah (HR Admin)
                </span>
                <div className="flex items-center gap-2">
                  {item.priority === 'High' ? (
                    <div className="flex items-center gap-1 text-[10px] font-bold text-rose-500">
                      <span>Urgent Bulletin</span>
                      <img src="/mascots/schoolgirl.png" alt="Schoolgirl Announcement" className="size-6 object-contain" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                      <span>Standard Notice</span>
                      <img src="/mascots/panda.png" alt="Panda Notice" className="size-6 object-contain" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
