import { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff, FileText, Globe, Link2, Megaphone, RefreshCw, Send, Unlink } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, IconButton, Input, Modal, Textarea, useRun, useToast } from './ui'
import { cloudConfig, getSupabase } from '../lib/supabase'
import { fmtDateTime } from '../lib/format'
import type { Booking } from '../lib/types'

/**
 * The website client portal (rexera.co.in/portal) for one CRM file: which client accounts can see it,
 * which documents and reports are shared with them (with a remark meant for the client, never the
 * internal note), and updates posted to their dashboard. Everything goes through the portal_staff_*
 * database functions, which check that you can see this file.
 */
type Link = { auth_user_id: string; linked_how: string; linked_at: string; portal_clients: { name: string; email: string; phone: string | null; status: string } | null }
type DocPortal = { id: string; client_visible: boolean; client_note: string | null; uploaded_by_client: string | null; portal_stage: string | null }
type Update = { id: string; title: string; body: string; created_at: string }

const STAGE_LABEL: Record<string, string> = { PRECHECK: 'Pitch Deck', FINANCE: 'Finance', DPR: 'DPR', CERTIFICATION: 'Certification', SUBMISSION: 'Submission' }

async function inviteClient(bookingId: string, email: string) {
  const sb = await getSupabase()
  const { data: { session } } = await sb.auth.getSession()
  const url = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')
  const res = await fetch(`${url}/functions/v1/portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string, Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify({ action: 'invite', bookingId, email }),
  }).catch(() => null)
  const j = await res?.json().catch(() => null) as { ok?: boolean; message?: string } | null
  if (!res?.ok || !j?.ok) throw new Error(j?.message || 'Could not reach the portal server.')
  return j.message ?? 'Done'
}

export function ClientPortalPanel({ b }: { b: Booking }) {
  const run = useRun()
  const toast = useToast()
  const [links, setLinks] = useState<Link[]>([])
  const [docs, setDocs] = useState<Record<string, DocPortal>>({})
  const [updates, setUpdates] = useState<Update[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [invite, setInvite] = useState<string | null>(null)
  const [post, setPost] = useState<{ title: string; body: string } | null>(null)
  const [share, setShare] = useState<{ id: string; name: string; note: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sb = await getSupabase()
      const [l, d, u] = await Promise.all([
        sb.from('portal_client_bookings').select('auth_user_id, linked_how, linked_at, portal_clients(name, email, phone, status)').eq('booking_id', b.id),
        sb.from('booking_documents').select('id, client_visible, client_note, uploaded_by_client, portal_stage').eq('booking_id', b.id),
        sb.from('portal_updates').select('id, title, body, created_at').eq('booking_id', b.id).order('created_at', { ascending: false }),
      ])
      const err = l.error ?? d.error ?? u.error
      if (err) throw new Error(/portal_|does not exist|schema cache/i.test(err.message) ? 'The client portal tables are not set up yet (run the client portal migration).' : err.message)
      setLinks((l.data ?? []) as unknown as Link[])
      setDocs(Object.fromEntries(((d.data ?? []) as DocPortal[]).map((x) => [x.id, x])))
      setUpdates((u.data ?? []) as Update[])
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [b.id])

  useEffect(() => { if (cloudConfig().status === 'ready') void load(); else setLoading(false) }, [load])

  if (cloudConfig().status !== 'ready') {
    return <Card><EmptyState icon={Globe} title="Client portal needs the cloud database" text="Connect Supabase to share files with clients on the website." /></Card>
  }

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { error: e } = await (await getSupabase()).rpc(fn, args)
    if (e) throw new Error(e.message)
  }

  const clientUploads = b.documents.filter((d) => docs[d.id]?.uploaded_by_client)

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="overflow-hidden">
        <CardHeader title="Client access" subtitle="Accounts that see this file on rexera.co.in/portal" icon={Globe}
          action={<div className="flex gap-2">
            <IconButton icon={RefreshCw} label="Refresh" onClick={() => void load()} />
            <Button size="sm" variant="accent" icon={Send} onClick={() => setInvite(b.email || '')}>Invite client</Button>
          </div>} />
        <div className="p-5">
          {error ? <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>
            : loading ? <p className="text-sm text-mute">Loading…</p>
            : !links.length ? <p className="text-sm text-mute">No client account is linked yet. Invite the client, or they can register on the website with {b.email || 'the email on this file'} and it links automatically.</p>
            : (
              <ul className="divide-y divide-line">
                {links.map((l) => (
                  <li key={l.auth_user_id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{l.portal_clients?.name ?? 'Client'}</p>
                      <p className="truncate text-xs text-mute">{l.portal_clients?.email}{l.portal_clients?.phone ? ` · ${l.portal_clients.phone}` : ''} · linked {fmtDateTime(l.linked_at)} ({l.linked_how === 'EMAIL_MATCH' ? 'matching email' : l.linked_how.toLowerCase()})</p>
                    </div>
                    <Badge tone={l.portal_clients?.status === 'ACTIVE' ? 'green' : l.portal_clients?.status === 'SUSPENDED' ? 'red' : 'amber'}>{l.portal_clients?.status?.toLowerCase() ?? '—'}</Badge>
                    <Button size="sm" variant="ghost" icon={Unlink} onClick={() => confirm('Remove this client’s access to this file?') && void run(async () => { await rpc('portal_staff_unlink', { p_client: l.auth_user_id, p_booking: b.id }); await load() }, 'Access removed')}>Remove</Button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Updates for the client" subtitle="Shown on their dashboard, with a notification" icon={Megaphone}
          action={<Button size="sm" variant="outline" icon={Megaphone} onClick={() => setPost({ title: '', body: '' })}>Post update</Button>} />
        <div className="p-5">
          {!updates.length ? <p className="text-sm text-mute">No updates posted yet.</p> : (
            <ul className="space-y-3">
              {updates.slice(0, 8).map((u) => (
                <li key={u.id} className="rounded-xl border border-line p-3">
                  <p className="text-sm font-semibold">{u.title}</p>
                  {u.body && <p className="mt-0.5 whitespace-pre-line text-sm text-mute">{u.body}</p>}
                  <p className="mt-1 text-[11px] text-mute">{fmtDateTime(u.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden xl:col-span-2">
        <CardHeader title="Documents the client sees" subtitle="Share documents and reports (category “Progress report”). Client uploads are always visible to them." icon={FileText} />
        {!b.documents.length ? <div className="p-5"><p className="text-sm text-mute">No documents on this file.</p></div> : (
          <ul className="divide-y divide-line">
            {b.documents.map((d) => {
              const p = docs[d.id]
              const fromClient = !!p?.uploaded_by_client
              const visible = fromClient || !!p?.client_visible
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{d.name}</p>
                    <p className="truncate text-xs text-mute">
                      {d.category}{p?.portal_stage ? ` · ${STAGE_LABEL[p.portal_stage] ?? p.portal_stage}` : ''}{fromClient ? ' · uploaded by the client' : ''}
                      {p?.client_note ? ` · remark: “${p.client_note}”` : ''}
                    </p>
                  </div>
                  <Badge tone={visible ? 'green' : 'gray'}>{visible ? 'Client can see' : 'Internal'}</Badge>
                  {!fromClient && (
                    p?.client_visible
                      ? <Button size="sm" variant="ghost" icon={EyeOff} onClick={() => void run(async () => { await rpc('portal_staff_share_document', { p_doc: d.id, p_visible: false, p_note: null }); await load() }, 'Hidden from the client')}>Hide</Button>
                      : <Button size="sm" variant="outline" icon={Eye} onClick={() => setShare({ id: d.id, name: d.name, note: p?.client_note ?? '' })}>Share</Button>
                  )}
                  {fromClient && <Button size="sm" variant="ghost" onClick={() => setShare({ id: d.id, name: d.name, note: p?.client_note ?? '' })}>Remark</Button>}
                </li>
              )
            })}
          </ul>
        )}
        {clientUploads.length > 0 && <p className="border-t border-line px-5 py-3 text-xs text-mute">Verify or reject client uploads as usual; the client is notified, and sees your remark if you add one.</p>}
      </Card>

      <Modal open={invite !== null} onClose={() => setInvite(null)} title="Invite the client" size="sm"
        subtitle="They get an email to set a password and see this file on the website."
        footer={<><Button variant="outline" onClick={() => setInvite(null)}>Cancel</Button>
          <Button icon={Send} onClick={() => void run(async () => { const msg = await inviteClient(b.id, invite ?? ''); setInvite(null); await load(); return msg }).then((m) => { if (typeof m === 'string') toast('success', m) })}>Send invite</Button></>}>
        <Input label="Client email" type="email" value={invite ?? ''} onChange={(e) => setInvite(e.target.value)} />
      </Modal>

      <Modal open={!!post} onClose={() => setPost(null)} title="Post an update to the client" size="sm"
        footer={<><Button variant="outline" onClick={() => setPost(null)}>Cancel</Button>
          <Button icon={Megaphone} disabled={!post || post.title.trim().length < 2} onClick={() => post && void run(async () => { await rpc('portal_staff_post_update', { p_booking: b.id, p_title: post.title, p_body: post.body }); setPost(null); await load() }, 'Update posted')}>Post</Button></>}>
        <div className="space-y-3">
          <Input label="Title" value={post?.title ?? ''} onChange={(e) => setPost((x) => x && { ...x, title: e.target.value })} maxLength={160} />
          <Textarea label="Message" rows={4} value={post?.body ?? ''} onChange={(e) => setPost((x) => x && { ...x, body: e.target.value })} maxLength={4000}
            hint="The client reads this. Keep internal notes in the timeline." />
        </div>
      </Modal>

      <Modal open={!!share} onClose={() => setShare(null)} title={docs[share?.id ?? '']?.uploaded_by_client ? 'Remark for the client' : 'Share with the client'} size="sm"
        subtitle={share?.name}
        footer={<><Button variant="outline" onClick={() => setShare(null)}>Cancel</Button>
          <Button icon={Link2} onClick={() => share && void run(async () => {
            const fromClient = !!docs[share.id]?.uploaded_by_client
            await rpc('portal_staff_share_document', { p_doc: share.id, p_visible: fromClient ? !!docs[share.id]?.client_visible : true, p_note: share.note })
            setShare(null); await load()
          }, 'Saved')}>Save</Button></>}>
        <Textarea label="Remark for the client (optional)" rows={3} value={share?.note ?? ''} onChange={(e) => setShare((x) => x && { ...x, note: e.target.value })}
          hint="Visible to the client. Leave empty for none." />
      </Modal>
    </div>
  )
}
