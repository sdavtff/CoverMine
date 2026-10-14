// Shaders do VoxelCraft: céu atmosférico, nuvens, água, neblina com perspectiva aérea e
// iluminação voxel (luz do céu + luz de blocos + AO) injetada nos materiais do Three.js r160.
import * as THREE from './lib/three.module.min.js';

// Uniforms compartilhados por todos os materiais (atualizar uma vez por quadro).
export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uSunGlow: { value: new THREE.Color() },
  uSunDisc: { value: new THREE.Color() },
  uNight: { value: 0 },
  uFogStart: { value: 40 },
  uFogEnd: { value: 90 },
  uFogDensity: { value: 0.01 },
  uUnderwater: { value: 0 },
  uUnderColor: { value: new THREE.Color(0x0a2a44) },
  uMinLight: { value: 0.035 },
  uTorchColor: { value: new THREE.Color(1.0, 0.62, 0.3) },
  uLampGlow: { value: 1.6 },
  uWind: { value: 1 },
  uCaustics: { value: 0 },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  uLightCol: { value: new THREE.Color(1, 1, 1) },
  uAmbient: { value: new THREE.Color(0.5, 0.6, 0.8) },
  uShadowCenter: { value: new THREE.Vector3() },
  uShadowRange: { value: 1e6 },
  uStarRot: { value: 0 },
  uMoonPhase: { value: 0.5 },
  uWet: { value: 0 },          // superfícies molhadas pela chuva (0..1)
  uSnowCover: { value: 0 },    // neve acumulada em superfícies voltadas para cima (0..1)
  uSnowCenter: { value: new THREE.Vector3() },
  uFlash: { value: 0 },        // relâmpago
  uPlayerPos: { value: new THREE.Vector3(0, -999, 0) },
  uCloudCover: { value: 0.52 },
  uPomScale: { value: 0.002 },
  uFogHeight: { value: 0 },    // nível de referência da neblina de vale
  uFogValley: { value: 0 },    // densidade da neblina baixa (mais forte de manhã)
};

