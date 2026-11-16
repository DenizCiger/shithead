/* SLAM SFX — two synthesized sound packs (arcade, lethal) behind one interface.
 * No audio files, no build step. Works on AudioContext and OfflineAudioContext.
 *
 *   var E   = SlamSfx.makeEngine(audioCtx, audioCtx.destination);
 *   var sfx = SlamSfx.buildPack(E, 'lethal');       // arcade | lethal
 *   sfx.hit(3);  sfx.hit(1, {pan:-0.6, opp:true});  sfx.burn({when:0.2});
 *
 * Every sound takes an optional trailing options object:
 *   pan  -1..1   stereo position (opponent seats: left -0.6, top 0, right 0.6)
 *   opp  bool    someone else's action: quieter, no ducking
 *   when seconds delay on the audio clock (never setTimeout inside a sound)
 */
(function (root) {
'use strict';

function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

// ---------------------------------------------------------------- mix policy
// Which bus a sound lives on. ui = quiet/tactile, big = the few loud moments, sfx = everything else.
var BUS = { hover: 'ui', raise: 'ui', lower: 'ui', invalid: 'ui', button: 'ui', deal: 'ui', draw: 'ui', swap: 'ui', ready: 'ui', turn: 'ui', count: 'ui',
  burn: 'big', fight: 'big', win: 'big', lose: 'big', take: 'big' };
// Bed ducking when a sound fires: [depth 0..1, hold s, release time-constant s]
var DUCK = { burn: [0.15, 0.7, 0.35], fight: [0.3, 0.4, 0.25], take: [0.4, 0.5, 0.3], win: [0.1, 2.2, 0.6], lose: [0.1, 2.2, 0.6], joker: [0.5, 0.4, 0.2] };
// Loudness targets per sound (dB, K-weighted, loudest 100 ms window, volume slider at max, intensity FULL).
// These are tiers on purpose: UI sits ~20 dB under a burn. Trims below make every pack land on them.
var TARGET = { hover: -38, button: -30, raise: -29, lower: -31, invalid: -23,
  deal: -30, draw: -29, swap: -28, ready: -26, turn: -23, count: -22,
  whoosh: -27, hit1: -19, hit2: -17, hit3: -15, hit4: -13,
  two: -20, three: -23, four: -20, seven: -18, eight: -20, jack: -19, joker: -17,
  take: -15, out0: -20, out1: -16, burn: -10, fight: -11, win: -13, lose: -14, bed: -30 };
// Per-pack trims that make each sound hit TARGET. Produced by __calibrate() on the audition page
// (OfflineAudioContext render -> measure -> gain), then pasted here. Regenerate after editing a sound.
var TRIM = /*TRIM-START*/{
  arcade: {hover:1.08, button:1.12, raise:1.49, lower:1.11, invalid:0.363, deal:1.43, draw:1.35, swap:1.88, ready:1.12, turn:1.37, count:0.817, whoosh:1.6, hit1:0.554, hit2:0.647, hit3:0.772, hit4:0.925, two:1.21, three:1.1, four:3.69, seven:0.556, eight:2.44, jack:1.26, joker:3.2, take:1.96, out0:2.07, out1:1.79, burn:0.472, fight:0.855, win:1.01, lose:1.99, bed:0.207},
  lethal: {hover:1.42, button:0.987, raise:0.867, lower:0.948, invalid:0.321, deal:1.4, draw:1.44, swap:0.879, ready:0.716, turn:1.14, count:1.45, whoosh:1.59, hit1:0.321, hit2:0.34, hit3:0.368, hit4:0.402, two:1.13, three:1.16, four:1.59, seven:0.193, eight:1.12, jack:0.461, joker:1.39, take:0.854, out0:1.27, out1:0.491, burn:0.35, fight:0.5, win:0.525, lose:0.39, bed:0.18}
}/*TRIM-END*/;

function trimKey(name, args) {
  if (name === 'hit') return 'hit' + clamp(Math.round(args[0] || 1), 1, 4);
  if (name === 'out') return 'out' + (args[0] ? 1 : 0);
  return name;
}

// ---------------------------------------------------------------- engine
function makeEngine(ctx, dest, opt) {
  opt = opt || {};
  var sr = ctx.sampleRate;
  var E = { ctx: ctx, I: 2, muted: false, _trim: 1, _pan: 0, _g: 1, _bus: 'sfx', rand: mulberry(opt.seed || 20261116), noTrim: !!opt.noTrim };
  function G(v) { var g = ctx.createGain(); g.gain.value = v; return g; }

  // master chain: buses -> pre -> tone(lowpass, intensity) -> vol -> soft clipper -> dest
  var pre = G(1), tone = ctx.createBiquadFilter(), vol = G(1), muteG = G(1), gate = G(1), half = G(0.5), clip = ctx.createWaveShaper();
  tone.type = 'lowpass'; tone.frequency.value = 20000; tone.Q.value = 0.5;
  (function () { // transparent below 0.7, then a tanh knee that saturates at 0.95 (headroom for 4x-oversampling overshoot). Input pre-scaled by 0.5 so x covers +-2.
    var n = 4097, c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var u = (i / (n - 1) * 2 - 1) * 2, a = Math.abs(u); c[i] = a <= 0.7 ? u : (u < 0 ? -1 : 1) * (0.7 + 0.25 * Math.tanh((a - 0.7) / 0.25)); }
    clip.curve = c; clip.oversample = '4x';
  })();
  pre.connect(tone); tone.connect(vol); vol.connect(muteG); muteG.connect(gate);
  if (opt.noLimit) gate.connect(dest); else { gate.connect(half); half.connect(clip); clip.connect(dest); }
  var duck = G(1); duck.connect(pre);
  E.bus = { ui: G(1), sfx: G(1), big: G(1), bed: G(1) };
  E.bus.ui.connect(pre); E.bus.sfx.connect(pre); E.bus.big.connect(pre); E.bus.bed.connect(duck);

  // tiny synthetic room for tails on the big moments
  var verbIn = G(1), verbRet = G(0.5), conv = ctx.createConvolver();
  (function () {
    var len = Math.floor(sr * 1.3), b = ctx.createBuffer(2, len, sr), r = mulberry(99);
    for (var c = 0; c < 2; c++) { var d = b.getChannelData(c), lp = 0; for (var i = 0; i < len; i++) { var x = (r() * 2 - 1) * Math.pow(1 - i / len, 3.2); lp += 0.45 * (x - lp); d[i] = lp; } }
    conv.buffer = b;
  })();
  verbIn.connect(conv); conv.connect(verbRet); verbRet.connect(pre);

  var NB = (function () { var len = sr * 2, b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0), r = mulberry(7); for (var i = 0; i < len; i++) d[i] = r() * 2 - 1; return b; })();
  var curves = {};
  function driveCurve(k) { if (curves[k]) return curves[k]; var n = 1025, c = new Float32Array(n), d = Math.tanh(k); for (var i = 0; i < n; i++) c[i] = Math.tanh(k * (i / (n - 1) * 2 - 1)) / d; return (curves[k] = c); }

  E.volume = 1;
  E.setVolume = function (v) { E.volume = v; vol.gain.setTargetAtTime(v * v, ctx.currentTime, 0.02); }; // squared: slider feels linear
  E.setIntensity = function (i) { // 0 MINIMAL, 1 REDUCED, 2 FULL — mirrors the slam demo's FX setting
    E.I = i; var t = ctx.currentTime;
    tone.frequency.setTargetAtTime([4500, 9000, 20000][i], t, 0.02);  // softer top end
    E.bus.big.gain.setTargetAtTime([0.45, 0.7, 1][i], t, 0.02);       // big moments shrink toward the rest
    E.bus.sfx.gain.setTargetAtTime([0.6, 0.8, 1][i], t, 0.02);
    verbRet.gain.setTargetAtTime([0, 0.25, 0.5][i], t, 0.02);         // no tails at MINIMAL
  };
  // Mute closes the output as well as blocking new sounds, so tails and anything already scheduled go quiet too.
  E.setMuted = function (m) { E.muted = !!m; muteG.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.008); };
  // Cut everything sounding or scheduled (sequence stop, pack switch, leaving a screen): 30 ms fade, stop the sources, reopen.
  var live = new Set();
  function reg(n) { live.add(n); n.onended = function () { live.delete(n); }; }
  E.stopAll = function () {
    var t = ctx.currentTime; gate.gain.cancelScheduledValues(t); gate.gain.setTargetAtTime(0, t, 0.008);
    live.forEach(function (n) { try { n.stop(t + 0.04); } catch (e) {} }); live.clear();
    gate.gain.setTargetAtTime(1, t + 0.05, 0.005);
  };
  E.duck = function (t, depth, hold, rel) { var g = duck.gain; g.cancelScheduledValues(t); g.setTargetAtTime(depth, t, 0.015); g.setTargetAtTime(1, t + hold, rel); };
  E.vary = function (cents) { return Math.pow(2, (E.rand() * 2 - 1) * cents / 1200); };

  function env(g, t, p, pk) { // attack -> hold -> exponential decay
    var a = p.a == null ? 0.002 : p.a, h = p.h || 0, d = p.d || 0.1;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + a);
    if (h) g.gain.setValueAtTime(pk, t + a + h);
    g.gain.exponentialRampToValueAtTime(pk * 0.001, t + a + h + d);
    g.gain.linearRampToValueAtTime(0, t + a + h + d + 0.01);
    return t + a + h + d + 0.03;
  }
  function total(p) { return (p.a == null ? 0.002 : p.a) + (p.h || 0) + (p.d || 0.1); }
  function shape(src, p, t) { // src -> envelope [-> drive -> level] [-> pan] -> bus [+ reverb send]
    var v = (p.v == null ? 0.2 : p.v) * E._trim * E._g, g = ctx.createGain(), end, n = g;
    g.gain.value = 0; // closed until the envelope opens it: a source that starts a hair before t must not leak through at unity
    src.connect(g);
    if (p.drive) { end = env(g, t, p, 1); var ws = ctx.createWaveShaper(); ws.curve = driveCurve(p.drive); var post = G(v); g.connect(ws); ws.connect(post); n = post; }
    else end = env(g, t, p, v);
    var pan = clamp((p.pan || 0) + E._pan, -1, 1);
    if (pan) { var pn = ctx.createStereoPanner(); pn.pan.value = pan; n.connect(pn); n = pn; }
    n.connect(E.bus[p.bus || E._bus]);
    if (p.send && E.I > 0) { var s = G(p.send); n.connect(s); s.connect(verbIn); }
    return end;
  }

  // oscillator, optional pitch glide (f2 over gt), vibrato [Hz, cents], lowpass sweep (lp -> lp2 over lt, resonance q)
  E.tone = function (p) {
    var t = p.t, o = ctx.createOscillator(), n = o, tt = total(p);
    o.type = p.type || 'sine'; o.frequency.setValueAtTime(p.f, t);
    if (p.f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, p.f2), t + (p.gt || tt));
    if (p.det) o.detune.value = p.det;
    var lfo = null;
    if (p.vib) { lfo = ctx.createOscillator(); lfo.frequency.value = p.vib[0]; var lg = G(p.vib[1]); lfo.connect(lg); lg.connect(o.detune); }
    if (p.lp) { var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = p.q || 1; f.frequency.setValueAtTime(p.lp, t); if (p.lp2) f.frequency.exponentialRampToValueAtTime(p.lp2, t + (p.lt || tt)); o.connect(f); n = f; }
    var end = shape(n, p, t); o.start(t); o.stop(end); reg(o); if (lfo) { lfo.start(t); lfo.stop(end); }
  };
  // filtered white noise (ft lowpass|bandpass|highpass, sweep f -> f2 over gt)
  E.noise = function (p) {
    var t = p.t, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), tt = total(p);
    s.buffer = NB; s.loop = true; if (p.rate) s.playbackRate.value = p.rate;
    f.type = p.ft || 'lowpass'; f.Q.value = p.q || 0.7; f.frequency.setValueAtTime(p.f || 2000, t);
    if (p.f2) f.frequency.exponentialRampToValueAtTime(p.f2, t + (p.gt || tt));
    s.connect(f); var end = shape(f, p, t); s.start(t, E.rand() * 1.5); s.stop(end); reg(s);
  };
  // 2-operator FM: inharmonic ratios give metal. idx -> idx2 is the brightness envelope.
  E.fm = function (p) {
    var t = p.t, c = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), tt = total(p), mf = p.f * (p.ratio || 1.41);
    c.frequency.setValueAtTime(p.f, t); if (p.f2) c.frequency.exponentialRampToValueAtTime(Math.max(20, p.f2), t + (p.gt || tt));
    m.frequency.value = mf; mg.gain.setValueAtTime((p.idx || 2) * mf, t); mg.gain.exponentialRampToValueAtTime(Math.max(0.01, (p.idx2 == null ? 0.1 : p.idx2) * mf), t + (p.it || tt));
    m.connect(mg); mg.connect(c.frequency);
    var end = shape(c, p, t); c.start(t); m.start(t); c.stop(end); m.stop(end); reg(c);
  };
  // modal resonator: an impulse (plus a few ms of grit) rings parallel high-Q bandpasses -> knocks, wood, coins, glass.
  // Each mode is scaled by Q/w0, the inverse of a bandpass's impulse-response peak, so v means the same as elsewhere.
  var EXB = (function () { var len = Math.floor(sr * 0.004), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0), r = mulberry(3); for (var i = 0; i < len; i++) d[i] = (r() * 2 - 1) * 0.02 * (1 - i / len); d[0] = 1; return b; })();
  E.modal = function (p) {
    var t = p.t, s = ctx.createBufferSource(), Q = p.q || 30, gs = p.fs.map(function (f, i) { return p.gs ? p.gs[i] : 1 / (1 + i * 0.7); }), tot = 0;
    gs.forEach(function (g) { tot += g * g; });
    var sum = G(1 / Math.sqrt(tot));
    s.buffer = EXB;
    p.fs.forEach(function (f, i) { var b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = Q; var g = G(gs[i] * Q / (2 * Math.PI * f / sr)); s.connect(b); b.connect(g); g.connect(sum); });
    var q = { v: p.v, a: 0.0005, d: p.d || 0.2, pan: p.pan, send: p.send, bus: p.bus };
    var end = shape(sum, q, t); s.start(t); reg(s);
    return end;
  };
  // Karplus-Strong plucked string, rendered once per pitch into a buffer and cached
  var ksCache = {};
  E.pluck = function (p) {
    var t = p.t, N = Math.max(2, Math.round(sr / p.f)), br = p.br == null ? 0.5 : p.br, key = N + '|' + br, b = ksCache[key];
    if (!b) {
      var len = Math.floor(sr * 1.6), r = mulberry(N * 31 + 5), lp = 0, mx = 0, i;
      b = ctx.createBuffer(1, len, sr); var d = b.getChannelData(0);
      for (i = 0; i < N; i++) { lp += br * ((r() * 2 - 1) - lp); d[i] = lp; mx = Math.max(mx, Math.abs(lp)); }
      for (i = 0; i < N; i++) d[i] /= mx || 1;
      for (i = N; i < len; i++) d[i] = 0.4985 * (d[i - N] + (i - N - 1 >= 0 ? d[i - N - 1] : 0));
      ksCache[key] = b;
    }
    var s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = p.f / (sr / N);
    var q = { v: p.v, a: 0.001, d: p.d || 0.9, pan: p.pan, send: p.send, bus: p.bus };
    var end = shape(s, q, t); s.start(t); s.stop(end); reg(s);
  };
  return E;
}

