import { reactive } from 'vue'
import { initApiBases, getApiBases, adminUrl } from './net/config.js'
import { initTransport } from './net/transport.js'
import { get, getAll, post, STORAGE, store, isLoggedIn } from './net/http.js'
import { solveTurnstile } from './net/turnstile.js'
import { createLiveSocket } from './net/live.js'
import { fleet, setFleet, patchFleet, ingestUpdates } from './store/fleet.js'
import { initLang } from './i18n.js'

const DEFAULT_OPTIONS = { group_by: 'group' }

// Data flow, per CF-Server-Monitor's theme rules:
//   boot          → GET /api/config once (+ Turnstile when enabled)
//   home page     → GET /api/servers once, then WS ?subscribe=all + {type:'subscribe', ids}
//   detail page   → reached from home: reuse the 'all' socket (popup detail)
//                   opened directly: GET /api/server?id + WS ?subscribe=<id>
//   history       → GET /api/history/all only when the detail panel asks for a range
//   tab hidden    → close sockets; visible again → one REST refresh for the current page, reconnect
export const session = reactive({
  phase: 'boot', // boot | gate | ready
  gate: null, // { kind: 'turnstile' | 'login' | 'cors' | 'error' | 'notfound', ... }
  config: null,
  names: {},
  sysConfig: { show_price: true, show_expire: true, show_tf: true, show_three_net_details: true },
  options: { ...DEFAULT_OPTIONS },
  scope: 'none', // 'all' | 'single'
  singleId: null,
  live: 'off', // off | on | retry
  liveTimedOut: false,
  loggedIn: false
})

let configs = []
let sockets = []
let socketStates = []
let hiddenAt = 0

function setGate(gate) {
  session.gate = gate
  session.phase = gate ? 'gate' : 'ready'
}

// ---------- Turnstile ----------
function askTurnstile(siteKey) {
  return new Promise((resolve, reject) => setGate({ kind: 'turnstile', siteKey, solve: (el) => solveTurnstile(el, siteKey).then(resolve, reject) }))
}

async function fetchConfigs() {
  let results = await getAll('/api/config')
  if (results.some(r => r.status === 403 || r.timeout)) {
    store.del(STORAGE.TURNSTILE_TOKEN)
    store.del(STORAGE.TURNSTILE_VERIFIED)
    results = await getAll('/api/config', { turnstileToken: false, turnstileVerified: false })
  }
  return results
}

async function verifyTurnstile() {
  for (let guard = 0; guard < getApiBases().length; guard++) {
    const pending = configs.find(r => r.data && r.data.turnstile_enabled === true && r.data.verified !== true)
    if (!pending) break
    try {
      await askTurnstile(String(pending.data.turnstile_site_key || '').trim())
    } catch {
      setGate({ kind: 'error', key: 'verifyFailed' })
      throw new Error('turnstile')
    }
    const again = await get('/api/config', { base: pending.base })
    if (again.data) configs[pending.index] = { ...again, index: pending.index }
    else break
  }
  setGate(null)
}

export async function boot() {
  initApiBases()
  await initTransport()
  configs = await fetchConfigs()
  const primary = configs.find(r => r.data)
  if (!primary) {
    initLang('auto')
    setGate(configs.some(r => r.cors) ? { kind: 'cors' } : { kind: 'error', key: 'loadFailed', retry: true })
    throw new Error('config')
  }
  const c = primary.data
  session.config = c
  session.names = c
  session.loggedIn = c.authorization === true || isLoggedIn()
  const opts = c.theme_options && typeof c.theme_options === 'object' && !Array.isArray(c.theme_options) ? c.theme_options : {}
  session.options = { ...DEFAULT_OPTIONS, ...opts }
  initLang(c.default_language)
  if (getApiBases().length === 1 && c.site_title) document.title = c.site_title
  await verifyTurnstile()
  session.phase = 'ready'
}

// 401 → the site is private: send the visitor to the built-in admin login.
// 403 → Turnstile credential expired: verify again, then retry once.
async function guarded(fn) {
  let out = await fn()
  if (out.some(r => r.status === 403)) {
    configs = await fetchConfigs()
    await verifyTurnstile()
    out = await fn()
  }
  if (out.every(r => r.status === 401) || (out.some(r => r.status === 401) && !out.some(r => r.data))) {
    const url = adminUrl(0)
    setGate({ kind: 'login', url })
    if (url.startsWith('/') && !location.pathname.startsWith('/admin')) setTimeout(() => location.assign(url), 1600)
    throw new Error('login')
  }
  return out
}

// concurrent callers (route watcher, gate close, visibility) share one in-flight request
const inflight = new Map()
function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key)
  const p = fn().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

