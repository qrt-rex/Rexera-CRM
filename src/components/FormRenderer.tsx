import type { FormField } from '../lib/types'
import { UPLOAD_TYPES } from '../../supabase/form-rules.mjs'
import { cx } from './ui'

export type FormValues = Record<string, string | boolean>
export type FormFiles = Record<string, File[]>
const ACCEPT = Object.keys(UPLOAD_TYPES).join(',') + ',' + Object.values(UPLOAD_TYPES).join(',')
const box = 'h-11 w-full rounded-xl border bg-white px-3 text-sm text-[#111827] outline-none focus:border-[#2E3A8C] focus:ring-2 focus:ring-[#2E3A8C]/15'

/** The client's view of a form's fields (also the staff preview). Plain, light styling: it is shown to clients. */
export function FormRenderer({ fields, values, files, errors = {}, onValue, onFiles, disabled }: {
  fields: FormField[]; values: FormValues; files: FormFiles; errors?: Record<string, string>
  onValue: (id: string, v: string | boolean) => void; onFiles: (id: string, f: File[]) => void; disabled?: boolean
}) {
  return (
    <div className="space-y-5">
      {fields.map((f) => {
        const err = errors[f.id], id = `f-${f.id}`
        const border = err ? 'border-[#DC2626]' : 'border-[#D1D5DB]'
        return (
          <div key={f.id}>
            {f.type !== 'checkbox' && <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-[#1F2937]">{f.label || 'Untitled field'}{f.required && <span className="text-[#DC2626]"> *</span>}</label>}
            {f.type === 'textarea' ? <textarea id={id} rows={4} disabled={disabled} value={String(values[f.id] ?? '')} onChange={(e) => onValue(f.id, e.target.value)} className={cx(box, border, 'h-auto py-2')} />
              : f.type === 'select' ? (
                <select id={id} disabled={disabled} value={String(values[f.id] ?? '')} onChange={(e) => onValue(f.id, e.target.value)} className={cx(box, border)}>
                  <option value="">— Select —</option>{(f.options ?? []).filter(Boolean).map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : f.type === 'checkbox' ? (
                <label className="flex items-start gap-2.5 text-sm text-[#1F2937]"><input id={id} type="checkbox" disabled={disabled} checked={values[f.id] === true} onChange={(e) => onValue(f.id, e.target.checked)} className="mt-0.5 size-4 accent-[#2E3A8C]" />
                  <span>{f.label || 'Untitled field'}{f.required && <span className="text-[#DC2626]"> *</span>}</span></label>
              ) : f.type === 'file' ? (
                <div>
                  <input id={id} type="file" multiple accept={ACCEPT} disabled={disabled} onChange={(e) => onFiles(f.id, [...(e.target.files ?? [])])}
                    className="block w-full text-sm text-[#374151] file:mr-3 file:rounded-lg file:border-0 file:bg-[#2E3A8C] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white" />
                  {(files[f.id] ?? []).length > 0 && <ul className="mt-1.5 text-xs text-[#6B7280]">{files[f.id]!.map((x) => <li key={x.name}>{x.name} · {Math.round(x.size / 1024)} KB</li>)}</ul>}
                  <p className="mt-1 text-xs text-[#6B7280]">PDF, image or Word · up to 5 MB each</p>
                </div>
              ) : (
                <input id={id} disabled={disabled} value={String(values[f.id] ?? '')} onChange={(e) => onValue(f.id, e.target.value)} className={cx(box, border)}
                  type={f.type === 'email' ? 'email' : f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : f.type === 'phone' ? 'tel' : 'text'} inputMode={f.type === 'phone' ? 'numeric' : undefined} />
              )}
            {f.help && <p className="mt-1 text-xs text-[#6B7280]">{f.help}</p>}
            {err && <p role="alert" className="mt-1 text-xs font-semibold text-[#DC2626]">{err}</p>}
          </div>
        )
      })}
    </div>
  )
}