// ================================================================ PACK A — ARCADE PUNCH
// Subtractive "analog": square/saw oscillators through a closing lowpass, sine pitch-drop kicks,
// chip arpeggios for combos. An upgraded version of what the demo already does.
function arcade(E) {
  var T = E.tone, N = E.noise, V = E.vary, sc = [0, 4, 7, 12, 16, 19, 24];
  function blip(t, f, d, v, type, sl) { T({ t: t, f: f, f2: sl ? f * sl : 0, type: type || 'square', d: d, v: v, lp: 6000, lp2: 1200 }); }
  function kick(t, f, d, v) { T({ t: t, f: f, f2: 42, gt: d * 0.6, d: d, v: v, a: 0.001 }); }
  function arp(t, ms, dt, d, v, type) { ms.forEach(function (m, i) { T({ t: t + i * dt, f: mtof(m), type: type || 'square', d: d, v: v, lp: 5000, lp2: 900 }); }); }
  function snap(t, d, v) { N({ t: t, f: 3200, d: d, v: v, a: 0.001 }); }
  return {
    reset: function () {},
    hover: function (t) { T({ t: t, f: 1760 * V(40), type: 'square', d: 0.018, v: 0.05, lp: 4000 }); },
    raise: function (t, i) { var f = mtof(64 + sc[clamp(i | 0, 0, 6)]); T({ t: t, f: f, f2: f * 1.3, type: 'sawtooth', d: 0.09, v: 0.12, lp: 5000, lp2: 1500 }); T({ t: t, f: f * 2, type: 'square', d: 0.04, v: 0.04 }); },
    lower: function (t) { T({ t: t, f: 392, f2: 262, type: 'triangle', d: 0.08, v: 0.12 }); },
    invalid: function (t) { T({ t: t, f: 110, type: 'sawtooth', h: 0.11, d: 0.06, v: 0.2, lp: 900 }); T({ t: t, f: 116.5, type: 'square', h: 0.11, d: 0.06, v: 0.12, lp: 700 }); blip(t, 1860, 0.05, 0.04); },
    button: function (t) { blip(t, 660 * V(15), 0.05, 0.1, 'square', 1.5); },
    whoosh: function (t) { N({ t: t, ft: 'bandpass', f: 700, f2: 4200 * V(150), q: 1.2, a: 0.05, d: 0.1, v: 0.2 }); T({ t: t, f: 300, f2: 900, type: 'sawtooth', a: 0.05, d: 0.08, v: 0.03, lp: 2000 }); },
    hit: function (t, n) {
      n = clamp(n || 1, 1, 4); var v = V(35);
      kick(t, (150 + n * 18) * v, 0.16 + n * 0.03, 0.5); snap(t, 0.05 + n * 0.015, 0.25);
      T({ t: t, f: 98 * v, type: 'square', d: 0.09, v: 0.12, lp: 1200, lp2: 200 });
      if (n > 1) for (var i = 0; i < n; i++) blip(t + 0.03 + i * 0.05, mtof(69 + sc[i] + (n - 2) * 2), 0.07, 0.09); // combo counter: one rising blip per card
      if (n >= 4 && E.I > 0) T({ t: t + 0.03, f: 1400, f2: 2800, type: 'sawtooth', d: 0.3, v: 0.05, lp: 5000, send: 0.5 });
    },
    two: function (t) { arp(t, [76, 72, 67, 64, 60], 0.03, 0.05, 0.08); T({ t: t + 0.17, f: mtof(48), type: 'triangle', d: 0.3, v: 0.2 }); T({ t: t + 0.17, f: mtof(84), type: 'sine', d: 0.25, v: 0.05 }); },
    three: function (t) { T({ t: t, f: 880, f2: 1760, type: 'triangle', a: 0.06, d: 0.4, v: 0.1, vib: [9, 60], send: 0.5 }); N({ t: t, ft: 'highpass', f: 6000, a: 0.08, d: 0.3, v: 0.03 }); },
    four: function (t) { T({ t: t, f: 1200, f2: 300, type: 'sawtooth', d: 0.12, v: 0.1, lp: 4000 }); T({ t: t + 0.12, f: 300, f2: 1300, type: 'sawtooth', d: 0.14, v: 0.1, lp: 4000 }); },
    seven: function (t) { T({ t: t, f: 220, f2: 50, type: 'square', d: 0.32, v: 0.14, lp: 1500, lp2: 200 }); kick(t + 0.02, 90, 0.3, 0.4); },
    eight: function (t) { blip(t, 880, 0.045, 0.1); blip(t + 0.07, 880, 0.03, 0.03); blip(t + 0.14, 1320, 0.09, 0.1); },
    jack: function (t) { [60, 64, 67].forEach(function (m) { T({ t: t, f: mtof(m), type: 'sawtooth', d: 0.1, v: 0.07, lp: 3500, lp2: 900 }); T({ t: t + 0.13, f: mtof(m + 5), type: 'sawtooth', h: 0.08, d: 0.2, v: 0.07, lp: 4000, lp2: 900 }); }); },
    joker: function (t) { for (var i = 0; i < 9; i++) blip(t + i * 0.045, mtof(60 + sc[Math.floor(E.rand() * 7)] + (E.rand() < 0.3 ? 1 : 0)), 0.05, 0.08); T({ t: t + 0.42, f: 700, f2: 180, type: 'sawtooth', d: 0.4, v: 0.1, vib: [14, 250], lp: 3000, send: 0.4 }); },
    burn: function (t) {
      kick(t, 110, 0.9, 0.6); T({ t: t, f: 55, f2: 28, d: 1.0, v: 0.5 });
      N({ t: t, f: 7000, f2: 250, d: 0.9, v: 0.4, a: 0.001, send: 0.4 });
      T({ t: t, f: 2200, f2: 90, type: 'sawtooth', d: 0.55, v: 0.08, lp: 6000, lp2: 400 });
      if (E.I > 0) for (var i = 0; i < 6; i++) blip(t + 0.08 + i * 0.07, 1800 / (1 + i * 0.35) * V(100), 0.06, 0.05, 'square', 0.5); // crumbling debris
    },
    take: function (t) { T({ t: t, f: 300, f2: 62, type: 'sawtooth', d: 0.5, v: 0.16, lp: 2200, lp2: 250 }); T({ t: t, f: 150, f2: 31, type: 'square', d: 0.5, v: 0.08, lp: 800 }); for (var i = 0; i < 5; i++) N({ t: t + 0.05 + i * 0.06, f: 1200, d: 0.04, v: 0.12 }); },
    turn: function (t) { blip(t, 880, 0.05, 0.1); blip(t + 0.06, 1320, 0.1, 0.1); },
    deal: function (t, i) { N({ t: t, ft: 'highpass', f: 4000, d: 0.015, v: 0.08 }); blip(t, mtof(72 + sc[(i | 0) % 7]) * V(10), 0.035, 0.07); },
    draw: function (t) { N({ t: t, ft: 'highpass', f: 4000, d: 0.015, v: 0.06 }); blip(t, 520, 0.06, 0.08, 'square', 1.35); },
    swap: function (t) { blip(t, 440, 0.05, 0.08, 'triangle'); blip(t + 0.06, 660, 0.07, 0.08, 'triangle'); },
    ready: function (t) { arp(t, [64, 67, 71], 0.055, 0.09, 0.09); },
    out: function (t, me) { arp(t, me ? [67, 72, 76, 79, 84] : [72, 76, 79], 0.07, me ? 0.18 : 0.1, 0.09); if (me) T({ t: t + 0.28, f: mtof(48), type: 'triangle', d: 0.5, v: 0.15, send: 0.3 }); },
    win: function (t) { arp(t, [67, 72, 76, 79, 84], 0.09, 0.16, 0.09, 'sawtooth'); [72, 76, 79, 84].forEach(function (m, i) { T({ t: t + 0.5, f: mtof(m), type: 'square', h: 0.25, d: 0.6, v: 0.06, lp: 4000, lp2: 1200, det: i * 4 - 6, send: 0.5 }); }); kick(t + 0.5, 120, 0.3, 0.3); },
    lose: function (t) { [58, 57, 56].forEach(function (m, i) { T({ t: t + i * 0.24, f: mtof(m), f2: mtof(m - 1), type: 'sawtooth', h: 0.1, d: 0.12, v: 0.12, lp: 1800, lp2: 500 }); }); T({ t: t + 0.72, f: mtof(55), f2: mtof(43), type: 'sawtooth', h: 0.15, d: 0.8, v: 0.14, lp: 1600, lp2: 200, vib: [5, 40], send: 0.3 }); N({ t: t + 0.72, f: 500, d: 0.8, v: 0.1 }); },
    count: function (t) { T({ t: t, f: 440, type: 'square', h: 0.05, d: 0.08, v: 0.1, lp: 2500 }); },
    fight: function (t) { T({ t: t, f: 880, type: 'square', h: 0.2, d: 0.3, v: 0.1, lp: 3500, send: 0.4 }); T({ t: t, f: 1320, type: 'sawtooth', h: 0.2, d: 0.3, v: 0.05, lp: 4000 }); kick(t, 140, 0.4, 0.5); N({ t: t, ft: 'highpass', f: 3000, d: 0.5, v: 0.15, send: 0.3 }); },
  };
}

