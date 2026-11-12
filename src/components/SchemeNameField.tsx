import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Link2, Lock } from 'lucide-react'
import { useDb } from '../lib/store'
import { masterList } from '../lib/schemeMaster'
import { linkedMaster, type MasterKind } from '../../supabase/scheme-master-rules.mjs'
import { Input } from './ui'

/**
 * A scheme-name box for the lists linked to the Scheme Kit (Services, Schemes, Scheme Checker, Sales Kit). A scheme
 * already in the Scheme Kit shows its name locked, with a link to rename it there (so it changes everywhere); a new
 * one picks from the Scheme Kit's names (a new name joins the Scheme Kit when saved).
 */
export function SchemeNameField({ kind, id, value, onChange, label = 'Scheme name', required, className, placeholder }: {
  kind: MasterKind; id?: string; value: string; onChange: (v: string) => void; label?: string; required?: boolean; className?: string; placeholder?: string
}) {
  const db = useDb()
  const list = useId()
  const master = masterList(db)
  const linked = id ? linkedMaster(master, kind, id) : undefined
  if (linked) {
    return (
      <div className={className}>
        <span className="mb-1.5 block text-xs font-semibold text-mute">{label}</span>
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card2 px-3 py-2.5 text-sm"><Lock className="size-4 text-mute" /><b>{linked.name}</b>
          <Link to="/scheme-kit" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"><Link2 className="size-3.5" />Rename in the Scheme Kit</Link></p>
        <p className="mt-1 text-[11px] text-mute">Names are managed in the Scheme Kit — renamed there, it changes here, in every dropdown and on CRM entries.</p>
      </div>
    )
  }
  return (
    <div className={className}>
      <Input label={label} required={required} list={list} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        hint={master.length ? 'Pick a name from the Scheme Kit (a new name is added to it when saved)' : undefined} />
      <datalist id={list}>{master.filter((m) => m.active).map((m) => <option key={m.id} value={m.name} />)}</datalist>
    </div>
  )
}
