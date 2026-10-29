"use strict";

/* =====================================================================
   Duell am See
   Wer die Seite zuerst öffnet, ist "Host": sein Browser rechnet das Spiel
   und schickt den Zustand an alle anderen. Verbindung per WebRTC (PeerJS).
   ===================================================================== */

/* ---------------- Einstellungen ---------------- */
const params = new URLSearchParams(location.search);
const ROOM = ((params.get("raum") || "haupt").toLowerCase().replace(/[^a-z0-9-]/g, "")) || "haupt";
const HOST_ID = "duell-am-see-x7k2q-" + ROOM;
const PEER_OPTS = { debug: 0 };

const W = 960, H = 540, GROUND = 470, GRAVITY = 0.8;
const ROLES = ["ihn", "sie"];
const KEY = { L: 1, R: 2, U: 4, P: 8, K: 16, B: 32 };
const TAP = { U: 0, P: 1, K: 2 };              // Tasten, bei denen ein kurzer Druck zählt
const TAP_BITS = [KEY.U, KEY.P, KEY.K];
const ATK = [null, "punch", "kick"];

const CHARS = {
  ihn: {
    label: "ER", height: 180, width: 30, speed: 4.2, jump: 14.5, build: 1.1,
    punch: { startup: 6, active: 4, recover: 10, reach: 66, dmg: 7, h: 0.80 },
    kick:  { startup: 10, active: 5, recover: 16, reach: 86, dmg: 11, h: 0.50 },
    colors: { skin: "#e8b48a", hair: "#4a3020", top: "#1f4e79", trim: "#f2f2f2",
              legs: "#4f75a6", shoes: "#6b4423", sleeve: "short" }
  },
  sie: {
    label: "SIE", height: 150, width: 24, speed: 5.3, jump: 15.5, build: 0.92,
    punch: { startup: 4, active: 4, recover: 8, reach: 54, dmg: 6, h: 0.80 },
    kick:  { startup: 8, active: 5, recover: 13, reach: 72, dmg: 10, h: 0.50 },
    colors: { skin: "#f0c6a0", hair: "#17110f", top: "#f6f1e7", trim: "#ddd3c0",
              legs: "#3b3f48", shoes: "#141414", sleeve: "long" }
  }
};

/* ---------------- Netz-Zustand ---------------- */
let peer = null, isHost = false, myRole = null, prevRole = null, queuePos = 0;
let hostConn = null, lastHostMsg = 0, lost = false, statusText = "Verbinde mit der Arena…";
let net = null;                                  // letzter empfangener Zustand (Zuschauer/Gast)
const clients = [];                              // nur Host: verbundene Gäste

/* ---------------- Eingabe ---------------- */
let localKeys = 0, sentKeys = -1;
const localCnt = [0, 0, 0];
let localUsed = [0, 0, 0];

function press(name) {
  const bit = KEY[name];
  if (localKeys & bit) return;
  localKeys |= bit;
  if (TAP[name] !== undefined) localCnt[TAP[name]]++;
  sendKeys();
}
function release(name) {
  localKeys &= ~KEY[name];
  sendKeys();
}
function releaseAll() {
  localKeys = 0;
  document.querySelectorAll("#controls button.on").forEach(b => b.classList.remove("on"));
  sendKeys();
}

function sendKeys(force) {
  if (isHost || !hostConn || !hostConn.open) return;
  if (force || localKeys !== sentKeys) {
    safeSend(hostConn, { t: "i", k: localKeys, c: localCnt });
    sentKeys = localKeys;
  }
}

const KEYMAP = {
  ArrowLeft: "L", KeyA: "L", ArrowRight: "R", KeyD: "R",
  ArrowUp: "U", KeyW: "U", Space: "U",
  KeyJ: "P", KeyF: "P", KeyK: "K", KeyG: "K",
  KeyL: "B", KeyS: "B", ArrowDown: "B"
};
addEventListener("keydown", e => {
  const k = KEYMAP[e.code]; if (!k) return;
  e.preventDefault();
  if (!e.repeat) press(k);
});
addEventListener("keyup", e => {
  const k = KEYMAP[e.code]; if (!k) return;
  e.preventDefault(); release(k);
});
addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });

document.querySelectorAll("#controls button").forEach(btn => {
  const k = btn.dataset.k;
  const on = e => {
    e.preventDefault();
    btn.classList.add("on");
    press(k);
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const off = e => {
    e.preventDefault();
    if (!btn.classList.contains("on")) return;
    btn.classList.remove("on");
    release(k);
  };
  btn.addEventListener("pointerdown", on);
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(ev => btn.addEventListener(ev, off));
  btn.addEventListener("contextmenu", e => e.preventDefault());
});
document.addEventListener("touchmove", e => e.preventDefault(), { passive: false });
document.addEventListener("dblclick", e => e.preventDefault());

/* Vollbild (vor allem Android) */
const fsBtn = document.getElementById("fs");
if (!document.documentElement.requestFullscreen) fsBtn.style.display = "none";
fsBtn.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      await document.documentElement.requestFullscreen();
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(() => {});
    }
  } catch (_) {}
});

/* =====================================================================
   Spiellogik (läuft nur beim Host)
   ===================================================================== */
let game = null;

function newFighter(role) {
  return {
    role, x: role === "ihn" ? 320 : 640, y: 0, vx: 0, vy: 0,
    face: role === "ihn" ? 1 : -1, hp: 100,
    atk: 0, t: 0, hitDone: false, hurt: 0, block: false, ko: false, walk: 0, prev: 0
  };
}
function newGame() {
  return { f: { ihn: newFighter("ihn"), sie: newFighter("sie") }, wins: { ihn: 0, sie: 0 },
           over: false, timer: 0, winner: null, fx: [] };
}
function resetRound() {
  game.f = { ihn: newFighter("ihn"), sie: newFighter("sie") };
  game.over = false; game.timer = 0; game.winner = null; game.fx = [];
}

