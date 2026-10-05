import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, FileCheck2, FileText, Upload, X } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { addDocument, setDocStatus, userName, visibleBookings } from '../../lib/actions'
import { DOC_CATEGORIES } from '../../lib/workflow'
import { ago } from '../../lib/format'
import { Badge, Button, Card, CardHeader, EmptyState, FileButton, PageHeader, SearchBox, Select, Table, Tabs, Td, Th, readAsDataUrl, useRun } from '../../components/ui'

export default function Documents() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const bookings = visibleBookings(db, me).filter((b) => b.status !== 'REJECTED')
  const [bookingId, setBookingId] = useState('')
  const [cat, setCat] = useState(DOC_CATEGORIES[0]!)
  const [tab, setTab] = useState<'all' | 'PENDING' | 'VERIFIED' | 'REJECTED'>('PENDING')
  const [q, setQ] = useState('')
  const docs = useMemo(() => bookings.flatMap((b) => b.documents.map((d) => ({ ...d, b }))).sort((x, y) => y.at.localeCompare(x.at)), [bookings])
  const list = docs.filter((d) => (tab === 'all' || (d.status ?? 'PENDING') === tab) && (!q || `${d.name} ${d.b.companyName} ${d.category}`.toLowerCase().includes(q.toLowerCase())))
  const verifier = can('bookings.process', 'bookings.legal', 'bookings.admin')
  const missing = bookings.filter((b) => ['IN_OPERATIONS', 'PENDING_LEGAL'].includes(b.status) && !b.documents.some((d) => d.category === 'KYC'))

  const upload = async (f: File) => {
    if (!bookingId) return run(() => { throw new Error('Pick the client first.') })
    const dataUrl = f.size <= 400 * 1024 ? await readAsDataUrl(f) : undefined
    run(() => addDocument(me, bookingId, { name: f.name, category: cat, size: f.size, dataUrl }), 'Document uploaded')
  }

  return (
    <div>
      <PageHeader title="Document Forms" subtitle="Collect, upload and verify client documents" icon={FileText} />
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="Upload a client document" icon={Upload} />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <Select label="Client (CRM entry)" value={bookingId} onChange={(e) => setBookingId(e.target.value)} className="sm:col-span-2">
              <option value="">— Select —</option>{bookings.map((b) => <option key={b.id} value={b.id}>{b.bookingId} · {b.companyName}</option>)}
            </Select>
            <Select label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>{DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
            <div className="sm:col-span-3"><FileButton accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" onFile={upload}>
              <button className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line p-8 text-sm text-mute transition hover:border-brand hover:bg-brand-soft/40">
                <Upload className="size-7 text-brand-ink" /><b className="text-ink">Click to choose a file</b>PDF, image, Word or Excel · max 5 MB
              </button>
            </FileButton></div>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Missing KYC" subtitle="Active files without KYC documents" icon={FileCheck2} />
          <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto">
            {missing.map((b) => <li key={b.id} className="px-5 py-2.5"><Link to={`/bookings/${b.id}`} className="text-sm font-semibold hover:underline">{b.companyName}</Link><p className="text-xs text-mute">{b.bookingId} · {userName(db, b.opsMemberId ?? b.createdBy)}</p></li>)}
            {!missing.length && <li className="p-5 text-sm text-mute">All active files have KYC. 👍</li>}
          </ul>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'PENDING', label: 'To verify', count: docs.filter((d) => (d.status ?? 'PENDING') === 'PENDING').length }, { id: 'VERIFIED', label: 'Verified' }, { id: 'REJECTED', label: 'Rejected' }, { id: 'all', label: 'All', count: docs.length }]} />
          <SearchBox value={q} onChange={setQ} className="min-w-52 flex-1" />
        </div>
        {!list.length ? <EmptyState icon={FileText} title="No documents" /> : (
          <Table>
            <thead><tr><Th>Document</Th><Th>Client</Th><Th>Category</Th><Th>Uploaded</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <Td><span className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-info" />{d.name}</span></Td>
                  <Td><Link to={`/bookings/${d.b.id}`} className="hover:underline">{d.b.companyName}</Link></Td>
                  <Td>{d.category}</Td>
                  <Td className="text-xs text-mute">{userName(db, d.by)} · {ago(d.at)}</Td>
                  <Td><Badge tone={d.status === 'VERIFIED' ? 'green' : d.status === 'REJECTED' ? 'red' : 'amber'}>{(d.status ?? 'PENDING').toLowerCase()}</Badge></Td>
                  <Td className="text-right">{verifier && d.status !== 'VERIFIED' && <span className="inline-flex gap-1"><Button size="sm" variant="success" icon={Check} onClick={() => setDocStatus(me, d.b.id, d.id, 'VERIFIED')}>Verify</Button><Button size="sm" variant="ghost" icon={X} aria-label="Reject" onClick={() => setDocStatus(me, d.b.id, d.id, 'REJECTED')} /></span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
