// 阿导海钓 H5 原型 — 纯 JS + Canvas，逻辑分辨率 360x640。规则见 miniprogram/game_design.md v0.3（数值均为示意）。
(() => {
'use strict';
const W = 360, H = 640;
const DEBUG = /[?&]debug=1/.test(location.search);
const FAST = /[?&]fast=1/.test(location.search);
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
let S = 1;                                   // backing pixels per logical pixel
const FONT = '"FP", "PingFang SC", "Microsoft YaHei", monospace';

// ---------------------------------------------------------------- palette
const C = {
  cream: '#faeecd', cream2: '#f0deb4', brown: '#8c562c', brown2: '#c48c50', ink: '#58341e',
  orange: '#e26e3c', lime: '#c8ec46', white: '#faf8f0', red: '#e84038', yellow: '#fad646',
  gold: '#ffce3c', goldD: '#96641e', grey: '#9696a0', yel: '#f0c850', grn: '#6ec85a',
  navy: '#0a224e', navy2: '#0e2242', outl: '#0a141e', blue: '#3c8cc8', blueD: '#144682',
  sky0: '#78b4f0', sky1: '#dcecfa', sea0: '#286eaa', sea1: '#08244e',
};
const TIER = [null, ['铜', '#ba703a', '#6e3c1e'], ['银', '#a8b0be', '#545a68'], ['金', '#e2aa28', '#82560a']];

// ---------------------------------------------------------------- data helpers
const FISH = window.FISH, SPOTS = window.SPOTS;
const FBY = {}; FISH.forEach(f => { FBY[f.id] = f; });          // 不用 Object.fromEntries（小工具基线 Chrome 61）
const SPOT = {}; SPOTS.forEach(s => { SPOT[s.id] = s; });
const natives = sp => FISH.filter(f => f.spot === sp);
const isRare = f => f.stars >= 4;
const tiersOf = f => isRare(f) ? [10, 50, 200] : [10, 100, 500];
const TITLE_SUFFIX = ['猎手', '达人', '之王'];
const REGEN_MS = 8 * 60 * 1000, CAP = 30, CASTS_PER_TRIP = 6;
const GATE = 0.7;

// ---------------------------------------------------------------- save
const KEY = 'adao_haidiao_save_v1';
function freshSave() {
  return { v: 1, stamina: CAP, staminaTs: Date.now(), coins: 0, dex: {}, freeTrip: { xiaoxing: true },
    tutorialCasts: 3, pending: {}, title: '', titles: [], seenUnlock: { xiaoxing: true }, mute: false };
}
let save;
function load() {
  try { save = JSON.parse(localStorage.getItem(KEY)) || freshSave(); } catch (e) { save = freshSave(); }
  const d = freshSave(); for (const k in d) if (save[k] === undefined) save[k] = d[k];
}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {} }
function regen() {
  const now = Date.now();
  if (save.stamina >= CAP) { save.staminaTs = now; return; }
  if (now < save.staminaTs) { save.staminaTs = now; return; }      // 本地时间异常：只封顶不惩罚
  const n = Math.floor((now - save.staminaTs) / REGEN_MS);
  if (n > 0) { save.stamina = Math.min(CAP, save.stamina + n); save.staminaTs += n * REGEN_MS; if (save.stamina >= CAP) save.staminaTs = now; persist(); }
}
function nextRegenSec() { return save.stamina >= CAP ? 0 : Math.max(0, Math.ceil((save.staminaTs + REGEN_MS - Date.now()) / 1000)); }
const dexOf = id => save.dex[id] || { n: 0, pb: 0 };
const caught = id => dexOf(id).n > 0;
function gateInfo(spotId) {             // requirement to unlock spotId (based on previous spot)
  const i = SPOTS.findIndex(s => s.id === spotId);
  if (i <= 0) return null;
  const prev = SPOTS[i - 1], nat = natives(prev.id);
  const need = Math.ceil(nat.length * GATE - 1e-9), have = nat.filter(f => caught(f.id)).length;
  return { prev, need, have, ok: have >= need };
}
function spotUnlocked(id) { const g = gateInfo(id); return !g || (g.ok && spotUnlocked(g.prev.id)); }
function tierOf(f) { const n = dexOf(f.id).n, t = tiersOf(f); return n >= t[2] ? 3 : n >= t[1] ? 2 : n >= t[0] ? 1 : 0; }
function dexScore() {
  let s = 0;
  for (const f of FISH) { if (!caught(f.id)) continue; s += 10; const t = tierOf(f); s += [0, 5, 20, 50][t]; }
  return s;
}
const dexLevel = () => 1 + Math.floor(dexScore() / 20);
const dexCount = () => FISH.filter(f => caught(f.id)).length;
const MAIN_TITLES = [
  { name: '新手', cond: '钓上第 1 条鱼', ok: () => dexCount() >= 1 },
  { name: '资深钓友', cond: '小星山、风车塔都达 70% + 图鉴 ≥10 种 + 图鉴等级 ≥ Lv6', ok: () => gateInfo('daqing').ok && dexCount() >= 10 && dexLevel() >= 6 },
  { name: '钓王', cond: '通关大青针 + 图鉴 ≥18 种 + Lv10（后续版本）', ok: () => false },
  { name: '海钓大师', cond: '通关油井并钓上 GT + 26/26 + Lv20（后续版本）', ok: () => false },
];
// 体力奖励（鸭鸭定）：只有主称号 +10；鱼种副称号不送，段位奖励按文档 4.1.2：二段银框 +5、三段金框 +10（可超上限）
const TIER_STAMINA = [0, 0, 5, 10];
function grantTitles() {          // returns [{name, bonus}]
  const got = [];
  for (const t of MAIN_TITLES) if (t.ok() && !save.titles.includes(t.name)) got.push({ name: t.name, bonus: 10 });
  for (const f of FISH) { const t = tierOf(f); for (let k = 0; k < t; k++) { const nm = f.name + TITLE_SUFFIX[k]; if (!save.titles.includes(nm)) got.push({ name: nm, bonus: TIER_STAMINA[k + 1] }); } }
  for (const g of got) { save.titles.push(g.name); save.stamina += g.bonus; }
  if (got.length && !save.title) save.title = got[0].name;
  return got;
}

// ---------------------------------------------------------------- assets
const IMG = {}, SIL = {};
function loadImages() {
  return Promise.all(FISH.map(f => new Promise(res => {
    const im = new Image(); im.onload = () => {
      IMG[f.id] = im;
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#1c2a3c'; g.fillRect(0, 0, c.width, c.height);
      SIL[f.id] = c; res();
    }; im.onerror = res; im.src = 'assets/fish/' + f.id + '.png';
  })));
}
// 音效：首次触摸时才创建（懒加载）。咬口用 bite_A2，收线用 reel_E；水花/断线用 WebAudio 合成噪声（无额外文件），每次随机音高避免机械重复。
const SND = {};
let actx = null; const NOISE = {};
function ensureAudio() {
  if (SND.bite) return;
  for (const k of ['bite', 'reel']) { try { const a = new Audio('assets/' + k + '.mp3'); a.preload = 'auto'; SND[k] = a; } catch (e) {} }
  if (SND.reel) SND.reel.loop = true;
  try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); } catch (e) { actx = null; }
}
function play(k, rate) {
  if (save.mute) return; ensureAudio(); const a = SND[k]; if (!a) return;
  try { a.playbackRate = rate || 1; a.currentTime = 0; const p = a.play(); if (p) p.catch(() => {}); } catch (e) {}
}
function setRate(k, rate) { const a = SND[k]; if (a) try { a.playbackRate = rate; } catch (e) {} }
function stop(k) { if (SND[k]) try { SND[k].pause(); } catch (e) {} }
function noiseBuf(kind) {
  if (NOISE[kind]) return NOISE[kind];
  const dur = kind === 'splash' ? 0.5 : kind === 'snap' ? 0.14 : 0.3, n = Math.floor(actx.sampleRate * dur);
  const b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) { const u = i / n, env = kind === 'snap' ? Math.pow(1 - u, 3) : kind === 'splash' ? Math.pow(1 - u, 2) * Math.min(1, u * 30) : Math.sin(Math.PI * u); d[i] = (Math.random() * 2 - 1) * env; }
  return (NOISE[kind] = b);
}
function synth(kind, vol) {
  if (save.mute || !actx) return;
  try {
    if (actx.state === 'suspended') actx.resume();
    const src = actx.createBufferSource(); src.buffer = noiseBuf(kind); src.playbackRate.value = 0.8 + Math.random() * 0.45;
    const f = actx.createBiquadFilter(); f.type = kind === 'snap' ? 'highpass' : 'lowpass';
    f.frequency.value = kind === 'splash' ? 700 + Math.random() * 1100 : kind === 'snap' ? 1800 : 500 + Math.random() * 300;
    const g = actx.createGain(); g.gain.value = (vol || 1) * (kind === 'snap' ? 0.5 : 0.35);
    src.connect(f); f.connect(g); g.connect(actx.destination); src.start();
    src.onended = () => { try { src.disconnect(); f.disconnect(); g.disconnect(); } catch (e) {} };
  } catch (e) {}
}
let lastVibe = 0;
function vibe(p, minGap) {          // navigator.vibrate 不支持时静默跳过
  const now = performance.now(); if (minGap && now - lastVibe < minGap) return; lastVibe = now;
  try { if (!save.mute && navigator.vibrate) navigator.vibrate(p); } catch (e) {}
}

// ---------------------------------------------------------------- drawing helpers
function font(sz) { ctx.font = sz + 'px ' + FONT; }
function txt(s, x, y, col = C.white, opt = {}) {
  const sz = opt.size || 12; font(sz); ctx.textBaseline = 'top'; ctx.textAlign = opt.align || 'left';
  if (opt.outline) { ctx.fillStyle = opt.outline; for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) ctx.fillText(s, x + dx, y + dy); }
  ctx.fillStyle = col; ctx.fillText(s, x, y);
}
function tw(s, sz = 12) { font(sz); return ctx.measureText(s).width; }
function wrap(s, x, y, maxw, col, lh = 16, opt = {}) {
  let line = '', yy = y;
  for (const ch of s) { if (tw(line + ch, opt.size || 12) > maxw) { txt(line, x, yy, col, opt); line = ch; yy += lh; } else line += ch; }
  if (line) txt(line, x, yy, col, opt); return yy + lh;
}
function rect(x, y, w, h, fill, stroke) { if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1); } }
function panel(x, y, w, h) {
  rect(x + 3, y + 3, w, h, 'rgba(0,10,30,.55)'); rect(x, y, w, h, C.brown); rect(x + 2, y + 2, w - 4, h - 4, C.cream);
  rect(x + 2, y + 2, w - 4, 2, '#fff8e0');
}
function grad(y0, y1, c0, c1, x0 = 0, x1 = W, bands = 12) {
  const a = hex(c0), b = hex(c1), hgt = (y1 - y0) / bands;
  for (let i = 0; i < bands; i++) { const t = i / (bands - 1); ctx.fillStyle = `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',')})`; ctx.fillRect(x0, Math.floor(y0 + i * hgt), x1 - x0, Math.ceil(hgt) + 1); }
}
function hex(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
function lighten(h, d = 50) { return '#' + hex(h).map(v => Math.min(255, v + d).toString(16).padStart(2, '0')).join(''); }
function star(x, y, r, on) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) { const rr = k % 2 ? r * .45 : r, a = -Math.PI / 2 + k * Math.PI / 5; ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); }
  ctx.closePath(); ctx.fillStyle = on ? C.gold : '#d2c8b4'; ctx.fill(); ctx.strokeStyle = C.goldD; ctx.lineWidth = 1; ctx.stroke();
}
function stars(x, y, n, tot = 5, r = 5) { for (let i = 0; i < tot; i++) star(x + i * (r * 2 + 2), y, r, i < n); }
function fishImg(id, cx, cy, maxW, maxH, sil = false, flip = false) {
  const im = sil ? SIL[id] : IMG[id]; if (!im) return;
  let k = Math.min(maxW / im.width, maxH / im.height); k = k >= 1 ? Math.floor(k) : k;
  const w = Math.round(im.width * k), h = Math.round(im.height * k);
  ctx.save(); ctx.translate(Math.round(cx), Math.round(cy)); if (flip) ctx.scale(-1, 1);
  ctx.drawImage(im, -Math.round(w / 2), -Math.round(h / 2), w, h); ctx.restore();
}
function boltIcon(x, y) { ctx.beginPath(); [[6, 0], [0, 9], [5, 9], [2, 16], [10, 6], [5, 6], [8, 0]].forEach(([a, b]) => ctx.lineTo(x + a, y + b)); ctx.closePath(); ctx.fillStyle = C.gold; ctx.fill(); ctx.strokeStyle = C.outl; ctx.stroke(); }
function lockIcon(x, y, col = C.white) { rect(x - 6, y - 2, 12, 10, col); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - 3, 4, Math.PI, 0); ctx.stroke(); rect(x - 1, y + 1, 2, 4, C.outl); }

