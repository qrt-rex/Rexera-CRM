/**
 * blutecEmbed.mjs — Reverse-proxy the Blutec web dialer inside an iframe with automatic agent login.
 *
 * Flow:
 *  1. CRM backend calls createEmbedSession(agentEmail) → logs into Blutec API as that agent → stores
 *     tokens in a short-lived server-side Map → returns a one-time nonce.
 *  2. Browser renders <iframe src="/btc/agent/dialer?_nonce=<nonce>">.
 *  3. On the first HTML response the proxy injects a <script> that reads the nonce, fetches
 *     /api/blutec-embed-token?nonce=… (one-time endpoint, deletes after use), and writes the auth
 *     object into localStorage["auth-storage"] so Blutec's Zustand store picks it up.
 *  4. Blutec's JS bundle is rewritten on the fly: baseURL "/api" → "/btc/api" so every XHR/fetch
 *     inside the iframe is proxied through our server instead of hitting Blutec's CORS-locked API.
 *  5. /btc/api/* is forwarded to https://dialer.blutec.ai/api/* with the agent's Authorization header.
 *  6. /btc/socket.io/* is handled by a WebSocket upgrade tunnel so real-time events work.
 */

import https from 'node:https'
import http from 'node:http'
import crypto from 'node:crypto'
import { URL } from 'node:url'
import net from 'node:net'

const BLUTEC_ORIGIN = 'https://dialer.blutec.ai'

// ---------------------------------------------------------------------------
// Nonce cache: { nonce → { accessToken, refreshToken, user, expiresAt } }
// Each nonce is valid for 90 seconds and consumed on first use.
// ---------------------------------------------------------------------------
const nonceCache = new Map()

function pruneNonces() {
  const now = Date.now()
  for (const [k, v] of nonceCache) {
    if (now > v.expiresAt) nonceCache.delete(k)
  }
}

// Prune every 2 minutes — lightweight
setInterval(pruneNonces, 120_000).unref()

/**
 * Log in to Blutec as the given agent and return a short-lived nonce.
 * @param {string} agentEmail
 * @param {string} agentPassword  BLUTEC_AGENT_PASSWORD env var
 * @returns {Promise<{ nonce: string; expiresAt: number }>}
 */
