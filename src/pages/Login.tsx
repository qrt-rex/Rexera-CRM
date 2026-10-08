import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, ShieldCheck, User as UserIcon } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useDb } from '../lib/store'
import { loginStep1, resendCode, verifyCode } from '../lib/actions'
import { DEMO_PASSWORD, PRESET_USERS } from '../lib/seed'
import { ROLES } from '../lib/rbac'
import { isEmail } from '../lib/format'
import { Logo } from '../components/Logo'
import { ResetPasswordModal } from '../components/ResetPasswordModal'
import { Button, Modal, Input, cx } from '../components/ui'
import { sendOtpEmailClient } from '../lib/emailClient'

const DEV_MODE = import.meta.env.DEV || import.meta.env.VITE_DEMO === '1'

export default function Login() {
  const { user, signIn } = useAuth()
  const db = useDb()
  const nav = useNavigate()
  const loc = useLocation()
  const [step, setStep] = useState<'password' | 'code'>('password')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [token, setToken] = useState('')
  const [devCode, setDevCode] = useState('')
  const [email, setEmail] = useState('')
  const [otpNotice, setOtpNotice] = useState('')
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [forgot, setForgot] = useState(false)
  const [reason] = useState(() => sessionStorage.getItem('rexera-signout-reason'))
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => { if (step === 'code') setTimeout(() => boxes.current[0]?.focus(), 50) }, [step])
  // signing in always lands on the person's dashboard
  if (user) return <Navigate to={`/dashboard/${user.role}`} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setOtpNotice('')
    if (!login.trim() || !password) { setErr('Enter your username and password.'); return }
    setBusy(true)
    try {
      const r = await loginStep1(login, password)
      setToken(r.token); setDevCode(r.devCode); setEmail(r.email); setStep('code'); setCode(['', '', '', '', '', ''])
      sendOtpEmailClient(r.email, r.devCode).then((res) => {
        if (!res.delivered) {
          setOtpNotice(res.message ? `Email delivery issue: ${res.message}` : 'Could not send verification email. Please check server SMTP configuration.')
        }
      }).catch((e) => {
        setOtpNotice(e?.message || 'Could not send verification email.')
      })
    } catch (e) { setErr(e instanceof Error ? e.message : 'Sign-in failed') }
    finally { setBusy(false) }
  }

  const verify = (digits = code.join('')) => {
    setErr('')
    if (digits.length !== 6) { setErr('Enter the 6-digit code.'); return }
    try {
      const uid = verifyCode(token, digits)
      signIn(uid)
      const u = db.users.find((x) => x.id === uid)!
      nav(`/dashboard/${u.role}`, { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Verification failed')
      if (e instanceof Error && /Sign in again/.test(e.message)) setStep('password')
    }
  }

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, '')
    if (d.length > 1) {
      const next = d.slice(0, 6).split('')
      const filled = [...next, ...Array(6 - next.length).fill('')]
      setCode(filled)
      boxes.current[Math.min(5, next.length)]?.focus()
      if (next.length === 6) verify(next.join(''))
      return
    }
    const next = [...code]; next[i] = d; setCode(next)
    if (d && i < 5) boxes.current[i + 1]?.focus()
    if (d && i === 5 && next.join('').length === 6) verify(next.join(''))
  }

  const masked = email.replace(/^(.{2}).*(@.*)$/, '$1•••$2')
  const demo = ROLES.map((r) => ({ ...r, user: db.users.find((u) => u.role === r.id && u.active) })).filter((r) => r.user)

  return (
    <div className="min-h-screen bg-[#2E3A8C] p-0 lg:p-3">
      <div className="mx-auto flex min-h-screen max-w-[1400px] overflow-hidden bg-white lg:min-h-[calc(100vh-24px)] lg:rounded-sm">
        {/* left: illustration */}
        <section className="relative hidden flex-1 flex-col bg-[#FFFCFB] p-10 lg:flex">
          <Logo size="lg" fixed />
          <div className="flex flex-1 items-center justify-center">
            <Illustration />
          </div>
          <div className="grid grid-cols-3 gap-4 text-[#2E3A8C]">
            {[['140+', 'Government schemes & services'], ['9-stage', 'Tracked processing pipeline'], ['1 login', 'Every team, every role']].map(([a, b]) => (
              <div key={a} className="rounded-2xl border border-[#E3E6EB] bg-white p-4 shadow-sm">
                <p className="text-xl font-extrabold">{a}</p><p className="text-xs text-[#6B7280]">{b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* right: form */}
        <section className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-[#33408F] px-6 py-10 text-white lg:w-[44%] lg:max-w-[560px]">
          <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-white/5" />
          <div className="pointer-events-none absolute -bottom-32 -left-20 size-80 rounded-full bg-[#F47B20]/10" />
          <div className="relative w-full max-w-sm">
            <div className="mx-auto mb-8 flex w-fit items-center rounded-2xl border-2 border-[#F4A12A] bg-white px-6 py-3 shadow-lg">
              <Logo size="md" fixed />
            </div>

            {step === 'password' ? (
              <form onSubmit={submit} className="anim-fade-up" noValidate>
                <h1 className="mb-8 text-center text-[34px] font-extrabold leading-tight">Hello!<br />Welcome back!</h1>
                {reason && <p className="mb-4 rounded-xl bg-white/10 px-4 py-2.5 text-sm">{reason}</p>}
                <label className="mb-1.5 block text-[15px] font-medium" htmlFor="login">Username</label>
                <div className="relative mb-5">
                  <UserIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#2E3A8C]/50" />
                  <input id="login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="username or email"
                    className="h-14 w-full rounded-2xl border-2 border-[#F4A12A] bg-[#FFFCFB] pl-12 pr-4 text-[15px] text-[#111827] shadow-[0_6px_0_#F4A12A] outline-none placeholder:text-[#9CA3AF] focus:ring-4 focus:ring-white/30" />
                </div>
                <label className="mb-1.5 block text-[15px] font-medium" htmlFor="password">Password</label>
                <div className="relative mb-2">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#2E3A8C]/50" />
                  <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                    className="h-14 w-full rounded-2xl border-2 border-[#F4A12A] bg-[#FFFCFB] pl-12 pr-12 text-[15px] text-[#111827] shadow-[0_6px_0_#F4A12A] outline-none placeholder:text-[#9CA3AF] focus:ring-4 focus:ring-white/30" />
                  <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#2E3A8C]/60 hover:text-[#2E3A8C]">
                    {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </div>
                {err && <p role="alert" className="mt-4 rounded-xl bg-[#DC2626]/90 px-4 py-2.5 text-sm font-medium">{err}</p>}
                <div className="mt-8 flex justify-center">
                  <button disabled={busy} className="flex h-14 w-52 items-center justify-center gap-2 rounded-2xl bg-[#F47B20] text-2xl font-extrabold shadow-lg shadow-black/20 transition hover:bg-[#DF6A12] active:scale-[.98] disabled:opacity-70">
                    {busy ? <Loader2 className="size-6 animate-spin" /> : 'Login'}
                  </button>
                </div>
                <button type="button" onClick={() => setForgot(true)} className="mt-6 text-sm text-white/85 hover:text-white hover:underline">Forgot password?</button>

                {DEV_MODE && (
                  <div className="mt-8 rounded-2xl border border-white/15 bg-white/5 p-4">
                    <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#F4A12A]"><KeyRound className="size-3.5" />Accounts · developer mode</p>
                    <p className="mb-3 text-[11px] text-white/60">Fills the email — type that account's password.</p>
                    <div className="flex flex-wrap gap-2">
                      {demo.map((r) => (
                        <button type="button" key={r.id} title={r.user!.email} onClick={() => {
                          setLogin(r.user!.email)
                          setPassword(PRESET_USERS.has(r.user!.username) ? '' : DEMO_PASSWORD)
                          setErr('')
                          if (PRESET_USERS.has(r.user!.username)) setTimeout(() => document.getElementById('password')?.focus(), 0)
                        }}
                          className={cx('rounded-full border px-3 py-1 text-xs font-semibold transition', login === r.user!.email ? 'border-[#F4A12A] bg-[#F4A12A] text-[#1b2363]' : 'border-white/25 hover:bg-white/10')}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </form>
            ) : (
              <div className="anim-fade-up">
                <button onClick={() => { setStep('password'); setErr('') }} className="mb-6 flex items-center gap-1.5 text-sm text-white/80 hover:text-white"><ArrowLeft className="size-4" />Back</button>
                <span className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-white/10"><ShieldCheck className="size-8 text-[#F4A12A]" /></span>
                <h1 className="text-center text-2xl font-extrabold">Check your email</h1>
                <p className="mt-2 text-center text-sm text-white/80">We sent a 6-digit code to <b>{masked}</b>. It expires in 5 minutes.</p>
                <div className="mt-7 flex justify-center gap-2" onPaste={(e) => { e.preventDefault(); setDigit(0, e.clipboardData.getData('text')) }}>
                  {code.map((c, i) => (
                    <input key={i} ref={(el) => { boxes.current[i] = el }} inputMode="numeric" maxLength={6} value={c} aria-label={`Digit ${i + 1}`}
                      onChange={(e) => setDigit(i, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Backspace' && !c && i > 0) boxes.current[i - 1]?.focus(); if (e.key === 'Enter') verify() }}
                      className="size-12 rounded-xl border-2 border-[#F4A12A] bg-[#FFFCFB] text-center text-xl font-bold text-[#111827] shadow-[0_4px_0_#F4A12A] outline-none focus:ring-4 focus:ring-white/30 sm:size-14" />
                  ))}
                </div>
                {err && <p role="alert" className="mt-5 rounded-xl bg-[#DC2626]/90 px-4 py-2.5 text-center text-sm font-medium">{err}</p>}
                {otpNotice && (
                  <p role="status" className="mt-4 rounded-xl border border-amber-400/40 bg-amber-500/20 px-4 py-2 text-center text-xs text-amber-100">
                    {otpNotice}
                  </p>
                )}
                {DEV_MODE && devCode && (
                  <p className="mt-2 text-center text-xs font-mono text-white/50">
                    Dev code: <span className="font-bold text-[#F4A12A]">{devCode}</span>
                  </p>
                )}
                <div className="mt-7 flex justify-center">
                  <button onClick={() => verify()} className="h-13 w-52 rounded-2xl bg-[#F47B20] py-3 text-lg font-extrabold shadow-lg shadow-black/20 hover:bg-[#DF6A12]">Verify & sign in</button>
                </div>
                <p className="mt-5 text-center text-sm text-white/75">
                  Didn't get it? <button className="font-semibold text-white underline" onClick={() => {
                    try {
                      const nextCode = resendCode(token)
                      setDevCode(nextCode)
                      setErr('')
                      setOtpNotice('Dispatching new verification code...')
                      sendOtpEmailClient(email, nextCode).then((res) => {
                        if (res.delivered) {
                          setOtpNotice('New verification code sent to your email!')
                          setTimeout(() => setOtpNotice(''), 5000)
                        } else {
                          setOtpNotice(res.message ? `Delivery issue: ${res.message}` : 'Could not deliver code.')
                        }
                      }).catch((e) => {
                        setOtpNotice(e?.message || 'Could not deliver code.')
                      })
                    } catch (e) { setErr((e as Error).message) }
                  }}>Resend code</button>
                </p>
              </div>
            )}
          </div>
          <p className="relative mt-10 text-center text-[11px] text-white/50">© {new Date().getFullYear()} Rexera Financial Services Pvt. Ltd.</p>
        </section>
      </div>
      <ResetPasswordModal open={forgot} onClose={() => setForgot(false)} />
    </div>
  )
}

function Illustration() {
  return (
    <svg viewBox="0 0 560 460" className="w-full max-w-[560px]" role="img" aria-label="Team analysing dashboards">
      <defs>
        <linearGradient id="band" x1="0" x2="1"><stop offset="0" stopColor="#3B6FC4" /><stop offset=".5" stopColor="#2E5AAE" /><stop offset="1" stopColor="#3B6FC4" /></linearGradient>
        <linearGradient id="bandTop" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2a4f98" /><stop offset="1" stopColor="#3463b6" /></linearGradient>
      </defs>
      <ellipse cx="280" cy="395" rx="230" ry="38" fill="#EEF2FA" />
      {/* back half of ring */}
      <path d="M90 150 Q280 40 470 150 L470 300 Q280 200 90 300 Z" fill="url(#bandTop)" opacity=".95" />
      {/* screen content back */}
      <g opacity=".95">
        <path d="M140 160 q30 -40 60 0 t60 -10" stroke="#F47B20" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M140 175 q30 -30 60 5 t60 -15" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".8" />
        {[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3].map((c) => (
          <rect key={`${r}${c}`} x={290 + c * 18} y={110 + r * 16} width="11" height="11" rx="2" fill={(r + c) % 3 === 0 ? '#F47B20' : (r * c) % 2 ? '#fff' : '#1b2a55'} />
        )))}
        <circle cx="400" cy="140" r="18" fill="none" stroke="#fff" strokeWidth="7" strokeDasharray="70 120" />
        <circle cx="436" cy="168" r="16" fill="none" stroke="#F47B20" strokeWidth="6" strokeDasharray="60 120" />
        {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x={392 + i * 10} y={190 - i * 4} width="4" height={30 + i * 4} rx="2" fill="#fff" opacity=".85" />)}
      </g>
      {/* front half */}
      <path d="M90 300 Q280 200 470 300 L470 330 Q280 250 90 330 Z" fill="#244a92" />
      <path d="M90 230 L90 330 Q120 315 150 302 L150 214 Q118 220 90 230Z" fill="url(#band)" />
      <path d="M410 214 L410 302 Q440 315 470 330 L470 230 Q442 220 410 214Z" fill="url(#band)" />
      <path d="M150 260 Q280 210 410 260 L410 330 Q280 290 150 330Z" fill="url(#band)" />
      <g>
        {[0, 1, 2, 3].map((i) => <rect key={i} x={175 + i * 16} y={300 - i * 10} width="9" height={22 + i * 10} rx="2" fill={i === 2 ? '#F47B20' : '#132a5c'} />)}
        <circle cx="300" cy="285" r="18" fill="#fff" /><path d="M300 285 L300 267 A18 18 0 0 1 317 291 Z" fill="#F4A12A" />
        <rect x="335" y="270" width="50" height="5" rx="2.5" fill="#fff" opacity=".85" /><rect x="335" y="282" width="36" height="5" rx="2.5" fill="#fff" opacity=".6" />
      </g>
      {/* floating cards */}
      <g className="anim-float">
        <rect x="30" y="300" width="120" height="78" rx="10" fill="#fff" stroke="#E3E6EB" />
        <rect x="42" y="312" width="58" height="6" rx="3" fill="#2E3A8C" />
        {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={46 + i * 18} y={360 - [20, 32, 16, 40, 28][i]!} width="10" height={[20, 32, 16, 40, 28][i]} rx="2" fill={i === 3 ? '#F47B20' : '#9fb3e6'} />)}
      </g>
      <g className="anim-float" style={{ animationDelay: '1.2s' }}>
        <rect x="430" y="330" width="110" height="64" rx="10" fill="#fff" stroke="#E3E6EB" />
        <path d="M444 378 L468 360 L488 368 L520 344" stroke="#0E9F6E" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="444" y="342" width="40" height="5" rx="2.5" fill="#2E3A8C" />
      </g>
      {/* cubes & plant */}
      {[[500, 70, 14], [520, 120, 10], [470, 105, 18]].map(([x, y, s], i) => (
        <g key={i} className="anim-float" style={{ animationDelay: `${i * 0.6}s` }}>
          <path d={`M${x} ${y} l${s} -${s / 2} l${s} ${s / 2} l-${s} ${s / 2}z`} fill="#dfe6f6" />
          <path d={`M${x} ${y} l${s} ${s / 2} v${s} l-${s} -${s / 2}z`} fill="#c4d0ee" />
          <path d={`M${x + 2 * s} ${y} l-${s} ${s / 2} v${s} l${s} -${s / 2}z`} fill="#aebde6" />
        </g>
      ))}
      <g transform="translate(60 70)">
        <path d="M20 60 C18 40 10 25 0 10 M20 60 C22 38 30 22 42 8 M20 60 C20 45 22 30 20 0" stroke="#2E5AAE" strokeWidth="2.5" fill="none" />
        <path d="M0 10 q8 2 6 12 q-8 -2 -6 -12 M42 8 q-2 10 -10 10 q0 -10 10 -10 M20 0 q6 6 0 14 q-6 -8 0 -14" fill="#3B6FC4" />
        <path d="M8 60 h24 l-4 22 h-16z" fill="#dfe6f6" />
      </g>
    </svg>
  )
}
