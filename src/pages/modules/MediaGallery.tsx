import { useState } from 'react'
import { Images, Megaphone, Plus } from 'lucide-react'
import type { FileRef, MediaItem } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { canManageMedia, visibleMedia } from '../../lib/media'
import { deleteFile } from '../../lib/files'
import { ago, fmtDate } from '../../lib/format'
import { isLive, mediaTypeLabel, UPLOAD_STATUS, uploadStatus, WORK_STATUS, workStatus } from '../../../supabase/media-rules.mjs'
import { MediaPreview } from '../../components/MediaPreview'
import { Badge, Button, Card, EmptyState, PageHeader, SearchBox, Tabs, useRun, useToast } from '../../components/ui'
import { DetailsModal, emptyForm, formOf, MediaFormModal } from './DigitalMedia'
import type { MediaForm } from '../../lib/media'

const KIND = {
  POST: { title: 'Posts', one: 'post', icon: Megaphone, types: ['POST'] as MediaItem['mediaType'][], desc: 'Every post created in the Digital Media Dashboard' },
  FLYER: { title: 'Flyers', one: 'flyer', icon: Images, types: ['FLYER', 'POSTER'] as MediaItem['mediaType'][], desc: 'Every flyer and poster created in the Digital Media Dashboard' },
}
type Show = 'all' | 'published' | 'draft'

/**
 * Digital Media → Posts / Flyers: every post (or flyer / poster) from the Media Function, the moment it is created —
 * the same records, nothing uploaded twice. Create one here too (the form opens with the type set).
 */
export default function MediaGallery({ kind }: { kind: 'POST' | 'FLYER' }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const k = KIND[kind]
  const manage = canManageMedia(me)
  const [q, setQ] = useState('')
  const [show, setShow] = useState<Show>('all')
  const [form, setForm] = useState<{ id?: string; data: MediaForm; files: FileRef[]; submitted?: boolean } | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const all = visibleMedia(db, me).filter((m) => k.types.includes(m.mediaType)).sort((a, b) => b.serial - a.serial)
  const ql = q.trim().toLowerCase()
  const list = all.filter((m) => (show === 'all' || (show === 'published' ? m.submitted : !m.submitted)) && (!ql || `${m.title} ${m.schemeName} ${m.description}`.toLowerCase().includes(ql)))
  const open = all.find((m) => m.id === detail) ?? null

  return (
    <div>
      <PageHeader title={k.title} subtitle={k.desc} icon={k.icon}
        actions={manage && <Button icon={Plus} onClick={() => setForm({ data: emptyForm(kind), files: [] })}>Create {k.one}</Button>} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Tabs className="w-fit max-w-full" value={show} onChange={setShow} tabs={[
          { id: 'all', label: 'All', count: all.length }, { id: 'published', label: 'Published', count: all.filter((m) => m.submitted).length }, { id: 'draft', label: 'Drafts', count: all.filter((m) => !m.submitted).length },
        ]} />
        <SearchBox value={q} onChange={setQ} placeholder={`Search ${k.title.toLowerCase()}…`} className="min-w-56 flex-1" />
      </div>
      {!list.length ? <Card><EmptyState icon={k.icon} title={all.length ? 'Nothing matches' : `No ${k.title.toLowerCase()} yet`} text={all.length ? 'Change the search or filter.' : `Every ${k.one} created in the Digital Media Dashboard appears here.`} /></Card> : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => {
            const u = UPLOAD_STATUS[uploadStatus(m)], w = WORK_STATUS[workStatus(m)]
            return (
              <Card key={m.id} className="overflow-hidden">
                <button type="button" className="block w-full text-left" onClick={() => setDetail(m.id)}>
                  {m.files[0] ? <MediaPreview file={m.files[0]} compact className="aspect-square w-full rounded-none border-0" />
                    : <div className="grid aspect-square w-full place-items-center bg-card2 text-sm text-mute">No file uploaded yet</div>}
                </button>
                <div className="p-4">
                  <p className="flex items-center gap-2"><span className="font-mono text-xs text-mute">#{m.serial}</span><b className="min-w-0 flex-1 truncate">{m.title}</b></p>
                  <p className="truncate text-xs text-mute">{m.schemeName} · {mediaTypeLabel(m.mediaType)} · {ago(m.updatedAt)}</p>
                  {m.description && <p className="mt-1 line-clamp-2 text-sm">{m.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.submitted ? <Badge tone="blue">{isLive(m) ? 'Published' : 'Published · needs a file'}{m.internal && m.external ? ' · company + clients' : m.external ? ' · clients' : ' · company'}</Badge> : <Badge tone="gray">Draft</Badge>}
                    <Badge tone={u.tone}>{u.label}</Badge><Badge tone={w.tone}>{w.label}</Badge>
                  </div>
                  <p className="mt-2 text-[11px] text-mute">{m.assignedTo ? `${userName(db, m.assignedTo)}` : 'Not assigned'}{m.assignDate ? ` · due ${fmtDate(m.assignDate)}${m.assignTime ? ` ${m.assignTime}` : ''}` : ''}</p>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {form && <MediaFormModal form={form} onClose={async (stored) => { for (const f of stored) await deleteFile(f.id).catch(() => undefined); setForm(null) }} onSaved={(id) => { setForm(null); setDetail(id) }} />}
      {open && <DetailsModal m={open} onClose={() => setDetail(null)} onEdit={() => { setForm({ id: open.id, data: formOf(open), files: [], submitted: open.submitted }); setDetail(null) }} run={run} toast={toast} />}
    </div>
  )
}
