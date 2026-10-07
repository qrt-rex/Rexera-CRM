import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Mail } from 'lucide-react'
import { createPasswordResetLink } from '../lib/actions'
import { sendPasswordResetEmail, cloudConfig } from '../lib/supabase'
import { Button, Input, Modal } from './ui'

export function ResetPasswordModal({ open, onClose, email: fixedEmail }: { open: boolean; onClose: () => void; email?: string }) {
  const [email, setEmail] = useState(fixedEmail ?? '')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (open) {
      setEmail(fixedEmail ?? '')
      setLoading(false)
      setSent(false)
      setErr('')
    }
  }, [open, fixedEmail])

  const send = async () => {
    if (!email.trim() || !email.includes('@')) {
      setErr('Please enter a valid email address.')
      return
    }
    setErr('')
    setLoading(true)

    try {
      // 1. Generate local token-based reset link
      const { resetLink } = createPasswordResetLink(email)

      let delivered = false

      // 2. Try dispatching via Hostinger / SMTP relay in Vite dev server
      try {
        const resp = await fetch('/api/send-reset-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), resetLink }),
        })
        const data = await resp.json()
        if (data.success) {
          delivered = true
        } else if (data.message && data.configured !== false) {
          throw new Error(data.message)
        }
      } catch (relayErr: any) {
        if (!relayErr.message?.includes('Failed to fetch')) {
          setErr(relayErr.message)
        }
      }

      // 3. If SMTP was not configured, try Supabase Auth as fallback
      if (!delivered) {
        const cfg = cloudConfig()
        if (cfg.status === 'ready') {
          try {
            await sendPasswordResetEmail(email.trim())
            delivered = true
          } catch (sbErr: any) {
            setErr(sbErr.message || 'Failed to send reset email.')
          }
        }
      }


      setSent(true)
    } catch (e: any) {
      setErr(e.message || 'Failed to generate reset link.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reset your password"
      size="sm"
      footer={
        sent ? (
          <Button onClick={onClose}>Back to sign in</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button icon={loading ? Loader2 : Mail} onClick={send} disabled={loading}>
              {loading ? 'Sending link...' : 'Send reset link'}
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <div className="space-y-3 py-1">
          <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm">
            <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
            <span>Reset link sent!</span>
          </div>
          <p className="text-sm text-mute leading-relaxed">
            A password reset link has been dispatched to <b className="text-ink">{email}</b>. Please check your inbox and click the link to choose your new password.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          <Input
            label="Account email"
            type="email"
            value={email}
            disabled={!!fixedEmail || loading}
            onChange={(e) => {
              setEmail(e.target.value)
              if (err) setErr('')
            }}
            placeholder="you@rexera.in"
            autoFocus={!fixedEmail}
            error={err}
          />
          <p className="text-xs text-mute">
            Enter your email address. We'll send a direct reset link so you can choose a new password.
          </p>
        </div>
      )}
    </Modal>
  )
}
