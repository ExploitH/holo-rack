<script setup>
import { onMounted, ref } from 'vue'
import { session } from '../session.js'
import { t } from '../i18n.js'

const box = ref(null)
const failed = ref(false)
onMounted(() => {
  const g = session.gate
  if (g?.kind === 'turnstile' && box.value) g.solve(box.value).catch(() => { failed.value = true })
})
const reload = () => location.reload()
</script>

<template>
  <div class="gate" role="dialog" aria-modal="true">
    <div class="box glass-hi">
      <template v-if="session.gate.kind === 'turnstile'">
        <h2>{{ failed ? t.verifyFailed : t.needVerify }}</h2>
        <div ref="box" class="ts"></div>
      </template>
      <template v-else-if="session.gate.kind === 'login'">
        <h2>{{ t.needLogin }}</h2>
        <a class="primary" :href="session.gate.url">{{ t.goLogin }}</a>
      </template>
      <template v-else-if="session.gate.kind === 'cors'">
        <h2>{{ t.loadFailed }}</h2>
        <p>{{ t.corsBlocked }}</p>
        <button type="button" class="primary" @click="reload">{{ t.retry }}</button>
      </template>
      <template v-else>
        <h2>{{ t[session.gate.key] || t.loadFailed }}</h2>
        <button v-if="session.gate.retry" type="button" class="primary" @click="reload">{{ t.retry }}</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.gate { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 16px; background: rgba(3, 4, 7, .55); }
.box { border-radius: 16px; padding: 22px 24px; display: grid; gap: 14px; justify-items: center; text-align: center; max-width: 420px; }
h2 { margin: 0; font: 600 16px/1.4 var(--font-body); }
p { margin: 0; color: var(--ink-2); font-size: 13px; }
.ts { min-height: 66px; }
.primary { all: unset; cursor: pointer; background: var(--accent); color: var(--accent-ink); font-weight: 700; padding: 9px 18px; border-radius: 9px; }
.primary:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
</style>
