import { useRef, useState } from 'react'
import { Eye, FileText, Paperclip, X } from 'lucide-react'
import type { FileRef } from '../lib/types'
import { checkFile, deleteFile, fileSize, openFile, saveFile } from '../lib/files'
import { Button, cx, useToast } from './ui'

/** Upload one file (kept in the browser file store); shows name, size, view and remove. */
export function FileField({ label, required, accept, acceptLabel, value, onChange, hint, error }: {
  label: string; required?: boolean; accept: string; acceptLabel: string; value?: FileRef; onChange: (f: FileRef | undefined) => void; hint?: string; error?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const pick = async (f: File) => {
    try {
      checkFile(f, accept, label)
      setBusy(true)
      const saved = await saveFile(f)
      if (value) deleteFile(value.id).catch(() => {})
      onChange(saved)
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Could not attach the file.') } finally { setBusy(false) }
  }
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-mute">{label}{required && <span className="text-bad"> *</span>}</span>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f) }} />
      {value ? (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-card2 px-3 py-2">
          <FileText className="size-5 shrink-0 text-info" />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{value.name}</span><span className="block text-[11px] text-mute">{fileSize(value.size)}</span></span>
          <Button type="button" size="sm" variant="ghost" icon={Eye} aria-label="View file" onClick={() => openFile(value).catch((e) => toast('error', e.message))} />
          <Button type="button" size="sm" variant="ghost" icon={X} aria-label="Remove file" onClick={() => { deleteFile(value.id).catch(() => {}); onChange(undefined) }} />
        </div>
      ) : (
        <button type="button" onClick={() => ref.current?.click()} disabled={busy}
          className={cx('flex w-full items-center gap-3 rounded-xl border-2 border-dashed px-3 py-3 text-left text-sm transition hover:border-brand hover:bg-brand-soft/40', error ? 'border-bad' : 'border-line')}>
          <Paperclip className="size-5 text-mute" />
          <span className="min-w-0 flex-1"><span className="block font-semibold">{busy ? 'Attaching…' : 'Choose a file'}</span><span className="block text-[11px] text-mute">{acceptLabel} · up to 5 MB</span></span>
        </button>
      )}
      {(error || hint) && <p className={cx('mt-1 text-[11px]', error ? 'text-bad' : 'text-mute')}>{error ?? hint}</p>}
    </div>
  )
}

/** Small "view file" link for tables. */
export function FileLink({ file, label }: { file: FileRef; label?: string }) {
  const toast = useToast()
  return (
    <button type="button" onClick={() => openFile(file).catch((e) => toast('error', e.message))} className="inline-flex max-w-44 items-center gap-1 truncate text-xs font-semibold text-brand-ink hover:underline" title={file.name}>
      <Paperclip className="size-3.5 shrink-0" />{label ?? file.name}
    </button>
  )
}
