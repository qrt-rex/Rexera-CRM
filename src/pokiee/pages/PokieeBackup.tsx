import { useState } from 'react'
import {
  DatabaseBackup,
  CloudUpload,
  RefreshCw,
  Download,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  HardDrive,
} from 'lucide-react'

export default function PokieeBackup() {
  const [backups, setBackups] = useState([
    { id: 'BKP-20261005-01', date: '05 Oct 2026, 04:00 AM', size: '42.8 MB', type: 'Automated Daily', status: 'Encrypted (AES-256)' },
    { id: 'BKP-20261004-01', date: '04 Oct 2026, 04:00 AM', size: '42.6 MB', type: 'Automated Daily', status: 'Encrypted (AES-256)' },
    { id: 'BKP-20261001-01', date: '01 Oct 2026, 11:30 PM', size: '41.9 MB', type: 'Monthly Snapshot', status: 'Encrypted (AES-256)' },
  ])

  const [creating, setCreating] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null)

  const handleCreateBackup = () => {
    setCreating(true)
    setTimeout(() => {
      const newB: (typeof backups)[0] = {
        id: `BKP-${Date.now().toString().slice(-8)}`,
        date: 'Just now',
        size: '43.1 MB',
        type: 'Manual Snapshot',
        status: 'Encrypted (AES-256)',
      }
      setBackups([newB, ...backups])
      setCreating(false)
      setSuccessMsg('Complete HR snapshot generated and secured in encrypted storage.')
      setTimeout(() => setSuccessMsg(null), 3000)
    }, 1200)
  }

  const handleRestore = (id: string) => {
    setConfirmRestoreId(null)
    setSuccessMsg(`System restored successfully from snapshot ${id}. All records verified.`)
    setTimeout(() => setSuccessMsg(null), 3500)
  }

  return (
    <div className="space-y-6">
      {/* Header: Secure and reliable visual style */}
      <div className="pokiee-card p-6 sm:p-8 bg-gradient-to-r from-slate-50 via-white to-blue-50/50 dark:from-slate-900/40 dark:to-blue-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-xl bg-blue-100 text-[#1d5cc8] dark:bg-blue-950 font-bold text-xs">
              <DatabaseBackup className="size-4" />
            </span>
            <span className="text-xs font-bold text-slate-400">Disaster Recovery & Redundancy</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
            HR Database Backup & Point-in-Time Restore
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-1">
            Immutable snapshots, military-grade encryption, and verified recovery procedures.
          </p>
        </div>

        <button
          onClick={handleCreateBackup}
          disabled={creating}
          className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white text-xs font-bold transition shadow-sm"
        >
          <CloudUpload className="size-4" />
          <span>{creating ? 'Creating Snapshot...' : 'Create Backup Now'}</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 text-emerald-700 font-bold text-xs flex items-center gap-2 border border-emerald-200 anim-fade-up">
          <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Row 1: Backup (Blue cat into cloud) + Restore (Panda with arrow) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Backup Now: Blue cat placing HR data into cloud */}
        <div className="pokiee-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <CloudUpload className="size-4 text-blue-600" />
                <span>Automated Cloud Redundancy</span>
              </h3>
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                Active 24/7
              </span>
            </div>

            <div className="space-y-2 pt-3 text-xs text-slate-600 dark:text-slate-300">
              <p>Daily incremental backups occur automatically at 04:00 AM UTC.</p>
              <p>Snapshots include personnel records, biometric logs, PDF payslips, and compliance challans.</p>
            </div>
          </div>

          {/* Blue cat placing data into secure cloud mascot */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Cloud Sync Active</span>
              <img src="/mascots/bluecat.png" alt="Bluecat Cloud Backup" className="size-12 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>

        {/* Security: Funny schoolboy beside shield */}
        <div className="pokiee-card p-6 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-600" />
                <span>Zero-Knowledge AES-256 Security</span>
              </h3>
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                Encrypted at Rest
              </span>
            </div>

            <div className="space-y-2 pt-3 text-xs text-slate-600 dark:text-slate-300">
              <p>Each backup archive is signed with SHA-256 checksums to detect any corruption.</p>
              <p>Restricted to authorized Super Admin roles with audit logging on every restore.</p>
            </div>
          </div>

          {/* Schoolboy beside shield mascot */}
          <div className="pt-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Military-Grade Vault</span>
              <img src="/mascots/schoolboy.png" alt="Schoolboy Shield" className="size-12 object-contain anim-float-subtle" />
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Snapshots Ledger + Restore (Panda with arrow) + Download (Schoolgirl) */}
      <div className="pokiee-card p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-4">
          <div className="flex items-center gap-3">
            <img src="/mascots/panda.png" alt="Panda Restore" className="size-10 object-contain" />
            <div>
              <h3 className="font-black text-sm text-slate-800 dark:text-white">
                Available Snapshots & Restore Points
              </h3>
              <p className="text-[11px] text-slate-400">Select a point-in-time snapshot to restore or download</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-400">Encrypted Export</span>
            <img src="/mascots/schoolgirl.png" alt="Schoolgirl Download" className="size-10 object-contain" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-[11px] font-extrabold text-slate-500 uppercase">
              <tr>
                <th className="p-3">Snapshot ID</th>
                <th className="p-3">Timestamp</th>
                <th className="p-3">Type</th>
                <th className="p-3">Archive Size</th>
                <th className="p-3">Security Level</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {backups.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50/50">
                  <td className="p-3 font-mono font-bold text-slate-800 dark:text-white">{b.id}</td>
                  <td className="p-3 text-slate-500">{b.date}</td>
                  <td className="p-3 font-semibold text-slate-600 dark:text-slate-300">{b.type}</td>
                  <td className="p-3 font-mono text-slate-600">{b.size}</td>
                  <td className="p-3">
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                      {b.status}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => alert(`Downloading archive ${b.id}...`)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-[#1d5cc8] hover:bg-blue-50 transition"
                        title="Download Encrypted Backup"
                      >
                        <Download className="size-4" />
                      </button>
                      <button
                        onClick={() => setConfirmRestoreId(b.id)}
                        className="px-3 py-1 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 font-bold text-[11px] transition"
                      >
                        Restore
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Warning Modal with neutral mascot illustration */}
      {confirmRestoreId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="pokiee-card max-w-md w-full p-6 bg-white dark:bg-[#12192e] anim-pop space-y-4 text-center">
            <div className="size-16 rounded-full bg-rose-50 dark:bg-rose-950 flex items-center justify-center mx-auto">
              <AlertTriangle className="size-8 text-rose-500" />
            </div>

            <div>
              <h3 className="font-black text-base text-slate-800 dark:text-white">
                Confirm Database Restoration?
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Restoring snapshot <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{confirmRestoreId}</span> will roll back all records created after that date. Current data will be automatically archived.
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setConfirmRestoreId(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRestore(confirmRestoreId)}
                className="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 shadow-sm"
              >
                Proceed with Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
