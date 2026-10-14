// Jogador local: movimento, física, sobrevivência (vida, fome, ar, queda, dano ambiental) e inventário.
import { G, hook } from './state.js';
import { B, BLOCKS, SOLID, isClimbable } from './blocks.js';
import { moveAxis, collides, liquidAt } from './physics.js';
import { Inventory } from './crafting.js';
import { ITEMS } from './items.js';

export const EYE = 1.62;

export class Player {
  constructor() {
    this.pos = { x: 0.5, y: 80, z: 0.5 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.hw = 0.3; this.hh = 1.8;
    this.yaw = 0; this.pitch = 0;
    this.onGround = false; this.fly = false; this.inWater = false; this.inLava = false; this.headInWater = false; this.headInLava = false;
    this.health = 20; this.hunger = 20; this.sat = 5; this.exhaustion = 0; this.air = 10;
    this.inv = new Inventory(36);
    this.armorInv = new Inventory(4);
    this.selected = 0;
    this.spawn = null;
    this.dead = false;
    this.hurtTime = 0; this.invuln = 0; this.regenT = 0; this.starveT = 0; this.envDmgT = 0;
    this.fallStartY = null;
    this.riding = null; this.sitting = null;
    this.camMode = 0; // 0 = 1ª pessoa, 1 = 3ª pessoa (atrás), 2 = 3ª pessoa (frente)
    this.walkDist = 0; this.swing = 0;
    this.name = 'Jogador';
    this.stats = { blocksBroken: 0, blocksPlaced: 0, crafted: 0, mobsKilled: 0, nightsSurvived: 0, distance: 0, deaths: 0 };
  }
  get creative() { return G.mode === 'creative'; }
  get survivalLike() { return G.mode !== 'creative'; }
  held() { return this.inv.get(this.selected); }
  heldItem() { const s = this.held(); return s ? ITEMS[s.k] : null; }
  eyePos() { return { x: this.pos.x, y: this.pos.y + EYE - (this.sneak ? 0.25 : 0), z: this.pos.z }; }
  armorPoints() {
    let a = 0;
    for (let i = 0; i < 4; i++) { const s = this.armorInv.get(i); if (s && ITEMS[s.k] && ITEMS[s.k].armor) a += ITEMS[s.k].armor.def; }
    return a;
  }
  // dano; source: 'fall' | 'lava' | 'drown' | 'starve' | 'cactus' | 'mob' | 'arrow' | 'void' | 'fire'
  damage(n, source, attacker) {
    if (this.dead || this.creative) return false;
    if (this.invuln > 0 && source !== 'void') return false;
    let dmg = n;
    if (['mob', 'arrow', 'explosion'].includes(source)) {
      const a = this.armorPoints();
      dmg = n * (1 - Math.min(20, a) * 0.04);
      // desgaste da armadura
      for (let i = 0; i < 4; i++) {
        const s = this.armorInv.get(i);
        if (s && ITEMS[s.k] && ITEMS[s.k].armor) { s.d = (s.d || 0) + 1; if (s.d >= ITEMS[s.k].armor.dur) { this.armorInv.set(i, null); hook('toast', 'Sua armadura quebrou!'); } }
      }
      this.armorInv.changed = true;
    }
    this.health = Math.max(0, this.health - dmg);
    this.invuln = 0.5;
    this.hurtTime = 0.4;
    this.exhaustion += 0.1;
    if (attacker && attacker.pos) {
      const dx = this.pos.x - attacker.pos.x, dz = this.pos.z - attacker.pos.z, d = Math.hypot(dx, dz) || 1;
      this.vel.x += dx / d * 5; this.vel.z += dz / d * 5; this.vel.y = Math.max(this.vel.y, 4);
    }
    hook('playerHurt', dmg, source);
    if (this.health <= 0) this.die(source);
    return true;
  }
  heal(n) { this.health = Math.min(20, this.health + n); }
  eat(item) {
    if (!item || !item.food) return false;
    if (this.hunger >= 20 && !this.creative) return false;
    this.hunger = Math.min(20, this.hunger + item.food.hunger);
    this.sat = Math.min(this.hunger, this.sat + item.food.sat);
    if (item.food && ITEMS[item.key] && ITEMS[item.key].poison && Math.random() < ITEMS[item.key].poison) { this.hunger = Math.max(0, this.hunger - 3); hook('toast', 'Você passou mal com a carne podre.'); }
    return true;
  }
  die(source) {
    if (this.dead) return;
    this.dead = true;
    this.stats.deaths++;
    hook('playerDied', source);
  }
  respawn() {
    this.dead = false;
    this.health = 20; this.hunger = 20; this.sat = 5; this.air = 10; this.exhaustion = 0;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.fallStartY = null;
    this.riding = null; this.sitting = null;
    const s = this.spawn || G.world.spawn;
    this.pos.x = s.x + 0.5; this.pos.y = s.y; this.pos.z = s.z + 0.5;
    // garante espaço livre
    for (let i = 0; i < 64 && collides(this.pos.x - this.hw, this.pos.y, this.pos.z - this.hw, this.pos.x + this.hw, this.pos.y + this.hh, this.pos.z + this.hw); i++) this.pos.y += 1;
    this.invuln = 2;
  }
  addExhaustion(v) { if (G.mode === 'survival' || G.mode === 'challenge') this.exhaustion += v; }

  // ---------------- física ----------------
  update(dt, input) {
    if (this.dead) return;
    const w = G.world, p = this.pos, v = this.vel;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtTime = Math.max(0, this.hurtTime - dt);
    this.swing = Math.max(0, this.swing - dt * 4);
    if (this.riding) { this.riding.controlBy(this, dt, input); this.updateSurvival(dt); return; }
    if (this.sitting) {
      if (input.jump || input.sneak || Math.hypot(input.mx, input.mz) > 0.5) this.sitting = null;
      else { v.x = v.y = v.z = 0; this.updateSurvival(dt); return; }
    }
    let jx = input.mx, jy = input.mz;
    const raw = Math.hypot(jx, jy), mag = Math.min(1, raw);
    if (raw > 0) { jx = jx / raw * mag; jy = jy / raw * mag; }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = -sy * jy + cy * jx, wz = -cy * jy - sy * jx;
    const fx = Math.floor(p.x), fz = Math.floor(p.z);
    const below = w.getBlock(fx, Math.floor(p.y - 0.05), fz);
    const feet = w.getBlock(fx, Math.floor(p.y + 0.1), fz);
    const liq = liquidAt(p.x, p.y + 0.4, p.z);
    this.inWater = liq === B.WATER; this.inLava = liq === B.LAVA;
    const head = liquidAt(p.x, p.y + EYE, p.z);
    this.headInWater = head === B.WATER; this.headInLava = head === B.LAVA;
    const climbing = isClimbable(feet) || isClimbable(w.getBlock(fx, Math.floor(p.y + 1.2), fz));
    this.sneak = !!input.sneak && !this.fly;
    const sprint = !!input.sprint && mag > 0.6 && this.hunger > 6 && !this.sneak;
    this.sprinting = sprint;
    if (this.fly) {
      const sp = sprint ? 20 : 11;
      v.x = wx * sp; v.z = wz * sp;
      v.y = ((input.jump ? 1 : 0) - (input.sneak ? 1 : 0)) * sp;
    } else {
      let sp = (this.inWater || this.inLava) ? 2.6 : sprint ? 5.8 : this.sneak ? 1.6 : 4.3;
      if (BLOCKS[below] && BLOCKS[below].slow) sp *= 0.55;
      const slippery = BLOCKS[below] && BLOCKS[below].slippery;
      const acc = this.onGround ? (slippery ? 2.5 : 18) : (this.inWater || this.inLava) ? 6 : 5;
      v.x += (wx * sp - v.x) * Math.min(1, acc * dt);
      v.z += (wz * sp - v.z) * Math.min(1, acc * dt);
      if (this.inWater || this.inLava) {
        v.y -= 9 * dt; if (v.y < -3) v.y = -3;
        if (input.jump) v.y = Math.min(v.y + 30 * dt, 3.6);
      } else if (climbing) {
        v.y = input.jump || (mag > 0.1 && this.hitWall) ? 2.8 : input.sneak ? 0 : Math.max(v.y - 28 * dt, -2.5);
      } else {
        v.y -= 28 * dt; if (v.y < -50) v.y = -50;
        if (input.jump && this.onGround) { v.y = 8.6; this.addExhaustion(sprint ? 0.2 : 0.05); }
      }
    }
    // elevador: pular sobre o bloco leva ao próximo elevador acima; agachar, ao de baixo
    if (below === B.ELEVATOR && this.onGround && !this.fly && (input.jumpPressed || input.sneakPressed)) {
      const dir = input.jumpPressed ? 1 : -1;
      const by = Math.floor(p.y - 0.05);
      for (let y = by + dir * 2; Math.abs(y - by) <= 32 && y > 0 && y < 127; y += dir) {
        if (w.getBlock(fx, y, fz) === B.ELEVATOR && !SOLID[w.getBlock(fx, y + 1, fz)] && !SOLID[w.getBlock(fx, y + 2, fz)]) {
          p.y = y + 1; v.y = 0; this.fallStartY = null; hook('sound', 'elevator'); break;
        }
      }
    }
    const wasGround = this.onGround;
    const hitX = moveAxis(this, 'x', v.x * dt);
    // agachado não cai da borda
    if (this.sneak && wasGround && !collides(p.x - this.hw, p.y - 0.6, p.z - this.hw, p.x + this.hw, p.y, p.z + this.hw)) { p.x -= v.x * dt; v.x = 0; }
    const hitZ = moveAxis(this, 'z', v.z * dt);
    if (this.sneak && wasGround && !collides(p.x - this.hw, p.y - 0.6, p.z - this.hw, p.x + this.hw, p.y, p.z + this.hw)) { p.z -= v.z * dt; v.z = 0; }
    if (hitX) v.x = 0;
    if (hitZ) v.z = 0;
    this.hitWall = hitX || hitZ;
    this.onGround = false;
    const vy = v.y;
    if (moveAxis(this, 'y', v.y * dt)) { if (v.y < 0) this.onGround = true; v.y = 0; }
    // subida automática de degraus (1 bloco andando, meio bloco sempre)
    if (this.hitWall && wasGround && !this.fly && mag > 0.1) {
      const step = collides(p.x - this.hw - 0.05, p.y, p.z - this.hw - 0.05, p.x + this.hw + 0.05, p.y + 0.55, p.z + this.hw + 0.05);
      if (step && step[4] - p.y <= 0.55 && !collides(p.x - this.hw, step[4] + 0.01, p.z - this.hw, p.x + this.hw, step[4] + 0.01 + this.hh, p.z + this.hw)) p.y = step[4] + 0.01;
      else if (!collides(p.x - this.hw, p.y + 1.01, p.z - this.hw, p.x + this.hw, p.y + 1.01 + this.hh, p.z + this.hw)) v.y = 8.6;
    }
    // queda
    if (this.fly || this.inWater || climbing || this.inLava) this.fallStartY = null;
    else if (!this.onGround) { if (this.fallStartY === null || p.y > this.fallStartY) this.fallStartY = p.y; }
    else if (this.fallStartY !== null) {
      const dist = this.fallStartY - p.y;
      this.fallStartY = null;
      if (dist > 3.4 && !(below === B.WATER) && below !== B.LEAVES && !(BLOCKS[below] && BLOCKS[below].shape === 'bed')) {
        this.damage(Math.floor(dist - 3), 'fall');
        hook('sound', 'land');
      }
    }
    if (p.y < -30) { this.damage(1000, 'void'); }
    // passos
    const moved = Math.hypot(v.x, v.z) * dt;
    if (this.onGround && moved > 0) {
      this.walkDist += moved;
      this.stats.distance += moved;
      if (sprint) this.addExhaustion(moved * 0.1);
      if (Math.floor(this.walkDist / 2.2) !== Math.floor((this.walkDist - moved) / 2.2)) hook('footstep', below);
    }
    if (this.inWater && Math.random() < dt * 0.6) hook('bubble');
    this.updateSurvival(dt);
    if (vy < -12 && this.inWater && wasGround === false) hook('splash', p);
  }

  updateSurvival(dt) {
    if (this.dead) return;
    const w = G.world, p = this.pos;
    // ar / afogamento
    if (this.headInWater && !this.creative) {
      this.air -= dt;
      if (this.air < 0) { this.air = 0; this.envDmgT -= dt; if (this.envDmgT <= 0) { this.envDmgT = 1; this.damage(2, 'drown'); } }
    } else this.air = Math.min(10, this.air + dt * 4);
    // lava e cacto
    if (this.inLava || this.headInLava) { this.envDmgT -= dt; if (this.envDmgT <= 0) { this.envDmgT = 0.5; this.damage(4, 'lava'); } }
    // fogo: queima enquanto estiver dentro (e mais um pouco depois de sair)
    const wf = G.world;
    if (wf.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z)) === B.FIRE || wf.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 1), Math.floor(this.pos.z)) === B.FIRE) this.burnT = 3;
    if (this.burnT > 0) {
      this.burnT -= dt; if (this.inWater) this.burnT = 0;
      this.fireDmgT = (this.fireDmgT || 0) - dt;
      if (this.fireDmgT <= 0 && this.burnT > 0) { this.fireDmgT = 1; this.damage(1, 'fire'); }
    }
    else {
      const hw = this.hw + 0.02;
      let cactus = false;
      for (const [dx, dz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) if (w.getBlock(Math.floor(p.x + dx), Math.floor(p.y + 0.5), Math.floor(p.z + dz)) === B.CACTUS) cactus = true;
      if (cactus) { this.envDmgT -= dt; if (this.envDmgT <= 0) { this.envDmgT = 0.5; this.damage(1, 'cactus'); } }
    }
    if (G.mode === 'creative') return;
    // fome
    const peaceful = G.mode === 'peaceful';
    if (!peaceful) {
      this.exhaustion += dt * 0.005;
      if (this.exhaustion >= 4) { this.exhaustion -= 4; if (this.sat > 0) this.sat = Math.max(0, this.sat - 1); else this.hunger = Math.max(0, this.hunger - 1); }
    }
    // regeneração
    this.regenT += dt;
    if (peaceful) { if (this.regenT > 2) { this.regenT = 0; if (this.health < 20) this.heal(1); } if (this.hunger < 20 && Math.random() < dt * 0.2) this.hunger++; }
    else if (this.hunger >= 18 && this.health < 20) { if (this.regenT > 3) { this.regenT = 0; this.heal(1); this.exhaustion += 3; } }
    else if (this.hunger <= 0) { this.starveT += dt; if (this.starveT > 4) { this.starveT = 0; if (this.health > 1) this.damage(1, 'starve'); } }
    else this.regenT = Math.min(this.regenT, 3);
  }

  toJSON() {
    return {
      x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, pitch: this.pitch, fly: this.fly,
      health: this.health, hunger: this.hunger, sat: this.sat, air: this.air,
      inv: this.inv.toJSON(), armor: this.armorInv.toJSON(), sel: this.selected, spawn: this.spawn, stats: this.stats, camMode: this.camMode,
    };
  }
  load(s) {
    if (!s) return;
    this.pos.x = s.x; this.pos.y = s.y; this.pos.z = s.z;
    this.yaw = s.yaw || 0; this.pitch = s.pitch || 0; this.fly = !!s.fly;
    if (s.health != null) this.health = s.health;
    if (s.hunger != null) this.hunger = s.hunger;
    if (s.sat != null) this.sat = s.sat;
    if (s.air != null) this.air = s.air;
    if (s.inv) this.inv = Inventory.from(s.inv, 36);
    if (s.armor) this.armorInv = Inventory.from(s.armor, 4);
    this.selected = Math.min(8, s.sel || 0);
    this.spawn = s.spawn || null;
    if (s.stats) Object.assign(this.stats, s.stats);
    this.camMode = s.camMode || 0;
  }
}
