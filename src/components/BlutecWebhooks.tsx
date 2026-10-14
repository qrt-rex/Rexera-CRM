import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Link2, RefreshCcw, Send, Webhook } from 'lucide-react'
import { CLOUD } from '../lib/cloud'
import { getSupabase } from '../lib/supabase'
import { fmtDateTime } from '../lib/format'
import { blutec, type WebhookConfig, type WebhookDelivery } from '../lib/dialer'
import { Badge, Button, Card, CardHeader, EmptyState, Table, Td, Th, useRun } from './ui'

type Delivery = { id: number; kind: 'ivr' | 'calls'; event: string; test: boolean; received_at: string; payload: Record<string, unknown> }

/** What a delivery was about, in a line. */
function about(d: Delivery) {
  const p = d.payload as { lead?: { phone?: string; custom_data?: { name?: string } }; ivr?: { name?: string }; payload?: { ref_id?: string; call?: { destination_number?: string; status?: string } } }
  if (d.kind === 'ivr') return `${p.lead?.custom_data?.name ?? 'Lead'} · ${p.lead?.phone ?? '—'}${p.ivr?.name ? ` · ${p.ivr.name}` : ''}`
  return `${p.payload?.call?.destination_number ?? '—'} · ${p.payload?.call?.status ?? ''}`
}

/**
 * Super Admin: the two Blutec webhook addresses to paste into Blutec, how to set them up, and what has arrived.
 * Deliveries are verified on the server (signing secrets in Render) and stored in Supabase.
 */
