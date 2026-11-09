<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

// series: [{ name, color, points: [[ts, value | null], ...] }]
const props = defineProps({
  series: { type: Array, default: () => [] },
  format: { type: Function, default: (v) => String(Math.round(v)) },
  min: { type: Number, default: 0 },
  max: { type: Number, default: null },
  height: { type: Number, default: 118 },
  span: { type: Number, default: 0 }
})

const wrap = ref(null)
const canvas = ref(null)
const hoverX = ref(null)
let ro = null
let width = 300

const domain = computed(() => {
  let t0 = Infinity, t1 = -Infinity, hi = -Infinity
  for (const s of props.series) for (const [ts, v] of s.points) {
    if (ts < t0) t0 = ts
    if (ts > t1) t1 = ts
    if (v != null && v > hi) hi = v
  }
  if (props.span && Number.isFinite(t1)) t0 = Math.min(t0, t1 - props.span)
  if (!Number.isFinite(t0)) return null
  const top = props.max != null ? props.max : (hi > props.min ? hi * 1.15 : props.min + 1)
  return { t0, t1: Math.max(t1, t0 + 1), lo: props.min, hi: top }
})

const PAD = { l: 2, r: 46, t: 8, b: 18 }
const xOf = (ts, d) => PAD.l + (ts - d.t0) / (d.t1 - d.t0) * (width - PAD.l - PAD.r)
const yOf = (v, d) => PAD.t + (1 - (v - d.lo) / (d.hi - d.lo)) * (props.height - PAD.t - PAD.b)

function fmtTime(ts, d) {
  const dt = new Date(ts)
  const hm = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
  return d.t1 - d.t0 > 36 * 3600e3 ? `${dt.getMonth() + 1}/${dt.getDate()} ${hm}` : hm
}

function draw() {
  const c = canvas.value
  if (!c) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  c.width = Math.round(width * dpr)
  c.height = Math.round(props.height * dpr)
  c.style.width = `${width}px`
  c.style.height = `${props.height}px`
  const g = c.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, width, props.height)
  const d = domain.value
  if (!d) return
  g.font = '500 10px "JetBrains Mono", Consolas, monospace'
  g.textBaseline = 'middle'
  for (let i = 0; i <= 3; i++) {
    const v = d.lo + (d.hi - d.lo) * (i / 3)
    const y = yOf(v, d)
    g.strokeStyle = i === 0 ? 'rgba(150, 200, 255, .18)' : 'rgba(150, 200, 255, .07)'
    g.lineWidth = 1
    g.beginPath(); g.moveTo(PAD.l, Math.round(y) + 0.5); g.lineTo(width - PAD.r + 4, Math.round(y) + 0.5); g.stroke()
    if (i > 0) { g.fillStyle = 'rgba(163, 173, 194, .7)'; g.fillText(props.format(v), width - PAD.r + 8, y) }
  }
  g.fillStyle = 'rgba(102, 112, 138, .9)'
  g.textBaseline = 'alphabetic'
  g.fillText(fmtTime(d.t0, d), PAD.l, props.height - 4)
  const endLabel = fmtTime(d.t1, d)
  g.fillText(endLabel, width - PAD.r - g.measureText(endLabel).width, props.height - 4)

  props.series.forEach((s, si) => {
    const pts = s.points
    if (!pts.length) return
    if (si === 0) {
      const grad = g.createLinearGradient(0, PAD.t, 0, props.height - PAD.b)
      grad.addColorStop(0, s.color.replace(/[\d.]+\)$/, '.28)'))
      grad.addColorStop(1, s.color.replace(/[\d.]+\)$/, '0)'))
      g.fillStyle = grad
      let open = false, startX = 0, lastX = 0
      g.beginPath()
      for (const [ts, v] of pts) {
        if (v == null) {
          if (open) { g.lineTo(lastX, yOf(d.lo, d)); g.lineTo(startX, yOf(d.lo, d)); g.closePath(); open = false }
          continue
        }
        const x = xOf(ts, d), y = yOf(Math.min(v, d.hi), d)
        if (!open) { g.moveTo(x, yOf(d.lo, d)); g.lineTo(x, y); startX = x; open = true } else g.lineTo(x, y)
        lastX = x
      }
      if (open) { g.lineTo(lastX, yOf(d.lo, d)); g.lineTo(startX, yOf(d.lo, d)); g.closePath() }
      g.fill()
    }
    g.strokeStyle = s.color
    g.lineWidth = 1.5
    g.lineJoin = 'round'
    g.shadowColor = s.color
    g.shadowBlur = 6
    g.beginPath()
    let pen = false
    for (const [ts, v] of pts) {
      if (v == null) { pen = false; continue }
      const x = xOf(ts, d), y = yOf(Math.min(v, d.hi), d)
      if (!pen) { g.moveTo(x, y); pen = true } else g.lineTo(x, y)
    }
    g.stroke()
    g.shadowBlur = 0
  })

  if (hoverX.value != null) {
    g.strokeStyle = 'rgba(230, 236, 245, .35)'
    g.lineWidth = 1
    g.beginPath(); g.moveTo(Math.round(hoverX.value) + 0.5, PAD.t); g.lineTo(Math.round(hoverX.value) + 0.5, props.height - PAD.b); g.stroke()
    for (const r of readout.value?.rows || []) {
      if (r.v == null) continue
      g.fillStyle = r.color
      g.beginPath(); g.arc(r.x, yOf(Math.min(r.v, d.hi), d), 3, 0, Math.PI * 2); g.fill()
    }
  }
}

