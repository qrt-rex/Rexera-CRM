#!/usr/bin/env node
/**
 * export-ivr-leads.mjs — Download every lead from the Blutec IVR / OBD blasts into Excel-safe CSV files.
 *
 * Columns: Name, Number, Email, Dials, State, Calls, Keypress
 * Each file holds at most 1,000,000 rows (Excel's limit is 1,048,576), so 7.8M leads → 8 files.
 *
 *   BLUTEC_IVR_EMAIL=… BLUTEC_IVR_PASSWORD=… node scripts/export-ivr-leads.mjs
 *
 * Sign-in (the same IVR account the CRM server uses), one of:
 *   BLUTEC_IVR_EMAIL + BLUTEC_IVR_PASSWORD   → POST /api/auth/login
 *   BLUTEC_IVR_TOKEN                         → an accessToken copied from a signed-in browser
 *                                              (DevTools → Application → Local Storage → auth-storage)
 * BLUTEC_IVR_URL defaults to https://obd.blutec.ai.
 *
 * Options:
 *   --out <dir>            where the CSV files go (default ./ivr-leads-export)
 *   --path <api path>      list endpoint to read. "{id}" is replaced by each blast's id from GET /api/ivr.
 *                          Default /api/ivr/{id}/broadcast/calls (the endpoint the CRM already uses).
 *                          If the leads table on obd.blutec.ai/ivrs calls another endpoint (see the Network tab
 *                          in DevTools), pass it here, e.g. --path "/api/ivr/{id}/leads" or --path /api/leads
 *   --page-size <n>        rows per request (default 500)
 *   --rows-per-file <n>    rows per CSV (default 1000000)
 *   --probe                print the first page Blutec returns, and how it maps onto the columns, then stop
 *   --fresh                ignore an earlier interrupted run and start again
 *
 * The run can be stopped (Ctrl+C, a dropped connection) and started again with the same command: it carries on
 * from the last page it saved (progress is kept in <out>/.progress.json).
 */
import fs from 'node:fs/promises'
import path from 'node:path'

// ---------------------------------------------------------------------------- options
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt }

const BASE = (process.env.BLUTEC_IVR_URL || 'https://obd.blutec.ai').replace(/\/$/, '')
const OUT = path.resolve(opt('out', 'ivr-leads-export'))
const LIST_PATH = opt('path', '/api/ivr/{id}/broadcast/calls')
const PAGE_SIZE = Math.max(1, Number(opt('page-size', 500)) || 500)
const ROWS_PER_FILE = Math.min(1_048_575, Math.max(1, Number(opt('rows-per-file', 1_000_000)) || 1_000_000))
const PROBE = flag('probe')
const FRESH = flag('fresh')
const PROGRESS = path.join(OUT, '.progress.json')
const COLUMNS = ['Name', 'Number', 'Email', 'Dials', 'State', 'Calls', 'Keypress']

// ---------------------------------------------------------------------------- Blutec API
let token = process.env.BLUTEC_IVR_TOKEN?.trim() || ''

async function login() {
  const email = process.env.BLUTEC_IVR_EMAIL?.trim(), password = process.env.BLUTEC_IVR_PASSWORD?.trim()
  if (!email || !password) throw new Error('Set BLUTEC_IVR_EMAIL and BLUTEC_IVR_PASSWORD (or BLUTEC_IVR_TOKEN).')
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email, password }),
  })
  const j = await res.json().catch(() => ({}))
  const t = j?.data?.accessToken || j?.accessToken || j?.access_token || j?.token
  // a refused sign-in is never retried: repeated attempts lock the Blutec IVR login
  if (!res.ok || !t) throw new Error(`Blutec refused the sign-in (${res.status}): ${j?.message || 'no token returned'}`)
  token = t
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** GET with the token; signs in again once on 401, waits and retries on 429 / 5xx / network errors. */
async function get(p) {
  if (!token) await login()
  let relogged = false
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    } catch (e) {
      if (attempt >= 8) throw e
      await sleep(Math.min(60_000, 2_000 * 2 ** attempt)); continue
    }
    if (res.status === 401 && !relogged && process.env.BLUTEC_IVR_EMAIL) { relogged = true; await login(); continue }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 8) throw new Error(`Blutec answered ${res.status} for ${p} (gave up after ${attempt + 1} tries)`)
      const wait = Number(res.headers.get('retry-after')) * 1000 || Math.min(60_000, 2_000 * 2 ** attempt)
      console.warn(`  ${res.status} on ${p} — waiting ${Math.round(wait / 1000)}s`)
      await sleep(wait); continue
    }
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(`Blutec answered ${res.status} for ${p}: ${body?.message || ''}`)
    return body
  }
}

