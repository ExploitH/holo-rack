// Formatting and field semantics, matching CF-Server-Monitor's default skin.

export const num = (v, d = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

export function formatBytes(bytes, digits = 1) {
  let b = num(bytes)
  if (b <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)))
  i = Math.max(0, i)
  return `${parseFloat((b / Math.pow(1024, i)).toFixed(digits))} ${units[i]}`
}
export const formatRate = (bps) => `${formatBytes(bps)}/s`
export const formatMB = (mb) => formatBytes(num(mb) * 1024 * 1024)
export const pct = (v) => `${Math.round(num(v))}%`

export function formatDuration(ms, t) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}${t.unitDay} ${h}${t.unitHour}`
  if (h > 0) return `${h}${t.unitHour} ${m}${t.unitMin}`
  return `${m}${t.unitMin}`
}

export function uptimeMs(raw, now = Date.now()) {
  const boot = num(raw.boot_time, 0)
  if (!boot) return 0
  return Math.max(0, now - (boot < 1e12 ? boot * 1000 : boot))
}

// ---- ping / loss: false = not configured (hide), null = timeout, number (incl. 0) = valid ----
export const PING_KEYS = ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4']
export const isProbeDisabled = (v) => v === false || v === 'false' || v === undefined
export function probeName(key, names) {
  if (key.startsWith('node_')) return names?.[`${key}_name`] || `Node ${key.slice(5)}`
  return names?.[`custom_${key}_name`] || { ct: '电信', cu: '联通', cm: '移动', bd: 'BGP' }[key]
}
export function pingTone(ms) {
  if (ms === null) return 'bad'
  if (ms < 80) return 'ok'
  if (ms < 160) return 'warn'
  return 'bad'
}
export function probesOf(raw) {
  const out = []
  for (const key of PING_KEYS) {
    const p = raw[`ping_${key}`]
    if (isProbeDisabled(p)) continue
    const l = raw[`loss_${key}`]
    out.push({ key, ping: p === null || p === 'null' ? null : num(p), loss: isProbeDisabled(l) || l === null ? null : num(l) })
  }
  return out
}

// ---- billing / expiry (auto-renewal rolls the date forward, as the default skin does) ----
const CYCLE_MONTHS = { month: 1, quarter: 3, half_year: 6, year: 12, two_years: 24, three_years: 36, four_years: 48, five_years: 60 }
const CYCLE_SHORT = {
  zh: { month: '月', quarter: '季', half_year: '半年', year: '年', two_years: '2年', three_years: '3年', four_years: '4年', five_years: '5年' },
  en: { month: 'mo', quarter: 'qtr', half_year: '6mo', year: 'yr', two_years: '2yr', three_years: '3yr', four_years: '4yr', five_years: '5yr' }
}
function addMonths(dateStr, months) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return dateStr
  const y = +m[1], mo = +m[2] - 1 + months, d = +m[3]
  const ny = y + Math.floor(mo / 12), nm = ((mo % 12) + 12) % 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}
export function effectiveExpireDate(raw, now = Date.now()) {
  let date = String(raw.expire_date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const renew = raw.auto_renewal === '1' || raw.auto_renewal === 1 || raw.auto_renewal === true || raw.auto_renewal === 'true'
  if (!renew) return date
  const today = new Date(now).toISOString().slice(0, 10)
  const months = CYCLE_MONTHS[raw.billing_cycle] || 1
  for (let guard = 0; date <= today && guard < 1200; guard++) date = addMonths(date, months)
  return date
}
export function expireDays(raw, now = Date.now()) {
  const date = effectiveExpireDate(raw, now)
  if (!date) return null
  const t = new Date(date).getTime()
  return Number.isNaN(t) ? null : Math.ceil((t - now) / 86400000)
}
export function formatPrice(raw, lang = 'zh') {
  const n = parseFloat(String(raw.price ?? '').replace(/,/g, ''))
  if (!Number.isFinite(n) || String(raw.price ?? '').trim() === '') return ''
  if (n === 0 || n === -1) return lang === 'zh' ? '免费' : 'Free'
  const cycle = CYCLE_SHORT[lang === 'zh' ? 'zh' : 'en'][raw.billing_cycle] || CYCLE_SHORT.zh.month
  return `${String(raw.currency || '').replace('￥', '¥')}${n.toFixed(2)}/${cycle}`
}

// ---- traffic quota (traffic_limit is GB) ----
export function trafficUsed(raw) {
  const rx = num(raw.net_rx_monthly), tx = num(raw.net_tx_monthly)
  switch (raw.traffic_calc_type) {
    case 'dl': return rx
    case 'ul': return tx
    case 'max': return Math.max(rx, tx)
    default: return rx + tx
  }
}
export function trafficRatio(raw) {
  const limit = parseFloat(raw.traffic_limit) || 0
  return limit > 0 ? trafficUsed(raw) / (limit * 1024 ** 3) : null
}

// ---- GPU (array on live data, JSON string on REST rows) ----
export function gpuList(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v.trim()) { try { const a = JSON.parse(v); return Array.isArray(a) ? a : [] } catch { return [] } }
  return []
}

// ---- OS icon + flag: served by the default skin, never bundled into the theme ----
const OS_ICONS = [
  ['os-alma.svg', ['alma']], ['os-alpine.webp', ['alpine']], ['os-centos.svg', ['centos', 'cent os']],
  ['os-debian.svg', ['debian']], ['os-ubuntu.svg', ['ubuntu', 'elementary']], ['os-macos.svg', ['macos', 'mac os', 'darwin', 'os x']],
  ['os-windows.svg', ['windows', 'win32', 'win64', 'microsoft']], ['os-arch.svg', ['arch']], ['os-kail.svg', ['kali', 'kail']],
  ['os-istore.png', ['istore']], ['os-openwrt.svg', ['openwrt', 'open wrt', 'qwrt', 'kwrt', 'immortalwrt', 'immortal']],
  ['os-nix.svg', ['nixos', 'nix']], ['os-rocky.svg', ['rocky']], ['os-fedora.svg', ['fedora']], ['os-openSUSE.svg', ['suse']],
  ['os-gentoo.svg', ['gentoo']], ['os-redhat.svg', ['redhat', 'rhel', 'red hat']], ['os-mint.svg', ['mint']],
  ['os-manjaro-.svg', ['manjaro']], ['os-armbian.png', ['armbian', 'armbox']], ['os-synology.ico', ['synology', 'dsm']],
  ['os-proxmox.ico', ['proxmox', 'pve']], ['os-alibaba.svg', ['alibaba', 'aliyun', 'alinux', 'anolis']],
  ['os-opencloud.svg', ['opencloud']], ['os-oracle.svg', ['oracle']]
]
export function osFamily(os) {
  const s = String(os || '').toLowerCase()
  if (/windows|microsoft/.test(s)) return 'windows'
  if (/alpine|openwrt|wrt|busybox/.test(s)) return 'embedded'
  if (/debian|ubuntu|mint|elementary/.test(s)) return 'debian'
  if (/centos|rocky|alma|red ?hat|rhel|fedora|oracle|anolis|alibaba|opencloud/.test(s)) return 'rhel'
  return 'other'
}
export function osIcon(os) {
  const s = String(os || '').toLowerCase()
  for (const [file, keys] of OS_ICONS) if (keys.some(k => s.includes(k))) return `/os-icons/${file}`
  return '/os-icons/os-unknown.svg'
}
export function osShort(os) {
  return String(os || '').replace(/\s+gnu\/linux(?=\s|$)/gi, '').replace(/\s+linux(?=\s|$)/gi, '').replace(/\s*\(.*\)\s*/, ' ').trim() || 'N/A'
}
export function flagUrl(region) {
  const code = String(region || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return `/flags/${(code === 'TW' ? 'cn' : code.toLowerCase())}.svg`
}
