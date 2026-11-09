import { expireDays, num, uptimeMs } from '../utils/format.js'

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
// 1 KB/s → ~0.06, 1 MB/s → ~0.6, 100 MB/s → 1
const rateLevel = (bps) => clamp01(Math.log10(1 + num(bps) / 1024) / 5)

function probe(v) {
  if (v === false || v === 'false' || v === undefined) return -1
  if (v === null || v === 'null') return -2
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, n) : -1
}

// Server record → normalized targets the scene eases towards.
export function targetsOf(rec, now, showExpire = true) {
  const r = rec.raw
  const on = rec.online ? 1 : 0
  const ramTotal = num(r.ram_total), diskTotal = num(r.disk_total)
  let io = 0
  if (r.disk && typeof r.disk === 'object') {
    const util = num(r.disk.util, NaN)
    io = Number.isFinite(util) && util > 0 ? clamp01(util / 60) : rateLevel(num(r.disk.read_bps) + num(r.disk.write_bps)) * 0.8
  }
  const upDays = uptimeMs(r, now) / 86400000
  let loss = 0
  for (const k of ['ct', 'cu', 'cm', 'bd']) {
    const l = r[`loss_${k}`]
    if (typeof l === 'number' || (typeof l === 'string' && l !== 'false' && l !== '')) loss = Math.max(loss, num(l))
  }
  const days = showExpire ? expireDays(r, now) : null
  return {
    on,
    cpu: clamp01(num(r.cpu) / 100),
    mem: ramTotal > 0 ? clamp01(num(r.ram_used) / ramTotal) : 0,
    disk: diskTotal > 0 ? clamp01(num(r.disk_used) / diskTotal) : 0,
    rx: rateLevel(r.net_in_speed),
    tx: rateLevel(r.net_out_speed),
    io,
    dust: clamp01(Math.pow(Math.log1p(Math.max(0, upDays)) / Math.log1p(400), 1.4)),
    ping: [probe(r.ping_ct), probe(r.ping_cu), probe(r.ping_cm), probe(r.ping_bd)],
    loss: clamp01(loss / 100) * 100,
    cores: Math.max(1, num(r.cpu_cores, 1)),
    expireDays: days != null && days <= 7 ? days : null
  }
}
