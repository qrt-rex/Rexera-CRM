import { useMemo, useState } from 'react'
import { ClipboardList, Copy, ExternalLink, Info, Pencil, Plus, Power, Trash2, Users } from 'lucide-react'
import type { CandidateApplication, CandidateForm } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { deleteCandidateForm, saveCandidateForm, setCandidateFormActive, updateCandidate } from '../../lib/actions'
import { downloadCsv, fmtDate, fmtDateTime, today } from '../../lib/format'
import { CANDIDATE_TYPES, candidateTypeLabel, JOB_BRANCH_INFO, JOB_POSITIONS, jobBranch } from '../../../supabase/form-rules.mjs'
import { openFile } from '../../lib/files'
import { FileLink } from '../../components/FileField'
import { Badge, Button, Card, CardHeader, Checkbox, Drawer, EmptyState, Input, Modal, PageHeader, SearchBox, Select, Table, Td, Textarea, Th, useConfirm, usePaged, useRun, useToast } from '../../components/ui'

const STATUS: Record<CandidateApplication['status'], { label: string; tone: 'blue' | 'violet' | 'red' | 'green' }> = {
  NEW: { label: 'New', tone: 'blue' }, SHORTLISTED: { label: 'Shortlisted', tone: 'violet' }, REJECTED: { label: 'Rejected', tone: 'red' }, HIRED: { label: 'Hired', tone: 'green' },
}
const linkFor = (f: CandidateForm) => `${location.origin}/apply/${f.token}`

