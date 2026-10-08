import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { resetPasswordWithToken, verifyResetToken, PASSWORD_HINT, PASSWORD_RULE } from '../lib/actions'
import { completePasswordReset, getSupabase } from '../lib/supabase'
import { Logo } from '../components/Logo'
import { Button } from '../components/ui'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const nav = useNavigate()

  const token = params.get('token') || ''
  const emailParam = params.get('email') || ''

  const [email, setEmail] = useState(emailParam)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [validating, setValidating] = useState(true)
  const [tokenValid, setTokenValid] = useState(true)
  const [tokenError, setTokenError] = useState('')
  const [success, setSuccess] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let mounted = true

    async function checkToken() {
      // 1. Check local token
      if (token) {
        const res = verifyResetToken(token, emailParam)
        if (!mounted) return
        if (res.valid) {
          if (res.email) setEmail(res.email)
          setTokenValid(true)
          setValidating(false)
          return
        }
      }

      // 2. Check Supabase recovery session if present
      try {
        const sb = await getSupabase()
        const { data: { session } } = await sb.auth.getSession()
        if (!mounted) return
        if (session?.user?.email) {
          setEmail(session.user.email)
          setTokenValid(true)
          setValidating(false)
          return
        }
      } catch {
        // Supabase not active
      }

      if (token) {
        const res = verifyResetToken(token, emailParam)
        if (!res.valid) {
          setTokenValid(false)
          setTokenError(res.reason || 'Invalid or expired reset link.')
        }
      } else if (!window.location.hash.includes('access_token')) {
        setTokenValid(false)
        setTokenError('No valid reset token found in the link. Please request a new password reset link.')
      }

      if (mounted) setValidating(false)
    }

    checkToken()
    return () => { mounted = false }
  }, [token, emailParam])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')

    if (!password) {
      setErr('Enter a new password.')
      return
    }
    if (!PASSWORD_RULE.test(password)) {
      setErr(`Password must be ${PASSWORD_HINT}`)
      return
    }
    if (password !== confirm) {
      setErr('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      // 1. Reset in local CRM store if token exists
      if (token) {
        await resetPasswordWithToken(token, password, confirm, emailParam || email)
      }


      // 2. Also reset in Supabase if session active
      try {
        await completePasswordReset(password)
      } catch {
        // Ok if not running Supabase session
      }

      setSuccess(true)
    } catch (e: any) {
      setErr(e.message || 'Failed to update password. Please request a new link.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#2E3A8C] p-4 flex items-center justify-center">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-[#33408F] p-8 text-white shadow-2xl border border-white/10 relative">
        <div className="pointer-events-none absolute -right-20 -top-20 size-60 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-24 -left-20 size-64 rounded-full bg-[#F47B20]/10" />

        <div className="relative">
          <div className="mx-auto mb-6 flex w-fit items-center rounded-2xl border-2 border-[#F4A12A] bg-white px-5 py-2.5 shadow-lg">
            <Logo size="md" fixed />
          </div>

          {validating ? (
            <div className="py-12 text-center">
              <Loader2 className="mx-auto size-8 animate-spin text-[#F4A12A]" />
              <p className="mt-3 text-sm text-white/80">Verifying reset link...</p>
            </div>
          ) : !tokenValid ? (
            <div className="text-center py-6">
              <span className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-rose-500/20 text-rose-400">
                <AlertCircle className="size-10" />
              </span>
              <h1 className="text-2xl font-extrabold">Link Expired or Invalid</h1>
              <p className="mt-2 text-sm text-white/80 leading-relaxed">
                {tokenError || 'This password reset link is invalid or has already expired.'}
              </p>
              <div className="mt-8 flex justify-center">
                <Button onClick={() => nav('/login', { replace: true })} className="w-full h-12 bg-[#F47B20] text-base font-bold hover:bg-[#DF6A12]">
                  Return to Sign In
                </Button>
              </div>
            </div>
          ) : success ? (
            <div className="text-center py-6">
              <span className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">
                <CheckCircle2 className="size-10" />
              </span>
              <h1 className="text-2xl font-extrabold">Password Updated!</h1>
              <p className="mt-2 text-sm text-white/80">
                Your password has been changed. You can now log into your account using your new password.
              </p>
              <div className="mt-8 flex justify-center">
                <Button onClick={() => nav('/login', { replace: true })} className="w-full h-12 bg-[#F47B20] text-base font-bold hover:bg-[#DF6A12]">
                  Sign In with New Password
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="anim-fade-up">
              <div className="text-center mb-6">
                <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-white/10 text-[#F4A12A]">
                  <KeyRound className="size-6" />
                </span>
                <h1 className="text-2xl font-extrabold">Set New Password</h1>
                <p className="mt-1 text-sm text-white/70">
                  {email ? (
                    <>Updating password for <b className="text-white">{email}</b></>
                  ) : (
                    'Enter your new password below'
                  )}
                </p>
              </div>

              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold text-white/80" htmlFor="new-pass">New Password</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="new-pass"
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-12 w-full rounded-xl border border-white/20 bg-[#FFFCFB] pl-10 pr-10 text-sm text-[#111827] outline-none placeholder:text-[#9CA3AF] focus:ring-2 focus:ring-[#F4A12A]"
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((s) => !s)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold text-white/80" htmlFor="confirm-pass">Confirm New Password</label>
                <div className="relative">
                  <ShieldCheck className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="confirm-pass"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    className="h-12 w-full rounded-xl border border-white/20 bg-[#FFFCFB] pl-10 pr-10 text-sm text-[#111827] outline-none placeholder:text-[#9CA3AF] focus:ring-2 focus:ring-[#F4A12A]"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((s) => !s)}
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <p className="mb-4 text-[11px] text-white/60 leading-relaxed">
                Password must contain {PASSWORD_HINT}
              </p>

              {err && (
                <p role="alert" className="mb-4 rounded-xl bg-[#DC2626]/90 px-4 py-2.5 text-xs font-medium text-white">
                  {err}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex h-12 items-center justify-center gap-2 rounded-xl bg-[#F47B20] text-base font-bold shadow-lg transition hover:bg-[#DF6A12] active:scale-[.98] disabled:opacity-70"
              >
                {loading ? <Loader2 className="size-5 animate-spin" /> : 'Save New Password'}
              </button>

              <div className="mt-5 text-center">
                <Link to="/login" className="text-xs text-white/70 hover:text-white underline">
                  Back to Sign In
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
