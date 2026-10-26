import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Copy, Eye, Globe, History, ImageUp, Inbox, Plug, Plus, RefreshCw, RotateCcw, Save, Send, Trash2, Undo2 } from 'lucide-react'
import type { SiteKey } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { CLOUD } from '../../lib/cloud'
import { getSupabase } from '../../lib/supabase'
import { serverPost } from '../../lib/share'
import { contentProblems, discardSiteDraft, emptyContent, isChanged, publishSite, restoreSiteVersion, saveSiteDraft, SITE_SECTIONS, siteRow, siteSection, type SiteField, type SiteSection } from '../../lib/siteContent'
import { fmtDateTime, uid } from '../../lib/format'
import { Badge, Button, Card, CardHeader, cx, EmptyState, Input, Modal, PageHeader, SearchBox, Table, Tabs, Td, Textarea, Th, Toggle, useConfirm, useRun, useToast } from '../../components/ui'

type Tab = 'content' | 'publish' | 'leads' | 'connect'
type Obj = Record<string, unknown>

/**
 * Website (Super Admin): the content of rexera.co.in — edit a draft, preview, publish — and every enquiry its forms
 * send (they arrive in CRM Leads; failed ones can be retried here). The website reads GET /api/site/content.
 */
export default function Website() {
  const db = useDb()
  const [params, setParams] = useSearchParams()
  const tab = (['content', 'publish', 'leads', 'connect'].includes(params.get('tab') ?? '') ? params.get('tab') : 'content') as Tab
  const changed = (db.siteContent ?? []).filter(isChanged).length
  return (
    <div>
      <PageHeader title="Website" subtitle="Manage rexera.co.in from the CRM — content, publishing and the leads its forms send" icon={Globe}
        actions={<Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
          { id: 'content', label: 'Content' }, { id: 'publish', label: 'Publish & history', count: changed || undefined },
          { id: 'leads', label: 'Leads', count: (db.webLeadLog ?? []).filter((x) => x.status === 'FAILED' || x.status === 'INVALID').length || undefined },
          { id: 'connect', label: 'Connect your website' },
        ]} />} />
      {!CLOUD && <p className="mb-4 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">The website reads published content from the live CRM (connected to Supabase). Here you can edit and preview.</p>}
      {tab === 'content' && <ContentTab />}
      {tab === 'publish' && <PublishTab />}
      {tab === 'leads' && <LeadsTab />}
      {tab === 'connect' && <ConnectTab />}
    </div>
  )
}

// ---------------------------------------------------------------- content
function ContentTab() {
  const db = useDb()
  const [key, setKey] = useState<SiteKey>('hero')
  const s = siteSection(key)
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Card className="self-start overflow-hidden">
        <ul className="divide-y divide-line/70">
          {SITE_SECTIONS.map((x) => {
            const r = siteRow(db.siteContent, x.key)
            return (
              <li key={x.key}><button onClick={() => setKey(x.key)} className={cx('flex w-full items-center gap-2 px-4 py-3 text-left text-sm', key === x.key ? 'bg-brand-soft font-bold text-brand-ink' : 'hover:bg-card2')}>
                <span className="min-w-0 flex-1"><span className="block truncate">{x.label}</span><span className="block truncate text-[11px] font-normal text-mute">{r?.publishedAt ? `Live since ${fmtDateTime(r.publishedAt)}` : r ? 'Never published' : 'Empty'}</span></span>
                {isChanged(r) && <Badge tone="amber">draft</Badge>}
              </button></li>
            )
          })}
        </ul>
      </Card>
      <SectionEditor key={key} s={s} />
    </div>
  )
}