// ---------------------------------------------------------------- buttons / input
let buttons = [];
function button(id, x, y, w, h, label, col = C.blue, colD = C.blueD, opt = {}) {
  const pressed = input.downOn === id;
  const dy = pressed ? 2 : 0;
  if (!opt.flat) rect(x, y + 3, w, h, colD);
  rect(x, y + dy, w, h, opt.disabled ? '#9a9488' : col, C.outl);
  rect(x + 2, y + dy + 2, w - 4, 1, lighten(opt.disabled ? '#9a9488' : col, 50));
  txt(label, x + w / 2, y + dy + h / 2 - (opt.size || 12) / 2 - 1, C.white, { align: 'center', outline: C.outl, size: opt.size || 12 });
  buttons.push({ id, x, y, w, h, disabled: opt.disabled, hold: opt.hold });
}
function hitBtn(x, y) { for (let i = buttons.length - 1; i >= 0; i--) { const b = buttons[i], pad = 4; if (x >= b.x - pad && x < b.x + b.w + pad && y >= b.y - pad && y < b.y + b.h + 3 + pad) return b; } return null; }
const input = { downOn: null, holdIds: new Set(), ptrs: new Map(), keyHold: false };
let dirty = true;
function kick() { dirty = true; if (timerId) { clearTimeout(timerId); timerId = 0; } schedule(0); }
function toLogical(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; }
cv.addEventListener('pointerdown', e => {
  e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  kick();
  const [x, y] = toLogical(e); const b = hitBtn(x, y);
  input.ptrs.set(e.pointerId, { x0: x, y0: y, t0: performance.now(), btn: b && !b.disabled ? b.id : null, swiped: false });
  unlockAudio();
  if (b && !b.disabled) { input.downOn = b.id; if (b.hold) input.holdIds.add(e.pointerId + ':' + b.id); }
  else if (scene.holdAnywhere && scene.holdAnywhere()) input.holdIds.add(e.pointerId + ':reel');   // 搏鱼时按住屏幕任意处 = 收线（单手）
  scene.down && scene.down(x, y, b && !b.disabled ? b.id : null);
});
cv.addEventListener('pointermove', e => {
  const p = input.ptrs.get(e.pointerId); if (!p) return; const [x, y] = toLogical(e);
  if (p.swiped || p.btn || performance.now() - p.t0 > 450) return;
  const dx = x - p.x0, dy = y - p.y0;
  if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy)) { p.swiped = true; scene.swipe && scene.swipe(dx > 0 ? 1 : -1); dirty = true; }
  else if (dy < -26 && Math.abs(dy) > Math.abs(dx)) { p.swiped = true; scene.swipe && scene.swipe('up'); dirty = true; }
});
function ptrUp(e) {
  kick();
  const p = input.ptrs.get(e.pointerId); input.ptrs.delete(e.pointerId);
  for (const k of Array.from(input.holdIds)) if (k.indexOf(e.pointerId + ':') === 0) input.holdIds.delete(k);
  if (!p) return; const [x, y] = toLogical(e); const b = hitBtn(x, y);
  if (p.btn && b && b.id === p.btn && !p.swiped) scene.click && scene.click(p.btn);
  if (input.downOn === p.btn) input.downOn = null;
}
cv.addEventListener('pointerup', ptrUp); cv.addEventListener('pointercancel', ptrUp);
// 触摸永远不滚动/缩放页面
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
document.addEventListener('touchstart', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (e.repeat) return; kick();
  if (e.code === 'Space') { input.keyHold = true; e.preventDefault(); scene.down && scene.down(-1, -1, 'key'); }
  if (e.code === 'ArrowLeft') scene.swipe && scene.swipe(-1);
  if (e.code === 'ArrowRight') scene.swipe && scene.swipe(1);
  if (e.code === 'ArrowUp') scene.swipe && scene.swipe('up');
  if (e.code === 'KeyA') scene.click && scene.click('adao');
});
window.addEventListener('keyup', e => { if (e.code === 'Space') input.keyHold = false; });
const holding = id => (input.keyHold && id === 'reel') || Array.from(input.holdIds).some(k => k.slice(-id.length - 1) === ':' + id);
function releaseAllInput() { input.holdIds.clear(); input.ptrs.clear(); input.keyHold = false; input.downOn = null; }
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return; audioUnlocked = true; ensureAudio();
  try { if (actx && actx.state === 'suspended') actx.resume(); } catch (e) {}
  for (const k in SND) { const a = SND[k]; a.muted = true; const p = a.play(); if (p) p.then(() => { a.pause(); a.muted = false; a.currentTime = 0; }).catch(() => { a.muted = false; }); else a.muted = false; }
}