// ================================================================ PACK C — LETHAL
// Hard: FM metal clangs, an overdriven sub, bat-crack transients, and funk stingers (resonant
// wah bass, brass stabs, clav). Built to sit under hit-stop and impact frames.
function lethal(E) {
  var T = E.tone, N = E.noise, F = E.fm, V = E.vary;
  function crack(t, v) { N({ t: t, ft: 'highpass', f: 3000, d: 0.012, v: v, a: 0.0005 }); N({ t: t, ft: 'bandpass', f: 2400 * V(100), q: 1, d: 0.04, v: v * 0.7, a: 0.0005 }); }
  function sub(t, f, d, v) { T({ t: t, f: f, f2: f * 0.3, gt: d * 0.5, d: d, v: v, drive: 3, a: 0.001 }); }
  function clang(t, f, d, v, send) { F({ t: t, f: f, ratio: 1.414, idx: 4, idx2: 0.3, d: d, v: v, send: send, a: 0.001 }); F({ t: t, f: f * 2.76, ratio: 2.1, idx: 2, idx2: 0.1, d: d * 0.6, v: v * 0.5, a: 0.001 }); }
  function stab(t, ms, h, d, v, send) { ms.forEach(function (m, i) { T({ t: t, f: mtof(m), type: 'sawtooth', det: (i % 2 ? 7 : -7), h: h, d: d, v: v, lp: 3800, lp2: 700, q: 3, drive: 1.5, send: send }); }); }
  function bass(t, m, d, v, wah) { T({ t: t, f: mtof(m), type: 'sawtooth', d: d, v: v, lp: wah ? 250 : 1900, lp2: wah ? 2200 : 220, lt: d * 0.6, q: 9, drive: 2 }); }
  function chick(t, v) { N({ t: t, ft: 'bandpass', f: 1800 * V(100), q: 3, d: 0.025, v: v, a: 0.0005 }); }
  function hat(t, v) { N({ t: t, ft: 'highpass', f: 8000, d: 0.03, v: v, a: 0.0005 }); }
  function clav(t, m, d, v) { T({ t: t, f: mtof(m), type: 'square', d: d, v: v, lp: 4500, lp2: 600, q: 4 }); }
  var pent = [0, 3, 5, 7, 10, 12, 15];
  return {
    reset: function () {},
    hover: function (t) { F({ t: t, f: 2400 * V(60), ratio: 3.1, idx: 1, d: 0.02, v: 0.04 }); },
    raise: function (t, i) { var f = mtof(76 + pent[clamp(i | 0, 0, 6)]); F({ t: t, f: f, ratio: 3.5, idx: 2, idx2: 0.2, d: 0.1, v: 0.1 }); N({ t: t, ft: 'highpass', f: 6000, d: 0.02, v: 0.04 }); },
    lower: function (t) { clav(t, 64, 0.06, 0.1); },
    invalid: function (t) { [0, 0.1].forEach(function (dt) { T({ t: t + dt, f: 98, type: 'sawtooth', h: 0.05, d: 0.03, v: 0.16, lp: 1200, drive: 4 }); T({ t: t + dt, f: 104, type: 'sawtooth', h: 0.05, d: 0.03, v: 0.12, lp: 1200, drive: 4 }); }); F({ t: t, f: 190, ratio: 1.83, idx: 3, d: 0.08, v: 0.1 }); },
    button: function (t) { clav(t, 76, 0.06, 0.1); chick(t, 0.05); },
    whoosh: function (t) { N({ t: t, ft: 'bandpass', f: 1500, f2: 6500 * V(150), q: 2.5, a: 0.04, d: 0.07, v: 0.22 }); T({ t: t, f: 500, f2: 1300, type: 'sawtooth', a: 0.04, d: 0.06, v: 0.03, lp: 3000 }); },
    hit: function (t, n) {
      n = clamp(n || 1, 1, 4); var v = V(30);
      crack(t, 0.35); sub(t, (140 + n * 15) * v, 0.18 + n * 0.05, 0.4 + n * 0.04);
      clang(t, 220 * (1 + n * 0.19) * v, 0.12 + n * 0.09, 0.14 + n * 0.02, n >= 3 ? 0.4 : 0);
      for (var i = 1; i < n; i++) F({ t: t + 0.05 + i * 0.045, f: 1250 * Math.pow(1.19, i + n) * v, ratio: 2.4, idx: 1.5, idx2: 0.1, d: 0.09, v: 0.07, pan: (i % 2 ? 0.3 : -0.3) }); // ricochet pings, rising like ball speed
      if (n >= 4 && E.I > 0) N({ t: t, ft: 'highpass', f: 5000, d: 0.5, v: 0.1, send: 0.5 });
    },
    two: function (t) { stab(t, [64, 67, 71], 0.02, 0.05, 0.08); T({ t: t + 0.05, f: mtof(64), f2: mtof(28), type: 'sawtooth', d: 0.3, v: 0.12, lp: 3000, lp2: 200, drive: 2 }); F({ t: t + 0.36, f: mtof(76), ratio: 2, idx: 0.5, d: 0.25, v: 0.08, send: 0.4 }); },
    three: function (t) { F({ t: t, f: 1480, ratio: 7.1, idx: 0.8, idx2: 0.3, a: 0.05, d: 0.5, v: 0.06, send: 0.6 }); T({ t: t, f: 2960, a: 0.08, d: 0.4, v: 0.02, vib: [7, 80] }); },
    four: function (t) { N({ t: t, ft: 'bandpass', f: 800, f2: 3500, q: 5, d: 0.07, v: 0.2 }); N({ t: t + 0.08, ft: 'bandpass', f: 3500, f2: 700, q: 5, d: 0.07, v: 0.2 }); N({ t: t + 0.17, ft: 'bandpass', f: 900, f2: 4200, q: 5, d: 0.09, v: 0.2 }); bass(t + 0.17, 52, 0.18, 0.12, true); },
    seven: function (t) { T({ t: t, f: 85, f2: 27, gt: 0.5, d: 0.6, v: 0.5, drive: 4, a: 0.002 }); F({ t: t, f: 110, ratio: 1.3, idx: 3, d: 0.15, v: 0.12 }); },
    eight: function (t) { chick(t, 0.2); chick(t + 0.07, 0.2); stab(t + 0.14, [64, 68, 71, 74], 0.03, 0.12, 0.07); },
    jack: function (t) { stab(t, [64, 68, 71, 74, 78], 0.03, 0.06, 0.06); stab(t + 0.14, [64, 68, 71, 74, 78], 0.14, 0.25, 0.06, 0.3); sub(t + 0.14, 82, 0.2, 0.25); },
    joker: function (t) { [52, 51, 50, 49, 46, 40].forEach(function (m, i) { bass(t + i * 0.075, m, 0.09, 0.14, i % 2 === 0); }); T({ t: t + 0.45, f: mtof(64), f2: mtof(58), type: 'sawtooth', h: 0.1, d: 0.35, v: 0.1, vib: [11, 220], lp: 2500, q: 6, drive: 2, send: 0.4 }); },
    burn: function (t) {
      crack(t, 0.5);
      T({ t: t + 0.03, f: 62, f2: 24, gt: 0.9, d: 1.2, v: 0.6, drive: 4, a: 0.001 });                  // 30 ms of nothing, then the floor drops
      [196, 233, 311].forEach(function (f, i) { clang(t + 0.03, f * V(20), 0.9, 0.12, 0.5); });
      N({ t: t + 0.03, ft: 'highpass', f: 2000, d: 1.1, v: 0.25, send: 0.5 });
      if (E.I > 0) T({ t: t + 0.03, f: 400, f2: 3200, type: 'sawtooth', a: 0.3, d: 0.25, v: 0.05, lp: 6000, send: 0.5 }); // siren whine
    },
    take: function (t) { T({ t: t, f: mtof(52), f2: mtof(33), type: 'sawtooth', h: 0.05, d: 0.5, v: 0.2, lp: 2200, lp2: 180, q: 8, drive: 2.5 }); F({ t: t, f: 140, ratio: 1.5, idx: 3, d: 0.25, v: 0.12 }); N({ t: t + 0.05, ft: 'bandpass', f: 700, f2: 450, q: 4, a: 0.1, d: 0.45, v: 0.12 }); N({ t: t + 0.05, ft: 'bandpass', f: 1100, f2: 900, q: 5, a: 0.1, d: 0.4, v: 0.06 }); },
    turn: function (t) { clav(t, 76, 0.05, 0.12); clav(t + 0.07, 83, 0.1, 0.12); },
    deal: function (t, i) { hat(t, 0.1); clav(t, 64 + pent[(i | 0) % 5], 0.03, 0.05); },
    draw: function (t) { hat(t, 0.1); F({ t: t, f: 900 * V(40), ratio: 1.6, idx: 1, d: 0.04, v: 0.07 }); },
    swap: function (t) { bass(t, 64, 0.07, 0.1, true); bass(t + 0.09, 59, 0.07, 0.1, true); },
    ready: function (t) { T({ t: t, f: mtof(40), f2: mtof(52), type: 'sawtooth', d: 0.2, v: 0.14, lp: 400, lp2: 2200, q: 8, drive: 2 }); },
    out: function (t, me) { stab(t, [64, 71], 0.02, 0.06, 0.07); stab(t + 0.1, [67, 74], 0.02, 0.06, 0.07); stab(t + 0.2, me ? [64, 68, 71, 74, 78] : [69, 76], me ? 0.2 : 0.05, me ? 0.4 : 0.15, 0.07, 0.4); if (me) sub(t + 0.2, 82, 0.3, 0.3); },
    win: function (t) {
      var r = 0.115; // 16ths at ~130 bpm: bass pickup, then brass answers
      [[0, 40], [2, 40], [3, 43], [4, 45], [6, 47]].forEach(function (x) { bass(t + x[0] * r, x[1], 0.12, 0.16); });
      [[1, [64, 67, 71]], [4, [64, 67, 71, 74]], [5, [66, 69, 73]]].forEach(function (x) { stab(t + x[0] * r, x[1], 0.02, 0.07, 0.05); });
      stab(t + 7 * r, [64, 68, 71, 74, 78], 0.35, 0.6, 0.06, 0.5); sub(t + 7 * r, 82, 0.5, 0.35); crack(t + 7 * r, 0.2);
      for (var i = 0; i < 7; i++) hat(t + i * r, 0.06);
    },
    lose: function (t) { stab(t, [64, 70], 0.1, 0.1, 0.08); stab(t + 0.28, [63, 69], 0.1, 0.1, 0.08); T({ t: t + 0.56, f: mtof(62), f2: mtof(26), gt: 0.9, type: 'sawtooth', h: 0.1, d: 0.9, v: 0.16, lp: 2600, lp2: 150, q: 5, drive: 2.5, send: 0.4 }); T({ t: t + 0.56, f: mtof(68), f2: mtof(32), gt: 0.9, type: 'sawtooth', h: 0.1, d: 0.9, v: 0.1, lp: 2600, lp2: 150, drive: 2 }); T({ t: t + 0.9, f: 50, f2: 25, d: 0.7, v: 0.4, drive: 3 }); },
    count: function (t) { T({ t: t, f: 540, type: 'square', d: 0.12, v: 0.1, lp: 3000 }); T({ t: t, f: 800, type: 'square', d: 0.1, v: 0.1, lp: 3500 }); },
    fight: function (t) { [233, 277, 349].forEach(function (f) { T({ t: t, f: f * 0.94, f2: f, gt: 0.06, type: 'sawtooth', h: 0.3, d: 0.25, v: 0.07, lp: 3500, q: 2, drive: 2, send: 0.4 }); }); sub(t, 120, 0.5, 0.5); crack(t, 0.4); clang(t, 330, 0.5, 0.1, 0.5); },
  };
}