function SectionEditor({ s }: { s: SiteSection }) {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const r = siteRow(db.siteContent, s.key)
  const [v, setV] = useState<unknown>(() => structuredClone(r?.draft ?? emptyContent(s)))
  const [preview, setPreview] = useState(false)
  const dirty = JSON.stringify(v) !== JSON.stringify(r?.draft ?? emptyContent(s))
  const problems = contentProblems(s, v)
  const list = (v as Obj[]) ?? []
  const setItem = (i: number, p: Obj) => setV(list.map((o, j) => (j === i ? { ...o, ...p } : o)))
  const move = (i: number, d: number) => { const n = [...list]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); setV(n) }

  return (
    <Card className="overflow-hidden">
      <CardHeader title={s.label} subtitle={s.desc} action={<span className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" icon={Eye} onClick={() => setPreview(true)}>Preview</Button>
        {isChanged(r) && !dirty && <Button size="sm" variant="ghost" icon={Undo2} onClick={async () => { if (await confirm('Discard the unpublished changes?', 'This part goes back to what is live on the website.', true)) { run(() => discardSiteDraft(me, s.key), 'Changes discarded'); setV(structuredClone(r?.published ?? emptyContent(s))) } }}>Discard draft</Button>}
        <Button size="sm" icon={Save} disabled={!dirty || problems.length > 0} onClick={() => run(() => saveSiteDraft(me, s.key, v), 'Draft saved — publish it to put it on the website')}>Save draft</Button>
      </span>} />
      <div className="space-y-4 p-5">
        <p className="text-xs text-mute">{r?.updatedAt ? `Draft saved ${fmtDateTime(r.updatedAt)} by ${userName(db, r.updatedBy)}` : 'Not saved yet'}{r?.publishedAt ? ` · live version from ${fmtDateTime(r.publishedAt)}` : ' · not on the website yet'}{isChanged(r) ? ' · the draft has unpublished changes' : ''}</p>
        {s.kind === 'object' ? <Fields fields={s.fields} o={(v as Obj) ?? {}} onChange={(p) => setV({ ...(v as Obj), ...p })} />
          : <>
            {!list.length && <EmptyState icon={Plus} title={`No ${s.item}s yet`} text={`Add the first ${s.item}.`} />}
            {list.map((o, i) => (
              <div key={String(o.id ?? i)} className="rounded-2xl border border-line p-4">
                <div className="mb-3 flex items-center gap-2">
                  <b className="flex-1 text-sm">{s.item![0]!.toUpperCase() + s.item!.slice(1)} {i + 1}{o.title ? ` · ${String(o.title)}` : ''}</b>
                  <Button size="sm" variant="ghost" icon={ArrowUp} aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                  <Button size="sm" variant="ghost" icon={ArrowDown} aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)} />
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove" onClick={() => setV(list.filter((_, j) => j !== i))} />
                </div>
                <Fields fields={s.fields} o={o} onChange={(p) => setItem(i, p)} />
              </div>
            ))}
            <Button variant="outline" icon={Plus} onClick={() => setV([...list, { id: s.key === 'forms' || s.key === 'sections' ? '' : uid(`${s.key.slice(0, 3)}-`), active: true }])}>Add {s.item}</Button>
          </>}
        {problems.length > 0 && <ul className="rounded-xl bg-warn-soft px-4 py-2 text-xs text-warn">{problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul>}
      </div>
      {preview && <PreviewModal s={s} v={v} onClose={() => setPreview(false)} />}
      {node}
    </Card>
  )
}

function Fields({ fields, o, onChange }: { fields: SiteField[]; o: Obj; onChange: (p: Obj) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {fields.map((f) => {
        const val = o[f.name]
        if (f.type === 'toggle') return <label key={f.name} className="flex items-center gap-2 text-sm md:col-span-2"><Toggle checked={val !== false} onChange={(x) => onChange({ [f.name]: x })} label={f.label} />{f.label}</label>
        if (f.type === 'textarea') return <Textarea key={f.name} label={f.label} hint={f.hint} rows={3} value={String(val ?? '')} onChange={(e) => onChange({ [f.name]: e.target.value })} className="md:col-span-2" />
        if (f.type === 'image') return <ImageField key={f.name} f={f} value={String(val ?? '')} onChange={(x) => onChange({ [f.name]: x })} />
        return <Input key={f.name} label={f.label} hint={f.hint} type={f.type === 'email' ? 'email' : 'text'} value={String(val ?? '')} placeholder={f.type === 'url' ? 'https://' : undefined} onChange={(e) => onChange({ [f.name]: e.target.value })} />
      })}
    </div>
  )
}