/** The list of records and the total, wherever they are in the answer (data.items, data.calls, data …). */
function readList(raw) {
  let list = [], total = 0
  const find = (o, depth) => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) { if (!list.length && o.some((x) => x && typeof x === 'object')) list = o; return }
    for (const k of ['total', 'count', 'total_count', 'totalCount', 'total_records', 'totalRecords', 'totalItems'])
      if (!total && o[k] != null && Number.isFinite(Number(o[k]))) total = Number(o[k])
    for (const v of Object.values(o)) if (Array.isArray(v)) find(v, depth)
    if (depth < 3) for (const v of Object.values(o)) if (v && typeof v === 'object' && !Array.isArray(v)) find(v, depth + 1)
  }
  find(raw, 0)
  return { list, total }
}

// ---------------------------------------------------------------------------- record → row
const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '')
const ALIASES = {
  name: ['name', 'leadname', 'fullname', 'customername', 'contactname', 'clientname'],
  number: ['phone', 'phonenumber', 'number', 'mobile', 'mobilenumber', 'mobileno', 'leadphone', 'msisdn', 'destination', 'destinationnumber', 'contact', 'contactnumber'],
  email: ['email', 'emailaddress', 'emailid', 'leademail', 'mail'],
  dials: ['dials', 'dialcount', 'dialscount', 'totaldials', 'attempts', 'attemptcount', 'totalattempts', 'dialattempts', 'timesdialed', 'dialed', 'dialled'],
  state: ['state', 'statename', 'region', 'province'],
  calls: ['calls', 'callcount', 'callscount', 'totalcalls', 'answeredcalls', 'connectedcalls', 'connects', 'connected', 'answered'],
  keypress: ['keypress', 'keypressed', 'digitpressed', 'digit', 'dtmf', 'pressedkey', 'keypresses', 'dispositiondigit', 'key'],
}

const scalar = (v) => {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(scalar).filter(Boolean).join(' ')
  if (typeof v === 'object') return scalar(v.name ?? v.label ?? v.value ?? '')
  return ''
}
const lookup = (objs, names) => {
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue
    const byNorm = new Map(Object.entries(o).map(([k, v]) => [norm(k), v]))
    for (const n of names) { const s = scalar(byNorm.get(n)).trim(); if (s) return s }
  }
  return ''
}
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)

/** Indian mobile as the CRM stores it (10 digits) — Excel shows it as is; other numbers are kept as digits. */
function phone(raw) {
  const d = String(raw).replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) return d.slice(2)
  if (d.length === 11 && d.startsWith('0')) return d.slice(1)
  return d
}

function toRow(r) {
  const lead = obj(r.lead) || obj(r.contact)
  const custom = [obj(lead?.custom_data), obj(lead?.customData), obj(lead?.data), obj(r.custom_data), obj(r.customData), obj(r.data)]
  // who the lead is: the lead's own details first; how the calls went: the record first
  const person = [...custom, lead, r]
  const call = [r, lead, ...custom]
  let name = lookup(person, ALIASES.name)
  if (!name) name = [lookup(person, ['firstname', 'fname']), lookup(person, ['lastname', 'lname'])].filter(Boolean).join(' ')
  return [
    name,
    phone(lookup(call, ALIASES.number)),
    lookup(person, ALIASES.email).toLowerCase(),
    lookup(call, ALIASES.dials),
    // a top-level "state" on a call record is the call's state (answered, failed …), so only the lead's own
    // details are read for it, unless the record is the lead itself
    lookup(lead || custom.some(Boolean) ? person.slice(0, -1) : person, ALIASES.state),
    lookup(call, ALIASES.calls),
    lookup(call, ALIASES.keypress),
  ]
}

// Excel: a cell that starts with = + - @ would be read as a formula
const csvCell = (s) => {
  let v = String(s ?? '')
  if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) v = `'${v}`
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
const csvLine = (cells) => cells.map(csvCell).join(',') + '\r\n'

// ---------------------------------------------------------------------------- output files with resume
const partName = (n) => path.join(OUT, `ivr-leads-part-${String(n).padStart(2, '0')}.csv`)
const HEADER = Buffer.from('﻿' + csvLine(COLUMNS), 'utf8') // BOM so Excel reads Hindi / accented names as UTF-8

let fh = null
let st = null // { sources, si, page, part, rowsInPart, bytes, written }

async function saveProgress() { await fs.writeFile(PROGRESS, JSON.stringify(st)) }

