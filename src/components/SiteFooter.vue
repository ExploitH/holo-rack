<script setup>
import { computed } from 'vue'
import { session } from '../session.js'
const version = computed(() => (session.config?.version ? `v${session.config.version}` : ''))
</script>

<template>
  <footer class="foot">
    <a href="https://github.com/huilang-me/CF-Server-Monitor/" target="_blank" rel="noopener" :title="version">
      Powered by CF-Server-Monitor<span v-if="version"> {{ version }}</span>
    </a>
  </footer>
</template>

<style scoped>
.foot {
  position: fixed; z-index: 8; left: var(--gl); bottom: var(--gb);
  font: 500 11px/1 var(--font-data); letter-spacing: .02em;
}
a { color: var(--ink-3); text-decoration: none; transition: color .2s; }
a:hover { color: var(--accent); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px; }
</style>
