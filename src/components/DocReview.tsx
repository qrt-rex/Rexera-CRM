import { Check, X } from 'lucide-react'
import type { BDoc } from '../lib/types'
import { useDb } from '../lib/store'
import { useAuth, useMe } from '../lib/auth'
import { canReviewDoc, setDocStatus, userName } from '../lib/actions'
import { fmtDateTime } from '../lib/format'
import { Badge, Button, useRun } from './ui'

/**
 * A client document's status, who verified / rejected it and when, and the Verify / Reject buttons. Once decided
 * it is final for the person who decided it — only a Super Admin can change it.
 */
export function DocReview({ bookingId, doc, compact }: { bookingId: string; doc: BDoc; compact?: boolean }) {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const status = doc.status ?? 'PENDING'
  const may = can('bookings.process', 'bookings.legal', 'bookings.admin') && canReviewDoc(me, doc)
  const set = (s: 'VERIFIED' | 'REJECTED') => run(() => setDocStatus(me, bookingId, doc.id, s), s === 'VERIFIED' ? 'Document verified' : 'Document rejected')
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={status === 'VERIFIED' ? 'green' : status === 'REJECTED' ? 'red' : 'amber'}>{status.toLowerCase()}</Badge>
      {doc.reviewedBy && status !== 'PENDING' && <span className="text-[11px] text-mute">by <b className="text-ink">{userName(db, doc.reviewedBy)}</b>{doc.reviewedAt ? ` · ${fmtDateTime(doc.reviewedAt)}` : ''}</span>}
      {may && status !== 'VERIFIED' && (compact
        ? <button className="text-[11px] font-semibold text-ok hover:underline" onClick={() => set('VERIFIED')}>Verify</button>
        : <Button size="sm" variant="success" icon={Check} onClick={() => set('VERIFIED')}>Verify</Button>)}
      {may && status !== 'REJECTED' && (compact
        ? <button className="text-[11px] font-semibold text-bad hover:underline" onClick={() => set('REJECTED')}>Reject</button>
        : <Button size="sm" variant="ghost" icon={X} onClick={() => set('REJECTED')}>Reject</Button>)}
    </span>
  )
}