export async function createEmbedSession(agentEmail, agentPassword) {
  if (!agentEmail) throw new Error('agentEmail is required')
  if (!agentPassword) throw new Error('BLUTEC_AGENT_PASSWORD is not configured on the server.')

  const loginRes = await fetch(`${BLUTEC_ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: agentEmail, password: agentPassword }),
  })

  if (!loginRes.ok) {
    let msg = `Blutec login failed (${loginRes.status})`
    try { const j = await loginRes.json(); msg = j.message || j.error || msg } catch { /* ignore */ }
    throw new Error(`Blutec login failed for "${agentEmail}": ${msg}. Ensure this email is registered in Blutec with BLUTEC_AGENT_PASSWORD (or set BLUTEC_AGENT_EMAIL in Render if using a shared agent account).`)
  }

  const data = await loginRes.json()
  const accessToken = data.accessToken || data.access_token || data.token
  const refreshToken = data.refreshToken || data.refresh_token || ''
  const user = data.user || {}

  if (!accessToken) throw new Error('Blutec login succeeded but returned no accessToken.')

  const nonce = crypto.randomBytes(24).toString('hex')
  const expiresAt = Date.now() + 90_000 // 90 seconds

  nonceCache.set(nonce, { accessToken, refreshToken, user, expiresAt })
  console.log(`[blutec-embed] Session created for ${agentEmail} → nonce valid 90 s`)

  return { nonce, expiresAt }
}

/**
 * Retrieve and consume a nonce (one-time use).
 * @param {string} nonce
 * @returns {{ accessToken, refreshToken, user } | null}
 */
export function consumeEmbedNonce(nonce) {
  pruneNonces()
  const entry = nonceCache.get(nonce)
  if (!entry || Date.now() > entry.expiresAt) return null
  nonceCache.delete(nonce)
  return { accessToken: entry.accessToken, refreshToken: entry.refreshToken, user: entry.user }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Forward a set of safe request headers from the incoming request. */
function pickHeaders(incomingHeaders, extra = {}) {
  const safe = ['accept', 'accept-language', 'content-type', 'cache-control']
  const out = { ...extra }
  for (const k of safe) {
    if (incomingHeaders[k]) out[k] = incomingHeaders[k]
  }
  return out
}

/** Read the full body of a Node IncomingMessage as a Buffer. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = []
    req.on('data', (c) => parts.push(c))
    req.on('end', () => resolve(Buffer.concat(parts)))
    req.on('error', reject)
  })
}

/**
 * Pipe a fetch Response into a Node ServerResponse, rewriting any absolute Blutec URLs
 * in Location / Content-Location headers to go through /btc/.
 */
async function pipeFetchResponse(fetchRes, res, extraHeaders = {}) {
  const headers = {}
  for (const [k, v] of fetchRes.headers.entries()) {
    const lk = k.toLowerCase()
    // Drop headers that would conflict with our server
    if (['transfer-encoding', 'connection', 'keep-alive', 'content-encoding'].includes(lk)) continue
    // Rewrite redirect Location so the iframe stays inside our proxy
    if (lk === 'location') {
      headers[k] = v.replace(BLUTEC_ORIGIN, '')  // relative redirect stays in iframe
      continue
    }
    headers[k] = v
  }
  // Allow iframe embedding (strip any X-Frame-Options / CSP that would block us)
  delete headers['x-frame-options']
  delete headers['X-Frame-Options']
  delete headers['content-security-policy']
  delete headers['Content-Security-Policy']

  // CORS: allow our origin to call /btc/api/* endpoints
  headers['access-control-allow-origin'] = '*'

  Object.assign(headers, extraHeaders)
  res.writeHead(fetchRes.status, headers)

  const buf = await fetchRes.arrayBuffer()
  res.end(Buffer.from(buf))
}

// ---------------------------------------------------------------------------
// Auth injection script (injected into every HTML page the proxy serves)
// ---------------------------------------------------------------------------

const INJECT_SCRIPT = `
<script>
(function () {
  try {
    var params = new URLSearchParams(location.search);
    var nonce = params.get('_nonce');
    if (!nonce) return;
    // Remove the nonce from the visible URL without a page reload
    params.delete('_nonce');
    var clean = location.pathname + (params.toString() ? '?' + params.toString() : '');
    history.replaceState(null, '', clean);
    // Fetch the tokens from the CRM backend (one-time, server deletes after use)
    fetch('/api/blutec-embed-token?nonce=' + encodeURIComponent(nonce))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        if (!d.accessToken) return;
        var auth = { state: { accessToken: d.accessToken, refreshToken: d.refreshToken || '', user: d.user || {}, isAuthenticated: true }, version: 0 };
        localStorage.setItem('auth-storage', JSON.stringify(auth));
        // Tell the Blutec app to re-check auth without a full reload, if it exposes that hook
        if (typeof window.__getAccessToken === 'function') return;
        // If the SPA is already mounted and watching auth, a storage event triggers it
        window.dispatchEvent(new StorageEvent('storage', { key: 'auth-storage', newValue: JSON.stringify(auth) }));
      })
      .catch(function (e) { console.warn('[rexera-embed] Could not inject Blutec auth:', e); });
  } catch (e) { /* non-critical */ }
})();
</script>
`

// ---------------------------------------------------------------------------
// JS bundle rewrite: redirect /api → /btc/api inside Blutec's own JS
// ---------------------------------------------------------------------------

/**
 * Rewrite Blutec's Axios baseURL from "/api" to "/btc/api" so that
 * all XHR/fetch calls inside the iframe are routed through our proxy.
 *
 * The bundle uses patterns like:  CL="/api"  or  baseURL:"/api"
 */
function rewriteJsBundle(source) {
  // The two known patterns from the bundle analysis; be conservative so we
  // don't accidentally replace unrelated strings.
  return source
    .replace(/\bCL\s*=\s*"\/api"/g, 'CL="/btc/api"')
    .replace(/\bbaseURL\s*:\s*"\/api"/g, 'baseURL:"/btc/api"')
    // Socket.IO path rewrite: io() uses path "/socket.io" by default;
    // rewrite so the WS connection goes to /btc/socket.io
    .replace(/path\s*:\s*"\/socket\.io"/g, 'path:"/btc/socket.io"')
}

// ---------------------------------------------------------------------------
// Main proxy handler — called for every /btc/* request
// ---------------------------------------------------------------------------

/**
 * Handle a proxied request to Blutec's web app.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} agentAccessToken  The agent's current Blutec access token (from Authorization header or nonce flow).
 *                                   May be empty for unauthenticated assets (CSS, fonts, icons).
 */
export async function handleProxy(req, res) {
  try {
    // Strip the /btc prefix to get the real Blutec path
    const rawPath = req.url.replace(/^\/btc/, '') || '/'

    // Build the upstream URL
    const upstreamUrl = `${BLUTEC_ORIGIN}${rawPath}`

    // Determine if this is an API call (needs Authorization forwarding)
    const isApi = rawPath.startsWith('/api/')

    // Read body for POST/PUT/PATCH
    let bodyBuf = null
    const method = req.method || 'GET'
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
      bodyBuf = await readBody(req)
    }

    const forwardHeaders = pickHeaders(req.headers, {
      Host: 'dialer.blutec.ai',
      Origin: BLUTEC_ORIGIN,
      Referer: `${BLUTEC_ORIGIN}/`,
    })

    // Forward the Authorization header for API calls (the iframe sends Bearer tokens)
    if (isApi && req.headers.authorization) {
      forwardHeaders['Authorization'] = req.headers.authorization
    }

    if (bodyBuf && bodyBuf.length > 0) {
      forwardHeaders['Content-Length'] = String(bodyBuf.length)
    }

    const fetchOptions = {
      method,
      headers: forwardHeaders,
      redirect: 'manual', // We handle redirects ourselves
    }
    if (bodyBuf && bodyBuf.length > 0) fetchOptions.body = bodyBuf

    const upstream = await fetch(upstreamUrl, fetchOptions)

    // --- Handle redirects: rewrite Location to stay inside /btc/
    if (upstream.status >= 300 && upstream.status < 400) {
      const loc = upstream.headers.get('location') || ''
      const rewritten = loc.startsWith(BLUTEC_ORIGIN)
        ? '/btc' + loc.slice(BLUTEC_ORIGIN.length)
        : loc.startsWith('/')
          ? '/btc' + loc
          : loc
      res.writeHead(upstream.status, { Location: rewritten })
      return res.end()
    }

    const contentType = (upstream.headers.get('content-type') || '').toLowerCase()

    // --- HTML: inject the auth script
    if (contentType.includes('text/html')) {
      let html = await upstream.text()
      // Inject the auth script just before </head>
      html = html.replace('</head>', `${INJECT_SCRIPT}</head>`)
      // If there's no </head>, inject at the top of <body>
      if (!html.includes(INJECT_SCRIPT)) {
        html = html.replace('<body', `${INJECT_SCRIPT}<body`)
      }
      const buf = Buffer.from(html, 'utf8')
      res.writeHead(upstream.status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(buf.length),
        'Cache-Control': 'no-store',
        'X-Frame-Options': '', // Allow iframe embedding
        'access-control-allow-origin': '*',
      })
      return res.end(buf)
    }

    // --- JS: rewrite baseURL so API calls proxy through /btc/api
    if (contentType.includes('javascript')) {
      const source = await upstream.text()
      const rewritten = rewriteJsBundle(source)
      const buf = Buffer.from(rewritten, 'utf8')
      res.writeHead(upstream.status, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': String(buf.length),
        'Cache-Control': upstream.headers.get('cache-control') || 'public, max-age=3600',
        'access-control-allow-origin': '*',
      })
      return res.end(buf)
    }

    // --- Everything else (CSS, images, fonts, JSON API responses): transparent proxy
    await pipeFetchResponse(upstream, res)
  } catch (err) {
    console.error('[blutec-embed proxy]', err.message)
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
    }
    res.end(`Blutec proxy error: ${err.message}`)
  }
}

// ---------------------------------------------------------------------------
// WebSocket tunnel for Socket.IO (/btc/socket.io/…)
// ---------------------------------------------------------------------------

/**
 * Upgrade handler: tunnel WebSocket connections from /btc/socket.io/* to
 * dialer.blutec.ai so that real-time events (agent status, call rings) work.
 *
 * Call this from the server's 'upgrade' event handler.
 *
 * @param {http.IncomingMessage} req
 * @param {net.Socket} socket
 * @param {Buffer} head
 */
export function handleWsUpgrade(req, socket, head) {
  // Rewrite the path: /btc/socket.io/... → /socket.io/...
  const wssPath = req.url.replace(/^\/btc/, '') || '/'

  const options = {
    hostname: 'dialer.blutec.ai',
    port: 443,
    path: wssPath,
    method: 'GET',
    headers: {
      ...req.headers,
      host: 'dialer.blutec.ai',
      origin: BLUTEC_ORIGIN,
    },
  }

  // Open a TLS tunnel to Blutec's server
  const proxy = https.request(options)

  proxy.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      (proxyRes.headers['sec-websocket-accept'] ? `Sec-WebSocket-Accept: ${proxyRes.headers['sec-websocket-accept']}\r\n` : '') +
      `\r\n`
    )
    proxySocket.write(head)
    proxySocket.pipe(socket)
    socket.pipe(proxySocket)
    proxySocket.on('error', () => socket.destroy())
    socket.on('error', () => proxySocket.destroy())
  })

  proxy.on('error', (err) => {
    console.error('[blutec-embed ws]', err.message)
    socket.destroy()
  })

  proxy.end()
}
