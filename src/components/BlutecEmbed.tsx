import { useCallback, useEffect, useRef, useState } from 'react'
import { useMe } from '../lib/auth'
import { cx } from './ui'

interface Props {
  className?: string
  /** Called when the embed fails to load. */
  onError?: (msg: string) => void
}

type EmbedState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; src: string }
  | { phase: 'prompt'; message?: string; email: string }

const STORAGE_EMAIL_KEY = 'rexera-blutec-email'
const STORAGE_PASS_KEY = 'rexera-blutec-pass'

export function BlutecEmbed({ className, onError }: Props) {
  const me = useMe()
  const [state, setState] = useState<EmbedState>({ phase: 'idle' })
  const [emailInput, setEmailInput] = useState('')
  const [passInput, setPassInput] = useState('')
  const [remember, setRemember] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const frameRef = useRef<HTMLIFrameElement>(null)
  const startedRef = useRef(false)

  // Default email to the signed-in CRM user's email
  useEffect(() => {
    const savedEmail = (() => {
      try { return localStorage.getItem(STORAGE_EMAIL_KEY) || '' } catch { return '' }
    })()
    setEmailInput(savedEmail || me.email || '')
  }, [me.email])

  const loginWithCreds = useCallback(async (email: string, pass: string, save = false) => {
    if (!email || !pass) {
      setErrorMsg('Please enter both your Blutec email and password.')
      return
    }
    setSubmitting(true)
    setErrorMsg('')
    try {
      const res = await fetch('/api/blutec-embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass }),
      })

      const json = await res.json().catch(() => null) as {
        success?: boolean
        nonce?: string
        email?: string
        code?: string
        message?: string
      } | null

      if (!res.ok || !json?.nonce) {
        const msg = json?.message || `Blutec login failed (${res.status})`
        setErrorMsg(msg)
        setSubmitting(false)
        onError?.(msg)
        return
      }

      // Persist credentials if remember is true
      if (save) {
        try {
          localStorage.setItem(STORAGE_EMAIL_KEY, email)
          localStorage.setItem(STORAGE_PASS_KEY, pass)
        } catch { /* ignore */ }
      }

      // Load Blutec with the nonce token injection
      const src = `/btc/agent/dialer?_nonce=${encodeURIComponent(json.nonce)}`
      setState({ phase: 'ready', src })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not reach server.'
      setErrorMsg(msg)
      onError?.(msg)
    } finally {
      setSubmitting(false)
    }
  }, [onError])

  // On mount: check if browser has a saved password, or check if Blutec auth already exists
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    // 1. Check if auth-storage already has an active Blutec token in this browser
    try {
      const authRaw = localStorage.getItem('auth-storage')
      if (authRaw) {
        const parsed = JSON.parse(authRaw)
        if (parsed?.state?.accessToken) {
          // Already logged into Blutec in this browser!
          setState({ phase: 'ready', src: '/btc/agent/dialer' })
          return
        }
      }
    } catch { /* ignore */ }

    // 2. Check if the sales person saved their individual Blutec password in this browser
    let savedEmail = ''
    let savedPass = ''
    try {
      savedEmail = localStorage.getItem(STORAGE_EMAIL_KEY) || ''
      savedPass = localStorage.getItem(STORAGE_PASS_KEY) || ''
    } catch { /* ignore */ }

    const targetEmail = savedEmail || me.email || ''
    if (targetEmail && savedPass) {
      // Auto-login with saved individual credentials
      loginWithCreds(targetEmail, savedPass, false)
      return
    }

    // 3. Otherwise show the clean login prompt
    setState({ phase: 'prompt', email: targetEmail })
  }, [loginWithCreds, me.email])

  // Ready state: render the iframe
  if (state.phase === 'ready') {
    return (
      <div className={cx('relative flex flex-col overflow-hidden rounded-2xl border border-line bg-card2', className)}>
        <div className="flex h-9 items-center justify-between border-b border-line bg-card px-3 text-xs">
          <span className="font-semibold text-fg">📞 Blutec Web Dialer</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-mute hover:text-bad transition font-medium"
              onClick={() => {
                try {
                  localStorage.removeItem('auth-storage')
                  localStorage.removeItem(STORAGE_PASS_KEY)
                } catch { /* ignore */ }
                setState({ phase: 'prompt', email: me.email || '' })
              }}
            >
              Sign out / Reconnect
            </button>
          </div>
        </div>
        <iframe
          ref={frameRef}
          src={state.src}
          className="h-full w-full flex-1 border-none"
          allow="microphone; autoplay; clipboard-write; camera"
          title="Blutec Dialer"
        />
      </div>
    )
  }

  // Loading state
  if (state.phase === 'loading') {
    return (
      <div className={cx('flex flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-card2 p-12 text-sm text-mute', className)}>
        <span className="size-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        <span className="animate-pulse font-medium">Connecting to your Blutec dialer…</span>
      </div>
    )
  }

  // Prompt state: clean sign-in form for individual sales person
  const currentEmail = (state.phase === 'prompt' && state.email) || emailInput || me.email || ''

  return (
    <div className={cx('flex flex-col items-center justify-center rounded-2xl border border-line bg-card p-8 text-center shadow-sm', className)}>
      <div className="w-full max-w-sm space-y-4">
        <div className="space-y-1">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-brand-soft text-brand">
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-fg">Blutec Web Dialer</h3>
          <p className="text-xs text-mute">Sign in with your individual Blutec agent credentials to dial from your dashboard.</p>
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-bad/30 bg-bad-soft p-3 text-left text-xs font-medium text-bad">
            {errorMsg}
          </div>
        )}

        <form
          className="space-y-3 text-left"
          onSubmit={(e) => {
            e.preventDefault()
            loginWithCreds(emailInput.trim(), passInput.trim(), remember)
          }}
        >
          <div>
            <label className="text-xs font-semibold text-fg">Blutec Agent Email</label>
            <input
              type="email"
              required
              className="mt-1 w-full rounded-xl border border-line bg-card2 px-3.5 py-2 text-sm text-fg focus:border-brand focus:outline-none"
              placeholder="agent@company.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-fg">Blutec Agent Password</label>
            <input
              type="password"
              required
              className="mt-1 w-full rounded-xl border border-line bg-card2 px-3.5 py-2 text-sm text-fg focus:border-brand focus:outline-none"
              placeholder="Your Blutec password"
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer pt-1 text-xs text-mute">
            <input
              type="checkbox"
              className="rounded border-line text-brand focus:ring-0"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Remember my password on this computer (auto-login)
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand/90 transition disabled:opacity-50"
          >
            {submitting ? 'Connecting…' : 'Connect & Launch Dialer'}
          </button>
        </form>

        <div className="pt-2">
          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-line"></div>
            <span className="flex-shrink mx-2 text-[11px] text-mute uppercase font-semibold">Or</span>
            <div className="flex-grow border-t border-line"></div>
          </div>

          <button
            type="button"
            className="w-full rounded-xl border border-line bg-card2 py-2 text-xs font-semibold text-fg hover:bg-card transition"
            onClick={() => setState({ phase: 'ready', src: '/btc/login' })}
          >
            Sign in directly inside Blutec frame
          </button>
        </div>
      </div>
    </div>
  )
}