var PACKS = {
  arcade: { name: 'ARCADE PUNCH', make: arcade, tag: 'Chunky analog. Square/saw through a closing filter, sine-drop kicks, chip arps that count your combo.',
    desc: 'The safe evolution of what the demo has now: subtractive synth, every hit a pitched kick plus a snap, multi-card plays add one rising blip per card. Reads instantly as "video game", cuts through on laptop speakers, lowest CPU.' },
  lethal: { name: 'LETHAL', make: lethal, tag: 'FM metal, overdriven sub, bat-crack transients, funk stingers (wah bass, brass stabs, clav).',
    desc: 'Made for hit-stop: a dry crack on the impact frame, then a driven sub and an inharmonic clang whose pitch and ring grow with the stack, plus ricochet pings that rise like ball speed. Specials are short funk licks. Hardest hitting, most to tune by ear.' }
};
var NAMES = ['hover', 'raise', 'lower', 'invalid', 'button', 'whoosh', 'hit', 'two', 'three', 'four', 'seven', 'eight', 'jack', 'joker', 'burn', 'take', 'turn', 'deal', 'draw', 'swap', 'ready', 'out', 'win', 'lose', 'count', 'fight'];

function buildPack(E, id) {
  var def = PACKS[id].make(E), ctx = E.ctx, trims = E.noTrim ? {} : (TRIM[id] || {}), api = { id: id, name: PACKS[id].name, engine: E };
  NAMES.forEach(function (name) {
    api[name] = function () {
      if (E.muted) return;
      var args = [].slice.call(arguments), o = {}, last = args[args.length - 1];
      if (last && typeof last === 'object') o = args.pop();
      var t = ctx.currentTime + (o.when || 0) + 0.004;
      E._pan = o.pan || 0; E._g = o.opp ? 0.55 : 1; E._bus = BUS[name] || 'sfx'; E._trim = trims[trimKey(name, args)] || 1;
      var dk = DUCK[name]; if (dk && !o.opp) E.duck(t, dk[0], dk[1], dk[2]);
      def[name].apply(def, [t].concat(args));
      E._pan = 0; E._g = 1; E._trim = 1; E._bus = 'sfx';
    };
  });
  api.reset = function () { def.reset(); };
  return api;
}

root.SlamSfx = { makeEngine: makeEngine, buildPack: buildPack, PACKS: PACKS, NAMES: NAMES, TARGET: TARGET, TRIM: TRIM, BUS: BUS, DUCK: DUCK, trimKey: trimKey };
})(typeof window !== 'undefined' ? window : globalThis);