/** An image: paste a link, or upload it to the website's public image store (live CRM). */
function ImageField({ f, value, onChange }: { f: SiteField; value: string; onChange: (v: string) => void }) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const upload = async (file: File) => {
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) { toast('error', 'Choose a PNG, JPG, WebP, GIF or SVG image.'); return }
    if (file.size > 3 * 1024 * 1024) { toast('error', 'Images up to 3 MB.'); return }
    setBusy(true)
    try {
      const sb = await getSupabase(), path = `${uid('img-')}-${file.name.replace(/[^\w.-]+/g, '-').slice(-60)}`
      const { error } = await sb.storage.from('site-assets').upload(path, file, { contentType: file.type, upsert: false })
      if (error) throw new Error(error.message)
      onChange(sb.storage.from('site-assets').getPublicUrl(path).data.publicUrl)
      toast('success', 'Image uploaded')
    } catch (e) { toast('error', `Could not upload: ${e instanceof Error ? e.message : 'error'}`) } finally { setBusy(false) }
  }
  return (
    <div className="md:col-span-2">
      <div className="flex items-end gap-2">
        <Input label={f.label} value={value} placeholder="https://… (or upload)" onChange={(e) => onChange(e.target.value)} className="flex-1" />
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = '' }} />
        <Button variant="outline" icon={ImageUp} loading={busy} disabled={!CLOUD} title={CLOUD ? undefined : 'Uploading works on the live CRM'} onClick={() => input.current?.click()}>Upload</Button>
      </div>
      {/^https?:\/\//.test(value) && <img src={value} alt="" className="mt-2 max-h-28 rounded-lg border border-line object-contain" />}
    </div>
  )
}