// ---------------------------------------------------------------- toasts & particles (固定对象池，不产生垃圾)
let toasts = [], lowFx = false, shakeT = 0, shakeMag = 0;
const POOL = []; for (let i = 0; i < 360; i++) POOL.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 0, c: '#fff', g: 80, s: 2 });
let liveParts = 0;
function spawn(x, y, vx, vy, life, c, g, s) {
  for (let i = 0; i < POOL.length; i++) { const p = POOL[i]; if (!p.on) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.life = life; p.c = c; p.g = g; p.s = s || 2; liveParts++; return; } }
}
function toast(s, col = C.yellow, dur = 2.2) { if (toasts.length > 1) toasts.shift(); toasts.push({ s, col, t: 0, dur }); }
function firework(x, y, n = 40, big = false) {
  const cols = [C.gold, C.white, '#ff78c8', '#78f0fa', C.lime]; if (lowFx) n = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = (big ? 90 : 60) * (0.4 + Math.random()); spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, 0.6 + Math.random() * .5, cols[i % cols.length], 80, 2); }
}
function splash(x, y, n = 10, big = false) {
  if (lowFx) n = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (Math.random() - .5) * 1.6, v = (big ? 110 : 70) * (0.4 + Math.random()); spawn(x + (Math.random() - .5) * 10, y, Math.cos(a) * v, Math.sin(a) * v, 0.5 + Math.random() * .4, i % 3 ? '#e6f4ff' : '#9cd2f4', 300, i % 4 ? 2 : 3); }
}
function shake(mag, dur) { shakeMag = Math.max(shakeMag, mag); shakeT = Math.max(shakeT, dur); }
function fxActive() { return liveParts > 0 || toasts.length > 0 || shakeT > 0; }
function drawFx(dt) {
  for (let i = 0; i < POOL.length; i++) {
    const p = POOL[i]; if (!p.on) continue;
    p.t += dt; if (p.t >= p.life) { p.on = false; liveParts--; continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; rect(Math.round(p.x), Math.round(p.y), p.s, p.s, p.c);
  }
  toasts = toasts.filter(t => (t.t += dt) < t.dur);
  toasts.forEach((t, i) => { const w = tw(t.s) + 16, y = 104 + i * 24; rect(W / 2 - w / 2, y, w, 20, 'rgba(10,20,40,.88)', t.col); txt(t.s, W / 2, y + 3, t.col, { align: 'center' }); });
}

// ---------------------------------------------------------------- shared HUD
function fmtTime(s) { const m = Math.floor(s / 60), r = s % 60; return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0'); }
function hud(extra) {
  rect(0, 0, W, 30, C.navy2); rect(0, 30, W, 1, '#000');
  boltIcon(8, 7); txt('体力 ' + save.stamina + '/' + CAP, 22, 9, C.white, { outline: C.outl });
  if (save.stamina < CAP) txt('+1 ' + fmtTime(nextRegenSec()), 100, 9, '#aad2f0');
  if (extra) txt(extra, W - 8, 9, C.yellow, { align: 'right', outline: C.outl });
  else txt('金币 ' + save.coins, W - 8, 9, C.gold, { align: 'right', outline: C.outl });
}

// ---------------------------------------------------------------- sea scenes
function turbine(x, base, h, t, ph) {
  rect(x - 1, base - h, 2, h, '#e8eef4'); rect(x - 2, base - h - 2, 5, 3, '#f4f8fc');
  ctx.strokeStyle = '#f4f8fc'; ctx.lineWidth = 1.5;
  for (let k = 0; k < 3; k++) { const a = t * 1.4 + ph + k * 2.094; ctx.beginPath(); ctx.moveTo(x, base - h); ctx.lineTo(x + Math.cos(a) * h * .45, base - h + Math.sin(a) * h * .45); ctx.stroke(); }
}
function seaScene(spot, t, y0, y1, hz) {
  grad(y0, hz, C.sky0, C.sky1, 0, W, 8);
  ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(300, y0 + 26, 9, 0, 7); ctx.fill();
  if (spot === 'xiaoxing') {
    ctx.fillStyle = '#5c824a'; ctx.beginPath(); [[30, hz], [60, hz - 22], [92, hz - 30], [124, hz - 16], [150, hz]].forEach(([a, b]) => ctx.lineTo(a, b)); ctx.fill();
    ctx.fillStyle = '#6e9a58'; ctx.beginPath(); [[230, hz], [252, hz - 12], [276, hz - 8], [290, hz]].forEach(([a, b]) => ctx.lineTo(a, b)); ctx.fill();
  } else {
    [[40, 44, 0], [110, 32, 1], [250, 50, 2], [320, 28, 3], [190, 22, 4]].forEach(([x, h, p]) => turbine(x, hz + 2, h, t, p));
  }
  grad(hz, y1, C.sea0, C.sea1, 0, W, 14);
  // 水面：像素浪峰（正弦）+ 透视浪线（近处更长更稀）
  for (let x = 0; x < W; x += 2) { const dy = Math.round(Math.sin(x * 0.07 + t * 1.6) * 1.4 + Math.sin(x * 0.023 - t * 0.9)); rect(x, hz + dy, 2, 1, '#9ccff2'); if (dy < 0) rect(x, hz + dy - 1, 2, 1, '#e8f6ff'); }
  const rows = lowFx ? 6 : 11;
  for (let r = 0; r < rows; r++) {
    const yy = hz + 6 + Math.round(r * r * 2.6 + r * 4), len = 3 + r, gap = 26 + r * 9, sp = 6 + r * 2.2;
    if (yy > y1 - 4) break;
    const col = r < 4 ? '#6eaee0' : '#4c8cc4';
    for (let i = -1; i < W / gap + 1; i++) { const x = Math.round(((i * gap + t * sp + r * 17) % (W + gap)) - gap / 2), wob = Math.round(Math.sin(t * 2 + i * 1.7 + r) * 1); rect(x, yy + wob, len, 1, col); }
  }
  if (spot === 'xiaoxing') {        // 礁底
    ctx.fillStyle = '#16304a'; ctx.beginPath(); [[0, y1], [0, y1 - 18], [40, y1 - 26], [90, y1 - 14], [150, y1 - 30], [210, y1 - 16], [270, y1 - 28], [330, y1 - 12], [W, y1 - 20], [W, y1]].forEach(([a, b]) => ctx.lineTo(a, b)); ctx.fill();
    ctx.fillStyle = '#21405e'; for (let i = 0; i < 9; i++) ctx.fillRect(18 + i * 38, y1 - 14 - (i * 7) % 10, 6, 2);
  }
}
function drawBoat(t) {               // 船浮在水面上，随浪轻微起伏
  const bob = Math.round(Math.sin(t * 1.6) * 1), by = HZ - 12 + bob;
  ctx.fillStyle = '#ecece6'; ctx.beginPath(); [[0, by], [130, by], [112, HZ + 12 + bob], [0, HZ + 12 + bob]].forEach(([a, b]) => ctx.lineTo(a, b)); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.outl; ctx.lineWidth = 1; ctx.stroke(); rect(0, by - 4, 134, 4, '#c83c32'); rect(0, by + 7, 122, 2, '#3c78b4');
  rect(8, by - 22, 26, 18, '#d8dce2', C.outl); rect(12, by - 18, 8, 6, '#78b4f0'); rect(22, by - 18, 8, 6, '#78b4f0');
  ctx.fillStyle = 'rgba(40,110,170,.6)'; ctx.fillRect(0, HZ + 1, 128, 12);
  return bob;
}
// 鱼竿：12 节分段曲线。load = 张力 × 鱼重系数；越靠竿梢弯得越多（渐进调性）；aim = 鱼线方向。
function drawRod(load, aim, shakeAmt, t, bob) {
  const hx = 74, hy = HZ - 16 + (bob || 0), N = 12, L = 132, seg = L / N, a0 = -0.95;
  let d = aim - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  let x = hx, y = hy; const pts = [[x, y]];
  for (let i = 0; i < N; i++) {
    const u = (i + 1) / N, k = Math.min(0.96, load * Math.pow(u, 1.6) * 1.05);
    const a = a0 + d * k + Math.sin(t * 46 + i) * 0.035 * u * shakeAmt;
    x += Math.cos(a) * seg; y += Math.sin(a) * seg; pts.push([x, y]);
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < N; i++) {
    const u = i / N; ctx.lineWidth = Math.max(1, Math.round(4 - 3 * u)); ctx.strokeStyle = i < 2 ? '#3a2a1e' : '#26262c';
    ctx.beginPath(); ctx.moveTo(Math.round(pts[i][0]), Math.round(pts[i][1])); ctx.lineTo(Math.round(pts[i + 1][0]), Math.round(pts[i + 1][1])); ctx.stroke();
    if (i % 3 === 2) rect(Math.round(pts[i + 1][0]) - 1, Math.round(pts[i + 1][1]) - 1, 2, 2, '#c8ccd4');
  }
  ctx.lineCap = 'butt';
  rect(hx + 2, hy - 10, 10, 10, '#78808c', C.outl); rect(hx + 5, hy - 7, 4, 4, '#b4bcc8');
  return pts[N];
}
// 鱼线：二次曲线。张力低 → 下垂（松线）；张力高 → 绷直；危险时红白闪
function drawLine(x0, y0, x1, y1, tension, t) {
  const sag = Math.pow(1 - Math.min(1, tension), 2) * 46 + 4;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + sag;
  ctx.strokeStyle = tension >= 0.8 ? (Math.sin(t * 40) > 0 ? C.red : '#fff0f0') : C.lime; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
}
// 饵：风车塔 = 铁板（约 10 cm，12 px）；小星山 = 铅坠 + 子线 + 虾饵。像素逐点绘制，不旋转贴图（不糊）。
function drawLure(spot, x, y, ang) {
  x = Math.round(x); y = Math.round(y);
  if (spot === 'fengche') {
    for (let i = -6; i <= 5; i++) { const px = Math.round(x + Math.cos(ang) * i), py = Math.round(y + Math.sin(ang) * i); rect(px, py, 1, 2, i < -3 ? '#e8eef4' : i < 2 ? '#ff6ea8' : '#ffd84a'); }
    const hx = Math.round(x + Math.cos(ang) * -7), hy = Math.round(y + Math.sin(ang) * -7); rect(hx, hy - 1, 1, 3, '#c0c4cc');
  } else {
    rect(x - 2, y - 3, 4, 5, '#3c4048'); rect(x - 1, y - 3, 1, 1, '#8c949e');
    ctx.strokeStyle = 'rgba(220,240,200,.8)'; ctx.beginPath(); ctx.moveTo(x + .5, y + 2); ctx.lineTo(x + 7.5 + Math.cos(ang) * 2, y + 8.5); ctx.stroke();
    const sx = Math.round(x + 8 + Math.cos(ang) * 2), sy = y + 8; rect(sx, sy, 5, 2, '#f2a08c'); rect(sx + 5, sy - 1, 2, 2, '#e07860'); rect(sx - 1, sy + 1, 1, 1, '#c0c4cc');
  }
}
// 真实比例：屏幕长度 = 12 + 体长cm×0.62（逻辑 px，360 宽），再按本条体重 (w/w常见上限)^(1/3) 微调；限制 20–130 px（远小于半屏）
const SPR = {}; let sprN = 0;
function fishPx(f, w) {
  const L = (window.FISH_LEN && FISH_LEN[f.id]) || 30, r = Math.max(0.75, Math.min(1.5, Math.cbrt((w || f.w[1]) / f.w[1])));
  return Math.max(20, Math.min(130, Math.round((12 + L * r * 0.62) / 2) * 2));
}
// 预缩小的像素精灵：逐级减半缩小 → alpha 二值化 → 边缘描深色 1px。之后只做 1:1 绘制（整数倍放大到屏幕，不糊）
function fishSprite(id, px) {
  const im = IMG[id]; if (!im) return null;
  const key = id + '@' + px; if (SPR[key]) return SPR[key];
  if (sprN > 40) { for (const k in SPR) delete SPR[k]; sprN = 0; }
  const tw = px, th = Math.max(4, Math.round(im.height * px / im.width));
  let src = im, sw = im.width, sh = im.height;
  while (sw / 2 >= tw * 1.5) { const c = document.createElement('canvas'); c.width = Math.ceil(sw / 2); c.height = Math.ceil(sh / 2); const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.drawImage(src, 0, 0, sw, sh, 0, 0, c.width, c.height); src = c; sw = c.width; sh = c.height; }
  const c = document.createElement('canvas'); c.width = tw; c.height = th; const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.drawImage(src, 0, 0, sw, sh, 0, 0, tw, th);
  try {
    const id2 = g.getImageData(0, 0, tw, th), a = id2.data, op = new Uint8Array(tw * th);
    for (let i = 0; i < tw * th; i++) op[i] = a[i * 4 + 3] > 100 ? 1 : 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const i = y * tw + x, p = i * 4;
      if (!op[i]) { a[p + 3] = 0; continue; }
      a[p + 3] = 255;
      const edge = x === 0 || y === 0 || x === tw - 1 || y === th - 1 || !op[i - 1] || !op[i + 1] || !op[i - tw] || !op[i + tw];
      if (edge) { a[p] = a[p] * .45 + 20 * .55; a[p + 1] = a[p + 1] * .45 + 30 * .55; a[p + 2] = a[p + 2] * .45 + 44 * .55; }
    }
    g.putImageData(id2, 0, 0);
  } catch (e) { /* file:// 下 getImageData 可能受限：直接用缩小图 */ }
  SPR[key] = c; sprN++; return c;
}
// 游动的鱼：把精灵按 3 px 竖条绘制，尾部按正弦摆（头部不动），整数偏移，不缩放 → 不糊
function drawFishSwim(id, cx, cy, faceRight, phase, amp, alpha, spr) {
  const im = spr || IMG[id]; if (!im) return;
  const w = im.width, h = im.height, sw = w < 70 ? 2 : 3;
  amp = Math.max(1, Math.round(amp * Math.min(1, w / 90)));
  ctx.save(); if (alpha != null) ctx.globalAlpha = alpha;
  ctx.translate(Math.round(cx), Math.round(cy)); if (faceRight) ctx.scale(-1, 1);
  for (let sx = 0; sx < w; sx += sw) {
    const k = Math.max(0, (sx - w * 0.45) / (w * 0.55)), dy = Math.round(Math.sin(phase - sx / w * 11) * amp * k * k);
    const ww = Math.min(sw, w - sx);
    ctx.drawImage(im, sx, 0, ww, h, -Math.round(w / 2) + sx, -Math.round(h / 2) + dy, ww, h);
  }
  ctx.restore();
}
// 分段像素条（替代纯色条）
function segBar(x, y, w, h, frac, colFn, n, flash) {
  rect(x - 1, y - 1, w + 2, h + 2, flash ? C.red : C.outl); rect(x, y, w, h, '#1a1414');
  const sw = (w - (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const sx = Math.round(x + i * (sw + 1)), on = (i + 0.5) / n <= frac, c = colFn(i / n);
    rect(sx, y, Math.round(sw), h, on ? c : '#3a3030'); if (on) rect(sx, y, Math.round(sw), 1, lighten(c, 70));
  }
}

// ================================================================ scenes
let scene = null;
function go(s) { scene = s; s.enter && s.enter(); }

// ---------------- MAP
const MapScene = {
  sel: null, dbg: false,
  fps() { return 15; },          // 只有风机转、井架灯闪，低帧率即可
  enter() { this.sel = null; },
  render(dt, t) {
    grad(0, H, '#3480c4', '#0e3068', 0, W, 16);
    ctx.fillStyle = '#5096d2'; for (let i = 0; i < 50; i++) ctx.fillRect((i * 67) % W, 40 + (i * 131) % 600, 5, 1);
    hud();
    txt('阿导海钓', W / 2, 40, C.yellow, { align: 'center', outline: C.outl, size: 24 });
    const tl = save.title ? '「' + save.title + '」' : '还没有称号';
    txt('图鉴 Lv' + dexLevel() + '  ' + dexCount() + '/' + FISH.length + '  ' + tl, W / 2, 70, C.white, { align: 'center', outline: C.outl });
    txt('上一钓点图鉴 70% 解锁下一钓点', W / 2, 88, '#aad2f0', { align: 'center' });
    const rh = 104;
    SPOTS.forEach((sp, i) => {
      const x = 12, y = 108 + i * (rh + 8), w = W - 24, open = spotUnlocked(sp.id) && sp.mvp, gi = gateInfo(sp.id);
      if (open) panel(x, y, w, rh); else { rect(x + 3, y + 3, w, rh, 'rgba(0,10,30,.55)'); rect(x, y, w, rh, '#787c84', C.outl); }
      // icon
      const ix = x + 8, iy = y + 8, isz = 88;
      ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, isz, isz); ctx.clip();
      if (sp.id === 'youjing') {
        grad(iy, iy + 58, '#0a1028', '#282850', ix, ix + isz, 6); grad(iy + 58, iy + isz, '#0a1e3c', '#040c1c', ix, ix + isz, 4);
        [[28, 50, '#ffdc78'], [36, 48, '#ffdc78'], [32, 42, '#ff5a46'], [66, 52, '#ffdc78'], [70, 49, '#ff5a46']].forEach(([a, b, c]) => { const on = Math.sin(t * 3 + a) > -0.6; rect(ix + a, iy + b, 2, 2, on ? c : '#554'); });
        txt('远处井架灯', ix + isz / 2, iy + 66, '#c8c8dc', { align: 'center' });
      } else {
        grad(iy, iy + 48, C.sky0, C.sky1, ix, ix + isz, 6); grad(iy + 48, iy + isz, C.sea0, '#14468a', ix, ix + isz, 6);
        const cx = ix + isz / 2, hz = iy + 50;
        if (sp.id === 'xiaoxing') { ctx.fillStyle = '#5c824a'; ctx.beginPath(); [[cx - 26, hz], [cx - 10, hz - 16], [cx + 4, hz - 20], [cx + 18, hz - 8], [cx + 28, hz]].forEach(([a, b]) => ctx.lineTo(a, b)); ctx.fill(); }
        else if (sp.id === 'fengche') { turbine(cx - 18, hz, 26, t, 0); turbine(cx + 4, hz, 32, t, 1); turbine(cx + 24, hz, 22, t, 2); }
        else { ctx.fillStyle = '#c8c8c2'; ctx.beginPath(); [[cx - 6, hz], [cx - 12, hz - 18], [cx - 2, hz - 26], [cx + 10, hz - 18], [cx + 6, hz]].forEach(([a, b]) => ctx.lineTo(a, b)); ctx.fill(); }
      }
      if (!open) { ctx.fillStyle = 'rgba(60,60,70,.5)'; ctx.fillRect(ix, iy, isz, isz); }
      ctx.restore(); rect(ix, iy, isz, isz, null, C.outl);
      const tx = ix + isz + 12, dark = open ? C.ink : C.white;
      txt('LV' + sp.lv + ' ' + sp.name, tx, y + 10, dark, { size: 24, outline: open ? null : C.outl });
      const nat = natives(sp.id), have = nat.filter(f => caught(f.id)).length;
      if (open) {
        txt('图鉴 ' + have + '/' + nat.length + '   航程体力 ' + (save.freeTrip[sp.id] ? '免费' : sp.fee), tx, y + 42, C.brown);
        rect(tx, y + 60, w - (tx - x) - 12, 9, '#e6d6b0', C.brown); rect(tx + 1, y + 61, Math.round((w - (tx - x) - 14) * have / nat.length), 7, C.lime);
        button('go_' + sp.id, tx, y + 74, 110, 22, '出船', C.orange, '#782814');
        txt('铅坠 ' + sp.lead, tx + 120, y + 79, C.brown2);
      } else {
        lockIcon(tx + 8, y + 50);
        if (gi) {
          txt(gi.prev.name + '图鉴 ' + Math.min(gi.have, gi.need) + '/' + gi.need + ' 解锁', tx + 22, y + 44, C.yellow, { outline: C.outl });
          for (let j = 0; j < gi.need; j++) rect(tx + 22 + j * 18, y + 64, 13, 12, j < gi.have ? C.gold : '#50545c', C.outl);
          txt(gi.ok && !sp.mvp ? '已达成 · MVP 暂未开放' : (sp.mvp ? '还差 ' + (gi.need - gi.have) + ' 种' : '还差 ' + Math.max(0, gi.need - gi.have) + ' 种 · MVP 暂未开放'), tx + 22, y + 82, C.white, { outline: C.outl });
        }
      }
    });
    button('dex', 12, H - 44, 160, 32, '图鉴 · 称号', C.blue, C.blueD);
    button('mute', 184, H - 44, 70, 32, save.mute ? '音效 关' : '音效 开', '#6c7480', '#383c44');
    if (DEBUG) button('dbg', 266, H - 44, 82, 32, '调试', '#a03cb4', '#501a5a');
    if (this.dbg) {
      panel(40, 200, 280, 200); txt('调试（?debug=1）', W / 2, 212, C.ink, { align: 'center' });
      button('dbg_fill', 60, 240, 240, 30, '补满体力（30）', C.blue, C.blueD);
      button('dbg_more', 60, 280, 240, 30, '体力 +100', C.blue, C.blueD);
      button('dbg_reset', 60, 320, 240, 30, '重置存档', C.red, '#781414');
      button('dbg_close', 60, 360, 240, 30, '关闭', '#6c7480', '#383c44');
    }
    if (this.sel) this.renderConfirm();
  },
  renderConfirm() {
    const sp = SPOT[this.sel]; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H);
    panel(30, 190, 300, 230);
    txt('出船 · ' + sp.name, W / 2, 204, C.orange, { align: 'center', size: 24 });
    const fee = save.freeTrip[sp.id] ? 0 : sp.fee;
    const y = wrap(sp.ride + '。航程体力 ' + (fee ? fee : '免费（首次）') + '，每竿 1 体力，最多 ' + CASTS_PER_TRIP + ' 竿；没用完的竿不扣。', 46, 240, 268, C.ink);
    wrap('铅坠：' + sp.lead + '（按流速自动配好）', 46, y + 4, 268, C.brown);
    const enough = save.stamina >= fee + 1 || (sp.id === 'xiaoxing' && save.tutorialCasts > 0 && save.stamina >= fee);
    if (enough) button('sail', 46, 360, 130, 34, '出发', C.orange, '#782814');
    else { const need = fee + 1 - save.stamina, sec = (need - 1) * REGEN_MS / 1000 + nextRegenSec(); txt(fmtTime(Math.ceil(sec)) + ' 后可以出船', 112, 370, C.red, { align: 'center' }); }
    button('cancel', 186, 360, 128, 34, '再想想', '#6c7480', '#383c44');
  },
  click(id) {
    if (id.startsWith('go_')) { this.sel = id.slice(3); return; }
    if (id === 'cancel') this.sel = null;
    if (id === 'sail') { const sp = SPOT[this.sel]; const fee = save.freeTrip[sp.id] ? 0 : sp.fee; save.stamina -= fee; save.freeTrip[sp.id] = false; persist(); Trip.start(sp.id); go(Trip); }
    if (id === 'dex') { Dex.tab = 0; Dex.detail = null; go(Dex); }
    if (id === 'mute') { save.mute = !save.mute; if (save.mute) stop('reel'); persist(); }
    if (id === 'dbg') this.dbg = true;
    if (id === 'dbg_close') this.dbg = false;
    if (id === 'dbg_fill') { save.stamina = Math.max(save.stamina, CAP); save.staminaTs = Date.now(); persist(); toast('体力已补满'); }
    if (id === 'dbg_more') { save.stamina += 100; persist(); toast('体力 +100'); }
    if (id === 'dbg_reset') { save = freshSave(); persist(); this.dbg = false; toast('存档已重置'); }
  },
};

