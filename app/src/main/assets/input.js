// Entrada: toque (joystick, olhar, toque/segurar, botões) e teclado/mouse. Gera um estado por quadro.
import { G, hook } from './state.js';

export const IN = { mx: 0, mz: 0, jump: false, sneak: false, sprint: false, jumpPressed: false, sneakPressed: false, keys: {}, jx: 0, jy: 0, touchJump: false, touchDown: false };
const $ = (id) => document.getElementById(id);

export function frameInput() {
  const k = IN.keys;
  let mx = IN.jx, mz = IN.jy;
  if (k.KeyW || k.ArrowUp) mz += 1;
  if (k.KeyS || k.ArrowDown) mz -= 1;
  if (k.KeyD || k.ArrowRight) mx += 1;
  if (k.KeyA || k.ArrowLeft) mx -= 1;
  const jump = !!(IN.touchJump || k.Space);
  const sneak = !!(IN.touchDown || k.ShiftLeft || k.ShiftRight);
  const out = {
    mx, mz, jump, sneak,
    sprint: (!G.isTouch && (k.ControlLeft || k.ControlRight || IN.sprintToggle)) || (G.isTouch && Math.hypot(IN.jx, IN.jy) > 0.97),
    jumpPressed: jump && !IN._jump, sneakPressed: sneak && !IN._sneak,
  };
  IN._jump = jump; IN._sneak = sneak;
  return out;
}

export function initInput(canvas, actions) {
  const joyBase = $('joy-base'), joyKnob = $('joy-knob');
  let joyId = null, joyX = 0, joyY = 0, lookId = null, lookLast = null, lookStart = null, holdTimer = 0, holding = false, lookMoved = false;
  const JOY_R = 60;
  const playing = () => G.playing && !G.paused;
  const stopHold = () => { clearTimeout(holdTimer); if (holding) actions.primaryUp(); holding = false; };
  IN.reset = () => { IN.jx = IN.jy = 0; IN.touchJump = IN.touchDown = false; joyId = lookId = null; joyBase.style.display = 'none'; stopHold(); for (const k in IN.keys) IN.keys[k] = false; };

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!playing()) return;
    for (const t of e.changedTouches) {
      if (joyId === null && t.clientX < window.innerWidth * 0.4) {
        joyId = t.identifier; joyX = t.clientX; joyY = t.clientY;
        joyBase.style.left = joyX + 'px'; joyBase.style.top = joyY + 'px'; joyBase.style.display = 'block';
        joyKnob.style.transform = '';
      } else if (lookId === null) {
        lookId = t.identifier; lookLast = [t.clientX, t.clientY]; lookStart = [t.clientX, t.clientY, performance.now()]; lookMoved = false;
        stopHold();
        holdTimer = setTimeout(() => { holding = true; actions.primaryDown(); }, 300);
      }
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        let dx = t.clientX - joyX, dy = t.clientY - joyY;
        const d = Math.hypot(dx, dy);
        if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
        joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        IN.jx = dx / JOY_R; IN.jy = -dy / JOY_R;
      } else if (t.identifier === lookId) {
        const dx = t.clientX - lookLast[0], dy = t.clientY - lookLast[1];
        lookLast = [t.clientX, t.clientY];
        if (!lookMoved && Math.hypot(t.clientX - lookStart[0], t.clientY - lookStart[1]) > 12) { lookMoved = true; if (!holding) clearTimeout(holdTimer); }
        const s = 0.0055 * G.settings.sens;
        actions.look(dx * s, dy * s * (G.settings.invertY ? -1 : 1));
      }
    }
  }, { passive: false });
  const touchEnd = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) { joyId = null; IN.jx = IN.jy = 0; joyBase.style.display = 'none'; }
      else if (t.identifier === lookId) {
        lookId = null;
        const quick = performance.now() - lookStart[2] < 300;
        if (!holding && !lookMoved && quick && playing()) actions.tap();
        stopHold();
      }
    }
  };
  canvas.addEventListener('touchend', touchEnd, { passive: false });
  canvas.addEventListener('touchcancel', touchEnd, { passive: false });

  // botões de toque
  const hold = (el, down, up) => {
    if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('active'); down(); }, { passive: false });
    const u = (e) => { e.preventDefault(); el.classList.remove('active'); up && up(); };
    el.addEventListener('touchend', u, { passive: false });
    el.addEventListener('touchcancel', u, { passive: false });
    el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); down(); });
    el.addEventListener('mouseup', (e) => { e.preventDefault(); up && up(); });
  };
  hold($('btn-jump'), () => IN.touchJump = true, () => IN.touchJump = false);
  hold($('btn-down'), () => IN.touchDown = true, () => IN.touchDown = false);
  hold($('btn-fly'), () => actions.toggleFly());
  hold($('btn-menu'), () => actions.menu());
  hold($('btn-inv'), () => actions.inventory());
  hold($('btn-cam'), () => actions.camera());
  hold($('btn-map'), () => actions.map());
  hold($('btn-chat'), () => actions.chat());
  hold($('btn-sprint'), () => { IN.sprintToggle = !IN.sprintToggle; $('btn-sprint').classList.toggle('on', IN.sprintToggle); });

  // mouse (PC)
  canvas.addEventListener('mousedown', (e) => {
    if (G.isTouch || !playing()) return;
    if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
    if (e.button === 0) actions.primaryDown();
    else if (e.button === 2) actions.tap(true);
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0 && !G.isTouch) actions.primaryUp(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas || !playing()) return;
    const s = 0.0024 * G.settings.sens;
    actions.look(e.movementX * s, e.movementY * s * (G.settings.invertY ? -1 : 1));
  });
  document.addEventListener('pointerlockchange', () => {
    if (!G.isTouch && document.pointerLockElement !== canvas && G.playing && !G.paused) actions.menu();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) { if (e.code === 'Escape' || e.code === 'Enter') hook('keyInField', e); return; }
    IN.keys[e.code] = true;
    if (e.code === 'Escape' && G.paused) { actions.closeScreen(); return; }
    if (!G.playing) return;
    if (e.code === 'KeyE' || e.code === 'KeyI') { e.preventDefault(); if (G.paused) actions.closeScreen(); else actions.inventory(); return; }
    if (G.paused) return;
    if (e.code === 'KeyF') actions.toggleFly();
    if (e.code === 'F5' || e.code === 'KeyV') { e.preventDefault(); actions.camera(); }
    if (e.code === 'KeyM') actions.map();
    if (e.code === 'KeyT' || e.code === 'Enter') { e.preventDefault(); actions.chat(); }
    if (e.code === 'KeyQ') actions.dropHeld(!!(e.ctrlKey));
    if (e.code.startsWith('Digit')) { const n = parseInt(e.code.slice(5)); if (n >= 1 && n <= 9) actions.select(n - 1); }
  });
  window.addEventListener('keyup', (e) => { IN.keys[e.code] = false; });
  window.addEventListener('wheel', (e) => { if (playing()) actions.select((G.player.selected + (e.deltaY > 0 ? 1 : -1) + 9) % 9); });
  window.addEventListener('blur', () => IN.reset());
}
