import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Copy, Download, Eye, FileDown, ImageDown, Images, Lightbulb, Megaphone, Pencil, Pin, Plus, Trash2 } from 'lucide-react'
import type { Post } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { deletePost, upsertPost, userName } from '../../lib/actions'
import { ago } from '../../lib/format'
import { Badge, Button, Card, cx, EmptyState, Input, Menu, MenuItem, Modal, PageHeader, Select, Tabs, Textarea, useConfirm, useRun, useToast, Checkbox } from '../../components/ui'
import { downloadFlyerJpeg, downloadFlyerPdf } from '../../lib/flyer'
import { Mark } from '../../components/Logo'

const THEMES: Record<string, string> = {
  navy: 'from-[#2E3A8C] to-[#4b5bc4] text-white', orange: 'from-[#F47B20] to-[#F4A12A] text-white', violet: 'from-[#6D28D9] to-[#a855f7] text-white',
  green: 'from-[#047857] to-[#10b981] text-white', gray: 'from-[#1f2937] to-[#4b5563] text-white',
}
type Kind = Post['kind']

export default function Content() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const toast = useToast()
  const [confirm, node] = useConfirm()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Kind) || 'FLYER'
  const manage = can('content.manage')
  const [edit, setEdit] = useState<(Omit<Post, 'id' | 'createdAt' | 'by'> & { id?: string }) | null>(null)
  const list = db.posts.filter((p) => p.kind === tab).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt.localeCompare(a.createdAt))

  const share = (p: Post) => { navigator.clipboard?.writeText(`${p.title}\n\n${p.body}\n\n— Rexera Financial Services`).then(() => toast('success', 'Copied — paste it into WhatsApp or email'), () => toast('error', 'Copy blocked by the browser')) }
  return (
    <div>
      <PageHeader title="Flyers, Posts & Sales Info" subtitle={manage ? 'Create material — sales teams are notified' : 'Ready-to-share material (view only)'} icon={Images}
        actions={<>{!manage && <Badge tone="gray"><Eye className="size-3" />View only</Badge>}{manage && <Button variant="accent" icon={Plus} onClick={() => setEdit({ kind: tab, title: '', body: '', theme: 'navy', pinned: false })}>New {tab === 'SALES_INFO' ? 'sales info' : tab.toLowerCase()}</Button>}</>} />
      <Tabs className="mb-5 w-fit" value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { id: 'FLYER', label: 'Flyers', icon: Images, count: db.posts.filter((p) => p.kind === 'FLYER').length },
        { id: 'POST', label: 'Posts', icon: Megaphone, count: db.posts.filter((p) => p.kind === 'POST').length },
        { id: 'SALES_INFO', label: 'Sales information', icon: Lightbulb, count: db.posts.filter((p) => p.kind === 'SALES_INFO').length },
      ]} />
      {!list.length ? <Card><EmptyState icon={Images} title="Nothing here yet" /></Card> : tab === 'SALES_INFO' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex items-start gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent"><Lightbulb className="size-5" /></span>
                <div className="min-w-0 flex-1"><h3 className="font-bold">{p.title}</h3><p className="text-xs text-mute">{userName(db, p.by)} · {ago(p.createdAt)}</p></div>
                <Actions p={p} manage={manage} onEdit={() => setEdit(p)} onDelete={async () => { if (await confirm('Delete?', p.title, true)) run(() => deletePost(me, p.id)) }} onShare={() => share(p)} />
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{p.body}</p>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <div className={cx('relative aspect-square bg-gradient-to-br p-6', THEMES[p.theme] ?? THEMES.navy)}>
                <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-white/10" />
                <p className="flex items-center gap-2 text-xs font-bold tracking-[0.3em] opacity-90"><span className="grid size-7 place-items-center rounded-lg bg-white"><Mark className="h-4" fixed /></span>REXERA</p>
                <h3 className="mt-6 text-2xl font-extrabold leading-tight">{p.title}</h3>
                <p className="mt-3 text-sm opacity-90">{p.body}</p>
                <p className="absolute bottom-5 left-6 text-[11px] opacity-75">rexera.co.in</p>
                {p.pinned && <Pin className="absolute right-4 top-4 size-4" />}
              </div>
              <div className="flex items-center gap-2 p-4">
                <p className="min-w-0 flex-1 truncate text-xs text-mute">{userName(db, p.by)} · {ago(p.createdAt)}</p>
                <Menu width="w-48" trigger={(o) => <Button size="sm" variant="ghost" icon={Download} aria-label="Download" aria-expanded={o} />}>
                  {(close) => <>
                    <MenuItem icon={ImageDown} onClick={() => { close(); run(() => downloadFlyerJpeg(p), 'JPEG downloaded') }}>Download JPEG</MenuItem>
                    <MenuItem icon={FileDown} onClick={() => { close(); run(() => downloadFlyerPdf(p), 'PDF downloaded') }}>Download PDF</MenuItem>
                  </>}
                </Menu>
                <Actions p={p} manage={manage} onEdit={() => setEdit(p)} onDelete={async () => { if (await confirm('Delete?', p.title, true)) run(() => deletePost(me, p.id)) }} onShare={() => share(p)} />
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit' : 'Create'}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={async () => { if (edit && await run(() => upsertPost(me, edit), 'Saved')) setEdit(null) }}>Save</Button></>}>
        {edit && <div className="grid gap-4">
          <Select label="Type" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Kind })}><option value="FLYER">Flyer</option><option value="POST">Post</option><option value="SALES_INFO">Sales information</option></Select>
          <Input label="Title" required value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <Textarea label="Text" rows={5} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          <div><span className="mb-1.5 block text-xs font-semibold text-mute">Theme</span><div className="flex gap-2">{Object.keys(THEMES).map((t) => <button key={t} aria-label={t} onClick={() => setEdit({ ...edit, theme: t })} className={cx('size-9 rounded-xl bg-gradient-to-br', THEMES[t], edit.theme === t && 'ring-4 ring-accent/40')} />)}</div></div>
          <Checkbox checked={!!edit.pinned} onChange={(v) => setEdit({ ...edit, pinned: v })} label="Pin to top" />
        </div>}
      </Modal>
      {node}
    </div>
  )
}

function Actions({ manage, onEdit, onDelete, onShare }: { p: Post; manage: boolean; onEdit: () => void; onDelete: () => void; onShare: () => void }) {
  return (
    <span className="flex gap-1">
      <Button size="sm" variant="ghost" icon={Copy} aria-label="Copy text" onClick={onShare} />
      {manage && <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit" onClick={onEdit} />}
      {manage && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete" className="text-bad" onClick={onDelete} />}
    </span>
  )
}
