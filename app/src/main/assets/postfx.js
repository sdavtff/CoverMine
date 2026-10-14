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
  uniform sampler2D tAO; uniform float uAO; uniform sampler2D tRays; uniform float uRays;
  uniform sampler2D tDepth; uniform float uHasDepth;
  uniform float uVignette; uniform float uGrade; uniform float uFlash; uniform vec3 uTint; uniform float uLDR;
  uniform sampler2D tAdapt; uniform float uAutoExp;
  uniform mat4 uInvViewProj; uniform mat4 uPrevViewProj; uniform mat4 uInvProj; uniform float uMB;
  uniform sampler2D tDof; uniform float uDof;
  uniform float uCA; uniform float uGrain; uniform float uTime; uniform vec2 uRes;
  uniform vec2 uSunUV; uniform float uSunOn; uniform float uAspect; uniform float uRain;
  varying vec2 vUv;
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 worldFrom(vec2 uv, float d) { vec4 p = uInvViewProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
  float linDepth(vec2 uv) { float d = texture2D(tDepth, uv).x; vec4 p = uInvProj * vec4(0.0, 0.0, d * 2.0 - 1.0, 1.0); return -p.z / p.w; }
  vec3 sampleScene(vec2 uv) {
    if (uCA > 0.0) {
      // aberração cromática: vermelho e azul levemente deslocados para as bordas
      vec2 dir = (uv - 0.5) * uCA * 0.005;
      return vec3(texture2D(tScene, uv + dir).r, texture2D(tScene, uv).g, texture2D(tScene, uv - dir).b);
    }
    return texture2D(tScene, uv).rgb;
  }
  // gotas de chuva na lente: células com gotas que aparecem, escorrem um pouco e somem
  vec2 lensDrops(vec2 uv, out float mask) {
    vec2 g = vec2(uAspect * 9.0, 9.0);
    vec2 cell = floor(uv * g), f = fract(uv * g) - 0.5;
    float r = hash12(cell), r2 = hash12(cell + 7.3);
    float life = fract(uTime * (0.12 + r * 0.18) + r2);
    vec2 c = vec2(r - 0.5, r2 - 0.5) * 0.5 + vec2(0.0, -life * 0.25);
    float size = (0.12 + 0.18 * r) * smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.75, 1.0, life));
    vec2 dv = (f - c) * vec2(1.0, 1.3);
    float dd = length(dv);
    mask = step(r2, 0.55) * smoothstep(size, size * 0.6, dd);
    return -dv * mask * 0.08;
  }
  void main() {
    vec2 uv = vUv;
    float dropMask = 0.0;
    if (uRain > 0.0) uv += lensDrops(vUv, dropMask) * uRain;
    float d = uHasDepth > 0.5 ? texture2D(tDepth, uv).x : 0.5;
    bool hand = uHasDepth > 0.5 && d < 0.001;
    vec3 c;
    if (uMB > 0.0 && uHasDepth > 0.5 && !hand) {
      // desfoque de movimento da câmera: reprojeta o pixel no quadro anterior
      vec3 wp = worldFrom(uv, min(d, 0.9999));
      vec4 pc = uPrevViewProj * vec4(wp, 1.0);
      vec2 vel = (uv - (pc.xy / pc.w * 0.5 + 0.5)) * uMB;
      float vl = length(vel);
      if (vl > 0.04) vel *= 0.04 / vl;
      c = vec3(0.0);
      for (int i = 0; i < 8; i++) c += texture2D(tScene, uv - vel * (float(i) / 7.0 - 0.5)).rgb;
      c /= 8.0;
    } else c = sampleScene(uv);
    if (uDof > 0.0 && uHasDepth > 0.5 && !hand) {
      // profundidade de campo: foco no que está no centro da tela
      float fz = (linDepth(vec2(0.5)) + linDepth(vec2(0.47, 0.5)) + linDepth(vec2(0.53, 0.5)) + linDepth(vec2(0.5, 0.46)) + linDepth(vec2(0.5, 0.54))) / 5.0;
      float z = linDepth(uv);
      float coc = clamp(abs(z - fz) / (fz * 0.5 + 1.5) - 0.08, 0.0, 1.0);
      c = mix(c, texture2D(tDof, uv).rgb, coc * uDof);
    }
    if (uAO > 0.0 && !hand) c *= mix(1.0, texture2D(tAO, uv).r, uAO);
    if (uBloom > 0.0) c += texture2D(tBloom, uv).rgb * uBloom;
    if (uRays > 0.0) c += texture2D(tRays, uv).rgb * uRays;
    float ex = uExposure;
    if (uAutoExp > 0.0) {
      // adaptação do olho: caverna clareia aos poucos, céu aberto escurece
      float avg = texture2D(tAdapt, vec2(0.5)).r * 4.0;
      ex *= clamp(0.34 / max(avg, 0.005), 0.55, 2.6);
    }
    vec3 col;
    if (uLDR > 0.5) col = c;
    else { col = aces(c * ex); col = toSRGB(col); }
    float sunVis = 0.0;
    if (uSunOn > 0.0 && uHasDepth > 0.5) {
      // o sol só gera reflexo se estiver visível (céu, sem montanha/folhas na frente)
      for (int k = 0; k < 5; k++) {
        vec2 o = k == 0 ? vec2(0.0) : k == 1 ? vec2(0.01, 0.0) : k == 2 ? vec2(-0.01, 0.0) : k == 3 ? vec2(0.0, 0.015) : vec2(0.0, -0.015);
        sunVis += texture2D(tDepth, clamp(uSunUV + o, 0.001, 0.999)).x >= 0.99999 ? 0.2 : 0.0;
      }
    }
    if (uSunOn * sunVis > 0.0) {
      // reflexos da lente (fantasmas na linha sol → centro)
      float uSunOnV = uSunOn * sunVis;
      vec2 toC = vec2(0.5) - uSunUV;
      for (int k = 0; k < 4; k++) {
        float t = k == 0 ? 0.45 : k == 1 ? 0.8 : k == 2 ? 1.25 : 1.6;
        float rr = k == 0 ? 0.035 : k == 1 ? 0.06 : k == 2 ? 0.025 : 0.09;
        vec3 tint = k == 0 ? vec3(1.0, 0.7, 0.4) : k == 1 ? vec3(0.5, 0.8, 1.0) : k == 2 ? vec3(0.9, 0.5, 1.0) : vec3(0.6, 1.0, 0.7);
        float dd = length((uv - (uSunUV + toC * t)) * vec2(uAspect, 1.0));
        col += tint * smoothstep(rr, rr * 0.6, dd) * 0.06 * uSunOnV;
      }
      float dh = length((uv - uSunUV) * vec2(uAspect, 1.0));
      col += vec3(1.0, 0.85, 0.6) * smoothstep(0.32, 0.28, dh) * smoothstep(0.24, 0.29, dh) * 0.04 * uSunOnV;
    }
    if (uGrade > 0.0) {
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.0 + 0.12 * uGrade);
      col = (col - 0.5) * (1.0 + 0.06 * uGrade) + 0.5;
      col *= mix(vec3(1.0), uTint, uGrade);
    }
    if (uVignette > 0.0) { vec2 dv = vUv - 0.5; col *= 1.0 - dot(dv, dv) * 0.9 * uVignette; }
    col += uFlash;
    if (dropMask > 0.0) col = mix(col, col * 1.08 + 0.02, dropMask * uRain);
    if (uGrain > 0.0) col += (hash12(vUv * uRes + fract(uTime * 7.3) * 100.0) - 0.5) * 0.035 * uGrain;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`, { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uExposure: { value: 1 }, uVignette: { value: 0 }, uGrade: { value: 0 }, uFlash: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) }, uLDR: { value: 0 },
  tAO: { value: null }, uAO: { value: 0 }, tRays: { value: null }, uRays: { value: 0 }, tDepth: { value: null }, uHasDepth: { value: 0 },
  tAdapt: { value: null }, uAutoExp: { value: 0 }, uInvViewProj: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uMB: { value: 0 },
  tDof: { value: null }, uDof: { value: 0 }, uCA: { value: 0 }, uGrain: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2() },
  uSunUV: { value: new THREE.Vector2() }, uSunOn: { value: 0 }, uAspect: { value: 1 }, uRain: { value: 0 } });

// ---------------- exposição automática ----------------
const lumMat = mk(/* glsl */`
  uniform sampler2D tSrc; varying vec2 vUv;
  void main() { vec3 c = texture2D(tSrc, vUv).rgb; gl_FragColor = vec4(vec3(min(dot(c, vec3(0.2126, 0.7152, 0.0722)), 4.0) / 4.0), 1.0); }`, { tSrc: { value: null } });
const adaptMat = mk(/* glsl */`
  uniform sampler2D tLum; uniform sampler2D tPrev; uniform float uDt; uniform float uReset; varying vec2 vUv;
  void main() {
    float s = 0.0;
    for (int y = 0; y < 6; y++) for (int x = 0; x < 6; x++) s += texture2D(tLum, (vec2(float(x), float(y)) + 0.5) / 6.0).r;
    float cur = s / 36.0, prev = texture2D(tPrev, vec2(0.5)).r;
    // escurecer é rápido; acostumar-se com o escuro é mais lento
    float rate = cur > prev ? 1.6 : 0.6;
    float v = uReset > 0.5 ? cur : mix(prev, cur, 1.0 - exp(-uDt * rate));
    gl_FragColor = vec4(vec3(v), 1.0);
  }`, { tLum: { value: null }, tPrev: { value: null }, uDt: { value: 0.016 }, uReset: { value: 1 } });

// ---------------- TAA (anti-aliasing temporal) ----------------
const taaMat = mk(/* glsl */`
  uniform sampler2D tCur; uniform sampler2D tHist; uniform sampler2D tDepth; uniform mat4 uInvViewProj; uniform mat4 uPrevViewProj;
  uniform vec2 uTexel; uniform float uValid; varying vec2 vUv;
  void main() {
    vec3 cur = texture2D(tCur, vUv).rgb;
    float d = texture2D(tDepth, vUv).x;
    if (uValid < 0.5 || d < 0.001) { gl_FragColor = vec4(cur, 1.0); return; }
    vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, min(d, 0.9999) * 2.0 - 1.0, 1.0); wp /= wp.w;
    vec4 pc = uPrevViewProj * wp;
    vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
    if (puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0) { gl_FragColor = vec4(cur, 1.0); return; }
    vec3 mn = cur, mx = cur;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec3 n = texture2D(tCur, vUv + vec2(float(x), float(y)) * uTexel).rgb; mn = min(mn, n); mx = max(mx, n); }
    vec3 hist = clamp(texture2D(tHist, puv).rgb, mn, mx);
    gl_FragColor = vec4(mix(cur, hist, 0.88), 1.0);
  }`, { tCur: { value: null }, tHist: { value: null }, tDepth: { value: null }, uInvViewProj: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uValid: { value: 0 } });
const copyMat = mk(/* glsl */`uniform sampler2D tSrc; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }`, { tSrc: { value: null } });
const HALTON = [];
{ const h = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }; for (let i = 1; i <= 8; i++) HALTON.push([h(i, 2) - 0.5, h(i, 3) - 0.5]); }
const _vp = new THREE.Matrix4(), _ivp = new THREE.Matrix4(), _unj = new THREE.Matrix4();
let taaFrame = 0;
// chamado antes de desenhar: aplica o deslocamento subpixel (TAA) e guarda as matrizes sem deslocamento
export function beginCameraFrame(camera) {
  const r = G.renderer;
  if (camera.view && camera.view.enabled) camera.clearViewOffset();
  camera.updateMatrixWorld();
  _unj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  if (postEnabled() && G.eff.taa) {
    r.getDrawingBufferSize(P.size);
    const j = HALTON[taaFrame++ % 8];
    camera.setViewOffset(P.size.x, P.size.y, j[0], j[1], P.size.x, P.size.y);
  }
}

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
  const r = G.renderer, eff = G.eff;
  r.getDrawingBufferSize(P.size);
  const w = Math.max(1, P.size.x), h = Math.max(1, P.size.y);
  const wantSamples = eff.aa && r.capabilities.isWebGL2 ? 4 : 0;
  const type = R.halfFloatRT ? THREE.HalfFloatType : THREE.UnsignedByteType;
  // vários efeitos precisam da profundidade da cena (só WebGL2)
  const depth = r.capabilities.isWebGL2 && (eff.ssao > 0 || !!eff.godrays || !!eff.taa || !!eff.motionBlur || !!eff.dof || !!eff.lensFlare);
  if (!P.sceneRT || P.sceneRT.width !== w || P.sceneRT.height !== h || P.samples !== wantSamples || P.type !== type || P.depth !== depth) {
    for (const k of ['sceneRT', 'ldrRT', 'bloomA', 'bloomB', 'aoA', 'aoB', 'rayA', 'rayB', 'dofA', 'dofB', 'lumRT', 'adaptA', 'adaptB', 'histA', 'histB']) if (P[k]) { P[k].dispose(); P[k] = null; }
    const opts = { type, samples: wantSamples };
    if (depth) { opts.depthTexture = new THREE.DepthTexture(w, h); opts.depthTexture.type = THREE.UnsignedIntType; }
    P.sceneRT = new THREE.WebGLRenderTarget(w, h, opts);
    P.depth = depth;
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    const nd = { depthBuffer: false };
    if (depth) {
      P.aoA = new THREE.WebGLRenderTarget(hw, hh, Object.assign({ type: THREE.UnsignedByteType }, nd));
      P.aoB = new THREE.WebGLRenderTarget(hw, hh, Object.assign({ type: THREE.UnsignedByteType }, nd));
      P.rayA = new THREE.WebGLRenderTarget(qw, qh, Object.assign({ type }, nd));
      P.rayB = new THREE.WebGLRenderTarget(qw, qh, Object.assign({ type }, nd));
      P.dofA = new THREE.WebGLRenderTarget(hw, hh, Object.assign({ type }, nd));
      P.dofB = new THREE.WebGLRenderTarget(hw, hh, Object.assign({ type }, nd));
      P.histA = new THREE.WebGLRenderTarget(w, h, Object.assign({ type: THREE.UnsignedByteType }, nd));
      P.histB = new THREE.WebGLRenderTarget(w, h, Object.assign({ type: THREE.UnsignedByteType }, nd));
    }
    P.lumRT = new THREE.WebGLRenderTarget(32, 32, Object.assign({ type }, nd));
    P.adaptA = new THREE.WebGLRenderTarget(1, 1, Object.assign({ type }, nd));
    P.adaptB = new THREE.WebGLRenderTarget(1, 1, Object.assign({ type }, nd));
    P.adaptReset = true; P.histValid = false;
    P.ldrRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType });
    P.bloomA = new THREE.WebGLRenderTarget(qw, qh, { type });
    P.bloomB = new THREE.WebGLRenderTarget(qw, qh, { type });
    P.samples = wantSamples; P.type = type;
  }
}
function pass(mat, target) { quad.material = mat; G.renderer.setRenderTarget(target); G.renderer.render(quadScene, quadCam); }

export function postEnabled() { return (G.eff.post || 0) > 0; }
export function resetHistory() { P.histValid = false; P.adaptReset = true; }

const _sunW = new THREE.Vector3(), _fw = new THREE.Vector3();
let lastT = performance.now();
// desenha o quadro: drawScene(target) desenha a cena no alvo dado; extra.overlay desenha a mão por cima
export function renderFrame(drawScene, extra = {}) {
  const r = G.renderer, eff = G.eff, S = G.settings, cam = G.camera;
  const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (!postEnabled()) { r.setRenderTarget(null); drawScene(null); if (extra.overlay) { r.setRenderTarget(null); extra.overlay(); } P.prevVP = null; return; }
  ensureTargets();
  const exposure = r.toneMappingExposure;
  const tm = r.toneMapping;
  r.toneMapping = THREE.NoToneMapping;
  drawScene(P.sceneRT);
  r.toneMapping = tm;
  const u = compMat.uniforms;
  cam.updateMatrixWorld();
  // matrizes: atual (com o deslocamento do TAA) e a do quadro anterior (sem deslocamento)
  _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  _ivp.copy(_vp).invert();
  const prevVP = P.prevVP || _unj;
  // bloom (limiar físico: só o que passa de ~1,5× o branco; o céu não estoura)
  const bloomOn = eff.post >= 2 && S.bloom;
  if (bloomOn) {
    brightMat.uniforms.tSrc.value = P.sceneRT.texture;
    brightMat.uniforms.uThreshold.value = R.halfFloatRT ? 1.5 : 0.88;
    pass(brightMat, P.bloomA);
    for (let i = 0; i < 2; i++) {
      blurMat.uniforms.tSrc.value = P.bloomA.texture; blurMat.uniforms.uDir.value.set(1.6 / P.bloomA.width, 0); pass(blurMat, P.bloomB);
      blurMat.uniforms.tSrc.value = P.bloomB.texture; blurMat.uniforms.uDir.value.set(0, 1.6 / P.bloomA.height); pass(blurMat, P.bloomA);
    }
  }
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
  // sol na tela: raios e reflexos da lente
  u.uRays.value = 0; u.uSunOn.value = 0;
  if (P.depth && extra.sunDir) {
    _sunW.copy(extra.sunDir).multiplyScalar(500).add(cam.position).project(cam);
    const facing = extra.sunDir.dot(cam.getWorldDirection(_fw));
    const sx = _sunW.x * 0.5 + 0.5, sy = _sunW.y * 0.5 + 0.5;
    if (eff.godrays && extra.rays > 0.01 && facing > 0 && Math.abs(_sunW.x) < 1.6 && Math.abs(_sunW.y) < 1.6) {
      rayMask.uniforms.tScene.value = P.sceneRT.texture; rayMask.uniforms.tDepth.value = P.sceneRT.depthTexture;
      rayMask.uniforms.uSun.value.set(sx, sy); rayMask.uniforms.uAspect.value = cam.aspect;
      pass(rayMask, P.rayA);
      rayBlur.uniforms.tSrc.value = P.rayA.texture; rayBlur.uniforms.uSun.value.set(sx, sy); rayBlur.uniforms.uDensity.value = 0.95;
      pass(rayBlur, P.rayB);
      u.tRays.value = P.rayB.texture;
      u.uRays.value = extra.rays * Math.min(1, facing * 2);
    }
    if (eff.lensFlare && facing > 0.2 && Math.abs(_sunW.x) < 1 && Math.abs(_sunW.y) < 1 && extra.sunVisible > 0.01) {
      u.uSunUV.value.set(sx, sy);
      u.uSunOn.value = extra.sunVisible * Math.min(1, (facing - 0.2) * 3);
    }
  }
  // profundidade de campo: cena desfocada em meia resolução
  u.uDof.value = 0;
  if (P.depth && eff.dof) {
    copyMat.uniforms.tSrc.value = P.sceneRT.texture; pass(copyMat, P.dofA);
    for (let i = 0; i < 2; i++) {
      blurMat.uniforms.tSrc.value = P.dofA.texture; blurMat.uniforms.uDir.value.set(2 / P.dofA.width, 0); pass(blurMat, P.dofB);
      blurMat.uniforms.tSrc.value = P.dofB.texture; blurMat.uniforms.uDir.value.set(0, 2 / P.dofA.height); pass(blurMat, P.dofA);
    }
    u.tDof.value = P.dofA.texture; u.uDof.value = 1;
  }
  // exposição automática (média de luminância adaptada ao longo do tempo)
  u.uAutoExp.value = 0;
  if (eff.autoExposure) {
    lumMat.uniforms.tSrc.value = P.sceneRT.texture; pass(lumMat, P.lumRT);
    adaptMat.uniforms.tLum.value = P.lumRT.texture; adaptMat.uniforms.tPrev.value = P.adaptA.texture;
    adaptMat.uniforms.uDt.value = dt; adaptMat.uniforms.uReset.value = P.adaptReset ? 1 : 0;
    pass(adaptMat, P.adaptB);
    const t = P.adaptA; P.adaptA = P.adaptB; P.adaptB = t;
    P.adaptReset = false;
    u.tAdapt.value = P.adaptA.texture; u.uAutoExp.value = 1;
  }
  // mão em 1ª pessoa (profundidade comprimida perto de 0: não estraga a profundidade da cena)
  if (extra.overlay) { r.setRenderTarget(P.sceneRT); const tm2 = r.toneMapping; r.toneMapping = THREE.NoToneMapping; extra.overlay(); r.toneMapping = tm2; }
  u.tDepth.value = P.depth ? P.sceneRT.depthTexture : null; u.uHasDepth.value = P.depth ? 1 : 0;
  u.uInvViewProj.value.copy(_ivp); u.uPrevViewProj.value.copy(prevVP);
  u.uInvProj.value.copy(cam.projectionMatrixInverse);
  u.uMB.value = eff.motionBlur && P.depth && P.prevVP ? 0.6 : 0;
  u.uCA.value = eff.chromatic ? 1 : 0;
  u.uGrain.value = eff.grain ? 1 : 0;
  u.uTime.value = now / 1000;
  u.uRes.value.set(P.size.x, P.size.y);
  u.uAspect.value = cam.aspect;
  u.uRain.value = eff.lensDrops ? (extra.lensRain || 0) : 0;
  u.tScene.value = P.sceneRT.texture;
  u.tBloom.value = P.bloomA.texture;
  u.uBloom.value = bloomOn ? 0.35 : 0;
  u.uExposure.value = exposure;
  u.uVignette.value = S.vignette ? 0.5 + (extra.vignette || 0) : (extra.vignette || 0);
  u.uGrade.value = S.grading ? 1 : 0;
  u.uFlash.value = extra.flash || 0;
  u.uLDR.value = 0;
  if (extra.tint) u.uTint.value.copy(extra.tint); else u.uTint.value.setRGB(1, 1, 1);
  const taa = !!(eff.taa && P.depth);
  const fxaa = eff.post >= 3 && !eff.aa && !taa;
  pass(compMat, fxaa || taa ? P.ldrRT : null);
  if (fxaa) { fxaaMat.uniforms.tSrc.value = P.ldrRT.texture; fxaaMat.uniforms.uRes.value.set(P.ldrRT.width, P.ldrRT.height); pass(fxaaMat, null); }
  if (taa) {
    taaMat.uniforms.tCur.value = P.ldrRT.texture; taaMat.uniforms.tHist.value = P.histA.texture; taaMat.uniforms.tDepth.value = P.sceneRT.depthTexture;
    taaMat.uniforms.uInvViewProj.value.copy(_ivp); taaMat.uniforms.uPrevViewProj.value.copy(prevVP);
    taaMat.uniforms.uTexel.value.set(1 / P.size.x, 1 / P.size.y); taaMat.uniforms.uValid.value = P.histValid && P.prevVP ? 1 : 0;
    pass(taaMat, P.histB);
    copyMat.uniforms.tSrc.value = P.histB.texture; pass(copyMat, null);
    const t = P.histA; P.histA = P.histB; P.histB = t;
    P.histValid = true;
  }
  P.prevVP = (P.prevVP || new THREE.Matrix4()).copy(_unj);
}
