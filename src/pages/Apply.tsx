import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Briefcase, CheckCircle2, GraduationCap, MapPin, Send } from 'lucide-react'
import type { FileRef } from '../lib/types'
import { useDb } from '../lib/store'
import { submitApplication, type ApplicationInput } from '../lib/actions'
import { applicationProblems, CANDIDATE_TYPES, istNowLocal, JOB_BRANCH_INFO, JOB_POSITIONS, jobBranch } from '../../supabase/form-rules.mjs'
import { CLOUD } from '../lib/cloud'
import { RESUME_TYPES } from '../lib/files'
import { Logo } from '../components/Logo'
import { SocialLinks } from '../components/SocialLinks'
import { FileField } from '../components/FileField'
import { CityInput, PhoneInput } from '../components/fields'
import { Button, Card, Input, Select, Textarea, useRun, useToast } from '../components/ui'

const blank: ApplicationInput = {
  name: '', email: '', phone: '', city: '', dob: '', qualification: '', college: '', experience: 'Fresher', currentCompany: '', expectedSalary: '', noticePeriod: '',
  branch: '', position: '', candidateType: undefined, currentCtc: '', interviewAt: '', linkedin: '', message: '',
}
const EXPERIENCE = ['Less than 1 year', '1–3 years', '3–5 years', '5+ years']
/** Only an experienced employee sends experience, company, CTC and notice period. */
const tidy = (a: ApplicationInput): ApplicationInput => a.candidateType === 'EXPERIENCED' ? a
  : { ...a, experience: a.candidateType === 'INTERNSHIP' ? 'Internship' : 'Fresher', currentCompany: '', noticePeriod: '' }

