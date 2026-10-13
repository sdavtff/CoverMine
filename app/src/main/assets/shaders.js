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
    float crater = 0.8 + 0.2 * vcHash3(floor(d * 900.0));
    col += vec3(0.75, 0.82, 1.0) * moon * crater * (0.15 + 1.1 * uNight) * above;
    col += vec3(0.06, 0.08, 0.14) * pow(md, 300.0) * uNight;
    if (uNight > 0.01 && y > 0.0) {
      vec3 g = floor(d * 170.0);
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
vec3 vcFog(vec3 col, vec3 wp) {
  vec3 dv = wp - cameraPosition;
  float dist = length(dv);
  if (uUnderwater > 0.5) {
    float fu = 1.0 - exp(-dist * 0.12);
    return mix(col, uUnderColor, clamp(fu, 0.0, 1.0));
  }
  vec3 dir = dv / max(dist, 1e-4);
  float x = max(dist - uFogStart, 0.0) * uFogDensity;
  float f = 1.0 - exp(-x * x);
  // altura: neblina um pouco mais densa nas partes baixas do mundo
  f *= mix(1.0, 0.7, smoothstep(30.0, 60.0, wp.y));
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
      void main() {
        vLight = aLight;
        vN = normal;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float flags = floor(aLight.w * 255.0 + 0.5);
        #if WATER_Q >= 1
        if (flags >= 16.0) {
          vec2 p = wp.xz;
          wp.y += (sin(p.x * 0.8 + uTime * 1.3) * 0.5 + sin(p.y * 1.05 - uTime * 1.1) * 0.35 + sin((p.x + p.y) * 1.6 + uTime * 2.0) * 0.15) * 0.035;
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
      vec2 waveGrad(vec2 p, float t) {
        vec2 g = vec2(0.0);
        // ondas direcionais (derivadas analíticas)
        vec2 d1 = vec2(0.8, 0.0), d2 = vec2(0.0, 1.05), d3 = vec2(1.6, 1.6);
        g += d1 * cos(dot(p, d1) + t * 1.3) * 0.5 * 0.035;
        g += d2 * cos(dot(p, d2) - t * 1.1) * 0.35 * 0.035;
        g += d3 * cos(dot(p, d3) + t * 2.0) * 0.15 * 0.035;
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
        vec3 body = mix(uShallow, uDeep, depthF) * lightAmt;
        vec3 col;
        float alpha;
        if (below) {
          // visto de baixo: janela de Snell e reflexão interna
          float win = smoothstep(0.55, 0.8, NdV);
          col = mix(body * 1.4, refl * 0.9, win);
          alpha = mix(0.92, 0.55, win);
        } else {
          col = mix(body, refl, fres);
          alpha = mix(0.52, 0.9, depthF);
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
}
`;

const TERRAIN_FRAG_PARS = SKY_GLSL + FOG_GLSL + /* glsl */`
varying vec4 vLight;
varying vec3 vWorldP;
uniform float uMinLight;
uniform vec3 uTorchColor;
uniform float uLampGlow;
uniform float uCaustics;
uniform vec3 uLightCol;
uniform vec3 uLightDir;
uniform vec3 uShadowCenter;
uniform float uShadowRange;
float vcCaustic(vec2 p, float t) {
  vec2 q = p * 1.3;
  float c = sin(q.x * 1.7 + t * 1.1 + sin(q.y * 2.3 + t * 0.7)) + sin(q.y * 1.9 - t * 0.9 + sin(q.x * 2.1 - t * 1.3));
  c = c * 0.25 + 0.5;
  return pow(c, 6.0) * 2.5;
}
`;

const TERRAIN_LIGHT_GLSL = /* glsl */`
{
  float vcFlags = floor(vLight.w * 255.0 + 0.5);
  float vcAO = vLight.x;
  float skyB = pow(0.78, 15.0 * (1.0 - vLight.y));
  float blkB = pow(0.8, 15.0 * (1.0 - vLight.z)) * step(0.01, vLight.z);
  float sunVis = smoothstep(0.6, 0.95, vLight.y);
  reflectedLight.directDiffuse *= sunVis * mix(1.0, vcAO, 0.45);
  reflectedLight.directSpecular *= sunVis * vcAO;
  reflectedLight.indirectDiffuse *= max(skyB, uMinLight) * vcAO;
  reflectedLight.indirectSpecular *= skyB * vcAO;
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uTorchColor * blkB * mix(1.0, vcAO, 0.6);
  if (mod(floor(vcFlags / 4.0), 2.0) >= 1.0) totalEmissiveRadiance += diffuseColor.rgb * uLampGlow;
  if (uCaustics > 0.0 && mod(floor(vcFlags / 8.0), 2.0) >= 1.0) {
    reflectedLight.directDiffuse += diffuseColor.rgb * uLightCol * max(uLightDir.y, 0.0) * vcCaustic(vWorldP.xz, uTime) * 0.35 * sunVis * uCaustics;
  }
}
`;

const SHADOW_CALL = 'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )';

export function patchTerrainMaterial(mat) {
  mat.fog = false;
  mat.onBeforeCompile = (shader) => {
    for (const k of ['uTime', 'uWind', 'uSunDir', 'uZenith', 'uHorizon', 'uSunGlow', 'uSunDisc', 'uNight',
      'uFogStart', 'uFogEnd', 'uFogDensity', 'uUnderwater', 'uUnderColor', 'uMinLight', 'uTorchColor', 'uLampGlow',
      'uCaustics', 'uLightCol', 'uLightDir', 'uShadowCenter', 'uShadowRange']) shader.uniforms[k] = U[k];
    shader.vertexShader = TERRAIN_VERT_PARS + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = aLight;\n' + WIND_GLSL)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const lightsBegin = THREE.ShaderChunk.lights_fragment_begin.replace(SHADOW_CALL,
      `mix( ${SHADOW_CALL}, 1.0, vcShadowFade )`);
    shader.fragmentShader = TERRAIN_FRAG_PARS + shader.fragmentShader
      .replace('#include <lights_fragment_begin>',
        'float vcShadowFade = smoothstep(uShadowRange * 0.7, uShadowRange * 0.95, max(abs(vWorldP.x - uShadowCenter.x), abs(vWorldP.z - uShadowCenter.z)));\n' + lightsBegin)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + TERRAIN_LIGHT_GLSL)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb = vcFog(gl_FragColor.rgb, vWorldP);');
  };
  mat.customProgramCacheKey = () => 'vc-terrain';
  return mat;
}

// Material de profundidade para sombras com vento (folhas e plantas balançam também na sombra).
export function makeDepthMaterial(map) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uWind = U.uWind;
    shader.vertexShader = 'attribute vec4 aLight;\nuniform float uTime;\nuniform float uWind;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_GLSL);
  };
  m.customProgramCacheKey = () => 'vc-depth';
  return m;
}
