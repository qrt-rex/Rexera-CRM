import { useState } from 'react'
import { Eye, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { Scheme } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useAuth, useMe } from '../../lib/auth'
import { deleteScheme, upsertScheme } from '../../lib/actions'
import { ago } from '../../lib/format'
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, SearchBox, Textarea, Toggle, useConfirm, useRun } from '../../components/ui'

const blank = { title: '', category: 'Grant', summary: '', benefit: '', eligibility: '', active: true }

export default function Schemes() {
  const db = useDb()
  const me = useMe()
  const { can } = useAuth()
  const run = useRun()
  const [confirm, node] = useConfirm()
  const manage = can('schemes.manage')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<(typeof blank & { id?: string }) | null>(null)
  const list = db.schemes.filter((s) => (manage || s.active) && (!q || `${s.title} ${s.summary} ${s.category}`.toLowerCase().includes(q.toLowerCase())))

  return (
    <div>
      <PageHeader title="Schemes" subtitle={manage ? 'Publish schemes — sales teams are notified instantly' : 'Government schemes you can offer (view only)'} icon={Sparkles}
        actions={<>{!manage && <Badge tone="gray"><Eye className="size-3" />View only</Badge>}{manage && <Button variant="accent" icon={Plus} onClick={() => setEdit({ ...blank })}>Add scheme</Button>}</>} />
      <SearchBox value={q} onChange={setQ} placeholder="Search schemes…" className="mb-5 max-w-md" />
      {!list.length ? <Card><EmptyState icon={Sparkles} title="No schemes" /></Card> : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s: Scheme, i) => (
            <Card key={s.id} className="flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-pop anim-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="relative bg-gradient-to-br from-[#2E3A8C] to-[#4b5bc4] p-5 text-white">
                <Badge tone="orange" className="bg-white/90">{s.category}</Badge>
                <h3 className="mt-3 text-lg font-extrabold">{s.title}</h3>
                <p className="mt-1 text-2xl font-extrabold text-[#F4A12A]">{s.benefit}</p>
                {!s.active && <span className="absolute right-4 top-4 rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-bold">Inactive</span>}
              </div>
              <div className="flex flex-1 flex-col p-5 text-sm">
                <p className="flex-1 text-mute">{s.summary}</p>
                <p className="mt-3 rounded-xl bg-card2 p-3 text-xs"><b>Eligibility:</b> {s.eligibility}</p>
                <div className="mt-3 flex items-center justify-between text-[11px] text-mute">
                  <span>Added {ago(s.createdAt)}</span>
                  {manage && <span className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setEdit({ ...s })} />
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete" className="text-bad" onClick={async () => { if (await confirm('Delete scheme?', s.title, true)) run(() => deleteScheme(me, s.id), 'Deleted') }} />
                  </span>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit scheme' : 'New scheme'}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={async () => { if (edit && await run(() => upsertScheme(me, edit), 'Scheme saved')) setEdit(null) }}>Save</Button></>}>
        {edit && <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Title" required value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className="sm:col-span-2" />
          <Input label="Category" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} />
          <Input label="Benefit" value={edit.benefit} onChange={(e) => setEdit({ ...edit, benefit: e.target.value })} placeholder="e.g. Up to ₹20 lakh" />
          <Textarea label="Summary" value={edit.summary} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} className="sm:col-span-2" />
          <Textarea label="Eligibility" value={edit.eligibility} onChange={(e) => setEdit({ ...edit, eligibility: e.target.value })} className="sm:col-span-2" />
          <label className="flex items-center gap-3 text-sm"><Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />Active (visible to sales)</label>
        </div>}
      </Modal>
      {node}
    </div>
  )
}
