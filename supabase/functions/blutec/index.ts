// Supabase Edge Function: Blutec dialer / IVR relay for the live site.
// Secrets (set once):  supabase secrets set BLUTEC_KEY_ID=… BLUTEC_API_KEY=… BLUTEC_SIGNING_SECRET=… BLUTEC_TOKEN=… BLUTEC_IVR_EMAIL=… BLUTEC_IVR_PASSWORD=…
// Deploy:              supabase functions deploy blutec
// Only signed-in, active CRM staff may use it; IVR campaigns are for the Super Admin only.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { blutecEnv, handleBlutec, type BlutecRequest } from '../_shared/blutec.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const IVR_ACTIONS = ['ivrList', 'ivrStats', 'ivrControl', 'ivrConnects']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { success: false, message: 'POST only' })

  const auth = req.headers.get('Authorization') ?? ''
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: who } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ''))
  if (!who?.user) return json(401, { success: false, message: 'Sign in to the CRM first.' })
  const { data: me } = await sb.from('app_users').select('id, role, email, active').eq('auth_user_id', who.user.id).maybeSingle()
  if (!me?.active) return json(403, { success: false, message: 'Your CRM account is not active.' })

  let body: BlutecRequest
  try { body = await req.json() } catch { return json(400, { success: false, message: 'Bad JSON' }) }
  if (IVR_ACTIONS.includes(body.action) && me.role !== 'superadmin') return json(403, { success: false, message: 'IVR campaigns are for the Super Admin only.' })
  // people can only place calls from their own dialer agent
  if (body.action === 'call') body = { ...body, agentEmail: me.email }

  const r = await handleBlutec(body, blutecEnv(Deno.env.toObject()))
  return json(r.status, r.body)
})
