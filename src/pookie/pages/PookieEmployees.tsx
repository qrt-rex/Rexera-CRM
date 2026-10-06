import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Users,
  Search,
  Filter,
  UserPlus,
  Eye,
  Edit3,
  Phone,
  Mail,
  Building,
  CheckCircle,
  Clock,
  Sparkles,
  ArrowUpDown,
} from 'lucide-react'
import { INITIAL_EMPLOYEES, Employee } from '../data'

export default function PookieEmployees() {
  const [employees, setEmployees] = useState<Employee[]>(INITIAL_EMPLOYEES)
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')

  const filtered = employees.filter((emp) => {
    const matchesSearch =
      emp.name.toLowerCase().includes(search.toLowerCase()) ||
      emp.role.toLowerCase().includes(search.toLowerCase()) ||
      emp.dept.toLowerCase().includes(search.toLowerCase()) ||
      emp.id.toLowerCase().includes(search.toLowerCase())
    const matchesDept = deptFilter === 'All' || emp.dept === deptFilter
    const matchesStatus = statusFilter === 'All' || emp.status === statusFilter
    return matchesSearch && matchesDept && matchesStatus
  })

  const departments = ['All', ...new Set(employees.map((e) => e.dept))]

  return (
    <div className="space-y-6">
      {/* Header with Blue Robotic Cat sitting beside Employees title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#12192e] p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs relative overflow-hidden">
        <div className="flex items-center gap-4 relative z-10">
          <div className="size-14 rounded-2xl bg-blue-50 dark:bg-blue-950 flex items-center justify-center relative shrink-0">
            <img
              src="/mascots/bluecat.png"
              alt="Blue Cat Mascot"
              className="size-12 object-contain"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
                Employees Directory
              </h1>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-[#1d5cc8] dark:bg-blue-950 dark:text-blue-300">
                {employees.length} Team Members
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-400 mt-0.5">
              Manage personnel records, departments, bank status and contracts
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 relative z-10">
          <Link
            to="/hr/employees/new"
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-[#1d5cc8] hover:bg-[#184ea8] text-white text-xs font-bold transition shadow-sm hover:shadow"
          >
            <UserPlus className="size-4" />
            <span>Add Employee</span>
          </Link>
        </div>

        {/* Subtle decorative cloud behind */}
        <div className="absolute top-0 right-1/4 w-32 h-16 bg-blue-50/50 dark:bg-blue-900/10 rounded-full blur-xl pointer-events-none" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Directory Table (3 cols on large screen) */}
        <div className="lg:col-span-3 space-y-4">
          {/* Filter Bar */}
          <div className="Pookie-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, ID, or designation..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-xs focus:outline-none focus:border-[#1d5cc8]"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Dept filter */}
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                {departments.map((d) => (
                  <option key={d} value={d}>
                    Dept: {d}
                  </option>
                ))}
              </select>

              {/* Status filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                <option value="All">Status: All</option>
                <option value="Active">Active</option>
                <option value="On Leave">On Leave</option>
                <option value="Probation">Probation</option>
              </select>
            </div>
          </div>

          {/* Employee Table */}
          <div className="Pookie-card overflow-hidden">
            {filtered.length === 0 ? (
              /* Empty State matching spec: Blue cat looking through magnifying glass */
              <div className="py-16 flex flex-col items-center justify-center text-center p-6">
                <div className="size-28 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center mb-4">
                  <img
                    src="/mascots/bluecat.png"
                    alt="Looking for employees"
                    className="size-20 object-contain anim-float-subtle"
                  />
                </div>
                <h3 className="font-extrabold text-base text-slate-800 dark:text-slate-200">
                  No employees found
                </h3>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Try adjusting your search criteria or clear the department filters.
                </p>
                <button
                  onClick={() => {
                    setSearch('')
                    setDeptFilter('All')
                    setStatusFilter('All')
                  }}
                  className="mt-4 px-4 py-2 rounded-xl bg-blue-50 text-[#1d5cc8] text-xs font-bold hover:bg-blue-100 transition"
                >
                  Clear Filters
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">Employee</th>
                      <th className="py-3 px-4">ID</th>
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4">Contact</th>
                      <th className="py-3 px-4">Joined</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filtered.map((emp) => (
                      <tr
                        key={emp.id}
                        className="hover:bg-blue-50/30 dark:hover:bg-blue-950/20 transition duration-150"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={emp.avatar}
                              alt={emp.name}
                              className="size-9 rounded-full object-cover ring-2 ring-slate-100 dark:ring-slate-800"
                            />
                            <div>
                              <Link
                                to={`/hr/employees/${emp.id}`}
                                className="font-bold text-slate-800 dark:text-slate-100 hover:text-[#1d5cc8] transition block"
                              >
                                {emp.name}
                              </Link>
                              <span className="text-[11px] text-slate-400">{emp.role}</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-slate-500">
                          {emp.id}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-600 dark:text-slate-300">
                          {emp.dept}
                        </td>
                        <td className="py-3 px-4 text-slate-500">
                          <div>{emp.email}</div>
                          <div className="text-[10px] text-slate-400">{emp.phone}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-500 font-medium">
                          {emp.joinDate}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold ${
                              emp.status === 'Active'
                                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50'
                                : emp.status === 'On Leave'
                                ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/50'
                                : 'bg-purple-50 text-purple-600 dark:bg-purple-950/50'
                            }`}
                          >
                            <span
                              className={`size-1.5 rounded-full ${
                                emp.status === 'Active'
                                  ? 'bg-emerald-500'
                                  : emp.status === 'On Leave'
                                  ? 'bg-amber-500'
                                  : 'bg-purple-500'
                              }`}
                            />
                            {emp.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Link
                              to={`/hr/employees/${emp.id}`}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-[#1d5cc8] hover:bg-blue-50 dark:hover:bg-blue-950 transition"
                              title="View Profile"
                            >
                              <Eye className="size-4" />
                            </Link>
                            <Link
                              to={`/hr/employees/${emp.id}/edit`}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950 transition"
                              title="Edit Employee"
                            >
                              <Edit3 className="size-4" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right-Side Summary & Mascot Panel matching prompt:
            "Schoolgirl and funny schoolboy holding employee ID cards.
             Panda holding a small employee directory folder." */}
        <div className="space-y-4">
          <div className="Pookie-card p-5 bg-gradient-to-br from-white to-blue-50/40 dark:from-[#151d33] dark:to-blue-950/20 relative overflow-hidden">
            <h3 className="font-black text-sm text-slate-800 dark:text-white mb-2">
              Directory Stats
            </h3>
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-slate-500 font-semibold">Active Staff</span>
                <span className="font-black text-emerald-600">110 Members</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-slate-500 font-semibold">On Leave</span>
                <span className="font-black text-amber-500">12 Members</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-slate-500 font-semibold">Probation</span>
                <span className="font-black text-purple-600">3 Members</span>
              </div>
            </div>

            {/* Right side illustrations: Schoolgirl & Schoolboy with ID cards + Panda with folder */}
            <div className="pt-6 flex items-center justify-around">
              <div className="text-center">
                <img
                  src="/mascots/schoolgirl.png"
                  alt="Schoolgirl Mascot"
                  className="size-16 object-contain mx-auto anim-float-subtle"
                />
                <span className="text-[10px] font-bold text-slate-400">ID Verification</span>
              </div>
              <div className="text-center">
                <img
                  src="/mascots/panda.png"
                  alt="Panda Directory"
                  className="size-16 object-contain mx-auto anim-float-subtle"
                />
                <span className="text-[10px] font-bold text-slate-400">Directory Ops</span>
              </div>
            </div>
          </div>

          {/* Quick Departments pill list */}
          <div className="Pookie-card p-5">
            <h4 className="font-black text-xs uppercase tracking-wider text-slate-400 mb-3">
              By Department
            </h4>
            <div className="space-y-2 text-xs">
              {[
                { name: 'Engineering', count: 42, color: 'bg-blue-500' },
                { name: 'Sales & BD', count: 35, color: 'bg-emerald-500' },
                { name: 'Marketing', count: 20, color: 'bg-amber-500' },
                { name: 'Finance & Accounts', count: 16, color: 'bg-purple-500' },
                { name: 'Human Resources', count: 12, color: 'bg-pink-500' },
              ].map((d) => (
                <div key={d.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${d.color}`} />
                    <span className="font-semibold text-slate-600 dark:text-slate-300">
                      {d.name}
                    </span>
                  </div>
                  <span className="font-bold text-slate-400">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
