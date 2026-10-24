import { useCallback, useEffect, useMemo, useState } from 'react'
import { Globe, Link2, RefreshCw, ShieldOff, ShieldCheck } from 'lucide-react'
import { Badge, Button, Card, EmptyState, IconButton, Modal, PageHeader, SearchBox, Table, Td, Th, useRun } from '../../components/ui'
import { cloudConfig, getSupabase } from '../../lib/supabase'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { visibleBookings } from '../../lib/actions'
import { fmtDateTime } from '../../lib/format'

/** Client accounts on the website portal: approve the ones whose email matched no file, link files, pause access. */
type Client = {
  auth_user_id: string; name: string; email: string; phone: string | null; status: 'PENDING' | 'ACTIVE' | 'SUSPENDED'; created_at: string
  portal_client_bookings: { booking_id: string }[]
}

export default function PortalClients() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [clients, setClients] = useState<Client[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'PENDING' | 'ALL'>('PENDING')
  const [linkFor, setLinkFor] = useState<Client | null>(null)
  const [fileQ, setFileQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error: e } = await (await getSupabase()).from('portal_clients')
        .select('auth_user_id, name, email, phone, status, created_at, portal_client_bookings(booking_id)').order('created_at', { ascending: false })
      if (e) throw new Error(/does not exist|schema cache/i.test(e.message) ? 'The client portal tables are not set up yet (run the client portal migration).' : e.message)
      setClients((data ?? []) as Client[])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { if (cloudConfig().status === 'ready') void load(); else setLoading(false) }, [load])

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { error: e } = await (await getSupabase()).rpc(fn, args)
    if (e) throw new Error(e.message)
  }

  const bookings = useMemo(() => visibleBookings(db, me), [db, me])
  const codeOf = (id: string) => bookings.find((b) => b.id === id)?.bookingId ?? id.slice(0, 8)
  const shown = clients.filter((c) => (only === 'ALL' || c.status === 'PENDING') && `${c.name} ${c.email} ${c.phone ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const matches = bookings.filter((b) => `${b.bookingId} ${b.companyName} ${b.contactPerson} ${b.email ?? ''} ${b.mobile}`.toLowerCase().includes(fileQ.toLowerCase())).slice(0, 20)

  if (cloudConfig().status !== 'ready') return <Card><EmptyState icon={Globe} title="Needs the cloud database" text="The client portal works with Supabase only." /></Card>

  return (
    <div>
      <PageHeader title="Portal clients" subtitle="Client accounts on rexera.co.in/portal. Accounts whose email matches a CRM entry are linked automatically; the rest wait here." icon={Globe}
        actions={<IconButton icon={RefreshCw} label="Refresh" onClick={() => void load()} />} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <SearchBox value={q} onChange={setQ} placeholder="Search name, email or phone" className="w-full max-w-sm" />
          <div className="flex gap-1">
            {(['PENDING', 'ALL'] as const).map((k) => (
              <Button key={k} size="sm" variant={only === k ? 'primary' : 'ghost'} onClick={() => setOnly(k)}>
                {k === 'PENDING' ? `Waiting (${clients.filter((c) => c.status === 'PENDING').length})` : `All (${clients.length})`}
              </Button>
            ))}
          </div>
        </div>
        {error ? <p className="m-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>
          : loading ? <p className="p-5 text-sm text-mute">Loading…</p>
          : !shown.length ? <EmptyState icon={Globe} title={only === 'PENDING' ? 'Nobody is waiting' : 'No client accounts yet'} text="New registrations appear here when their email matches no CRM entry." />
          : (
            <Table>
              <thead><tr><Th>Client</Th><Th>Registered</Th><Th>Files</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.auth_user_id}>
                    <Td><p className="font-semibold">{c.name}</p><p className="text-xs text-mute">{c.email}{c.phone ? ` · ${c.phone}` : ''}</p></Td>
                    <Td className="text-xs">{fmtDateTime(c.created_at)}</Td>
                    <Td className="text-xs">{c.portal_client_bookings.length ? c.portal_client_bookings.map((l) => codeOf(l.booking_id)).join(', ') : <span className="text-mute">none</span>}</Td>
                    <Td><Badge tone={c.status === 'ACTIVE' ? 'green' : c.status === 'SUSPENDED' ? 'red' : 'amber'}>{c.status.toLowerCase()}</Badge></Td>
                    <Td>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="outline" icon={Link2} onClick={() => { setLinkFor(c); setFileQ(c.email) }}>Link file</Button>
                        {c.status === 'SUSPENDED'
                          ? <Button size="sm" variant="ghost" icon={ShieldCheck} onClick={() => void run(async () => { await rpc('portal_staff_set_status', { p_client: c.auth_user_id, p_status: c.portal_client_bookings.length ? 'ACTIVE' : 'PENDING' }); await load() }, 'Access restored')}>Restore</Button>
                          : <Button size="sm" variant="ghost" icon={ShieldOff} onClick={() => confirm(`Pause portal access for ${c.name}?`) && void run(async () => { await rpc('portal_staff_set_status', { p_client: c.auth_user_id, p_status: 'SUSPENDED' }); await load() }, 'Access paused')}>Pause</Button>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
      </Card>

      <Modal open={!!linkFor} onClose={() => setLinkFor(null)} title={`Link a file to ${linkFor?.name ?? ''}`} subtitle="Only link files that belong to this client. They will see its progress and shared documents.">
        <SearchBox value={fileQ} onChange={setFileQ} placeholder="Search CRM entries" className="mb-3 w-full" />
        {!matches.length ? <p className="text-sm text-mute">No matching CRM entries you can see.</p> : (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {matches.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{b.companyName}</p>
                  <p className="truncate text-xs text-mute">{b.bookingId} · {b.contactPerson} · {b.email || 'no email'} · {b.mobile}</p>
                </div>
                <Button size="sm" icon={Link2} disabled={linkFor?.portal_client_bookings.some((l) => l.booking_id === b.id)}
                  onClick={() => linkFor && void run(async () => { await rpc('portal_staff_link', { p_client: linkFor.auth_user_id, p_booking: b.id }); setLinkFor(null); await load() }, 'File linked; the client can see it now')}>Link</Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  )
}
