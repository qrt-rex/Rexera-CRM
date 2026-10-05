import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Mail,
  Phone,
  Building,
  Calendar,
  Shield,
  FileText,
  Download,
  Lock,
  Star,
  CheckCircle,
  TrendingUp,
  Award,
} from 'lucide-react'
import { INITIAL_EMPLOYEES } from '../data'

export default function PokieeEmployeeProfile() {
  const { id } = useParams()
  const employee =
    INITIAL_EMPLOYEES.find((e) => e.id === id) || INITIAL_EMPLOYEES[0]

  const [activeTab, setActiveTab] = useState<'overview' | 'bank' | 'docs' | 'performance'>('overview')

  return (
    <div className="space-y-6">
      {/* Top back navigation */}
      <div className="flex items-center justify-between">
        <Link
          to="/hr/employees"
          className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-[#1d5cc8] transition"
        >
          <ArrowLeft className="size-4" />
          <span>Back to Directory</span>
        </Link>
        <Link
          to={`/hr/employees/${employee.id}/edit`}
          className="px-4 py-2 rounded-xl bg-blue-50 text-[#1d5cc8] text-xs font-bold hover:bg-blue-100 transition"
        >
          Edit Profile
        </Link>
      </div>

      {/* Profile Header Card */}
      <div className="pokiee-card p-6 sm:p-8 relative overflow-hidden bg-gradient-to-r from-white via-white to-blue-50/40 dark:from-[#12192e] dark:to-blue-950/20">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative z-10">
          <div className="flex items-center gap-5">
            <img
              src={employee.avatar}
              alt={employee.name}
              className="size-20 sm:size-24 rounded-3xl object-cover ring-4 ring-white dark:ring-slate-800 shadow-md"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
                  {employee.name}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                  {employee.status}
                </span>
              </div>
              <p className="text-sm font-semibold text-[#1d5cc8]">{employee.role}</p>
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-1">
                <span className="flex items-center gap-1.5 font-mono">
                  <span className="size-1.5 rounded-full bg-slate-400" />
                  {employee.id}
                </span>
                <span className="flex items-center gap-1.5">
                  <Building className="size-3.5 text-slate-400" />
                  {employee.dept}
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="size-3.5 text-slate-400" />
                  Joined {employee.joinDate}
                </span>
              </div>
            </div>
          </div>

          {/* Right Mascot: Small panda holding an ID card beside the profile section */}
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/80 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 shadow-2xs">
            <img
              src="/mascots/panda.png"
              alt="Panda ID"
              className="size-12 object-contain anim-float-subtle"
            />
            <div className="text-right">
              <span className="block text-[10px] font-black uppercase text-slate-400">
                Verified Profile
              </span>
              <span className="text-xs font-bold text-emerald-600 flex items-center gap-1 justify-end">
                <CheckCircle className="size-3.5" />
                Active HR Record
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-t border-slate-100 dark:border-slate-800 mt-6 pt-4">
          {[
            { id: 'overview', label: 'Personal Information' },
            { id: 'bank', label: 'Bank & Statutory Details' },
            { id: 'docs', label: 'Documents & Files' },
            { id: 'performance', label: 'Performance Review' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as never)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === tab.id
                  ? 'bg-[#1d5cc8] text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/60 dark:hover:bg-slate-800/40'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Contents */}
      {activeTab === 'overview' && (
        /* Personal Information: Small schoolgirl illustration with a clipboard */
        <div className="pokiee-card p-6 relative">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-6">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-pink-50 dark:bg-pink-950 flex items-center justify-center">
                <img
                  src="/mascots/schoolgirl.png"
                  alt="Schoolgirl Clipboard"
                  className="size-8 object-contain"
                />
              </div>
              <div>
                <h3 className="font-black text-sm text-slate-800 dark:text-white">
                  Personal & Contact Details
                </h3>
                <p className="text-[11px] text-slate-400">Confidential personal profile data</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Date of Birth
              </span>
              <p className="text-sm font-bold text-slate-800 dark:text-white mt-1">
                {employee.personal.dob}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Gender
              </span>
              <p className="text-sm font-bold text-slate-800 dark:text-white mt-1">
                {employee.personal.gender}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Marital Status
              </span>
              <p className="text-sm font-bold text-slate-800 dark:text-white mt-1">
                {employee.personal.maritalStatus}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Work Email
              </span>
              <p className="text-sm font-bold text-[#1d5cc8] mt-1 flex items-center gap-1.5">
                <Mail className="size-4" />
                {employee.email}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Mobile Number
              </span>
              <p className="text-sm font-bold text-slate-800 dark:text-white mt-1 flex items-center gap-1.5">
                <Phone className="size-4" />
                {employee.phone}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Emergency Contact
              </span>
              <p className="text-sm font-bold text-slate-800 dark:text-white mt-1">
                {employee.personal.emergencyContact}
              </p>
            </div>
            <div className="md:col-span-2 lg:col-span-3 p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Permanent Address
              </span>
              <p className="text-sm font-bold text-slate-800 dark:text-white mt-1">
                {employee.personal.address}
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'bank' && (
        /* Bank Details: Blue robotic cat holding a secure lock.
           Visual message: "Sensitive information protected." */
        <div className="pokiee-card p-6 relative">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-6">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
                <img
                  src="/mascots/bluecat.png"
                  alt="Blue Cat Lock"
                  className="size-8 object-contain"
                />
              </div>
              <div>
                <h3 className="font-black text-sm text-slate-800 dark:text-white">
                  Bank & Payroll Account Details
                </h3>
                <p className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                  <Lock className="size-3" />
                  Sensitive information protected with AES-256 encryption
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Bank Name
              </span>
              <p className="text-sm font-bold text-slate-800 dark:text-white mt-1">
                {employee.bank.bankName}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Account Number
              </span>
              <p className="text-sm font-mono font-bold text-slate-800 dark:text-white mt-1">
                {employee.bank.accountNo}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                IFSC Code
              </span>
              <p className="text-sm font-mono font-bold text-slate-800 dark:text-white mt-1">
                {employee.bank.ifsc}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Income Tax PAN
              </span>
              <p className="text-sm font-mono font-bold text-slate-800 dark:text-white mt-1">
                {employee.bank.pan}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Provident Fund UAN
              </span>
              <p className="text-sm font-mono font-bold text-slate-800 dark:text-white mt-1">
                {employee.bank.uan}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Monthly Basic Salary
              </span>
              <p className="text-sm font-bold text-emerald-600 mt-1">
                ₹{employee.salary.toLocaleString('en-IN')}
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'docs' && (
        /* Documents: Panda organizing documents */
        <div className="pokiee-card p-6 relative">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-6">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-purple-50 dark:bg-purple-950 flex items-center justify-center">
                <img
                  src="/mascots/panda.png"
                  alt="Panda Docs"
                  className="size-8 object-contain"
                />
              </div>
              <div>
                <h3 className="font-black text-sm text-slate-800 dark:text-white">
                  Employee Documents & Attachments
                </h3>
                <p className="text-[11px] text-slate-400">Verified official attachments</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {employee.documents.map((doc) => (
              <div
                key={doc.name}
                className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 flex items-center justify-between hover:bg-white dark:hover:bg-slate-800 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950 text-[#1d5cc8]">
                    <FileText className="size-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate max-w-[150px]">
                      {doc.name}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {doc.size} • {doc.date}
                    </p>
                  </div>
                </div>
                <button
                  className="p-2 rounded-xl text-slate-400 hover:text-[#1d5cc8] hover:bg-blue-50 transition"
                  title="Download File"
                >
                  <Download className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'performance' && (
        /* Performance section: Funny schoolboy holding a small chart */
        <div className="pokiee-card p-6 relative">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-6">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-amber-50 dark:bg-amber-950 flex items-center justify-center">
                <img
                  src="/mascots/schoolboy.png"
                  alt="Schoolboy Chart"
                  className="size-8 object-contain"
                />
              </div>
              <div>
                <h3 className="font-black text-sm text-slate-800 dark:text-white">
                  Quarterly Performance & Milestones
                </h3>
                <p className="text-[11px] text-slate-400">Appraisal scores and manager ratings</p>
              </div>
            </div>
            <div className="flex items-center gap-1 text-amber-500 font-black text-sm">
              <Star className="size-4 fill-amber-400" />
              <span>{employee.rating} / 5.0 Rating</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Key Performance Index (KPI)
              </span>
              <p className="text-xl font-black text-emerald-600 mt-1">94.5%</p>
              <p className="text-[11px] text-slate-500 mt-1">Exceeded target by 14% in Q3</p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Attendance Compliance
              </span>
              <p className="text-xl font-black text-blue-600 mt-1">98.2%</p>
              <p className="text-[11px] text-slate-500 mt-1">0 unexcused leaves recorded</p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Peer Review Sentiment
              </span>
              <p className="text-xl font-black text-purple-600 mt-1">Excellent</p>
              <p className="text-[11px] text-slate-500 mt-1">Strong team mentorship marks</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