// ---------------- GLSL comum: céu + neblina ----------------
export const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunGlow;
uniform vec3 uSunDisc;
uniform float uNight;
uniform float uTime;
uniform float uStarRot;
uniform float uMoonPhase;
float vcHash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
// Cor do céu na direção d. discs=1 desenha sol, lua e estrelas.
vec3 vcSky(vec3 d, float discs) {
  float y = d.y;
  float h = clamp(y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.5));
  col = mix(col, uHorizon * 0.5, 1.0 - smoothstep(-0.3, 0.0, y));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunGlow * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.5);
  col += uSunGlow * pow(1.0 - h, 5.0) * sd * sd * 1.1;
  if (discs > 0.5) {
    float above = smoothstep(-0.03, 0.01, y);
    col += uSunDisc * smoothstep(0.99935, 0.9997, sd) * above;
    col += uSunGlow * pow(sd, 900.0) * 3.0 * above;
    float md = max(dot(d, -uSunDir), 0.0);
    float moon = smoothstep(0.99905, 0.99935, md);
    // fase da lua: a linha de sombra atravessa o disco conforme os dias passam
    vec3 mDir = -uSunDir, mT = normalize(cross(mDir, vec3(0.0, 0.0, 1.0)));
    float mu = dot(d - mDir * md, mT) / 0.036;
    float term = cos(uMoonPhase * 6.2831853);
    float lit = uMoonPhase < 0.5 ? smoothstep(term - 0.08, term + 0.08, mu) : smoothstep(term - 0.08, term + 0.08, -mu);
    float crater = 0.8 + 0.2 * vcHash3(floor(d * 900.0));
    col += vec3(0.75, 0.82, 1.0) * moon * crater * (0.06 + 0.94 * lit) * (0.15 + 1.1 * uNight) * above;
    col += vec3(0.06, 0.08, 0.14) * pow(md, 300.0) * uNight;
    if (uNight > 0.01 && y > 0.0) {
      // estrelas giram com a hora (eixo do movimento do sol)
      float cr = cos(uStarRot), sr = sin(uStarRot);
      vec3 ds = vec3(d.x * cr - d.y * sr, d.x * sr + d.y * cr, d.z);
      vec3 g = floor(ds * 170.0);
      float s = vcHash3(g);
      float tw = 0.6 + 0.4 * sin(uTime * (1.5 + s * 3.0) + s * 80.0);
      col += vec3(step(0.9972, s) * tw * 1.4) * uNight * smoothstep(0.0, 0.2, y);
    }
  }
  return col;
}
`;

export const FOG_GLSL = /* glsl */`
uniform float uFogStart;
uniform float uFogEnd;
uniform float uFogDensity;
uniform float uUnderwater;
uniform vec3 uUnderColor;
uniform float uFogHeight;
uniform float uFogValley;
vec3 vcFog(vec3 col, vec3 wp) {
  vec3 dv = wp - cameraPosition;
  float dist = length(dv);
  if (uUnderwater > 1.5) {
    float fu = 1.0 - exp(-dist * 0.6);
    return mix(col, uUnderColor, clamp(fu, 0.0, 1.0));
  }
  if (uUnderwater > 0.5) {
    // debaixo d'água: absorção por cor (vermelho some rápido) + espalhamento azul-esverdeado
    col *= exp(-dist * vec3(0.24, 0.075, 0.05));
    float fu = 1.0 - exp(-dist * 0.085);
    return mix(col, uUnderColor, clamp(fu, 0.0, 1.0));
  }
  vec3 dir = dv / max(dist, 1e-4);
  float x = max(dist - uFogStart, 0.0) * uFogDensity;
  float f = 1.0 - exp(-x * x);
  // altura: neblina um pouco mais densa nas partes baixas do mundo
  f *= mix(1.0, 0.7, smoothstep(30.0, 60.0, wp.y));
  // neblina de vale: mais densa perto do nível de referência (rios, vales), mais forte de manhã
  if (uFogValley > 0.0) {
    float hLow = min(cameraPosition.y, wp.y) - uFogHeight;
    float fv = uFogValley * (1.0 - exp(-dist * 0.03)) * exp(-max(hLow, 0.0) * 0.09);
    f = 1.0 - (1.0 - f) * (1.0 - clamp(fv, 0.0, 0.85));
  }
  // sempre esconde a borda do mundo carregado
  f = max(f, smoothstep(uFogEnd * 0.8, uFogEnd, dist));
  return mix(col, vcSky(dir, 0.0), clamp(f, 0.0, 1.0));
}
`;

// ---------------- Céu ----------------
export function makeSkyMaterial(discs = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uDiscs: { value: discs } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: SKY_GLSL + /* glsl */`
      uniform float uDiscs;
      uniform float uUnderwater;
      uniform vec3 uUnderColor;
      varying vec3 vDir;
      void main() {
        vec3 c = vcSky(normalize(vDir), uDiscs);
        if (uUnderwater > 0.5) c = uUnderColor;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
}

