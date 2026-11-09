<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useServerView } from '../composables/serverView.js'
import { session, fetchHistory } from '../session.js'
import { ui } from '../store/fleet.js'
import { t } from '../i18n.js'
import { formatRate, num, probeName, PING_KEYS, isProbeDisabled } from '../utils/format.js'
import LineChart from './LineChart.vue'

const props = defineProps({ id: String, standalone: Boolean })
const emit = defineEmits(['close'])
const router = useRouter()
const v = useServerView(() => props.id)
const pctOf = (x) => `${Math.round(x * 100)}%`

// ---------- history ----------
const cache = new Map()
const RANGES = computed(() => [0.167, 0.5, 1, 6, 12, 24, ...(session.loggedIn ? [48, 96, 168] : [])])
const hours = ref(0.167)
const rows = ref([])
const loading = ref(false)
const failed = ref('')
const tail = ref([])
let lastTailTs = 0

async function load() {
  const key = `${props.id}|${hours.value}`
  const hit = cache.get(key)
  failed.value = ''
  if (hit && Date.now() - hit.at < 60000) { rows.value = hit.rows; return }
  loading.value = true
  try {
    const data = await fetchHistory(props.id, hours.value)
    rows.value = data
    cache.set(key, { rows: data, at: Date.now() })
    tail.value = []
    lastTailTs = data.length ? num(data[data.length - 1].timestamp) : 0
  } catch (e) {
    rows.value = []
    failed.value = e.status === 401 ? t.value.needLogin : t.value.loadFailed
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(hours, load)

// append live samples to short ranges so the curve keeps moving
watch(() => ui.tick, () => {
  const rec = v.value?.rec
  if (!rec || hours.value > 1 || !rec.online) return
  const ts = rec.sampleTs
  if (!ts || ts <= lastTailTs) return
  lastTailTs = ts
  const r = rec.raw
  const row = { timestamp: ts, cpu: r.cpu, ram_used: r.ram_used, ram_total: r.ram_total, net_in_speed: r.net_in_speed, net_out_speed: r.net_out_speed, disk: r.disk }
  for (const k of PING_KEYS) { row[`ping_${k}`] = r[`ping_${k}`]; row[`loss_${k}`] = r[`loss_${k}`] }
  tail.value = [...tail.value.slice(-600), row]
})

const span = computed(() => hours.value * 3600e3)
const series = computed(() => {
  const end = Date.now()
  const all = [...rows.value, ...tail.value].filter(r => num(r.timestamp) >= end - span.value - 60000)
  const pts = (fn) => all.map(r => [num(r.timestamp), fn(r)])
  const val = (x) => (x === null || x === undefined || x === false || x === 'false' ? null : num(x, null))
  const ramTotal = num(v.value?.rec.raw.ram_total)
  const out = {
    usage: [
      { name: 'CPU', color: 'rgba(63, 240, 200, 1)', points: pts(r => val(r.cpu)) },
      { name: t.value.memory, color: 'rgba(85, 184, 255, 1)', points: pts(r => { const tot = num(r.ram_total) || ramTotal; return tot > 0 && r.ram_used != null ? num(r.ram_used) / tot * 100 : null }) }
    ],
    net: [
      { name: '↓', color: 'rgba(63, 240, 200, 1)', points: pts(r => val(r.net_in_speed)) },
      { name: '↑', color: 'rgba(255, 181, 71, 1)', points: pts(r => val(r.net_out_speed)) }
    ],
    ping: [], loss: [], io: null
  }
  const palette = ['rgba(63, 240, 200, 1)', 'rgba(85, 184, 255, 1)', 'rgba(255, 181, 71, 1)', 'rgba(196, 140, 255, 1)', 'rgba(255, 110, 140, 1)', 'rgba(140, 230, 120, 1)', 'rgba(255, 220, 120, 1)', 'rgba(120, 200, 255, 1)']
  PING_KEYS.forEach((k, i) => {
    if (!all.some(r => !isProbeDisabled(r[`ping_${k}`]))) return
    const name = probeName(k, session.names)
    out.ping.push({ name, color: palette[i], points: pts(r => val(r[`ping_${k}`])) })
    out.loss.push({ name, color: palette[i], points: pts(r => val(r[`loss_${k}`])) })
  })
  if (all.some(r => r.disk && typeof r.disk === 'object')) {
    out.io = [
      { name: t.value.read, color: 'rgba(85, 184, 255, 1)', points: pts(r => (r.disk ? num(r.disk.read_bps) : null)) },
      { name: t.value.write, color: 'rgba(196, 140, 255, 1)', points: pts(r => (r.disk ? num(r.disk.write_bps) : null)) }
    ]
  }
  return out
})
const fmtPct = (x) => `${Math.round(x)}%`
const fmtMs = (x) => `${Math.round(x)}ms`
const fmtLoss = (x) => `${x.toFixed(x < 10 ? 1 : 0)}%`
</script>

<template>
  <aside v-if="v" class="panel glass-hi" :aria-label="v.name">
    <header class="head">
      <div class="title">
        <img v-if="v.flag" class="flag" :src="v.flag" alt="" @error="$event.target.style.display = 'none'">
        <h2>{{ v.name }}</h2>
        <span class="pill" :class="v.status">{{ v.statusText }}</span>
      </div>
      <div class="sub">
        <img class="os" :src="v.osIcon" alt="" @error="$event.target.style.display = 'none'">
        <span>{{ v.os }}</span>
        <span v-if="v.group" class="dim">· {{ v.group }}</span>
      </div>
      <div class="actions">
        <button v-if="standalone" type="button" class="ghost" @click="router.push('/')">{{ t.enterRoom }}</button>
        <button v-else type="button" class="icon-btn" :aria-label="t.close" @click="emit('close')">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </button>
      </div>
    </header>

    <div class="scroll">
      <section class="tiles">
        <div class="tile" :class="v.cpuTone">
          <span class="k">CPU</span><b>{{ pctOf(v.cpu) }}</b>
          <i class="bar" :style="{ '--v': pctOf(v.cpu) }"></i>
          <span class="s">{{ v.cores }} {{ t.cores }}</span>
        </div>
        <div class="tile" :class="v.memTone">
          <span class="k">{{ t.memory }}</span><b>{{ pctOf(v.mem) }}</b>
          <i class="bar" :style="{ '--v': pctOf(v.mem) }"></i>
          <span class="s">{{ v.memText }}</span>
        </div>
        <div class="tile" :class="v.diskTone">
          <span class="k">{{ t.disk }}</span><b>{{ pctOf(v.disk) }}</b>
          <i class="bar" :style="{ '--v': pctOf(v.disk) }"></i>
          <span class="s">{{ v.diskText }}</span>
        </div>
        <div class="tile net">
          <span class="k">{{ t.network }}</span>
          <b class="sm"><em>↓</em>{{ v.rx }}</b>
          <b class="sm"><em class="up">↑</em>{{ v.tx }}</b>
          <span class="s">{{ v.rxTotal }} / {{ v.txTotal }}</span>
        </div>
      </section>

      <section class="facts mono">
        <span v-if="v.load"><em>{{ t.load }}</em>{{ v.load }}</span>
        <span><em>{{ t.processes }}</em>{{ v.procs }}</span>
        <span><em>TCP/UDP</em>{{ v.tcp }}/{{ v.udp }}</span>
        <span v-if="v.uptime"><em>{{ t.uptime }}</em>{{ v.uptime }}</span>
        <span v-else-if="v.lastSeen"><em>{{ t.lastSeen }}</em>{{ v.lastSeen }} {{ t.ago }}</span>
        <span v-if="v.swapText"><em>{{ t.swap }}</em>{{ pctOf(v.swap) }}</span>
        <span v-if="v.io"><em>IO</em>{{ Math.round(v.io.util) }}%</span>
      </section>

      <section v-if="v.probes.length" class="probes">
        <div v-for="p in v.probes" :key="p.key" class="probe">
          <span class="name">{{ p.name }}</span>
          <b :class="p.tone">{{ p.ping === null ? t.timeout : `${p.ping}` }}<small v-if="p.ping !== null">ms</small></b>
          <span class="loss" :class="{ bad: (p.loss ?? 0) >= 5, warn: (p.loss ?? 0) > 0 && (p.loss ?? 0) < 5 }">{{ p.loss == null ? '—' : `${p.loss}%` }}</span>
        </div>
      </section>

      <section class="history">
        <div class="ranges" role="tablist" :aria-label="t.history">
          <button v-for="h in RANGES" :key="h" type="button" role="tab" :aria-selected="hours === h" :class="{ on: hours === h }" @click="hours = h">{{ t.range[h] }}</button>
        </div>
        <p v-if="failed" class="dim note">{{ failed }}</p>
        <template v-else>
          <div class="chart-block" :class="{ busy: loading }">
            <h3>CPU · {{ t.memory }}</h3>
            <LineChart :series="series.usage" :format="fmtPct" :max="100" :span="span" />
          </div>
          <div class="chart-block" :class="{ busy: loading }">
            <h3>{{ t.network }}</h3>
            <LineChart :series="series.net" :format="formatRate" :span="span" />
          </div>
          <div v-if="series.ping.length" class="chart-block" :class="{ busy: loading }">
            <h3>{{ t.latency }}</h3>
            <LineChart :series="series.ping" :format="fmtMs" :span="span" />
          </div>
          <div v-if="series.loss.length" class="chart-block" :class="{ busy: loading }">
            <h3>{{ t.loss }}</h3>
            <LineChart :series="series.loss" :format="fmtLoss" :height="90" :span="span" />
          </div>
          <div v-if="series.io" class="chart-block" :class="{ busy: loading }">
            <h3>{{ t.diskIo }}</h3>
            <LineChart :series="series.io" :format="formatRate" :height="96" :span="span" />
          </div>
        </template>
      </section>

      <section class="sys">
        <dl>
          <dt>{{ t.system }}</dt><dd>{{ v.osFull || '—' }}</dd>
          <template v-if="v.kernel"><dt>{{ t.kernel }}</dt><dd class="mono">{{ v.kernel }}</dd></template>
          <template v-if="v.arch"><dt>{{ t.arch }}</dt><dd class="mono">{{ v.arch }}</dd></template>
          <template v-if="v.cpuModel"><dt>CPU</dt><dd>{{ v.cpuModel }}</dd></template>
          <template v-for="g in v.gpus" :key="g.id"><dt>{{ t.gpu }}</dt><dd>{{ g.name }}<span v-if="g.info != null" class="dim"> · {{ g.info }}%</span></dd></template>
          <dt>{{ t.ipStack }}</dt>
          <dd class="stack"><span :class="{ on: v.ipv4 }">IPv4</span><span :class="{ on: v.ipv6 }">IPv6</span></dd>
        </dl>
      </section>

      <section v-if="v.price || v.expireDate || v.traffic" class="bill">
        <div v-if="v.price" class="row"><span class="dim">{{ t.price }}</span><b>{{ v.price }}</b></div>
        <div v-if="v.expireDate" class="row">
          <span class="dim">{{ t.expires }}</span>
          <b :class="{ bad: v.expireDays != null && v.expireDays <= 7 }">{{ v.expireDate }}<small v-if="v.expireDays != null"> · {{ v.expireDays <= 0 ? t.expired : `${v.expireDays}${t.days}` }}</small></b>
        </div>
        <div v-if="v.traffic" class="quota">
          <div class="row"><span class="dim">{{ t.quota }}</span><b>{{ v.traffic.used }} / {{ v.traffic.limit }}</b></div>
          <i class="bar" :class="v.traffic.pct >= 95 ? 'bad' : v.traffic.pct >= 80 ? 'warn' : 'ok'" :style="{ '--v': `${Math.min(100, v.traffic.pct)}%` }"></i>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.panel {
  position: fixed; z-index: 9; right: var(--gr); top: calc(var(--gt) + 58px); bottom: calc(var(--gb) + 26px);
  width: 392px; border-radius: 16px; display: grid; grid-template-rows: auto 1fr; overflow: hidden;
  animation: slide-in .45s cubic-bezier(.2, .8, .2, 1) both;
}
@keyframes slide-in { from { opacity: 0; transform: translateX(24px); } }
.panel::before { content: ""; position: absolute; left: 16px; right: 16px; top: -1px; height: 2px; border-radius: 2px; background: var(--accent); box-shadow: 0 0 14px var(--accent); }
.head { position: relative; padding: 16px 16px 12px; border-bottom: 1px solid var(--line); display: grid; gap: 6px; }
.title { display: flex; align-items: center; gap: 9px; padding-right: 96px; }
.title h2 { margin: 0; font: 700 21px/1 var(--font-display); letter-spacing: .03em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pill { font: 600 11px/1 var(--font-body); padding: 4px 8px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
.pill.ok { color: var(--ok); } .pill.warn { color: var(--warn); } .pill.bad { color: var(--bad); }
.sub { display: flex; align-items: center; gap: 6px; color: var(--ink-2); font-size: 12px; min-width: 0; }
.actions { position: absolute; right: 12px; top: 12px; display: flex; gap: 6px; }
.ghost { all: unset; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--accent); padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(63, 240, 200, .35); }
.ghost:hover { background: rgba(63, 240, 200, .08); }
.ghost:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.scroll { overflow-y: auto; padding: 14px 16px 18px; display: grid; gap: 16px; align-content: start; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(150, 200, 255, .2) transparent; }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tile { border: 1px solid var(--line); border-radius: 12px; padding: 10px 11px; display: grid; gap: 5px; background: rgba(255, 255, 255, .02); min-width: 0; }
.tile .k { font-size: 11px; color: var(--ink-3); }
.tile b { font: 700 22px/1 var(--font-display); color: var(--ink); }
.tile b.sm { font: 600 13px/1.25 var(--font-data); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile b em { font-style: normal; color: var(--accent); margin-right: 6px; }
.tile b em.up { color: var(--warn); }
.tile .s { font: 500 11px/1.2 var(--font-data); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar { display: block; height: 4px; border-radius: 3px; background: rgba(255, 255, 255, .07); position: relative; overflow: hidden; }
.bar::after { content: ""; position: absolute; inset: 0; width: var(--v); background: var(--ok); border-radius: 3px; transition: width .6s; box-shadow: 0 0 8px var(--ok); }
.warn .bar::after, .bar.warn::after { background: var(--warn); box-shadow: 0 0 8px var(--warn); }
.bad .bar::after, .bar.bad::after { background: var(--bad); box-shadow: 0 0 8px var(--bad); }
.tile.warn b { color: var(--warn); } .tile.bad b { color: var(--bad); }

.facts { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--ink); }
.facts em { font: 400 11px/1 var(--font-body); font-style: normal; color: var(--ink-3); margin-right: 6px; }

.probes { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px; }
.probe { border: 1px solid var(--line); border-radius: 10px; padding: 8px 9px; display: grid; gap: 3px; }
.probe .name { font-size: 11px; color: var(--ink-3); }
.probe b { font: 700 16px/1 var(--font-data); }
.probe b small { font-size: 10px; color: var(--ink-3); margin-left: 2px; font-weight: 500; }
.probe .loss { font: 500 11px/1 var(--font-data); color: var(--ink-2); }

.history { display: grid; gap: 12px; }
.ranges { display: flex; flex-wrap: wrap; gap: 4px; padding: 3px; border-radius: 10px; background: rgba(0, 0, 0, .25); border: 1px solid var(--line); }
.ranges button { all: unset; cursor: pointer; padding: 5px 8px; border-radius: 7px; font: 600 11px/1 var(--font-data); color: var(--ink-2); }
.ranges button.on { background: var(--accent); color: var(--accent-ink); }
.ranges button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.chart-block { display: grid; gap: 4px; transition: opacity .3s; }
.chart-block.busy { opacity: .45; }
.chart-block h3 { margin: 0; font: 600 12px/1 var(--font-body); color: var(--ink-2); }
.note { margin: 4px 0; font-size: 12px; }

.sys dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; font-size: 12px; }
.sys dt { color: var(--ink-3); }
.sys dd { margin: 0; color: var(--ink); min-width: 0; overflow-wrap: anywhere; }
.stack { display: flex; gap: 6px; }
.stack span { font: 600 10px/1 var(--font-data); padding: 3px 6px; border-radius: 5px; border: 1px solid var(--line); color: var(--ink-3); }
.stack span.on { color: var(--accent); border-color: rgba(63, 240, 200, .4); }

.bill { display: grid; gap: 8px; border-top: 1px solid var(--line); padding-top: 12px; font-size: 12px; }
.bill .row { display: flex; justify-content: space-between; gap: 10px; }
.bill b { font: 600 12px/1.2 var(--font-data); }
.bill b small { font-weight: 500; }
.bill b.bad { color: var(--bad); }
.quota { display: grid; gap: 6px; }

@media (max-width: 760px) {
  .panel {
    left: 8px; right: 8px; top: auto; bottom: calc(var(--gb) + 24px); width: auto; height: 60vh; border-radius: 16px 16px 12px 12px;
    animation-name: sheet-in;
  }
  @keyframes sheet-in { from { opacity: 0; transform: translateY(30px); } }
}
</style>
