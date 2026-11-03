import { useEffect, useRef, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { CLOUD } from '../lib/cloud'
import { dialerKey } from '../lib/dialer'
import { cx } from './ui'

interface Props {
  className?: string
  /** Called when the embed fails to load (e.g. password not configured). */
  onError?: (msg: string) => void
}

type EmbedState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; src: string }
  | { phase: 'error'; message: string }

/**
 * BlutecEmbed — embeds the Blutec web dialer inside an iframe with automatic agent login.
 *
 * The server creates a short-lived nonce (90 s) that the proxy uses to inject the agent's
 * Blutec JWT into localStorage before the SPA boots — so the agent lands directly on the
 * dialer page without ever seeing the Blutec login screen.
 */
export function BlutecEmbed({ className, onError }: Props) {
  const [state, setState] = useState<EmbedState>({ phase: 'idle' })
  const frameRef = useRef<HTMLIFrameElement>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    async function start() {
      setState({ phase: 'loading' })
      try {
        // Build the headers for the embed-session request
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }

        if (CLOUD) {
          // Supabase auth: send the JWT so the server can verify who we are
          const sb = await getSupabase()
          const { data: { session } } = await sb.auth.getSession()
          if (session?.access_token) {
            headers['Authorization'] = `Bearer ${session.access_token}`
          }
        } else {
          // Access-key auth (non-cloud / dev)
          const dk = dialerKey.get()
          if (dk) headers['X-Dialer-Key'] = dk
        }

        const res = await fetch('/api/blutec-embed', { method: 'POST', headers })
        const json = await res.json().catch(() => null) as { success?: boolean; nonce?: string; message?: string } | null

        if (!res.ok || !json?.nonce) {
          const msg = json?.message || `Server error (${res.status})`
          setState({ phase: 'error', message: msg })
          onError?.(msg)
          return
        }

        // The iframe loads /btc/agent/dialer; the proxy injects auth via the nonce
        const src = `/btc/agent/dialer?_nonce=${encodeURIComponent(json.nonce)}`
        setState({ phase: 'ready', src })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not reach the server.'
        setState({ phase: 'error', message: msg })
        onError?.(msg)
      }
    }

    start()
  }, [onError])

  if (state.phase === 'idle' || state.phase === 'loading') {
    return (
      <div className={cx('flex items-center justify-center rounded-2xl bg-card2 text-sm text-mute', className)}>
        <span className="animate-pulse">Loading Blutec dialer…</span>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className={cx('flex flex-col items-center justify-center gap-3 rounded-2xl bg-bad-soft p-8 text-center', className)}>
        <p className="font-semibold text-bad">Could not open the Blutec dialer</p>
        <p className="text-sm text-bad/80">{state.message}</p>
        <p className="text-xs text-mute">
          Ask IT to set <code className="rounded bg-card2 px-1">BLUTEC_AGENT_PASSWORD</code> in the server environment.
        </p>
        <button
          className="mt-2 rounded-xl border border-bad/30 px-4 py-1.5 text-sm font-semibold text-bad hover:bg-bad-soft"
          onClick={() => { startedRef.current = false; setState({ phase: 'idle' }); setTimeout(() => { startedRef.current = false }, 0) }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <iframe
      ref={frameRef}
      src={state.src}
      className={cx('rounded-2xl border border-line bg-card2', className)}
      allow="microphone; autoplay; clipboard-write; camera"
      title="Blutec Dialer"
      // No sandbox: Blutec needs localStorage and scripts to work
    />
  )
}
