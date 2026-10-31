import { useState, type ReactNode } from 'react'
import { MessageCircle } from 'lucide-react'
import { MAX_WHATSAPP_MESSAGE, mayWhatsappClient } from '../../supabase/workflow-rules.mjs'
import type { Booking } from '../lib/types'
import { useMe } from '../lib/auth'
import { rolesOf } from '../lib/rbac'
import { logClientWhatsapp } from '../lib/actions'
import { CLIENT_PORTAL_URL, whatsappClient } from '../lib/share'
import { Button, Modal, Textarea, useToast } from './ui'

/**
 * WhatsApp to the entry's client: Operation, Admin and Legal teams only (the server checks again). `open(body)` starts
 * the message with a greeting and ends it with the client portal link; `node` is the composer to render once.
 */
export function useWhatsappClient(b: Booking): { may: boolean; open: (body?: string) => void; node: ReactNode } {
  const me = useMe()
  const toast = useToast()
  const may = mayWhatsappClient(rolesOf(me))
  const [text, setText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const open = (body = '') => setText(`Dear ${b.contactPerson || b.companyName},\n\n${body}\n\nTrack your file in the Rexera client portal: ${CLIENT_PORTAL_URL}`)
  const send = async () => {
    const msg = (text ?? '').trim()
    if (msg.length < 3) return toast('error', 'Write the message first.')
    setBusy(true)
    try {
      const how = await whatsappClient(b, msg)
      if (how === 'OPENED') logClientWhatsapp(me, b.id, msg)
      toast('success', how === 'SENT' ? `Sent on WhatsApp to ${b.mobile}` : 'WhatsApp opened with the message — press send there')
      setText(null)
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const node = may && (
    <Modal open={text !== null} onClose={() => setText(null)} title="WhatsApp the client" size="md"
      subtitle={`${b.contactPerson || b.companyName} · ${b.mobile || 'no mobile number saved'}`}
      footer={<><Button variant="outline" onClick={() => setText(null)}>Cancel</Button><Button icon={MessageCircle} loading={busy} disabled={!b.mobile} onClick={() => void send()}>Send on WhatsApp</Button></>}>
      {text !== null && <Textarea label="Message" rows={8} maxLength={MAX_WHATSAPP_MESSAGE} value={text} onChange={(e) => setText(e.target.value)}
        hint={`${text.length}/${MAX_WHATSAPP_MESSAGE} · goes to the mobile number saved on this entry. Without an Interakt template (Workflow settings → WhatsApp), WhatsApp opens with the message ready to send.`} />}
    </Modal>
  )
  return { may, open, node }
}

/** The "WhatsApp client" button for the entry's header. Nothing for other teams. */
export function WhatsappClientButton({ b }: { b: Booking }) {
  const wa = useWhatsappClient(b)
  if (!wa.may) return null
  return <><Button variant="outline" icon={MessageCircle} onClick={() => wa.open()}>WhatsApp client</Button>{wa.node}</>
}
