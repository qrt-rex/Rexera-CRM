import { useRef, useState } from 'react'
import { Download, Eye, FileText, Image as ImageIcon, Loader2, Paperclip, UploadCloud, X } from 'lucide-react'
import type { FileRef, HrAnswer, HrFormField, User } from '../../lib/types'
import { fileSize, openFile } from '../../lib/files'
import { useFileUrl } from '../ProofGallery'
import { cx, SearchSelect, useToast } from '../ui'
import { acceptAttr, answerText, FILE_TYPES, FORMATS, formatsOf, maxFilesOf, maxMbOf } from '../../../supabase/hr-form-rules.mjs'

/**
 * HR Form Builder fields: one renderer for the builder's live preview, the employee filling the form, and the
 * read-only view HR reviews (answers, files with previews, open / download).
 */
const inputCls = 'h-10 w-full rounded-lg border border-line bg-card px-3 text-sm outline-none transition placeholder:text-mute/70 hover:border-mute/40 focus:border-brand focus:ring-3 focus:ring-brand/12 disabled:bg-card2 disabled:text-mute'
const isImageRef = (f: FileRef) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(f.name)

export type Uploader = (field: HrFormField, file: File) => Promise<FileRef>

export function FieldInput({ field: f, value, onChange, error, disabled, users = [], uploader, onDiscard }: {
  field: HrFormField; value: HrAnswer | undefined; onChange: (v: HrAnswer) => void; error?: string; disabled?: boolean; users?: User[]
  /** missing = preview (uploads switched off) */
  uploader?: Uploader; onDiscard?: (ref: FileRef) => void
}) {
  const id = `hf-${f.id}`
  const str = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
  const list = Array.isArray(value) ? (value as string[]) : []
  const ctl = (() => {
    switch (f.type) {
      case 'textarea':
        return <textarea id={id} rows={4} disabled={disabled} value={str} placeholder={f.placeholder} maxLength={f.maxLength} onChange={(e) => onChange(e.target.value)}
          className={cx(inputCls, 'h-auto min-h-24 py-2')} />
      case 'number':
        return <input id={id} type="number" inputMode="decimal" disabled={disabled} value={str} placeholder={f.placeholder} min={f.min} max={f.max}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className={inputCls} />
      case 'date':
        return <input id={id} type="date" disabled={disabled} value={str} onChange={(e) => onChange(e.target.value || null)} className={inputCls} />
      case 'select':
        return (
          <select id={id} disabled={disabled} value={str} onChange={(e) => onChange(e.target.value || null)} className={inputCls}>
            <option value="">{f.placeholder || '— Select —'}</option>
            {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )
      case 'multiselect':
        return <MultiSelect id={id} options={f.options ?? []} value={list} onChange={onChange} disabled={disabled} placeholder={f.placeholder} />
      case 'checkbox': case 'radio':
        return (
          <div role={f.type === 'radio' ? 'radiogroup' : 'group'} aria-labelledby={`${id}-l`} className="grid gap-1.5 sm:grid-cols-2">
            {(f.options ?? []).map((o) => {
              const on = f.type === 'radio' ? str === o : list.includes(o)
              return (
                <label key={o} className={cx('flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition', on ? 'border-brand bg-brand-soft/60' : 'border-line hover:bg-card2', disabled && 'pointer-events-none opacity-70')}>
                  <input type={f.type} name={id} checked={on} disabled={disabled} className="size-4 accent-[var(--brand)]"
                    onChange={() => onChange(f.type === 'radio' ? o : on ? list.filter((x) => x !== o) : [...list, o])} />
                  <span className="min-w-0 break-words">{o}</span>
                </label>
              )
            })}
          </div>
        )
      case 'employee':
        return <SearchSelect value={str} onChange={(v) => onChange(v || null)} placeholder={f.placeholder || 'Type a name or employee ID…'} clearable
          options={users.filter((u) => u.active && !u.deletedAt).sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({ value: u.id, label: u.name, hint: `${u.username} · ${u.department || u.designation || ''}` }))} />
      case 'file': case 'files': case 'image':
        return <FileField field={f} value={Array.isArray(value) ? (value as FileRef[]) : []} onChange={onChange} disabled={disabled} uploader={uploader} onDiscard={onDiscard} />
      default:
        return <input id={id} type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'} inputMode={f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : undefined}
          disabled={disabled} value={str} placeholder={f.placeholder} maxLength={f.maxLength} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    }
  })()
  const counter = (f.type === 'text' || f.type === 'textarea') && f.maxLength ? `${str.length} / ${f.maxLength}` : ''
  return (
    <div className="min-w-0">
      <label id={`${id}-l`} htmlFor={['checkbox', 'radio', 'file', 'files', 'image', 'employee'].includes(f.type) ? undefined : id} className="mb-1.5 flex items-baseline gap-1 text-sm font-semibold">
        <span className="min-w-0 break-words">{f.label || <span className="text-mute">Untitled field</span>}</span>{f.required && <span className="text-bad" aria-label="required">*</span>}
      </label>
      {ctl}
      <div className="mt-1 flex items-start justify-between gap-3">
        {error ? <p role="alert" className="text-xs font-medium text-bad">{error}</p> : f.help ? <p className="text-xs text-mute">{f.help}</p> : <span />}
        {counter && <span className="shrink-0 text-[11px] tabular-nums text-mute">{counter}</span>}
      </div>
    </div>
  )
}

