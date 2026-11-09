import { reactive } from 'vue'

export const ONLINE_MS = 300000
const MAX_BUFFER = 600

// Plain (non-reactive) fleet registry. The WebGL scene reads it every frame; the Vue HUD
// re-reads it once per second through `ui.tick`, which keeps DOM updates to ≤ 1 Hz as the
// theme guidelines require, no matter how fast WebSocket batches arrive.
export const fleet = {
  list: [],
  byId: new Map(),
  scope: 'none', // 'all' (home page set) | 'single' (standalone detail page)
  generation: 0 // bumps whenever the set of servers changes (scene rebuilds its layout)
}

export const ui = reactive({
  tick: 0,
  now: Date.now(),
  stats: { total: 0, online: 0, offline: 0, speedIn: 0, speedOut: 0, netRx: 0, netTx: 0 },
  generation: 0
})

const num = (v, d = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}
export const tsOf = (v) => {
  const n = num(v, NaN)
  if (!Number.isFinite(n) || n <= 0) return null
  return n < 1e12 ? n * 1000 : n
}

function makeRecord(raw, base) {
  return {
    id: raw.id,
    base,
    raw: { ...raw },
    reportTs: tsOf(raw.report_timestamp ?? raw.last_updated),
    sampleTs: tsOf(raw.sample_timestamp ?? raw.timestamp ?? raw.last_updated),
    displayTs: null,
    buffer: [],
    online: false,
    pingWindow: Array.isArray(raw.ping) ? raw.ping : [],
    lossWindow: Array.isArray(raw.loss) ? raw.loss : []
  }
}

export function setFleet(rows, scope) {
  fleet.list = []
  fleet.byId.clear()
  for (const { row, base } of rows) {
    if (!row || !row.id || fleet.byId.has(row.id)) continue
    const rec = makeRecord(row, base)
    fleet.list.push(rec)
    fleet.byId.set(rec.id, rec)
  }
  fleet.scope = scope
  fleet.generation++
  ui.generation = fleet.generation
  refresh(Date.now())
}

// Merge a REST refresh into existing records (visibility restore) without rebuilding the scene.
export function patchFleet(rows) {
  for (const { row } of rows) {
    const rec = row && fleet.byId.get(row.id)
    if (!rec) continue
    Object.assign(rec.raw, row)
    rec.reportTs = tsOf(row.last_updated) ?? rec.reportTs
    rec.sampleTs = tsOf(row.timestamp ?? row.last_updated) ?? rec.sampleTs
    if (Array.isArray(row.ping)) rec.pingWindow = row.ping
    if (Array.isArray(row.loss)) rec.lossWindow = row.loss
  }
  refresh(Date.now())
}

function applySample(rec, sample) {
  const d = sample.data
  for (const k in d) {
    const v = d[k]
    if (v !== undefined) rec.raw[k] = v
  }
  rec.sampleTs = sample.ts
}

function drain(rec) {
  const buf = rec.buffer
  while (buf.length && buf[0].ts <= rec.displayTs) applySample(rec, buf.shift())
}

function queueSamples(rec, samples, { cached = false, ageMs = 0 } = {}) {
  const list = samples
    .map(s => {
      const data = s && (s.data || s.payload || s.metrics)
      const ts = tsOf(s?.ts ?? s?.timestamp ?? data?.last_updated ?? data?.timestamp)
      return data && ts ? { ts, data } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts)
  const incoming = cached ? list : list.filter(s => !rec.sampleTs || s.ts > rec.sampleTs)
  if (!incoming.length) return
  const first = incoming[0].ts
  rec.displayTs = cached ? first + Math.max(0, num(ageMs)) : Math.max(first, rec.displayTs || first)
  if (incoming.length === 1) {
    rec.buffer = []
    applySample(rec, incoming[0])
    return
  }
  const seen = new Set()
  rec.buffer = incoming.filter(s => (seen.has(s.ts) ? false : seen.add(s.ts))).slice(-MAX_BUFFER)
  drain(rec)
}

// WebSocket batchUpdate (or REST latestReportUpdates replay when cached = true).
export function ingestUpdates(updates, { cached = false, receivedAt = Date.now() } = {}) {
  if (!Array.isArray(updates)) return
  for (const u of updates) {
    const rec = u && fleet.byId.get(u.serverId)
    if (!rec || !Array.isArray(u.samples)) continue
    if (!cached) rec.reportTs = receivedAt
    queueSamples(rec, u.samples, { cached, ageMs: u.reportAgeMs })
  }
}

let lastTick = Date.now()
export function tick() {
  const now = Date.now()
  const elapsed = Math.max(0, Math.min(now - lastTick, 5000))
  lastTick = now
  for (const rec of fleet.list) {
    if (rec.displayTs && rec.online) rec.displayTs += elapsed
    if (rec.buffer.length) drain(rec)
  }
  refresh(now)
}

function refresh(now) {
  let online = 0, speedIn = 0, speedOut = 0, netRx = 0, netTx = 0
  for (const rec of fleet.list) {
    rec.online = !!rec.reportTs && now - rec.reportTs < ONLINE_MS
    if (rec.online) {
      online++
      speedIn += num(rec.raw.net_in_speed)
      speedOut += num(rec.raw.net_out_speed)
    }
    netRx += num(rec.raw.net_rx)
    netTx += num(rec.raw.net_tx)
  }
  const total = fleet.list.length
  ui.stats = { total, online, offline: total - online, speedIn, speedOut, netRx, netTx }
  ui.now = now
  ui.tick++
}

// Groups for the rack layout. theme_options.group_by: 'group' (server_group) | 'region' | 'none'
export function groupFleet(mode = 'group') {
  const groups = []
  const index = new Map()
  for (const rec of fleet.list) {
    let key
    if (mode === 'none') key = ''
    else if (mode === 'region') key = String(rec.raw.region || '').toUpperCase() || '—'
    else key = String(rec.raw.server_group || '').trim() || 'Default'
    if (!index.has(key)) { index.set(key, groups.length); groups.push({ name: key, ids: [] }) }
    groups[index.get(key)].ids.push(rec.id)
  }
  return groups
}