/** How the content will read (a plain rendering — the website keeps its own design). */
function PreviewModal({ s, v, onClose }: { s: SiteSection; v: unknown; onClose: () => void }) {
  const items = (s.kind === 'list' ? (v as Obj[]) : [v as Obj]).filter((o) => o && o.active !== false)
  const text = (o: Obj, k: string) => (o[k] ? String(o[k]) : '')
  return (
    <Modal open onClose={onClose} title={`Preview · ${s.label}`} subtitle="Content only — the website shows it in its own design" size="lg" footer={<Button onClick={onClose}>Close</Button>}>
      {!items.length ? <p className="text-sm text-mute">Nothing to show (empty, or every item is hidden).</p> : (
        <div className="space-y-4">
          {items.map((o, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-line">
              {/^https?:\/\//.test(text(o, 'image')) && <img src={text(o, 'image')} alt="" className="max-h-56 w-full object-cover" />}
              <div className="space-y-1 p-4">
                {(text(o, 'title') || text(o, 'heading')) && <h3 className="text-lg font-extrabold">{text(o, 'title') || text(o, 'heading')}</h3>}
                {(text(o, 'subtitle') || text(o, 'summary') || text(o, 'client')) && <p className="text-sm text-mute">{[text(o, 'client'), text(o, 'subtitle') || text(o, 'summary')].filter(Boolean).join(' — ')}</p>}
                {(text(o, 'body') || text(o, 'text') || text(o, 'details') || text(o, 'description')) && <p className="whitespace-pre-line text-sm">{text(o, 'body') || text(o, 'text') || text(o, 'details') || text(o, 'description')}</p>}
                {s.key === 'contact' && <p className="whitespace-pre-line text-sm">{[text(o, 'phone'), text(o, 'email'), text(o, 'address'), text(o, 'hours')].filter(Boolean).join('\n')}</p>}
                {s.key === 'forms' && <p className="text-xs text-mute">Form name <b>{text(o, 'id')}</b> · fields: {text(o, 'fields').split('\n').filter(Boolean).join(', ') || '—'}</p>}
                {(text(o, 'ctaText') || text(o, 'price')) && <p className="text-sm font-semibold text-brand-ink">{text(o, 'ctaText') || text(o, 'price')}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------- publish & history
function PublishTab() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const rows = db.siteContent ?? []
  const pending = rows.filter(isChanged)
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="overflow-hidden">
        <CardHeader title="Waiting to be published" subtitle="Saved drafts that are not on the website yet" icon={Send}
          action={pending.length > 0 && <Button icon={Send} onClick={async () => { if (await confirm(`Publish ${pending.length} part(s) to the website?`, pending.map((r) => siteSection(r.key).label).join(', '))) run(() => publishSite(me), 'Published — the website shows it within a minute') }}>Publish all</Button>} />
        {!pending.length ? <EmptyState icon={Send} title="Everything is live" text="Saved drafts appear here until you publish them." /> : (
          <ul className="divide-y divide-line/70">
            {pending.map((r) => (
              <li key={r.key} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="flex-1"><b>{siteSection(r.key).label}</b><span className="block text-[11px] text-mute">Draft {fmtDateTime(r.updatedAt)} by {userName(db, r.updatedBy)} · {r.publishedAt ? `live version ${fmtDateTime(r.publishedAt)}` : 'never published'}</span></span>
                <Button size="sm" variant="outline" icon={Send} onClick={() => run(() => publishSite(me, [r.key]), `${siteSection(r.key).label} published`)}>Publish</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Published versions" subtitle="Restore one as the draft, then publish it" icon={History} />
        {!(db.siteHistory ?? []).length ? <EmptyState icon={History} title="Nothing published yet" /> : (
          <ul className="max-h-[32rem] divide-y divide-line/70 overflow-y-auto">
            {(db.siteHistory ?? []).slice(0, 100).map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className="flex-1"><b>{siteSection(h.key).label}</b><span className="block text-[11px] text-mute">{fmtDateTime(h.at)} · {userName(db, h.by)}</span></span>
                <Button size="sm" variant="ghost" icon={RotateCcw} onClick={async () => { if (await confirm('Restore this version as the draft?', 'Publish it afterwards to put it on the website.')) run(() => restoreSiteVersion(me, h.id), 'Restored as the draft') }}>Restore</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {node}
    </div>
  )
}

// ---------------------------------------------------------------- leads
const LOG_TONE = { SAVED: 'green', EXISTING: 'blue', FAILED: 'red', INVALID: 'amber', SPAM: 'gray' } as const
const LOG_LABEL = { SAVED: 'New lead', EXISTING: 'Existing lead', FAILED: 'Failed', INVALID: 'No valid mobile', SPAM: 'Spam (ignored)' } as const
function LeadsTab() {
  const db = useDb()
  const run = useRun()
  const [q, setQ] = useState('')
  const [phone, setPhone] = useState<Record<string, string>>({})
  const leads = useMemo(() => db.leads.filter((l) => /website/i.test(l.source ?? '')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db.leads])
  const shown = leads.filter((l) => !q || `${l.name} ${l.phone} ${l.email ?? ''} ${l.company ?? ''} ${l.service ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const log = db.webLeadLog ?? []
  const retry = (id: string) => run(async () => { const r = await serverPost<{ message: string }>('/api/website-lead/retry', { id, phone: phone[id] || undefined }); return r.message })
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader title="Leads from the website" subtitle="Every form on the website creates (or updates) a lead in CRM Leads — work them there" icon={Inbox}
          action={<Link to="/leads"><Button size="sm" variant="outline">Open CRM Leads</Button></Link>} />
        <div className="border-b border-line p-4"><SearchBox value={q} onChange={setQ} placeholder="Search name, mobile, email, company, service…" /></div>
        {!shown.length ? <EmptyState icon={Inbox} title="No website leads yet" text="They appear as soon as someone fills a form on the website." /> : (
          <Table>
            <thead><tr><Th>Lead</Th><Th>Form / service</Th><Th>Status</Th><Th>Assigned to</Th><Th>Received</Th></tr></thead>
            <tbody>
              {shown.slice(0, 200).map((l) => (
                <tr key={l.id}>
                  <Td><b>{l.name}</b><span className="block text-xs text-mute">{l.phone}{l.email ? ` · ${l.email}` : ''}{l.company ? ` · ${l.company}` : ''}</span></Td>
                  <Td className="text-xs">{[l.extra?.page ?? l.extra?.form_name, l.service].filter(Boolean).join(' · ') || '—'}</Td>
                  <Td><Badge tone="blue">{l.status.replace(/_/g, ' ').toLowerCase()}</Badge></Td>
                  <Td className="text-xs">{l.assignedTo ? userName(db, l.assignedTo) : <span className="text-warn">Unassigned</span>}</Td>
                  <Td className="text-xs text-mute">{fmtDateTime(l.formAt ?? l.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Form submissions log" subtitle="Each submission as it arrived — retry a failed one, or one without a valid mobile once you have the number" icon={RefreshCw} />
        {!log.length ? <EmptyState icon={RefreshCw} title="No submissions logged yet" /> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Form</Th><Th>From</Th><Th>Result</Th><Th className="text-right">Action</Th></tr></thead>
            <tbody>
              {log.slice(0, 200).map((x) => (
                <tr key={x.id}>
                  <Td className="text-xs text-mute">{fmtDateTime(x.at)}</Td>
                  <Td className="text-xs">{x.form || '—'}</Td>
                  <Td className="text-xs"><b>{x.name || '—'}</b><span className="block text-mute">{[x.phone, x.email].filter(Boolean).join(' · ')}</span></Td>
                  <Td><Badge tone={LOG_TONE[x.status]}>{LOG_LABEL[x.status]}</Badge>{x.error && <span className="block text-[11px] text-bad">{x.error}</span>}{x.retriedAt && <span className="block text-[11px] text-mute">retried {fmtDateTime(x.retriedAt)}</span>}</Td>
                  <Td className="text-right">{(x.status === 'FAILED' || x.status === 'INVALID') && (
                    <span className="inline-flex items-center gap-1">
                      {x.status === 'INVALID' && <input value={phone[x.id] ?? ''} onChange={(e) => setPhone({ ...phone, [x.id]: e.target.value })} placeholder="Mobile" aria-label="Mobile number" className="h-8 w-28 rounded-lg border border-line bg-card px-2 text-xs" />}
                      <Button size="sm" variant="outline" icon={RefreshCw} disabled={!CLOUD} onClick={() => retry(x.id)}>Save as lead</Button>
                    </span>
                  )}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- connect
function ConnectTab() {
  const toast = useToast()
  const origin = window.location.origin
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('success', 'Copied'), () => toast('error', 'Copy blocked — select and copy it'))
  const fetchSnippet = `// Read the published content (drafts never appear)
const res = await fetch('${origin}/api/site/content')
const { content } = await res.json()
// content.hero, content.banners, content.about, content.services, content.portfolio,
// content.sections, content.contact, content.forms, content.seo`
  const formSnippet = `<form action="${origin}/api/website-lead" method="POST">
  <input type="hidden" name="form_name" value="contact">          <!-- a form name from Website → Content → Website forms -->
  <input type="hidden" name="key" value="YOUR_WEBSITE_LEAD_KEY">    <!-- the WEBSITE_LEAD_KEY set on the server -->
  <input type="hidden" name="_redirect" value="https://rexera.co.in/thank-you">
  <input name="name" placeholder="Full name" required>
  <input name="phone" placeholder="Mobile number" required>
  <input name="email" type="email" placeholder="Email">
  <input name="company" placeholder="Company">
  <input name="service" placeholder="Service you are interested in">
  <textarea name="message" placeholder="Your requirement"></textarea>
  <input name="website" style="display:none" tabindex="-1" autocomplete="off"> <!-- spam trap: leave empty -->
  <button>Send</button>
</form>`
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="overflow-hidden">
        <CardHeader title="1 · Show the CRM's content on your website" subtitle="Your website reads what you publish here — public, read-only, updated within a minute" icon={Plug} />
        <div className="space-y-3 p-5 text-sm">
          <p><b>GET</b> <code className="rounded bg-card2 px-1.5 py-0.5">{origin}/api/site/content</code> <Button size="sm" variant="ghost" icon={Copy} aria-label="Copy" onClick={() => copy(`${origin}/api/site/content`)} /></p>
          <pre className="overflow-x-auto rounded-xl bg-card2 p-3 text-[12px]">{fetchSnippet}</pre>
          <p className="text-xs text-mute">Items you switch off ("Show on the website") are left out. Images uploaded here are served from public links.</p>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="2 · Send every website form to CRM Leads" subtitle="Any form can post here — plain HTML or JavaScript (JSON)" icon={Inbox} />
        <div className="space-y-3 p-5 text-sm">
          <p><b>POST</b> <code className="rounded bg-card2 px-1.5 py-0.5">{origin}/api/website-lead</code> <Button size="sm" variant="ghost" icon={Copy} aria-label="Copy" onClick={() => copy(`${origin}/api/website-lead`)} /></p>
          <pre className="overflow-x-auto rounded-xl bg-card2 p-3 text-[12px]">{formSnippet}</pre>
          <ul className="list-disc space-y-1 pl-5 text-xs text-mute">
            <li>A lead needs a 10-digit mobile number; the same number again adds to the existing lead (no duplicates).</li>
            <li>With JavaScript, send JSON and the key in the <code>X-Website-Key</code> header; the answer is <code>{'{ success, message }'}</code>.</li>
            <li>Every submission is logged under Leads → Form submissions log (failed ones can be saved again).</li>
          </ul>
        </div>
      </Card>
    </div>
  )
}
