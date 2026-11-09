// API base resolution, following CF-Server-Monitor's convention: same origin by default,
// or the comma-separated <meta name="apiBase"> that the Worker / static build injects.
let apiBases = []

const strip = (s) => String(s || '').replace(/\/+$/, '')

export function initApiBases() {
  const meta = document.querySelector('meta[name="apiBase"]')?.content || ''
  const list = meta.split(',').map(s => strip(s.trim())).filter(Boolean)
  apiBases = list.length ? list : [strip(location.origin)]
  return apiBases
}

export const getApiBases = () => (apiBases.length ? apiBases : initApiBases())
export const hasMultipleApiBases = () => getApiBases().length > 1

export function wsBaseFor(index = 0) {
  const base = getApiBases()[index] || getApiBases()[0]
  try {
    const u = new URL(base)
    return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`
  } catch {
    return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
  }
}

// Flags and OS icons are static files of the default skin on the Worker itself.
export function skinAsset(path, index = 0) {
  if (!path) return ''
  const base = getApiBases()[index] || ''
  try {
    if (base && new URL(base).origin !== location.origin) return `${base}${path}`
  } catch { /* same origin */ }
  return path
}

// The admin console always belongs to the built-in default theme.
export function adminUrl(index = 0) {
  const base = getApiBases()[index] || ''
  try {
    if (new URL(base).origin === location.origin) return '/admin#/admin'
  } catch { /* fall through */ }
  return base ? `${base}/admin#/admin` : '/admin#/admin'
}