/** Public application form (no sign-in) — HR shares /apply/<token>. */
export default function Apply() {
  const { token = '' } = useParams()
  const db = useDb()
  const run = useRun()
  const toast = useToast()
  const form = db.candidateForms.find((f) => f.token === token)
  const [a, setA] = useState<ApplicationInput>(blank)
  const [resume, setResume] = useState<FileRef | undefined>()
  const [tried, setTried] = useState(false)
  const [done, setDone] = useState(false)
  const set = (p: Partial<ApplicationInput>) => setA((v) => ({ ...v, ...p }))
  const intern = form?.kind === 'INTERNSHIP'
  // the position starts as the role's title (the candidate can change it); an internship form starts as Internship
  useEffect(() => { if (form) setA((v) => ({ ...v, position: v.position || (form.position && JOB_POSITIONS.includes(form.position) ? form.position : form.kind === 'INTERNSHIP' ? 'Intern' : ''), candidateType: v.candidateType ?? (form.kind === 'INTERNSHIP' ? 'INTERNSHIP' : undefined) })) }, [form])
  const errs = tried ? applicationProblems(tidy(a) as unknown as Record<string, unknown>) : {}
  const experienced = a.candidateType === 'EXPERIENCED'

  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setTried(true)
    const out = tidy(a)
    if (!CLOUD) { if (await run(() => submitApplication(token, out, resume))) setDone(true); return }
    // live CRM: the server checks and saves it (and tells HR); "thank you" only once it is really saved
    const problem = Object.values(applicationProblems(out as unknown as Record<string, unknown>))[0] ?? (!resume ? 'Upload your resume (PDF or Word).' : '')
    if (problem) { toast('error', problem); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/apply/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application: out, resume }) })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.success) setDone(true)
      else toast('error', body.message || 'Your application could not be sent — please try again.')
    } catch { toast('error', 'No connection — your application was not sent. Please try again.') } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-[#eef2fb] via-white to-[#fff4ea] px-4 py-8 dark:from-[#0f1830] dark:via-[#0b1020] dark:to-[#1a1420]">
      <div className="mx-auto max-w-2xl">
        {/* the open form carries the logo in its header; the other screens show it here */}
        {(!form || !form.active || done) && <div className="mb-6 flex justify-center"><Logo /></div>}
        {!form || !form.active ? (
          <Card className="p-8 text-center">
            <h1 className="text-xl font-extrabold">{form ? 'Applications are closed' : 'Form not found'}</h1>
            <p className="mt-2 text-sm text-mute">{form ? `${form.title} is no longer accepting applications. Thank you for your interest.` : 'This link is not valid. Please check it with the person who sent it to you.'}</p>
          </Card>
        ) : done ? (
          <Card className="p-8 text-center">
            <span className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-ok-soft text-ok"><CheckCircle2 className="size-8" /></span>
            <h1 className="text-xl font-extrabold">Thank you, {a.name.split(' ')[0]}!</h1>
            <p className="mt-2 text-sm text-mute">Your application for <b className="text-ink">{a.position || form.title}</b> ({a.branch}) has been received. Our HR team will contact you at {a.email} if your profile is shortlisted.</p>
            {jobBranch(a.branch) && <p className="mt-4 rounded-xl bg-card2 px-4 py-3 text-xs text-mute"><b className="text-ink">{a.branch} office</b><br />{jobBranch(a.branch)!.address}</p>}
            <SocialLinks className="mt-5 justify-center" />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-[#2E3A8C] to-[#4453b5] px-6 py-6 text-white">
              <div className="flex flex-wrap-reverse items-start justify-between gap-4">
                <div className="min-w-56 flex-1">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70">{intern ? <GraduationCap className="size-4" /> : <Briefcase className="size-4" />}{intern ? 'Internship application' : 'Job application'}</p>
                  <h1 className="mt-1 text-2xl font-extrabold">{form.title}</h1>
                  <p className="mt-1 text-sm text-white/80">{db.settings.companyName}{form.department ? ` · ${form.department}` : ''}</p>
                </div>
                <Logo onDark size="lg" className="shrink-0" />
              </div>
              {form.description && <p className="mt-3 whitespace-pre-line text-sm text-white/90">{form.description}</p>}
              <SocialLinks onDark className="mt-4" />
            </div>
            <form className="grid gap-4 p-6 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
              <Input label="Full name" required autoComplete="name" value={a.name} onChange={(e) => set({ name: e.target.value })} className="sm:col-span-2" error={errs.name} />
              <Select label="Position applied for" required value={a.position} onChange={(e) => set({ position: e.target.value })} error={errs.position}>
                <option value="">— Select the position —</option>
                {JOB_POSITIONS.map((p) => <option key={p}>{p}</option>)}
              </Select>
              <Select label="Branch" required value={a.branch} onChange={(e) => set({ branch: e.target.value })} error={errs.branch}>
                <option value="">— Select the branch —</option>
                {JOB_BRANCH_INFO.map((b) => <option key={b.name} value={b.name}>{b.name} — {b.address}</option>)}
              </Select>
              {jobBranch(a.branch) && (
                <p className="-mt-2 flex items-start gap-2 rounded-xl bg-card2 px-3 py-2 text-xs text-mute sm:col-span-2"><MapPin className="mt-0.5 size-3.5 shrink-0 text-brand" /><span><b className="text-ink">{a.branch} office:</b> {jobBranch(a.branch)!.address}</span></p>
              )}
              <Select label="Applying as" required value={a.candidateType ?? ''} error={errs.candidateType}
                onChange={(e) => set({ candidateType: (e.target.value || undefined) as ApplicationInput['candidateType'], ...(e.target.value === 'EXPERIENCED' && !EXPERIENCE.includes(a.experience) ? { experience: EXPERIENCE[1]! } : {}) })}>
                <option value="">— Select —</option>
                {CANDIDATE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
              <Input label="Preferred date & time for interview" required type="datetime-local" min={istNowLocal()} value={a.interviewAt} onChange={(e) => set({ interviewAt: e.target.value })} hint="India time" error={errs.interviewAt} />
              <Input label="Email" required type="email" autoComplete="email" value={a.email} onChange={(e) => set({ email: e.target.value })} error={errs.email} />
              <PhoneInput label="Mobile number" required value={a.phone} onChange={(v) => set({ phone: v })} />
              <CityInput value={a.city} onChange={(v) => set({ city: v })} />
              <Input label="Date of birth" type="date" value={a.dob} onChange={(e) => set({ dob: e.target.value })} />
              <Input label="Highest qualification" required value={a.qualification} onChange={(e) => set({ qualification: e.target.value })} placeholder="e.g. B.Com, MBA (Finance)" error={errs.qualification} />
              <Input label={a.candidateType === 'INTERNSHIP' ? 'College / university' : 'College / university (optional)'} value={a.college} onChange={(e) => set({ college: e.target.value })} />
              {experienced && <>
                <Select label="Work experience" value={a.experience} onChange={(e) => set({ experience: e.target.value })}>
                  {EXPERIENCE.map((x) => <option key={x}>{x}</option>)}
                </Select>
                <Input label="Current company" value={a.currentCompany} onChange={(e) => set({ currentCompany: e.target.value })} />
                <Input label="Notice period" value={a.noticePeriod} onChange={(e) => set({ noticePeriod: e.target.value })} placeholder="e.g. 30 days" />
              </>}
              <Input label={experienced ? 'Current CTC (₹ / year)' : 'Current CTC (₹ / year, optional)'} required={experienced} value={a.currentCtc} onChange={(e) => set({ currentCtc: e.target.value })} placeholder={a.candidateType === 'INTERNSHIP' ? 'e.g. current stipend, or leave empty' : 'e.g. 3,60,000'} error={errs.currentCtc} />
              <Input label={a.candidateType === 'INTERNSHIP' ? 'Expected stipend (₹ / month)' : 'Expected salary (₹ / month)'} value={a.expectedSalary} onChange={(e) => set({ expectedSalary: e.target.value })} />
              <Input label="LinkedIn / portfolio link (optional)" type="url" value={a.linkedin} onChange={(e) => set({ linkedin: e.target.value })} placeholder="https://" className="sm:col-span-2" error={errs.linkedin} />
              <Textarea label="Anything you'd like us to know (optional)" value={a.message} onChange={(e) => set({ message: e.target.value })} className="sm:col-span-2" />
              <div className="sm:col-span-2"><FileField label="Resume" required accept={RESUME_TYPES} acceptLabel="PDF or Word" value={resume} onChange={setResume} error={tried && !resume ? 'Please upload your resume.' : undefined} /></div>
              <div className="flex items-center justify-between gap-3 sm:col-span-2">
                <p className="text-xs text-mute">Your details are used only for this application.</p>
                <Button type="submit" icon={Send} loading={busy}>{busy ? 'Sending…' : 'Submit application'}</Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  )
}