export function BlutecWebhooks() {
  const hooks = [
    { kind: 'ivr' as const, title: 'IVR · interested leads', where: 'Blutec IVR / OBD → Webhook', secret: 'BLUTEC_IVR_WEBHOOK_SECRET', what: 'A caller presses the key mapped to Interested → the lead is added here as a hot prospect (unassigned), or the existing lead is marked hot and its owner told.' },
    { kind: 'calls' as const, title: 'Dialer · call events', where: '', secret: 'BLUTEC_CALLS_WEBHOOK_SECRET', what: 'A CRM click-to-call ends → it is added to the lead’s call history with its duration and disposition, even if nobody saved the outcome.' },
  ]
  const [copied, setCopied] = useState('')
  const run = useRun()
  // the dialer webhook has no Blutec screen: it is set up here through Blutec's API
  const [dial, setDial] = useState<{ cfg?: WebhookConfig | null; log?: WebhookDelivery[]; error?: string }>({})
  const loadDial = useCallback(async () => {
    try {
      const [cfg, log] = await Promise.all([blutec.webhookGet(), blutec.webhookDeliveries().catch(() => [])])
      setDial({ cfg, log: Array.isArray(log) ? log : log?.items ?? [] })
    } catch (e) { setDial({ error: e instanceof Error ? e.message : 'Could not read the webhook from Blutec.' }) }
  }, [])
  useEffect(() => { void loadDial() }, [loadDial])
  const [list, setList] = useState<{ loading: boolean; rows: Delivery[]; error?: string }>({ loading: CLOUD, rows: [] })
  const load = useCallback(async () => {
    if (!CLOUD) return
    setList((x) => ({ ...x, loading: true }))
    const { data, error } = await (await getSupabase()).from('blutec_webhook_events').select('id, kind, event, test, received_at, payload').order('received_at', { ascending: false }).limit(30)
    setList({ loading: false, rows: (data ?? []) as Delivery[], error: error?.message })
  }, [])
  useEffect(() => { void load() }, [load])
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(''), 2000) } catch { /* the address is on screen to copy by hand */ } }

  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader title="Blutec webhooks" subtitle="Blutec sends events straight to the CRM — Super Admin only" icon={Webhook}
        action={CLOUD && <Button size="sm" variant="ghost" icon={RefreshCcw} onClick={load}>Refresh</Button>} />
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        {hooks.map((h) => {
          const url = `${location.origin}/api/blutec/webhook/${h.kind}`
          return (
            <div key={h.kind} className="space-y-2 rounded-2xl border border-line p-4 text-sm">
              <p className="font-bold">{h.title}</p>
              <p className="text-mute">{h.what}</p>
              <div className="flex items-center gap-2 rounded-xl bg-card2 px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-xs" title={url}>{url}</code>
                <Button size="sm" variant="ghost" icon={copied === url ? Check : Copy} onClick={() => copy(url)}>{copied === url ? 'Copied' : 'Copy'}</Button>
              </div>
              {h.kind === 'ivr' ? (
                <ol className="list-decimal space-y-0.5 pl-5 text-xs text-mute">
                  <li>In <b>{h.where}</b>, tick “Send interested leads”, paste this address and save.</li>
                  <li>Copy the <b>signing secret</b> Blutec shows there into Render → Environment as <code>{h.secret}</code> (redeploys the server).</li>
                  <li>Press <b>Send test</b> in Blutec: it appears below as a test delivery.</li>
                </ol>
              ) : (
                <div className="space-y-2 text-xs">
                  {dial.error ? <p className="text-bad">{dial.error}</p>
                    : dial.cfg === undefined ? <p className="text-mute">Checking Blutec…</p>
                      : <p>In Blutec: {dial.cfg?.url ? <><Badge tone={dial.cfg.url === url && dial.cfg.enabled !== false ? 'green' : 'amber'}>{dial.cfg.url === url && dial.cfg.enabled !== false ? 'connected' : dial.cfg.enabled === false ? 'switched off' : 'sends to another address'}</Badge> <span className="text-mute">{(dial.cfg.events ?? []).join(', ')}</span></> : <Badge tone="gray">not set up</Badge>}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" icon={Link2} onClick={async () => { if (await run(() => blutec.webhookConnect(url), 'Webhook connected in Blutec')) void loadDial() }}>{dial.cfg?.url === url ? 'Connect again' : 'Connect'}</Button>
                    <Button size="sm" variant="outline" icon={Send} disabled={dial.cfg?.url !== url} onClick={async () => { if (await run(() => blutec.webhookTest(), 'Test sent — it shows below in a few seconds')) setTimeout(() => { void load(); void loadDial() }, 4000) }}>Send test</Button>
                  </div>
                  <p className="text-mute">The signing secret is read from Blutec automatically (or set <code>{h.secret}</code> on Render).</p>
                  {(dial.log?.length ?? 0) > 0 && (
                    <details><summary className="cursor-pointer font-semibold">Blutec’s delivery log ({dial.log!.length})</summary>
                      <ul className="mt-1 space-y-0.5">{dial.log!.slice(0, 10).map((x, i) => <li key={i} className="flex justify-between gap-2"><span>{x.event_type} · {x.status}{x.response_code ? ` (${x.response_code})` : ''}</span><span className="text-mute">{x.created_at ? fmtDateTime(x.created_at) : ''}</span></li>)}</ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {!CLOUD ? <p className="border-t border-line p-4 text-sm text-mute">Deliveries are saved in Supabase: they show here once the CRM runs on Supabase (VITE_DATA_BACKEND=supabase).</p>
        : list.error ? <p className="border-t border-line p-4 text-sm text-bad">Could not read the deliveries: {list.error}</p>
          : !list.rows.length ? <div className="border-t border-line"><EmptyState icon={Webhook} title={list.loading ? 'Loading…' : 'Nothing received yet'} text="Set up a webhook above and press Send test in Blutec." /></div> : (
            <div className="border-t border-line">
              <Table>
                <thead><tr><Th>Received</Th><Th>Webhook</Th><Th>Event</Th><Th>About</Th></tr></thead>
                <tbody>
                  {list.rows.map((d) => (
                    <tr key={d.id}>
                      <Td className="text-xs">{fmtDateTime(d.received_at)}</Td>
                      <Td><Badge tone={d.kind === 'ivr' ? 'violet' : 'blue'}>{d.kind === 'ivr' ? 'IVR' : 'Dialer'}</Badge></Td>
                      <Td className="font-mono text-xs">{d.event}{d.test && <Badge tone="gray" className="ml-1.5">test</Badge>}</Td>
                      <Td className="text-xs">{about(d)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
    </Card>
  )
}
