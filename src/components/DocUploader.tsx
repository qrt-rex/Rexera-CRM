import { useRef, useState } from 'react'
import { FileText, Plus, Upload, X } from 'lucide-react'
import type { FileRef } from '../lib/types'
import { DOC_CATEGORIES, guessCategory } from '../lib/workflow'
import { checkFile, deleteFile, fileSize, saveFile } from '../lib/files'
import { Button, cx, useToast } from './ui'

export const DOC_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,application/pdf,image/png,image/jpeg,image/webp'
export interface PendingDoc { file: FileRef; category: string }


/**
 * Add documents one after another: each gets its own type. `onChange` receives the list so a form can save it later,
 * or pass `onUpload` to show an "Upload" button that saves them straight away.
 */
export function DocUploader({ value, onChange, onUpload, categories = DOC_CATEGORIES, label = 'Documents', hint }: {
  value: PendingDoc[]; onChange: (v: PendingDoc[]) => void; onUpload?: (docs: PendingDoc[]) => Promise<boolean | undefined>
  categories?: readonly string[]; label?: string; hint?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const add = async (list: FileList) => {
    setBusy(true)
    try {
      const added: PendingDoc[] = []
      for (const f of Array.from(list)) {
        checkFile(f, DOC_ACCEPT, f.name)
        const file = await saveFile(f)
        const g = guessCategory(f.name)
        added.push({ file, category: categories.includes(g) ? g : categories[categories.length - 1] ?? 'Other' })
      }
      onChange([...value, ...added])
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Could not add the file.') } finally { setBusy(false) }
  }
  const remove = (i: number) => { deleteFile(value[i]!.file.id).catch(() => {}); onChange(value.filter((_, j) => j !== i)) }
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-mute">{label}</span>
        {value.length > 0 && <span className="text-[11px] text-mute">{value.length} added</span>}
      </div>
      <input ref={ref} type="file" multiple accept={DOC_ACCEPT} className="hidden" onChange={(e) => { if (e.target.files?.length) add(e.target.files); e.target.value = '' }} />
      {value.length > 0 && (
        <ul className="mb-2 divide-y divide-line/70 rounded-xl border border-line">
          {value.map((d, i) => (
            <li key={d.file.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <FileText className="size-4 shrink-0 text-info" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{d.file.name}</span><span className="text-[11px] text-mute">{fileSize(d.file.size)}</span></span>
              <select value={d.category} aria-label={`Type of ${d.file.name}`} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}
                className="h-8 rounded-lg border border-line bg-card px-2 text-xs">
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
              <button type="button" aria-label={`Remove ${d.file.name}`} onClick={() => remove(i)} className="grid size-7 place-items-center rounded-lg text-mute hover:bg-card2 hover:text-bad"><X className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => ref.current?.click()} disabled={busy}
          className={cx('flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-3 py-3 text-sm font-semibold text-mute transition hover:border-brand hover:bg-brand-soft/40 hover:text-ink', value.length ? 'min-w-40' : 'w-full')}>
          {value.length ? <Plus className="size-4" /> : <Upload className="size-4" />}{busy ? 'Adding…' : value.length ? 'Add another document' : 'Choose documents'}
        </button>
        {onUpload && value.length > 0 && <Button type="button" icon={Upload} loading={busy} onClick={async () => { setBusy(true); try { if (await onUpload(value)) onChange([]) } finally { setBusy(false) } }}>Upload {value.length}</Button>}
      </div>
      <p className="mt-1 text-[11px] text-mute">{hint ?? 'PDF, Word, Excel or image · up to 5 MB each · the type is guessed from the file name — change it if needed.'}</p>
    </div>
  )
}
