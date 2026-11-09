import { STORAGE, store } from './http.js'
import { wsBaseFor } from './config.js'
import { openSocket } from './transport.js'

const INITIAL_DELAY = 1000
const MAX_DELAY = 30000
const MAX_ATTEMPTS = 10

// One WebSocket to one CF-Server-Monitor backend.
//   scope 'all' + ids  → home page (sends {type:'subscribe', scope:'all', ids} on open)
//   scope '<id>'       → standalone detail page
// Reconnects with capped exponential backoff, and honours frontend_ws_timeout_minutes by
// closing after the limit and handing the decision to the user via onTimeout.
export function createLiveSocket({ scope = 'all', ids = [], baseIndex = 0, timeoutMinutes = 0, onMessage, onStatus, onTimeout }) {
  let ws = null
  let manual = false
  let attempts = 0
  let delay = INITIAL_DELAY
  let retryTimer = null
  let lifeTimer = null
  let connected = false

  const status = (c, reason = '') => { connected = c; onStatus?.({ connected: c, reason, baseIndex }) }
  const clearTimers = () => {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    if (lifeTimer) { clearTimeout(lifeTimer); lifeTimer = null }
  }

  function connect() {
    manual = false
    let socket
    try {
      const url = new URL(`${wsBaseFor(baseIndex)}/api/ws`)
      url.searchParams.set('subscribe', scope)
      const jwt = store.get(STORAGE.JWT)
      if (jwt && url.host !== location.host) url.searchParams.set('token', jwt)
      socket = openSocket(url.toString())
      ws = socket
    } catch {
      status(false, 'unsupported')
      return
    }
    socket.addEventListener('open', () => {
      if (socket !== ws || manual) { try { socket.close() } catch { /* noop */ } return }
      attempts = 0
      delay = INITIAL_DELAY
      if (scope === 'all') {
        try { socket.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids })) } catch { /* noop */ }
      }
      status(true, 'connected')
      const ms = Number(timeoutMinutes) > 0 ? Number(timeoutMinutes) * 60000 : 0
      if (ms) {
        lifeTimer = setTimeout(() => {
          if (socket !== ws) return
          manual = true
          try { socket.close(1000, 'connection lifetime exceeded') } catch { /* noop */ }
          onTimeout?.({ baseIndex })
        }, ms)
      }
    })
    socket.addEventListener('message', (ev) => {
      if (socket !== ws) return
      let msg = null
      try { msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : null } catch { return }
      if (msg) onMessage?.(msg, baseIndex)
    })
    socket.addEventListener('close', (ev) => {
      if (socket !== ws) return
      ws = null
      if (lifeTimer) { clearTimeout(lifeTimer); lifeTimer = null }
      status(false, ev.reason || 'closed')
      if (!manual) scheduleRetry()
    })
    socket.addEventListener('error', () => {
      if (socket !== ws) return
      try { socket.close() } catch { /* noop */ }
    })
  }

  function scheduleRetry() {
    if (retryTimer || manual) return
    if (attempts >= MAX_ATTEMPTS) { status(false, 'gave-up'); return }
    attempts++
    const wait = delay
    delay = Math.min(delay * 2, MAX_DELAY)
    retryTimer = setTimeout(() => { retryTimer = null; connect() }, wait)
  }

  connect()

  return {
    close() {
      manual = true
      clearTimers()
      if (ws) { const s = ws; ws = null; try { s.close() } catch { /* noop */ } }
      status(false, 'closed')
    },
    reconnect() {
      this.close()
      attempts = 0
      delay = INITIAL_DELAY
      connect()
    },
    get connected() { return connected }
  }
}