function roleTaken(r) {
  return (isHost && myRole === r) || clients.some(c => c.role === r);
}

function tapsFrom(cnt, used) {
  let bits = 0;
  for (let i = 0; i < 3; i++) if ((cnt[i] | 0) > (used[i] | 0)) bits |= TAP_BITS[i];
  return bits;
}

function inputFor(role) {
  if (role === myRole) {
    const taps = tapsFrom(localCnt, localUsed);
    localUsed = localCnt.slice();
    return { k: localKeys, taps };
  }
  const c = clients.find(c => c.role === role);
  if (!c) return { k: 0, taps: 0 };
  const taps = tapsFrom(c.cnt, c.used);
  c.used = c.cnt.slice();
  return { k: c.keys, taps };
}

function stepFighter(f, o, inp) {
  const c = CHARS[f.role];
  const k = inp.k;
  const pressed = b => !!(inp.taps & b);
  const grounded = f.y <= 0;

  if (f.ko) {
    if (grounded) f.vx *= 0.8;
  } else if (f.hurt > 0) {
    f.hurt--;
    if (grounded) f.vx *= 0.82;
    f.block = false;
  } else if (f.atk) {
    f.t++;
    const m = c[ATK[f.atk]];
    if (grounded) f.vx = 0;
    if (f.t >= m.startup + m.active + m.recover) { f.atk = 0; f.t = 0; }
  } else {
    f.block = !!(k & KEY.B) && grounded;
    const dir = ((k & KEY.R) ? 1 : 0) - ((k & KEY.L) ? 1 : 0);
    if (grounded) {
      f.vx = f.block ? 0 : dir * c.speed;
      if (dir && !f.block) f.walk += 0.22; else f.walk = 0;
      if (pressed(KEY.U) && !f.block) { f.vy = c.jump; f.vx = dir * c.speed * 1.1; }
    }
    if (pressed(KEY.P)) { f.atk = 1; f.t = 0; f.hitDone = false; f.block = false; }
    else if (pressed(KEY.K)) { f.atk = 2; f.t = 0; f.hitDone = false; f.block = false; }
  }

  if (o && !f.atk && grounded && !f.ko && !f.hurt) f.face = o.x >= f.x ? 1 : -1;

  f.x += f.vx;
  if (f.y > 0 || f.vy > 0) {
    f.vy -= GRAVITY; f.y += f.vy;
    if (f.y <= 0) { f.y = 0; f.vy = 0; }
  }
  f.x = Math.max(45, Math.min(W - 45, f.x));
}

function checkHit(a, d) {
  if (!a.atk || a.hitDone || a.ko) return;
  const c = CHARS[a.role], m = c[ATK[a.atk]], dc = CHARS[d.role];
  if (a.t < m.startup || a.t >= m.startup + m.active) return;
  const dx = (d.x - a.x) * a.face;
  if (dx <= 0 || dx > m.reach + dc.width) return;
  const strikeY = a.y + c.height * m.h;
  if (strikeY < d.y - 10 || strikeY > d.y + dc.height + 10) return;

  a.hitDone = true;
  if (d.ko) return;
  const blocked = d.block && d.y === 0 && d.face === -a.face;
  const dmg = blocked ? Math.max(1, Math.round(m.dmg * 0.15)) : m.dmg;
  d.hp = Math.max(0, d.hp - dmg);
  d.vx = a.face * (blocked ? 3 : 7);
  game.fx.push({ x: a.x + a.face * Math.min(dx, m.reach) * 0.9, y: strikeY, t: 0, b: blocked ? 1 : 0, big: a.atk === 2 ? 1 : 0 });

  if (!blocked) {
    d.hurt = 16; d.atk = 0; d.t = 0; d.block = false;
    if (d.y > 0) d.vy = Math.max(d.vy, 4);
  }
  if (d.hp === 0) {
    d.ko = true; d.hurt = 0; d.atk = 0; d.vy = 6; d.vx = a.face * 5;
    game.over = true; game.timer = 0; game.winner = a.role; game.wins[a.role]++;
  }
}

function step() {
  const g = game;
  const both = roleTaken("ihn") && roleTaken("sie");
  for (const r of ROLES) {
    const f = g.f[r], o = g.f[r === "ihn" ? "sie" : "ihn"];
    const inp = inputFor(r);
    const active = roleTaken(r) && !g.over;
    stepFighter(f, both ? o : null, active ? inp : { k: 0, taps: 0 });
  }
  if (both) {
    const a = g.f.ihn, b = g.f.sie;
    const minD = CHARS.ihn.width + CHARS.sie.width;
    const dx = b.x - a.x;
    if (Math.abs(dx) < minD && Math.abs(a.y - b.y) < 120 && !a.ko && !b.ko) {
      const push = (minD - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1);
      a.x = Math.max(45, Math.min(W - 45, a.x - push));
      b.x = Math.max(45, Math.min(W - 45, b.x + push));
    }
    checkHit(a, b);
    checkHit(b, a);
  }
  for (const e of g.fx) e.t++;
  g.fx = g.fx.filter(e => e.t < 18);
  if (g.over && ++g.timer > 210) resetRound();
}

function packF(f) {
  return [Math.round(f.x), Math.round(f.y), f.face, f.hp, f.atk, f.t, f.hurt,
          f.block ? 1 : 0, f.ko ? 1 : 0, Math.round(f.walk * 100) / 100];
}
function makeSnap() {
  return {
    t: "s",
    f: { ihn: roleTaken("ihn") ? packF(game.f.ihn) : null, sie: roleTaken("sie") ? packF(game.f.sie) : null },
    w: [game.wins.ihn, game.wins.sie],
    o: game.over ? 1 : 0, wn: game.winner,
    fx: game.fx.map(e => [Math.round(e.x), Math.round(e.y), e.t, e.b, e.big]),
    n: clients.filter(c => c.role === "zuschauer").length
  };
}
function unpackF(role, a) {
  return { role, x: a[0], y: a[1], face: a[2], hp: a[3], atk: a[4], t: a[5], hurt: a[6],
           block: !!a[7], ko: !!a[8], walk: a[9] };
}