function MultiSelect({ id, options, value, onChange, disabled, placeholder }: { id: string; options: string[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button id={id} type="button" disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open}
        className={cx(inputCls, 'flex h-auto min-h-10 flex-wrap items-center gap-1 py-1.5 text-left')}>
        {value.length ? value.map((v) => <span key={v} className="rounded-md bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-ink">{v}</span>) : <span className="text-mute/70">{placeholder || 'Choose one or more…'}</span>}
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-pop" onMouseLeave={() => setOpen(false)}>
          {options.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-card2">
              <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={value.includes(o)} onChange={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])} />{o}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function FileField({ field: f, value, onChange, disabled, uploader, onDiscard }: { field: HrFormField; value: FileRef[]; onChange: (v: FileRef[]) => void; disabled?: boolean; uploader?: Uploader; onDiscard?: (ref: FileRef) => void }) {
  const pick = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(0)
  const [over, setOver] = useState(false)
  const max = maxFilesOf(f)
  const room = max - value.length
  const formats = formatsOf(f).map((k) => FORMATS.find((x) => x[0] === k)?.[1]).join(', ')
  const add = async (files: File[]) => {
    if (!uploader) { toast('info', 'This is the preview — employees upload files when they fill the form.'); return }
    const take = files.slice(0, Math.max(0, room))
    if (files.length > take.length) toast('error', `At most ${max} file${max === 1 ? '' : 's'} here.`)
    let cur = value
    for (const file of take) {
      setBusy((n) => n + 1)
      try { const ref = await uploader(f, file); cur = max === 1 ? [ref] : [...cur, ref]; onChange(cur) }
      catch (e) { toast('error', e instanceof Error ? e.message : 'Upload failed.') }
      finally { setBusy((n) => n - 1) }
    }
  }
  return (
    <div>
      {(room > 0 || max === 1) && !disabled && (
        <div onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]) }}
          className={cx('flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center transition', over ? 'border-brand bg-brand-soft/50' : 'border-line bg-card2/50')}>
          {busy ? <Loader2 className="size-6 animate-spin text-brand" /> : f.type === 'image' ? <ImageIcon className="size-6 text-mute" /> : <UploadCloud className="size-6 text-mute" />}
          <p className="text-sm">{busy ? 'Uploading…' : <>Drag {max === 1 ? 'a file' : 'files'} here or <button type="button" onClick={() => pick.current?.click()} className="font-semibold text-brand hover:underline">browse</button></>}</p>
          <p className="text-[11px] text-mute">{formats} · up to {maxMbOf(f)} MB{max > 1 ? ` · ${value.length}/${max} files` : ''}</p>
          <input ref={pick} type="file" className="hidden" multiple={max > 1} accept={acceptAttr(f)} aria-label={`Upload for ${f.label}`}
            onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) add(files) }} />
        </div>
      )}
      {value.length > 0 && (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {value.map((r) => <FileChip key={r.id} file={r} onRemove={disabled ? undefined : () => { onChange(value.filter((x) => x.id !== r.id)); onDiscard?.(r) }} />)}
        </ul>
      )}
    </div>
  )
}

