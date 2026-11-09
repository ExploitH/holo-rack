import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { mockApi } from './mock/vite-plugin.js'

// Dev modes:
//   npm run dev                         → built-in mock API (REST + WebSocket) on the Vite server
//   DEV_API_TARGET=https://x npm run dev → proxy /api, /flags, /os-icons to a real CF-Server-Monitor
// Build modes:
//   npm run build       → dist/ (index.html + assets/), the theme itself
//   npm run build:demo  → dist-demo/, self-contained preview that simulates the API in the browser
export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const target = (env.DEV_API_TARGET || '').replace(/\/+$/, '')
  const upstreamPublic = resolve(env.UPSTREAM_PUBLIC || '../upstream/public')
  const demo = mode === 'demo'

  const plugins = [vue()]
  if (command === 'serve' && !target) plugins.push(mockApi({ staticRoot: upstreamPublic, isPrivate: env.MOCK_PRIVATE === '1', turnstile: env.MOCK_TURNSTILE === '1' }))
  if (demo) {
    plugins.push({
      name: 'demo-static-icons',
      closeBundle() {
        for (const dir of ['flags', 'os-icons']) {
          const from = resolve(upstreamPublic, dir)
          if (existsSync(from)) cpSync(from, resolve('dist-demo', dir), { recursive: true })
        }
      }
    })
  }

  return {
    base: './',
    plugins,
    define: { __DEMO__: JSON.stringify(demo) },
    build: {
      outDir: demo ? 'dist-demo' : 'dist',
      assetsDir: 'assets',
      target: 'es2020',
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: { three: ['three'] }
        }
      }
    },
    server: {
      port: 5173,
      proxy: target
        ? {
            '/api': { target, changeOrigin: true, ws: true, secure: true },
            '/flags': { target, changeOrigin: true },
            '/os-icons': { target, changeOrigin: true }
          }
        : undefined
    }
  }
})
