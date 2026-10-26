import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Clapperboard } from 'lucide-react'
import { useDb } from '../lib/store'
import { useMe } from '../lib/auth'
import { companyMedia } from '../lib/media'
import { openFile } from '../lib/files'
import { ago } from '../lib/format'
import { mediaTypeLabel } from '../../supabase/media-rules.mjs'
import { MediaPreview } from './MediaPreview'
import { Badge, Card, CardHeader, Modal, useToast } from './ui'

/**
 * Company media on every staff dashboard: the posts, flyers and videos published as Internal in the Digital Media
 * Dashboard (one record, shown here — nothing to upload twice). Hidden when there is none or the person may not see it.
 */
export function MediaFeed() {
  const db = useDb()
  const me = useMe()
  const toast = useToast()
  const [open, setOpen] = useState<string | null>(null)
  const list = companyMedia(db, me)
  if (!list.length) return null
  const m = list.find((x) => x.id === open)
  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader title="Company media" subtitle="Latest posts, flyers and videos from the Digital Media team" icon={Clapperboard}
        action={<Link to="/digital-media" className="text-xs font-semibold text-brand-ink hover:underline">Digital Media Dashboard</Link>} />
      <ul className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {list.slice(0, 8).map((x) => (
          <li key={x.id}>
            <button type="button" onClick={() => setOpen(x.id)} className="w-full rounded-xl border border-line p-2 text-left transition hover:border-brand/40 hover:shadow-pop">
              <MediaPreview file={x.files[0]!} compact className="aspect-video w-full" />
              <p className="mt-2 truncate text-sm font-semibold">{x.title}</p>
              <p className="flex items-center gap-1.5 text-[11px] text-mute"><Badge tone="orange">{mediaTypeLabel(x.mediaType)}</Badge><span className="truncate">{x.schemeName} · {ago(x.submittedAt ?? x.createdAt)}</span></p>
            </button>
          </li>
        ))}
      </ul>
      {m && (
        <Modal open onClose={() => setOpen(null)} size="lg" title={m.title} subtitle={`${m.schemeName} · ${mediaTypeLabel(m.mediaType)}`}>
          <div className="space-y-3">
            {m.files.map((f) => (
              <div key={f.id}>
                <MediaPreview file={f} className="max-h-[420px] w-full" />
                <p className="mt-1 flex gap-3 text-xs"><b className="min-w-0 flex-1 truncate">{f.name}</b>
                  <button type="button" className="font-semibold text-brand-ink hover:underline" onClick={() => openFile(f, true).catch((e) => toast('error', e.message))}>Download</button></p>
              </div>
            ))}
            {m.description && <p className="whitespace-pre-line text-sm">{m.description}</p>}
          </div>
        </Modal>
      )}
    </Card>
  )
}
