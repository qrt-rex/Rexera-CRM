import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, Eye, FilePen, RotateCcw } from 'lucide-react'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { logLetter, userName } from '../../lib/actions'
import { draftBody, LETTER_KINDS, letterPdf, type LetterData, type LetterKind } from '../../lib/letters'
import { today } from '../../lib/format'
import { Button, Card, CardHeader, Input, PageHeader, Select, Tabs, Textarea, useRun } from '../../components/ui'

const blankData = (company: string, companyLine: string, signatory: string): LetterData => ({
  company, companyLine, refNo: '', date: today(), name: '', address: '', designation: '', department: '', location: '',
  startDate: today(), endDate: '', amount: 0, probationMonths: 3, reportingTo: '', signatory, signatoryTitle: 'Human Resources',
})

export default function Letters() {
  const db = useDb()
  const me = useMe()
  const run = useRun()
  const [params, setParams] = useSearchParams()
  const kind = (LETTER_KINDS.some((k) => k.id === params.get('type')) ? params.get('type') : 'joining') as LetterKind
  const companyLine = [db.settings.supplierState, db.settings.companyGstin ? `GSTIN ${db.settings.companyGstin}` : ''].filter(Boolean).join(' · ')
  const [x, setX] = useState<LetterData>(() => blankData(db.settings.companyName, companyLine, me.name))
  const [employee, setEmployee] = useState('')
  const [body, setBody] = useState('')
  const [edited, setEdited] = useState(false)
  const drafted = useMemo(() => draftBody(kind, x), [kind, x])
  useEffect(() => { if (!edited) setBody(drafted) }, [drafted, edited])
  const set = (patch: Partial<LetterData>) => setX((v) => ({ ...v, ...patch }))
  const people = useMemo(() => [...db.users].sort((a, b) => a.name.localeCompare(b.name)), [db.users])

  const fillFrom = (id: string) => {
    setEmployee(id)
    const u = db.users.find((p) => p.id === id)
    if (!u) return
    const a = u.address
    set({
      name: u.name, designation: u.designation, department: u.department, startDate: u.joinedOn, amount: kind === 'joining' ? u.salary ?? 0 : x.amount,
      address: a ? [a.line, [a.city, a.state, a.pin].filter(Boolean).join(', ')].filter(Boolean).join('\n') : '', reportingTo: u.teamLeadId ? userName(db, u.teamLeadId) : x.reportingTo,
      endDate: kind === 'experience' ? x.endDate || today() : x.endDate,
    })
  }
  const missing = !x.name.trim() ? 'Enter the person’s name.' : kind !== 'experience' && !x.startDate ? 'Enter the start date.' : kind !== 'joining' && !x.endDate ? (kind === 'internship' ? 'Enter the internship end date.' : 'Enter the relieving date.') : ''
  const make = () => { if (missing) throw new Error(missing); return letterPdf(kind, x, body) }
  const fileName = `${LETTER_KINDS.find((k) => k.id === kind)!.label.replace(/ /g, '-')}-${x.name.trim().replace(/\s+/g, '-') || 'draft'}.pdf`
  const download = () => run(() => {
    const url = URL.createObjectURL(make())
    const a = document.createElement('a'); a.href = url; a.download = fileName; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    logLetter(me, LETTER_KINDS.find((k) => k.id === kind)!.label, x.name)
  }, 'Letter downloaded')
  const preview = () => run(() => { const url = URL.createObjectURL(make()); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60_000) })

  return (
    <div>
      <PageHeader title="Letters" subtitle="Generate a joining, internship or experience letter on the company letterhead and download it as PDF" icon={FilePen}
        actions={<Tabs value={kind} onChange={(t) => { setParams({ type: t }); setEdited(false) }} tabs={LETTER_KINDS.map((k) => ({ id: k.id, label: k.label }))} />} />
      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card className="overflow-hidden">
          <CardHeader title="Details" subtitle="Pick an employee to fill these in, or type them" icon={FilePen} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Select label="Fill from employee" value={employee} onChange={(e) => fillFrom(e.target.value)} className="sm:col-span-2">
              <option value="">— New person (type below) —</option>
              {people.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.designation}{u.active ? '' : ' (left)'}</option>)}
            </Select>
            <Input label="Full name" required value={x.name} onChange={(e) => set({ name: e.target.value })} className="sm:col-span-2" />
            {kind !== 'experience' && <Textarea label="Address" rows={2} value={x.address} onChange={(e) => set({ address: e.target.value })} className="sm:col-span-2" />}
            <Input label={kind === 'internship' ? 'Internship role' : 'Designation'} value={x.designation} onChange={(e) => set({ designation: e.target.value })} />
            <Input label="Department" value={x.department} onChange={(e) => set({ department: e.target.value })} />
            <Input label={kind === 'experience' ? 'Joined on' : kind === 'internship' ? 'Start date' : 'Joining date'} type="date" required value={x.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            {kind !== 'joining' && <Input label={kind === 'internship' ? 'End date' : 'Relieving date'} type="date" required value={x.endDate} min={x.startDate} onChange={(e) => set({ endDate: e.target.value })} />}
            {kind !== 'experience' && <Input label={kind === 'internship' ? 'Monthly stipend (₹, 0 = unpaid)' : 'Monthly salary / CTC (₹)'} type="number" min={0} value={x.amount || ''} onChange={(e) => set({ amount: Number(e.target.value) })} />}
            {kind === 'joining' && <Input label="Probation (months)" type="number" min={0} value={x.probationMonths} onChange={(e) => set({ probationMonths: Number(e.target.value) })} />}
            {kind !== 'experience' && <Input label="Work location" value={x.location} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Ahmedabad office" />}
            {kind !== 'experience' && <Input label={kind === 'internship' ? 'Mentor' : 'Reporting to'} value={x.reportingTo} onChange={(e) => set({ reportingTo: e.target.value })} />}
            <Input label="Letter date" type="date" value={x.date} onChange={(e) => set({ date: e.target.value })} />
            <Input label="Reference no." value={x.refNo} onChange={(e) => set({ refNo: e.target.value })} placeholder="e.g. RX/HR/2026/014" />
            <Input label="Signed by" value={x.signatory} onChange={(e) => set({ signatory: e.target.value })} />
            <Input label="Signatory title" value={x.signatoryTitle} onChange={(e) => set({ signatoryTitle: e.target.value })} />
            <Input label="Company name (letterhead)" value={x.company} onChange={(e) => set({ company: e.target.value })} className="sm:col-span-2" />
            <Input label="Letterhead line" value={x.companyLine} onChange={(e) => set({ companyLine: e.target.value })} className="sm:col-span-2" hint="Address, phone, GSTIN — shown under the company name" />
          </div>
        </Card>
        <Card className="flex flex-col overflow-hidden">
          <CardHeader title={LETTER_KINDS.find((k) => k.id === kind)!.title} subtitle={edited ? 'Edited by you — changes to the details no longer update the text' : 'Text updates as you fill the details; you can edit it before downloading'} icon={FilePen}
            action={edited && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setEdited(false)}>Reset text</Button>} />
          <div className="flex flex-1 flex-col gap-4 p-5">
            <textarea value={body} onChange={(e) => { setBody(e.target.value); setEdited(true) }} aria-label="Letter text"
              className="min-h-[420px] flex-1 resize-y rounded-xl border border-line bg-card p-4 font-serif text-[15px] leading-relaxed outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" />
            {missing && <p className="text-xs text-warn">{missing}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" icon={Eye} onClick={preview}>Preview PDF</Button>
              <Button icon={Download} onClick={download}>Download PDF</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
