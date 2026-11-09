<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { session, boot, loadHome, loadSingle } from './session.js'
import { fleet, ui, tick, groupFleet } from './store/fleet.js'
import { t } from './i18n.js'
import { createEngine } from './scene/engine.js'
import TopBar from './components/TopBar.vue'
import HoverCard from './components/HoverCard.vue'
import DetailPanel from './components/DetailPanel.vue'
import Gate from './components/Gate.vue'
import TimeoutModal from './components/TimeoutModal.vue'
import SiteFooter from './components/SiteFooter.vue'

const route = useRoute()
const router = useRouter()
const canvas = ref(null)
const engine = shallowRef(null)
const hover = ref(null)
const fatal = ref('')
const notFound = ref(false)
const isTouch = matchMedia('(pointer: coarse)').matches
let clock = null

const detailId = computed(() => (route.path.startsWith('/server/') ? String(route.params.id || '') : ''))
// read ui.generation first so the dependency is tracked even while the record is missing
const detailOpen = computed(() => ui.generation >= 0 && !!detailId.value && fleet.byId.has(detailId.value))

function dismissBoot() {
  window.__holoBooted = true
  document.getElementById('boot')?.classList.add('out')
}
function showBootError(msg) {
  window.__holoFail?.(msg)
}

function relayout() {
  const e = engine.value
  if (!e) return
  e.setLayout({
    groups: fleet.scope === 'single' ? [{ name: '', ids: fleet.list.map(r => r.id) }] : groupFleet(session.options.group_by),
    getRecord: (id) => fleet.byId.get(id),
    words: { expires: t.value.expires, expired: t.value.expired },
    showExpire: session.sysConfig.show_expire !== false
  })
  e.select(detailId.value || null)
}

async function syncRoute() {
  if (session.phase !== 'ready') return
  notFound.value = false
  try {
    if (detailId.value) {
      const ok = await loadSingle(detailId.value)
      if (!ok) { notFound.value = true; engine.value?.select(null); return }
      engine.value?.select(detailId.value)
    } else {
      await loadHome()
      engine.value?.select(null)
    }
  } catch { /* gate is showing */ }
}

function onPick(id) {
  if (id) {
    if (id !== detailId.value) router.push(`/server/${encodeURIComponent(id)}`)
  } else if (detailId.value) {
    router.push('/')
  }
}
function onCycle(dir) {
  const list = fleet.list
  if (!list.length || fleet.scope !== 'all') return
  const i = list.findIndex(r => r.id === detailId.value)
  const next = list[(i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length)]
  router.push(`/server/${encodeURIComponent(next.id)}`)
}

onMounted(async () => {
  try {
    engine.value = createEngine(canvas.value, {
      onHover: (id, x, y) => { hover.value = id ? { id, x, y } : null },
      onPick,
      onCycle,
      onFail: (kind) => { fatal.value = kind; showBootError(t.value[kind] || kind) },
      onFirstFrame: dismissBoot
    })
  } catch {
    fatal.value = 'webgl'
    showBootError(t.value.webgl)
    return
  }
  if (import.meta.env.DEV) window.__holo = { engine: engine.value, fleet, session }
  clock = setInterval(tick, 1000)
  try {
    await boot()
  } catch {
    dismissBoot()
    return
  }
  engine.value.start()
  await syncRoute()
  if (!fleet.list.length) dismissBoot()
})
onBeforeUnmount(() => { clearInterval(clock); engine.value?.stop() })

function syncInset() {
  const e = engine.value
  if (!e) return
  if (!detailOpen.value) e.setInset({})
  else if (window.innerWidth <= 760) e.setInset({ bottom: window.innerHeight * 0.6 })
  else e.setInset({ right: 408 })
}
watch([detailId, () => ui.generation], syncInset)
window.addEventListener('resize', syncInset)

watch(() => ui.generation, relayout)
watch(() => session.options.group_by, () => { if (fleet.scope === 'all') relayout() })
watch(() => route.fullPath, syncRoute)
watch(() => session.phase, (p, prev) => { if (p === 'ready' && prev === 'gate') syncRoute() })
</script>

<template>
  <canvas ref="canvas" class="gl" tabindex="-1" aria-label="3D server room"></canvas>
  <template v-if="session.phase === 'ready' && !fatal">
    <TopBar :detail-id="detailId" />
    <HoverCard v-if="hover && !isTouch && hover.id !== detailId" :id="hover.id" :x="hover.x" :y="hover.y" />
    <DetailPanel
      v-if="detailOpen"
      :key="detailId"
      :id="detailId"
      :standalone="session.scope === 'single'"
      @close="router.push('/')"
    />
    <div v-if="notFound" class="toast glass-hi" role="status">
      <span>{{ t.notFound }}</span>
      <button type="button" class="link" @click="router.push('/')">{{ t.enterRoom }}</button>
    </div>
  </template>
  <Gate v-if="session.gate" />
  <TimeoutModal v-if="session.liveTimedOut" />
  <SiteFooter />
</template>

<style scoped>
.toast {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 20;
  padding: 18px 22px; border-radius: 14px; display: grid; gap: 10px; justify-items: center;
  font-size: 14px;
}
.link { all: unset; cursor: pointer; color: var(--accent); font-weight: 600; }
.link:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
</style>