async function openPart(n, resumeAtBytes) {
  if (fh) await fh.close()
  if (resumeAtBytes) {
    fh = await fs.open(partName(n), 'r+')
    await fh.truncate(resumeAtBytes) // drop rows written after the last saved page
  } else {
    fh = await fs.open(partName(n), 'w')
    await fh.write(HEADER)
    st.bytes = HEADER.length
  }
  st.part = n
}

async function writeRows(rows) {
  let i = 0
  while (i < rows.length) {
    if (st.rowsInPart >= ROWS_PER_FILE) { await openPart(st.part + 1, 0); st.rowsInPart = 0 }
    const take = rows.slice(i, i + (ROWS_PER_FILE - st.rowsInPart))
    const buf = Buffer.from(take.map(csvLine).join(''), 'utf8')
    await fh.write(buf, 0, buf.length, st.bytes)
    st.bytes += buf.length
    st.rowsInPart += take.length
    st.written += take.length
    i += take.length
  }
}

// ---------------------------------------------------------------------------- main
async function sources() {
  if (!LIST_PATH.includes('{id}')) return [{ id: null, name: LIST_PATH, path: LIST_PATH }]
  const { list } = readList(await get('/api/ivr'))
  if (!list.length) throw new Error('GET /api/ivr returned no blasts.')
  return list.map((b) => ({ id: b.id, name: scalar(b.name ?? b.title ?? b.id), path: LIST_PATH.replace('{id}', encodeURIComponent(b.id)) }))
}

const pageUrl = (p, page) => `${p}${p.includes('?') ? '&' : '?'}page=${page}&limit=${PAGE_SIZE}`

async function probe() {
  const srcs = await sources()
  console.log(`${srcs.length} source(s); first: ${srcs[0].name} → ${srcs[0].path}`)
  const raw = await get(pageUrl(srcs[0].path, 1))
  const { list, total } = readList(raw)
  console.log(`\nTotal reported: ${total || '(none)'} · records on page 1: ${list.length}`)
  console.log('\nFirst record as Blutec sends it:\n' + JSON.stringify(list[0], null, 2))
  console.log('\nHow the first 5 records map onto the columns:')
  console.table(list.slice(0, 5).map((r) => Object.fromEntries(toRow(r).map((v, i) => [COLUMNS[i], v]))))
  console.log('\nIf a column is empty but the value is in the record above, tell the CRM team the field name so it can be added to ALIASES.')
}

async function run() {
  await fs.mkdir(OUT, { recursive: true })
  const prev = FRESH ? null : await fs.readFile(PROGRESS, 'utf8').then(JSON.parse, () => null)
  if (prev?.done) { console.log(`Already finished: ${prev.written.toLocaleString()} rows in ${OUT}. Use --fresh to download again.`); return }
  if (prev) {
    st = prev
    console.log(`Resuming: ${st.written.toLocaleString()} rows already saved (source ${st.si + 1}/${st.sources.length}, page ${st.page}).`)
    await openPart(st.part, st.bytes)
  } else {
    st = { sources: await sources(), si: 0, page: 1, part: 1, rowsInPart: 0, bytes: 0, written: 0, startedAt: new Date().toISOString() }
    await openPart(1, 0)
    await saveProgress()
  }
  console.log(`Writing to ${OUT} (${ROWS_PER_FILE.toLocaleString()} rows per file).`)

  const t0 = Date.now(), startRows = st.written
  let lastLog = 0
  for (; st.si < st.sources.length; st.si++, st.page = 1) {
    const src = st.sources[st.si]
    for (;;) {
      const { list, total } = readList(await get(pageUrl(src.path, st.page)))
      if (list.length) await writeRows(list.map(toRow))
      const last = !list.length || list.length < PAGE_SIZE || (total && st.page * PAGE_SIZE >= total)
      st.page++
      await saveProgress()
      if (Date.now() - lastLog > 10_000 || last) {
        lastLog = Date.now()
        const rate = (st.written - startRows) / Math.max(1, (Date.now() - t0) / 1000)
        console.log(`  [${st.si + 1}/${st.sources.length}] ${src.name}: page ${st.page - 1}${total ? ` of ${Math.ceil(total / PAGE_SIZE)}` : ''} · ${st.written.toLocaleString()} rows total · ${Math.round(rate)} rows/s · file ${st.part}`)
      }
      if (last) break
    }
  }
  await fh.close()
  st.done = true
  await saveProgress()
  console.log(`\nDone: ${st.written.toLocaleString()} rows in ${st.part} file(s) in ${OUT}`)
}

;(PROBE ? probe() : run()).catch(async (e) => {
  console.error(`\n✖ ${e.message}`)
  if (st && !PROBE) console.error('  Progress is saved — run the same command again to carry on.')
  process.exitCode = 1
})
