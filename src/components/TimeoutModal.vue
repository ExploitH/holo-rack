<script setup>
import { session, keepLive } from '../session.js'
import { t } from '../i18n.js'
const stay = () => { session.liveTimedOut = false }
</script>

<template>
  <div class="wrap" role="dialog" aria-modal="true" :aria-label="t.timeoutTitle">
    <div class="box glass-hi">
      <h2>{{ t.timeoutTitle }}</h2>
      <p>{{ t.timeoutBody }}</p>
      <div class="row">
        <button type="button" class="ghost" @click="stay">{{ t.stayStatic }}</button>
        <button type="button" class="primary" @click="keepLive">{{ t.keepLive }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap { position: fixed; inset: 0; z-index: 25; display: grid; place-items: center; padding: 16px; background: rgba(3, 4, 7, .45); }
.box { border-radius: 16px; padding: 20px 22px; display: grid; gap: 12px; max-width: 380px; }
h2 { margin: 0; font: 600 16px/1.3 var(--font-body); }
p { margin: 0; color: var(--ink-2); font-size: 13px; }
.row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.primary, .ghost { all: unset; cursor: pointer; font-weight: 700; padding: 8px 14px; border-radius: 9px; font-size: 13px; }
.primary { background: var(--accent); color: var(--accent-ink); }
.ghost { color: var(--ink-2); border: 1px solid var(--line-2); }
.primary:focus-visible, .ghost:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
