import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.05 },
    uVignette: { value: 0.35 },
    uAberration: { value: 0.0015 },
    uTint: { value: new THREE.Color(1, 1, 1) }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uAberration; uniform vec3 uTint;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - .5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * uAberration * 9.;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col *= uTint;
      col *= 1. - uVignette * smoothstep(.1, .55, r2 * 1.6);
      float g = h(vUv * 913.7 + fract(uTime * 7.13)) - .5;
      col += g * uGrain;
      gl_FragColor = vec4(col, 1.);
    }
  `
};

export function makeComposer(renderer, scene, camera, opts = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: opts.samples ?? 4
  });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  for (const p of opts.pre || []) composer.addPass(p);
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    opts.bloom?.strength ?? 1,
    opts.bloom?.radius ?? 0.5,
    opts.bloom?.threshold ?? 0.2
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  if (opts.grade) {
    for (const [k, v] of Object.entries(opts.grade)) {
      if (grade.uniforms[k]) {
        if (grade.uniforms[k].value?.isColor) {
          if (Array.isArray(v)) grade.uniforms[k].value.fromArray(v);
          else grade.uniforms[k].value.set(v);
        }
        else grade.uniforms[k].value = v;
      }
    }
  }
  composer.addPass(grade);

  return {
    composer,
    bloom,
    grade,
    render(t) {
      grade.uniforms.uTime.value = t;
      composer.render();
    },
    setSize(w, h, dpr) {
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
    },
    dispose() { composer.dispose(); rt.dispose(); }
  };
}
