import { computed } from 'vue'
import { fleet, ui } from '../store/fleet.js'
import { session } from '../session.js'
import { lang, t } from '../i18n.js'
import { skinAsset } from '../net/config.js'
import {
  num, formatBytes, formatRate, formatMB, formatDuration, uptimeMs, probesOf, probeName, pingTone,
  expireDays, effectiveExpireDate, formatPrice, trafficRatio, trafficUsed, gpuList, osIcon, osShort, flagUrl
} from '../utils/format.js'

const ratio = (a, b) => (num(b) > 0 ? Math.min(1, Math.max(0, num(a) / num(b))) : 0)
const tone = (v) => (v > 0.9 ? 'bad' : v > 0.7 ? 'warn' : 'ok')

// Reactive view-model of one server, refreshed with the 1 Hz UI tick.
export function useServerView(idRef) {
  return computed(() => {
    void ui.tick
    const id = typeof idRef === 'function' ? idRef() : idRef.value ?? idRef
    const rec = fleet.byId.get(id)
    if (!rec) return null
    const r = rec.raw
    const now = ui.now
    const tr = t.value
    const sys = session.sysConfig
    const names = session.names
    const cpu = num(r.cpu) / 100
    const mem = ratio(r.ram_used, r.ram_total)
    const swap = ratio(r.swap_used, r.swap_total)
    const disk = ratio(r.disk_used, r.disk_total)
    const probes = probesOf(r).map(p => ({ ...p, name: probeName(p.key, names), tone: pingTone(p.ping) }))
    const days = sys.show_expire !== false ? expireDays(r, now) : null
    const tRatio = sys.show_tf !== false ? trafficRatio(r) : null
    const worstLoss = probes.reduce((m, p) => Math.max(m, p.loss ?? 0), 0)
    let status = 'ok', statusText = tr.online
    if (!rec.online) { status = 'bad'; statusText = tr.offline }
    else if (probes.some(p => p.ping === null) || worstLoss >= 5) { status = 'warn'; statusText = `${tr.loss} ${worstLoss.toFixed(0)}%` }
    else if (cpu > 0.9) { status = 'warn'; statusText = `CPU ${Math.round(cpu * 100)}%` }
    const io = r.disk && typeof r.disk === 'object' ? r.disk : null
    return {
      id,
      rec,
      name: r.name || id,
      group: r.server_group || '',
      region: String(r.region || '').toUpperCase(),
      flag: skinAsset(flagUrl(r.region), rec.base),
      osIcon: skinAsset(osIcon(r.os), rec.base),
      os: osShort(r.os),
      osFull: r.os || '',
      kernel: r.kernel_version || '',
      arch: r.arch || '',
      cpuModel: r.cpu_info || '',
      cores: num(r.cpu_cores),
      ramText: formatMB(r.ram_total),
      gpus: gpuList(r.gpu_info),
      ipv4: r.ip_v4 === '1' || r.ip_v4 === 1 || r.ip_v4 === true,
      ipv6: r.ip_v6 === '1' || r.ip_v6 === 1 || r.ip_v6 === true,
      agent: r.agent_version || '',
      online: rec.online,
      status, statusText,
      cpu, cpuTone: tone(cpu),
      mem, memTone: tone(mem), memText: `${formatMB(r.ram_used)} / ${formatMB(r.ram_total)}`,
      swap, swapText: num(r.swap_total) > 0 ? `${formatMB(r.swap_used)} / ${formatMB(r.swap_total)}` : '',
      disk, diskTone: tone(disk), diskText: `${formatMB(r.disk_used)} / ${formatMB(r.disk_total)}`,
      rx: formatRate(r.net_in_speed), tx: formatRate(r.net_out_speed),
      rxTotal: formatBytes(r.net_rx), txTotal: formatBytes(r.net_tx),
      load: String(r.load_avg || '').trim(),
      procs: num(r.processes), tcp: num(r.tcp_conn), udp: num(r.udp_conn),
      uptime: rec.online ? formatDuration(uptimeMs(r, now), tr) : '',
      lastSeen: rec.reportTs ? formatDuration(now - rec.reportTs, tr) : '',
      probes,
      showProbes: probes.length > 0,
      io: io ? { read: formatRate(io.read_bps), write: formatRate(io.write_bps), util: num(io.util), iops: num(io.read_iops) + num(io.write_iops), await: num(io.await_ms) } : null,
      expireDate: sys.show_expire !== false ? effectiveExpireDate(r, now) : '',
      expireDays: days,
      price: sys.show_price !== false ? formatPrice(r, lang.value) : '',
      traffic: tRatio != null ? { ratio: Math.min(1, tRatio), pct: tRatio * 100, used: formatBytes(trafficUsed(r)), limit: `${parseFloat(r.traffic_limit)} GB` } : null
    }
  })
}
