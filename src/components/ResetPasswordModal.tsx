import { useEffect, useState } from 'react'
import { KeyRound, Mail } from 'lucide-react'
import { PASSWORD_HINT, requestPasswordReset, resetPasswordWithCode } from '../lib/actions'
import { Button, Input, Modal, useRun } from './ui'

/** Forgotten password: a 6-digit code goes to the account's email, then a new password is set. */
export function ResetPasswordModal({ open, onClose, email: fixedEmail }: { open: boolean; onClose: () => void; email?: string }) {
  const run = useRun()
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email')
  const [email, setEmail] = useState(fixedEmail ?? '')
  const [token, setToken] = useState('')
  const [devCode, setDevCode] = useState<string | undefined>()
  const [f, setF] = useState({ code: '', next: '', again: '', show: false })
  useEffect(() => { if (open) { setStep('email'); setEmail(fixedEmail ?? ''); setToken(''); setDevCode(undefined); setF({ code: '', next: '', again: '', show: false }) } }, [open, fixedEmail])

  const send = async () => {
    const r = await run(() => requestPasswordReset(email))
    if (r && typeof r === 'object') { setToken(r.token); setDevCode(r.devCode); setStep('code') }
  }
  const reset = async () => { if (await run(() => resetPasswordWithCode(token, f.code, f.next, f.again), 'Password reset — you can sign in with it now')) setStep('done') }

  return (
    <Modal open={open} onClose={onClose} title="Reset your password" size="sm"
      footer={step === 'email' ? <><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon={Mail} onClick={send}>Send code</Button></>
        : step === 'code' ? <><Button variant="outline" onClick={() => setStep('email')}>Back</Button><Button icon={KeyRound} onClick={reset}>Reset password</Button></>
        : <Button onClick={onClose}>Done</Button>}>
      {step === 'email' && (
        <div className="grid gap-3">
          <Input label="Account email" type="email" value={email} disabled={!!fixedEmail} onChange={(e) => setEmail(e.target.value)} placeholder="you@rexera.co.in" autoFocus={!fixedEmail} />
          <p className="text-xs text-mute">We'll send a 6-digit code to this email. It is valid for 10 minutes.</p>
        </div>
      )}
      {step === 'code' && (
        <div className="grid gap-3">
          <p className="text-sm text-mute">If <b className="text-ink">{email}</b> has an account, a code has been sent to it.</p>
          {devCode && <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">Email isn't connected in this build yet, so the code is shown here: <b className="font-mono text-sm tracking-widest">{devCode}</b></p>}
          <Input label="6-digit code" inputMode="numeric" maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, '').slice(0, 6) })} autoFocus />
          <Input label="New password" type={f.show ? 'text' : 'password'} autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} hint={PASSWORD_HINT} />
          <Input label="Re-type new password" type={f.show ? 'text' : 'password'} autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} error={f.again && f.again !== f.next ? 'Does not match' : undefined} />
          <label className="flex items-center gap-2 text-xs text-mute"><input type="checkbox" checked={f.show} onChange={(e) => setF({ ...f, show: e.target.checked })} className="accent-[var(--brand)]" />Show password</label>
        </div>
      )}
      {step === 'done' && <p className="text-sm">Your password has been changed. Use the new one next time you sign in.</p>}
    </Modal>
  )
}
