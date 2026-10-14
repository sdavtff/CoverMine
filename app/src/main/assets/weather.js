// Clima dinâmico: céu limpo, chuva, tempestade (raios e trovões) e neve nos biomas frios.
import * as THREE from './lib/three.module.min.js';
import { G, hook } from './state.js';
import { LOPQ, SOLID } from './blocks.js';
import { BIOME } from './worldgen.js';
import { U } from './shaders.js';
import * as PT from './particles.js';
import { playSound, setRain } from './audio.js';

export const W = { state: 'clear', rain: 0, storm: 0, flash: 0, timer: 300, boltT: 6, snow: false, cover: 0 };
const N = 2400, R_ = 22, HGT = 28;
let mesh = null, hmTex = null, hmData = null, hmT = 0;

export function initWeather(scene) {
  // gotas: quads finos instanciados animados no shader
  const base = new THREE.PlaneGeometry(0.03, 0.7);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
  const off = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { off[i * 4] = (Math.random() - 0.5) * 2 * R_; off[i * 4 + 1] = Math.random() * HGT; off[i * 4 + 2] = (Math.random() - 0.5) * 2 * R_; off[i * 4 + 3] = Math.random(); }
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  g.instanceCount = N;
  hmData = new Uint8Array(64 * 64 * 4);
  hmTex = new THREE.DataTexture(hmData, 64, 64, THREE.RGBAFormat, THREE.UnsignedByteType);
  hmTex.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uCam: { value: new THREE.Vector3() }, uSnow: { value: 0 }, uAmount: { value: 0 }, uHM: { value: hmTex }, uHMOrigin: { value: new THREE.Vector2() }, uLight: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec4 aOff;
      uniform float uTime; uniform vec3 uCam; uniform float uSnow; uniform float uAmount;
      uniform sampler2D uHM; uniform vec2 uHMOrigin;
      varying float vA; varying vec2 vUv;
      void main() {
        vUv = uv;
        float speed = mix(18.0, 2.2, uSnow);
        vec3 base = vec3(floor(uCam.x), uCam.y - 6.0, floor(uCam.z));
        float y = mod(aOff.y - uTime * speed * (0.85 + aOff.w * 0.3), ${HGT.toFixed(1)});
        vec3 p = base + vec3(aOff.x, y, aOff.z);
        p.x += uSnow * sin(uTime * 0.8 + aOff.w * 30.0) * 0.6;
        p.z += uSnow * cos(uTime * 0.6 + aOff.w * 20.0) * 0.6;
        // bloqueio por telhados: altura do bloco mais alto na coluna
        vec2 huv = (floor(p.xz) - uHMOrigin + 0.5) / 64.0;
        float top = texture2D(uHM, huv).r * 255.0;
        float visible = step(aOff.w, uAmount) * step(top, p.y) * (1.0 - step(1.0, max(abs(huv.x - 0.5), abs(huv.y - 0.5)) * 2.0));
        vA = visible;
        // billboard cilíndrico
        vec3 toCam = normalize(vec3(uCam.x - p.x, 0.0, uCam.z - p.z));
        vec3 right = vec3(toCam.z, 0.0, -toCam.x);
        float sx = mix(1.0, 3.0, uSnow), sy = mix(1.0, 0.09, uSnow);
        vec3 wp = p + right * position.x * sx + vec3(0.0, position.y * sy, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp * visible + uCam * (1.0 - visible), 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uSnow; uniform float uLight;
      varying float vA; varying vec2 vUv;
      void main() {
        if (vA < 0.5) discard;
        float a = mix(0.35, 0.9, uSnow);
        if (uSnow > 0.5) { vec2 d = vUv - 0.5; a *= smoothstep(0.5, 0.2, length(d)); }
        vec3 c = mix(vec3(0.62, 0.68, 0.78), vec3(1.0), uSnow) * uLight;
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;
  scene.add(mesh);
  // raio
  W.boltMat = new THREE.LineBasicMaterial({ color: 0xeef4ff, transparent: true, opacity: 1, toneMapped: false });
  W.bolt = new THREE.Line(new THREE.BufferGeometry(), W.boltMat);
  W.bolt.visible = false; W.bolt.frustumCulled = false;
  scene.add(W.bolt);
}
export function weatherMesh() { return mesh; }

function updateHeightmap() {
  const w = G.world, p = G.player.pos;
  const ox = Math.floor(p.x) - 32, oz = Math.floor(p.z) - 32;
  for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) {
    let top = 0;
    const cx = ox + x, cz = oz + z;
    for (let y = Math.min(127, Math.floor(p.y) + 30); y > 0; y--) { const id = w.peekBlock(cx, y, cz); if (id === null) break; if (id && (SOLID[id] || LOPQ[id] || id === 7)) { top = y + 1; break; } }
    hmData[(x + z * 64) * 4] = top;
  }
  hmTex.needsUpdate = true;
  mesh.material.uniforms.uHMOrigin.value.set(ox, oz);
}

export function setWeather(state, duration) { W.state = state; W.timer = duration ?? 120 + Math.random() * 240; }
export function updateWeather(dt) {
  const pl = G.player;
  W.timer -= dt;
  if (W.timer <= 0 && (!G.net || G.net.host)) {
    const r = Math.random();
    if (W.state === 'clear') setWeather(r < 0.55 ? 'rain' : r < 0.75 ? 'storm' : 'clear', 90 + Math.random() * 180);
    else setWeather('clear', 240 + Math.random() * 400);
    hook('weatherChanged', W.state);
  }
  const biome = G.world.biomeAt(Math.floor(pl.pos.x), Math.floor(pl.pos.z));
  const dry = biome === BIOME.DESERT || biome === BIOME.SAVANNA;
  const cold = biome === BIOME.SNOWY || biome === BIOME.SNOWY_MOUNTAIN || pl.pos.y > G.world.sea + 60;
  const wantRain = W.state === 'clear' ? 0 : W.state === 'storm' ? 1 : 0.65;
  const wantStorm = W.state === 'storm' ? 1 : 0;
  W.rain += (wantRain - W.rain) * Math.min(1, dt * 0.25);
  W.storm += (wantStorm - W.storm) * Math.min(1, dt * 0.2);
  W.snow = cold;
  const local = dry ? 0 : W.rain;
  W.local = local;
  W.flash = Math.max(0, W.flash - dt * 3);
  // raios
  if (W.storm > 0.6 && !dry) {
    W.boltT -= dt;
    if (W.boltT <= 0) { W.boltT = 6 + Math.random() * 14; lightning(); }
  }
  if (W.bolt.visible) { W.boltLife -= dt; W.boltMat.opacity = Math.max(0, W.boltLife * 5); if (W.boltLife <= 0) W.bolt.visible = false; }
  // gotas
  const amount = G.eff && G.settings.particles !== undefined ? local * (0.3 + 0.7 * G.settings.particles) : local;
  mesh.visible = amount > 0.02;
  if (mesh.visible) {
    hmT -= dt;
    if (hmT <= 0) { hmT = 0.4; updateHeightmap(); }
    const u = mesh.material.uniforms;
    u.uCam.value.copy(G.camera.position);
    u.uSnow.value = cold ? 1 : 0;
    u.uAmount.value = amount;
    u.uLight.value = 0.35 + 0.65 * (1 - U.uNight.value) + W.flash;
    // respingos no chão perto do jogador
    if (!cold && Math.random() < amount * dt * 30 * (G.settings.particles ?? 1)) {
      const x = pl.pos.x + (Math.random() - 0.5) * 16, z = pl.pos.z + (Math.random() - 0.5) * 16;
      const hx = Math.floor(x - u.uHMOrigin.value.x), hz = Math.floor(z - u.uHMOrigin.value.y);
      if (hx >= 0 && hz >= 0 && hx < 64 && hz < 64) { const top = hmData[(hx + hz * 64) * 4]; if (top) PT.rainSplash(x, top, z); }
    }
  }
  // som de chuva (abafado sob telhado)
  const roof = hmData[(32 + 32 * 64) * 4] > pl.pos.y + 2;
  setRain(cold ? 0 : local * (roof ? 0.35 : 1));
  return { rain: local, storm: dry ? 0 : W.storm, flash: W.flash };
}

function lightning() {
  const p = G.player.pos;
  const a = Math.random() * Math.PI * 2, d = 25 + Math.random() * 70;
  const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
  const ground = Math.max(G.world.surfaceY(Math.floor(x), Math.floor(z)), G.world.sea) + 1;
  const pts = [];
  let cx = x, cz = z;
  for (let y = ground + 90; y > ground; y -= 6) { pts.push(new THREE.Vector3(cx, y, cz)); cx += (Math.random() - 0.5) * 4; cz += (Math.random() - 0.5) * 4; }
  pts.push(new THREE.Vector3(x, ground, z));
  W.bolt.geometry.dispose();
  W.bolt.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  W.bolt.visible = true; W.boltLife = 0.25;
  W.flash = 1;
  setTimeout(() => playSound('thunder', Math.max(0.3, 1 - d / 120)), d / 343 * 1000);
  hook('lightning', x, ground, z);
}
export function weatherJSON() { return { state: W.state, timer: W.timer }; }
export function loadWeather(s) { if (s && s.state) { W.state = s.state; W.timer = s.timer || 120; W.rain = s.state === 'clear' ? 0 : 0.6; W.storm = s.state === 'storm' ? 1 : 0; } else { W.state = 'clear'; W.timer = 200; W.rain = W.storm = 0; } }
