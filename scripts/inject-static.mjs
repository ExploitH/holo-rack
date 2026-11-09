// Post-build step for static hosting (GitHub Pages). Reads runtime settings from the
// environment and writes them into dist/index.html:
//   API_BASE    → <meta name="apiBase">          (comma-separated Worker origins)
//   TITLE       → <title>
//   CSP_API     → extra connect-src origins     CSP_STATIC → extra script/style/img/font origins
// With none of them set, dist/ stays the generic build the Worker theme proxy expects.
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../dist/index.html', import.meta.url)
const origins = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
  try { const u = new URL(s); return u.protocol === 'https:' && (u.pathname === '/' || !u.pathname) ? u.origin : '' } catch { return '' }
}).filter(Boolean)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const apiBases = origins(process.env.API_BASE)
const cspApi = origins(process.env.CSP_API)
const cspStatic = origins(process.env.CSP_STATIC)
const title = String(process.env.TITLE || '').trim()

let html = readFileSync(file, 'utf8')
const head = []
if (apiBases.length) head.push(`<meta name="apiBase" content="${esc(apiBases.join(','))}">`)
if (apiBases.length || cspApi.length || cspStatic.length) {
  const ts = 'https://challenges.cloudflare.com'
  const api = [...apiBases, ...cspApi].flatMap(o => [o, o.replace('https://', 'wss://')])
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${ts} ${cspStatic.join(' ')}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${cspStatic.join(' ')}`,
    `img-src 'self' data: ${[...apiBases, ...cspStatic].join(' ')}`,
    `font-src 'self' https://fonts.gstatic.com ${cspStatic.join(' ')}`,
    `connect-src 'self' ${ts} ${api.join(' ')}`,
    `frame-src ${ts}`,
    "object-src 'none'",
    "base-uri 'self'"
  ].map(s => s.trim()).join('; ')
  head.push(`<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">`)
}
if (title) html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
if (head.length) html = html.replace('</head>', `  ${head.join('\n  ')}\n</head>`)
writeFileSync(file, html)
console.log(`inject-static: apiBase=${apiBases.length} title=${title ? 'yes' : 'no'} csp=${head.length > 1 || (head.length === 1 && !apiBases.length) ? 'yes' : 'no'}`)
