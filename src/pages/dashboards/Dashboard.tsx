import type { Role } from '../../lib/types'
import { MediaFeed } from '../../components/MediaFeed'
import { DigitalMediaDashboard } from './DigitalMediaDashboard'
import { SalesDashboard } from './SalesDashboard'
import { AccountsDashboard, LegalDashboard } from './ReviewDashboards'
import { AdminDashboard, OperationsDashboard } from './WorkDashboards'
import { SuperAdminDashboard } from './SuperAdminDashboard'
import { HrDashboard } from './HrDashboard'
import { SupportDashboard } from './SupportDashboards'
import { ItDashboard } from './ItDashboard'
import { BranchDashboard } from './BranchDashboard'

/** A role's dashboard, with the company media (Digital Media → Internal) under it. */
export default function Dashboard({ role }: { role: Role }) {
  // the Digital Media dashboard is the media itself — no separate feed under it
  return <><RoleDashboard role={role} />{role !== 'digitalmedia' && <MediaFeed />}</>
}

function RoleDashboard({ role }: { role: Role }) {
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
    case 'branchdirector': return <BranchDashboard />
    case 'digitalmedia': return <DigitalMediaDashboard />
  }
}