/** One uploaded file: thumbnail for images, name and size, view / download, remove (before submitting). */
export function FileChip({ file, onRemove }: { file: FileRef; onRemove?: () => void }) {
  const run = useToast()
  const img = isImageRef(file)
  const { url } = useFileUrl(img ? file : undefined)
  const open = (download = false) => openFile(file, download).catch((e) => run('error', e instanceof Error ? e.message : 'Could not open the file.'))
  return (
    <li className="flex min-w-0 items-center gap-2.5 rounded-xl border border-line bg-card p-2">
      <button type="button" onClick={() => open()} className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-card2" title="View">
        {img && url ? <img src={url} alt="" className="size-full object-cover" /> : <FileText className="size-5 text-mute" />}
      </button>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{file.name}</span><span className="text-[11px] text-mute">{fileSize(file.size)}</span></span>
      <button type="button" onClick={() => open()} className="grid size-8 place-items-center rounded-lg text-mute hover:bg-card2 hover:text-ink" aria-label={`View ${file.name}`} title="View"><Eye className="size-4" /></button>
      <button type="button" onClick={() => open(true)} className="grid size-8 place-items-center rounded-lg text-mute hover:bg-card2 hover:text-ink" aria-label={`Download ${file.name}`} title="Download"><Download className="size-4" /></button>
      {onRemove && <button type="button" onClick={onRemove} className="grid size-8 place-items-center rounded-lg text-mute hover:bg-bad-soft hover:text-bad" aria-label={`Remove ${file.name}`} title="Remove"><X className="size-4" /></button>}
    </li>
  )
}

/** The whole form to fill (or its live preview). */
export function FormFill({ fields, values, onChange, errors = {}, disabled, users, uploader, onDiscard }: {
  fields: HrFormField[]; values: Record<string, HrAnswer>; onChange: (id: string, v: HrAnswer) => void; errors?: Record<string, string>; disabled?: boolean; users?: User[]; uploader?: Uploader; onDiscard?: (ref: FileRef) => void
}) {
  if (!fields.length) return <p className="py-10 text-center text-sm text-mute">No fields yet — add some from the left.</p>
  return (
    <div className="grid gap-5">
      {fields.map((f) => <FieldInput key={f.id} field={f} value={values[f.id]} onChange={(v) => onChange(f.id, v)} error={errors[f.id]} disabled={disabled} users={users} uploader={uploader} onDiscard={onDiscard} />)}
    </div>
  )
}

/** A submission as HR reads it: every field and its answer; files with previews, view and download. */
export function AnswerView({ fields, answers, users = [] }: { fields: HrFormField[]; answers: Record<string, HrAnswer>; users?: User[] }) {
  return (
    <dl className="divide-y divide-line/70">
      {fields.map((f) => {
        const v = answers[f.id]
        const files = FILE_TYPES.includes(f.type) && Array.isArray(v) ? (v as FileRef[]) : null
        const text = files ? '' : answerText(f, v, { users })
        return (
          <div key={f.id} className="grid gap-1 py-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-4">
            <dt className="text-sm font-semibold text-mute">{f.label}{f.required && <span className="text-bad"> *</span>}</dt>
            <dd className="min-w-0 text-sm">
              {files ? (files.length ? <ul className="grid gap-2 sm:grid-cols-2">{files.map((x) => <FileChip key={x.id} file={x} />)}</ul> : <span className="text-mute">No file</span>)
                : text ? <span className="whitespace-pre-wrap break-words">{text}</span> : <span className="text-mute">—</span>}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
export const FileIcon = Paperclip
