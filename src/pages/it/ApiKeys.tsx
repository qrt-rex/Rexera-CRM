import { useState } from 'react'
import { Ban, Check, Copy, KeyRound, Plus, RefreshCw, ShieldCheck, TestTube2 } from 'lucide-react'
import type { ApiScope } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { API_SCOPES, createApiKey, keyStatus, revokeApiKey, rotateApiKey, verifyApiKey } from '../../lib/itops'
import { fmtDate } from '../../lib/format'
import { Badge, Button, Card, Checkbox, EmptyState, Input, Modal, PageHeader, Select, Table, Td, Th, useConfirm, useRun, useToast } from '../../components/ui'

export default function ApiKeys() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const [confirm, confirmNode] = useConfirm()
  const [create, setCreate] = useState<{ name: string; scopes: ApiScope[]; days: string } | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [test, setTest] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)

  const show = (s: unknown) => { if (typeof s === 'string') { setSecret(s); setCopied(false) } }
  const copy = () => secret && navigator.clipboard?.writeText(secret).then(() => { setCopied(true); toast('success', 'Key copied') }, () => toast('error', 'Copy blocked — select and copy it manually'))

  return (
    <div>
      <PageHeader title="API Keys" subtitle="Keys for integrations — website lead forms, ad platforms, IVR, accounting tools" icon={KeyRound}
        actions={<Button variant="accent" icon={Plus} onClick={() => setCreate({ name: '', scopes: ['leads:write'], days: '365' })}>New API key</Button>} />

      <Card className="mb-5 flex flex-wrap items-center gap-3 p-4 text-sm">
        <ShieldCheck className="size-5 text-ok" />
        <p className="min-w-0 flex-1 text-mute">A key is shown <b className="text-ink">once</b> when created. Only a fingerprint (SHA-256) is stored, so a lost key can't be recovered — rotate it instead. This build has no server yet; keys are ready for when the API backend is connected.</p>
      </Card>

      <Card className="overflow-hidden">
        {!db.apiKeys.length ? <EmptyState icon={KeyRound} title="No API keys yet" text="Create one for each integration so it can be revoked on its own." /> : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Key</Th><Th>Permissions</Th><Th>Created</Th><Th>Expires</Th><Th>Status</Th><Th className="text-right" /></tr></thead>
            <tbody>{db.apiKeys.map((k) => {
              const st = keyStatus(k)
              return (
                <tr key={k.id} className={st !== 'active' ? 'opacity-60' : ''}>
                  <Td className="font-semibold">{k.name}</Td>
                  <Td className="font-mono text-xs">{k.prefix}…</Td>
                  <Td><span className="flex max-w-72 flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s} tone="navy">{s}</Badge>)}</span></Td>
                  <Td className="text-xs text-mute">{fmtDate(k.createdAt)} · {userName(db, k.createdBy)}</Td>
                  <Td className="text-xs">{k.expiresAt ? fmtDate(k.expiresAt) : 'Never'}</Td>
                  <Td><Badge tone={st === 'active' ? 'green' : st === 'expired' ? 'amber' : 'red'}>{st}</Badge></Td>
                  <Td className="text-right"><span className="inline-flex gap-1">
                    <Button size="sm" variant="soft" icon={RefreshCw} onClick={async () => { if (await confirm('Rotate this key?', `“${k.name}” stops working now and a new key is issued with the same permissions.`)) show(await run(() => rotateApiKey(me, k.id), 'New key issued')) }}>Rotate</Button>
                    {st === 'active' && <Button size="sm" variant="ghost" icon={Ban} className="text-bad" onClick={async () => { if (await confirm('Revoke this key?', `Anything using “${k.name}” stops working immediately.`, true)) run(() => revokeApiKey(me, k.id), 'Key revoked') }}>Revoke</Button>}
                  </span></Td>
                </tr>
              )
            })}</tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-5 p-5">
        <p className="mb-3 flex items-center gap-2 font-bold"><TestTube2 className="size-4" />Check a key</p>
        <div className="flex flex-wrap gap-2">
          <input value={test} onChange={(e) => { setTest(e.target.value); setTestResult(null) }} placeholder="rx_live_…" className="h-10 min-w-64 flex-1 rounded-xl border border-line bg-card px-3 font-mono text-sm" aria-label="Key to check" />
          <Button variant="outline" disabled={!test.trim()} onClick={async () => {
            const r = await verifyApiKey(test)
            setTestResult(r.ok ? `✅ Valid — “${r.key.name}” · ${r.key.scopes.join(', ')}` : `❌ ${r.reason}${r.key ? ` — “${r.key.name}”` : ''}`)
          }}>Check</Button>
        </div>
        {testResult && <p className="mt-2 text-sm">{testResult}</p>}
      </Card>

      <Modal open={!!create} onClose={() => setCreate(null)} title="New API key"
        footer={<><Button variant="outline" onClick={() => setCreate(null)}>Cancel</Button><Button icon={KeyRound} onClick={async () => {
          if (!create) return
          const s = await run(() => createApiKey(me, { name: create.name, scopes: create.scopes, days: create.days === 'never' ? null : Number(create.days) }))
          if (typeof s === 'string') { setCreate(null); show(s) }
        }}>Create key</Button></>}>
        {create && <div className="grid gap-4">
          <Input label="Name" required value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} placeholder="e.g. Website contact form" autoFocus />
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-mute">Permissions</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {API_SCOPES.map((s) => <Checkbox key={s.id} checked={create.scopes.includes(s.id)} label={<span><b className="font-mono text-xs">{s.id}</b> <span className="text-mute">· {s.label}</span></span>} onChange={(v) => setCreate({ ...create, scopes: v ? [...create.scopes, s.id] : create.scopes.filter((x) => x !== s.id) })} />)}
            </div>
          </div>
          <Select label="Expires" value={create.days} onChange={(e) => setCreate({ ...create, days: e.target.value })}>
            <option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In 1 year</option><option value="never">Never</option>
          </Select>
        </div>}
      </Modal>

      <Modal open={!!secret} onClose={() => setSecret(null)} title="Copy your new key now" subtitle="It won't be shown again."
        footer={<Button onClick={() => setSecret(null)}>{copied ? 'Done' : "I've saved it"}</Button>}>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-card2 p-3">
          <code className="min-w-0 flex-1 select-all break-all font-mono text-sm">{secret}</code>
          <Button size="sm" variant={copied ? 'success' : 'primary'} icon={copied ? Check : Copy} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>
        <p className="mt-3 text-xs text-mute">Store it in the integration's secret settings or a password manager. Never put it in a website's public code.</p>
      </Modal>
      {confirmNode}
    </div>
  )
}
