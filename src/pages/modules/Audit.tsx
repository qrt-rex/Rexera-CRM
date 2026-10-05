import { useState } from 'react'
import { Download, ScrollText } from 'lucide-react'
import { useDb } from '../../lib/store'
import { userName } from '../../lib/actions'
import { downloadCsv, fmtDateTime, today } from '../../lib/format'
import { Badge, Button, Card, EmptyState, PageHeader, SearchBox, Table, Td, Th } from '../../components/ui'

export default function Audit() {
  const db = useDb()
  const [q, setQ] = useState('')
  const [action, setAction] = useState('')
  const actions = [...new Set(db.audit.map((a) => a.action))].sort()
  const list = db.audit.filter((a) => (!action || a.action === action) && (!q || `${a.detail} ${userName(db, a.by)}`.toLowerCase().includes(q.toLowerCase())))
  return (
    <div>
      <PageHeader title="Activity Log" subtitle="Sign-ins, approvals, payments, access changes and deletions" icon={ScrollText}
        actions={<Button variant="outline" icon={Download} onClick={() => downloadCsv(`activity-${today()}.csv`, list.map((a) => ({ at: a.at, by: userName(db, a.by), action: a.action, detail: a.detail })))}>Export</Button>} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <SearchBox value={q} onChange={setQ} className="min-w-60 flex-1" />
          <select value={action} onChange={(e) => setAction(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-3 text-sm" aria-label="Action"><option value="">All actions</option>{actions.map((a) => <option key={a}>{a}</option>)}</select>
        </div>
        {!list.length ? <EmptyState icon={ScrollText} title="No activity" /> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Detail</Th></tr></thead>
            <tbody>{list.slice(0, 300).map((a) => <tr key={a.id}><Td className="whitespace-nowrap text-xs text-mute">{fmtDateTime(a.at)}</Td><Td className="font-semibold">{userName(db, a.by)}</Td><Td><Badge tone={a.action.includes('REJECT') || a.action.includes('DELETE') ? 'red' : a.action.includes('ACCESS') || a.action.includes('ROLE') ? 'violet' : 'navy'}>{a.action}</Badge></Td><Td className="text-sm">{a.detail}</Td></tr>)}</tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