/* =====================================================================
   Verbindung
   ===================================================================== */
function safeSend(conn, msg) {
  try { if (conn && conn.open) conn.send(msg); } catch (_) {}
}

function setStatus(t) { statusText = t; }

function updateUI() {
  const player = myRole === "ihn" || myRole === "sie";
  document.body.classList.toggle("is-player", player);
  document.body.classList.toggle("is-spectator", !!myRole && !player);
  document.body.classList.toggle("is-connecting", !myRole);
  if (!player) releaseAll();
}

function connect() {
  if (typeof Peer === "undefined") { setStatus("Verbindungsbibliothek fehlt."); return; }
  setStatus("Verbinde mit der Arena…");
  isHost = false; net = null;
  const p = new Peer(HOST_ID, PEER_OPTS);
  peer = p;
  p.on("open", () => { if (peer === p) becomeHost(); });
  p.on("error", e => {
    if (peer !== p) return;
    if (e.type === "unavailable-id") { try { p.destroy(); } catch (_) {} joinAsClient(); }
    else if (!isHost) netError(e);
    else console.warn("Peer-Fehler (Host):", e.type);
  });
  p.on("disconnected", () => { if (peer === p && isHost && !p.destroyed) p.reconnect(); });
}

let simTimer = null;
function becomeHost() {
  isHost = true;
  myRole = (prevRole === "ihn" || prevRole === "sie") ? prevRole : "ihn";
  prevRole = myRole; queuePos = 0;
  game = newGame();
  clients.length = 0;
  localUsed = localCnt.slice();
  setStatus("");
  updateUI();

  peer.on("connection", conn => {
    const c = { conn, role: "zuschauer", keys: 0, cnt: [0, 0, 0], used: [0, 0, 0], last: Date.now(), sentRole: null, sentQ: -1 };
    conn.on("open", () => { c.last = Date.now(); clients.push(c); assignRoles(); });
    conn.on("data", d => {
      c.last = Date.now();
      if (!d || typeof d !== "object") return;
      if (d.t === "i") {
        c.keys = d.k | 0;
        if (Array.isArray(d.c)) c.cnt = d.c.slice(0, 3).map(v => v | 0);
        if (c.role === "zuschauer") c.used = c.cnt.slice();
      } else if (d.t === "bye") drop(c);
    });
    conn.on("close", () => drop(c));
    conn.on("error", () => drop(c));
  });

  clearInterval(simTimer);
  let n = 0;
  simTimer = setInterval(() => {
    step();
    n++;
    if (n % 2 === 0) {
      const s = makeSnap();
      for (const c of clients) safeSend(c.conn, s);
    }
    if (n % 60 === 0) {
      const now = Date.now();
      clients.filter(c => now - c.last > 7000).forEach(drop);
    }
  }, 1000 / 60);
}

function assignRoles() {
  let changed = false;
  for (const r of ROLES) {
    if (roleTaken(r)) continue;
    const cand = clients.find(c => c.role === "zuschauer");
    if (cand) { cand.role = r; cand.used = cand.cnt.slice(); changed = true; }
  }
  let q = 0;
  for (const c of clients) {
    const pos = c.role === "zuschauer" ? ++q : 0;
    if (c.sentRole !== c.role || c.sentQ !== pos) {
      safeSend(c.conn, { t: "role", role: c.role, q: pos });
      c.sentRole = c.role; c.sentQ = pos;
    }
  }
  if (changed) { game.wins = { ihn: 0, sie: 0 }; resetRound(); }
}

function drop(c) {
  const i = clients.indexOf(c);
  if (i < 0) return;
  clients.splice(i, 1);
  try { c.conn.close(); } catch (_) {}
  if (c.role !== "zuschauer") { game.wins = { ihn: 0, sie: 0 }; resetRound(); }
  assignRoles();
}

function joinAsClient() {
  isHost = false;
  myRole = null;
  updateUI();
  setStatus("Betrete die Arena…");
  const p = new Peer(PEER_OPTS);
  peer = p;
  p.on("open", () => {
    if (peer !== p) return;
    const conn = p.connect(HOST_ID, { serialization: "json", reliable: true });
    hostConn = conn; lastHostMsg = Date.now();
    conn.on("open", () => { lastHostMsg = Date.now(); sentKeys = -1; sendKeys(true); });
    conn.on("data", onHostData);
    conn.on("close", () => { if (hostConn === conn) hostLost(); });
    conn.on("error", () => { if (hostConn === conn) hostLost(); });
  });
  p.on("error", e => {
    if (peer !== p) return;
    if (e.type === "peer-unavailable") hostLost();
    else netError(e);
  });
}

function onHostData(d) {
  lastHostMsg = Date.now();
  if (!d || typeof d !== "object") return;
  if (d.t === "s") { net = d; if (statusText) setStatus(""); }
  else if (d.t === "role") {
    myRole = d.role; queuePos = d.q || 0;
    if (myRole === "ihn" || myRole === "sie") prevRole = myRole;
    else prevRole = null;
    updateUI();
  }
  else if (d.t === "bye") hostLost();
}

function hostLost() {
  if (lost || isHost) return;
  lost = true;
  const wasPlayer = prevRole === "ihn" || prevRole === "sie";
  try { if (hostConn) hostConn.close(); } catch (_) {}
  hostConn = null; net = null;
  try { if (peer) peer.destroy(); } catch (_) {}
  peer = null;
  myRole = null; updateUI();
  setStatus("Verbindung wird neu aufgebaut…");
  // Spieler versuchen sofort zu übernehmen, Zuschauer etwas später
  setTimeout(() => { lost = false; connect(); }, wasPlayer ? 300 : 1500 + Math.random() * 2000);
}