// ---------------- TRIP (fishing)
const ZONES = [[0, .22, 'grey'], [.22, .4, 'yel'], [.4, .6, 'gold'], [.6, .78, 'yel'], [.78, 1, 'grey']];
const HIT = { gold: 0.25, yel: 0.12, grey: 0.05 };
const T = FAST ? { sink: .4, wait: [.3, .6], rare: .5 } : { sink: 1.3, wait: [1.2, 3.2], rare: 1.1 };
function rollFish(spot) {
  const lv = SPOT[spot].lv;
  const pool = FISH.filter(f => SPOT[f.spot].lv <= lv && SPOT[f.spot].mvp);
  const wts = pool.map(f => [0, 4, 2, 1, .5, .3][f.stars] * (f.spot === spot ? 1 : .5));
  let r = Math.random() * wts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= wts[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}
function rollWeight(f) {
  const [a, b, c, d] = f.w, r = Math.random();
  let w = r < .75 ? a + (b - a) * Math.random() : r < .96 ? b + (c - b) * Math.random() : c + (d - c) * Math.random();
  return Math.round(w * 100) / 100;
}
function sizeClass(f, w) { const [a, b, c] = f.w; return w > c ? '巨物' : w > b ? '大物' : w < a + (b - a) * .35 ? '小' : '标准'; }
function fmtW(w) { return w < 1 ? Math.round(w * 1000) + ' g' : w.toFixed(w < 10 ? 2 : 1) + ' kg'; }

const HZ = 200;                     // 水面线（侧视剖面：上面是天空和船，下面是水下）
const Trip = {
  start(spot) { this.paused = false; this.celebrate = 0; this.landing = null; this.visitor = null; this.hook = null; this._reeling = false; this.spot = spot; this.casts = 0; this.log = []; this.coins = 0; this.phase = 'idle'; this.pt = 0; this.msg = ''; this.result = null; this.fight = null; this.tip = TIPS[Math.floor(Math.random() * TIPS.length)]; this.initSchools(); },
  enter() {},
  castsLeft() { return CASTS_PER_TRIP - this.casts; },
  canCast() { return this.castsLeft() > 0 && (save.stamina >= 1 || (this.spot === 'xiaoxing' && save.tutorialCasts > 0)); },
  cast() {
    if (!this.canCast()) return;
    if (this.spot === 'xiaoxing' && save.tutorialCasts > 0) { save.tutorialCasts--; toast('教学竿 免费（剩 ' + save.tutorialCasts + '）', C.lime); }
    else { if (save.stamina >= CAP) save.staminaTs = Date.now(); save.stamina -= 1; }
    this.casts++; persist();
    this.phase = 'sink'; this.pt = 0; this.wait = T.wait[0] + Math.random() * (T.wait[1] - T.wait[0]);
    this.visitor = null; this.fight = null; this.landing = null;
    const pend = save.pending[this.spot];
    if (pend) { this.hook = { f: FBY[pend.id], w: pend.w, guaranteed: true }; this.willBite = true; }
    else {
      // 有鱼过来看饵的概率 × 该鱼的咬口意愿（示意，整体咬口率约 70%）
      const f = rollFish(this.spot), comes = Math.random() < 0.92;
      this.willBite = comes && Math.random() < FISH_AI[f.id][6];
      this.hook = this.willBite ? { f, w: rollWeight(f) } : null;
      this.visitor = comes && !this.willBite ? f : null; this.visitorW = this.visitor ? rollWeight(f) : 0;       // 跟着看、不咬
    }
  },
  lureY() { return this.spot === 'fengche' ? 352 : 438; },
  lurePos(t) {                      // 饵的位置与角度：下沉时翻飞，等待时随流摆动，铁板定时上抽（急窜）再翻飞下落
    const LY = this.lureY(), X = 232;
    if (this.phase === 'sink') { const k = Math.min(1, this.pt / T.sink); return { x: X + Math.sin(this.pt * 13) * 2, y: HZ + (LY - HZ) * k, a: Math.PI / 2 + Math.sin(this.pt * 15) * 0.8 }; }
    let x = X + Math.sin(t * 1.3) * 3, y = LY, a = 0.15 + Math.sin(t * 1.7) * 0.25;
    if (this.spot === 'fengche' && this.phase === 'wait') {
      const u = this.pt % 1.7;
      if (u < 0.14) { y -= u / 0.14 * 14; a = -1.3; } else { const k = Math.max(0, 1 - (u - 0.14) / 0.9); y -= 14 * k; a = Math.sin(u * 16) * 0.9 * k + 0.2; }
    }
    return { x, y, a };
  },
  startBite() {
    play('bite', 0.94 + Math.random() * 0.12); vibe(50);
    const L = this.lurePos(performance.now() / 1000);
    shake(5, 0.3); firework(L.x, L.y, 36);
    this.phase = this.hook.f.stars >= 3 ? 'rare' : 'bite'; this.pt = 0;
    if (this.phase === 'bite') this.startPointer();
  },
  startPointer() { this.phase = 'bite'; this.pt = 0; this.pdur = 2.2; this.ppos = 0; this.pom = 2 * Math.PI / (0.95 + Math.random() * .2); this.pph = Math.random() * 6; },
  pointerPos() {
    const t = this.pt, raw = 0.5 + 0.5 * Math.sin(this.pph + t * this.pom);
    if (t > this.pdur - 0.3) { const k = Math.min(1, (t - (this.pdur - 0.3)) / 0.15); return raw + (0.5 - raw) * k; }   // 最后 0.3 s 停金区（新手保底）
    return raw;
  },
  strike() {
    const p = this.pointerPos(), z = ZONES.find(z => p >= z[0] && p <= z[1])[2];
    const f = this.hook.f, sc = sizeClass(f, this.hook.w);
    const szK = { 小: .8, 标准: 1, 大物: 1.35, 巨物: 1.8 }[sc];
    const r = FISH_AI[f.id], rnd = () => 0.85 + Math.random() * 0.3;     // 每次中鱼的个体差异
    const ai = { speed: r[0] * rnd() * (0.8 + 0.2 * szK), burst: r[1] * rnd() * (0.85 + 0.15 * szK), freq: r[2] * rnd(), dur: r[3] * rnd() * (0.8 + 0.2 * szK),
      pull: Math.min(1.2, r[4] * rnd()), fatigue: r[5] * rnd(), style: r[7], rerun: r[8], recover: 0.02 + 0.03 * r[8] };
    const dist = 12 + f.stars * 4 + Math.random() * 8 + (szK - 1) * 10;
    this.fight = { stamina: 1 - HIT[z], tension: 0.3, red: 0, slack: 0, energy: 0, adao: 0, burst: 0, btype: null, bdir: 0, nextBurst: 0, dist, dist0: dist,
      lat: 0, depth: 0, rerunDone: false, zone: z, t: 0, ai, szK, dmg: 0.075 * ai.fatigue / szK, wob: 0 };
    this.fight.nextBurst = this.burstGap();
    this.phase = 'fight'; this.pt = 0;
    const L = this.lurePos(performance.now() / 1000);
    shake(z === 'gold' ? 7 : 4, 0.35); vibe(z === 'gold' ? [40, 30, 60] : 40);
    firework(L.x, L.y, z === 'gold' ? 60 : 30, z === 'gold');
    toast(z === 'gold' ? '完美刺鱼！鱼耐力 -25%' : z === 'yel' ? '刺中！鱼耐力 -12%' : '刺中了（偏了）鱼耐力 -5%', z === 'gold' ? C.gold : C.white);
    if (f.stars >= 3 || szK >= 1.35) this.startBurst(1.5, '中鱼狂奔！');           // 大鱼中鱼后先冲一波
  },
  burstGap() { const F = this.fight; return (10 / F.ai.freq) * (0.5 + Math.random()) * (0.6 + F.stamina * 0.6); },
  startBurst(mult, msg) {
    const F = this.fight, ai = F.ai;
    let type = ai.style; const r = Math.random();
    if (r < 0.2) type = type === 'lateral' ? 'run' : 'lateral';               // 偶尔换冲法
    F.btype = type; F.bdir = type === 'lateral' ? (Math.random() < .5 ? -1 : 1) : type === 'run' ? 1 : 'up';
    F.burst = ai.dur * (0.6 + 0.6 * F.stamina) * (mult || 1);
    vibe(30, 200); shake(2, 0.2);
    const pos = this.fishPos(); if (pos.y < HZ + 40) { splash(pos.x, HZ, 12); synth('splash', 0.6); }
    toast(msg || (type === 'lateral' ? (F.bdir < 0 ? '鱼往左冲！向左滑摆竿' : '鱼往右冲！向右滑摆竿') : type === 'run' ? '鱼在远跑！松手让线' : '鱼往下钻！松手，向上滑扬竿'), C.yellow, 1.4);
  },
  spr(f, w) { return fishSprite(f.id, fishPx(f, w)); },
  hookSpr() { return this.hook ? this.spr(this.hook.f, this.hook.w) : null; },
  fishPos() {
    const F = this.fight, im = this.hookSpr(), fw = im ? im.width : 40;
    const x = Math.min(330, 150 + Math.min(F.dist, 48) * 3.8 + F.lat);
    const near = Math.min(1, F.dist / 40);
    const y = Math.min(452, HZ + 16 + near * 190 + F.depth * 70);
    const faceRight = F.burst > 0 && (F.btype === 'run' || (F.btype === 'lateral' && F.bdir > 0));
    const mx = faceRight ? x + fw / 2 - 3 : x - fw / 2 + 3;
    return { x, y, faceRight, mx, my: y - 2 };
  },
  lose(reason, kind) {
    stop('reel'); this._reeling = false;
    if (kind === 'snap') { synth('snap'); shake(4, 0.25); }
    vibe(120);
    save.pending[this.spot] = { id: this.hook.f.id, w: this.hook.w }; persist();
    this.phase = 'lost'; this.pt = 0; this.result = { reason };
  },
  startLanding() {
    stop('reel'); this._reeling = false;
    const pos = this.fishPos();
    this.landing = { dur: this.hook.f.stars >= 3 ? 2.6 : 1.9, x0: pos.x, s1: false, s2: false, s3: false };
    this.phase = 'landing'; this.pt = 0;
  },
  land() {
    stop('reel'); this._reeling = false;
    const f = this.hook.f, w = this.hook.w, d = dexOf(f.id), isNew = d.n === 0, sc = sizeClass(f, w);
    const oldTier = tierOf(f);
    const unlockedBefore = SPOTS.filter(s => spotUnlocked(s.id)).map(s => s.id);   // 必须在图鉴+1之前记录，否则解锁提示永远为空
    d.n++; const pb = w > d.pb; if (pb) d.pb = w; save.dex[f.id] = d;
    delete save.pending[this.spot];
    const coins = Math.round([0, 5, 12, 30, 60, 100][f.stars] * { 小: .8, 标准: 1, 大物: 1.5, 巨物: 2.5 }[sc]);
    save.coins += coins; this.coins += coins;
    const newTier = tierOf(f);
    const titles = grantTitles();
    const newSpots = SPOTS.filter(s => spotUnlocked(s.id) && !unlockedBefore.includes(s.id));
    for (const s of SPOTS) if (spotUnlocked(s.id) && !save.seenUnlock[s.id]) { save.seenUnlock[s.id] = true; save.freeTrip[s.id] = true; }
    persist();
    this.log.push({ id: f.id, w, sc }); toasts = [];
    this.phase = 'catch'; this.pt = 0;
    const big = f.stars >= 3;
    this.result = { f, w, sc, pb: pb && !isNew, isNew, coins, tierUp: newTier > oldTier ? newTier : 0, titles, newSpots, n: d.n, big };
    firework(W / 2, 200, 70, true);
    if (big) { this.celebrate = 1.6; shake(6, 0.5); vibe([60, 40, 120]); } else { this.celebrate = 0; vibe(40); }
  },
  endTrip() { stop('reel'); this._reeling = false; this.phase = 'summary'; this.pt = 0; },
  holdAnywhere() { return this.phase === 'fight' && !this.paused; },
  fps() { return ['sink', 'wait', 'bite', 'rare', 'fight', 'landing'].indexOf(this.phase) >= 0 || this.celebrate > 0 ? 60 : 30; },
  update(dt) {
    if (this.paused) return;
    this.updateSchools(dt);
    this.pt += dt;
    if (this.phase === 'sink' && this.pt > T.sink) { this.phase = 'wait'; this.pt = 0; }
    else if (this.phase === 'wait' && this.pt > this.wait) {
      if (this.willBite) this.startBite(); else { this.phase = 'empty'; this.pt = 0; }
    } else if (this.phase === 'rare' && this.pt > T.rare) this.startPointer();
    else if (this.phase === 'bite' && this.pt > this.pdur + 0.15) { this.phase = 'miss'; this.pt = 0; }
    else if (this.phase === 'fight') this.updateFight(dt);
    else if (this.phase === 'landing') this.updateLanding();
    else if (this.phase === 'catch' && this.celebrate > 0) {
      this.celebrate -= dt;
      if (Math.random() < dt * 7) { firework(40 + Math.random() * (W - 80), 90 + Math.random() * 200, 34, true); synth('splash', 0.25); }
    }
  },
  updateFight(dt) {
    const F = this.fight, ai = F.ai; F.t += dt; F.wob += dt * (F.burst > 0 ? 18 : 7);
    const reel = holding('reel');
    if (reel && !this._reeling) play('reel', 0.95 + Math.random() * 0.1); if (!reel && this._reeling) stop('reel'); this._reeling = reel;
    if (reel) setRate('reel', 0.85 + F.tension * 0.4);
    // 冲刺调度
    if (F.burst > 0) { F.burst -= dt; if (F.burst <= 0) { F.burst = 0; F.btype = null; F.nextBurst = this.burstGap(); } }
    else if (F.stamina > 0.08) { F.nextBurst -= dt; if (F.nextBurst <= 0) this.startBurst(1); }
    if (!F.burst && F.dist < 4 && F.stamina > 0.35) this.startBurst(0.8, '到船边又冲了！');
    const bursting = F.burst > 0, typeK = { lateral: 0.4, run: 1, dive: 0.55 }[F.btype] || 0, sta = F.stamina, REEL = 3.0;
    if (F.adao > 0) {
      F.adao -= dt; F.tension = Math.max(0.2, F.tension - 0.45 * dt);
      if (reel) { F.stamina -= F.dmg * 3 * dt; F.dist -= REEL * 2.2 * dt; }
      if (bursting) F.dist += ai.burst * typeK * 0.3 * dt;
    } else {
      let rise;
      if (reel) {
        rise = 0.18 + 0.32 * ai.pull * F.szK * (0.4 + 0.6 * sta) + (bursting ? 0.35 + 0.55 * ai.pull : 0);
        if (F.tension > 0.8) rise *= 0.35;
        if (!bursting) { F.dist -= REEL * (0.35 + 0.65 * (1 - sta)) * dt; F.stamina -= F.dmg * dt; }
        else { F.dist += ai.burst * typeK * (0.5 + 0.5 * sta) * 0.45 * dt; F.stamina -= F.dmg * 0.3 * dt; }
      } else {
        rise = bursting ? 0.06 + 0.12 * ai.pull : -0.65;
        if (bursting) F.dist += ai.burst * typeK * (0.5 + 0.5 * sta) * dt;
        else { F.dist += ai.speed * 0.25 * sta * dt; F.stamina = Math.min(1, F.stamina + ai.recover * dt); }   // 不收线时鱼会慢慢恢复
      }
      if (bursting) F.stamina -= 0.05 * ai.fatigue * dt;
      F.tension = Math.max(0, Math.min(1, F.tension + rise * dt));
    }
    F.stamina = Math.max(0, F.stamina); F.dist = Math.max(0, Math.min(80, F.dist));
    // 力竭后缓过劲再冲（按鱼种概率，每条鱼最多一次）
    if (!F.rerunDone && F.stamina < 0.2 && F.stamina > 0) { F.rerunDone = true; if (Math.random() < ai.rerun) { F.stamina += 0.3; this.startBurst(1.2, '鱼缓过劲来了，又冲了！'); } }
    const tl = bursting && F.btype === 'lateral' ? F.bdir * 45 : 0, td = bursting && F.btype === 'dive' ? 1 : 0;
    F.lat += (tl - F.lat) * Math.min(1, dt * 2.5); F.depth += (td - F.depth) * Math.min(1, dt * 1.8);
    const pos = this.fishPos();
    if (F.dist < 7 && pos.y < HZ + 34 && Math.random() < (bursting ? 10 : 2.5) * dt) { splash(pos.x + (Math.random() - .5) * 40, HZ, bursting ? 12 : 5); if (bursting) synth('splash', 0.4); }
    if (F.tension >= 0.8) { F.red += dt; vibe(25, 350); } else F.red = 0;
    if (F.tension < 0.06) F.slack += dt; else F.slack = 0;
    if (F.tension >= 1) return this.lose('切线了！张力满格', 'snap');
    if (F.red > 1.5) return this.lose('跑鱼了！张力顶红太久');
    if (F.slack > 2.2) return this.lose('脱钩了！线放得太松');
    if (F.dist <= 1.5 && F.stamina <= 0.35) this.startLanding();
  },
  updateLanding() {
    const L = this.landing, u = this.pt;
    if (!L.s1 && u > 0.05) { L.s1 = true; splash(L.x0, HZ, 18, true); synth('splash', 0.9); vibe(40); }
    if (!L.s2 && u > 0.7) { L.s2 = true; splash(160, HZ, 22, true); synth('splash', 1); shake(3, 0.2); }
    if (!L.s3 && u > 1.5) { L.s3 = true; splash(120, HZ, 10); synth('splash', 0.5); }
    if (u > 0.75 && u < 1.15 && Math.random() < 0.5) splash(160 + (Math.random() - .5) * 30, HZ, 3);
    if (u >= L.dur) this.land();
  },
  swipe(dir) {
    if (this.phase !== 'fight' || this.paused) return; const F = this.fight;
    if (F.burst && dir === F.bdir) {
      F.energy = Math.min(3, F.energy + 1); F.burst = 0; F.btype = null; F.nextBurst = this.burstGap(); F.stamina -= 0.04;
      const pos = this.fishPos(); firework(pos.x, pos.y, 12); vibe(20);
      toast((dir === 'up' ? '扬竿' : '摆竿') + ' +1 格（' + F.energy + '/3）', C.gold, 1.2);
    } else if (F.burst) { F.tension = Math.min(1, F.tension + 0.08); toast(F.bdir === 'up' ? '鱼在下钻，要向上滑' : '方向反了！跟着鱼头方向滑', C.red, 1.2); }
  },
  down(x, y, id) {
    if (this.paused) { this.paused = false; releaseAllInput(); return; }
    if (this.phase === 'bite' && id !== 'home') this.strike();
    else if (this.phase === 'landing' && this.pt > 0.4) this.land();      // 点一下抄网，跳过上鱼动画
  },
  click(id) {
    if (this.paused) return;
    if (id === 'cast') this.cast();
    if (id === 'home') { if (this.phase === 'idle' || this.phase === 'empty' || this.phase === 'miss') this.endTrip(); }
    if (id === 'adao' && this.phase === 'fight' && this.fight.energy >= 3 && this.fight.adao <= 0) { const F = this.fight, pos = this.fishPos(); F.energy = 0; F.adao = 3; F.stamina -= 0.1; firework(pos.x, pos.y, 50, true); shake(4, .3); vibe([30, 30, 30]); toast('阿导一招！3 秒收线不涨张力', C.orange, 1.6); }
    if (id === 'next') { if (this.castsLeft() <= 0 || !this.canCast()) { this.endTrip(); if (!this.canCast() && this.castsLeft() > 0) toast('体力用完，自动返航', C.red); } else { this.phase = 'idle'; this.pt = 0; this.tip = TIPS[Math.floor(Math.random() * TIPS.length)]; } }
    if (id === 'tomap') go(MapScene);
  },
  render(dt, t) {
    const sp = SPOT[this.spot], dark = this.phase === 'rare' || (this.phase === 'bite' && this.hook && this.hook.f.stars >= 3);
    seaScene(this.spot, t, 31, 470, HZ);
    this.renderSchool(t);
    const F = this.phase === 'fight' ? this.fight : null, ten = F ? F.tension : 0;
    let tx = 232, ty = this.lureY(), showLure = false, faceR = false;
    // 水下：看饵/追饵/咬口
    if (['sink', 'wait', 'bite', 'rare'].indexOf(this.phase) >= 0) {
      const L = this.lurePos(t); tx = L.x; ty = L.y; showLure = true;
      const vf = this.phase === 'wait' ? (this.hook ? this.hook.f : this.visitor) : (this.phase === 'bite' || this.phase === 'rare') ? this.hook.f : null;
      const vsp = vf ? this.spr(vf, vf === (this.hook && this.hook.f) ? this.hook.w : this.visitorW) : null;
      if (vf && vsp) {
        const fw = vsp.width, tgt = L.x + fw / 2 - 2; let fx, fy = L.y + 1, face = false, amp = 2;
        if (this.phase === 'wait') {
          const k = Math.min(1, this.pt / this.wait);
          if (this.hook) { const e = 1 - Math.pow(1 - k, 2); fx = 420 + (tgt - 420) * e + (k > .85 ? Math.sin(t * 20) * 3 : 0); fy = L.y + Math.sin(t * 2) * 4 * (1 - k); amp = k > .85 ? 4 : 2; }
          else if (k < .55) { fx = 420 + (tgt + 26 - 420) * (k / .55); }
          else if (k < .78) { fx = tgt + 26 + Math.sin(t * 3) * 6; fy = L.y + Math.sin(t * 2.2) * 5; }
          else { face = true; fx = tgt + 26 + (k - .78) / .22 * 260; }
        } else { fx = tgt + Math.sin(t * 30) * 2; amp = 5; }
        drawFishSwim(vf.id, fx, fy, face, t * (amp > 3 ? 18 : 8), amp, 0.92, vsp);
      }
    }
    let pos = null;
    if (F) { pos = this.fishPos(); tx = pos.mx; ty = pos.my; drawFishSwim(this.hook.f.id, pos.x, pos.y, pos.faceRight, F.wob, F.burst > 0 ? 5 : 2.5, pos.y < HZ + 30 ? 1 : 0.88, this.hookSpr()); }
    if (this.phase === 'landing') this.renderLanding(t);
    // 鱼竿 + 鱼线
    const load = F ? Math.min(1.15, ten * (0.75 + 0.25 * Math.min(1, this.hook.w / 8)) + (F.burst > 0 ? 0.12 : 0)) : this.phase === 'bite' || this.phase === 'rare' ? 0.35 : this.phase === 'landing' ? 0.45 : 0.04;
    const tipGuess = [150, 100], aim = Math.atan2(ty - tipGuess[1], tx - tipGuess[0]);
    const shakeAmt = F ? (F.burst > 0 ? 1.4 : ten > .8 ? 0.8 : 0.15) : (this.phase === 'bite' || this.phase === 'rare') ? 1.6 : 0;
    const bob = drawBoat(t);
    const tip = drawRod(load, Math.max(-0.2, aim), shakeAmt, t, bob);
    if (showLure || F) drawLine(tip[0], tip[1], tx, ty, F ? ten : (this.phase === 'sink' ? 0.6 : 0.35), t);
    if (showLure) drawLure(this.spot, this.lurePos(t).x, this.lurePos(t).y, this.lurePos(t).a);
    if (F && ten >= 0.8 && Math.sin(t * 22) > 0) { ctx.strokeStyle = C.red; ctx.lineWidth = 4; ctx.strokeRect(2, 33, W - 4, 435); }
    if (dark) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 31, W, 439);
      for (const yy of [31, 456]) { rect(0, yy, W, 14, '#1e0a0a'); ctx.fillStyle = C.red; for (let xx = -20 + (t * 40 % 20); xx < W; xx += 20) { ctx.beginPath(); ctx.moveTo(xx, yy + 14); ctx.lineTo(xx + 10, yy + 14); ctx.lineTo(xx + 20, yy); ctx.lineTo(xx + 10, yy); ctx.fill(); } }
      if (Math.sin(t * 10) > -0.3) txt('大物！', W / 2, 110, C.red, { align: 'center', size: 36, outline: '#ffe6c8' });
      txt('稀有鱼咬口 ' + '★'.repeat(this.hook.f.stars), W / 2, 156, C.yellow, { align: 'center', outline: C.outl });
    }
    hud('第 ' + Math.min(this.casts + (this.phase === 'idle' ? 1 : 0), CASTS_PER_TRIP) + '/' + CASTS_PER_TRIP + ' 竿');
    if (!F) txt(sp.name + ' · ' + (this.spot === 'fengche' ? '铁板' : '钓底 虾饵') + ' · 铅坠 ' + sp.lead, 8, 36, C.white, { outline: C.outl });
    if (save.pending[this.spot] && (this.phase === 'idle')) txt('上次跑掉的鱼还在：下一竿必遇！', W - 8, 52, C.gold, { align: 'right', outline: C.outl });
    if (this.phase === 'sink') txt('下沉中… ' + Math.round((this.spot === 'fengche' ? 30 : 18) * Math.min(1, this.pt / T.sink)) + ' m', tx + 14, ty - 8, C.white, { outline: C.outl });
    if (this.phase === 'wait') txt(this.visitor && this.pt / this.wait > .55 ? '它在看饵…' : this.spot === 'fengche' ? '抽铁板中…' : '等咬口…', tx + 14, ty - 22, C.white, { outline: C.outl });
    if (F) this.renderFightTop(t, pos);
    // bottom panel
    panel(4, 474, W - 8, H - 478);
    const P0 = 484;
    if (this.phase === 'idle') {
      button('cast', 16, P0 + 8, 210, 52, this.canCast() ? '下竿（1 体力）' : '体力不够', C.orange, '#782814', { size: 12, disabled: !this.canCast() });
      if (this.spot === 'xiaoxing' && save.tutorialCasts > 0) txt('教学竿免费 ×' + save.tutorialCasts, 121, P0 + 66, C.grn, { align: 'center' });
      button('home', 238, P0 + 8, 106, 52, '返航', '#6c7480', '#383c44');
      wrap(this.tip, 16, P0 + 88, W - 40, C.brown);
    } else if (this.phase === 'sink' || this.phase === 'wait') {
      txt(this.phase === 'sink' ? (this.spot === 'fengche' ? '铁板下沉中，翻飞着往下掉…' : '铅坠下沉中，等它沉底…') : this.visitor && this.pt / this.wait > .55 ? '有鱼在跟饵，但没咬…' : '竿尖在抖吗？咬口时会出现指针！', W / 2, P0 + 20, C.ink, { align: 'center' });
      wrap(this.tip, 16, P0 + 60, W - 40, C.brown);
    } else if (this.phase === 'rare') {
      txt('大物咬口！准备刺鱼…', W / 2, P0 + 24, C.red, { align: 'center', size: 24 });
    } else if (this.phase === 'bite') {
      txt('咬口！点一下屏幕刺鱼', W / 2, P0 + 6, C.red, { align: 'center', size: 24 });
      this.pointerBar(24, P0 + 54, W - 48, 30, this.pointerPos());
      txt('停在金色「完美」= 扣鱼耐力 25%', W / 2, P0 + 96, C.ink, { align: 'center' });
      segBar(24, P0 + 120, W - 48, 6, Math.max(0, 1 - this.pt / this.pdur), () => C.orange, 24);
    } else if (F) this.renderFightPanel(P0, t);
    else if (this.phase === 'landing') {
      txt(this.hook.f.stars >= 3 ? '大物到船边了！' : '鱼到船边了！', W / 2, P0 + 20, C.orange, { align: 'center', size: 24 });
      txt('抄网上鱼中…（点屏幕可跳过）', W / 2, P0 + 60, C.brown, { align: 'center' });
    } else if (this.phase === 'empty' || this.phase === 'miss') {
      txt(this.phase === 'empty' ? (this.visitor ? '鱼看了看，没咬' : '这一竿没有咬口，空竿') : '没刺鱼，鱼跑了…', W / 2, P0 + 14, C.ink, { align: 'center', size: 24 });
      txt('只算这 1 竿，不额外扣体力', W / 2, P0 + 48, C.brown, { align: 'center' });
      button('next', 70, P0 + 76, 220, 48, this.castsLeft() > 0 ? '再来一竿' : '返航结算', C.orange, '#782814');
    }
    if (this.phase === 'lost') this.renderLost();
    if (this.phase === 'catch') this.renderCatch(t);
    if (this.phase === 'summary') this.renderSummary();
    if (this.paused) {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H); panel(50, 250, 260, 120);
      txt('已暂停', W / 2, 266, C.orange, { align: 'center', size: 24 }); txt('切到后台时自动暂停', W / 2, 300, C.brown, { align: 'center' });
      txt('点一下屏幕继续', W / 2, 330, C.ink, { align: 'center' });
    }
  },
  // 水下小鱼群：固定对象池（4 群 × 最多 8 条，低性能时 2 群 × 4 条）；三层视差（远=小、暗、慢、深）；会转向；搏鱼冲刺靠近时四散
  initSchools() {
    if (!this.schools) { this.schools = []; for (let i = 0; i < 4; i++) { const m = []; for (let j = 0; j < 8; j++) m.push({ ox: 0, oy: 0, ph: 0 }); this.schools.push({ m, n: 0, layer: 0, x: 0, y: 0, y0: 0, vx: 0, dir: 1, turnT: 0, sc: 0, fx: 0, fy: 0 }); } }
    const deep = this.spot === 'fengche' ? -20 : 0;
    this.schools.forEach((s, i) => {
      s.layer = [0, 1, 2, 1][i]; s.dir = Math.random() < .5 ? -1 : 1; s.x = 20 + Math.random() * (W - 40);
      s.y0 = [410, 345, 270, 380][i] + deep + Math.random() * 20; s.y = s.y0; s.vx = s.dir * [5, 9, 14][s.layer]; s.turnT = 2 + Math.random() * 5; s.sc = 0;
      s.n = 5 + Math.floor(Math.random() * 4);
      s.m.forEach((f, j) => { f.ox = (Math.random() - .5) * (14 + s.layer * 8); f.oy = (Math.random() - .5) * (6 + s.layer * 3); f.ph = Math.random() * 7; });
    });
  },
  updateSchools(dt) {
    if (!this.schools) return;
    const F = this.phase === 'fight' ? this.fight : null, p = F && F.burst > 0 ? this.fishPos() : null;
    for (let i = 0; i < this.schools.length; i++) {
      const s = this.schools[i], sp = [5, 9, 14][s.layer];
      if (p && s.sc < 0.3 && Math.abs(p.x - s.x) < 70 && Math.abs(p.y - s.y) < 45) {   // 大鱼冲过来 → 四散
        s.sc = 1; s.fx = s.x >= p.x ? 1 : -1; s.fy = s.y >= p.y ? 1 : -1; s.dir = s.fx; s.vx = s.fx * 70;
      }
      s.turnT -= dt;
      if (s.turnT <= 0) { s.turnT = 3 + Math.random() * 5; if (Math.random() < .4) s.dir = -s.dir; s.y0 = Math.max(HZ + 40, Math.min(450, s.y0 + (Math.random() - .5) * 30)); }
      s.vx += (s.dir * sp - s.vx) * Math.min(1, dt * (s.sc > 0 ? 1.5 : 0.8));   // 慢慢掉头
      s.x += s.vx * dt; s.y += ((s.y0 + s.fy * s.sc * 26) - s.y) * Math.min(1, dt * 1.5) + Math.sin(this.pt * 0.7 + i) * dt * 2;
      if (s.x < -50) s.x = W + 40; else if (s.x > W + 50) s.x = -40;
      s.sc = Math.max(0, s.sc - dt * 0.5);
    }
  },
  renderSchool(t) {
    if (!this.schools) return;
    const ns = lowFx ? 2 : 4, cols = [['#26608e', '#26608e'], ['#2a6696', '#4f86b0'], ['#7c98ac', '#c8d8e2']];
    for (let i = 0; i < ns; i++) {
      const s = this.schools[i], nm = lowFx ? Math.min(4, s.n) : s.n, L = s.layer, bl = [3, 4, 6][L], bh = L === 2 ? 2 : L === 1 ? 2 : 1, c = cols[L], spread = 1 + s.sc * 2.5;
      const right = s.vx > 0;
      for (let j = 0; j < nm; j++) {
        const f = s.m[j], x = Math.round(s.x + f.ox * spread + Math.sin(t * 1.3 + f.ph) * 2), y = Math.round(s.y + f.oy * spread + Math.sin(t * 2 + f.ph) * 1.5);
        const tail = Math.sin(t * (8 + s.sc * 12) + f.ph) > 0 ? 0 : 1, tw = L === 2 ? 2 : 1;
        rect(x, y, bl, bh, c[0]); if (L > 0) rect(x + 1, y + bh - 1, bl - 2, 1, c[1]);   // 背深腹亮
        if (L === 2) rect(right ? x + bl - 2 : x + 1, y, 1, 1, '#14202c');
        if (L === 2) rect(right ? x - 2 : x + bl, y - 1 + tail, 2, 3 - tail, c[0]); else rect(right ? x - 1 : x + bl, y - tail * (bh - 1), 1, bh, c[0]);
      }
    }
  },
  renderLanding(t) {
    const L = this.landing, u = this.pt, f = this.hook.f, im = this.hookSpr();
    let x, y, face = false, amp = 6, wob = t * 22;
    if (u < 0.7) { const k = u / 0.7; x = L.x0 + (160 - L.x0) * k; y = HZ + 10 - Math.sin(Math.PI * k) * 64; face = false; }   // 跃出水面
    else if (u < 1.15) { x = 160 + Math.sin(t * 25) * 4; y = HZ + 6; amp = 8; }                                          // 水面挣扎
    else if (u < 1.5) { x = 160; y = HZ + 4 - (u - 1.15) / .35 * 6; amp = 4; }
    else { const k = Math.min(1, (u - 1.5) / (L.dur - 1.5)); x = 160 + (64 - 160) * k; y = HZ - Math.sin(Math.PI * k) * 50 - k * 26; amp = 3; }  // 抄网提上船
    if (im) drawFishSwim(f.id, x, y, face, wob, amp, 1, im);
    if (u > 1.0) {                    // 抄网
      const k = Math.min(1, (u - 1.0) / 0.3), nx = Math.round(80 + (x - 80) * k), ny = Math.round(HZ - 20 + (y + 10 - (HZ - 20)) * k);
      ctx.strokeStyle = '#8c6a3c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(60, HZ - 16); ctx.lineTo(nx, ny); ctx.stroke();
      ctx.strokeStyle = '#d8dce2'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(nx, ny, 22, 6, 0, 0, 7); ctx.stroke();
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(nx + i * 8, ny); ctx.lineTo(nx + i * 4, ny + 14); ctx.stroke(); }
    }
    if (f.stars >= 3 && u > 1.5 && Math.sin(t * 14) > 0) txt('大物上船！', W / 2, 100, C.gold, { align: 'center', size: 36, outline: C.outl });
  },
  pointerBar(x, y, w, h, pos) {
    const col = { grey: C.grey, yel: C.yel, gold: C.gold };
    rect(x - 2, y - 2, w + 4, h + 4, C.outl);
    for (const [a, b, z] of ZONES) { rect(x + Math.round(w * a), y, Math.round(w * (b - a)) + 1, h, col[z]); rect(x + Math.round(w * a), y, Math.round(w * (b - a)) + 1, 2, lighten(col[z], 60)); }
    txt('完美', x + w / 2, y + h / 2 - 7, '#6e460a', { align: 'center' });
    const px = x + Math.round(w * pos);
    ctx.fillStyle = C.white; ctx.beginPath(); ctx.moveTo(px - 6, y - 10); ctx.lineTo(px + 6, y - 10); ctx.lineTo(px, y - 1); ctx.fill(); ctx.strokeStyle = C.outl; ctx.lineWidth = 1; ctx.stroke();
    rect(px - 1, y, 3, h, C.white);
  },
  renderFightTop(t, pos) {
    const F = this.fight, f = this.hook.f;
    rect(8, 34, W - 16, 46, 'rgba(10,20,40,.9)', C.outl);
    txt(f.name, 16, 38, C.white, { outline: C.outl }); stars(16 + tw(f.name) + 10, 45, f.stars, f.stars, 4);
    txt('鱼耐力', 140, 38, '#ffaaa0');
    segBar(186, 40, 128, 10, F.stamina, () => C.red, 16);
    txt(Math.round(F.stamina * 100) + '%', 320, 38, C.white, { outline: C.outl });
    // 距离条：船 ←── 鱼
    const dx0 = 140, dx1 = 314, dy = 62; rect(dx0, dy + 3, dx1 - dx0, 2, '#4a6a92');
    rect(dx0 - 4, dy, 6, 6, '#ecece6');
    const fxp = Math.round(dx0 + (dx1 - dx0) * Math.min(1, F.dist / Math.max(20, F.dist0 * 1.3))); rect(fxp - 3, dy + 1, 7, 4, C.gold); rect(fxp + 4, dy, 2, 6, C.gold);
    txt('距船 ' + Math.max(0, F.dist).toFixed(0) + ' m', 16, 58, '#aad2f0');
    if (this.hook.guaranteed) txt('上次跑的那条！', W - 12, 84, C.gold, { align: 'right', outline: C.outl });
    if (F.burst > 0 && pos) {
      const label = F.btype === 'lateral' ? (F.bdir < 0 ? '◀ 向左滑' : '向右滑 ▶') : F.btype === 'run' ? '远跑！向右滑跟竿' : '下钻！向上滑扬竿';
      const x0 = Math.max(8, Math.min(W - 136, pos.x - 64)), y0 = Math.max(HZ + 4, pos.y - 56);
      rect(x0, y0, 128, 22, 'rgba(10,20,40,.9)', C.gold); txt(label, x0 + 64, y0 + 4, C.gold, { align: 'center' });
    }
    if (F.slack > 0.9) txt('线松了！快收线', W / 2, 130, C.yellow, { align: 'center', size: 24, outline: C.outl });
  },
  renderFightPanel(P0, t) {
    const F = this.fight, danger = F.tension >= .8, fl = danger && Math.sin(t * 22) > 0;
    txt('张力', 16, P0 + 2, danger ? C.red : C.brown);
    segBar(52, P0 + 4, 240, 14, F.tension, u => u < .55 ? C.grn : u < .8 ? C.yel : C.red, 20, fl);
    const lbl = danger ? '松手！' : F.tension >= .55 ? '偏高' : F.tension < .08 ? '太松' : '安全';
    txt(lbl, 300, P0 + 2, danger ? C.red : F.tension >= .55 ? '#be8214' : F.tension < .08 ? '#be8214' : C.grn);
    if (F.red > 0) rect(52, P0 + 21, Math.round(240 * Math.min(1, F.red / 1.5)), 3, C.red);
    const hint = F.burst > 0 ? (F.btype === 'dive' ? '鱼在下钻！松手让线，向上滑扬竿' : F.btype === 'run' ? '鱼在远跑！松手让线，向右滑跟竿' : '鱼在横冲！松手，顺着鱼头方向滑') : F.slack > .6 ? '线太松会脱钩，按住收线！' : '按住收线，进红区就松手（红区 1.5 秒跑鱼）';
    txt(hint, 16, P0 + 28, F.slack > .6 ? C.red : C.ink);
    const hold = holding('reel');
    button('reel', 16, P0 + 48, 200, 64, hold ? '收线中…' : '按住 收线', hold ? '#2a70aa' : C.blue, C.blueD, { hold: true, size: 24 });
    txt('按住屏幕任意处也能收线', 16, P0 + 120, C.brown2);
    const cx = 290, cy = P0 + 72, r = 34, ready = F.energy >= 3 && F.adao <= 0;
    if (ready) { ctx.strokeStyle = C.gold; ctx.lineWidth = 2; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6 + t; ctx.beginPath(); ctx.moveTo(cx + (r + 3) * Math.cos(a), cy + (r + 3) * Math.sin(a)); ctx.lineTo(cx + (r + 9) * Math.cos(a), cy + (r + 9) * Math.sin(a)); ctx.stroke(); } }
    ctx.fillStyle = '#782814'; ctx.beginPath(); ctx.arc(cx, cy + 3, r, 0, 7); ctx.fill();
    ctx.fillStyle = ready ? C.orange : '#aa9682'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill(); ctx.strokeStyle = C.outl; ctx.lineWidth = 2; ctx.stroke();
    if (F.adao > 0) { ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill(); txt('一招中', cx, cy - 15, C.white, { align: 'center', outline: C.outl }); txt(F.adao.toFixed(1) + 's', cx, cy + 1, C.white, { align: 'center', outline: C.outl }); }
    else { txt('阿导', cx, cy - 15, C.white, { align: 'center', outline: C.outl }); txt('一招', cx, cy + 1, C.white, { align: 'center', outline: C.outl }); }
    buttons.push({ id: 'adao', x: cx - r, y: cy - r, w: r * 2, h: r * 2, disabled: !ready });
    for (let i = 0; i < 3; i++) rect(cx - 22 + i * 15, cy + r + 6, 13, 7, i < F.energy ? C.gold : '#5a5046', C.outl);
  },
  renderLost() {
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H);
    panel(30, 180, 300, 260);
    txt(this.result.reason, W / 2, 196, C.red, { align: 'center', size: 24 });
    fishImg(this.hook.f.id, W / 2, 262, 160, 60, true);
    txt('？？？', W / 2, 296, C.ink, { align: 'center' });
    txt('别灰心：下一竿必遇同一条！', W / 2, 320, C.orange, { align: 'center' });
    wrap('【阿导知识】中鱼后别猛摇，竿子保持弯，匀速收线；鱼冲的时候松手让线。', 46, 346, 268, C.brown);
    button('next', 70, 392, 220, 36, this.castsLeft() > 0 ? '再来一竿' : '返航结算', C.orange, '#782814');
  },
  renderCatch(t) {
    const R = this.result, f = R.f;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H);
    panel(16, 70, W - 32, 500);
    rect(18, 72, W - 36, 30, R.big ? C.goldD : C.orange); txt(R.big ? (R.isNew ? '大物！新鱼 图鉴 +1' : '大物上船！') : R.isNew ? '新鱼！图鉴 +1' : '上鱼！', W / 2, 74, C.white, { align: 'center', size: 24, outline: '#5a2814' });
    const tier = tierOf(f);
    const fr = tier ? TIER[tier] : null;
    rect(34, 112, W - 68, 130, fr ? fr[2] : '#183460'); rect(38, 116, W - 76, 122, fr ? fr[1] : '#183460'); rect(42, 120, W - 84, 114, '#183460');
    fishImg(f.id, W / 2, 177, W - 100, 100);
    if (R.isNew) { ctx.save(); ctx.translate(W - 80, 132); ctx.rotate(-.2); rect(-34, -12, 68, 24, null, C.red); rect(-33, -11, 66, 22, null, C.red); txt('图鉴+1', 0, -7, C.red, { align: 'center' }); ctx.restore(); }
    txt(f.name, W / 2, 252, C.ink, { align: 'center', size: 24 });
    txt(f.sci, W / 2, 282, C.brown2, { align: 'center' });
    stars(W / 2 - (f.stars * 12) / 2 + 5, 306, f.stars, f.stars, 5);
    txt(fmtW(R.w) + ' · ' + R.sc, W / 2, 320, R.sc === '巨物' ? C.red : R.sc === '大物' ? C.orange : C.ink, { align: 'center', size: 24 });
    let y = 352;
    if (R.pb) { txt('新纪录 PB！', W / 2, y, C.red, { align: 'center' }); y += 18; }
    else { txt('个人纪录 ' + fmtW(dexOf(f.id).pb), W / 2, y, C.brown, { align: 'center' }); y += 18; }
    const ts = tiersOf(f), next = ts.find(v => v > R.n);
    txt('累计 ' + R.n + ' 条' + (next ? '，下一段 ' + next + ' 条' : '，已满段') + '   +' + R.coins + ' 金币', W / 2, y, C.ink, { align: 'center' }); y += 20;
    if (R.tierUp) { txt(TIER[R.tierUp][0] + '框！', W / 2, y, C.goldD, { align: 'center', size: 24 }); y += 28; }
    for (const g of R.titles.slice(0, 3)) { txt('获得称号「' + g.name + '」' + (g.bonus ? ' 体力 +' + g.bonus : ''), W / 2, y, C.orange, { align: 'center' }); y += 18; }
    for (const s of R.newSpots) { txt('解锁新钓点：' + s.name + (s.mvp ? '（首次出船航程免费）' : '（MVP 暂未开放）'), W / 2, y, C.grn, { align: 'center' }); y += 18; }
    button('next', 70, 516, 220, 38, this.castsLeft() > 0 && this.canCast() ? '再来一竿' : '返航结算', C.orange, '#782814');
  },
  renderSummary() {
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, W, H);
    panel(24, 110, W - 48, 420);
    txt('返航结算', W / 2, 124, C.orange, { align: 'center', size: 24 });
    txt(SPOT[this.spot].name + ' · 用了 ' + this.casts + ' 竿 · 上鱼 ' + this.log.length + ' 条', W / 2, 160, C.ink, { align: 'center' });
    this.log.slice(0, 6).forEach((c, i) => {
      const y = 190 + i * 40; rect(40, y, W - 80, 34, C.cream2, C.brown2);
      fishImg(c.id, 82, y + 17, 72, 28); txt(FBY[c.id].name, 128, y + 9, C.ink); txt(fmtW(c.w) + ' ' + c.sc, W - 52, y + 9, C.brown, { align: 'right' });
    });
    if (!this.log.length) txt('这趟空军了，下次换个时间再来', W / 2, 220, C.brown, { align: 'center' });
    txt('金币 +' + this.coins, W / 2, 438, C.goldD, { align: 'center' });
    button('tomap', 70, 470, 220, 40, '回到地图', C.orange, '#782814');
  },
};