// ---------------- Nuvens ----------------
const NOISE2_GLSL = /* glsl */`
float vcH2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vcN2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vcH2(i), vcH2(i + vec2(1.0, 0.0)), u.x), mix(vcH2(i + vec2(0.0, 1.0)), vcH2(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;
export function makeCloudMaterial(quality) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uCover: { value: 0.52 },
      uCloudLit: { value: new THREE.Color(1, 1, 1) },
      uCloudShade: { value: new THREE.Color(0.6, 0.65, 0.75) },
    },
    defines: { CLOUD_Q: quality },
    vertexShader: /* glsl */`
      varying vec3 vWorldP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: SKY_GLSL + NOISE2_GLSL + /* glsl */`
      uniform float uCover;
      uniform vec3 uCloudLit;
      uniform vec3 uCloudShade;
      varying vec3 vWorldP;
      float cfbm(vec2 p) {
        float s = 0.0, a = 0.5;
        mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
        #if CLOUD_Q >= 2
        for (int i = 0; i < 6; i++) { s += a * vcN2(p); p = m * p; a *= 0.5; }
        #else
        for (int i = 0; i < 4; i++) { s += a * vcN2(p); p = m * p; a *= 0.5; }
        #endif
        return s;
      }
      float dens(vec2 p) { return smoothstep(uCover, uCover + 0.32, cfbm(p)); }
      void main() {
        vec2 wind = vec2(uTime * 0.0035, uTime * 0.0012);
        vec2 p = vWorldP.xz * 0.0042 + wind;
        float d = dens(p);
        if (d < 0.01) discard;
        vec2 sd = normalize(uSunDir.xz + vec2(1e-4)) * 0.045;
        #if CLOUD_Q >= 2
          // sombreamento volumétrico: marcha curta em direção ao sol
          float occ = 0.0;
          for (int i = 1; i <= 4; i++) occ += dens(p + sd * float(i));
          float lit = exp(-occ * 0.75) * (1.0 - d * 0.25);
        #else
          float lit = 1.0 - d * 0.45 + (d - dens(p + sd * 2.0)) * 0.5;
        #endif
        vec3 col = mix(uCloudShade, uCloudLit, clamp(lit, 0.0, 1.0));
        vec3 V = normalize(vWorldP - cameraPosition);
        float sdot = max(dot(V, uSunDir), 0.0);
        col += uSunGlow * pow(sdot, 10.0) * (1.0 - d) * 1.4;
        float dist = length(vWorldP.xz - cameraPosition.xz);
        col = mix(col, vcSky(V, 0.0), smoothstep(150.0, 800.0, dist) * 0.75);
        float a = d * (1.0 - smoothstep(520.0, 880.0, dist));
        gl_FragColor = vec4(col, a * 0.94);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

// ---------------- Água ----------------
const GER_GLSL = /* glsl */`
// ondas de Gerstner (3 componentes): deslocamento + gradiente analítico da altura
const vec3 GW0 = vec3(0.96, 0.29, 9.0), GW1 = vec3(-0.37, 0.93, 5.5), GW2 = vec3(0.66, -0.75, 3.2);
const vec3 GA = vec3(0.035, 0.022, 0.012);
vec3 gerstner(vec2 p, float t, inout vec2 grad) {
  vec3 o = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec3 w = i == 0 ? GW0 : i == 1 ? GW1 : GW2;
    float A = i == 0 ? GA.x : i == 1 ? GA.y : GA.z;
    float k = 6.2831853 / w.z, sp = sqrt(9.8 / k) * 0.55;
    float ph = k * dot(w.xy, p) - sp * k * t;
    o.xz += w.xy * cos(ph) * A * 0.6;
    o.y += sin(ph) * A;
    grad += w.xy * k * A * cos(ph);
  }
  return o;
}
`;
export function makeWaterMaterial(quality, reflTex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uReflTex: { value: reflTex || null },
      uReflMat: { value: new THREE.Matrix4() },
      uUseRefl: { value: 0 },
      uWaterLevel: { value: 0 },
      uShallow: { value: new THREE.Color(0.06, 0.32, 0.36) },
      uDeep: { value: new THREE.Color(0.01, 0.06, 0.16) },
      uOpacity: { value: 1 },
    },
    defines: { WATER_Q: quality },
    vertexShader: /* glsl */`
      attribute vec4 aLight;
      uniform float uTime;
      varying vec3 vWorldP;
      varying vec4 vLight;
      varying vec3 vN;
      ${GER_GLSL}
      void main() {
        vLight = aLight;
        vN = normal;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float flags = floor(aLight.w * 255.0 + 0.5);
        #if WATER_Q >= 1
        if (flags >= 16.0) {
          vec2 g = vec2(0.0);
          wp.xyz += gerstner(wp.xz, uTime, g);
        }
        #endif
        vWorldP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: SKY_GLSL + FOG_GLSL + NOISE2_GLSL + /* glsl */`
      uniform sampler2D uReflTex;
      uniform mat4 uReflMat;
      uniform float uUseRefl;
      uniform float uWaterLevel;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uLightDir;
      uniform vec3 uLightCol;
      uniform vec3 uAmbient;
      uniform vec3 uTorchColor;
      uniform float uMinLight;
      uniform float uOpacity;
      varying vec3 vWorldP;
      varying vec4 vLight;
      varying vec3 vN;
      ${GER_GLSL}
      vec2 waveGrad(vec2 p, float t) {
        vec2 g = vec2(0.0);
        // ondas de Gerstner (as mesmas do vértice) + detalhe
        gerstner(p, t, g);
        #if WATER_Q >= 2
        vec2 d4 = vec2(3.1, -2.3), d5 = vec2(-4.2, 3.7), d6 = vec2(6.3, 5.1);
        g += d4 * cos(dot(p, d4) + t * 2.6) * 0.012;
        g += d5 * cos(dot(p, d5) - t * 3.1) * 0.008;
        g += d6 * cos(dot(p, d6) + t * 3.7) * 0.004;
        // micro-ondulações por ruído
        float e = 0.08;
        vec2 q = p * 2.3 + vec2(t * 0.35, -t * 0.25);
        float n0 = vcN2(q), nx = vcN2(q + vec2(e, 0.0)), nz = vcN2(q + vec2(0.0, e));
        g += vec2(nx - n0, nz - n0) / e * 0.025;
        #endif
        return g;
      }
      void main() {
        vec3 V = normalize(cameraPosition - vWorldP);
        vec3 N = normalize(vN);
        bool top = N.y > 0.5;
        float depth = vLight.x * 15.0;
        #if WATER_Q >= 1
        if (top) { vec2 g = waveGrad(vWorldP.xz, uTime); N = normalize(vec3(-g.x, 1.0, -g.y)); }
        #endif
        bool below = dot(N, V) < 0.0;
        if (below) N = -N;
        float skyB = pow(0.78, 15.0 * (1.0 - vLight.y));
        float blkB = pow(0.8, 15.0 * (1.0 - vLight.z)) * step(0.01, vLight.z);
        float sunVis = smoothstep(0.6, 0.95, vLight.y);
        float NdV = clamp(dot(N, V), 0.0, 1.0);
        float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
        vec3 R = reflect(-V, N);
        vec3 refl = vcSky(vec3(R.x, abs(R.y), R.z), 1.0) * (0.15 + 0.85 * skyB);
        #if WATER_Q >= 3
        if (uUseRefl > 0.5 && top && !below && abs(vWorldP.y - uWaterLevel) < 0.2) {
          vec4 pc = uReflMat * vec4(vWorldP.x, uWaterLevel, vWorldP.z, 1.0);
          vec2 ruv = pc.xy / pc.w + N.xz * 0.05;
          refl = texture2D(uReflTex, clamp(ruv, 0.001, 0.999)).rgb;
        }
        #endif
        vec3 lightAmt = uAmbient * max(skyB, uMinLight) + uLightCol * max(uLightDir.y, 0.0) * 0.3 * sunVis + uTorchColor * blkB;
        float depthF = 1.0 - exp(-depth * 0.3);
        // absorção por profundidade (Beer-Lambert): o vermelho some primeiro, depois o verde
        vec3 trans = exp(-vec3(0.42, 0.11, 0.075) * depth * 1.3);
        vec3 body = mix(uDeep, uShallow * 1.15, trans.g) * lightAmt;
        vec3 col;
        float alpha;
        if (below) {
          // visto de baixo: janela de Snell e reflexão interna
          float win = smoothstep(0.55, 0.8, NdV);
          col = mix(body * 1.4, refl * 0.9, win);
          alpha = mix(0.92, 0.55, win);
        } else {
          col = mix(body, refl, fres);
          alpha = clamp(1.0 - dot(trans, vec3(0.3, 0.4, 0.3)) * 0.62, 0.42, 0.93);
          alpha = clamp(alpha + fres * 0.35, 0.0, 0.97);
        }
        #if WATER_Q >= 2
        vec3 H = normalize(uLightDir + V);
        float sp = pow(max(dot(N, H), 0.0), 520.0) * 5.0 + pow(max(dot(N, H), 0.0), 60.0) * 0.12;
        col += uLightCol * sp * sunVis * step(0.0, uLightDir.y);
        if (top && !below) {
          // espuma na margem (água rasa)
          float shore = 1.0 - smoothstep(0.25, 1.1, depth);
          float n = vcN2(vWorldP.xz * 3.5 + vec2(uTime * 0.3, uTime * 0.21)) * 0.6 + vcN2(vWorldP.xz * 9.0 - uTime * 0.5) * 0.4;
          float foam = shore * smoothstep(0.55 - shore * 0.35, 0.8, n);
          col = mix(col, vec3(0.92, 0.96, 1.0) * lightAmt * 1.3, foam * 0.75);
          alpha = max(alpha, foam * 0.9);
        }
        #endif
        if (!top) alpha = max(alpha, 0.7);
        col = vcFog(col, vWorldP);
        gl_FragColor = vec4(col, alpha * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

// ---------------- Terreno (injeção nos materiais Standard/Lambert) ----------------
const TERRAIN_VERT_PARS = /* glsl */`
attribute vec4 aLight;
varying vec4 vLight;
varying vec3 vWorldP;
uniform float uTime;
uniform float uWind;
uniform vec3 uPlayerPos;
`;
// aLight: x = AO, y = luz do céu (0..1), z = luz de blocos (0..1), w = flags/255
// flags: 1 = folhas (vento), 2 = topo de planta (vento), 4 = emissivo, 8 = submerso (cáusticas)
const WIND_GLSL = /* glsl */`
{
  float vcFlags = floor(aLight.w * 255.0 + 0.5);
  float sway = 0.0;
  if (mod(vcFlags, 2.0) >= 1.0) sway = 0.03;
  if (mod(floor(vcFlags / 2.0), 2.0) >= 1.0) sway = 0.1;
  if (sway > 0.0 && uWind > 0.0) {
    vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
    float ph = uTime * 1.7 + wp0.x * 0.37 + wp0.z * 0.29;
    float gust = 0.65 + 0.35 * sin(uTime * 0.4 + wp0.x * 0.05);
    transformed.x += sin(ph) * sway * uWind * gust;
    transformed.z += cos(ph * 0.83 + 1.3) * sway * 0.7 * uWind * gust;
    transformed.y += sin(ph * 1.3) * sway * 0.15 * uWind;
  }
  // plantas se afastam do jogador quando ele passa
  if (sway >= 0.1) {
    vec3 wpi = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vec3 dd = wpi - uPlayerPos;
    float rr = length(dd.xz);
    if (rr < 1.3 && abs(dd.y + 0.5) < 1.6) {
      float push = (1.3 - rr) / 1.3 * 0.45;
      transformed.xz += normalize(dd.xz + vec2(1e-4)) * push;
      transformed.y -= push * 0.35;
    }
  }
}
`;

const TERRAIN_FRAG_PARS = SKY_GLSL + FOG_GLSL + NOISE2_GLSL + /* glsl */`
varying vec4 vLight;
varying vec3 vWorldP;
uniform float uWet;
uniform float uSnowCover;
uniform vec3 uSnowCenter;
uniform float uFlash;
uniform float uCloudCover;
uniform float uPomScale;
uniform vec3 uLightCol;
uniform vec3 uLightDir;
float vcSunShadow = 1.0;
vec3 vcFN = vec3(0.0, 1.0, 0.0);
// sombra das nuvens: a mesma densidade do shader das nuvens, projetada pelo sol até o terreno
float vcCloudShadow(vec3 P) {
  if (uLightDir.y < 0.05) return 1.0;
  float ch = 112.0;
  vec2 cp = P.xz + uLightDir.xz / uLightDir.y * (ch - P.y);
  vec2 p = cp * 0.0042 + vec2(uTime * 0.0035, uTime * 0.0012);
  float sum = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) { sum += a * vcN2(p); p = m * p; a *= 0.5; }
  float d = smoothstep(uCloudCover, uCloudCover + 0.32, sum);
  return 1.0 - d * 0.65;
}
uniform float uMinLight;
uniform vec3 uTorchColor;
uniform float uLampGlow;
uniform float uCaustics;
uniform vec3 uShadowCenter;
uniform float uShadowRange;
float vcWetAmt = 0.0, vcPuddle = 0.0, vcSnowAmt = 0.0;
float vcCaustic(vec2 p, float t) {
  vec2 q = p * 1.3;
  float c = sin(q.x * 1.7 + t * 1.1 + sin(q.y * 2.3 + t * 0.7)) + sin(q.y * 1.9 - t * 0.9 + sin(q.x * 2.1 - t * 1.3));
  c = c * 0.25 + 0.5;
  return pow(c, 6.0) * 2.5;
}
`;

const TERRAIN_MAT_GLSL = /* glsl */`
{
  // normal geométrica em espaço de mundo (pelas derivadas)
  vec3 fnW = normalize(cross(dFdx(vWorldP), dFdy(vWorldP)));
  if (dot(fnW, cameraPosition - vWorldP) < 0.0) fnW = -fnW;
  vcFN = fnW;
  #if VC_MAT >= 1
  float camDist = length(vWorldP - cameraPosition);
  // variação de cor em grande escala (quebra a repetição do atlas)
  float macro = vcN2(vWorldP.xz * 0.045) * 0.6 + vcN2(vWorldP.xz * 0.11 + 17.0) * 0.4;
  diffuseColor.rgb *= 0.93 + 0.14 * macro;
  // sujeira/umidade nos cantos (onde o AO por vértice é forte)
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.78, 0.72), (1.0 - vLight.x) * 0.35);
  #endif
  #if VC_MAT >= 2
  // detalhe de alta frequência de perto (textura parece ter mais resolução)
  if (camDist < 12.0) {
    vec3 ap = abs(fnW);
    vec2 dp = ap.y > 0.5 ? vWorldP.xz : ap.x > 0.5 ? vWorldP.zy : vWorldP.xy;
    float det = vcN2(dp * 32.0) * 0.6 + vcN2(dp * 64.0) * 0.4;
    diffuseColor.rgb *= 1.0 + (det - 0.5) * 0.12 * (1.0 - smoothstep(6.0, 12.0, camDist));
  }
  #endif
  #if VC_MAT >= 1
  float exposed = smoothstep(0.86, 0.97, vLight.y);
  // chuva: superfícies expostas escurecem e ficam brilhantes; poças em superfícies planas
  vcWetAmt = uWet * exposed * (0.45 + 0.55 * max(fnW.y, 0.0));
  float pud = fnW.y > 0.9 ? smoothstep(0.58, 0.72, vcN2(vWorldP.xz * 0.35) * 0.7 + vcN2(vWorldP.xz * 1.3) * 0.3) * smoothstep(0.5, 1.0, uWet) * exposed : 0.0;
  vcPuddle = pud;
  diffuseColor.rgb *= mix(1.0, 0.6, vcWetAmt) * mix(1.0, 0.75, pud);
  // neve acumulada no topo dos blocos expostos ao céu (perto do jogador, onde está nevando)
  float snowM = uSnowCover * smoothstep(0.65, 0.92, fnW.y) * exposed * (1.0 - smoothstep(70.0, 90.0, length(vWorldP.xz - uSnowCenter.xz)));
  snowM *= smoothstep(0.35, 0.6, vcN2(vWorldP.xz * 0.9) * 0.5 + 0.5 * uSnowCover + 0.15);
  vcSnowAmt = snowM;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.91, 0.96), snowM);
  #endif
}
`;

const TERRAIN_LIGHT_GLSL = /* glsl */`
{
  float vcFlags = floor(vLight.w * 255.0 + 0.5);
  float vcAO = vLight.x;
  float skyB = pow(0.78, 15.0 * (1.0 - vLight.y));
  // luz de blocos: o flood fill dá a distância (em blocos) até a fonte; queda ~1/d² suavizada
  float vcLvl = vLight.z * 15.0, vcD = 15.0 - vcLvl;
  float blkB = smoothstep(0.0, 1.5, vcLvl) / (1.0 + 0.09 * vcD * vcD);
  // tremulação leve (chama) que varia por região
  blkB *= 1.0 + 0.05 * sin(uTime * 10.0 + vcHash3(floor(vWorldP * 0.25)) * 40.0) * smoothstep(0.0, 4.0, vcLvl);
  float sunVis = smoothstep(0.6, 0.95, vLight.y);
  // o sol já vem multiplicado pela visibilidade do céu (csmLightsChunk); aqui só o AO por vértice
  reflectedLight.directDiffuse *= mix(1.0, vcAO, 0.45);
  reflectedLight.directSpecular *= vcAO;
  reflectedLight.indirectDiffuse *= max(skyB, uMinLight) * vcAO;
  reflectedLight.indirectSpecular *= skyB * vcAO;
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uTorchColor * blkB * mix(1.0, vcAO, 0.6);
  if (mod(floor(vcFlags / 4.0), 2.0) >= 1.0) totalEmissiveRadiance += diffuseColor.rgb * uLampGlow;
  // folhas e plantas contra o sol: luz atravessando (translucidez falsa)
  if (mod(vcFlags, 4.0) >= 1.0) {
    float back = pow(max(dot(normalize(vWorldP - cameraPosition), uLightDir), 0.0), 4.0);
    reflectedLight.directDiffuse += diffuseColor.rgb * uLightCol * back * 0.55 * vcSunShadow * sunVis;
  }
  // relâmpago: clarão azulado em tudo que vê o céu
  reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.75, 0.82, 1.0) * uFlash * skyB * 2.0;
  if (uCaustics > 0.0 && mod(floor(vcFlags / 8.0), 2.0) >= 1.0) {
    reflectedLight.directDiffuse += diffuseColor.rgb * uLightCol * max(uLightDir.y, 0.0) * vcCaustic(vWorldP.xz, uTime) * 0.35 * sunVis * uCaustics;
  }
}
`;

const SHADOW_CALL = 'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )';

// Substitui o laço de luzes direcionais do three.js por sombras em cascata (CSM): a luz 0 é o sol;
// as luzes 1 e 2 (intensidade zero) só existem para ter mais mapas de sombra. Para cada fragmento usa a
// cascata mais detalhada que o contém, misturando com a próxima perto da borda (sem "degrau" visível).
// dirMul: multiplicador da luz direta (no terreno, a visibilidade do céu: dentro de cavernas o sol não entra).
export function csmLightsChunk(dirMul, extra = '') {
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const a = src.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  const end = src.indexOf('#pragma unroll_loop_end', a);
  const b = src.indexOf('#endif', end) + '#endif'.length;
  const block = src.slice(a, b);
  const call = (block.match(/RE_Direct\([^;]*\);/) || ['RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );'])[0];
  const csm = `#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
{
  float vcSh = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  {
    DirectionalLightShadow directionalLightShadow;
    bool vcFound = false; float vcPend = -1.0; float vcPW = 0.0;
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
      if ( !vcFound ) {
        vec3 vcP = vDirectionalShadowCoord[ i ].xyz / vDirectionalShadowCoord[ i ].w;
        float vcEdge = min( min( vcP.x, 1.0 - vcP.x ), min( vcP.y, 1.0 - vcP.y ) );
        if ( vcEdge > 0.0 && vcP.z < 1.0 ) {
          directionalLightShadow = directionalLightShadows[ i ];
          float vcS = ${SHADOW_CALL};
          if ( vcPend >= 0.0 ) { vcSh = mix( vcS, vcPend, vcPW ); vcFound = true; }
          else if ( vcEdge > 0.08 ) { vcSh = vcS; vcFound = true; }
          else { vcPend = vcS; vcPW = vcEdge / 0.08; }
        }
      }
    }
    #pragma unroll_loop_end
    if ( !vcFound && vcPend >= 0.0 ) vcSh = mix( 1.0, vcPend, vcPW );
  }
  #endif
  ${extra}
  DirectionalLight directionalLight = directionalLights[ 0 ];
  getDirectionalLightInfo( directionalLight, directLight );
  directLight.color *= ( receiveShadow ? vcSh : 1.0 ) * ( ${dirMul} );
  ${call}
}
#endif`;
  return src.slice(0, a) + csm + src.slice(b);
}

