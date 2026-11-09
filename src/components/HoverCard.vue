<script setup>
import { computed, ref, watchEffect } from 'vue'
import { useServerView } from '../composables/serverView.js'
import { t } from '../i18n.js'

const props = defineProps({ id: String, x: Number, y: Number })
const v = useServerView(() => props.id)
const el = ref(null)
const pos = ref({ x: 0, y: 0 })

watchEffect(() => {
  const w = el.value?.offsetWidth || 290, h = el.value?.offsetHeight || 220
  let x = props.x + 18, y = props.y + 18
  if (x + w > window.innerWidth - 12) x = props.x - w - 18
  if (y + h > window.innerHeight - 12) y = window.innerHeight - h - 12
  pos.value = { x: Math.max(8, x), y: Math.max(8, y) }
})
const pctOf = (v) => `${Math.round(v * 100)}%`
const probes = computed(() => (v.value?.probes || []).slice(0, 4))
</script>

<template>
  <div v-if="v" ref="el" class="card glass-hi" :style="{ transform: `translate(${pos.x}px, ${pos.y}px)` }" role="tooltip">
    <div class="head">
      <img v-if="v.flag" class="flag" :src="v.flag" alt="" @error="$event.target.style.display = 'none'">
      <b>{{ v.name }}</b>
      <span class="pill" :class="v.status">{{ v.statusText }}</span>
    </div>
    <div class="sub">
      <img class="os" :src="v.osIcon" alt="" @error="$event.target.style.display = 'none'">
      <span>{{ v.os }}</span>
      <span class="dim">· {{ v.cores }}C / {{ v.ramText }}</span>
    </div>
    <div class="meter" :class="v.cpuTone"><span>CPU</span><i :style="{ '--v': pctOf(v.cpu) }"></i><b>{{ pctOf(v.cpu) }}</b></div>
    <div class="meter" :class="v.memTone"><span>{{ t.memory }}</span><i :style="{ '--v': pctOf(v.mem) }"></i><b>{{ pctOf(v.mem) }}</b></div>
    <div class="meter" :class="v.diskTone"><span>{{ t.disk }}</span><i :style="{ '--v': pctOf(v.disk) }"></i><b>{{ pctOf(v.disk) }}</b></div>
    <div class="net mono">
      <span><em>↓</em>{{ v.rx }}</span>
      <span><em>↑</em>{{ v.tx }}</span>
    </div>
    <div v-if="probes.length" class="probes">
      <span v-for="p in probes" :key="p.key" :class="p.tone">
        <em>{{ p.name }}</em>{{ p.ping === null ? t.timeout : `${p.ping}` }}<small v-if="p.ping !== null">ms</small>
      </span>
    </div>
    <div v-if="v.expireDays != null && v.expireDays <= 7" class="expire">
      {{ v.expireDays <= 0 ? t.expired : `${t.expiresIn} ${v.expireDays} ${t.days}` }}<template v-if="v.price"> · {{ v.price }}</template>
    </div>
  </div>
</template>

<style scoped>
.card {
  position: fixed; left: 0; top: 0; z-index: 12; pointer-events: none; will-change: transform;
  width: 292px; padding: 13px 14px 12px; border-radius: 14px; display: grid; gap: 8px;
}
.head { display: flex; align-items: center; gap: 8px; }
.head b { font: 700 16px/1 var(--font-display); letter-spacing: .03em; }
.pill { margin-left: auto; font: 600 11px/1 var(--font-body); padding: 4px 8px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
.pill.ok { color: var(--ok); } .pill.warn { color: var(--warn); } .pill.bad { color: var(--bad); }
.sub { display: flex; align-items: center; gap: 6px; color: var(--ink-2); font-size: 12px; margin-top: -2px; min-width: 0; }
.sub span:first-of-type { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.net { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 12px; }
.net em { font-style: normal; color: var(--accent); margin-right: 6px; }
.probes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; font: 600 12px/1.2 var(--font-data); }
.probes span { display: grid; gap: 2px; }
.probes em { font: 400 11px/1 var(--font-body); color: var(--ink-3); font-style: normal; }
.probes small { color: var(--ink-3); font-weight: 400; margin-left: 1px; }
.expire { font-size: 12px; color: var(--bad); padding: 6px 8px; border-radius: 8px; background: rgba(255, 84, 104, .1); }
</style>