export default function Candidates() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const toast = useToast()
  const [confirm, confirmNode] = useConfirm()
  const [edit, setEdit] = useState<{ id?: string; title: string; kind: CandidateForm['kind']; positions: string[]; department: string; description: string } | null>(null)
  const [formFilter, setFormFilter] = useState('')
  const [status, setStatus] = useState('')
  const [branch, setBranch] = useState('')
  const [ctype, setCtype] = useState('')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const list = useMemo(() => db.candidates.filter((c) => (!formFilter || c.formId === formFilter) && (!status || c.status === status) && (!branch || c.branch === branch) && (!ctype || c.candidateType === ctype)
    && (!q || `${c.name} ${c.email} ${c.phone} ${c.city} ${c.qualification} ${c.branch ?? ''} ${c.position ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [db.candidates, formFilter, status, branch, ctype, q])
  const { slice, pager } = usePaged(list, 25, [formFilter, status, branch, ctype, q])
  /** "2026-10-28T11:30" → 28 Oct 2026, 11:30 am */
  const slot = (s?: string) => (s ? `${fmtDate(s.slice(0, 10))}, ${new Date(`2000-01-01T${s.slice(11, 16)}:00`).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : '')
  const open = openId ? db.candidates.find((c) => c.id === openId) : undefined
  const formName = (id: string) => db.candidateForms.find((f) => f.id === id)?.title ?? '—'
  const copy = (f: CandidateForm) => navigator.clipboard?.writeText(linkFor(f)).then(() => toast('success', 'Link copied — share it with the candidate'), () => toast('error', 'Copy blocked — select the link and copy it'))

  return (
    <div>
      <PageHeader title="Candidate Forms" subtitle="Create an application form, share its link with interns and new joiners, and review their details and resumes here" icon={ClipboardList}
        actions={<Button variant="accent" icon={Plus} onClick={() => setEdit({ title: '', kind: 'JOB', positions: [], department: '', description: '' })}>New form</Button>} />

      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-info/30 bg-info-soft px-4 py-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-info" />
        <p className="text-ink/80">Applications are saved in <b>this browser's CRM data</b> for now, so the link collects applications when opened on a computer or tablet that runs this CRM (for example an office tablet for walk-in candidates). To receive applications from candidates' own phones, the CRM needs its online database connected — then the same link works from anywhere.</p>
      </div>

      <Card className="mb-6 overflow-hidden">
        <CardHeader title="Forms" subtitle={`${db.candidateForms.filter((f) => f.active).length} open`} icon={ClipboardList} />
        {!db.candidateForms.length ? <EmptyState icon={ClipboardList} title="No forms yet" text="Create one for each role or internship you are hiring for." action={<Button icon={Plus} onClick={() => setEdit({ title: '', kind: 'JOB', positions: [], department: '', description: '' })}>New form</Button>} /> : (
          <ul className="divide-y divide-line/70">
            {db.candidateForms.map((f, idx) => {
              const n = db.candidates.filter((c) => c.formId === f.id).length
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-xs font-bold text-brand-ink">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">{f.title}<Badge tone={f.kind === 'INTERNSHIP' ? 'cyan' : 'navy'}>{f.kind === 'INTERNSHIP' ? 'Internship' : 'Job'}</Badge>{(f.positions ?? []).slice(0, 3).map((p) => <Badge key={p} tone="violet">{p.replace(/\s*\(.*\)$/, '')}</Badge>)}{(f.positions?.length ?? 0) > 3 && <Badge tone="gray">+{f.positions!.length - 3} more</Badge>}{!f.active && <Badge tone="gray">closed</Badge>}</p>
                    <p className="truncate font-mono text-xs text-mute">{linkFor(f)}</p>
                  </div>
                  <button className="text-xs font-semibold text-brand-ink hover:underline" onClick={() => { setFormFilter(f.id); setStatus('') }}>{n} application{n === 1 ? '' : 's'}</button>
                  <span className="flex gap-1">
                    <Button size="sm" variant="soft" icon={Copy} onClick={() => copy(f)}>Copy link</Button>
                    <Button size="sm" variant="ghost" icon={ExternalLink} aria-label="Open form" title="Open form" onClick={() => window.open(linkFor(f), '_blank', 'noopener')} />
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit form" title="Edit" onClick={() => setEdit({ id: f.id, title: f.title, kind: f.kind, positions: f.positions ?? [], department: f.department, description: f.description })} />
                    <Button size="sm" variant="ghost" icon={Power} aria-label={f.active ? 'Close form' : 'Re-open form'} title={f.active ? 'Close (stop accepting)' : 'Re-open'} onClick={() => run(() => setCandidateFormActive(me, f.id, !f.active), f.active ? 'Form closed' : 'Form re-opened')} />
                    {!n && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete form" className="text-bad" onClick={async () => { if (await confirm('Delete this form?', f.title, true)) run(() => deleteCandidateForm(me, f.id), 'Form deleted') }} />}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <SearchBox value={q} onChange={setQ} placeholder="Search name, email, phone, city…" className="min-w-56 flex-1" />
          <select value={formFilter} onChange={(e) => setFormFilter(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-3 text-sm" aria-label="Form"><option value="">All forms</option>{db.candidateForms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-3 text-sm" aria-label="Status"><option value="">All statuses</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-3 text-sm" aria-label="Branch"><option value="">All branches</option>{JOB_BRANCH_INFO.map((b) => <option key={b.name} value={b.name}>{b.name} — {b.area}</option>)}</select>
          <select value={ctype} onChange={(e) => setCtype(e.target.value)} className="h-10 rounded-xl border border-line bg-card px-3 text-sm" aria-label="Applying as"><option value="">Intern / fresher / experienced</option>{CANDIDATE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          <Button variant="outline" disabled={!list.length} onClick={() => downloadCsv(`applications-${today()}.csv`, list.map((c) => ({ form: formName(c.formId), position: c.position ?? '', branch: c.branch ?? '', branch_address: jobBranch(c.branch)?.address ?? '', applying_as: candidateTypeLabel(c.candidateType), preferred_interview: c.interviewAt?.replace('T', ' ') ?? '', current_ctc: c.currentCtc ?? '', name: c.name, email: c.email, phone: c.phone, city: c.city, dob: c.dob ?? '', qualification: c.qualification, college: c.college ?? '', experience: c.experience, current_company: c.currentCompany ?? '', expected: c.expectedSalary ?? '', notice: c.noticePeriod ?? '', linkedin: c.linkedin ?? '', status: STATUS[c.status].label, submitted: c.submittedAt, resume: c.resume.name })))}>Export</Button>
        </div>
        {!list.length ? <EmptyState icon={Users} title="No applications yet" text="Share a form link — applications appear here with their resumes." /> : (
          <Table>
            <thead><tr><Th>Number</Th><Th>Candidate</Th><Th>Position · branch</Th><Th>Applying as · qualification</Th><Th>Preferred interview</Th><Th>Resume</Th><Th>Status</Th><Th>Submitted</Th></tr></thead>
            <tbody>
              {slice.map((c, idx) => (
                <tr key={c.id} className="cursor-pointer hover:bg-card2/60" onClick={() => setOpenId(c.id)}>
                  <Td className="text-center font-semibold text-mute">{idx + 1}</Td>
                  <Td><p className="font-semibold">{c.name}</p><p className="text-xs text-mute">{c.email} · {c.phone}</p></Td>
                  <Td className="max-w-64 text-sm">{c.position || formName(c.formId)}{c.branch && <span className="block text-xs text-mute">{c.branch}{jobBranch(c.branch) && <span className="block text-[11px] leading-snug">{jobBranch(c.branch)!.address}</span>}</span>}</Td>
                  <Td className="text-xs">{candidateTypeLabel(c.candidateType) || c.experience}{c.currentCtc && <span className="block text-mute">CTC {c.currentCtc}</span>}<span className="block text-mute">{c.qualification}</span></Td>
                  <Td className="text-xs">{slot(c.interviewAt) || <span className="text-mute">—</span>}</Td>
                  <Td><span onClick={(e) => e.stopPropagation()}><FileLink file={c.resume} label="Resume" /></span></Td>
                  <Td><Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge></Td>
                  <Td className="text-xs text-mute">{fmtDate(c.submittedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {pager}
      </Card>

      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open?.name} subtitle={open && `${formName(open.formId)} · applied ${fmtDateTime(open.submittedAt)}`}
        footer={open && <Button variant="outline" onClick={() => openFile(open.resume, true).catch((e) => toast('error', e.message))}>Download resume</Button>}>
        {open && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {([['Position applied for', open.position], ['Branch', open.branch && `${open.branch}${jobBranch(open.branch) ? ` — ${jobBranch(open.branch)!.address}` : ''}`], ['Applying as', candidateTypeLabel(open.candidateType)], ['Preferred interview', slot(open.interviewAt)], ['Current CTC', open.currentCtc], ['Email', open.email], ['Mobile', open.phone], ['City', open.city], ['Date of birth', open.dob ? fmtDate(open.dob) : ''], ['Qualification', open.qualification], ['College', open.college], ['Experience', open.experience], ['Current company', open.currentCompany], ['Expected', open.expectedSalary], ['Notice period', open.noticePeriod]] as [string, string | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-card2 px-3 py-2"><p className="text-[11px] text-mute">{k}</p><p className="break-words font-semibold">{v}</p></div>
              ))}
            </div>
            {open.linkedin && <a href={open.linkedin} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-semibold text-brand-ink hover:underline">{open.linkedin}</a>}
            {open.message && <p className="whitespace-pre-line rounded-xl bg-card2 p-3 text-sm">{open.message}</p>}
            <div className="rounded-xl border border-line p-3"><p className="mb-1 text-[11px] text-mute">Resume</p><FileLink file={open.resume} /></div>
            <Select label="Status" value={open.status} onChange={(e) => run(() => updateCandidate(me, open.id, { status: e.target.value as CandidateApplication['status'] }), 'Status updated')}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <Textarea label="HR notes" defaultValue={open.notes ?? ''} onBlur={(e) => e.target.value !== (open.notes ?? '') && run(() => updateCandidate(me, open.id, { notes: e.target.value }), 'Notes saved')} placeholder="Interview feedback, next steps…" />
          </div>
        )}
      </Drawer>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit form' : 'New application form'}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={async () => { if (edit && await run(() => saveCandidateForm(me, edit), edit.id ? 'Form updated' : 'Form created — copy its link to share')) setEdit(null) }}>{edit?.id ? 'Save' : 'Create form'}</Button></>}>
        {edit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Role title" required value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="e.g. Business Development Executive" className="sm:col-span-2" />
            <Select label="Type" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as CandidateForm['kind'] })}><option value="JOB">Job (new joiner)</option><option value="INTERNSHIP">Internship</option></Select>
            <Input label="Department" value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value })} />
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 flex w-full items-center gap-2 text-xs font-semibold text-mute">
                <span>Positions <span className="text-bad">*</span> <span className="font-normal">— tick one or more; the candidate picks one of them</span></span>
                <span className="ml-auto flex gap-2">
                  <button type="button" className="font-semibold text-brand-ink hover:underline" onClick={() => setEdit({ ...edit, positions: [...JOB_POSITIONS] })}>Select all</button>
                  <button type="button" className="font-semibold text-mute hover:underline" onClick={() => setEdit({ ...edit, positions: [] })}>Clear</button>
                </span>
              </legend>
              <div className="grid gap-1.5 rounded-xl border border-line p-3 sm:grid-cols-2">
                {JOB_POSITIONS.map((p) => (
                  <Checkbox key={p} label={p} checked={edit.positions.includes(p)}
                    onChange={(on) => setEdit({ ...edit, positions: on ? [...edit.positions, p] : edit.positions.filter((x) => x !== p), title: edit.title || (on ? p.replace(/\s*\(.*\)$/, '') : edit.title) })} />
                ))}
              </div>
              <p className="mt-1 text-[11px] text-mute">{edit.positions.length ? `${edit.positions.length} selected` : 'None selected yet'}</p>
            </fieldset>
            <Textarea label="About the role (shown on the form)" rows={4} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className="sm:col-span-2" />
            <p className="text-xs text-mute sm:col-span-2">Candidates fill name, contact details, qualification, experience and expectations, and must upload a resume (PDF or Word, up to 5 MB).</p>
          </div>
        )}
      </Modal>
      {confirmNode}
    </div>
  )
}
