import { NOISE } from './glsl.js'

export const RACK = {
  W: 0.64, H: 2.1, D: 1.0,
  BLADE_W: 0.56, BLADE_H: 0.13, BLADE_D: 0.8,
  PITCH: 0.144, SLOTS: 12, TOP_Y: 1.9
}
RACK.FRONT = RACK.D / 2
const A = (RACK.BLADE_W / RACK.BLADE_H).toFixed(4)

// Instanced blade faceplate. Per-instance attributes:
//   aM0 = cpu, mem, disk, on       aM1 = rx, tx, io, dust
//   aM2 = fanPhase, rpm, seed, hover
//   aM3 = ping ct, cu, cm, bd  (ms; -1 = not configured, -2 = timeout)
//   aM4 = selected, loss, -, -
export const PANEL_VS = /* glsl */`
attribute vec4 aM0, aM1, aM2, aM3, aM4;
varying vec2 vUv;
varying vec4 vM0, vM1, vM2, vM3, vM4;
void main(){
  vUv = uv;
  vM0 = aM0; vM1 = aM1; vM2 = aM2; vM3 = aM3; vM4 = aM4;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.);
}`

export const PANEL_FS = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying vec4 vM0, vM1, vM2, vM3, vM4;
${NOISE}
vec3 pingColor(float v, float loss, float seed, float k){
  if (v < -1.5) return vec3(1.6, .08, .06) * step(0., sin(uTime * 9. + k));
  if (v < -.5) return vec3(.008);
  vec3 c = v < 80. ? vec3(.12, 1.3, .36) : (v < 160. ? vec3(1.3, .82, .08) : vec3(1.45, .26, .06));
  float flick = step(loss * .08, hash12(vec2(floor(uTime * 12.), seed * 31. + k)));
  return c * mix(.25, 1., flick);
}
void main(){
  const float A = ${A};
  float cpu = vM0.x, mem = vM0.y, disk = vM0.z, on = vM0.w;
  float rx = vM1.x, tx = vM1.y, io = vM1.z, dust = vM1.w;
  float fan = vM2.x, rpm = vM2.y, seed = vM2.z, hover = vM2.w;
  float sel = vM4.x, loss = vM4.y;
  vec2 p = vec2(vUv.x * A, vUv.y);
  vec3 col = vec3(.034, .036, .041) * (.82 + .18 * vnoise(vec3(p.x * 90., p.y * 3., 1.)));
  col += vec3(.035) * smoothstep(.9, 1., vUv.y) + vec3(.015) * smoothstep(.1, 0., vUv.y);
  float ear = step(p.x, .12) + step(A - .12, p.x);
  col = mix(col, vec3(.055, .057, .063), ear);
  vec2 sp = vec2(p.x < A * .5 ? .06 : A - .06, .5);
  col = mix(col, vec3(.012), smoothstep(.028, .02, length(p - sp)) * ear);

  // fans: spin with CPU, glow orange behind the blades when hot
  for (int i = 0; i < 2; i++) {
    vec2 c = vec2(.44 + float(i) * .76, .5);
    vec2 q = p - c; float r = length(q);
    if (r < .42) {
      float th = atan(q.y, q.x);
      float rot = fan * (i == 0 ? 1. : 1.04) + float(i);
      float blades = smoothstep(-.1, .35, sin(7. * (th - rot) + r * 7.));
      blades = mix(blades, .42, clamp(rpm / 22., 0., .88));
      vec3 fc = vec3(.012) + vec3(.07, .074, .08) * blades;
      fc += vec3(1.3, .32, .06) * smoothstep(.6, .98, cpu) * (1. - blades * .6) * smoothstep(.42, .08, r) * .45 * on;
      fc = mix(fc, vec3(.05, .052, .058), smoothstep(.11, .1, r));
      float ringD = abs(fract(r * 10. + .5) - .5);
      float guard = smoothstep(.07, .02, ringD) * step(.12, r);
      float dA = abs(fract(th / 1.5708 + .5) - .5) * r * 1.5708;
      guard = max(guard, smoothstep(.014, .005, dA) * step(.1, r));
      guard = max(guard, smoothstep(.02, .0, abs(r - .41)));
      col = mix(fc, vec3(.1, .104, .112), guard);
    }
  }

  // honeycomb vent, breathing blue while powered
  if (p.x > 1.68 && p.x < 2.25 && p.y > .34 && p.y < .92) {
    vec2 hp = (p - vec2(1.68, .34)) * 22.;
    vec2 r2 = vec2(1., 1.732), h = r2 * .5;
    vec2 a = mod(hp, r2) - h, b = mod(hp - h, r2) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    vec2 ag = abs(g);
    float hd = max(dot(ag, vec2(.866, .5)), ag.y);
    float hole = smoothstep(.36, .3, hd);
    col = mix(col, vec3(.004, .01, .02) + vec3(0., .12, .3) * .5 * on * (.6 + .4 * sin(uTime * 2. + hp.x * .3)), hole);
  }

  // drive bays: activity LEDs blink with disk IO
  if (p.x > 2.3 && p.x < 3.05) {
    float bx = (p.x - 2.3) / .25; float bi = floor(bx); float bf = fract(bx);
    float bay = step(.06, bf) * step(bf, .94) * step(.09, p.y) * step(p.y, .91);
    col = mix(col, vec3(.016, .017, .02) + vec3(.012) * step(.78, p.y), bay);
    col += vec3(.018) * bay * step(.5, fract(p.y * 28.)) * step(.2, bf) * step(bf, .55) * step(.3, p.y) * step(p.y, .74);
    float led = smoothstep(.026, .016, length(vec2((bf - .78) * .25, p.y - .19)));
    float act = step(.45, hash12(vec2(floor(uTime * (3. + io * 30.)), bi + seed * 17.))) * step(.02, io) * on;
    col += led * mix(vec3(.015), vec3(.16, 1.3, .6), act);
  }

  // line-quality column: one LED per probe (ct / cu / cm / bd)
  if (p.x > 3.09 && p.x < 3.29) {
    for (int k = 0; k < 4; k++) {
      vec2 c = vec2(3.19, .8 - float(k) * .2);
      float d = length(p - c);
      col = mix(col, vec3(.006), smoothstep(.05, .04, d));
      float v = k == 0 ? vM3.x : (k == 1 ? vM3.y : (k == 2 ? vM3.z : vM3.w));
      col += smoothstep(.032, .02, d) * pingColor(v, loss, seed, float(k)) * on;
    }
  }

  // status cluster: CPU / MEM / DISK segment meters, NIC sockets, power
  if (p.x > 3.36 && p.x < A - .13) {
    float seg = (p.x - 3.4) / .7 * 12.; float si = floor(seg); float sf = fract(seg);
    float segMask = step(0., seg) * step(seg, 12.) * step(.14, sf) * step(sf, .86);
    float cpuRow = step(.7, p.y) * step(p.y, .84);
    float memRow = step(.52, p.y) * step(p.y, .66);
    float dskRow = step(.34, p.y) * step(p.y, .48);
    vec3 cc = mix(vec3(.12, 1.05, .32), vec3(1.25, .66, .06), smoothstep(5., 9., si));
    cc = mix(cc, vec3(1.5, .11, .06), step(10., si));
    float cpuLit = step(si + .5, cpu * 12.) * on;
    float memLit = step(si + .5, mem * 12.) * on;
    float dskLit = step(si + .5, disk * 12.);
    col = mix(col, vec3(.008), (cpuRow + memRow + dskRow) * segMask * .85);
    col += segMask * cpuRow * mix(cc * .03, cc, cpuLit);
    col += segMask * memRow * mix(vec3(.004, .012, .02), vec3(.1, .5, 1.15), memLit);
    vec3 dc = mix(vec3(.55, .32, 1.1), vec3(1.5, .11, .06), step(10., si));
    col += segMask * dskRow * mix(vec3(.01, .006, .02), dc, dskLit) * (.35 + .65 * on);
    for (int k = 0; k < 2; k++) {
      vec2 c = vec2(3.49 + float(k) * .22, .17);
      float sock = step(abs(p.x - c.x), .085) * step(abs(p.y - c.y), .1);
      col = mix(col, vec3(.004), sock);
      float l1 = smoothstep(.02, .011, length(p - c - vec2(-.052, .07)));
      float l2 = smoothstep(.02, .011, length(p - c - vec2(.052, .07)));
      float rate = k == 0 ? rx : tx;
      float act = step(.5, hash12(vec2(floor(uTime * (2. + rate * 34.)), float(k) + seed * 9.))) * step(.03, rate) * on;
      col += l1 * vec3(.1, 1.3, .22) * on + l2 * vec3(1.4, .75, .05) * act;
    }
  }

  // dust settles with uptime
  float dn = fbm3(vec3(p * 9., seed * 20.));
  float specks = step(.94, hash12(floor(p * vec2(150., 150.))));
  float dz = clamp(dust * (smoothstep(.3, .75, dn) * .85 + specks * .6), 0., 1.);
  col = mix(col, vec3(.075, .07, .06), dz * .6);
  col *= .55 + .45 * on;

  float pw = smoothstep(.03, .018, length(p - vec2(A - .2, .2)));
  col += pw * (on > .5 ? vec3(.12, 1.4, .38) : vec3(1.7, .06, .06) * step(0., sin(uTime * 7.)));

  vec2 e2 = min(vUv, 1. - vUv) * vec2(A, 1.);
  float edge = smoothstep(.025, 0., min(e2.x, e2.y));
  col += vec3(.2, 1.2, 2.) * edge * (hover * .8 + sel * 1.6);
  gl_FragColor = vec4(col, 1.);
}`

// Name labels from a single canvas atlas; aUv = (u0, v0, du, dv), aLab.x = brightness.
export const LABEL_VS = /* glsl */`
attribute vec4 aUv; attribute vec2 aLab;
varying vec2 vUv; varying float vB;
void main(){
  vUv = aUv.xy + uv * aUv.zw;
  vB = aLab.x;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.);
}`
export const LABEL_FS = /* glsl */`
uniform sampler2D uMap; varying vec2 vUv; varying float vB;
void main(){
  vec4 t = texture2D(uMap, vUv);
  if (t.a < .02) discard;
  gl_FragColor = vec4(t.rgb * vB, t.a);
}`

export const UV_VS = /* glsl */`
varying vec2 vUv; varying vec3 vWorld; varying vec3 vNW;
void main(){
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.); vWorld = w.xyz; vNW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`

export const HOLO_FS = /* glsl */`
uniform float uTime, uCpu, uMem, uDisk, uNet, uCores, uAlpha, uSeed;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 p = vUv;
  const float AR = 1.7;
  vec2 q = p * vec2(AR, 1.);
  vec2 e = min(q, vec2(AR, 1.) - q);
  float corner = step(e.x, .01) * step(e.y, .12) + step(e.y, .01) * step(e.x, .12);
  vec3 c = vec3(.25, 1.1, 1.6) * corner * .9;
  c += vec3(.02, .1, .16) * .3;
  float cores = max(uCores, 1.);
  float cols = ceil(sqrt(cores)), rows = ceil(cores / cols);
  vec2 g = (p - vec2(.06, .14)) / vec2(.5, .72);
  if (g.x > 0. && g.x < 1. && g.y > 0. && g.y < 1.) {
    vec2 cell = g * vec2(cols, rows); vec2 ci = floor(cell); vec2 cf = fract(cell);
    float idx = ci.y * cols + ci.x;
    float valid = step(idx + .5, cores);
    float load = clamp(uCpu + (hash13(vec3(ci, floor(uTime * 2.5) + uSeed)) - .5) * .45 * step(.02, uCpu), 0., 1.);
    float inCell = step(.08, cf.x) * step(cf.x, .92) * step(.08, cf.y) * step(cf.y, .92);
    float fill = step((cf.y - .08) / .84, load);
    vec3 hc = mix(vec3(.05, .42, .6), vec3(.9, .34, .06), smoothstep(.4, .85, load));
    c += valid * inCell * (hc * fill + vec3(.04, .18, .26) * .2);
  }
  float vals[3]; vals[0] = uMem; vals[1] = uDisk; vals[2] = uNet;
  for (int i = 0; i < 3; i++) {
    float y = .72 - float(i) * .22;
    float inBar = step(.62, p.x) * step(p.x, .94) * step(y - .045, p.y) * step(p.y, y + .045);
    float f = (p.x - .62) / .32;
    c += inBar * (step(f, vals[i]) * vec3(.04, .36, .55) + vec3(.01, .05, .08));
  }
  c *= .78 + .22 * sin(p.y * 260. + uTime * 9.);
  c *= .88 + .12 * hash11(floor(uTime * 24.));
  gl_FragColor = vec4(c * uAlpha, 1.);
}`

// Floor: perforated cold-aisle tiles on the arc in front of the racks + reflection.
export const FLOOR_SHADER = {
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    uTime: { value: 0 }, uLights: { value: [] }, uC: { value: null }, uArc: { value: null }
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix; varying vec4 vUvR; varying vec3 vWorld;
    void main(){ vUvR = textureMatrix * vec4(position, 1.); vec4 w = modelMatrix * vec4(position, 1.); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec3 uLights[8]; uniform vec2 uC; uniform vec4 uArc;
    varying vec4 vUvR; varying vec3 vWorld;
    ${NOISE}
    void main(){
      vec2 xz = vWorld.xz;
      vec2 tile = fract(xz / .6); vec2 tid = floor(xz / .6);
      float seam = 1. - smoothstep(0., .015, min(min(tile.x, 1. - tile.x), min(tile.y, 1. - tile.y)));
      vec2 rel = xz - uC;
      float rad = length(rel);
      float ang = atan(rel.x, -rel.y);
      float cold = step(uArc.x - 1.75, rad) * step(rad, uArc.x - .55) * step(abs(ang), uArc.y);
      vec2 hp = fract(xz * 22.) - .5;
      float holes = smoothstep(.22, .16, length(hp)) * cold;
      vec4 uvr = vUvR;
      uvr.xy += (vec2(vnoise(vec3(xz * 30., 1.)), vnoise(vec3(xz * 30., 7.))) - .5) * .004 * uvr.w;
      vec3 refl = textureProj(tDiffuse, uvr).rgb;
      vec3 col = vec3(.02, .022, .027) * (.9 + .1 * hash12(tid));
      col = mix(col, vec3(.004), seam);
      col += refl * .32 * (1. - seam);
      col += holes * vec3(.05, .35, .9) * (.5 + .2 * sin(uTime * 1.3 + ang * 6.));
      for (int i = 0; i < 8; i++) {
        if (uLights[i].y < 0.) continue;
        float d = length(xz - uLights[i].xz);
        col += vec3(.55, .7, 1.) * exp(-d * d * 2.2) * .06;
      }
      float fade = exp(-max(0., rad - uArc.x) * .35) * exp(-max(0., uArc.x * .25 - rad) * .02);
      gl_FragColor = vec4(col * fade, 1.);
    }`
}