const readout = computed(() => {
  const d = domain.value
  if (hoverX.value == null || !d) return null
  const ts = d.t0 + (hoverX.value - PAD.l) / (width - PAD.l - PAD.r) * (d.t1 - d.t0)
  const rows = props.series.map(s => {
    let best = null, bd = Infinity
    for (const p of s.points) { const dd = Math.abs(p[0] - ts); if (dd < bd) { bd = dd; best = p } }
    return best ? { name: s.name, color: s.color, v: best[1], x: xOf(best[0], d), ts: best[0] } : null
  }).filter(Boolean)
  return { rows, ts: rows[0]?.ts ?? ts, label: rows[0] ? fmtTime(rows[0].ts, d) : '' }
})

function onMove(e) {
  const r = canvas.value.getBoundingClientRect()
  const x = e.clientX - r.left
  hoverX.value = x >= PAD.l && x <= width - PAD.r ? x : null
}
function onLeave() { hoverX.value = null }

onMounted(() => {
  ro = new ResizeObserver(([entry]) => {
    width = Math.max(120, Math.floor(entry.contentRect.width))
    draw()
  })
  ro.observe(wrap.value)
})
onBeforeUnmount(() => ro?.disconnect())
watch(() => [props.series, hoverX.value, props.height], draw, { deep: false })
</script>

<template>
  <div ref="wrap" class="chart" :style="{ height: `${height}px` }">
    <canvas ref="canvas" @pointermove="onMove" @pointerleave="onLeave"></canvas>
    <div v-if="readout" class="readout glass-hi" :style="{ left: `${Math.min(hoverX + 10, 9999)}px` }" :class="{ flip: hoverX > 180 }">
      <span class="dim">{{ readout.label }}</span>
      <span v-for="r in readout.rows" :key="r.name"><i :style="{ background: r.color }"></i>{{ r.name }} <b>{{ r.v == null ? '—' : format(r.v) }}</b></span>
    </div>
  </div>
</template>

<style scoped>
.chart { position: relative; width: 100%; }
canvas { display: block; touch-action: pan-y; }
.readout {
  position: absolute; top: 4px; pointer-events: none; padding: 7px 9px; border-radius: 8px;
  display: grid; gap: 3px; font: 500 11px/1.2 var(--font-data); white-space: nowrap; z-index: 2;
}
.readout.flip { transform: translateX(calc(-100% - 20px)); }
.readout i { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 6px; }
.readout b { color: var(--ink); margin-left: 4px; }
</style>
