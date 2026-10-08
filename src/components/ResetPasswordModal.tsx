import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, CheckCircle2, Copy, ExternalLink, Loader2, Mail } from 'lucide-react'
import { createPasswordResetLink } from '../lib/actions'
import { sendPasswordResetEmail, cloudConfig } from '../lib/supabase'
import { sendResetEmailClient } from '../lib/emailClient'
import { Button, Input, Modal } from './ui'

export function ResetPasswordModal({ open, onClose, email: fixedEmail }: { open: boolean; onClose: () => void; email?: string }) {
  const nav = useNavigate()
  const [email, setEmail] = useState(fixedEmail ?? '')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [emailDelivered, setEmailDelivered] = useState(false)
  const [directLink, setDirectLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (open) {
      setEmail(fixedEmail ?? '')
      setLoading(false)
      setSent(false)
      setEmailDelivered(false)
      setDirectLink('')
      setCopied(false)
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
      setDirectLink(resetLink)

      // 2. Dispatch via universal client (local backend -> Supabase Edge Function)
      const dispatch = await sendResetEmailClient(email, resetLink)
      if (dispatch.delivered) {
        setEmailDelivered(true)
        setSent(true)
        return
      }

      // 3. Fallback: Supabase Auth recovery email if cloud configured
      const cfg = cloudConfig()
      if (cfg.status === 'ready') {
        try {
          await sendPasswordResetEmail(email.trim())
          setEmailDelivered(true)
          setSent(true)
          return
        } catch (sbErr: any) {
          console.warn('[Supabase Auth Reset fallback failed]:', sbErr.message)
        }
      }

      // If email couldn't be sent (e.g. Render Free blocks SMTP), show direct reset action
      setEmailDelivered(false)
      setSent(true)
    } catch (e: any) {
      setErr(e.message || 'Failed to generate reset link.')
    } finally {
      setLoading(false)
    }
  }

  const copyLink = async () => {
    if (!directLink) return
    try {
      await navigator.clipboard.writeText(directLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {}
  }

  const openDirectLink = () => {
    if (!directLink) return
    try {
      const u = new URL(directLink)
      onClose()
      nav(u.pathname + u.search)
    } catch {
      window.location.href = directLink
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
          <div className="flex w-full items-center justify-between gap-2">
            {!emailDelivered && directLink && (
              <Button variant="outline" size="sm" icon={copied ? Check : Copy} onClick={copyLink}>
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              {!emailDelivered && directLink && (
                <Button size="sm" icon={ExternalLink} onClick={openDirectLink}>
                  Reset now
                </Button>
              )}
              <Button size="sm" variant={emailDelivered ? 'primary' : 'outline'} onClick={onClose}>
                Back to sign in
              </Button>
            </div>
          </div>
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
          {emailDelivered ? (
            <>
              <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm">
                <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
                <span>Reset link sent!</span>
              </div>
              <p className="text-sm text-mute leading-relaxed">
                A password reset link has been dispatched to <b className="text-ink">{email}</b>. Please check your inbox and click the link to choose your new password.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm">
                <CheckCircle2 className="size-5 shrink-0 text-amber-600" />
                <span>Reset link ready!</span>
              </div>
              <p className="text-xs text-mute leading-relaxed">
                Render free tier blocks outbound email ports (25, 465 & 587). You can reset your password immediately using the direct link below:
              </p>
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                <p className="break-all font-mono text-[11px] text-amber-900 select-all">
                  {directLink}
                </p>
              </div>
            </>
          )}
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
