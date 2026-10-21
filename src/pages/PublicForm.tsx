import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Download, Loader2, Lock, Send } from 'lucide-react'
import type { FormField } from '../lib/types'
import { checkAnswers, MAX_UPLOAD_BYTES, UPLOAD_TYPES } from '../../supabase/form-rules.mjs'
import { Logo } from '../components/Logo'
import { FormRenderer, type FormFiles, type FormValues } from '../components/FormRenderer'

interface PublicForm { name: string; description: string; instructions: string; kind: 'ONLINE' | 'UPLOAD'; fields: FormField[]; version: number; document: { name: string; url: string } | null }
type State = { kind: 'loading' } | { kind: 'verify'; name: string; message?: string } | { kind: 'error'; message: string } | { kind: 'form'; form: PublicForm } | { kind: 'done'; reference: string }

const toBase64 = (f: File) => new Promise<string>((ok, bad) => {
  const r = new FileReader()
  r.onload = () => ok(String(r.result).split(',')[1] ?? '')
  r.onerror = () => bad(new Error(`Could not read ${f.name}`))
  r.readAsDataURL(f)
})

/** A client's form from a secure link (/f/<token>) — no sign-in; the live server checks and stores everything. */
export default function PublicFormPage() {
  const { token = '' } = useParams()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [mobile, setMobile] = useState('')
  const [values, setValues] = useState<FormValues>({})
  const [files, setFiles] = useState<FormFiles>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = async (m = '') => {
    setState({ kind: 'loading' })
    try {
      const res = await fetch(`/api/forms/${encodeURIComponent(token)}${m ? `?mobile=${encodeURIComponent(m)}` : ''}`)
      const j = await res.json().catch(() => null) as { success?: boolean; verify?: boolean; name?: string; message?: string; form?: PublicForm } | null
      if (j?.success && j.form) return setState({ kind: 'form', form: j.form })
      if (j?.verify) return setState({ kind: 'verify', name: j.name ?? 'Form', message: m ? j.message : undefined })
      setState({ kind: 'error', message: j?.message ?? 'This form could not be opened. Please contact us.' })
    } catch { setState({ kind: 'error', message: 'This form could not be opened — check your internet connection.' }) }
  }
  useEffect(() => { void load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (form: PublicForm) => {
    const meta = Object.entries(files).flatMap(([fieldId, list]) => list.map((f) => ({ fieldId, name: f.name, type: f.type, size: f.size })))
    const { errors: errs } = checkAnswers(form.fields, values, meta)
    for (const x of meta) if (!UPLOAD_TYPES[x.type]) errs[x.fieldId] = `${x.name}: only PDF, image or Word files.`; else if (x.size > MAX_UPLOAD_BYTES) errs[x.fieldId] = `${x.name} is larger than 5 MB.`
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const payload = { mobile, answers: values, files: await Promise.all(Object.entries(files).flatMap(([fieldId, list]) => list.map(async (f) => ({ fieldId, name: f.name, type: f.type, data: await toBase64(f) })))) }
      const res = await fetch(`/api/forms/${encodeURIComponent(token)}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await res.json().catch(() => null) as { success?: boolean; reference?: string; message?: string; errors?: Record<string, string> } | null
      if (j?.success) setState({ kind: 'done', reference: j.reference ?? '' })
      else { setErrors({ ...(j?.errors ?? {}), _form: j?.message ?? 'The form could not be sent. Please try again.' }) }
    } catch { setErrors({ _form: 'The form could not be sent — check your internet connection and try again.' }) }
    setBusy(false)
  }

  return (
    <div className="min-h-screen bg-[#F5F7FB] px-4 py-8 text-[#111827]">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex justify-center"><Logo fixed /></div>
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-sm sm:p-8">
          {state.kind === 'loading' && <p className="flex items-center justify-center gap-2 py-10 text-sm text-[#6B7280]"><Loader2 className="size-4 animate-spin" />Opening the form…</p>}
          {state.kind === 'error' && <div className="py-6 text-center"><h1 className="text-xl font-extrabold">Form unavailable</h1><p className="mt-2 text-sm text-[#6B7280]">{state.message}</p></div>}
          {state.kind === 'verify' && (
            <form onSubmit={(e) => { e.preventDefault(); void load(mobile) }} className="mx-auto max-w-sm py-4 text-center">
              <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-[#EEF2FB] text-[#2E3A8C]"><Lock className="size-6" /></span>
              <h1 className="text-xl font-extrabold">{state.name}</h1>
              <p className="mt-1 text-sm text-[#6B7280]">For your security, enter the mobile number you registered with us.</p>
              <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" placeholder="10-digit mobile" aria-label="Mobile number" autoComplete="tel"
                className="mt-4 h-11 w-full rounded-xl border border-[#D1D5DB] px-3 text-center text-sm outline-none focus:border-[#2E3A8C]" />
              {state.message && <p role="alert" className="mt-2 text-xs font-semibold text-[#DC2626]">{state.message}</p>}
              <button className="mt-4 h-11 w-full rounded-xl bg-[#2E3A8C] text-sm font-bold text-white hover:bg-[#25307a]">Continue</button>
            </form>
          )}
          {state.kind === 'done' && (
            <div className="py-6 text-center">
              <span className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-[#E7F7F0] text-[#0E9F6E]"><CheckCircle2 className="size-8" /></span>
              <h1 className="text-xl font-extrabold">Thank you — we have received it</h1>
              <p className="mt-2 text-sm text-[#6B7280]">Our team will review it and contact you if anything else is needed.</p>
              {state.reference && <p className="mt-3 text-xs text-[#6B7280]">Reference: <span className="font-mono">{state.reference}</span></p>}
            </div>
          )}
          {state.kind === 'form' && (
            <form onSubmit={(e) => { e.preventDefault(); void submit(state.form) }} noValidate>
              <h1 className="text-2xl font-extrabold">{state.form.name}</h1>
              {state.form.description && <p className="mt-1 text-sm text-[#4B5563]">{state.form.description}</p>}
              {state.form.instructions && <div className="mt-4 whitespace-pre-line rounded-xl bg-[#EEF2FB] p-4 text-sm text-[#1F2937]">{state.form.instructions}</div>}
              {state.form.document && (
                <a href={state.form.document.url} className="mt-4 flex items-center gap-3 rounded-xl border border-[#E5E7EB] p-4 text-sm font-semibold text-[#2E3A8C] hover:bg-[#F9FAFB]">
                  <Download className="size-5" /><span className="flex-1">Download: {state.form.document.name}</span><span className="text-xs font-normal text-[#6B7280]">link valid for 1 hour</span>
                </a>
              )}
              <div className="mt-6"><FormRenderer fields={state.form.fields} values={values} files={files} errors={errors} disabled={busy}
                onValue={(id, v) => setValues((x) => ({ ...x, [id]: v }))} onFiles={(id, f) => setFiles((x) => ({ ...x, [id]: f }))} /></div>
              {(errors._form || errors._files) && <p role="alert" className="mt-4 rounded-xl bg-[#FEF2F2] px-4 py-2.5 text-sm font-semibold text-[#DC2626]">{errors._form ?? errors._files}</p>}
              <button disabled={busy} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#F47B20] text-base font-bold text-white hover:bg-[#df6a12] disabled:opacity-60">
                {busy ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}{busy ? 'Sending…' : 'Submit'}
              </button>
              <p className="mt-3 text-center text-[11px] text-[#9CA3AF]">Your answers and files are sent securely to our team only.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