const ROUGH_GLSL = /* glsl */`
#if VC_MAT >= 1 && defined( STANDARD )
roughnessFactor = mix(roughnessFactor, 0.22, vcWetAmt);
roughnessFactor = mix(roughnessFactor, 0.04, vcPuddle);
roughnessFactor = mix(roughnessFactor, 0.75, vcSnowAmt);
#endif
`;
const POM_GLSL = /* glsl */`
#if VC_MAT >= 3
  vec2 vcUv = vMapUv;
  {
    vec3 dp1 = dFdx(vWorldP), dp2 = dFdy(vWorldP);
    vec2 duv1 = dFdx(vMapUv), duv2 = dFdy(vMapUv);
    float pomAmt = (1.0 - smoothstep(5.0, 12.0, length(vWorldP - cameraPosition))) * uPomScale;
    if (pomAmt > 0.0) {
      vec3 N = normalize(cross(dp1, dp2));
      vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
      vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
      vec3 Bt = dp2perp * duv1.y + dp1perp * duv2.y;
      float im = inversesqrt(max(max(dot(T, T), dot(Bt, Bt)), 1e-12));
      vec3 V = normalize(cameraPosition - vWorldP);
      vec3 Vt = vec3(dot(V, T * im), dot(V, Bt * im), abs(dot(V, N)));
      // relevo: altura aproximada pela luminância (fendas escuras ficam "mais fundas"), 2 passos
      float h = dot(texture2D(map, vMapUv).rgb, vec3(0.3, 0.59, 0.11));
      vec2 off = Vt.xy / max(Vt.z, 0.35) * pomAmt;
      vcUv = vMapUv + off * (h - 0.5);
      h = dot(texture2D(map, vcUv).rgb, vec3(0.3, 0.59, 0.11));
      vcUv = vMapUv + off * (h - 0.5);
    }
  }
#else
  vec2 vcUv = vMapUv;
#endif
`;

