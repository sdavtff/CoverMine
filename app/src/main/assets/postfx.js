// Pós-processamento modular: bloom, tone mapping ACES, correção de cor, vinheta e FXAA.
// Cada efeito pode ser ligado/desligado; com "post = 0" a cena é desenhada direto na tela.
import * as THREE from './lib/three.module.min.js';
import { G } from './state.js';
import { R } from './render.js';

const P = { sceneRT: null, ldrRT: null, bloomA: null, bloomB: null, aoA: null, aoB: null, rayA: null, rayB: null, size: new THREE.Vector2(), samples: 0, depth: false };
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
  uniform sampler2D tAO; uniform float uAO; uniform sampler2D tRays; uniform float uRays; uniform sampler2D tDepth; uniform float uHandMask;
  uniform float uVignette; uniform float uGrade; uniform float uFlash; uniform vec3 uTint; uniform float uLDR;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    // depois da mão, a profundidade só contém a mão: ali não se aplica o AO da cena
    float hand = uHandMask > 0.5 && texture2D(tDepth, vUv).x < 0.99999 ? 1.0 : 0.0;
    if (uAO > 0.0) c *= mix(1.0, texture2D(tAO, vUv).r, uAO * (1.0 - hand));
    if (uBloom > 0.0) c += texture2D(tBloom, vUv).rgb * uBloom;
    if (uRays > 0.0) c += texture2D(tRays, vUv).rgb * uRays;
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
  }`, { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uExposure: { value: 1 }, uVignette: { value: 0 }, uGrade: { value: 0 }, uFlash: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) }, uLDR: { value: 0 },
  tAO: { value: null }, uAO: { value: 0 }, tRays: { value: null }, uRays: { value: 0 }, tDepth: { value: null }, uHandMask: { value: 0 } });

// ---------------- SSAO (meia resolução) ----------------
// reconstrói a posição no espaço da câmera pela profundidade, normal pelas diferenças dos vizinhos,
// e testa N amostras num hemisfério girado por pixel (ruído entrelaçado); depois um desfoque que respeita bordas.
const AO_KERNEL = [];
for (let i = 0; i < 16; i++) {
  const a = i * 2.399963, z = 0.15 + 0.85 * ((i * 0.618034) % 1);
  const r = Math.sqrt(1 - z * z), sc = 0.25 + 0.75 * ((i + 1) / 16) * ((i + 1) / 16);
  AO_KERNEL.push(new THREE.Vector3(Math.cos(a) * r * sc, Math.sin(a) * r * sc, z * sc));
}
const VIEWPOS = /* glsl */`
uniform sampler2D tDepth; uniform mat4 uInvProj; uniform mat4 uProj;
vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}`;
const aoMats = {};
function aoMaterial(n) {
  if (aoMats[n]) return aoMats[n];
  return (aoMats[n] = mk(VIEWPOS + /* glsl */`
    #define AO_N ${n}
    uniform vec3 uKernel[16]; uniform vec2 uTexel; uniform float uRadius;
    varying vec2 vUv;
    void main() {
      float d = texture2D(tDepth, vUv).x;
      if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
      vec3 P = viewPos(vUv);
      vec3 pr = viewPos(vUv + vec2(uTexel.x, 0.0)) - P, pl = P - viewPos(vUv - vec2(uTexel.x, 0.0));
      vec3 pu = viewPos(vUv + vec2(0.0, uTexel.y)) - P, pd = P - viewPos(vUv - vec2(0.0, uTexel.y));
      vec3 dx = abs(pr.z) < abs(pl.z) ? pr : pl, dy = abs(pu.z) < abs(pd.z) ? pu : pd;
      vec3 N = normalize(cross(dx, dy));
      float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float ang = noise * 6.2831853;
      vec3 rnd = vec3(cos(ang), sin(ang), 0.0);
      vec3 T = normalize(rnd - N * dot(rnd, N)); vec3 B = cross(N, T);
      float radius = uRadius * clamp(-P.z * 0.08, 0.6, 2.0);
      float occ = 0.0;
      for (int i = 0; i < AO_N; i++) {
        vec3 k = uKernel[i];
        vec3 S = P + (T * k.x + B * k.y + N * k.z) * radius;
        vec4 c = uProj * vec4(S, 1.0);
        vec2 suv = c.xy / c.w * 0.5 + 0.5;
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
        float sz = viewPos(suv).z;
        float range = smoothstep(0.0, 1.0, radius / abs(P.z - sz));
        occ += (sz >= S.z + 0.03 ? 1.0 : 0.0) * range;
      }
      float ao = 1.0 - occ / float(AO_N);
      gl_FragColor = vec4(vec3(ao * ao), 1.0);
    }`, { tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() }, uKernel: { value: AO_KERNEL }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.7 } }));
}
const aoBlur = mk(/* glsl */`
  uniform sampler2D tSrc; uniform sampler2D tDepth; uniform vec2 uDir; uniform mat4 uInvProj;
  varying vec2 vUv;
  float lin(vec2 uv) { float d = texture2D(tDepth, uv).x; vec4 p = uInvProj * vec4(0.0, 0.0, d * 2.0 - 1.0, 1.0); return -p.z / p.w; }
  void main() {
    float z0 = lin(vUv), sum = 0.0, wsum = 0.0;
    for (int i = -3; i <= 3; i++) {
      vec2 uv = vUv + uDir * float(i);
      float w = exp(-float(i * i) * 0.12) / (1.0 + abs(lin(uv) - z0) * 6.0 / max(z0 * 0.05, 0.05));
      sum += texture2D(tSrc, uv).r * w; wsum += w;
    }
    gl_FragColor = vec4(vec3(sum / wsum), 1.0);
  }`, { tSrc: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uInvProj: { value: new THREE.Matrix4() } });

// ---------------- raios de sol (god rays) ----------------
// máscara: só o céu perto do sol; depois um desfoque radial a partir da posição do sol na tela.
const rayMask = mk(/* glsl */`
  uniform sampler2D tScene; uniform sampler2D tDepth; uniform vec2 uSun; uniform float uAspect;
  varying vec2 vUv;
  void main() {
    float d = texture2D(tDepth, vUv).x;
    vec2 dv = (vUv - uSun) * vec2(uAspect, 1.0);
    float fall = pow(max(0.0, 1.0 - length(dv) * 1.6), 2.0);
    // só a parte mais brilhante do céu (o sol e o halo): os raios aparecem onde algo o encobre
    vec3 sc = texture2D(tScene, vUv).rgb;
    float l = dot(sc, vec3(0.2126, 0.7152, 0.0722));
    vec3 c = d >= 0.99999 ? min(sc, vec3(4.0)) * smoothstep(0.9, 2.5, l) * fall : vec3(0.0);
    gl_FragColor = vec4(c, 1.0);
  }`, { tScene: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
const rayBlur = mk(/* glsl */`
  uniform sampler2D tSrc; uniform vec2 uSun; uniform float uDensity;
  varying vec2 vUv;
  void main() {
    vec2 delta = (vUv - uSun) * uDensity / 24.0;
    vec2 uv = vUv; float decay = 1.0; vec3 acc = vec3(0.0);
    for (int i = 0; i < 24; i++) { uv -= delta; acc += texture2D(tSrc, uv).rgb * decay; decay *= 0.94; }
    gl_FragColor = vec4(acc / 16.0, 1.0);
  }`, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uDensity: { value: 0.9 } });
const _sunW = new THREE.Vector3();
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
  // SSAO e raios de sol precisam da profundidade da cena (só WebGL2)
  const depth = r.capabilities.isWebGL2 && (G.eff.ssao > 0 || !!G.eff.godrays);
  if (!P.sceneRT || P.sceneRT.width !== w || P.sceneRT.height !== h || P.samples !== wantSamples || P.type !== type || P.depth !== depth) {
    for (const k of ['sceneRT', 'ldrRT', 'bloomA', 'bloomB', 'aoA', 'aoB', 'rayA', 'rayB']) if (P[k]) { P[k].dispose(); P[k] = null; }
    const opts = { type, samples: wantSamples };
    if (depth) { opts.depthTexture = new THREE.DepthTexture(w, h); opts.depthTexture.type = THREE.UnsignedIntType; }
    P.sceneRT = new THREE.WebGLRenderTarget(w, h, opts);
    P.depth = depth;
    if (depth) {
      const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
      P.aoA = new THREE.WebGLRenderTarget(hw, hh, { type: THREE.UnsignedByteType, depthBuffer: false });
      P.aoB = new THREE.WebGLRenderTarget(hw, hh, { type: THREE.UnsignedByteType, depthBuffer: false });
      P.rayA = new THREE.WebGLRenderTarget(qw, qh, { type, depthBuffer: false });
      P.rayB = new THREE.WebGLRenderTarget(qw, qh, { type, depthBuffer: false });
    }
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
  if (!postEnabled()) { r.setRenderTarget(null); drawScene(null); if (extra.overlay) { r.setRenderTarget(null); extra.overlay(); } return; }
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
  const cam = G.camera;
  // SSAO
  u.uAO.value = 0;
  if (P.depth && eff.ssao > 0 && !extra.noAO) {
    const am = aoMaterial(eff.ssao >= 2 ? 12 : 6);
    am.uniforms.tDepth.value = P.sceneRT.depthTexture;
    am.uniforms.uProj.value.copy(cam.projectionMatrix);
    am.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
    am.uniforms.uTexel.value.set(1 / P.aoA.width, 1 / P.aoA.height);
    pass(am, P.aoA);
    aoBlur.uniforms.tDepth.value = P.sceneRT.depthTexture;
    aoBlur.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
    aoBlur.uniforms.tSrc.value = P.aoA.texture; aoBlur.uniforms.uDir.value.set(1 / P.aoA.width, 0); pass(aoBlur, P.aoB);
    aoBlur.uniforms.tSrc.value = P.aoB.texture; aoBlur.uniforms.uDir.value.set(0, 1 / P.aoA.height); pass(aoBlur, P.aoA);
    u.tAO.value = P.aoA.texture;
    u.uAO.value = eff.ssao >= 2 ? 0.85 : 0.7;
  }
  // raios de sol
  u.uRays.value = 0;
  if (P.depth && eff.godrays && extra.sunDir && extra.rays > 0.01) {
    _sunW.copy(extra.sunDir).multiplyScalar(500).add(cam.position).project(cam);
    const facing = extra.sunDir.dot(cam.getWorldDirection(new THREE.Vector3()));
    if (facing > 0 && Math.abs(_sunW.x) < 1.6 && Math.abs(_sunW.y) < 1.6) {
      const sx = _sunW.x * 0.5 + 0.5, sy = _sunW.y * 0.5 + 0.5;
      rayMask.uniforms.tScene.value = P.sceneRT.texture; rayMask.uniforms.tDepth.value = P.sceneRT.depthTexture;
      rayMask.uniforms.uSun.value.set(sx, sy); rayMask.uniforms.uAspect.value = cam.aspect;
      pass(rayMask, P.rayA);
      rayBlur.uniforms.tSrc.value = P.rayA.texture; rayBlur.uniforms.uSun.value.set(sx, sy); rayBlur.uniforms.uDensity.value = 0.95;
      pass(rayBlur, P.rayB);
      u.tRays.value = P.rayB.texture;
      u.uRays.value = extra.rays * Math.min(1, facing * 2);
    }
  }
  // sobreposição (mão em 1ª pessoa) depois do SSAO e dos raios, que precisam só da profundidade da cena
  u.uHandMask.value = 0;
  if (extra.overlay) { r.setRenderTarget(P.sceneRT); const tm2 = r.toneMapping; r.toneMapping = THREE.NoToneMapping; extra.overlay(); r.toneMapping = tm2; if (P.depth) { u.tDepth.value = P.sceneRT.depthTexture; u.uHandMask.value = 1; } }
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
