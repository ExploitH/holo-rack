import { createMockBackend } from '../../mock/core.js'

// Browser-side stand-in for a CF-Server-Monitor Worker, used only by the demo build.
export function createDemoTransport() {
  const backend = createMockBackend({ title: 'HOLO RACK Demo' })

  async function demoFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href)
    const headers = {}
    const h = new Headers(init.headers || {})
    h.forEach((v, k) => { headers[k.toLowerCase()] = v })
    let body = null
    if (init.body) { try { body = JSON.parse(init.body) } catch { body = null } }
    await new Promise(r => setTimeout(r, 60 + Math.random() * 90))
    const out = backend.handle((init.method || 'GET').toUpperCase(), url.pathname, Object.fromEntries(url.searchParams), headers, body)
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'Content-Type': 'application/json' } })
  }

  class DemoWebSocket extends EventTarget {
    constructor(url) {
      super()
      this.url = url
      this.readyState = 0
      const u = new URL(url)
      setTimeout(() => {
        if (this.readyState === 3) return
        this.readyState = 1
        this.session = backend.connect(
          Object.fromEntries(u.searchParams), {},
          (msg) => { if (this.readyState === 1) this._emit('message', { data: JSON.stringify(msg) }) },
          (code, reason) => this.close(code, reason)
        )
        this._emit('open', {})
      }, 120)
    }
    _emit(type, props) {
      const ev = new Event(type)
      Object.assign(ev, props)
      this.dispatchEvent(ev)
      const handler = this['on' + type]
      if (typeof handler === 'function') handler.call(this, ev)
    }
    send(raw) {
      if (this.readyState !== 1) return
      let msg = null
      try { msg = JSON.parse(raw) } catch { return }
      this.session?.onMessage(msg)
    }
    close(code = 1000, reason = '') {
      if (this.readyState === 3) return
      this.readyState = 3
      this.session?.dispose()
      setTimeout(() => this._emit('close', { code, reason }), 0)
    }
  }

  return { fetch: demoFetch, WebSocket: DemoWebSocket }
}