let _terrainLights = null;
const TERRAIN_LIGHTS_BEGIN = () => _terrainLights || (_terrainLights = csmLightsChunk('smoothstep(0.6, 0.95, vLight.y)', `
  #if VC_MAT >= 2
  vcSh *= vcCloudShadow(vWorldP);
  #endif
  vcSunShadow = vcSh;`));
let _entityLights = null;
const ENTITY_LIGHTS_BEGIN = () => _entityLights || (_entityLights = csmLightsChunk('1.0'));

export function patchTerrainMaterial(mat) {
  mat.fog = false;
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(U)) shader.uniforms[k] = U[k];
    shader.vertexShader = TERRAIN_VERT_PARS + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = aLight;\n' + WIND_GLSL)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    // usa a UV com relevo (parallax) em todas as texturas do bloco
    let fs = shader.fragmentShader;
    const mi = fs.indexOf('void main() {') + 'void main() {'.length;
    let body = fs.slice(mi)
      .replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment + TERRAIN_MAT_GLSL)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps)
      .replace('#include <roughnessmap_fragment>', THREE.ShaderChunk.roughnessmap_fragment + ROUGH_GLSL)
      .replace('#include <aomap_fragment>', THREE.ShaderChunk.aomap_fragment);
    body = body.replace(/vMapUv|vNormalMapUv|vRoughnessMapUv|vAoMapUv/g, 'vcUv');
    fs = fs.slice(0, mi) + '\n' + POM_GLSL + body;
    shader.fragmentShader = '#define VC_MAT ' + (mat.userData.vcMat | 0) + '\n' + TERRAIN_FRAG_PARS + fs
      .replace('#include <lights_fragment_begin>', TERRAIN_LIGHTS_BEGIN())
      .replace(THREE.ShaderChunk.aomap_fragment.replace(/vAoMapUv/g, 'vcUv'), THREE.ShaderChunk.aomap_fragment.replace(/vAoMapUv/g, 'vcUv') + '\n' + TERRAIN_LIGHT_GLSL)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb = vcFog(gl_FragColor.rgb, vWorldP);');
  };
  mat.customProgramCacheKey = () => 'vc-terrain-' + (mat.userData.vcMat | 0);
  return mat;
}

