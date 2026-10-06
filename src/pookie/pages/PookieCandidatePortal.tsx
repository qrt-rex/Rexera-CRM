import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Briefcase,
  UploadCloud,
  CheckCircle2,
  ShieldCheck,
  Send,
  ArrowRight,
  Phone,
  Mail,
  Sparkles,
} from 'lucide-react'
import { CuteHeart, CuteSparkle, PookieLogoMark } from '../mascots'

export default function PookieCandidatePortal() {
  const [step, setStep] = useState<'form' | 'otp' | 'success'>('form')
  const [otp, setOtp] = useState(['', '', '', ''])
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'Senior React / Frontend Engineer',
    experience: '3-5 Years',
    portfolio: '',
  })

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault()
    setStep('otp')
  }

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault()
    setStep('success')
  }

  return (
    <div className="min-h-screen bg-[#f7f9fd] dark:bg-[#0c1222] font-Pookie text-slate-800 dark:text-slate-100 antialiased flex flex-col justify-between">
      {/* Top Simple Public Header (NO HR Admin sidebar) */}
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-[#12192e]/80 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <PookieLogoMark size={36} />
            <span className="font-black text-2xl tracking-tight text-[#1e60d5]">Pookie</span>
            <CuteHeart className="text-[#ff4b72]" size={16} />
            <span className="text-xs font-bold text-slate-400 pl-2 border-l border-slate-200 dark:border-slate-800 hidden sm:inline">
              Careers Portal
            </span>
          </div>

          <Link
            to="/hr"
            className="text-xs font-bold text-slate-500 hover:text-[#1e60d5] transition"
          >
            HR Portal Login →
          </Link>
        </div>
      </header>

      {/* Main Body */}
      <main className="max-w-4xl mx-auto px-4 py-8 flex-1 w-full space-y-6">
        {/* Hero Section matching prompt:
            "Schoolgirl and funny schoolboy applying for a job using a laptop.
             Panda holding a resume." */}
        <div className="Pookie-card p-6 sm:p-8 bg-gradient-to-r from-blue-50/70 via-white to-pink-50/50 dark:from-blue-950/20 dark:to-pink-950/20 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
          <div className="space-y-2 text-center md:text-left">
            <span className="px-3 py-1 rounded-full bg-blue-100 text-[#1d5cc8] dark:bg-blue-950 text-xs font-black uppercase">
              Join Team Pookie ✨
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-white tracking-tight">
              Build the Future of People & Happiness
            </h1>
            <p className="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 max-w-md">
              We are hiring creators, engineers and problem solvers. Apply in less than 2 minutes with verified mobile authentication.
            </p>
          </div>

          {/* Hero Mascots */}
          <div className="flex items-center gap-2 shrink-0">
            <img src="/mascots/schoolgirl.png" alt="Schoolgirl Applying" className="size-16 object-contain anim-float-subtle" />
            <img src="/mascots/schoolboy.png" alt="Schoolboy Applying" className="size-16 object-contain anim-float-subtle" />
            <img src="/mascots/panda.png" alt="Panda Resume" className="size-16 object-contain anim-float-subtle" />
          </div>
        </div>

        {/* Form View */}
        {step === 'form' && (
          <form onSubmit={handleSubmitForm} className="space-y-6">
            <div className="Pookie-card p-6 sm:p-8 space-y-5">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <span className="p-1.5 rounded-lg bg-blue-50 text-[#1d5cc8]">
                  <Briefcase className="size-4" />
                </span>
                <h3 className="font-black text-sm text-slate-800 dark:text-white">
                  1. Select Target Position
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Open Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 focus:outline-none"
                  >
                    <option>Senior React / Frontend Engineer</option>
                    <option>Product Designer (UI/UX)</option>
                    <option>Talent Acquisition Lead</option>
                    <option>Sales & BD Specialist</option>
                    <option>Financial Analyst</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Years of Experience</label>
                  <select
                    value={formData.experience}
                    onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 focus:outline-none"
                  >
                    <option>1-3 Years</option>
                    <option>3-5 Years</option>
                    <option>5+ Years</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                <span className="p-1.5 rounded-lg bg-pink-50 text-[#ff4b72]">
                  <Mail className="size-4" />
                </span>
                <h3 className="font-black text-sm text-slate-800 dark:text-white">
                  2. Candidate Personal Information
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Full Legal Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Pooja Iyer"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="pooja.iyer@gmail.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Mobile (for OTP)</label>
                  <input
                    type="tel"
                    required
                    placeholder="+91 98765 43210"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2">
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Resume / CV Upload</label>
                <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-6 text-center hover:bg-slate-50 transition cursor-pointer">
                  <UploadCloud className="size-8 text-[#1d5cc8] mx-auto mb-1.5" />
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Upload your Resume (PDF or DOCX, max 10MB)
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Click or drag and drop file</p>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-2xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white font-black text-sm transition shadow-md flex items-center justify-center gap-2"
              >
                <span>Continue to Mobile OTP Verification</span>
                <ArrowRight className="size-4" />
              </button>
            </div>
          </form>
        )}

        {/* OTP Screen: Blue robotic cat holding phone displaying OTP */}
        {step === 'otp' && (
          <div className="Pookie-card p-8 max-w-md mx-auto text-center space-y-6 anim-pop">
            <div className="size-20 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center mx-auto">
              <img src="/mascots/bluecat.png" alt="Bluecat Phone OTP" className="size-16 object-contain anim-float-subtle" />
            </div>

            <div>
              <h3 className="font-black text-lg text-slate-800 dark:text-white">
                Enter Mobile OTP Code
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                We sent a 4-digit verification code to <span className="font-bold text-slate-800 dark:text-slate-200">{formData.phone || '+91 98765 43210'}</span>
              </p>
            </div>

            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="flex items-center justify-center gap-3">
                {[0, 1, 2, 3].map((idx) => (
                  <input
                    key={idx}
                    type="text"
                    maxLength={1}
                    defaultValue="7"
                    className="size-12 rounded-2xl border-2 border-blue-200 dark:border-blue-900 bg-slate-50 dark:bg-slate-900 text-center text-lg font-black text-slate-800 dark:text-white focus:outline-none focus:border-[#1d5cc8]"
                  />
                ))}
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-2xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white font-black text-sm transition shadow-md"
              >
                Verify & Submit Application
              </button>
            </form>
          </div>
        )}

        {/* Success Screen matching prompt:
            "Blonde character holding a large checkmark.
             Panda celebrating beside a small 'Application Submitted' card." */}
        {step === 'success' && (
          <div className="Pookie-card p-8 max-w-lg mx-auto text-center space-y-6 anim-fade-up bg-gradient-to-b from-white to-emerald-50/40 dark:from-[#12192e] dark:to-emerald-950/20">
            <div className="flex items-center justify-center gap-4 py-2">
              <img src="/mascots/blonde.png" alt="Blonde Celebrating Checkmark" className="size-20 object-contain anim-float-subtle" />
              <img src="/mascots/panda.png" alt="Panda Celebrating" className="size-20 object-contain anim-float-subtle" />
            </div>

            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-black uppercase">
                <CheckCircle2 className="size-4" />
                <span>Application Submitted!</span>
              </div>
              <h2 className="text-2xl font-black text-slate-800 dark:text-white">
                Thank You, {formData.name || 'Candidate'}!
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 max-w-sm mx-auto leading-relaxed">
                Your application for <span className="font-bold">{formData.role}</span> has been securely recorded. Our recruiting team will review your profile and reach out within 48 business hours.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-left space-y-1">
              <div className="flex justify-between text-slate-500">
                <span>Application ID:</span>
                <span className="font-mono font-bold text-slate-800 dark:text-white">POK-APP-202688</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Confirmation Sent To:</span>
                <span className="font-bold text-slate-800 dark:text-white">{formData.email || 'your email'}</span>
              </div>
            </div>

            <Link
              to="/hr"
              className="inline-block px-6 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
            >
              Return to Pookie Home
            </Link>
          </div>
        )}
      </main>

      {/* Public Footer */}
      <footer className="text-center py-6 text-xs text-slate-400 border-t border-slate-200/60 dark:border-slate-800">
        © 2026 Pookie HR Technologies • Equal Opportunity Employer
      </footer>
    </div>
  )
}