function netError(e) {
  console.warn("Verbindungsfehler:", e && e.type);
  if (lost) return;
  lost = true;
  setStatus("Verbindungsproblem – neuer Versuch…");
  try { if (peer) peer.destroy(); } catch (_) {}
  peer = null; hostConn = null; isHost = false; myRole = null; updateUI();
  setTimeout(() => { lost = false; connect(); }, 3000);
}

/* Herzschlag & Wächter */
setInterval(() => {
  if (!isHost && hostConn) {
    sendKeys(true);
    if (Date.now() - lastHostMsg > 6000) hostLost();
  }
}, 1000);

addEventListener("pagehide", () => {
  try {
    if (isHost) for (const c of clients) safeSend(c.conn, { t: "bye" });
    else if (hostConn) safeSend(hostConn, { t: "bye" });
    if (peer) peer.destroy();
  } catch (_) {}
});
addEventListener("pageshow", e => { if (e.persisted) location.reload(); });

/* =====================================================================
   Zeichnen
   ===================================================================== */
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
}
addEventListener("resize", resize);
addEventListener("orientationchange", () => setTimeout(resize, 200));

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, k) => a + (b - a) * k;
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = v => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

/* ---------- Hintergrund (einmal vorgezeichnet) ---------- */
const HORIZON = 330;
const bg = document.createElement("canvas");
bg.width = W * 2; bg.height = H * 2;
(function paintBackground() {
  const g = bg.getContext("2d");
  g.scale(2, 2);
  const R = rng(7);

  // Himmel
  const sky = g.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, "#1d1b4b");
  sky.addColorStop(0.35, "#53397a");
  sky.addColorStop(0.62, "#c35b7c");
  sky.addColorStop(0.84, "#f2945f");
  sky.addColorStop(1, "#ffd08a");
  g.fillStyle = sky; g.fillRect(0, 0, W, HORIZON);

  // Sterne
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,255,255,${0.2 + R() * 0.5})`;
    g.fillRect(R() * W, R() * 110, 1.4, 1.4);
  }

  // Sonne
  const sx = 690, sy = 300;
  const glow = g.createRadialGradient(sx, sy, 20, sx, sy, 200);
  glow.addColorStop(0, "rgba(255,220,150,.55)");
  glow.addColorStop(1, "rgba(255,220,150,0)");
  g.fillStyle = glow; g.fillRect(0, 0, W, HORIZON);
  const sun = g.createRadialGradient(sx, sy - 10, 5, sx, sy, 58);
  sun.addColorStop(0, "#fff7dc"); sun.addColorStop(1, "#ffbf63");
  g.fillStyle = sun; g.beginPath(); g.arc(sx, sy, 58, 0, Math.PI * 2); g.fill();

  // Berge
  function ridge(base, amp, f1, f2, f3, p, color) {
    g.fillStyle = color; g.beginPath(); g.moveTo(0, HORIZON);
    for (let x = 0; x <= W; x += 6) {
      const n = Math.sin(x * f1 + p) * 0.6 + Math.sin(x * f2 + p * 2.3) * 0.3 + Math.sin(x * f3 + p * 0.7) * 0.1;
      g.lineTo(x, base - amp * (0.5 + 0.5 * n));
    }
    g.lineTo(W, HORIZON); g.closePath(); g.fill();
  }
  ridge(250, 120, 0.006, 0.017, 0.05, 1.3, "rgba(150,92,140,.75)");
  ridge(285, 95, 0.008, 0.021, 0.06, 4.1, "#6a4072");
  ridge(312, 60, 0.011, 0.03, 0.08, 2.2, "#3d2a55");

  // Ufer-Baumlinie
  g.fillStyle = "#24183a";
  g.beginPath(); g.moveTo(0, HORIZON + 4);
  for (let x = 0; x <= W; x += 5) g.lineTo(x, HORIZON - 4 - R() * 9 * (0.4 + 0.6 * Math.abs(Math.sin(x * 0.02))));
  g.lineTo(W, HORIZON + 4); g.closePath(); g.fill();

  // See
  const lake = g.createLinearGradient(0, HORIZON, 0, 432);
  lake.addColorStop(0, "#e4936f"); lake.addColorStop(0.45, "#8d5582"); lake.addColorStop(1, "#2c2347");
  g.fillStyle = lake; g.fillRect(0, HORIZON, W, 102);
  for (let i = 0; i < 26; i++) {
    const y = HORIZON + 4 + i * 3.6;
    const w = 90 - i * 2.6 + R() * 20;
    g.fillStyle = `rgba(255,215,160,${0.55 - i * 0.018})`;
    g.fillRect(sx - w / 2 + (R() - 0.5) * 14, y, w, 1.6);
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(255,255,255,${0.04 + R() * 0.06})`;
    g.fillRect(R() * W, HORIZON + 6 + R() * 92, 10 + R() * 40, 1);
  }

  // Holzsteg
  const deck = g.createLinearGradient(0, 430, 0, H);
  deck.addColorStop(0, "#7a5236"); deck.addColorStop(1, "#3a2518");
  g.fillStyle = deck; g.fillRect(0, 430, W, H - 430);
  g.strokeStyle = "rgba(0,0,0,.28)"; g.lineWidth = 1.5;
  const vp = W / 2;
  for (let x = -600; x <= W + 600; x += 70) {
    g.beginPath(); g.moveTo(vp + (x - vp) * 0.62, 432); g.lineTo(x, H); g.stroke();
  }
  for (const y of [452, 480, 514]) {
    g.strokeStyle = "rgba(0,0,0,.12)"; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  g.fillStyle = "#a0714a"; g.fillRect(0, 429, W, 3);
  // Pfosten
  for (const x of [130, 330, 630, 830]) {
    g.fillStyle = "#4a2f1e"; g.fillRect(x - 5, 400, 10, 32);
    g.fillStyle = "#6d4a30"; g.fillRect(x - 6, 398, 12, 4);
  }

  // Kirschbäume
  function tree(x, dir) {
    g.strokeStyle = "#2a1a1f"; g.lineCap = "round";
    const branch = (x1, y1, a, len, w, depth) => {
      const x2 = x1 + Math.sin(a) * len, y2 = y1 - Math.cos(a) * len;
      g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      if (depth > 0) {
        branch(x2, y2, a - 0.45 - R() * 0.2, len * 0.72, w * 0.68, depth - 1);
        branch(x2, y2, a + 0.35 + R() * 0.25, len * 0.7, w * 0.66, depth - 1);
      } else blossoms.push([x2, y2]);
    };
    const blossoms = [];
    branch(x, H, dir * 0.12, 150, 22, 4);
    const cols = ["#f7a8c4", "#f2c4d6", "#e98fb0", "#ffd3e2"];
    for (const [bx, by] of blossoms) {
      for (let i = 0; i < 14; i++) {
        g.fillStyle = cols[(R() * cols.length) | 0];
        g.globalAlpha = 0.75 + R() * 0.25;
        g.beginPath(); g.arc(bx + (R() - 0.5) * 50, by + (R() - 0.5) * 40, 6 + R() * 10, 0, Math.PI * 2); g.fill();
      }
    }
    g.globalAlpha = 1;
  }
  tree(30, 1);
  tree(W - 30, -1);
})();

