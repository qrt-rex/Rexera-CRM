import { useState } from 'react'
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Database,
} from 'lucide-react'

export default function PookieeImport() {
  const [step, setStep] = useState<'upload' | 'mapping' | 'success'>('mapping')
  const [uploadedFile, setUploadedFile] = useState<string | null>('staff_roster_october.xlsx')

  const sampleRows = [
    { name: 'Rohan Deshpande', email: 'rohan.d@gmail.com', phone: '9822019283', dept: 'Engineering', salary: '62000' },
    { name: 'Priyanka Sen', email: 'priyanka.s@gmail.com', phone: '9811029384', dept: 'Design', salary: '54000' },
    { name: 'Devendra Joshi', email: 'dev.joshi@gmail.com', phone: '9765412345', dept: 'Sales', salary: '48000' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="Pookiee-card p-6 sm:p-8 bg-gradient-to-r from-teal-50/70 via-white to-blue-50/50 dark:from-teal-950/20 dark:to-blue-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-950 font-bold text-xs">
              <UploadCloud className="size-4" />
            </span>
            <span className="text-xs font-bold text-slate-400">Bulk Data Ingestion</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
            Smart Excel & CSV Data Import
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-1">
            Bulk ingest employee records, biometrics and salary adjustments with automatic column mapping.
          </p>
        </div>
      </div>

      {/* Row 1: Upload Area (Blue robotic cat dragging spreadsheet) */}
      <div className="Pookiee-card p-6 relative overflow-hidden">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
          <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
            <FileSpreadsheet className="size-4 text-emerald-600" />
            <span>Upload Spreadsheet File</span>
          </h3>
          <span className="text-xs text-slate-400 font-semibold">.xlsx, .csv, .xls supported</span>
        </div>

        <div className="border-2 border-dashed border-blue-200 dark:border-blue-900/60 rounded-3xl p-8 text-center bg-blue-50/20 dark:bg-blue-950/10 hover:bg-blue-50/40 transition cursor-pointer relative flex flex-col items-center justify-center">
          <div className="size-16 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center mb-3">
            <UploadCloud className="size-8 text-[#1d5cc8]" />
          </div>
          <p className="font-black text-sm text-slate-800 dark:text-white">
            Drag and drop your staff roster file here, or click to browse
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Maximum file size: 25 MB • Pre-formatted template available
          </p>

          {/* Blue robotic cat dragging spreadsheet in upload area */}
          <div className="absolute bottom-2 right-4 flex items-center gap-2 pointer-events-none">
            <span className="text-[10.5px] font-bold text-slate-400">Auto-detecting headers</span>
            <img src="/mascots/bluecat.png" alt="Bluecat Dragging File" className="size-14 object-contain anim-float-subtle" />
          </div>
        </div>
      </div>

      {/* Row 2: Column Mapping (Schoolgirl connecting columns) & Validation Errors (Schoolboy looking at warning) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Column Mapping: Schoolgirl connecting columns with arrows */}
        <div className="Pookiee-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                Column Mapping Assistant
              </h3>
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                5 Columns Matched
              </span>
            </div>

            <div className="space-y-2.5 pt-4 text-xs">
              {[
                { source: 'Full_Name_Column', target: 'employee.name' },
                { source: 'Work_Email_Address', target: 'employee.email' },
                { source: 'Phone_Digits', target: 'employee.phone' },
                { source: 'Dept_Code', target: 'employee.dept' },
                { source: 'Gross_Salary_INR', target: 'employee.salary' },
              ].map((map) => (
                <div
                  key={map.source}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800"
                >
                  <span className="font-mono text-slate-600 dark:text-slate-300 font-bold">
                    {map.source}
                  </span>
                  <ArrowRight className="size-3 text-[#1d5cc8]" />
                  <span className="font-bold text-[#1d5cc8] bg-blue-50 px-2 py-0.5 rounded-md">
                    {map.target}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Schoolgirl mascot */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Schema mapper active</span>
              <img src="/mascots/schoolgirl.png" alt="Schoolgirl Mapping" className="size-14 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>

        {/* Validation Errors: Funny schoolboy looking at warning icon */}
        <div className="Pookiee-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-500" />
                <span>Pre-Import Validation Check</span>
              </h3>
              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                1 Warning Found
              </span>
            </div>

            <div className="space-y-3 pt-4 text-xs">
              <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200">
                <p className="font-bold text-amber-800 dark:text-amber-200">
                  Missing IFSC for Row #14 (Devendra Joshi)
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Default bank placeholder will be applied until updated by employee profile.
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200">
                <p className="font-bold text-emerald-800 dark:text-emerald-200">
                  Zero Duplicate Emails
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  All 125 parsed rows contain unique valid organizational email addresses.
                </p>
              </div>
            </div>
          </div>

          {/* Schoolboy looking at warning mascot */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Reviewing warning exceptions</span>
              <img src="/mascots/schoolboy.png" alt="Schoolboy Warning" className="size-14 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Spreadsheet Preview (Panda sitting beside spreadsheet) */}
      <div className="Pookiee-card p-6 relative overflow-hidden">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
          <div className="flex items-center gap-3">
            <img src="/mascots/panda.png" alt="Panda Spreadsheet" className="size-10 object-contain" />
            <div>
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                Live Spreadsheet Data Preview
              </h3>
              <p className="text-[11px] text-slate-400">First 3 rows parsed from {uploadedFile}</p>
            </div>
          </div>

          {/* Successful Import Button with Blonde character */}
          <button
            onClick={() => setStep('success')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition shadow-sm"
          >
            <CheckCircle2 className="size-4" />
            <span>Commit & Import 125 Rows</span>
          </button>
        </div>

        {/* Clean data table without cartoons inside */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-[11px] font-extrabold text-slate-500 uppercase">
              <tr>
                <th className="p-2.5">Candidate Name</th>
                <th className="p-2.5">Email</th>
                <th className="p-2.5">Phone</th>
                <th className="p-2.5">Department</th>
                <th className="p-2.5">Gross Salary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sampleRows.map((r) => (
                <tr key={r.email} className="hover:bg-slate-50/50">
                  <td className="p-2.5 font-bold text-slate-800 dark:text-white">{r.name}</td>
                  <td className="p-2.5 text-slate-500">{r.email}</td>
                  <td className="p-2.5 font-mono text-slate-500">{r.phone}</td>
                  <td className="p-2.5 text-slate-600 font-semibold">{r.dept}</td>
                  <td className="p-2.5 font-bold text-emerald-600">₹{Number(r.salary).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Success celebratory banner when committed */}
        {step === 'success' && (
          <div className="mt-4 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 flex items-center justify-between gap-4 anim-fade-up">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-6 text-emerald-600 shrink-0" />
              <div>
                <p className="font-black text-sm text-emerald-800 dark:text-emerald-200">
                  Import Completed Successfully!
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  125 employee records were synchronized and created in the main directory.
                </p>
              </div>
            </div>
            {/* Blonde character celebrating beside green checkmark */}
            <img src="/mascots/blonde.png" alt="Blonde Celebrating Import" className="size-14 object-contain" />
          </div>
        )}
      </div>
    </div>
  )
}
