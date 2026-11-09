// Network primitives. The production theme uses the browser's fetch/WebSocket; the demo
// build swaps in an in-browser simulation of the CF-Server-Monitor API so the page runs
// without a backend. __DEMO__ is a build-time constant, so the mock is tree-shaken out of
// the real theme bundle.
let demo = null

export async function initTransport() {
  if (__DEMO__) {
    const mod = await import('./demo.js')
    demo = mod.createDemoTransport()
  }
}

export const isDemo = () => !!demo

export function xfetch(url, init) {
  return demo ? demo.fetch(url, init) : fetch(url, init)
}

export function openSocket(url) {
  return demo ? new demo.WebSocket(url) : new WebSocket(url)
}