// ---------------- DEX
const Dex = {
  tab: 0, detail: null,
  fps() { return 1; },           // 静态页：只在输入时或每秒刷新（体力倒计时）
  render(dt, t) {
    grad(0, H, '#3480c4', '#0e3068', 0, W, 16); hud();
    // level strip
    panel(6, 36, W - 12, 52);
    const sc = dexScore(), lv = dexLevel();
    txt('图鉴等级', 16, 42, C.brown); txt('Lv' + lv, 16, 58, C.orange, { size: 24, outline: C.outl });
    rect(84, 64, 180, 10, '#e6d6b0', C.brown); rect(85, 65, Math.round(178 * (sc % 20) / 20), 8, C.lime);
    txt(sc + ' 分 → Lv' + (lv + 1) + ' 需 ' + (lv * 20) + ' 分', 84, 46, C.ink);
    txt(save.title ? '「' + save.title + '」' : '无称号', W - 14, 62, C.goldD, { align: 'right' });
    // tabs
    SPOTS.forEach((sp, i) => button('tab' + i, 6 + i * 88, 94, 84, 24, sp.name, i === this.tab ? C.orange : '#4a6a92', i === this.tab ? '#782814' : '#22344c', { flat: true }));
    const sp = SPOTS[this.tab], nat = natives(sp.id);
    txt('首见 ' + sp.name + ' ' + nat.filter(f => caught(f.id)).length + '/' + nat.length + (sp.mvp ? '' : ' · MVP 暂未开放，只看剪影'), 10, 124, C.white, { outline: C.outl });
    const cw = 168, ch = 104;
    nat.forEach((f, i) => {
      const x = 8 + (i % 2) * (cw + 8), y = 144 + Math.floor(i / 2) * (ch + 6), d = dexOf(f.id), got = d.n > 0, tr = tierOf(f);
      if (tr) { rect(x, y, cw, ch, TIER[tr][2]); rect(x + 2, y + 2, cw - 4, ch - 4, TIER[tr][1]); rect(x + 5, y + 5, cw - 10, ch - 10, '#183460'); }
      else rect(x, y, cw, ch, got ? '#183460' : '#24364e', C.outl);
      fishImg(f.id, x + cw / 2, y + 38, cw - 30, 46, !got);
      txt(got ? f.name : '？？？', x + 10, y + 66, C.white, { outline: C.outl });
      if (got) { stars(x + 16, y + 92, f.stars, f.stars, 4); txt('×' + d.n, x + cw - 10, y + 66, C.yellow, { align: 'right', outline: C.outl }); txt('PB ' + fmtW(d.pb), x + cw - 10, y + 84, '#aad2f0', { align: 'right' }); }
      else txt('LV' + SPOT[f.spot].lv + ' 起出现', x + 10, y + 84, '#8ca0b8');
      buttons.push({ id: 'fish_' + f.id, x, y, w: cw, h: ch });
    });
    button('back', 8, H - 44, 120, 32, '返回地图', '#6c7480', '#383c44');
    button('titles', 140, H - 44, 212, 32, '主称号 / 佩戴', C.blue, C.blueD);
    if (this.detail) this.renderDetail();
    if (this.showTitles) this.renderTitles();
  },
  renderDetail() {
    const f = FBY[this.detail], d = dexOf(f.id), got = d.n > 0, tr = tierOf(f), ts = tiersOf(f);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H);
    panel(16, 70, W - 32, 500);
    rect(30, 84, W - 60, 120, tr ? TIER[tr][1] : '#183460'); rect(34, 88, W - 68, 112, '#183460');
    fishImg(f.id, W / 2, 144, W - 100, 96, !got);
    txt(got ? f.name : '？？？', W / 2, 212, C.ink, { align: 'center', size: 24 });
    txt(got ? f.sci : 'LV' + SPOT[f.spot].lv + ' ' + SPOT[f.spot].name + ' 起出现', W / 2, 242, C.brown2, { align: 'center' });
    stars(W / 2 - 25, 266, got ? f.stars : 0, 5, 5);
    txt(isRare(f) ? '稀有鱼段位 10 / 50 / 200' : '段位 10 / 100 / 500', W / 2, 280, C.brown, { align: 'center' });
    txt('累计 ' + d.n + ' 条' + (got ? '   PB ' + fmtW(d.pb) + '（' + sizeClass(f, d.pb) + '）' : ''), W / 2, 300, C.ink, { align: 'center' });
    const [a, b, c, mx] = f.w;
    txt('常见 ' + fmtW(a) + '–' + fmtW(b) + ' · 大物至 ' + fmtW(c) + ' · 巨物上限 ' + fmtW(mx), W / 2, 318, C.brown2, { align: 'center' });
    for (let k = 0; k < 3; k++) {
      const y = 344 + k * 50, on = d.n >= ts[k], nm = f.name + TITLE_SUFFIX[k];
      rect(32, y, W - 64, 42, on ? TIER[k + 1][1] : '#e2d6bc', on ? TIER[k + 1][2] : C.brown2);
      txt(TIER[k + 1][0] + '框 · ' + ts[k] + ' 条', 42, y + 6, on ? C.white : C.brown, { outline: on ? C.outl : null });
      txt('称号「' + nm + '」', 42, y + 22, on ? C.white : C.brown2, { outline: on ? C.outl : null });
      if (on) button('wear_' + nm, W - 112, y + 8, 70, 26, save.title === nm ? '佩戴中' : '佩戴', C.orange, '#782814');
      else { rect(W - 150, y + 18, 100, 8, '#c8b896'); rect(W - 150, y + 18, Math.round(100 * Math.min(1, d.n / ts[k])), 8, C.lime); txt(d.n + '/' + ts[k], W - 154, y + 14, C.brown, { align: 'right' }); }
    }
    button('close', 90, 516, 180, 36, '关闭', '#6c7480', '#383c44');
  },
  renderTitles() {
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H);
    panel(16, 90, W - 32, 460);
    txt('主称号', W / 2, 104, C.orange, { align: 'center', size: 24 });
    MAIN_TITLES.forEach((m, i) => {
      const y = 140 + i * 78, on = save.titles.includes(m.name);
      rect(30, y, W - 60, 70, on ? '#f6dc8c' : '#e2d6bc', C.brown2);
      txt(m.name, 42, y + 8, on ? C.ink : '#8c7c64', { size: 24 });
      wrap(m.cond, 42, y + 38, W - 170, C.brown);
      if (on) button('wear_' + m.name, W - 112, y + 20, 70, 28, save.title === m.name ? '佩戴中' : '佩戴', C.orange, '#782814');
      else lockIcon(W - 70, y + 32, '#8c7c64');
    });
    txt('鱼种副称号已获得 ' + save.titles.filter(n => !MAIN_TITLES.some(m => m.name === n)).length + ' / ' + FISH.length * 3, W / 2, 458, C.ink, { align: 'center' });
    button('close', 90, 496, 180, 36, '关闭', '#6c7480', '#383c44');
  },
  click(id) {
    if (id === 'back') go(MapScene);
    else if (id.startsWith('tab')) { this.tab = +id.slice(3); }
    else if (id.startsWith('fish_') && !this.detail && !this.showTitles) this.detail = id.slice(5);
    else if (id === 'close') { this.detail = null; this.showTitles = false; }
    else if (id === 'titles') this.showTitles = true;
    else if (id.startsWith('wear_')) { save.title = id.slice(5); persist(); }
  },
};

