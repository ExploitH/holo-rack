import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { SOFT_POINT_FRAG } from './glsl.js'
import { makeComposer } from './post.js'
import { RACK, PANEL_VS, PANEL_FS, LABEL_VS, LABEL_FS, UV_VS, HOLO_FS, FLOOR_SHADER, CONE_FS, DUST_VS, SIGN_FS, HEAT_SHADER } from './shaders.js'
import { makeLabelAtlas, makeTagTexture, makeSignCanvas } from './textures.js'
import { targetsOf } from './metrics.js'

const PITCH_X = RACK.W + 0.012
const GROUP_GAP = 0.36
const DECO = 2
const MAX_LIGHTS = 8

const ease = (cur, target, k) => cur + (target - cur) * k

// Builds the server room for a set of rack groups.
//   groups: [{ name, ids }]   getRecord(id) → fleet record   words: { expires, expired }
export function buildRoom({ renderer, groups, getRecord, words, samples, pointScale, showExpire = true }) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0.006, 0.008, 0.012)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = envRT.texture
  scene.environmentIntensity = 0.22
  scene.add(new THREE.HemisphereLight(0x6f8cff, 0x080808, 0.25))
  const uTime = { value: 0 }
  const disposables = [envRT]

  // ---------- layout: groups → racks → arc positions ----------
  // Small fleets stand on a shallow arc in front of the camera ("front" mode). Once the arc
  // would need a radius above 5.5 m it wraps further around the visitor instead ("vault" mode),
  // so racks never drift far away; very large fleets close the ring and only then grow it.
  const active = []
  let s = 0
  const gap = groups.length > 6 ? 0.16 : GROUP_GAP
  groups.forEach((g, gi) => {
    if (gi > 0) s += gap
    for (let i = 0; i < g.ids.length; i += RACK.SLOTS) { active.push({ group: gi, ids: g.ids.slice(i, i + RACK.SLOTS), s }); s += PITCH_X }
  })
  if (!active.length) { active.push({ group: -1, ids: [], s }); s += PITCH_X }
  const activeLen = s
  let Rc = Math.max(3.4, activeLen / 1.75)
  const vault = Rc > 5.5
  if (vault) Rc = Math.max(5.5, activeLen / 5.7)
  const halfSpan = (activeLen / 2) / Rc
  const sMid = activeLen / 2 - PITCH_X / 2
  for (const r of active) r.s -= sMid
  const racks = [...active]
  const spare = 2 * Math.PI * Rc - activeLen
  const deco = Math.max(0, Math.min(DECO, Math.floor((spare / PITCH_X - 1) / 2)))
  for (let i = 1; i <= deco; i++) {
    racks.unshift({ deco: true, s: active[0].s - i * PITCH_X })
    racks.push({ deco: true, s: active[active.length - 1].s + i * PITCH_X })
  }
  scene.fog = new THREE.FogExp2(0x030407, Math.min(0.16, 0.55 / Rc))

  const arcPoint = (sArc, radius = Rc, y = 0) => {
    const th = sArc / Rc
    return new THREE.Vector3(radius * Math.sin(th), y, Rc - radius * Math.cos(th))
  }
  racks.forEach(r => {
    r.theta = r.s / Rc
    r.pos = arcPoint(r.s)
    r.normal = new THREE.Vector3(-Math.sin(r.theta), 0, Math.cos(r.theta))
    r.tangent = new THREE.Vector3(Math.cos(r.theta), 0, Math.sin(r.theta))
    r.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -r.theta)
    r.matrix = new THREE.Matrix4().compose(r.pos, r.quat, new THREE.Vector3(1, 1, 1))
    r.heat = 0
  })

  // ---------- rack frames (instanced by part) ----------
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x14161b, metalness: 0.85, roughness: 0.38 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x07080a, metalness: 0.4, roughness: 0.7 })
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.9, roughness: 0.32 })
  disposables.push(frameMat, darkMat, bladeMat)
  const local = new THREE.Matrix4()
  const tmpM = new THREE.Matrix4()
  function instanced(geo, mat, parts) {
    const count = racks.length * parts.length
    const mesh = new THREE.InstancedMesh(geo, mat, count)
    let i = 0
    for (const r of racks) for (const p of parts) {
      local.makeTranslation(p[0], p[1], p[2])
      mesh.setMatrixAt(i++, tmpM.multiplyMatrices(r.matrix, local))
    }
    mesh.instanceMatrix.needsUpdate = true
    scene.add(mesh)
    disposables.push(geo)
    return mesh
  }
  const sx = RACK.W / 2 - 0.015
  instanced(new THREE.BoxGeometry(0.03, RACK.H, RACK.D), frameMat, [[-sx, RACK.H / 2, 0], [sx, RACK.H / 2, 0]])
  instanced(new THREE.BoxGeometry(RACK.W, 0.06, RACK.D), frameMat, [[0, RACK.H - 0.03, 0]])
  instanced(new THREE.BoxGeometry(RACK.W, 0.12, RACK.D), frameMat, [[0, 0.06, 0]])
  instanced(new THREE.BoxGeometry(RACK.W, RACK.H, 0.02), darkMat, [[0, RACK.H / 2, -RACK.D / 2 + 0.01]])
  const railX = RACK.BLADE_W / 2 + 0.012
  instanced(new THREE.BoxGeometry(0.02, RACK.H - 0.2, 0.02), frameMat, [[-railX, RACK.H / 2, RACK.FRONT - 0.02], [railX, RACK.H / 2, RACK.FRONT - 0.02]])
  instanced(new THREE.BoxGeometry(PITCH_X + 0.002, 0.06, 0.32), frameMat, [[0, 2.45, -0.1]])
  const cableColors = [0x1b3a8a, 0xb8860b, 0x0e5a3a, 0x7a1d2a, 0x1b3a8a]
  cableColors.forEach((c, i) => {
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 })
    disposables.push(m)
    instanced(new THREE.BoxGeometry(PITCH_X + 0.002, 0.025, 0.025), m, [[0, 2.49, -0.22 + i * 0.055]])
  })
  // status bars (per-rack colour = rack heat)
  const barMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  disposables.push(barMat)
  const bars = instanced(new THREE.BoxGeometry(RACK.W - 0.08, 0.012, 0.01), barMat, [[0, RACK.H - 0.075, RACK.FRONT + 0.006]])
  const decoBar = new THREE.Color(0.03, 0.05, 0.07)
  racks.forEach((r, i) => bars.setColorAt(i, decoBar))

  // ---------- blades ----------
  const blades = []
  const blanks = []
  racks.forEach((r, ri) => {
    // partly filled racks keep their servers centred around eye level
    const first = r.ids ? Math.floor((RACK.SLOTS - r.ids.length) / 2) : 0
    for (let k = 0; k < RACK.SLOTS; k++) {
      const y = RACK.TOP_Y - k * RACK.PITCH
      const id = r.ids && r.ids[k - first]
      if (id) {
        const rec = getRecord(id)
        const seed = (blades.length * 0.6180339 + 0.13) % 1
        blades.push({ id, rack: r, ri, y, seed, slide: 0, hover: 0, sel: 0, fan: seed * 6, cur: null, tgt: null, name: rec?.raw?.name || id })
      } else {
        blanks.push({ r, y, led: r.deco ? Math.random() < 0.5 : false })
      }
    }
  })
  const N = Math.max(1, blades.length)

  const panelGeo = new THREE.PlaneGeometry(RACK.BLADE_W, RACK.BLADE_H)
  const attr = (n) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4)
    a.setUsage(THREE.DynamicDrawUsage)
    panelGeo.setAttribute(n, a)
    return a
  }
  const aM = [attr('aM0'), attr('aM1'), attr('aM2'), attr('aM3'), attr('aM4')]
  const panelMat = new THREE.ShaderMaterial({ vertexShader: PANEL_VS, fragmentShader: PANEL_FS, uniforms: { uTime } })
  const panels = new THREE.InstancedMesh(panelGeo, panelMat, N)
  panels.count = blades.length
  panels.frustumCulled = false
  scene.add(panels)

  const bodyGeo = new THREE.BoxGeometry(RACK.BLADE_W, RACK.BLADE_H, RACK.BLADE_D)
  const bodies = new THREE.InstancedMesh(bodyGeo, bladeMat, N)
  bodies.count = blades.length
  bodies.frustumCulled = false
  scene.add(bodies)

  const atlas = makeLabelAtlas(blades.map(b => b.name))
  const labelGeo = new THREE.PlaneGeometry(0.12, 0.0225)
  const aUv = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4)
  const aLab = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2)
  aLab.setUsage(THREE.DynamicDrawUsage)
  blades.forEach((b, i) => { aUv.setXYZW(i, ...atlas.uvs[i]); aLab.setXY(i, 1.3, 0) })
  labelGeo.setAttribute('aUv', aUv)
  labelGeo.setAttribute('aLab', aLab)
  const labelMat = new THREE.ShaderMaterial({ vertexShader: LABEL_VS, fragmentShader: LABEL_FS, uniforms: { uMap: { value: atlas.texture } }, transparent: true, depthWrite: false })
  const labels = new THREE.InstancedMesh(labelGeo, labelMat, N)
  labels.count = blades.length
  labels.frustumCulled = false
  scene.add(labels)
  disposables.push(panelGeo, panelMat, bodyGeo, atlas.texture, labelGeo, labelMat)

  const LBL_X = 1.95 * RACK.BLADE_H - RACK.BLADE_W / 2, LBL_Y = 0.15 * RACK.BLADE_H - RACK.BLADE_H / 2
  const holder = new THREE.Matrix4(), off = new THREE.Matrix4()
  function placeBlade(i) {
    const b = blades[i]
    holder.makeTranslation(0, b.y, b.slide).premultiply(b.rack.matrix)
    panels.setMatrixAt(i, tmpM.multiplyMatrices(holder, off.makeTranslation(0, 0, RACK.FRONT - 0.002)))
    bodies.setMatrixAt(i, tmpM.multiplyMatrices(holder, off.makeTranslation(0, 0, RACK.FRONT - RACK.BLADE_D / 2 - 0.004)))
    labels.setMatrixAt(i, tmpM.multiplyMatrices(holder, off.makeTranslation(LBL_X, LBL_Y, RACK.FRONT - 0.001)))
    if (b.tag) {
      b.tag.position.set(RACK.BLADE_W / 2 - 0.012, b.y + RACK.BLADE_H / 2 - 0.02, RACK.FRONT + 0.004 + b.slide).applyMatrix4(b.rack.matrix)
    }
  }

  // blank plates for empty slots and decorative racks
  if (blanks.length) {
    const g = new THREE.BoxGeometry(RACK.BLADE_W, RACK.BLADE_H, 0.02)
    const m = new THREE.InstancedMesh(g, bladeMat, blanks.length)
    blanks.forEach((p, i) => m.setMatrixAt(i, tmpM.multiplyMatrices(p.r.matrix, local.makeTranslation(0, p.y, RACK.FRONT - 0.03))))
    scene.add(m)
    disposables.push(g)
    const leds = blanks.filter(p => p.led)
    if (leds.length) {
      const lg = new THREE.PlaneGeometry(0.008, 0.008)
      const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.9, 0.3) })
      const lmesh = new THREE.InstancedMesh(lg, lm, leds.length)
      leds.forEach((p, i) => lmesh.setMatrixAt(i, tmpM.multiplyMatrices(p.r.matrix, local.makeTranslation(RACK.BLADE_W / 2 - 0.04, p.y - 0.03, RACK.FRONT - 0.019))))
      scene.add(lmesh)
      disposables.push(lg, lm)
    }
  }

  // ---------- group signs ----------
  const signs = []
  groups.forEach((g, gi) => {
    const rs = active.filter(r => r.group === gi)
    if (!rs.length || groups.length < 2 && !g.name) return
    const sc = (rs[0].s + rs[rs.length - 1].s) / 2
    const w = Math.min(2.6, Math.max(1.1, rs.length * 0.62))
    const canvas = makeSignCanvas()
    const mat = new THREE.ShaderMaterial({
      vertexShader: UV_VS, fragmentShader: SIGN_FS,
      uniforms: { uMap: { value: canvas.texture }, uTime, uAlpha: { value: 1 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 6.4), mat)
    mesh.position.copy(arcPoint(sc, Rc - 0.15, RACK.H + 0.36))
    mesh.rotation.y = -sc / Rc
    scene.add(mesh)
    disposables.push(mesh.geometry, mat, canvas.texture)
    signs.push({ g, canvas, last: '' })
  })

  // ---------- room: floor, ceiling, lights ----------
  const lightCount = Math.max(1, Math.min(MAX_LIGHTS, Math.round(activeLen / 1.6)))
  const lights = []
  for (let i = 0; i < MAX_LIGHTS; i++) {
    if (i < lightCount) {
      const sArc = lightCount === 1 ? 0 : (-activeLen / 2 + PITCH_X / 2) + (i / (lightCount - 1)) * (activeLen - PITCH_X)
      lights.push(arcPoint(sArc, Rc - 1.15, 2.9))
    } else lights.push(new THREE.Vector3(0, -10, 0))
  }
  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  const floor = new Reflector(new THREE.PlaneGeometry(Rc * 4 + 20, Rc * 4 + 20), {
    textureWidth: Math.round(size.x * 0.5), textureHeight: Math.round(size.y * 0.5), clipBias: 0.002, shader: FLOOR_SHADER, multisample: 0
  })
  floor.rotation.x = -Math.PI / 2
  floor.material.uniforms.uTime = uTime
  floor.material.uniforms.uLights.value = lights
  floor.material.uniforms.uC.value = new THREE.Vector2(0, Rc)
  floor.material.uniforms.uArc.value = new THREE.Vector4(Rc, halfSpan + PITCH_X / Rc, 0, 0)
  scene.add(floor)
  disposables.push(floor.geometry, floor.material, floor.getRenderTarget())

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(Rc * 4 + 20, Rc * 4 + 20), darkMat)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.y = 3.0
  scene.add(ceiling)
  disposables.push(ceiling.geometry)

  const coneMat = new THREE.ShaderMaterial({
    vertexShader: UV_VS, fragmentShader: CONE_FS, uniforms: { uTime },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  })
  const coneGeo = new THREE.ConeGeometry(0.95, 2.85, 40, 1, true)
  const stripGeo = new THREE.BoxGeometry(0.9, 0.02, 0.1)
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.4, 1.6) })
  disposables.push(coneMat, coneGeo, stripGeo, stripMat)
  const pointEvery = Math.max(1, Math.ceil(lightCount / 4))
  for (let i = 0; i < lightCount; i++) {
    const L = lights[i]
    const strip = new THREE.Mesh(stripGeo, stripMat)
    strip.position.set(L.x, 2.97, L.z)
    strip.rotation.y = -Math.atan2(L.x, Rc - L.z)
    scene.add(strip)
    const cone = new THREE.Mesh(coneGeo, coneMat)
    cone.position.set(L.x, 2.95 - 2.85 / 2, L.z)
    scene.add(cone)
    if (i % pointEvery === 0) {
      const pl = new THREE.PointLight(0xbfd4ff, 1.4, 0, 2)
      pl.position.set(L.x, 2.6, L.z)
      scene.add(pl)
    }
  }
  const ledGlow = new THREE.PointLight(0x2fb8ff, 0.6, 3, 2)
  ledGlow.position.set(0, 0.4, 1.4)
  scene.add(ledGlow)

  {
    const NP = 220 * lightCount, seeds = new Float32Array(NP * 3)
    for (let i = 0; i < NP * 3; i++) seeds[i] = Math.random() * 0.999
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 3), 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3))
    const m = new THREE.ShaderMaterial({
      vertexShader: DUST_VS, fragmentShader: SOFT_POINT_FRAG,
      uniforms: { uTime, uPx: pointScale, uLights: { value: lights }, uCount: { value: lightCount } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    })
    const pts = new THREE.Points(g, m)
    pts.frustumCulled = false
    scene.add(pts)
    disposables.push(g, m)
  }

  // ---------- hologram over the pulled-out blade ----------
  const holoMat = new THREE.ShaderMaterial({
    vertexShader: UV_VS, fragmentShader: HOLO_FS,
    uniforms: { uTime, uCpu: { value: 0 }, uMem: { value: 0 }, uDisk: { value: 0 }, uNet: { value: 0 }, uCores: { value: 4 }, uAlpha: { value: 0 }, uSeed: { value: 0 } },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  })
  const holo = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.235), holoMat)
  holo.visible = false
  scene.add(holo)
  disposables.push(holo.geometry, holoMat)

  // ---------- camera ----------
  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, Rc * 6 + 40)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controls.screenSpacePanning = false
  controls.panSpeed = 0.6
  controls.minDistance = 0.45
  controls.minPolarAngle = 0.95
  controls.maxPolarAngle = 1.78
  const sag = Rc * (1 - Math.cos(halfSpan))
  const xExtent = Rc * Math.sin(halfSpan) + 0.5
  function homePose(aspect = camera.aspect || 1.6) {
    if (vault) {
      // stand near the centre of the ring and look at its middle; orbiting turns the head
      return { target: new THREE.Vector3(0, 1.26, Rc - 0.7), position: new THREE.Vector3(0, 1.3, Rc + 0.5) }
    }
    const vh = THREE.MathUtils.degToRad(camera.fov / 2)
    const hh = Math.atan(Math.tan(vh) * aspect)
    const fitW = sag + xExtent / Math.tan(hh * 0.9)
    const fitH = (RACK.H * 0.66) / Math.tan(vh)
    // portrait screens: fit the rack height and let the visitor swipe along the wall
    const z = aspect < 0.9 ? THREE.MathUtils.clamp(fitW, fitH * 1.15, fitH * 1.6) : Math.max(2.4, fitW, fitH)
    const target = new THREE.Vector3(0, 1.1, sag * 0.4)
    return { target, position: new THREE.Vector3(0, 1.55, z) }
  }
  function applyLimits(home) {
    if (vault) {
      controls.maxDistance = Math.min(Rc - 1.4, 3.4)
      const az = halfSpan > 2.8 ? Infinity : halfSpan + 0.25
      controls.minAzimuthAngle = -az
      controls.maxAzimuthAngle = az
      return
    }
    controls.maxDistance = home.position.distanceTo(home.target) * 1.6 + 1
    const az = Math.min(1.35, halfSpan + 0.55)
    controls.minAzimuthAngle = -az
    controls.maxAzimuthAngle = az
  }

  const post = makeComposer(renderer, scene, camera, {
    pre: [new ShaderPass(HEAT_SHADER)],
    bloom: { strength: 0.6, radius: 0.32, threshold: 0.7 },
    grade: { uGrain: 0.045, uVignette: 0.55, uAberration: 0.0014 },
    samples
  })
  const heatPass = post.composer.passes[1]
  heatPass.uniforms.uHeat.value = Array.from({ length: 8 }, () => new THREE.Vector4())

  // ---------- per-frame ----------
  const byId = new Map(blades.map((b, i) => [b.id, i]))
  const cool = new THREE.Color(0.1, 0.62, 0.95), warm = new THREE.Color(1.2, 0.55, 0.08), hot = new THREE.Color(1.5, 0.08, 0.05)
  const tmpC = new THREE.Color()
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3()
  let targetsAt = -1
  const tagMats = []

  function refreshTargets(now) {
    blades.forEach((b) => {
      const rec = getRecord(b.id)
      if (!rec) return
      b.tgt = targetsOf(rec, now, showExpire)
      if (!b.cur) b.cur = { ...b.tgt, ping: [...b.tgt.ping] }
    })
  }
  function syncTags() {
    blades.forEach((b, i) => {
      const d = b.tgt?.expireDays ?? null
      if (d === (b.tagDays ?? null)) return
      if (b.tag) { scene.remove(b.tag); b.tag = null }
      b.tagDays = d
      if (d == null) return
      const tex = makeTagTexture(d, words)
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, color: new THREE.Color(1.4, 1.4, 1.4) })
      tagMats.push(mat, tex)
      const pivot = new THREE.Group()
      const plate = new THREE.Mesh(tagGeo, mat)
      plate.position.y = -0.04
      pivot.add(plate)
      pivot.quaternion.copy(b.rack.quat)
      pivot.userData.base = b.rack.quat.clone()
      scene.add(pivot)
      b.tag = pivot
      placeBlade(i)
    })
  }
  const tagGeo = new THREE.PlaneGeometry(0.045, 0.07)
  disposables.push(tagGeo)

  refreshTargets(Date.now())
  syncTags()
  blades.forEach((_, i) => placeBlade(i))
  for (const m of [panels, bodies, labels]) m.instanceMatrix.needsUpdate = true

  const swing = new THREE.Quaternion(), euler = new THREE.Euler()

  return {
    scene, camera, controls, Rc,
    blades,
    homePose, applyLimits,
    pick(raycaster) {
      if (!blades.length) return null
      const hit = raycaster.intersectObject(panels, false)[0]
      return hit && hit.instanceId != null ? blades[hit.instanceId]?.id ?? null : null
    },
    focusPose(id, aspect = camera.aspect || 1.6) {
      const i = byId.get(id)
      if (i == null) return null
      const b = blades[i], r = b.rack
      // keep the pulled-out blade (≈0.6 m wide incl. the tag) inside the horizontal field of view
      const hh = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect)
      const dist = Math.max(1.05, 0.42 / Math.tan(hh))
      const side = aspect < 1 ? 0.08 : 0.26
      const front = v1.set(0, b.y, RACK.FRONT).applyMatrix4(r.matrix).clone()
      const target = front.clone().addScaledVector(r.normal, 0.3).add(new THREE.Vector3(0, 0.07, 0))
      const position = target.clone().addScaledVector(r.normal, dist).addScaledVector(r.tangent, side).add(new THREE.Vector3(0, 0.12 * dist, 0))
      return { target, position }
    },
    has: (id) => byId.has(id),
    update(dt, t, state) {
      uTime.value = t
      heatPass.uniforms.uTime.value = t
      const now = Date.now()
      if (t - targetsAt > 0.5) { targetsAt = t; refreshTargets(now); syncTags() }
      const k = 1 - Math.exp(-dt * 3.2)
      const hk = Math.min(1, dt * 10), sk = Math.min(1, dt * 6)
      for (const r of active) { r.heatSum = 0; r.heatN = 0 }
      let selB = null
      for (let i = 0; i < blades.length; i++) {
        const b = blades[i], c = b.cur, g = b.tgt
        if (!c || !g) continue
        for (const key of ['on', 'cpu', 'mem', 'disk', 'rx', 'tx', 'io', 'dust']) c[key] = ease(c[key], g[key], k)
        c.ping = g.ping
        c.loss = g.loss
        const rpm = (1.5 + c.cpu * 40) * c.on
        b.fan += dt * rpm
        const isSel = state.selected === b.id
        b.hover = ease(b.hover, state.hover === b.id ? 1 : 0, hk)
        b.sel = ease(b.sel, isSel ? 1 : 0, sk)
        const slide = ease(b.slide, isSel ? 0.34 : 0, Math.min(1, dt * 5))
        if (Math.abs(slide - b.slide) > 1e-5) {
          b.slide = Math.abs(slide - (isSel ? 0.34 : 0)) < 1e-4 ? (isSel ? 0.34 : 0) : slide
          placeBlade(i)
          panels.instanceMatrix.needsUpdate = bodies.instanceMatrix.needsUpdate = labels.instanceMatrix.needsUpdate = true
        }
        aM[0].setXYZW(i, c.cpu, c.mem, c.disk, c.on)
        aM[1].setXYZW(i, c.rx, c.tx, c.io, c.dust)
        aM[2].setXYZW(i, b.fan, rpm, b.seed, b.hover)
        aM[3].setXYZW(i, c.ping[0], c.ping[1], c.ping[2], c.ping[3])
        aM[4].setXYZW(i, b.sel, c.loss, 0, 0)
        aLab.setX(i, 0.5 + 0.8 * c.on + b.hover * 0.4)
        if (b.tag) {
          euler.set(0.1 + Math.sin(t * 1.6 + b.seed * 4) * 0.12, 0, Math.sin(t * 2.3 + b.seed * 10) * 0.2)
          b.tag.quaternion.copy(b.tag.userData.base).multiply(swing.setFromEuler(euler))
        }
        b.rack.heatSum += c.cpu * c.on
        b.rack.heatN++
        if (isSel) selB = b
      }
      for (const a of aM) a.needsUpdate = true
      aLab.needsUpdate = true

      // rack status bars + heat shimmer over the hottest visible racks
      const heatU = heatPass.uniforms.uHeat.value
      const ranked = []
      racks.forEach((r, i) => {
        if (r.deco || !r.heatN) return
        const avg = r.heatSum / r.heatN
        r.heat = ease(r.heat, avg, k)
        tmpC.copy(cool).lerp(warm, THREE.MathUtils.smoothstep(r.heat, 0.3, 0.6)).lerp(hot, THREE.MathUtils.smoothstep(r.heat, 0.65, 0.85))
        bars.setColorAt(i, tmpC)
        v1.set(0, RACK.H + 0.02, RACK.FRONT - 0.2).applyMatrix4(r.matrix).project(camera)
        if (v1.z < 1 && Math.abs(v1.x) < 1.2 && r.heat > 0.05) ranked.push({ r, x: v1.x, y: v1.y })
      })
      bars.instanceColor.needsUpdate = true
      ranked.sort((a, b) => b.r.heat - a.r.heat)
      for (let i = 0; i < 8; i++) {
        const e = ranked[i]
        if (!e) { heatU[i].set(0, 0, 0, 0); continue }
        v2.set(RACK.W / 2, RACK.H, RACK.FRONT - 0.2).applyMatrix4(e.r.matrix).project(camera)
        heatU[i].set(e.x * 0.5 + 0.5, e.y * 0.5 + 0.5, Math.max(0.01, Math.abs(v2.x - e.x) * 0.5), Math.pow(e.r.heat, 1.5) * 2.2)
      }

      // group signs: redraw when the online count changes
      for (const sgn of signs) {
        let on = 0
        for (const id of sgn.g.ids) if (getRecord(id)?.online) on++
        const key = `${sgn.g.name}|${on}|${sgn.g.ids.length}`
        if (key !== sgn.last) { sgn.last = key; sgn.canvas.draw(sgn.g.name || '—', on, sgn.g.ids.length) }
      }

      const hu = holoMat.uniforms
      hu.uAlpha.value = ease(hu.uAlpha.value, selB ? 1 : 0, Math.min(1, dt * 5))
      holo.visible = hu.uAlpha.value > 0.01
      if (selB) {
        const c = selB.cur
        hu.uCpu.value = c.cpu * c.on; hu.uMem.value = c.mem * c.on; hu.uDisk.value = c.disk; hu.uNet.value = Math.max(c.rx, c.tx) * c.on
        hu.uCores.value = selB.tgt.cores; hu.uSeed.value = selB.seed
        holo.position.set(-0.06, selB.y + 0.24, RACK.FRONT + 0.42).applyMatrix4(selB.rack.matrix)
        holo.lookAt(camera.position)
      }
      controls.update()
    },
    render(t) { post.render(t) },
    resize(w, h, dpr) {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      post.setSize(w, h, dpr)
      floor.getRenderTarget().setSize(Math.round(w * dpr * 0.5), Math.round(h * dpr * 0.5))
    },
    dispose() {
      controls.dispose()
      post.dispose()
      for (const d of disposables) d.dispose?.()
      for (const d of tagMats) d.dispose?.()
      pmrem.dispose()
      scene.traverse(o => { if (o.isInstancedMesh) o.dispose() })
    }
  }
}
