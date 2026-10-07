import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderKanban } from 'lucide-react'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { outcomeNeedsReason, userName, visibleBookings, WORK_STATUSES } from '../lib/actions'
import { STAGES } from '../lib/workflow'
import { ago } from '../lib/format'
import { Card, CardHeader, cx, SearchBox, usePaged } from './ui'
import { BookingStatusBadge, StageTrack } from './booking'
import { StageControls, StageText } from './StageControls'

/** Every file in processing with its stage, result and reason — shown to Legal and the Operation team. */
export function WorkProgressPanel({ title = 'Client work progress', className }: { title?: string; className?: string }) {
  const db = useDb()
  const me = useMe()
  const [stage, setStage] = useState<number | 'issues' | 0>(0)
  const [q, setQ] = useState('')
  const files = useMemo(() => visibleBookings(db, me).filter((b) => b.opsMemberId && [...WORK_STATUSES, 'ON_HOLD'].includes(b.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [db, me])
  const counts = useMemo(() => STAGES.map((_, i) => files.filter((b) => b.stage === i + 1).length), [files])
  const issues = files.filter((b) => outcomeNeedsReason(b.stageOutcome)).length
  const list = files.filter((b) => (stage === 0 || (stage === 'issues' ? outcomeNeedsReason(b.stageOutcome) : b.stage === stage))
    && (!q || `${b.companyName} ${b.bookingId} ${b.serviceName} ${userName(db, b.opsMemberId)} ${userName(db, b.adminId)}`.toLowerCase().includes(q.toLowerCase())))
  const { slice, pager } = usePaged(list, 15, [stage, q])
  const chip = (active: boolean, extra = '') => cx('shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition', active ? 'border-brand bg-brand text-white' : 'border-line hover:bg-card2', extra)

  return (
    <Card className={cx('overflow-hidden', className)}>
      <CardHeader title={title} subtitle={`${files.length} file(s) in processing · stages are updated by Admin and the Operation team`} icon={FolderKanban} />
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button onClick={() => setStage(0)} className={chip(stage === 0)}>All · {files.length}</button>
          {STAGES.map((s, i) => <button key={s} title={s} onClick={() => setStage(i + 1)} className={chip(stage === i + 1)}>{i + 1}. {s.split(' / ')[0]} · {counts[i]}</button>)}
          {issues > 0 && <button onClick={() => setStage('issues')} className={chip(stage === 'issues', stage === 'issues' ? '' : 'border-bad/40 text-bad')}>Rejected / re-submission / hold · {issues}</button>}
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Search client, booking ID, service, person…" />
      </div>
      <ul className="divide-y divide-line/70">
        {slice.map((b) => {
          const last = b.stageHistory[b.stageHistory.length - 1]
          return (
            <li key={b.id} className="px-5 py-3.5">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Link to={`/bookings/${b.id}`} className="font-bold hover:underline">{b.companyName}</Link>
                <span className="font-mono text-[11px] text-mute">{b.bookingId}</span>
                <BookingStatusBadge b={b} />
                <span className="ml-auto text-xs font-semibold"><StageText b={b} /></span>
              </div>
              <StageTrack b={b} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 text-xs text-mute">{b.serviceName} · Ops {userName(db, b.opsMemberId)}{b.adminId ? ` · Admin ${userName(db, b.adminId)}` : ''}{last ? ` · last move ${userName(db, last.by)} ${ago(last.at)}` : ''}</p>
                <StageControls b={b} />
              </div>
            </li>
          )
        })}
        {!list.length && <li className="px-5 py-8 text-center text-sm text-mute">No files here.</li>}
      </ul>
      {pager}
    </Card>
  )
}
