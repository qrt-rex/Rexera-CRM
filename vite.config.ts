import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { blutecEnv, handleBlutec, type BlutecRequest } from './supabase/functions/_shared/blutec'

/**
 * Local relay for the Blutec dialer/IVR: POST /api/blutec. Reads BLUTEC_* from .env.local on this computer —
 * never VITE_-prefixed, so the keys stay out of the browser bundle. (The live site uses the Supabase function instead.)
 */
function blutecRelay(mode: string): Plugin {
  return {
    name: 'blutec-relay',
    configureServer(server) {
      const env = blutecEnv(loadEnv(mode, process.cwd(), 'BLUTEC_'))
      server.middlewares.use('/api/blutec', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        let raw = ''
        req.on('data', (c) => { raw += c; if (raw.length > 20_000) req.destroy() })
        req.on('end', async () => {
          let body: BlutecRequest
          try { body = JSON.parse(raw || '{}') } catch { res.statusCode = 400; res.end('{"success":false,"message":"Bad JSON"}'); return }
          const r = await handleBlutec(body, env)
          res.statusCode = r.status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(r.body))
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), blutecRelay(mode)],
  server: { port: 5180 },
}))