export const CONE_FS = /* glsl */`
uniform float uTime; varying vec2 vUv; varying vec3 vWorld; varying vec3 vNW;
${NOISE}
void main(){
  vec3 V = normalize(cameraPosition - vWorld);
  float th = pow(abs(dot(vNW, V)), 1.5);
  float n = .6 + .4 * fbm3(vec3(vWorld * 3.) + vec3(0., uTime * .2, 0.));
  float a = pow(max(vUv.y, 0.), 1.6) * th * n;
  gl_FragColor = vec4(vec3(.55, .72, 1.) * a * .06, 1.);
}`

export const DUST_VS = /* glsl */`
attribute vec3 aSeed; uniform float uTime, uPx; uniform vec3 uLights[8]; uniform float uCount;
varying vec3 vColor; varying float vAlpha;
void main(){
  vec3 L = uLights[int(floor(aSeed.z * uCount))];
  float y = mod(aSeed.y * 2.6 - uTime * .03 * (.5 + aSeed.x), 2.6) + .1;
  float ang = aSeed.x * 6.2831 + uTime * .05;
  float rad = sqrt(fract(aSeed.x * 7.1)) * .85 * (1. - (y - .1) / 2.8);
  vec3 p = vec3(L.x + cos(ang) * rad + sin(uTime * .3 + aSeed.y * 20.) * .05, y, L.z + sin(ang) * rad);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 1.6 * uPx * (2.5 / -mv.z);
  vColor = vec3(.8, .9, 1.); vAlpha = .35 * (.5 + .5 * sin(uTime * 2. + aSeed.y * 40.));
}`

