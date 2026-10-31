import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, KeyRound, Loader2, Lock, ShieldCheck, User as UserIcon } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useDb } from '../lib/store'
import { loginStep1, resendCode, signInWithoutCode, verifyCode } from '../lib/actions'
import { DEMO_PASSWORD, PRESET_USERS } from '../lib/seed'
import { ROLES } from '../lib/rbac'
import { Logo } from '../components/Logo'
import { IstClock, LoginShowcase, LoginVideo, useMedia } from '../components/LoginShowcase'
import { ResetPasswordModal } from '../components/ResetPasswordModal'
import { cx } from '../components/ui'
import { sendOtpEmailClient } from '../lib/emailClient'

const DEV_MODE = import.meta.env.DEV || import.meta.env.VITE_DEMO === '1'

export default function Login() {
  const { user, signIn } = useAuth()
  const db = useDb()
  const nav = useNavigate()
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
  // Super Admin / IT Support: when the code can't be emailed they may go on with their password (recorded)
  const [master, setMaster] = useState(false)
  const [noMail, setNoMail] = useState('')
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [forgot, setForgot] = useState(false)
  // read on every render: a sign-out can happen while this page is already open
  const reason = sessionStorage.getItem('rexera-signout-reason')
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => { if (step === 'code') setTimeout(() => boxes.current[0]?.focus(), 50) }, [step])
  // signing in always lands on the person's dashboard
  const wide = useMedia('(min-width: 1024px)') // one video only: in the left panel on big screens, above the form on phones
  if (user) return <Navigate to={`/dashboard/${user.role}`} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setOtpNotice('')
    if (!login.trim() || !password) { setErr('Enter your username and password.'); return }
    setBusy(true)
    try {
      const r = await loginStep1(login, password)
      setToken(r.token); setDevCode(r.devCode); setEmail(r.email); setStep('code'); setCode(['', '', '', '', '', '']); setMaster(r.master); setNoMail('')
      // The code is shown on screen only in developer mode. In a real build, showing it whenever email fails let anyone
      // who knew a password skip the second step.
      const undelivered = DEV_MODE
        ? `Email could not be sent (developer mode). Your 6-digit verification code is: ${r.devCode}`
        : 'We could not email your code right now. Please try again in a minute, or contact IT Support.'
      sendOtpEmailClient(r.email, r.devCode).then((res) => {
        if (!res.delivered) { setOtpNotice(undelivered); setNoMail(res.message || 'email not available') }
      }).catch((e: Error) => { setOtpNotice(undelivered); setNoMail(e.message || 'email not available') })
    } catch (e) { setErr(e instanceof Error ? e.message : 'Sign-in failed') }
    finally { setBusy(false) }
  }

  /** Super Admin / IT Support only, after the code email failed: sign in with the password already checked. */
  const continueWithoutCode = () => {
    setErr('')
    try {
      const uid = signInWithoutCode(token, noMail)
      signIn(uid)
      const u = db.users.find((x) => x.id === uid)!
      nav(`/dashboard/${u.role}`, { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sign-in failed')
      if (e instanceof Error && /Sign in again/.test(e.message)) setStep('password')
    }
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
        {/* left: introduction, welcome video and services + India time */}
        <section className="relative hidden flex-1 flex-col overflow-hidden bg-[#FFFCFB] p-10 lg:flex">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(#2E3A8C0a_1px,transparent_1px),linear-gradient(90deg,#2E3A8C0a_1px,transparent_1px)] [background-size:40px_40px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
          <div className="relative flex items-start justify-between gap-4">
            <Logo size="lg" fixed />
            <IstClock />
          </div>
          <div className="relative flex flex-1 items-center justify-center py-6">
            {wide && <LoginShowcase />}
          </div>
          <div className="relative grid grid-cols-3 gap-4 text-[#2E3A8C]">
            {[['140+', 'Government schemes & services'], ['8-stage', 'Tracked processing pipeline'], ['1 login', 'Every team, every role']].map(([a, b]) => (
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
            {!wide && step === 'password' && <>
              <IstClock size="sm" className="mx-auto mb-6 w-fit" />
              <LoginVideo className="mb-8 rounded-3xl border-2 border-[#F4A12A] shadow-xl" />
            </>}

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
                {otpNotice && !(master && noMail) && (
                  <p role="status" className="mt-4 rounded-xl border border-amber-400/40 bg-amber-500/20 px-4 py-2 text-center text-xs text-amber-100">
                    {otpNotice}
                  </p>
                )}
                {master && noMail && (
                  <div role="status" className="mt-4 rounded-xl border border-amber-400/40 bg-amber-500/20 px-4 py-3 text-center text-xs text-amber-100">
                    <p>The code email could not be sent. As <b>Super Admin / IT Support</b> you can continue with the password you entered — this sign-in is recorded in the activity log.</p>
                    <button type="button" onClick={continueWithoutCode} className="mt-2.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#2E3A8C] hover:bg-white/90">Continue without the code</button>
                  </div>
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
                      // the code itself is shown only in developer / demo mode, never on the live CRM
                      const undelivered = DEV_MODE
                        ? `Email could not be sent (developer mode). Your new 6-digit code is: ${nextCode}`
                        : 'We could not email your new code right now. Please try again in a minute, or contact IT Support.'
                      sendOtpEmailClient(email, nextCode).then((res) => {
                        if (res.delivered) {
                          setNoMail('')
                          setOtpNotice('New verification code sent to your email!')
                          setTimeout(() => setOtpNotice(''), 5000)
                        } else {
                          setOtpNotice(undelivered); setNoMail(res.message || 'email not available')
                        }
                      }).catch((e: Error) => { setOtpNotice(undelivered); setNoMail(e.message || 'email not available') })
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