// ---------------------------------------------------------------- loop & resize & 生命周期
function resize() {
  const wrapEl = document.getElementById('wrap');
  const vw = (wrapEl && wrapEl.clientWidth) || window.innerWidth, vh = (wrapEl && wrapEl.clientHeight) || window.innerHeight;
  const dpr = window.devicePixelRatio || 1, fit = Math.min(vw / W, vh / H);
  S = Math.max(1, Math.floor(fit * dpr));            // 每个逻辑像素 = 整数个物理像素（不糊）
  cv.width = W * S; cv.height = H * S;
  cv.style.width = (W * S / dpr) + 'px'; cv.style.height = (H * S / dpr) + 'px';
  dirty = true;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
let renders = 0, last = performance.now(), T0 = last, lastRender = 0, rafId = 0, timerId = 0, hiddenState = false, slowFor = 0, ema = 16;
function schedule(delay) {
  if (hiddenState || rafId || timerId) return;          // 只保留一个循环
  if (delay > 20) timerId = setTimeout(() => { timerId = 0; rafId = requestAnimationFrame(frame); }, delay);
  else rafId = requestAnimationFrame(frame);
}
function frame(now) {
  rafId = 0; if (hiddenState) return;
  const fps = fxActive() ? 60 : (scene.fps ? scene.fps() : 60);
  if (!dirty && fps < 60 && now - lastRender < 1000 / fps - 4) { schedule(1000 / fps - (now - lastRender)); return; }
  const raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now; const t = (now - T0) / 1000;
  if (fps >= 60 && raw < 0.2) { ema = ema * 0.95 + raw * 1000 * 0.05; slowFor = ema > 24 ? slowFor + raw : 0; if (slowFor > 2 && !lowFx) lowFx = true; }   // 低性能自动减特效
  regen();
  scene.update && scene.update(dt);
  let sx = 0, sy = 0;
  if (shakeT > 0) { shakeT -= dt; sx = Math.round((Math.random() - .5) * 2 * shakeMag); sy = Math.round((Math.random() - .5) * 2 * shakeMag); if (shakeT <= 0) shakeMag = 0; }
  ctx.setTransform(S, 0, 0, S, sx * S, sy * S); ctx.imageSmoothingEnabled = false;
  buttons = [];
  if (sx || sy) { ctx.fillStyle = '#061430'; ctx.fillRect(-8, -8, W + 16, H + 16); }
  scene.render(dt, t);
  drawFx(dt);
  lastRender = now; dirty = false; renders++;
  const nf = fxActive() ? 60 : (scene.fps ? scene.fps() : 60);
  schedule(nf >= 60 ? 0 : 1000 / nf);
}
function onHide() {
  if (hiddenState) return; hiddenState = true;
  if (rafId) cancelAnimationFrame(rafId); if (timerId) clearTimeout(timerId); rafId = timerId = 0;
  stop('reel'); if (Trip) Trip._reeling = false; releaseAllInput();
  if (scene === Trip && ['sink', 'wait', 'bite', 'rare', 'fight', 'landing'].indexOf(Trip.phase) >= 0) Trip.paused = true;   // 后台暂停搏鱼
  persist();
}
function onShow() {
  if (!hiddenState) return; hiddenState = false;
  regen(); last = performance.now(); dirty = true; schedule(0);       // 体力按时间戳补算
}
document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); else onShow(); });
window.addEventListener('pagehide', onHide);
window.addEventListener('pageshow', () => { if (!document.hidden) onShow(); });
async function boot() {
  load(); regen(); resize();
  try {
    const ff = new FontFace('FP', 'url(assets/fp12.woff)');
    await Promise.race([ff.load().then(f => document.fonts.add(f)), new Promise(r => setTimeout(r, 1500))]);
  } catch (e) {}
  go(MapScene); schedule(0);                          // 首屏（地图）不等鱼图
  setTimeout(() => loadImages().then(() => { dirty = true; }), 0);   // 鱼精灵后台懒加载
  window.ADAO = { get save() { return save; }, get scene() { return scene; }, Trip, MapScene, Dex, go, persist, holding: () => holding('reel'), get lowFx() { return lowFx; }, get loopState() { return { rafId, timerId, hiddenState, renders }; } };
}
boot();
})();
