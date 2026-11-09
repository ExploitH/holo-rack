<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { session, saveThemeOptions } from '../session.js'
import { fleet, ui } from '../store/fleet.js'
import { lang, setLang, t } from '../i18n.js'
import { adminUrl, skinAsset } from '../net/config.js'
import { formatRate, flagUrl } from '../utils/format.js'

const props = defineProps({ detailId: { type: String, default: '' } })
const router = useRouter()

const title = computed(() => session.config?.site_title || document.title || 'Server Monitor')
const stats = computed(() => ui.stats)
const health = computed(() => (stats.value.total ? stats.value.online / stats.value.total : 1))

// ---- finder ----
const finding = ref(false)
const query = ref('')
const input = ref(null)
const cursor = ref(0)
const results = computed(() => {
  void ui.tick
  if (fleet.scope !== 'all') return []
  const q = query.value.trim().toLowerCase()
  const list = fleet.list.filter(r => {
    if (!q) return true
    const x = r.raw
    return [x.name, x.region, x.server_group, x.os, x.tags].some(v => String(v || '').toLowerCase().includes(q))
  })
  return list.slice(0, 8).map(r => ({ id: r.id, name: r.raw.name || r.id, region: String(r.raw.region || '').toUpperCase(), flag: skinAsset(flagUrl(r.raw.region), r.base), online: r.online, group: r.raw.server_group || '' }))
})
async function openFinder() {
  if (fleet.scope !== 'all') { router.push('/'); return }
  finding.value = true
  query.value = ''
  cursor.value = 0
  await nextTick()
  input.value?.focus()
}
function closeFinder() { finding.value = false }
const blurClose = () => setTimeout(closeFinder, 160)
function choose(r) {
  if (!r) return
  closeFinder()
  router.push(`/server/${encodeURIComponent(r.id)}`)
}
function onFinderKey(e) {
  if (e.key === 'ArrowDown') { cursor.value = Math.min(results.value.length - 1, cursor.value + 1); e.preventDefault() }
  else if (e.key === 'ArrowUp') { cursor.value = Math.max(0, cursor.value - 1); e.preventDefault() }
  else if (e.key === 'Enter') choose(results.value[cursor.value])
  else if (e.key === 'Escape') { closeFinder(); e.stopPropagation() }
}
function onGlobalKey(e) {
  if (e.key === '/' && !e.target.closest?.('input, textarea')) { e.preventDefault(); openFinder() }
}
onMounted(() => window.addEventListener('keydown', onGlobalKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey))

// ---- theme settings (admin only) ----
const settingsOpen = ref(false)
const draft = ref({ ...session.options })
const saveState = ref('')
function openSettings() {
  draft.value = { ...session.options }
  saveState.value = ''
  settingsOpen.value = !settingsOpen.value
}
async function save() {
  saveState.value = '…'
  const ok = await saveThemeOptions({ ...session.options, ...draft.value })
  saveState.value = ok ? t.value.saved : t.value.saveFailed
  if (ok) setTimeout(() => { settingsOpen.value = false }, 700)
}
</script>

