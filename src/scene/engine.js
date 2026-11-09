import * as THREE from 'three'
import { buildRoom } from './room.js'

const ORBIT_KEYS = {
  arrowleft: 'l', a: 'l', arrowright: 'r', d: 'r', arrowup: 'u', w: 'u', arrowdown: 'd', s: 'd',
  e: 'in', '=': 'in', '+': 'in', q: 'out', '-': 'out', _: 'out'
}
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

// Owns the WebGL renderer and the current room. Vue talks to it through a tiny API:
//   setLayout({ groups, getRecord, words, showExpire })   select(id | null)
// and hears back through hooks: onHover(id, x, y), onPick(id | null), onCycle(±1), onFail(msg)
export function createEngine(canvas, hooks = {}) {
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  } catch (e) {
    hooks.onFail?.('webgl')
    throw e
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.outputColorSpace = THREE.SRGBColorSpace
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); hooks.onFail?.('context') })

  const coarse = matchMedia('(pointer: coarse)').matches
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const mobile = coarse || window.innerWidth < 760
  const maxDpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2)
  let dpr = Math.min(maxDpr, mobile ? 1.15 : 1.5)
  const pointScale = { value: dpr }
  const samples = mobile ? 0 : 4
  let W = window.innerWidth, H = window.innerHeight

  const state = { hover: null, selected: null }
  let room = null
  let tween = null
  let running = false
  // screen area covered by HUD panels; the projection centre shifts so the focus stays visible
  const inset = { right: 0, bottom: 0, curR: 0, curB: 0 }

  function applyInset() {
    if (!room) return
    const cam = room.camera
    if (inset.curR < 0.5 && inset.curB < 0.5) cam.clearViewOffset()
    else cam.setViewOffset(W, H, inset.curR / 2, inset.curB / 2, W, H)
  }
  function stepInset(dt) {
    const k = Math.min(1, dt * 6)
    const r = inset.curR + (inset.right - inset.curR) * k
    const b = inset.curB + (inset.bottom - inset.curB) * k
    if (Math.abs(r - inset.curR) > 0.05 || Math.abs(b - inset.curB) > 0.05) {
      inset.curR = r; inset.curB = b
      applyInset()
    }
  }

  function applySize() {
    W = window.innerWidth
    H = window.innerHeight
    renderer.setPixelRatio(dpr)
    renderer.setSize(W, H, false)
    pointScale.value = dpr
    if (room) { room.resize(W, H, dpr); applyInset() }
  }
  window.addEventListener('resize', () => {
    applySize()
    if (room && !state.selected && !tween) goHome(false)
  })

  function flyTo(pose, dur = 1.4) {
    if (!room || !pose) return
    if (reducedMotion) dur = 0.01
    const c = room.controls
    tween = { t: 0, dur, fromT: c.target.clone(), toT: pose.target, fromP: room.camera.position.clone(), toP: pose.position }
  }
  function goHome(animate = true) {
    if (!room) return
    const pose = room.homePose(W / H)
    room.applyLimits(pose)
    if (animate) flyTo(pose)
    else { room.controls.target.copy(pose.target); room.camera.position.copy(pose.position); tween = null }
  }
  function stepTween(dt) {
    if (!tween) return
    tween.t = Math.min(1, tween.t + dt / tween.dur)
    const k = easeInOut(tween.t)
    room.controls.target.lerpVectors(tween.fromT, tween.toT, k)
    room.camera.position.lerpVectors(tween.fromP, tween.toP, k)
    if (tween.t >= 1) tween = null
  }

  // ---------- input ----------
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const pointer = { x: 0, y: 0, moved: false, inside: false, downX: 0, downY: 0, downT: 0 }
  function pickAt(x, y) {
    if (!room) return null
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1)
    raycaster.setFromCamera(ndc, room.camera)
    return room.pick(raycaster)
  }
  canvas.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true
    pointer.moved = e.pointerType === 'mouse'
  })
  canvas.addEventListener('pointerleave', () => {
    pointer.inside = false
    if (state.hover) { state.hover = null; hooks.onHover?.(null) }
  })
  canvas.addEventListener('pointerdown', (e) => {
    pointer.downX = e.clientX; pointer.downY = e.clientY; pointer.downT = performance.now()
    if (tween) tween = null
  })
  canvas.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - pointer.downX, e.clientY - pointer.downY) > 6 || performance.now() - pointer.downT > 450) return
    const id = pickAt(e.clientX, e.clientY)
    if (id || state.selected) hooks.onPick?.(id)
  })
  canvas.addEventListener('wheel', () => { if (tween) tween = null }, { passive: true })

  const held = new Set()
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
    const k = e.key.toLowerCase()
    if (k === 'escape') { hooks.onPick?.(null); return }
    if (k === '[' || k === ']') { hooks.onCycle?.(k === ']' ? 1 : -1); return }
    const dir = ORBIT_KEYS[k]
    if (dir) { held.add(dir); e.preventDefault() }
  })
  window.addEventListener('keyup', (e) => { const dir = ORBIT_KEYS[e.key.toLowerCase()]; if (dir) held.delete(dir) })
  window.addEventListener('blur', () => held.clear())
  const kOff = new THREE.Vector3(), kSph = new THREE.Spherical()
  function stepKeys(dt) {
    if (!held.size || !room) return
    tween = null
    const c = room.controls, cam = room.camera
    kOff.copy(cam.position).sub(c.target)
    kSph.setFromVector3(kOff)
    const turn = 1.2 * dt
    if (held.has('l')) kSph.theta -= turn
    if (held.has('r')) kSph.theta += turn
    if (held.has('u')) kSph.phi -= turn * 0.7
    if (held.has('d')) kSph.phi += turn * 0.7
    if (held.has('in')) kSph.radius *= Math.exp(-1.0 * dt)
    if (held.has('out')) kSph.radius *= Math.exp(1.0 * dt)
    kSph.phi = THREE.MathUtils.clamp(kSph.phi, c.minPolarAngle, c.maxPolarAngle)
    kSph.radius = THREE.MathUtils.clamp(kSph.radius, c.minDistance, c.maxDistance)
    cam.position.copy(c.target).add(kOff.setFromSpherical(kSph))
  }

  // ---------- loop ----------
  let last = performance.now(), t = 0
  let perfAcc = 0, perfFrames = 0, perfGood = 0
  let firstFrame = true
  function frame(now) {
    if (!running) return
    requestAnimationFrame(frame)
    const raw = Math.min(0.1, (now - last) / 1000)
    last = now
    if (document.hidden || !room) return
    const dt = Math.min(raw, 0.05)
    t += dt
    stepTween(dt)
    stepKeys(raw)
    stepInset(dt)
    if (pointer.moved && pointer.inside) {
      pointer.moved = false
      const id = pickAt(pointer.x, pointer.y)
      if (id !== state.hover) state.hover = id
      canvas.style.cursor = id ? 'pointer' : ''
      hooks.onHover?.(id, pointer.x, pointer.y)
    }
    room.update(dt, t, state)
    room.render(t)
    if (firstFrame) { firstFrame = false; hooks.onFirstFrame?.() }

    perfAcc += raw; perfFrames++
    if (perfAcc > 2) {
      const avg = perfAcc / perfFrames
      if (avg > 1 / 38 && dpr > 0.7) { dpr = Math.max(0.7, dpr - 0.2); perfGood = 0; applySize() }
      else if (avg < 1 / 57) { if (++perfGood >= 3 && dpr < maxDpr) { dpr = Math.min(maxDpr, dpr + 0.15); perfGood = 0; applySize() } }
      else perfGood = 0
      perfAcc = 0; perfFrames = 0
    }
  }

  return {
    renderer,
    state,
    get room() { return room },
    setLayout(opts) {
      const prev = room
      room = buildRoom({ renderer, samples, pointScale, ...opts })
      prev?.dispose()
      applySize()
      goHome(false)
      if (state.selected && room.has(state.selected)) {
        const pose = room.focusPose(state.selected)
        room.controls.target.copy(pose.target)
        room.camera.position.copy(pose.position)
      }
      state.hover = null
    },
    select(id) {
      const next = id && room?.has(id) ? id : null
      if (next === state.selected) return
      state.selected = next
      if (next) flyTo(room.focusPose(next))
      else goHome(true)
    },
    home: () => goHome(true),
    setInset({ right = 0, bottom = 0 } = {}) {
      inset.right = reducedMotion ? (inset.curR = right) : right
      inset.bottom = reducedMotion ? (inset.curB = bottom) : bottom
      applyInset()
    },
    start() {
      if (running) return
      running = true
      last = performance.now()
      requestAnimationFrame(frame)
    },
    stop() { running = false },
    projectSelected() {
      if (!room || !state.selected) return null
      const pose = room.focusPose(state.selected)
      const v = pose.target.clone().project(room.camera)
      return { x: (v.x * 0.5 + 0.5) * W, y: (1 - (v.y * 0.5 + 0.5)) * H }
    }
  }
}
