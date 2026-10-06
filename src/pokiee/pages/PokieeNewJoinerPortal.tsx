import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Sparkles,
  CheckCircle2,
  Lock,
  FileCheck,
  Building,
  CreditCard,
  UserCheck,
  ArrowRight,
} from 'lucide-react'
import { CuteHeart, CuteSparkle, CuteStar, PookieeLogoMark } from '../mascots'

export default function PookieeNewJoinerPortal() {
  const [step, setStep] = useState<'auth' | 'checklist' | 'bank' | 'complete'>('auth')
  const [token, setToken] = useState('Pookiee-JOIN-9942')
  const [otp, setOtp] = useState('')

  const [checklist, setChecklist] = useState({
    identityProof: true,
    addressProof: true,
    educationCerts: true,
    previousExpLetter: false,
    emergencyContacts: true,
  })

  return (
    <div className="min-h-screen bg-[#f7f9fd] dark:bg-[#0c1222] font-Pookiee text-slate-800 dark:text-slate-100 antialiased flex flex-col justify-between">
      {/* Simple Public Header (No admin sidebar) */}
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-[#12192e]/80 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <PookieeLogoMark size={36} />
            <span className="font-black text-2xl tracking-tight text-[#1e60d5]">Pookiee</span>
            <CuteHeart className="text-[#ff4b72]" size={16} />
            <span className="text-xs font-bold text-slate-400 pl-2 border-l border-slate-200 dark:border-slate-800 hidden sm:inline">
              Welcome Onboarding Experience
            </span>
          </div>

          <Link
            to="/hr"
            className="text-xs font-bold text-slate-500 hover:text-[#1e60d5] transition"
          >
            HR Admin Sign In →
          </Link>
        </div>
      </header>

      {/* Main Body */}
      <main className="max-w-4xl mx-auto px-4 py-8 flex-1 w-full space-y-6">
        {/* Hero Section matching prompt:
            "Blonde character welcoming the new employee.
             Blue robotic cat holding a welcome sign.
             Panda holding an employee ID card." */}
        <div className="Pookiee-card p-6 sm:p-8 bg-gradient-to-r from-pink-50/60 via-white to-blue-50/60 dark:from-pink-950/20 dark:to-blue-950/20 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
          <div className="space-y-2 text-center md:text-left">
            <span className="px-3 py-1 rounded-full bg-pink-100 text-[#ff4b72] dark:bg-pink-950 text-xs font-black uppercase">
              Welcome to your new team! 🌟
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-white tracking-tight">
              Welcome to Pookiee Family!
            </h1>
            <p className="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 max-w-md">
              We are thrilled to welcome you aboard. Complete your welcome setup, upload statutory documents, and activate your salary account.
            </p>
          </div>

          {/* Hero 3 Mascots: Blonde, Bluecat, Panda */}
          <div className="flex items-center gap-3 shrink-0">
            <img src="/mascots/blonde.png" alt="Blonde Welcoming" className="size-16 object-contain anim-float-subtle" />
            <img src="/mascots/bluecat.png" alt="Bluecat Welcome Sign" className="size-16 object-contain anim-float-subtle" />
            <img src="/mascots/panda.png" alt="Panda Employee ID" className="size-16 object-contain anim-float-subtle" />
          </div>
        </div>

        {/* Step 1: Token + OTP Verification Screen (Blue robotic cat beside phone verification screen) */}
        {step === 'auth' && (
          <div className="Pookiee-card p-8 max-w-md mx-auto text-center space-y-6 anim-pop">
            <div className="size-20 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center mx-auto">
              <img src="/mascots/bluecat.png" alt="Bluecat Token Verification" className="size-16 object-contain anim-float-subtle" />
            </div>

            <div>
              <h3 className="font-black text-lg text-slate-800 dark:text-white">
                Verify Joining Token & Mobile
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Enter your joining invitation token received in your official offer email.
              </p>
            </div>

            <div className="space-y-3 text-left text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Joining Token</label>
                <input
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full h-10 px-3 font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Mobile OTP Code</label>
                <input
                  type="text"
                  placeholder="Enter 4-digit OTP (e.g. 5521)"
                  defaultValue="5521"
                  className="w-full h-10 px-3 font-mono text-center text-lg font-black tracking-widest rounded-xl border border-blue-200 dark:border-blue-900 bg-slate-50 dark:bg-slate-900 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => setStep('checklist')}
                className="w-full py-3 mt-2 rounded-2xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white font-black text-sm transition shadow-md"
              >
                Access My Onboarding Checklist →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Onboarding Checklist (Schoolgirl checking documents, Funny schoolboy completing profile) */}
        {step === 'checklist' && (
          <div className="Pookiee-card p-6 sm:p-8 space-y-6 anim-fade-up">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-black text-lg text-slate-800 dark:text-white">
                  Joining Document Checklist
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Verify mandatory statutory records to complete your official HR registration.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <img src="/mascots/schoolgirl.png" alt="Schoolgirl Checking" className="size-12 object-contain" />
                <img src="/mascots/schoolboy.png" alt="Schoolboy Profile" className="size-12 object-contain" />
              </div>
            </div>

            <div className="space-y-3">
              {[
                { key: 'identityProof', label: 'Government Photo Identity (Aadhaar / Passport)', desc: 'Verified and linked with UIDAI' },
                { key: 'addressProof', label: 'Permanent Address Proof', desc: 'Electricity bill / Rental agreement uploaded' },
                { key: 'educationCerts', label: 'Highest Degree Certificate & Transcripts', desc: 'B.Tech / Masters Degree verified' },
                { key: 'previousExpLetter', label: 'Previous Relieving Letter & Experience Certificate', desc: 'Pending upload from previous employer' },
                { key: 'emergencyContacts', label: 'Emergency Contacts & Next of Kin Form', desc: '2 family emergency contacts recorded' },
              ].map((item) => (
                <div
                  key={item.key}
                  className="p-3.5 rounded-2xl bg-slate-50/70 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-800 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checklist[item.key as keyof typeof checklist]}
                      onChange={(e) =>
                        setChecklist({ ...checklist, [item.key]: e.target.checked })
                      }
                      className="size-4 rounded text-[#1d5cc8]"
                    />
                    <div>
                      <p className="font-bold text-xs text-slate-800 dark:text-white">{item.label}</p>
                      <p className="text-[10.5px] text-slate-400">{item.desc}</p>
                    </div>
                  </div>

                  <span
                    className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${
                      checklist[item.key as keyof typeof checklist]
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {checklist[item.key as keyof typeof checklist] ? 'Complete' : 'Upload Required'}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setStep('bank')}
                className="px-6 py-2.5 rounded-xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white font-bold text-xs transition shadow-sm flex items-center gap-2"
              >
                <span>Continue to Bank Details</span>
                <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Bank Details (Panda beside secure lock) */}
        {step === 'bank' && (
          <div className="Pookiee-card p-6 sm:p-8 max-w-xl mx-auto space-y-6 anim-pop">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-black text-lg text-slate-800 dark:text-white">
                  Salary Bank Account & PAN
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Direct deposit credentials for monthly salary disbursals.
                </p>
              </div>

              {/* Panda beside secure lock */}
              <div className="flex items-center gap-2">
                <Lock className="size-4 text-emerald-600" />
                <img src="/mascots/panda.png" alt="Panda Bank Lock" className="size-12 object-contain anim-float-subtle" />
              </div>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Bank Name</label>
                <select className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:outline-none">
                  <option>HDFC Bank Ltd</option>
                  <option>ICICI Bank</option>
                  <option>State Bank of India</option>
                  <option>Axis Bank</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Account Number</label>
                <input
                  type="text"
                  placeholder="50100293847"
                  defaultValue="50100293847"
                  className="w-full h-10 px-3 font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">IFSC Code</label>
                  <input
                    type="text"
                    defaultValue="HDFC0001234"
                    className="w-full h-10 px-3 font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Income Tax PAN</label>
                  <input
                    type="text"
                    defaultValue="ABCDE1234F"
                    className="w-full h-10 px-3 font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStep('complete')}
                className="w-full py-3 mt-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm transition shadow-md"
              >
                Complete Onboarding & Submit
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Completed Onboarding (Entire mascot group celebrating with stars & confetti) */}
        {step === 'complete' && (
          <div className="Pookiee-card p-8 sm:p-10 max-w-2xl mx-auto text-center space-y-6 anim-fade-up bg-gradient-to-b from-white via-pink-50/20 to-blue-50/40 dark:from-[#12192e] dark:to-blue-950/20 relative overflow-hidden">
            {/* Mascot group celebrating */}
            <div className="flex items-center justify-center py-2 relative">
              <img
                src="/mascots/hero-team-strip.png"
                alt="Entire Mascot Group Celebrating"
                className="h-28 sm:h-36 w-auto object-contain anim-float-subtle"
              />
              <CuteSparkle className="absolute top-1 left-12 text-amber-400" size={24} />
              <CuteStar className="absolute top-2 right-12 text-pink-400" size={20} />
            </div>

            <div className="space-y-2">
              <span className="px-3.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-black uppercase inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-4" />
                <span>Onboarding Completed Successfully!</span>
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-white">
                You're Officially Part of Pookiee! 🎉
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-md mx-auto leading-relaxed">
                Your employee ID and credentials have been issued. Your reporting manager and buddy have been notified. Welcome to an incredible journey ahead!
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-left max-w-md mx-auto space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Employee ID:</span>
                <span className="font-mono font-bold text-slate-800 dark:text-white">EMP-1007</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">First Day Induction:</span>
                <span className="font-bold text-emerald-600">Monday, 09:30 AM IST</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Office Location:</span>
                <span className="font-bold text-slate-800 dark:text-white">Tower B, Pookiee Campus, Mumbai</span>
              </div>
            </div>

            <div className="pt-2">
              <Link
                to="/hr"
                className="inline-block px-6 py-2.5 rounded-xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white text-xs font-bold transition shadow-sm"
              >
                Go to Main HR Dashboard
              </Link>
            </div>
          </div>
        )}
      </main>

      {/* Public Footer */}
      <footer className="text-center py-6 text-xs text-slate-400 border-t border-slate-200/60 dark:border-slate-800">
        © 2026 Pookiee HR Technologies • Welcome Experience
      </footer>
    </div>
  )
}
