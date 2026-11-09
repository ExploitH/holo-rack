import { getApiBases } from './config.js'
import { xfetch } from './transport.js'

export const STORAGE = {
  JWT: 'jwt_token',
  TURNSTILE_TOKEN: 'turnstile_token',
  TURNSTILE_VERIFIED: 'turnstile_verified',
  LANG: 'language_preference'
}

export const store = {
  get(k) { try { return localStorage.getItem(k) || '' } catch { return '' } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k) } catch { /* private mode */ } }
}

export const isLoggedIn = () => !!store.get(STORAGE.JWT)

function headersFor({ auth = true, turnstileToken = true, turnstileVerified = true, json = false } = {}) {
  const h = {}
  if (json) h['Content-Type'] = 'application/json'
  const jwt = auth && store.get(STORAGE.JWT)
  if (jwt) h.Authorization = `Bearer ${jwt}`
  const tt = turnstileToken && store.get(STORAGE.TURNSTILE_TOKEN)
  if (tt) h['X-Turnstile-Token'] = tt
  const tv = turnstileVerified && store.get(STORAGE.TURNSTILE_VERIFIED)
  if (tv) h['X-Turnstile-Verified'] = tv
  return h
}

// Every call resolves (never throws) with { data, status } or { error, status, code, message }.
// 401 clears the JWT, 403 clears the Turnstile cache; the caller decides what to show.
export async function request(method, path, { base, body, timeoutMs = 15000, ...hopts } = {}) {
  const root = base || getApiBases()[0]
  const controller = timeoutMs ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const res = await xfetch(`${root}${path}`, {
      method,
      headers: headersFor({ ...hopts, json: body != null }),
      body: body != null ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal: controller?.signal
    })
    if (res.status === 401) {
      store.del(STORAGE.JWT)
      return { error: 'Unauthorized', status: 401, base: root }
    }
    if (res.status === 403) {
      store.del(STORAGE.TURNSTILE_TOKEN)
      store.del(STORAGE.TURNSTILE_VERIFIED)
      return { error: 'Forbidden', status: 403, base: root }
    }
    let data = null
    try { data = await res.json() } catch { data = null }
    if (!res.ok) {
      return { error: data?.error || `HTTP ${res.status}`, status: res.status, code: data?.code, message: data?.message, base: root }
    }
    if (data && data.turnstile_verified) {
      store.set(STORAGE.TURNSTILE_VERIFIED, data.turnstile_verified)
      store.del(STORAGE.TURNSTILE_TOKEN)
    }
    return { data, status: res.status, base: root }
  } catch (e) {
    const aborted = e?.name === 'AbortError'
    const cors = !aborted && /failed to fetch|networkerror|load failed|cors/i.test(e?.message || '')
    return { error: aborted ? 'timeout' : (e?.message || 'Network error'), status: 0, timeout: aborted, network: true, cors, base: root }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const get = (path, opts) => request('GET', path, opts)
export const post = (path, body, opts) => request('POST', path, { ...opts, body })
export const getAll = (path, opts = {}) => Promise.all(getApiBases().map((base, index) => get(path, { ...opts, base }).then(r => ({ ...r, index }))))
