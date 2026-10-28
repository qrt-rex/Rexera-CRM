import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Clapperboard, Copy, Download, FileDown, ImageDown, Images, Lightbulb, Megaphone, Pencil, Pin, Plus, Trash2 } from 'lucide-react'
import { companyMedia } from '../../lib/media'
import { openFile } from '../../lib/files'
import { mediaTypeLabel } from '../../../supabase/media-rules.mjs'
import { MediaPreview } from '../../components/MediaPreview'
import type { Post } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { deletePost, upsertPost, userName } from '../../lib/actions'
import { ago } from '../../lib/format'
import { Button, Card, cx, EmptyState, Input, Menu, MenuItem, Modal, PageHeader, Select, Tabs, Textarea, useConfirm, useRun, useToast, Checkbox } from '../../components/ui'
import { downloadFlyerJpeg, downloadFlyerPdf } from '../../lib/flyer'
import { byPrice, inPriceBand, OptionFilter, PriceFilter, schemeIn, schemePrice, type PriceBand, type PriceSort } from '../../components/CatalogFilters'
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
  // flyers & posts: Admin + Operation team · sales information: also Team Leaders
  const canKind = (k: Kind) => can(k === 'SALES_INFO' ? 'salesinfo.manage' : 'content.manage')
  const manage = canKind(tab)
  const kinds = (['FLYER', 'POST', 'SALES_INFO'] as Kind[]).filter(canKind)
  const [edit, setEdit] = useState<(Omit<Post, 'id' | 'createdAt' | 'by'> & { id?: string }) | null>(null)
  // flyers and posts: scheme-wise (the scheme a flyer is about) and price-wise (that scheme's price)
  const [scheme, setScheme] = useState('')
  useEffect(() => { setScheme('') }, [tab])
  const [band, setBand] = useState<PriceBand>('all')
  const [sort, setSort] = useState<PriceSort>('')
  const filtered = tab !== 'SALES_INFO'
  const postScheme = (p: Post) => schemeIn(db, `${p.title} ${p.body}`)
  const keep = (name?: string) => !filtered || ((!scheme || name?.toLowerCase() === scheme.toLowerCase()) && inPriceBand(schemePrice(db, name), band))
  const allPosts = db.posts.filter((p) => p.kind === tab)
  const list = byPrice(allPosts.filter((p) => keep(postScheme(p))).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt.localeCompare(a.createdAt)), (p) => schemePrice(db, postScheme(p)), filtered ? sort : '')
  // published company media from the Digital Media Dashboard, shown here from the same record (flyers & posters
  // under Flyers, the rest under Posts) — nothing to upload twice
  const media = companyMedia(db, me)
  const mediaOf = (k: Kind) => (k === 'SALES_INFO' ? [] : media.filter((m) => (m.mediaType === 'FLYER' || m.mediaType === 'POSTER') === (k === 'FLYER')))
  const fromMedia = byPrice(mediaOf(tab).filter((m) => keep(m.schemeName)), (m) => schemePrice(db, m.schemeName), filtered ? sort : '')
  const schemeOptions = [...new Map([...allPosts.map(postScheme), ...mediaOf(tab).map((m) => m.schemeName)].filter((n): n is string => !!n?.trim()).map((n) => [n.trim().toLowerCase(), n.trim()])).values()].sort()

  const share = (p: Post) => { navigator.clipboard?.writeText(`${p.title}\n\n${p.body}\n\n— Rexera Financial Services`).then(() => toast('success', 'Copied — paste it into WhatsApp or email'), () => toast('error', 'Copy blocked by the browser')) }
  return (
    <div>
      <PageHeader title="Flyers, Posts & Sales Info" icon={Images}
        subtitle={manage ? 'Create material — sales teams are notified' : tab === 'SALES_INFO' ? 'Sales information is added by Team Leaders, Admin and the Operation team' : 'Flyers and posts are made by Admin and the Operation team'}
        actions={<>{manage && <Button variant="accent" icon={Plus} onClick={() => setEdit({ kind: tab, title: '', body: '', theme: 'navy', pinned: false })}>New {tab === 'SALES_INFO' ? 'sales info' : tab.toLowerCase()}</Button>}</>} />
      <Tabs className="mb-5 w-fit" value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { id: 'FLYER', label: 'Flyers', icon: Images, count: db.posts.filter((p) => p.kind === 'FLYER').length + mediaOf('FLYER').length },
        { id: 'POST', label: 'Posts', icon: Megaphone, count: db.posts.filter((p) => p.kind === 'POST').length + mediaOf('POST').length },
        { id: 'SALES_INFO', label: 'Sales information', icon: Lightbulb, count: db.posts.filter((p) => p.kind === 'SALES_INFO').length },
      ]} />
      {filtered && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <OptionFilter label="Scheme" all="All schemes" value={scheme} options={schemeOptions} onChange={setScheme} />
          <PriceFilter band={band} sort={sort} onBand={setBand} onSort={setSort} />
          {(scheme || band !== 'all') && <Button size="sm" variant="ghost" onClick={() => { setScheme(''); setBand('all') }}>Clear filters</Button>}
          <p className="w-full text-xs text-mute">The scheme is the one a flyer names (or its Digital Media scheme); the price is that scheme's price in Schemes / Sales Kit.</p>
        </div>
      )}
      {fromMedia.length > 0 && (
        <div className="mb-6">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold"><Clapperboard className="size-4 text-accent" />From the Digital Media Dashboard
            {can('media.manage') && <Link to="/digital-media" className="text-xs font-semibold text-brand-ink hover:underline">Manage media</Link>}</p>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {fromMedia.map((m) => (
              <Card key={m.id} className="overflow-hidden">
                <MediaPreview file={m.files[0]!} className="aspect-square w-full rounded-none border-0" />
                <div className="p-4">
                  <p className="truncate font-bold">{m.title}</p>
                  <p className="truncate text-xs text-mute">{m.schemeName} · {mediaTypeLabel(m.mediaType)} · {ago(m.submittedAt ?? m.createdAt)}</p>
                  {m.description && <p className="mt-1 line-clamp-2 text-sm">{m.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    {m.files.map((f) => <button key={f.id} type="button" className="inline-flex items-center gap-1 font-semibold text-brand-ink hover:underline" onClick={() => openFile(f, true).catch((e) => toast('error', e.message))}><Download className="size-3" />{m.files.length > 1 ? f.name : 'Download'}</button>)}
                    {can('media.manage') && <Link to={`/digital-media?open=${m.id}`} className="ml-auto font-semibold text-mute hover:text-ink">Details</Link>}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          {list.length > 0 && <p className="mt-6 mb-3 text-sm font-bold">{tab === 'FLYER' ? 'Flyers' : 'Posts'} made here</p>}
        </div>
      )}
      {!list.length ? (!fromMedia.length && <Card><EmptyState icon={Images} title={allPosts.length || mediaOf(tab).length ? 'Nothing matches the filters' : 'Nothing here yet'} /></Card>) : tab === 'SALES_INFO' ? (
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
          {kinds.length > 1 && <Select label="Type" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Kind })}>
            {kinds.map((k) => <option key={k} value={k}>{k === 'FLYER' ? 'Flyer' : k === 'POST' ? 'Post' : 'Sales information'}</option>)}
          </Select>}
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
