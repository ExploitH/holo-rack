// Mock CF-Server-Monitor backend. Pure ESM so it runs both inside the Vite dev server
// (real HTTP + WebSocket) and inside the browser for the self-contained demo build.
// Every metric is a deterministic function of (server, time), so history rows, the
// latency windows and live WebSocket samples all agree with each other.

const MB = 1024 * 1024
const GB = 1024 * MB
const DAY = 86400000

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
function vnoise(seed, t) {
  const i = Math.floor(t), f = t - i
  const u = f * f * (3 - 2 * f)
  return hash(seed * 7.31 + i) * (1 - u) + hash(seed * 7.31 + i + 1) * u
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

const REGION_GROUP = {
  HK: '亚太节点', JP: '亚太节点', SG: '亚太节点', KR: '亚太节点', TW: '亚太节点', AU: '亚太节点',
  CN: '中国大陆', US: '北美', CA: '北美', DE: '欧洲', GB: '欧洲', NL: '欧洲', FR: '欧洲', RU: '欧洲'
}
// base latency (ms) from the three CN carriers [ct, cu, cm]
const REGION_PING = {
  HK: [38, 32, 45], JP: [72, 60, 88], SG: [78, 70, 95], KR: [66, 58, 80], TW: [52, 48, 60], AU: [168, 160, 190],
  CN: [12, 18, 22], US: [158, 150, 190], CA: [175, 168, 205], DE: [210, 196, 240], GB: [220, 205, 250],
  NL: [205, 198, 236], FR: [215, 200, 242], RU: [140, 132, 170]
}
const OS_POOL = [
  ['Debian GNU/Linux 12 (bookworm)', '6.1.0-28-amd64'],
  ['Ubuntu 24.04.1 LTS', '6.8.0-49-generic'],
  ['Ubuntu 22.04.5 LTS', '5.15.0-126-generic'],
  ['Alpine Linux v3.20', '6.6.58-0-virt'],
  ['Rocky Linux 9.5 (Blue Onyx)', '5.14.0-503.14.1.el9_5.x86_64'],
  ['Windows Server 2022 Datacenter', '10.0.20348'],
  ['Arch Linux', '6.11.9-arch1-1'],
  ['CentOS Linux 7 (Core)', '3.10.0-1160.el7.x86_64']
]
const CPU_POOL = ['AMD EPYC 7763 64-Core Processor', 'Intel(R) Xeon(R) Platinum 8375C CPU @ 2.90GHz', 'AMD Ryzen 9 7950X 16-Core Processor', 'Intel(R) Xeon(R) Gold 6148 CPU @ 2.40GHz', 'Ampere Altra Neoverse-N1']

const LAYOUT = [['HK', 4], ['JP', 3], ['SG', 2], ['KR', 2], ['TW', 1], ['AU', 1], ['CN', 2], ['US', 5], ['CA', 1], ['DE', 2], ['GB', 1], ['NL', 1], ['FR', 1], ['RU', 1]]

function buildFleet(startedAt) {
  const list = []
  let n = 0
  for (const [region, count] of LAYOUT) {
    for (let k = 1; k <= count; k++) {
      const i = n++
      const seed = i * 13.37 + 1.7
      const r = (o) => hash(seed + o)
      const [os, kernel] = OS_POOL[Math.floor(r(1) * OS_POOL.length)]
      const cores = [1, 2, 2, 4, 4, 8, 16][Math.floor(r(2) * 7)]
      const ramTotal = [512, 1024, 2048, 4096, 8192, 16384][Math.min(5, Math.floor(r(3) * 4) + (cores >= 8 ? 2 : 0))]
      const diskTotal = [10, 20, 40, 60, 100, 200, 500][Math.floor(r(4) * 7)] * 1024
      const name = `${region}-${String(k).padStart(2, '0')}`
      const s = {
        i, seed, region, name,
        id: `mock-${name.toLowerCase()}`,
        os, kernel, cores, ramTotal, diskTotal,
        cpuInfo: CPU_POOL[Math.floor(r(5) * CPU_POOL.length)],
        arch: /Ampere/.test(CPU_POOL[Math.floor(r(5) * CPU_POOL.length)]) ? 'aarch64' : 'x86_64',
        cpuBase: 0.05 + r(6) * 0.32,
        memBase: 0.25 + r(7) * 0.45,
        diskUsed: 0.18 + r(8) * 0.6,
        netBase: (0.08 + Math.pow(r(9), 2.2) * 26) * MB,
        ping: (REGION_PING[region] || [120, 120, 120]).map((p, c) => p * (0.92 + r(10 + c) * 0.2)),
        hasBgp: r(14) > 0.55,
        lossBase: 0,
        uptimeDays: Math.round(2 + Math.pow(r(15), 1.6) * 220),
        price: [3.99, 5, 7.5, 10, 12, 20, 36, 0][Math.floor(r(16) * 8)],
        currency: ['$', '¥', '€', '$'][Math.floor(r(17) * 4)],
        cycle: ['month', 'month', 'quarter', 'year'][Math.floor(r(18) * 4)],
        expireDays: Math.round(15 + r(19) * 300),
        trafficLimitGB: [500, 1000, 2000, 0][Math.floor(r(20) * 4)],
        trafficUsed: 0.08 + r(21) * 0.5,
        offline: false,
        cpuOverride: null
      }
      list.push(s)
    }
  }
  const by = (name) => list.find(s => s.name === name)
  by('CA-01').offline = true
  by('US-04').lossBase = 7
  by('AU-01').ping = [262, 248, 290]
  by('SG-02').expireDays = 2
  by('DE-02').expireDays = 5
  by('HK-03').cpuOverride = 0.9
  by('JP-02').uptimeDays = 0.002
  by('KR-01').uptimeDays = 412
  by('HK-02').trafficLimitGB = 1000
  by('HK-02').trafficUsed = 0.94
  for (const s of list) {
    s.bootTime = startedAt - s.uptimeDays * DAY
    s.expireDate = new Date(startedAt + s.expireDays * DAY).toISOString().slice(0, 10)
  }
  return list
}

function metricsAt(s, t, lossy = true) {
  const sec = t / 1000
  const slow = vnoise(s.seed + 1, sec / 90), mid = vnoise(s.seed + 2, sec / 14), fast = vnoise(s.seed + 3, sec / 2.5)
  let cpu = s.cpuBase + (slow - 0.5) * 0.3 + (mid - 0.5) * 0.18 + (fast - 0.5) * 0.08
  if (s.cpuOverride != null) cpu = s.cpuOverride + (mid - 0.5) * 0.1 + (fast - 0.5) * 0.06
  cpu = clamp(cpu, 0.004, 1)
  const mem = clamp(s.memBase + (vnoise(s.seed + 4, sec / 300) - 0.5) * 0.12 + cpu * 0.08, 0.05, 0.98)
  const burst = Math.pow(vnoise(s.seed + 5, sec / 20), 3) * 3
  const netIn = s.netBase * (0.35 + vnoise(s.seed + 6, sec / 8) * 0.9 + burst)
  const netOut = s.netBase * 0.45 * (0.3 + vnoise(s.seed + 7, sec / 9) * 1.1 + burst * 0.6)
  const ping = {}
  const loss = {}
  ;['ct', 'cu', 'cm', 'bd'].forEach((c, ci) => {
    if (c === 'bd' && !s.hasBgp) { ping[c] = false; loss[c] = false; return }
    const base = c === 'bd' ? Math.min(...s.ping) * 0.9 : s.ping[ci]
    const jitter = (vnoise(s.seed + 10 + ci, sec / 40) - 0.5) * base * 0.18 + (vnoise(s.seed + 20 + ci, sec / 6) - 0.5) * 6
    const l = s.lossBase > 0
      ? clamp(s.lossBase + (vnoise(s.seed + 30 + ci, sec / 30) - 0.5) * 8, 0, 40)
      : (vnoise(s.seed + 30 + ci, sec / 60) > 0.93 ? 1 : 0)
    const timeout = lossy && s.lossBase > 0 && hash(s.seed + ci + Math.floor(sec / 30)) > 0.86
    ping[c] = timeout ? null : Math.round(base + jitter)
    loss[c] = Math.round(l * 10) / 10
  })
  const io = Math.pow(vnoise(s.seed + 8, sec / 5), 2)
  return {
    cpu: Math.round(cpu * 1000) / 10,
    ram_total: s.ramTotal,
    ram_used: Math.round(s.ramTotal * mem),
    swap_total: s.ramTotal >= 2048 ? 1024 : 512,
    swap_used: Math.round((s.ramTotal >= 2048 ? 1024 : 512) * clamp(mem - 0.6, 0, 1) * 0.6),
    net_in_speed: Math.round(netIn),
    net_out_speed: Math.round(netOut),
    ping, loss,
    disk: {
      read_bps: Math.round(io * 42 * MB * (0.3 + cpu)),
      write_bps: Math.round(io * 18 * MB * (0.4 + cpu)),
      read_iops: Math.round(io * 900),
      write_iops: Math.round(io * 420),
      await_ms: Math.round((0.4 + io * 6) * 10) / 10,
      util: Math.round(clamp(io * 70 + cpu * 15, 0.2, 99) * 10) / 10
    },
    load: [cpu * s.cores * 1.1, cpu * s.cores * 0.95, cpu * s.cores * 0.85]
  }
}

export function createMockBackend(opts = {}) {
  const startedAt = Date.now()
  const fleet = buildFleet(startedAt)
  const byId = new Map(fleet.map(s => [s.id, s]))
  const options = {
    isPublic: opts.isPublic !== false,
    turnstile: !!opts.turnstile,
    title: opts.title || 'HOLO RACK Demo',
    themeOptions: opts.themeOptions || {}
  }
  const lastSeen = (s, now) => (s.offline ? startedAt - 25 * 60000 : now - 1200)

  function reportFields(s, t) {
    const m = metricsAt(s, t)
    const uptimeSec = Math.max(1, (t - s.bootTime) / 1000)
    const rxTotal = s.netBase * 0.9 * uptimeSec
    const monthFrac = new Date(t).getUTCDate() / 30
    const limit = s.trafficLimitGB * GB
    return {
      cpu: m.cpu,
      load_avg: m.load.map(v => v.toFixed(2)).join(' '),
      net_in_speed: m.net_in_speed,
      net_out_speed: m.net_out_speed,
      net_rx: Math.round(rxTotal),
      net_tx: Math.round(rxTotal * 0.46),
      net_rx_monthly: Math.round(limit ? limit * s.trafficUsed * 0.62 : s.netBase * 0.9 * 86400 * 30 * monthFrac),
      net_tx_monthly: Math.round(limit ? limit * s.trafficUsed * 0.38 : s.netBase * 0.4 * 86400 * 30 * monthFrac),
      processes: Math.round(80 + s.cores * 22 + m.cpu * 2),
      tcp_conn: Math.round(20 + m.net_in_speed / MB * 40),
      udp_conn: Math.round(3 + hash(s.seed + 40) * 10),
      ping_ct: m.ping.ct, ping_cu: m.ping.cu, ping_cm: m.ping.cm, ping_bd: m.ping.bd,
      ping_node_1: false, ping_node_2: false, ping_node_3: false, ping_node_4: false,
      loss_ct: m.loss.ct, loss_cu: m.loss.cu, loss_cm: m.loss.cm, loss_bd: m.loss.bd,
      loss_node_1: false, loss_node_2: false, loss_node_3: false, loss_node_4: false,
      ram_total: m.ram_total, ram_used: m.ram_used,
      swap_total: m.swap_total, swap_used: m.swap_used,
      disk_total: s.diskTotal, disk_used: Math.round(s.diskTotal * s.diskUsed),
      disk: m.disk,
      gpu_info: s.cores >= 16 ? [{ id: '0', name: 'NVIDIA RTX A4000', info: Math.round(m.cpu * 0.8 * 10) / 10 }] : []
    }
  }

  function staticFields(s) {
    return {
      id: s.id,
      name: s.name,
      server_group: REGION_GROUP[s.region] || 'Default',
      tags: s.cores >= 8 ? 'prod,compute' : 'edge',
      price: s.price ? s.price.toFixed(2) : '0',
      billing_cycle: s.cycle,
      auto_renewal: '0',
      currency: s.currency,
      expire_date: s.expireDate,
      traffic_limit: s.trafficLimitGB ? `${s.trafficLimitGB}GB` : '',
      traffic_calc_type: 'total',
      reset_day: 1,
      report_interval: 60,
      wss_report_interval: 2,
      is_hidden: '0',
      sort_order: s.i,
      cpu_cores: s.cores,
      cpu_info: s.cpuInfo,
      arch: s.arch,
      os: s.os,
      kernel_version: s.kernel,
      region: s.region,
      ip_v4: '1',
      ip_v6: hash(s.seed + 50) > 0.5 ? '1' : '0',
      boot_time: String(Math.round(s.bootTime)),
      agent_version: '1.3.3'
    }
  }

  function serverRow(s, now) {
    const t = s.offline ? lastSeen(s, now) : now
    const row = { ...staticFields(s), ...reportFields(s, t), last_updated: lastSeen(s, now), timestamp: lastSeen(s, now) }
    row.gpu_info = JSON.stringify(row.gpu_info)
    return row
  }

  function windowArrays(s, now) {
    const ping = [], loss = []
    for (let k = 19; k >= 0; k--) {
      const ts = now - k * 6 * 60000 - 20000
      if (s.offline && ts > lastSeen(s, now)) continue
      const m = metricsAt(s, ts)
      ping.push({ ts, ...m.ping })
      loss.push({ ts, ...m.loss })
    }
    return { ping, loss }
  }

  function liveSamples(s, now, count = 2, gapMs = 1000) {
    const samples = []
    for (let k = count - 1; k >= 0; k--) {
      const ts = now - k * gapMs
      const m = metricsAt(s, ts)
      samples.push({
        ts,
        data: {
          cpu: m.cpu, ram_total: m.ram_total, ram_used: m.ram_used,
          swap_total: m.swap_total, swap_used: m.swap_used,
          net_in_speed: m.net_in_speed, net_out_speed: m.net_out_speed
        }
      })
    }
    Object.assign(samples[samples.length - 1].data, reportFields(s, now))
    return samples
  }

  function authState(headers = {}) {
    const get = (k) => headers[k] || headers[k.toLowerCase()] || ''
    const auth = /Bearer\s+mock-jwt/.test(get('Authorization'))
    const ts = get('X-Turnstile-Token'), tv = get('X-Turnstile-Verified')
    return { auth, turnstileOk: !options.turnstile || !!ts || tv === 'mock-verified', freshToken: !!ts }
  }
  const json = (status, body) => ({ status, body })
  const guard = (headers) => {
    const a = authState(headers)
    if (!options.isPublic && !a.auth) return json(401, { error: 'Unauthorized', code: 401 })
    if (!a.turnstileOk) return json(403, { error: 'Turnstile verification required', code: 403 })
    return null
  }

  function handle(method, path, query, headers, body) {
    const now = Date.now()
    if (path === '/api/config') {
      const a = authState(headers)
      return json(200, {
        version: '2.8.7 Beta7',
        is_public: options.isPublic,
        authorization: a.auth,
        turnstile_enabled: options.turnstile,
        turnstile_login_enabled: options.turnstile,
        turnstile_site_key: options.turnstile ? '1x00000000000000000000AA' : '',
        custom_ct_name: '电信', custom_cu_name: '联通', custom_cm_name: '移动', custom_bd_name: 'BGP',
        node_1_name: 'Node 1', node_2_name: 'Node 2', node_3_name: 'Node 3', node_4_name: 'Node 4',
        site_title: options.title,
        display_mode: 'bar',
        preferred_theme: 'auto',
        default_language: 'auto',
        theme_options: options.themeOptions,
        verified: options.turnstile ? a.turnstileOk : false,
        turnstile_verified: options.turnstile && a.freshToken ? 'mock-verified' : null,
        frontend_ws_timeout_minutes: 0,
        long_history_points: 120,
        latency_window: { points: 20, hours: 2 }
      })
    }
    if (path === '/api/theme_options' && method === 'POST') {
      if (!authState(headers).auth) return json(401, { error: 'Unauthorized', code: 401 })
      const next = body && typeof body.theme_options === 'object' && !Array.isArray(body.theme_options) ? body.theme_options : null
      if (!next) return json(400, { error: 'invalidThemeOptionsFormat', code: 400 })
      options.themeOptions = next
      return json(200, { success: true, theme_options: next, message: 'updateSuccess' })
    }
    const denied = guard(headers)
    if (denied) return denied
    if (path === '/api/servers') {
      const servers = fleet.map(s => ({ ...serverRow(s, now), ...windowArrays(s, now) }))
      const online = fleet.filter(s => !s.offline)
      const regionStats = {}
      for (const s of fleet) regionStats[s.region] = (regionStats[s.region] || 0) + 1
      return json(200, {
        servers,
        latestReportUpdates: online.map(s => ({ serverId: s.id, reportTs: now - 900, reportAgeMs: 900, samples: liveSamples(s, now - 900) })),
        stats: {
          total: fleet.length,
          online: online.length,
          offline: fleet.length - online.length,
          globalSpeedIn: servers.filter((_, i) => !fleet[i].offline).reduce((a, s) => a + s.net_in_speed, 0),
          globalSpeedOut: servers.filter((_, i) => !fleet[i].offline).reduce((a, s) => a + s.net_out_speed, 0),
          globalNetRx: servers.reduce((a, s) => a + s.net_rx, 0),
          globalNetTx: servers.reduce((a, s) => a + s.net_tx, 0)
        },
        regionStats,
        sysConfig: {
          show_price: true, show_expire: true, show_tf: true, show_three_net_details: true,
          custom_ct_name: '电信', custom_cu_name: '联通', custom_cm_name: '移动', custom_bd_name: 'BGP',
          node_1_name: 'Node 1', node_2_name: 'Node 2', node_3_name: 'Node 3', node_4_name: 'Node 4',
          display_mode: 'bar', latency_window: { points: 20, hours: 2 }
        }
      })
    }
    if (path === '/api/server') {
      const s = byId.get(query.id)
      if (!query.id) return json(400, { error: 'Missing ID', code: 400 })
      if (!s) return json(404, { error: 'Server not found', code: 404 })
      return json(200, {
        ...serverRow(s, now),
        latestReportUpdates: s.offline ? [] : [{ serverId: s.id, reportTs: now - 900, reportAgeMs: 900, samples: liveSamples(s, now - 900) }],
        sysConfig: { long_history_points: 120 }
      })
    }
    if (path === '/api/history/all') {
      const s = byId.get(query.id)
      if (!s) return json(404, { error: 'Server not found', code: 404 })
      const hours = Number(query.hours || 24)
      if (![0.167, 0.5, 1, 6, 12, 24, 48, 96, 168].includes(hours)) return json(400, { error: 'invalid hours', code: 400 })
      if (hours > 24 && !authState(headers).auth) return json(401, { error: 'Unauthorized', code: 401 })
      const points = hours <= 0.167 ? 100 : 120
      const end = s.offline ? lastSeen(s, now) : now
      const start = now - hours * 3600000
      const rows = []
      for (let k = 0; k < points; k++) {
        const ts = Math.round(start + (k / (points - 1)) * (now - start))
        if (ts > end || ts < s.bootTime) continue
        const f = reportFields(s, ts)
        rows.push({
          timestamp: ts,
          cpu: f.cpu, ram_total: f.ram_total, ram_used: f.ram_used, swap_total: f.swap_total, swap_used: f.swap_used,
          disk_total: f.disk_total, disk_used: f.disk_used,
          net_in_speed: f.net_in_speed, net_out_speed: f.net_out_speed,
          processes: f.processes, tcp_conn: f.tcp_conn, udp_conn: f.udp_conn,
          ping_ct: f.ping_ct, ping_cu: f.ping_cu, ping_cm: f.ping_cm, ping_bd: f.ping_bd,
          loss_ct: f.loss_ct, loss_cu: f.loss_cu, loss_cm: f.loss_cm, loss_bd: f.loss_bd,
          disk: f.disk,
          gpu_info: JSON.stringify(f.gpu_info),
          kernel_version: s.kernel
        })
      }
      return json(200, rows)
    }
    return json(404, { error: 'Not Found', code: 404 })
  }

  // ---- WebSocket ----
  function connect(query, headers, send, close) {
    const a = authState(headers)
    const tokenOk = /mock-jwt/.test(query.token || query.auth_token || query.ws_token || '')
    if (!options.isPublic && !a.auth && !tokenOk) { close(1008, 'unauthorized'); return { onMessage() {}, dispose() {} } }
    const scope = String(query.subscribe || 'all')
    let ids = scope === 'all' ? null : new Set([scope])
    send({ type: 'hello', ts: Date.now(), subscribed: scope })
    const tick = () => {
      if (!ids || ids.size === 0) return
      const now = Date.now()
      const updates = []
      for (const id of ids) {
        const s = byId.get(id)
        if (!s || s.offline) continue
        updates.push({ serverId: id, samples: liveSamples(s, now) })
      }
      if (updates.length) send({ type: 'batchUpdate', ts: now, updates })
    }
    const timer = setInterval(tick, 2000)
    return {
      onMessage(msg) {
        if (!msg || typeof msg !== 'object') return
        if (msg.type === 'subscribe' && scope === 'all') {
          ids = new Set(Array.isArray(msg.ids) ? msg.ids.slice(0, 500) : [])
          send({ type: 'subscribed', ts: Date.now(), subscribed: 'all', count: ids.size })
          setTimeout(tick, 300)
        } else if (msg.type === 'ping') {
          send({ type: 'pong', ts: Date.now() })
        }
      },
      dispose() { clearInterval(timer) }
    }
  }

  return { handle, connect, options }
}
