import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Briefcase, CheckCircle2, GraduationCap, Send } from 'lucide-react'
import type { FileRef } from '../lib/types'
import { useDb } from '../lib/store'
import { submitApplication, type ApplicationInput } from '../lib/actions'
import { RESUME_TYPES } from '../lib/files'
import { Logo } from '../components/Logo'
import { FileField } from '../components/FileField'
import { CityInput, PhoneInput } from '../components/fields'
import { Button, Card, Input, Select, Textarea, useRun } from '../components/ui'

const blank: ApplicationInput = { name: '', email: '', phone: '', city: '', dob: '', qualification: '', college: '', experience: 'Fresher', currentCompany: '', expectedSalary: '', noticePeriod: '', linkedin: '', message: '' }

/** Public application form (no sign-in) — HR shares /apply/<token>. */
export default function Apply() {
  const { token = '' } = useParams()
  const db = useDb()
  const run = useRun()
  const form = db.candidateForms.find((f) => f.token === token)
  const [a, setA] = useState<ApplicationInput>(blank)
  const [resume, setResume] = useState<FileRef | undefined>()
  const [tried, setTried] = useState(false)
  const [done, setDone] = useState(false)
  const set = (p: Partial<ApplicationInput>) => setA((v) => ({ ...v, ...p }))
  const intern = form?.kind === 'INTERNSHIP'

  const submit = async () => {
    setTried(true)
    if (await run(() => submitApplication(token, a, resume))) setDone(true)
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-[#eef2fb] via-white to-[#fff4ea] px-4 py-8 dark:from-[#0f1830] dark:via-[#0b1020] dark:to-[#1a1420]">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex justify-center"><Logo /></div>
        {!form || !form.active ? (
          <Card className="p-8 text-center">
            <h1 className="text-xl font-extrabold">{form ? 'Applications are closed' : 'Form not found'}</h1>
            <p className="mt-2 text-sm text-mute">{form ? `${form.title} is no longer accepting applications. Thank you for your interest.` : 'This link is not valid. Please check it with the person who sent it to you.'}</p>
          </Card>
        ) : done ? (
          <Card className="p-8 text-center">
            <span className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-ok-soft text-ok"><CheckCircle2 className="size-8" /></span>
            <h1 className="text-xl font-extrabold">Thank you, {a.name.split(' ')[0]}!</h1>
            <p className="mt-2 text-sm text-mute">Your application for <b className="text-ink">{form.title}</b> has been received. Our HR team will contact you at {a.email} if your profile is shortlisted.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-[#2E3A8C] to-[#4453b5] px-6 py-6 text-white">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70">{intern ? <GraduationCap className="size-4" /> : <Briefcase className="size-4" />}{intern ? 'Internship application' : 'Job application'}</p>
              <h1 className="mt-1 text-2xl font-extrabold">{form.title}</h1>
              <p className="mt-1 text-sm text-white/80">{db.settings.companyName}{form.department ? ` · ${form.department}` : ''}</p>
              {form.description && <p className="mt-3 whitespace-pre-line text-sm text-white/90">{form.description}</p>}
            </div>
            <form className="grid gap-4 p-6 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
              <Input label="Full name" required autoComplete="name" value={a.name} onChange={(e) => set({ name: e.target.value })} className="sm:col-span-2" />
              <Input label="Email" required type="email" autoComplete="email" value={a.email} onChange={(e) => set({ email: e.target.value })} />
              <PhoneInput label="Mobile number" required value={a.phone} onChange={(v) => set({ phone: v })} />
              <CityInput value={a.city} onChange={(v) => set({ city: v })} />
              <Input label="Date of birth" type="date" value={a.dob} onChange={(e) => set({ dob: e.target.value })} />
              <Input label="Highest qualification" required value={a.qualification} onChange={(e) => set({ qualification: e.target.value })} placeholder="e.g. B.Com, MBA (Finance)" />
              <Input label={intern ? 'College / university' : 'College / university (optional)'} value={a.college} onChange={(e) => set({ college: e.target.value })} />
              <Select label="Work experience" value={a.experience} onChange={(e) => set({ experience: e.target.value })}>
                {['Fresher', 'Less than 1 year', '1–3 years', '3–5 years', '5+ years'].map((x) => <option key={x}>{x}</option>)}
              </Select>
              {!intern && <Input label="Current company" value={a.currentCompany} onChange={(e) => set({ currentCompany: e.target.value })} />}
              <Input label={intern ? 'Expected stipend (₹ / month)' : 'Expected salary (₹ / month)'} value={a.expectedSalary} onChange={(e) => set({ expectedSalary: e.target.value })} />
              {!intern && <Input label="Notice period" value={a.noticePeriod} onChange={(e) => set({ noticePeriod: e.target.value })} placeholder="e.g. 30 days" />}
              <Input label="LinkedIn / portfolio link" type="url" value={a.linkedin} onChange={(e) => set({ linkedin: e.target.value })} className="sm:col-span-2" />
              <Textarea label="Anything you'd like us to know" value={a.message} onChange={(e) => set({ message: e.target.value })} className="sm:col-span-2" />
              <div className="sm:col-span-2"><FileField label="Resume" required accept={RESUME_TYPES} acceptLabel="PDF or Word" value={resume} onChange={setResume} error={tried && !resume ? 'Please upload your resume.' : undefined} /></div>
              <div className="flex items-center justify-between gap-3 sm:col-span-2">
                <p className="text-xs text-mute">Your details are used only for this application.</p>
                <Button type="submit" icon={Send}>Submit application</Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  )
}
