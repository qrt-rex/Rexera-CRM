import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { CLOUD } from '../lib/cloud'
import { dialerKey } from '../lib/dialer'
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
  | { phase: 'error'; message: string; email?: string; code?: string }

const STORAGE_EMAIL_KEY = 'rexera-blutec-email'
const STORAGE_PASS_KEY = 'rexera-blutec-password'

export function BlutecEmbed({ className, onError }: Props) {
  const [state, setState] = useState<EmbedState>({ phase: 'idle' })
  const [showCustom, setShowCustom] = useState(false)
  const [customEmail, setCustomEmail] = useState(() => {
    try { return localStorage.getItem(STORAGE_EMAIL_KEY) || '' } catch { return '' }
  })
  const [customPassword, setCustomPassword] = useState(() => {
    try { return localStorage.getItem(STORAGE_PASS_KEY) || '' } catch { return '' }
  })
  const frameRef = useRef<HTMLIFrameElement>(null)
  const startedRef = useRef(false)

  const startLogin = useCallback(async (overrideEmail?: string, overridePass?: string) => {
    setState({ phase: 'loading' })
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }

      if (CLOUD) {
        const sb = await getSupabase()
        const { data: { session } } = await sb.auth.getSession()
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`
        }
      } else {
        const dk = dialerKey.get()
        if (dk) headers['X-Dialer-Key'] = dk
      }

      // Check if user has saved custom credentials in localStorage or passed them in
      const email = overrideEmail ?? (customEmail.trim() || undefined)
      const password = overridePass ?? (customPassword.trim() || undefined)

      const body: Record<string, string> = {}
      if (email) body.email = email
      if (password) body.password = password

      const res = await fetch('/api/blutec-embed', {
        method: 'POST',
        headers,
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
      })

      const json = await res.json().catch(() => null) as {
        success?: boolean
        nonce?: string
        email?: string
        code?: string
        message?: string
      } | null

      if (!res.ok || !json?.nonce) {
        const msg = json?.message || `Server error (${res.status})`
        setState({
          phase: 'error',
          message: msg,
          email: json?.email,
          code: json?.code,
        })
        onError?.(msg)
        return
      }

      // If custom credentials succeeded, persist them
      if (email) {
        try { localStorage.setItem(STORAGE_EMAIL_KEY, email) } catch { /* ignore */ }
      }
      if (password) {
        try { localStorage.setItem(STORAGE_PASS_KEY, password) } catch { /* ignore */ }
      }

      // The iframe loads /btc/agent/dialer; proxy injects auth via the nonce
      const src = `/btc/agent/dialer?_nonce=${encodeURIComponent(json.nonce)}`
      setState({ phase: 'ready', src })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not reach the server.'
      setState({ phase: 'error', message: msg })
      onError?.(msg)
    }
  }, [customEmail, customPassword, onError])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    startLogin()
  }, [startLogin])

  if (state.phase === 'idle' || state.phase === 'loading') {
    return (
      <div className={cx('flex flex-col items-center justify-center gap-3 rounded-2xl bg-card2 p-8 text-sm text-mute', className)}>
        <span className="size-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        <span className="animate-pulse font-medium">Connecting to Blutec dialer…</span>
      </div>
    )
  }

  if (state.phase === 'error') {
    const isNoPassword = state.code === 'NO_PASSWORD'
    const isInvalidCreds = state.code === 'LOGIN_FAILED' || /invalid credentials/i.test(state.message)

    return (
      <div className={cx('flex flex-col items-center justify-center gap-4 rounded-2xl border border-bad/20 bg-bad-soft p-8 text-center', className)}>
        <div className="size-12 rounded-full bg-bad/10 p-3 text-bad">
          <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>

        <div className="max-w-md space-y-1">
          <h3 className="text-base font-bold text-bad">Could not connect to Blutec dialer</h3>
          <p className="text-sm font-semibold text-bad/90">{state.message}</p>
          {state.email && (
            <p className="mt-1 text-xs text-mute">
              Attempted login for: <b className="text-fg">{state.email}</b>
            </p>
          )}
        </div>

        {isNoPassword ? (
          <p className="max-w-md text-xs text-mute">
            Set <code className="rounded bg-card2 px-1.5 py-0.5 font-mono text-fg">BLUTEC_AGENT_PASSWORD</code> in your Render service environment variables and restart the server.
          </p>
        ) : isInvalidCreds ? (
          <div className="max-w-lg rounded-xl border border-line bg-card/60 p-3 text-left text-xs text-mute">
            <p className="font-semibold text-fg">Why this happens:</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>The email <code className="text-fg">{state.email || 'your CRM email'}</code> is not registered as an agent in Blutec.</li>
              <li>Or the password set in <code className="text-fg">BLUTEC_AGENT_PASSWORD</code> does not match this user's password in Blutec.</li>
              <li>If you use a shared agent account in Blutec, set <code className="text-fg">BLUTEC_AGENT_EMAIL</code> in Render environment variables.</li>
            </ul>
          </div>
        ) : null}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <button
            type="button"
            className="rounded-xl border border-line bg-card px-4 py-2 text-xs font-semibold text-fg hover:bg-card2 transition"
            onClick={() => {
              startedRef.current = false
              startLogin()
            }}
          >
            Retry auto-login
          </button>

          <button
            type="button"
            className="rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white shadow hover:bg-brand/90 transition"
            onClick={() => setState({ phase: 'ready', src: '/btc/login' })}
          >
            Sign in manually in frame
          </button>

          <button
            type="button"
            className="rounded-xl border border-line px-3 py-2 text-xs font-semibold text-mute hover:text-fg transition"
            onClick={() => setShowCustom((v) => !v)}
          >
            {showCustom ? 'Hide custom credentials' : 'Use custom Blutec credentials'}
          </button>
        </div>

        {/* Custom credentials form */}
        {showCustom && (
          <form
            className="mt-2 w-full max-w-sm space-y-2 rounded-xl border border-line bg-card p-4 text-left shadow-sm"
            onSubmit={(e) => {
              e.preventDefault()
              startedRef.current = false
              startLogin(customEmail.trim(), customPassword.trim())
            }}
          >
            <p className="text-xs font-bold text-fg">Custom Blutec credentials for this browser:</p>
            <div>
              <label className="text-[11px] font-semibold text-mute">Blutec Agent Email</label>
              <input
                type="email"
                required
                className="mt-0.5 w-full rounded-lg border border-line bg-card2 px-3 py-1.5 text-xs text-fg focus:border-brand focus:outline-none"
                placeholder="agent@blutec.ai"
                value={customEmail}
                onChange={(e) => setCustomEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-mute">Blutec Agent Password</label>
              <input
                type="password"
                required
                className="mt-0.5 w-full rounded-lg border border-line bg-card2 px-3 py-1.5 text-xs text-fg focus:border-brand focus:outline-none"
                placeholder="Password"
                value={customPassword}
                onChange={(e) => setCustomPassword(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="submit"
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
              >
                Sign in with these credentials
              </button>
            </div>
          </form>
        )}
      </div>
    )
  }

  return (
    <div className={cx('relative overflow-hidden rounded-2xl border border-line bg-card2', className)}>
      <iframe
        ref={frameRef}
        src={state.src}
        className="h-full w-full border-none"
        allow="microphone; autoplay; clipboard-write; camera"
        title="Blutec Dialer"
      />
    </div>
  )
}