/* Laternen an den Bäumen */
const LANTERNS = [[118, 238], [842, 232]];

/* Blüten & Wolken */
const PETALS = Array.from({ length: 22 }, (_, i) => {
  const r = rng(100 + i);
  return { x: r() * W, y: r() * H, s: 0.4 + r() * 0.8, p: r() * 6.28, c: r() < 0.5 ? "#f7b6cc" : "#ffd6e4" };
});
const CLOUDS = [[100, 70, 1], [420, 120, 0.7], [760, 60, 0.9], [980, 150, 0.6]];

function drawScene(time) {
  ctx.drawImage(bg, 0, 0, W, H);

  // Wolken
  for (const [cx, cy, s] of CLOUDS) {
    const x = ((cx + time * 0.006 * s) % (W + 300)) - 150;
    ctx.fillStyle = "rgba(255,210,220,.18)";
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.ellipse(x + i * 34 * s, cy + Math.sin(i) * 6, 46 * s, 14 * s, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Glitzern auf dem See
  for (let i = 0; i < 14; i++) {
    const a = 0.5 + 0.5 * Math.sin(time * 0.003 + i * 1.7);
    ctx.fillStyle = `rgba(255,236,200,${a * 0.45})`;
    ctx.fillRect(650 + Math.sin(i * 3.1) * 50, HORIZON + 8 + i * 6.5, 8 + (i % 4) * 4, 1.5);
  }

  // Laternen
  for (const [lx, ly] of LANTERNS) {
    const sway = Math.sin(time * 0.0015 + lx) * 3;
    ctx.strokeStyle = "#2a1a1f"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(lx, ly - 22); ctx.lineTo(lx + sway, ly); ctx.stroke();
    const gl = ctx.createRadialGradient(lx + sway, ly + 14, 2, lx + sway, ly + 14, 46);
    gl.addColorStop(0, "rgba(255,170,80,.45)"); gl.addColorStop(1, "rgba(255,170,80,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(lx + sway, ly + 14, 46, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e5502b";
    ctx.beginPath(); ctx.ellipse(lx + sway, ly + 14, 11, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffcf7a";
    ctx.beginPath(); ctx.ellipse(lx + sway, ly + 14, 5, 10, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawPetals(time) {
  for (const p of PETALS) {
    const y = (p.y + time * 0.035 * p.s) % (H + 20) - 10;
    const x = (p.x + time * 0.02 * p.s + Math.sin(time * 0.001 + p.p) * 30 + W) % W;
    ctx.save(); ctx.translate(x, y); ctx.rotate(time * 0.002 * p.s + p.p);
    ctx.fillStyle = p.c; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 2.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

/* ---------- Figuren ---------- */
function pose(F, winner, time) {
  const c = CHARS[F.role];
  const P = { fT: 0.22, fS: 0.04, bT: -0.22, bS: -0.34, fU: 0.62, fL: 2.55, bU: 0.32, bL: 2.68, lean: 0.05, bob: 0, rot: 0 };
  P.bob = Math.sin(time * 0.006 + (F.role === "sie" ? 1 : 0)) * 1.2;

  if (F.ko) {
    Object.assign(P, { rot: -1.45, fU: 2.7, fL: 2.9, bU: 2.4, bL: 2.8, fT: 0.12, fS: 0.05, bT: -0.06, bS: -0.1, lean: 0, bob: 0 });
    return P;
  }
  if (winner) {
    const j = Math.abs(Math.sin(time * 0.008)) * 4;
    Object.assign(P, { fU: 2.95, fL: 3.05, bU: 2.75, bL: 3.1, lean: 0, bob: -j });
    return P;
  }
  if (F.hurt > 0) {
    Object.assign(P, { lean: -0.3, fU: 0.3, fL: 1.1, bU: -0.25, bL: 0.4 });
  } else if (F.block) {
    Object.assign(P, { fU: 1.25, fL: 2.95, bU: 1.0, bL: 3.05, lean: -0.08 });
    P.fT = 0.3; P.fS = -0.05; P.bT = -0.3; P.bS = -0.45;
  } else if (F.y > 0 && !F.atk) {
    Object.assign(P, { fT: 1.0, fS: 0.05, bT: 0.35, bS: -0.55, fU: 0.9, fL: 2.4, bU: 0.6, bL: 2.6 });
  } else if (F.walk > 0) {
    const s = Math.sin(F.walk), cw = Math.cos(F.walk);
    P.fT = 0.12 + 0.42 * s; P.fS = P.fT - 0.12 - 0.35 * Math.max(0, cw);
    P.bT = 0.12 - 0.42 * s; P.bS = P.bT - 0.12 - 0.35 * Math.max(0, -cw);
    P.bob = -Math.abs(s) * 2;
  }

  if (F.atk) {
    const m = c[ATK[F.atk]];
    const t = F.t;
    const wind = t < m.startup ? t / m.startup : 0;
    const e = t < m.startup ? 0 : t < m.startup + m.active ? 1 : Math.max(0, 1 - (t - m.startup - m.active) / m.recover);
    if (F.atk === 1) {
      P.fU = lerp(0.62 - 0.3 * wind, 1.57, e);
      P.fL = lerp(2.55 - 0.3 * wind, 1.57, e);
      P.bU = lerp(0.32, 0.15, e); P.bL = lerp(2.68, 2.9, e);
      P.lean = lerp(0.05, 0.2, e);
    } else {
      const chamberT = lerp(0.22, 1.15, wind), chamberS = lerp(0.04, -0.3, wind);
      P.fT = lerp(chamberT, 1.52, e); P.fS = lerp(chamberS, 1.57, e);
      P.bT = -0.1; P.bS = -0.12;
      P.lean = -0.2 * Math.max(e, wind);
      P.fU = 0.95; P.fL = 2.1; P.bU = -0.45; P.bL = 0.1;
    }
  }
  return P;
}

function limb(p1, p2, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
}
const seg = (p, a, len) => ({ x: p.x + Math.sin(a) * len, y: p.y + Math.cos(a) * len });
const mix = (p, q, k) => ({ x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k) });

function drawFighter(F, winner, time) {
  const c = CHARS[F.role], h = c.height, col = c.colors, b = c.build;
  const P = pose(F, winner, time);

  // Schatten
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${0.32 - Math.min(0.2, F.y / 600)})`;
  ctx.beginPath(); ctx.ellipse(F.x, GROUND + 2, (F.ko ? 70 : 34) * b - F.y * 0.05, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(F.x, GROUND - F.y);
  ctx.scale(F.face, 1);
  if (P.rot) ctx.rotate(P.rot);

  const thigh = h * 0.245, shin = h * 0.235, T = h * 0.29, ua = h * 0.17, la = h * 0.16, headR = h * 0.068;
  const legV = (a, s) => thigh * Math.cos(a) + shin * Math.cos(s);
  const hip = { x: 0, y: -Math.max(legV(P.fT, P.fS), legV(P.bT, P.bS)) + P.bob };
  const kneeF = seg(hip, P.fT, thigh), footF = seg(kneeF, P.fS, shin);
  const kneeB = seg(hip, P.bT, thigh), footB = seg(kneeB, P.bS, shin);
  const sh = { x: hip.x + Math.sin(P.lean) * T, y: hip.y - Math.cos(P.lean) * T };
  const elbF = seg(sh, P.fU + P.lean, ua), handF = seg(elbF, P.fL + P.lean, la);
  const elbB = seg(sh, P.bU + P.lean, ua), handB = seg(elbB, P.bL + P.lean, la);
  const neckLen = h * 0.035;
  const head = { x: sh.x + Math.sin(P.lean) * (neckLen + headR), y: sh.y - Math.cos(P.lean) * (neckLen + headR) };

  const legW = h * 0.078 * b, armW = h * 0.052 * b;

  function leg(knee, foot, sA, back) {
    const clr = back ? shade(col.legs, 0.78) : col.legs;
    limb(hip, knee, legW, clr);
    limb(knee, foot, legW * 0.88, clr);
    const dx = Math.cos(sA), dy = -Math.sin(sA);
    ctx.strokeStyle = back ? shade(col.shoes, 0.8) : col.shoes;
    ctx.lineWidth = h * 0.04; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(foot.x - dx * 3, foot.y - dy * 3); ctx.lineTo(foot.x + dx * h * 0.07, foot.y + dy * h * 0.07); ctx.stroke();
  }
  function arm(elb, hand, back) {
    const f = back ? 0.82 : 1;
    const top = shade(col.top, f), skin = shade(col.skin, back ? 0.88 : 1);
    if (col.sleeve === "short") {
      const m = mix(sh, elb, 0.55);
      limb(sh, m, armW * 1.15, top);
      limb(m, elb, armW * 0.9, skin);
      limb(elb, hand, armW * 0.82, skin);
    } else {
      limb(sh, elb, armW, top);
      limb(elb, hand, armW * 0.88, top);
      const cuff = mix(elb, hand, 0.88);
      limb(cuff, mix(elb, hand, 0.95), armW * 0.95, shade(col.trim, f));
    }
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(hand.x, hand.y, armW * 0.62, 0, Math.PI * 2); ctx.fill();
  }

  // Haare hinten (sie: Pferdeschwanz)
  if (F.role === "sie") {
    const tail = { x: head.x - headR * 1.05, y: head.y + headR * 0.1 };
    const swing = Math.sin(time * 0.01) * 0.15 + (F.vx ? -0.2 : 0);
    ctx.fillStyle = col.hair;
    ctx.save(); ctx.translate(tail.x, tail.y); ctx.rotate(0.35 + swing);
    ctx.beginPath(); ctx.ellipse(-2, headR * 0.9, headR * 0.42, headR * 1.05, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  arm(elbB, handB, true);
  leg(kneeB, footB, P.bS, true);

  // Oberkörper
  const n = { x: Math.cos(P.lean), y: Math.sin(P.lean) };
  const ws = h * 0.125 * b, wh = h * 0.1 * b;
  const hipLow = { x: hip.x - Math.sin(P.lean) * h * 0.03, y: hip.y + Math.cos(P.lean) * h * 0.03 };
  // Hose bis zur Hüfte
  ctx.fillStyle = col.legs;
  ctx.beginPath(); ctx.arc(hip.x, hip.y, wh * 0.55, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = col.top;
  ctx.strokeStyle = col.top; ctx.lineJoin = "round"; ctx.lineWidth = h * 0.03;
  const bottom = F.role === "ihn" ? hipLow : hip;
  ctx.beginPath();
  ctx.moveTo(sh.x + n.x * ws / 2, sh.y + n.y * ws / 2);
  ctx.lineTo(bottom.x + n.x * wh / 2, bottom.y + n.y * wh / 2);
  ctx.lineTo(bottom.x - n.x * wh / 2, bottom.y - n.y * wh / 2);
  ctx.lineTo(sh.x - n.x * ws / 2, sh.y - n.y * ws / 2);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  if (F.role === "ihn") {
    // Polo: Kragen + Knopfleiste
    ctx.fillStyle = col.trim;
    ctx.beginPath();
    ctx.moveTo(sh.x + n.x * ws * 0.1, sh.y - h * 0.012);
    ctx.lineTo(sh.x + n.x * ws * 0.62, sh.y + h * 0.012);
    ctx.lineTo(sh.x + n.x * ws * 0.25, sh.y + h * 0.04);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.75)";
    for (const k of [0.13, 0.2]) {
      const p = mix(sh, hip, k);
      ctx.beginPath(); ctx.arc(p.x + n.x * ws * 0.4, p.y + n.y * ws * 0.4, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    // Bluse: Kragen, Knöpfe, Bund der Anzughose
    ctx.fillStyle = col.trim;
    ctx.beginPath();
    ctx.moveTo(sh.x + n.x * ws * 0.05, sh.y - h * 0.01);
    ctx.lineTo(sh.x + n.x * ws * 0.6, sh.y + h * 0.008);
    ctx.lineTo(sh.x + n.x * ws * 0.3, sh.y + h * 0.045);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#c9bfa9";
    for (const k of [0.2, 0.42, 0.64]) {
      const p = mix(sh, hip, k);
      ctx.beginPath(); ctx.arc(p.x + n.x * ws * 0.42, p.y + n.y * ws * 0.42, 1.2, 0, Math.PI * 2); ctx.fill();
    }
    limb({ x: hip.x - n.x * wh * 0.5, y: hip.y - n.y * wh * 0.5 }, { x: hip.x + n.x * wh * 0.5, y: hip.y + n.y * wh * 0.5 }, h * 0.03, shade(col.legs, 0.8));
  }

  leg(kneeF, footF, P.fS, false);

  // Hals & Kopf
  limb(sh, head, h * 0.045, col.skin);
  ctx.fillStyle = col.skin;
  ctx.beginPath(); ctx.arc(head.x, head.y, headR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shade(col.skin, 0.88);
  ctx.beginPath(); ctx.arc(head.x - headR * 0.15, head.y + headR * 0.08, headR * 0.2, 0, Math.PI * 2); ctx.fill();

  // Haare oben
  ctx.fillStyle = col.hair;
  ctx.beginPath();
  if (F.role === "ihn") {
    ctx.arc(head.x, head.y, headR * 1.08, Math.PI * 0.92, Math.PI * 1.78);
    ctx.arc(head.x - headR * 0.05, head.y - headR * 0.05, headR * 0.82, Math.PI * 1.78, Math.PI * 0.92, true);
  } else {
    ctx.arc(head.x, head.y, headR * 1.12, Math.PI * 0.82, Math.PI * 1.82);
    ctx.arc(head.x - headR * 0.08, head.y + headR * 0.02, headR * 0.8, Math.PI * 1.82, Math.PI * 0.82, true);
  }
  ctx.closePath(); ctx.fill();

  // Auge
  const ex = head.x + headR * 0.5, ey = head.y - headR * 0.08;
  if (F.hurt > 0 || F.ko) {
    ctx.strokeStyle = "#2a1a14"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(ex - 3, ey - 3); ctx.lineTo(ex + 3, ey + 3); ctx.moveTo(ex + 3, ey - 3); ctx.lineTo(ex - 3, ey + 3); ctx.stroke();
  } else {
    ctx.fillStyle = "#2a1a14";
    ctx.beginPath(); ctx.arc(ex, ey, headR * 0.12, 0, Math.PI * 2); ctx.fill();
  }

  arm(elbF, handF, false);

  ctx.restore();
}

function drawFx(list) {
  for (const [x, y, t, blocked, big] of list) {
    const k = t / 18, r = (big ? 16 : 11) + 30 * k;
    ctx.save();
    ctx.translate(x, GROUND - y);
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = blocked ? "#9fd6ff" : "#ffe08a";
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + t * 0.05;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke();
    }
    ctx.fillStyle = blocked ? "rgba(160,215,255,.6)" : "rgba(255,240,190,.75)";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

/* ---------- Anzeige ---------- */
const hpShow = { ihn: 100, sie: 100 }, hpTrail = { ihn: 100, sie: 100 };

function textC(t, x, y, size, color, weight = 800, stroke = true) {
  ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (stroke) { ctx.lineWidth = size * 0.16; ctx.strokeStyle = "rgba(20,10,30,.85)"; ctx.lineJoin = "round"; ctx.strokeText(t, x, y); }
  ctx.fillStyle = color; ctx.fillText(t, x, y);
}

function drawHud(snap) {
  const bw = 340, bh = 20, y = 22;
  for (const role of ROLES) {
    const left = role === "ihn";
    const x0 = left ? 60 : W - 60 - bw;
    const present = !!snap.f[role];
    const hp = present ? snap.f[role][3] : 0;
    hpShow[role] = hp;
    hpTrail[role] = Math.max(hp, hpTrail[role] - 0.6);
    if (hpTrail[role] < hp) hpTrail[role] = hp;

    ctx.fillStyle = "rgba(15,8,25,.75)";
    ctx.fillRect(x0 - 3, y - 3, bw + 6, bh + 6);
    ctx.fillStyle = "#3a1020"; ctx.fillRect(x0, y, bw, bh);
    const wT = bw * hpTrail[role] / 100, wH = bw * hp / 100;
    ctx.fillStyle = "#fff2d0";
    ctx.fillRect(left ? x0 : x0 + bw - wT, y, wT, bh);
    const gr = ctx.createLinearGradient(0, y, 0, y + bh);
    if (hp > 30) { gr.addColorStop(0, "#ffe27a"); gr.addColorStop(1, "#e89a2a"); }
    else { gr.addColorStop(0, "#ff8a6a"); gr.addColorStop(1, "#c8321e"); }
    ctx.fillStyle = gr;
    ctx.fillRect(left ? x0 : x0 + bw - wH, y, wH, bh);
    ctx.strokeStyle = "#e8c26b"; ctx.lineWidth = 2; ctx.strokeRect(x0 - 1, y - 1, bw + 2, bh + 2);

    const name = CHARS[role].label + (myRole === role ? " (DU)" : "");
    ctx.font = `800 18px system-ui, sans-serif`;
    ctx.textAlign = left ? "left" : "right"; ctx.textBaseline = "top";
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(20,10,30,.85)";
    const nx = left ? x0 : x0 + bw;
    ctx.strokeText(name, nx, y + bh + 7);
    ctx.fillStyle = present ? "#fff" : "rgba(255,255,255,.45)"; ctx.fillText(name, nx, y + bh + 7);

    // Siege
    const wins = snap.w[left ? 0 : 1];
    for (let i = 0; i < Math.min(wins, 9); i++) {
      const cx = left ? x0 + bw - 8 - i * 18 : x0 + 8 + i * 18;
      ctx.fillStyle = "#e8c26b";
      ctx.beginPath(); ctx.arc(cx, y + bh + 17, 6, 0, Math.PI * 2); ctx.fill();
    }
    if (wins > 9) textC("+" + (wins - 9), left ? x0 + bw - 8 - 9 * 18 : x0 + 8 + 9 * 18, y + bh + 17, 13, "#e8c26b");
  }
  // Mitte
  ctx.fillStyle = "rgba(15,8,25,.8)";
  ctx.beginPath(); ctx.arc(W / 2, 32, 26, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#e8c26b"; ctx.lineWidth = 2; ctx.stroke();
  textC("VS", W / 2, 33, 20, "#e8c26b", 900, false);
  if (snap.n > 0) textC(`👁 ${snap.n} ${snap.n === 1 ? "Zuschauer" : "Zuschauer"}`, W / 2, 74, 15, "rgba(255,255,255,.85)", 700);
}

function drawBanner(snap) {
  let msg;
  if (myRole === "ihn") msg = "Du spielst: ER";
  else if (myRole === "sie") msg = "Du spielst: SIE";
  else if (myRole === "zuschauer") msg = queuePos ? `Du schaust zu · Platz ${queuePos} in der Warteschlange` : "Du schaust zu";
  if (!msg) return;
  ctx.font = "700 15px system-ui, sans-serif";
  const w = ctx.measureText(msg).width + 28;
  const isPlayer = myRole === "ihn" || myRole === "sie";
  const by = isPlayer ? 112 : H - 26;
  ctx.fillStyle = "rgba(15,8,25,.6)";
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(W / 2 - w / 2, by - 14, w, 28, 14) : ctx.rect(W / 2 - w / 2, by - 14, w, 28); ctx.fill();
  textC(msg, W / 2, by + 1, 15, "#f5e9d6", 700, false);
}

/* ---------- Hauptschleife ---------- */
const disp = { ihn: null, sie: null };

function frame(time) {
  requestAnimationFrame(frame);
  if (cv.width < 2) resize();
  ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);

  const snap = isHost && game ? makeSnap() : net;

  // leichtes Wackeln bei harten Treffern
  let shake = 0;
  if (snap) for (const e of snap.fx) if (!e[3] && e[2] < 6) shake = e[4] ? 5 : 3;
  ctx.save();
  if (shake) ctx.translate((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2);

  drawScene(time);

  if (snap) {
    const list = [];
    for (const role of ROLES) {
      const a = snap.f[role];
      if (!a) { disp[role] = null; continue; }
      const F = unpackF(role, a);
      if (!isHost && disp[role] && Math.abs(disp[role].x - F.x) < 120) {
        F.x = lerp(disp[role].x, F.x, 0.5);
        F.y = lerp(disp[role].y, F.y, 0.6);
      }
      disp[role] = F;
      list.push(F);
    }
    // Angreifer zuletzt zeichnen
    list.sort((p, q) => (p.atk ? 1 : 0) - (q.atk ? 1 : 0));
    for (const F of list) drawFighter(F, snap.o && snap.wn === F.role, time);
    drawFx(snap.fx);
  }
  drawPetals(time);
  ctx.restore();

  if (snap) {
    drawHud(snap);
    const both = snap.f.ihn && snap.f.sie;
    if (snap.o) {
      textC("K.O.!", W / 2, H / 2 - 40, 84, "#ffe27a", 900);
      textC(`${CHARS[snap.wn].label} gewinnt die Runde`, W / 2, H / 2 + 22, 26, "#fff", 800);
    } else if (!both) {
      const missing = !snap.f.ihn ? "IHN" : "SIE";
      const pulse = 0.6 + 0.4 * Math.sin(time * 0.004);
      textC(`Warte auf ${missing}…`, W / 2, H / 2 - 30, 34, `rgba(255,255,255,${pulse})`, 800);
      textC("Schick den Link an jemanden, um zu kämpfen", W / 2, H / 2 + 10, 16, "rgba(255,255,255,.8)", 600);
    }
    drawBanner(snap);
  }
  if (statusText) {
    ctx.fillStyle = "rgba(10,6,20,.55)"; ctx.fillRect(0, H / 2 - 40, W, 80);
    textC(statusText, W / 2, H / 2, 26, "#fff", 700);
  }
}

resize();
requestAnimationFrame(frame);
connect();