// ---------- home: full fleet ----------
export function loadHome(opts = {}) {
  return once(`home|${!!opts.refresh}`, () => loadHomeNow(opts))
}
async function loadHomeNow({ refresh = false } = {}) {
  if (session.scope === 'all' && !refresh) return
  closeSockets()
  const results = await guarded(() => getAll('/api/servers'))
  const ok = results.filter(r => r.data && Array.isArray(r.data.servers))
  if (!ok.length) {
    setGate(results.some(r => r.cors) ? { kind: 'cors' } : { kind: 'error', key: 'loadFailed', retry: true })
    throw new Error('servers')
  }
  const rows = ok.flatMap(r => r.data.servers.map(row => ({ row, base: r.index })))
  if (refresh && session.scope === 'all') patchFleet(rows)
  else setFleet(rows, 'all')
  const sc = ok[0].data.sysConfig
  if (sc) session.sysConfig = { ...session.sysConfig, ...sc }
  for (const r of ok) ingestUpdates(r.data.latestReportUpdates, { cached: true })
  session.scope = 'all'
  session.singleId = null
  openSockets()
}

// ---------- standalone detail ----------
export function loadSingle(id, opts = {}) {
  return once(`single|${id}|${!!opts.refresh}`, () => loadSingleNow(id, opts))
}
async function loadSingleNow(id, { refresh = false } = {}) {
  if (session.scope === 'all' && fleet.byId.has(id)) return true
  if (session.scope === 'single' && session.singleId === id && !refresh) return true
  closeSockets()
  let found = null
  const bases = getApiBases()
  for (let i = 0; i < bases.length && !found; i++) {
    const [r] = await guarded(() => Promise.all([get(`/api/server?id=${encodeURIComponent(id)}`, { base: bases[i] })]))
    if (r.data && r.data.id) found = { row: r.data, base: i }
    else if (r.cors && bases.length === 1) { setGate({ kind: 'cors' }); return false }
  }
  if (!found) {
    if (session.scope !== 'all') { session.scope = 'none'; setFleet([], 'none') }
    return false
  }
  if (refresh && session.scope === 'single') patchFleet([found])
  else setFleet([found], 'single')
  ingestUpdates(found.row.latestReportUpdates, { cached: true })
  session.scope = 'single'
  session.singleId = id
  openSockets()
  return true
}

export async function fetchHistory(id, hours) {
  const rec = fleet.byId.get(id)
  const base = getApiBases()[rec?.base || 0]
  const r = await get(`/api/history/all?id=${encodeURIComponent(id)}&hours=${hours}`, { base })
  if (r.error) {
    const e = new Error(r.message || r.error)
    e.status = r.status
    throw e
  }
  return Array.isArray(r.data) ? r.data : []
}

// ---------- sockets ----------
function updateLive() {
  if (!socketStates.length) { session.live = 'off'; return }
  session.live = socketStates.every(Boolean) ? 'on' : (socketStates.some(Boolean) ? 'on' : 'retry')
}

export function openSockets() {
  closeSockets()
  session.liveTimedOut = false
  const timeoutMinutes = Number(session.config?.frontend_ws_timeout_minutes) || 0
  const onMessage = (msg) => { if (msg.type === 'batchUpdate') ingestUpdates(msg.updates) }
  const onStatus = ({ connected, baseIndex }) => { socketStates[baseIndex] = connected; updateLive() }
  const onTimeout = () => { session.liveTimedOut = true; closeSockets() }
  if (session.scope === 'single' && session.singleId) {
    const base = fleet.byId.get(session.singleId)?.base || 0
    socketStates = []
    socketStates[base] = false
    sockets = [createLiveSocket({ scope: session.singleId, baseIndex: base, timeoutMinutes, onMessage, onStatus, onTimeout })]
  } else if (session.scope === 'all') {
    const byBase = new Map()
    for (const rec of fleet.list) {
      if (!byBase.has(rec.base)) byBase.set(rec.base, [])
      byBase.get(rec.base).push(rec.id)
    }
    socketStates = []
    sockets = [...byBase.entries()].map(([baseIndex, ids]) => {
      socketStates[baseIndex] = false
      return createLiveSocket({ scope: 'all', ids: ids.slice(0, 500), baseIndex, timeoutMinutes, onMessage, onStatus, onTimeout })
    })
  }
  updateLive()
}

export function closeSockets() {
  for (const s of sockets) s.close()
  sockets = []
  socketStates = []
  session.live = 'off'
}

export function keepLive() {
  session.liveTimedOut = false
  openSockets()
}

document.addEventListener('visibilitychange', async () => {
  if (session.phase !== 'ready' || session.liveTimedOut) return
  if (document.hidden) {
    hiddenAt = Date.now()
    closeSockets()
    return
  }
  if (!hiddenAt) return
  hiddenAt = 0
  try {
    if (session.scope === 'all') await loadHome({ refresh: true })
    else if (session.scope === 'single' && session.singleId) await loadSingle(session.singleId, { refresh: true })
  } catch { /* gate already shown */ }
})

// ---------- theme options (requires the admin's JWT) ----------
export async function saveThemeOptions(next) {
  const r = await post('/api/theme_options', { theme_options: next })
  if (r.data?.theme_options) {
    session.options = { ...DEFAULT_OPTIONS, ...r.data.theme_options }
    return true
  }
  return false
}
