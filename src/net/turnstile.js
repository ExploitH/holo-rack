import { STORAGE, store } from './http.js'

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading = null

function loadScript() {
  if (window.turnstile) return Promise.resolve()
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = (e) => { loading = null; reject(e) }
    document.head.appendChild(s)
  })
  return loading
}

// Renders the Turnstile widget into `el` and resolves with the one-time token.
export async function solveTurnstile(el, siteKey) {
  await loadScript()
  return new Promise((resolve, reject) => {
    const id = window.turnstile.render(el, {
      sitekey: siteKey,
      theme: 'dark',
      callback: (token) => {
        store.set(STORAGE.TURNSTILE_TOKEN, token)
        resolve(token)
        setTimeout(() => { try { window.turnstile.remove(id) } catch { /* already gone */ } }, 400)
      },
      'error-callback': () => reject(new Error('turnstile-error')),
      'expired-callback': () => { try { window.turnstile.reset(id) } catch { /* noop */ } }
    })
  })
}
