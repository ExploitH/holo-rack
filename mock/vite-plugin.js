import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { WebSocketServer } from 'ws'
import { createMockBackend } from './core.js'

const TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' }

// Serves the mock backend from the Vite dev server: REST under /api/*, WebSocket at /api/ws,
// and (if a CF-Server-Monitor checkout is next to this repo) the default skin's /flags and /os-icons.
// MOCK_PRIVATE=1 → private site (send `Authorization: Bearer mock-jwt`, or put jwt_token=mock-jwt in localStorage)
// MOCK_TURNSTILE=1 → Turnstile on, using Cloudflare's always-pass test site key
export function mockApi({ staticRoot, isPrivate = false, turnstile = false } = {}) {
  const backend = createMockBackend({ isPublic: !isPrivate, turnstile })

  return {
    name: 'cfsm-mock-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        if (staticRoot && /^\/(flags|os-icons)\//.test(url.pathname)) {
          const file = normalize(join(staticRoot, decodeURIComponent(url.pathname)))
          if (file.startsWith(normalize(staticRoot)) && existsSync(file) && statSync(file).isFile()) {
            res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream')
            createReadStream(file).pipe(res)
            return
          }
          res.statusCode = 404
          res.end()
          return
        }
        // dev-only: POST a canvas dataURL to /__shot/<name> to save a full-resolution frame for review
        if (req.method === 'POST' && /^\/__shot\/[\w-]+$/.test(url.pathname)) {
          const chunks = []
          for await (const c of req) chunks.push(c)
          const dir = join(tmpdir(), 'holo-rack-shots')
          mkdirSync(dir, { recursive: true })
          const file = join(dir, `${url.pathname.slice(8)}.png`)
          writeFileSync(file, Buffer.from(Buffer.concat(chunks).toString().split(',').pop(), 'base64'))
          res.statusCode = 200
          res.end(file)
          return
        }
        if (!url.pathname.startsWith('/api/') || url.pathname === '/api/ws') return next()
        let body = null
        if (req.method === 'POST') {
          const chunks = []
          for await (const c of req) chunks.push(c)
          try { body = JSON.parse(Buffer.concat(chunks).toString() || 'null') } catch { body = null }
        }
        const headers = {}
        for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v
        const { status, body: out } = backend.handle(req.method, url.pathname, Object.fromEntries(url.searchParams), headers, body)
        res.statusCode = status
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(out))
      })

      const wss = new WebSocketServer({ noServer: true })
      server.httpServer?.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname !== '/api/ws') return
        wss.handleUpgrade(req, socket, head, (ws) => {
          const headers = {}
          for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = v
          const cookieJwt = /cfsm_auth=mock-jwt/.test(headers.cookie || '')
          if (cookieJwt) headers.authorization = 'Bearer mock-jwt'
          const session = backend.connect(
            Object.fromEntries(url.searchParams),
            headers,
            (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)) },
            (code, reason) => ws.close(code, reason)
          )
          ws.on('message', (raw) => {
            let msg = null
            try { msg = JSON.parse(raw.toString()) } catch { return }
            session.onMessage(msg)
          })
          ws.on('close', () => session.dispose())
        })
      })
    }
  }
}