export const SIGN_FS = /* glsl */`
uniform sampler2D uMap; uniform float uTime, uAlpha; varying vec2 vUv;
${NOISE}
void main(){
  vec4 t = texture2D(uMap, vUv);
  float scan = .82 + .18 * sin(vUv.y * 120. + uTime * 6.);
  float flick = .9 + .1 * hash11(floor(uTime * 20.));
  gl_FragColor = vec4(t.rgb * t.a * scan * flick * uAlpha, 1.);
}`

export const HEAT_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uHeat: { value: [] } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec4 uHeat[8]; varying vec2 vUv;
    ${NOISE}
    void main(){
      vec2 uv = vUv; vec2 off = vec2(0.); float glow = 0.;
      for (int i = 0; i < 8; i++) {
        vec4 H = uHeat[i];
        if (H.w <= 0.) continue;
        float dy = uv.y - H.y;
        float wx = (uv.x - H.x) / H.z;
        float wgt = exp(-wx * wx * 1.4) * smoothstep(-.015, .02, dy) * exp(-max(dy, 0.) * 4.) * H.w;
        vec2 n = vec2(vnoise(vec3(uv * vec2(30., 14.) - vec2(0., uTime * 2.4), float(i))), vnoise(vec3(uv * vec2(24., 12.) - vec2(0., uTime * 2.), float(i) + 5.))) - .5;
        off += n * .016 * wgt;
        glow += wgt;
      }
      vec3 col = texture2D(tDiffuse, uv + off).rgb;
      col += vec3(.7, .2, .05) * glow * .035;
      gl_FragColor = vec4(col, 1.);
    }`
}
