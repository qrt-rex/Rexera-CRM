import type { Role } from '../../lib/types'
import { SalesDashboard } from './SalesDashboard'
import { AccountsDashboard, LegalDashboard } from './ReviewDashboards'
import { AdminDashboard, OperationsDashboard } from './WorkDashboards'
import { SuperAdminDashboard } from './SuperAdminDashboard'
import { HrDashboard } from './HrDashboard'
import { SupportDashboard } from './SupportDashboards'
import { ItDashboard } from './ItDashboard'

export default function Dashboard({ role }: { role: Role }) {
  switch (role) {
    case 'sales': return <SalesDashboard lead={false} />
    case 'teamlead': return <SalesDashboard lead />
    case 'accounts': return <AccountsDashboard />
    case 'legal': return <LegalDashboard />
    case 'operations': return <OperationsDashboard />
    case 'admin': return <AdminDashboard />
    case 'hr': return <HrDashboard />
    case 'superadmin': return <SuperAdminDashboard />
    case 'it': return <ItDashboard />
    case 'support': return <SupportDashboard />
  }
}
