import { ClipboardList } from 'lucide-react'
import { useMe } from '../../lib/auth'
import { rolesOf } from '../../lib/rbac'
import { Card, PageHeader } from '../../components/ui'
import { ClientEntriesPanel } from '../../components/ClientEntry'

/** Every client entry filled in the dialer (a team leader also sees their team's), with when it was entered. */
export default function ClientEntries() {
  const me = useMe()
  const lead = rolesOf(me).includes('teamlead')
  return (
    <div>
      <PageHeader title="Client Entries" icon={ClipboardList}
        subtitle={`${lead ? 'Yours and your team’s' : 'Your'} client entries from the dialer — follow up, then convert to a CRM entry once the payment is received`} />
      <Card className="overflow-hidden"><ClientEntriesPanel lead={lead} full /></Card>
    </div>
  )
}
