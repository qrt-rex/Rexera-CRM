import { useCallback, useEffect, useState } from 'react'
import { ListChecks, RefreshCcw, Users } from 'lucide-react'
import { blutec } from '../lib/dialer'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { leadTakers, setCampaignAgents, userName } from '../lib/actions'
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, Modal, Table, Td, Th, useRun } from './ui'

type Row = Record<string, unknown>
/** A count Blutec may name in a few ways; null when it doesn't send it (shown as —). */
const count = (r: Row, ...names: string[]) => { for (const n of names) { const v = Number(r[n]); if (r[n] != null && Number.isFinite(v)) return v } return null }
const show = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-IN'))

/** Blutec's dialer campaigns with their lead counts (Super Admin): the numbers the Blutec dialer shows. */
export function DialerCampaigns() {
  const db = useDb()
  const [assign, setAssign] = useState<Row | null>(null)
  const agentsOf = (id: unknown) => db.settings.dialerCampaigns?.[String(id)] ?? []
  const [state, setState] = useState<{ loading: boolean; rows: Row[]; error?: string }>({ loading: true, rows: [] })
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }))
    blutec.campaigns().then((rows) => setState({ loading: false, rows: rows as unknown as Row[] }), (e: Error) => setState({ loading: false, rows: [], error: e.message }))
  }, [])
  useEffect(load, [load])
  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader title="Dialer campaigns" subtitle="Blutec dialer campaigns and their leads (separate from the IVR broadcasts above)" icon={ListChecks}
        action={<Button size="sm" variant="ghost" icon={RefreshCcw} onClick={load}>Refresh</Button>} />
      {state.error ? <p className="p-4 text-sm text-bad">{state.error}</p>
        : !state.rows.length ? <EmptyState icon={ListChecks} title={state.loading ? 'Loading…' : 'No dialer campaigns'} />
          : (
            <Table>
              <thead><tr><Th>Campaign</Th><Th className="text-right">Total</Th><Th className="text-right">Fresh</Th><Th className="text-right">Used</Th><Th className="text-right">Recycled</Th><Th className="text-right">Agents</Th><Th className="text-right">Lead lists</Th><Th className="text-right">DIDs</Th><Th>Sales people</Th></tr></thead>
              <tbody>
                {state.rows.map((r) => {
                  const total = count(r, 'total_leads', 'totalLeads', 'total'), fresh = count(r, 'fresh_leads', 'freshLeads', 'fresh')
                  return (
                    <tr key={String(r.id)}>
                      <Td><span className="font-semibold">{String(r.name ?? '—')}</span> <Badge tone={r.status === 'active' ? 'green' : 'gray'}>{String(r.status ?? '')}</Badge></Td>
                      <Td className="text-right font-bold tabular-nums">{show(total)}</Td>
                      <Td className="text-right tabular-nums text-ok">{show(fresh)}</Td>
                      <Td className="text-right tabular-nums text-info">{show(count(r, 'used_leads', 'usedLeads', 'used'))}</Td>
                      <Td className="text-right tabular-nums text-warn">{show(count(r, 'recycled_leads', 'recycledLeads', 'recycled'))}</Td>
                      <Td className="text-right tabular-nums">{show(count(r, 'user_count', 'agent_count', 'agents'))}</Td>
                      <Td className="text-right tabular-nums">{show(count(r, 'lead_list_count', 'leadListCount'))}</Td>
                      <Td className="text-right tabular-nums">{show(count(r, 'did_count', 'dids_count', 'dids'))}</Td>
                      <Td><Button size="sm" variant="ghost" icon={Users} onClick={() => setAssign(r)} title={agentsOf(r.id).map((id) => userName(db, id)).join(', ') || undefined}>
                        {agentsOf(r.id).length ? `${agentsOf(r.id).length} assigned` : 'Assign'}</Button></Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
      {assign && <AssignAgents campaign={assign} onClose={() => setAssign(null)} />}
    </Card>
  )
}

/** Who works a campaign: it shows under "Your campaigns" on their dialer dashboard (and nobody else's). */
function AssignAgents({ campaign, onClose }: { campaign: Row; onClose: () => void }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [ids, setIds] = useState<string[]>(() => db.settings.dialerCampaigns?.[String(campaign.id)] ?? [])
  const save = async () => { if (await run(() => setCampaignAgents(me, Number(campaign.id), ids), 'Campaign assignment saved')) onClose() }
  return (
    <Modal open onClose={onClose} title={`Sales people · ${String(campaign.name ?? '')}`} subtitle="They see this campaign under “Your campaigns” on their dialer dashboard"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-2 sm:grid-cols-2">
        {leadTakers(db).map((u) => <Checkbox key={u.id} label={u.name} checked={ids.includes(u.id)} onChange={(v) => setIds((x) => (v ? [...x, u.id] : x.filter((y) => y !== u.id)))} />)}
      </div>
    </Modal>
  )
}