// Material de profundidade para sombras com vento (folhas e plantas balançam também na sombra).
export function makeDepthMaterial(map) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uWind = U.uWind;
    shader.uniforms.uPlayerPos = U.uPlayerPos;
    shader.vertexShader = 'attribute vec4 aLight;\nuniform float uTime;\nuniform float uWind;\nuniform vec3 uPlayerPos;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_GLSL);
  };
  m.customProgramCacheKey = () => 'vc-depth';
  return m;
}

// Entidades (criaturas, jogador, itens): neblina atmosférica igual à do terreno.
export function patchEntityMaterial(mat) {
  mat.fog = false;
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(U)) shader.uniforms[k] = U[k];
    shader.vertexShader = 'varying vec3 vWorldP;\n' + shader.vertexShader
      .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 wp4 = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n wp4 = instanceMatrix * wp4;\n#endif\n vWorldP = (modelMatrix * wp4).xyz; }');
    shader.fragmentShader = SKY_GLSL + FOG_GLSL + 'varying vec3 vWorldP;\n' + shader.fragmentShader
      .replace('#include <lights_fragment_begin>', ENTITY_LIGHTS_BEGIN())
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb = vcFog(gl_FragColor.rgb, vWorldP);');
  };
  mat.customProgramCacheKey = () => 'vc-entity';
  return mat;
}