<template>
  <header class="top">
    <a class="brand" href="#/" :title="title" @click.prevent="router.push('/')">
      <span class="mark" :style="{ '--h': health }"></span>
      <span class="name">{{ title }}</span>
    </a>

    <div class="stats glass" role="group">
      <span class="chip" :title="`${t.online} ${stats.online} / ${stats.total}`">
        <i class="dot" :class="stats.offline ? (stats.online ? 'warn' : 'bad') : 'ok'"></i>
        <b>{{ stats.online }}</b><span class="dim">/{{ stats.total }}</span>
      </span>
      <span class="chip" :title="t.down">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v10m0 0-4-4m4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <b>{{ formatRate(stats.speedIn) }}</b>
      </span>
      <span class="chip" :title="t.up">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14V4m0 0L4 8m4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <b>{{ formatRate(stats.speedOut) }}</b>
      </span>
      <span class="live" :class="session.live" :title="session.live === 'on' ? t.live : session.live === 'retry' ? t.liveRetry : t.liveOff"></span>
    </div>

    <div class="tools glass">
      <button type="button" class="icon-btn" :aria-label="t.search" :title="`${t.search} (/)`" @click="openFinder">
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m13.2 13.2 3.6 3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      </button>
      <button type="button" class="icon-btn lang" :aria-label="lang === 'zh' ? 'English' : '中文'" @click="setLang(lang === 'zh' ? 'en' : 'zh')">{{ lang === 'zh' ? 'EN' : '中' }}</button>
      <button v-if="session.loggedIn" type="button" class="icon-btn" :aria-label="t.settings" :title="t.settings" @click="openSettings">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h8m4 0h2M3 14h2m4 0h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="13" cy="6" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="7" cy="14" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>
      </button>
      <a class="icon-btn" :href="adminUrl(0)" :aria-label="t.admin" :title="t.admin">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 4 5v4.6c0 3.6 2.5 6.6 6 7.9 3.5-1.3 6-4.3 6-7.9V5l-6-2.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m7.4 10 1.8 1.8 3.5-3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </a>
    </div>

    <div v-if="finding" class="finder glass-hi" @keydown="onFinderKey">
      <input ref="input" v-model="query" type="search" :placeholder="t.search" :aria-label="t.search" @blur="blurClose" @input="cursor = 0">
      <ul role="listbox">
        <li v-for="(r, i) in results" :key="r.id" role="option" :aria-selected="i === cursor" :class="{ on: i === cursor }" @mousedown.prevent="choose(r)" @mouseenter="cursor = i">
          <img v-if="r.flag" class="flag" :src="r.flag" alt="" loading="lazy" @error="$event.target.style.visibility = 'hidden'">
          <b>{{ r.name }}</b>
          <span class="dim">{{ r.group }}</span>
          <i class="dot" :class="r.online ? 'ok' : 'bad'"></i>
        </li>
      </ul>
    </div>

    <div v-if="settingsOpen" class="settings glass-hi">
      <label>
        <span>{{ t.groupBy }}</span>
        <select v-model="draft.group_by">
          <option value="group">{{ t.byGroup }}</option>
          <option value="region">{{ t.byRegion }}</option>
          <option value="none">{{ t.byNone }}</option>
        </select>
      </label>
      <div class="row">
        <span class="dim">{{ saveState }}</span>
        <button type="button" class="primary" @click="save">{{ t.save }}</button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.top {
  position: fixed; z-index: 10; left: 0; right: 0; top: 0;
  padding: var(--gt) var(--gr) 0 var(--gl);
  display: flex; align-items: center; gap: 12px; pointer-events: none;
}
.top > * { pointer-events: auto; }
.brand { display: flex; align-items: center; gap: 10px; text-decoration: none; min-width: 0; margin-right: auto; }
.brand .name {
  font: 700 16px/1 var(--font-display); letter-spacing: .08em; color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 32vw;
  text-shadow: 0 0 18px rgba(63, 240, 200, .25);
}
.mark {
  --h: 1;
  width: 16px; height: 16px; border-radius: 4px; flex: none;
  background: conic-gradient(var(--accent) calc(var(--h) * 360deg), var(--bad) 0);
  box-shadow: 0 0 14px rgba(63, 240, 200, .55);
  mask: radial-gradient(circle, transparent 3.5px, #000 4px);
  -webkit-mask: radial-gradient(circle, transparent 3.5px, #000 4px);
}
.stats { display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 12px; font: 500 12px/1 var(--font-data); }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; color: var(--ink-2); white-space: nowrap; }
.chip b { color: var(--ink); font-weight: 600; }
.chip svg { width: 13px; height: 13px; color: var(--accent); }
.chip + .chip { border-left: 1px solid var(--line); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 8px currentColor; flex: none; }
.dot.ok { background: var(--ok); color: var(--ok); } .dot.warn { background: var(--warn); color: var(--warn); } .dot.bad { background: var(--bad); color: var(--bad); }
.live { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; margin: 0 4px; }
.live::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--ink-3); }
.live.on::before { background: var(--accent); box-shadow: 0 0 10px var(--accent); animation: pulse 2s ease-in-out infinite; }
.live.retry::before { background: var(--warn); animation: pulse .8s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .35; transform: scale(.7); } }
.tools { display: flex; gap: 2px; padding: 4px; border-radius: 12px; }
.lang { font: 700 12px/1 var(--font-display); }

.finder {
  position: absolute; right: var(--gr); top: calc(var(--gt) + 52px); width: min(360px, calc(100vw - 32px));
  border-radius: 14px; padding: 8px;
}
.finder input {
  width: 100%; border: 1px solid var(--line-2); background: rgba(0, 0, 0, .35); color: var(--ink);
  border-radius: 9px; padding: 9px 12px; font: 500 14px/1.2 var(--font-body); outline: none;
}
.finder input:focus { border-color: var(--accent); }
.finder ul { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 2px; }
.finder li { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.finder li b { font: 600 13px/1 var(--font-data); }
.finder li .dim { margin-left: auto; font-size: 12px; }
.finder li.on { background: rgba(63, 240, 200, .1); }

.settings {
  position: absolute; right: var(--gr); top: calc(var(--gt) + 52px); width: 260px; border-radius: 14px; padding: 14px;
  display: grid; gap: 12px;
}
.settings label { display: grid; gap: 6px; color: var(--ink-2); font-size: 12px; }
.settings select { background: rgba(0, 0, 0, .4); color: var(--ink); border: 1px solid var(--line-2); border-radius: 8px; padding: 7px 9px; font: inherit; }
.settings .row { display: flex; align-items: center; justify-content: space-between; }
.primary { all: unset; cursor: pointer; background: var(--accent); color: var(--accent-ink); font-weight: 700; padding: 7px 14px; border-radius: 8px; }
.primary:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

@media (max-width: 760px) {
  .top { flex-wrap: wrap; gap: 8px; }
  .brand .name { max-width: 46vw; font-size: 14px; }
  .stats { order: 3; width: 100%; justify-content: space-between; }
  .chip { padding: 6px 6px; }
}
</style>
