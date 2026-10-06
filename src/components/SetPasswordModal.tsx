import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { User } from '../lib/types'
import { useMe } from '../lib/auth'
import { PASSWORD_HINT, PASSWORD_RULE, resetUserPassword } from '../lib/actions'
import { Button, Input, Modal, Select, useRun } from './ui'

/** HR / IT type a new password for someone (there is no shared default password). */
export function SetPasswordModal({ open, onClose, user, people }: { open: boolean; onClose: () => void; user?: User; people?: User[] }) {
  const me = useMe()
  const run = useRun()
  const [userId, setUserId] = useState(user?.id ?? '')
  const [pw, setPw] = useState({ password: '', confirm: '', show: false })
  const [tried, setTried] = useState(false)
  useEffect(() => { if (open) { setUserId(user?.id ?? ''); setPw({ password: '', confirm: '', show: false }); setTried(false) } }, [open, user?.id])
  const target = user ?? people?.find((p) => p.id === userId)
  const err = !PASSWORD_RULE.test(pw.password) ? PASSWORD_HINT : pw.password !== pw.confirm ? 'The two passwords do not match.' : ''
  const save = async () => {
    setTried(true)
    if (err || !target) return
    if (await run(() => resetUserPassword(me, target.id, pw.password), `New password set for ${target.name} — share it with them privately`)) onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Set a new password" subtitle={user ? `${user.name} · ${user.email}` : undefined} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon={KeyRound} disabled={!target} onClick={save}>Set password</Button></>}>
      <div className="grid gap-4">
        {!user && people && (
          <Select label="Person" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— Select —</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.email}{!p.passHash ? ' — no password yet (imported)' : ''}</option>)}
          </Select>
        )}
        <Input label="New password" required type={pw.show ? 'text' : 'password'} autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} hint={PASSWORD_HINT} error={tried && err === PASSWORD_HINT ? err : undefined} />
        <Input label="Confirm password" required type={pw.show ? 'text' : 'password'} autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} error={tried && err && err !== PASSWORD_HINT ? err : undefined} />
        <label className="flex items-center gap-2 text-xs text-mute"><input type="checkbox" checked={pw.show} onChange={(e) => setPw({ ...pw, show: e.target.checked })} className="accent-[var(--brand)]" />Show password</label>
        <p className="text-xs text-mute">They can change it later in Settings → Security. Super Admin passwords can only be set by a Super Admin.</p>
      </div>
    </Modal>
  )
}
