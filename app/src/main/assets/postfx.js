// Pós-processamento modular: bloom, tone mapping ACES, correção de cor, vinheta e FXAA.
// Cada efeito pode ser ligado/desligado; com "post = 0" a cena é desenhada direto na tela.
import * as THREE from './lib/three.module.min.js';
import { G } from './state.js';
import { R } from './render.js';

const P = { sceneRT: null, ldrRT: null, bloomA: null, bloomB: null, size: new THREE.Vector2(), samples: 0 };
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
quad.frustumCulled = false;
const quadScene = new THREE.Scene();
quadScene.add(quad);

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const ACES = /* glsl */`
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = ACESInputMat * (color / 0.6);
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
`;
const mk = (frag, uniforms) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped: false });

const brightMat = mk(/* glsl */`
  uniform sampler2D tSrc; uniform float uThreshold; varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold * 1.8, l), 1.0);
  }`, { tSrc: { value: null }, uThreshold: { value: 0.9 } });
const blurMat = mk(/* glsl */`
  uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
    c += texture2D(tSrc, vUv + uDir * 1.384615).rgb * 0.316216;
    c += texture2D(tSrc, vUv - uDir * 1.384615).rgb * 0.316216;
    c += texture2D(tSrc, vUv + uDir * 3.230769).rgb * 0.070270;
    c += texture2D(tSrc, vUv - uDir * 3.230769).rgb * 0.070270;
    gl_FragColor = vec4(c, 1.0);
  }`, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
const compMat = mk(ACES + /* glsl */`
  uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; uniform float uExposure;
  uniform float uVignette; uniform float uGrade; uniform float uFlash; uniform vec3 uTint; uniform float uLDR;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    if (uBloom > 0.0) c += texture2D(tBloom, vUv).rgb * uBloom;
    vec3 col;
    if (uLDR > 0.5) col = c; // cena já em LDR (sem alvo de ponto flutuante)
    else { col = aces(c * uExposure); col = toSRGB(col); }
    if (uGrade > 0.0) {
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.0 + 0.12 * uGrade);
      col = (col - 0.5) * (1.0 + 0.06 * uGrade) + 0.5;
      col *= mix(vec3(1.0), uTint, uGrade);
    }
    if (uVignette > 0.0) { vec2 d = vUv - 0.5; col *= 1.0 - dot(d, d) * 0.9 * uVignette; }
    col += uFlash;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`, { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uExposure: { value: 1 }, uVignette: { value: 0 }, uGrade: { value: 0 }, uFlash: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) }, uLDR: { value: 0 } });
const fxaaMat = mk(/* glsl */`
  uniform sampler2D tSrc; uniform vec2 uRes; varying vec2 vUv;
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  void main() {
    vec2 px = 1.0 / uRes;
    vec3 rgbNW = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * px).rgb, rgbNE = texture2D(tSrc, vUv + vec2(1.0, -1.0) * px).rgb;
    vec3 rgbSW = texture2D(tSrc, vUv + vec2(-1.0, 1.0) * px).rgb, rgbSE = texture2D(tSrc, vUv + vec2(1.0, 1.0) * px).rgb;
    vec3 rgbM = texture2D(tSrc, vUv).rgb;
    float lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE), lM = luma(rgbM);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
    float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
    float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
    dir = clamp(dir * rcp, -8.0, 8.0) * px;
    vec3 a = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 b = a * 0.5 + 0.25 * (texture2D(tSrc, vUv + dir * -0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
    float lb = luma(b);
    gl_FragColor = vec4((lb < lMin || lb > lMax) ? a : b, 1.0);
  }`, { tSrc: { value: null }, uRes: { value: new THREE.Vector2() } });

function ensureTargets() {
  const r = G.renderer;
  r.getDrawingBufferSize(P.size);
  const w = Math.max(1, P.size.x), h = Math.max(1, P.size.y);
  const wantSamples = G.eff.aa && r.capabilities.isWebGL2 ? 4 : 0;
  const type = R.halfFloatRT ? THREE.HalfFloatType : THREE.UnsignedByteType;
  if (!P.sceneRT || P.sceneRT.width !== w || P.sceneRT.height !== h || P.samples !== wantSamples || P.type !== type) {
    for (const k of ['sceneRT', 'ldrRT', 'bloomA', 'bloomB']) if (P[k]) P[k].dispose();
    P.sceneRT = new THREE.WebGLRenderTarget(w, h, { type, samples: wantSamples });
    P.ldrRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType });
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    P.bloomA = new THREE.WebGLRenderTarget(bw, bh, { type });
    P.bloomB = new THREE.WebGLRenderTarget(bw, bh, { type });
    P.samples = wantSamples; P.type = type;
  }
}
function pass(mat, target) { quad.material = mat; G.renderer.setRenderTarget(target); G.renderer.render(quadScene, quadCam); }

export function postEnabled() { return (G.eff.post || 0) > 0; }

// desenha o quadro: drawScene(target) desenha a cena (e a mão) no alvo dado
export function renderFrame(drawScene, extra = {}) {
  const r = G.renderer, eff = G.eff, S = G.settings;
  if (!postEnabled()) { r.setRenderTarget(null); drawScene(null); return; }
  ensureTargets();
  const exposure = r.toneMappingExposure;
  const tm = r.toneMapping;
  r.toneMapping = THREE.NoToneMapping;
  drawScene(P.sceneRT);
  r.toneMapping = tm;
  const bloomOn = eff.post >= 2 && S.bloom;
  if (bloomOn) {
    brightMat.uniforms.tSrc.value = P.sceneRT.texture;
    brightMat.uniforms.uThreshold.value = R.halfFloatRT ? 1.1 : 0.85;
    pass(brightMat, P.bloomA);
    for (let i = 0; i < 2; i++) {
      blurMat.uniforms.tSrc.value = P.bloomA.texture; blurMat.uniforms.uDir.value.set(1.6 / P.bloomA.width, 0); pass(blurMat, P.bloomB);
      blurMat.uniforms.tSrc.value = P.bloomB.texture; blurMat.uniforms.uDir.value.set(0, 1.6 / P.bloomA.height); pass(blurMat, P.bloomA);
    }
  }
  const u = compMat.uniforms;
  u.tScene.value = P.sceneRT.texture;
  u.tBloom.value = P.bloomA.texture;
  u.uBloom.value = bloomOn ? 0.35 : 0;
  u.uExposure.value = exposure;
  u.uVignette.value = S.vignette ? 0.5 + (extra.vignette || 0) : (extra.vignette || 0);
  u.uGrade.value = S.grading ? 1 : 0;
  u.uFlash.value = extra.flash || 0;
  u.uLDR.value = R.halfFloatRT ? 0 : 0;
  if (extra.tint) u.uTint.value.copy(extra.tint); else u.uTint.value.setRGB(1, 1, 1);
  const fxaa = eff.post >= 3 && !eff.aa;
  pass(compMat, fxaa ? P.ldrRT : null);
  if (fxaa) { fxaaMat.uniforms.tSrc.value = P.ldrRT.texture; fxaaMat.uniforms.uRes.value.set(P.ldrRT.width, P.ldrRT.height); pass(fxaaMat, null); }
}
