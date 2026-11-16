import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import * as E from './engine.ts';
import { deriveEvents, type Ev } from './events.ts';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

interface Seat { name: string; token: string; ws: WebSocket | null; bot?: boolean }
interface Spec { name: string; token: string; ws: WebSocket | null; cam: number }
interface Room {
  code: string;
  hostToken: string;
  specs: Spec[]; // spectators: watch only, see no hands
  seats: Seat[]; // seat index == engine seat
  game: E.State | null;
  lastActive: number;
  botTimer?: NodeJS.Timeout;
  speed: number; // host-set game speed multiplier; shortens the bots' thinking time
}
const rooms = new Map<string, Room>();

const genCode = () => {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    const c = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    if (!rooms.has(c)) return c;
  }
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });

const send = (ws: WebSocket | null, msg: unknown) => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

const pubCard = (c: E.Card) => ({ id: c.id, rank: c.rank, suit: c.suit });

/** Per-viewer projection: never leaks other hands, face-down cards or deck order. */
type Viewer = { seat: number } | { spec: Spec };

function view(room: Room, who: Viewer) {
  const g = room.game;
  const spec = 'spec' in who ? who.spec : null;
  const seat = spec ? Math.max(0, Math.min(spec.cam, (g?.players.length ?? 1) - 1)) : (who as { seat: number }).seat;
  const token = spec ? spec.token : room.seats[seat]!.token;
  const base = {
    type: 'state',
    code: room.code,
    you: spec && !g ? -1 : seat, // a spectator's "you" is the seat whose side of the table they watch from
    spectator: !!spec,
    host: token === room.hostToken,
    hostSeat: room.seats.findIndex((s) => s.token === room.hostToken),
    seats: room.seats.map((s, i) => ({ seat: i, name: s.name, connected: !!s.ws || !!s.bot, bot: !!s.bot })),
    specs: room.specs.map((s, i) => ({ idx: i, name: s.name, connected: !!s.ws, host: s.token === room.hostToken, me: s === spec })),
  };
  if (!g) return { ...base, phase: 'lobby' };
  const me = g.players[seat]!;
  const watching = !!spec;
  return {
    ...base,
    phase: g.phase,
    current: g.current,
    direction: g.direction,
    deckCount: g.deck.length,
    pileCount: g.pile.length,
    pile: g.pile.slice(-6).map(pubCard),
    restriction: E.restriction(g.pile),
    pendingJoker: g.pendingJoker,
    finished: g.finished,
    shithead: g.shithead,
    log: g.log.slice(-12),
    players: g.players.map((p, i) => ({
      seat: i,
      name: p.name,
      handCount: p.hand.length,
      up: p.up.map(pubCard),
      downCount: p.down.length,
      ready: p.ready,
      active: E.isActive(g, i),
    })),
    hand: watching ? [] : me.hand.map(pubCard),
    zone: watching ? null : E.zoneOf(me),
    playable: watching ? [] : E.playableRanks(g, seat),
    canPickup: watching ? false : E.canPickup(g, seat),
    parryId: watching ? null : g.pendingJoker?.parry?.to === seat ? (me.hand.find((c) => c.rank === E.JOKER)?.id ?? null) : null,
    downIds: watching ? [] : E.zoneOf(me) === 'down' && g.current === seat && g.phase === 'playing' && !g.pendingJoker ? me.down.map((c) => c.id) : [],
  };
}

function broadcast(room: Room, events?: Ev[]) {
  room.lastActive = Date.now();
  const out = (ws: WebSocket | null, who: Viewer) => send(ws, events ? { ...view(room, who), events } : view(room, who));
  room.seats.forEach((s, i) => out(s.ws, { seat: i }));
  room.specs.forEach((sp) => out(sp.ws, { spec: sp }));
  scheduleBots(room);
}

// ---------------------------------------------------------------- bots

const BOT_NAMES = ['Botty', 'Clanker', 'Sparky', 'Gizmo', 'Rusty', 'Widget', 'Bolt', 'Cogsworth'];
const BOT_DELAY = Number(process.env.BOT_DELAY ?? 1100);

/** Lowest-value choice first; specials (2, 3, 10, joker) are kept back unless nothing else works. */
function botPick(g: E.State, seat: number, moves: E.Action[]): E.Action {
  const rnd = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
  if (g.phase === 'swap') return moves[0]!;
  const byId = new Map(E.allCards(g).map((c) => [c.id, c]));
  const plays = moves.filter((m): m is Extract<E.Action, { t: 'play' }> => m.t === 'play');
  const p = g.players[seat]!;
  if (E.zoneOf(p) === 'down') return rnd(plays);
  if (!plays.length) return moves.find((m) => m.t === 'pickup') ?? moves[0]!;
  if (Math.random() < 0.08) return rnd(plays); // a little noise so two bots can never cycle forever
  const cost = (m: Extract<E.Action, { t: 'play' }>) => {
    const ranks = m.ids.map((id) => byId.get(id)!.rank);
    const special = ranks.some((r) => r === 2 || r === 3 || r === 10 || r === E.JOKER);
    return (special ? 100 : 0) + Math.max(...ranks) - m.ids.length * 0.1;
  };
  return plays.reduce((a, b) => (cost(b) < cost(a) ? b : a));
}

function botMsg(a: E.Action): { type: string; [k: string]: unknown } {
  return a.t === 'play' ? { type: 'play', ids: a.ids } : a.t === 'joker' ? { type: 'joker', target: a.target } : { type: a.t };
}

function scheduleBots(room: Room) {
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = undefined; }
  const g = room.game;
  if (!g || g.phase === 'finished' || !room.seats.some((s) => s.bot)) return;
  if (!room.seats.some((s) => s.ws) && !room.specs.some((s) => s.ws)) return; // nobody watching: do not burn CPU
  const acting = g.phase === 'swap'
    ? room.seats.findIndex((s, i) => s.bot && !g.players[i]!.ready)
    : (() => { const a = E.actingSeat(g); return room.seats[a]?.bot ? a : -1; })();
  if (acting < 0) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = undefined;
    const cur = room.game;
    if (!cur || cur !== g) return scheduleBots(room);
    const moves = E.legalMoves(cur, acting);
    if (!moves.length) return;
    let a = botPick(cur, acting, moves);
    if (cur.pendingJoker && !cur.pendingJoker.parry) { // joker target: any live opponent
      const t = moves.filter((m) => m.t === 'joker');
      a = t[Math.floor(Math.random() * t.length)]!;
    } else if (cur.pendingJoker?.parry) a = moves.find((m) => m.t === 'parry') ?? moves[0]!;
    const r = E.applyAction(cur, acting, a);
    if (!r.ok) { console.error('bot move rejected', r.error); return; }
    room.game = r.state;
    broadcast(room, deriveEvents(cur, r.state, acting, botMsg(a)));
  }, (g.phase === 'swap' ? Math.min(600, BOT_DELAY) : BOT_DELAY) / room.speed);
}

interface Conn { room?: Room; seat?: number; spec?: Spec }
const conns = new WeakMap<WebSocket, Conn>();

const cleanName = (n: unknown) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Player';

function handle(ws: WebSocket, msg: any) {
  const conn = conns.get(ws)!;
  const err = (m: string) => send(ws, { type: 'error', msg: m });

  switch (msg.type) {
    case 'create': {
      const code = genCode();
      const token = randomBytes(12).toString('hex');
      const room: Room = { code, speed: 1, hostToken: token, specs: [], seats: [], game: null, lastActive: Date.now() };
      if (msg.spectate) {
        const sp: Spec = { name: cleanName(msg.name), token, ws, cam: 0 };
        room.specs.push(sp); conn.spec = sp;
      } else { room.seats.push({ name: cleanName(msg.name), token, ws }); conn.seat = 0; }
      rooms.set(code, room);
      conn.room = room;
      send(ws, { type: 'joined', code, token, seat: conn.seat ?? -1 });
      return broadcast(room);
    }
    case 'join': {
      const room = rooms.get(String(msg.code ?? '').toUpperCase());
      if (!room) return err('Room not found');
      // Rejoin with token
      const si = msg.token ? room.seats.findIndex((s) => s.token === msg.token) : -1;
      const sj = msg.token ? room.specs.findIndex((s) => s.token === msg.token) : -1;
      if (si >= 0 || sj >= 0) {
        const s = si >= 0 ? room.seats[si]! : room.specs[sj]!;
        if (s.ws && s.ws !== ws) s.ws.close();
        s.ws = ws;
        conn.room = room; conn.seat = si >= 0 ? si : undefined; conn.spec = sj >= 0 ? room.specs[sj] : undefined;
        send(ws, { type: 'joined', code: room.code, token: s.token, seat: si });
        return broadcast(room);
      }
      const token = randomBytes(12).toString('hex');
      if (msg.spectate) {
        if (room.specs.length >= 30) return err('Too many spectators');
        const sp: Spec = { name: cleanName(msg.name), token, ws, cam: 0 };
        room.specs.push(sp);
        conn.room = room; conn.spec = sp; conn.seat = undefined;
        send(ws, { type: 'joined', code: room.code, token, seat: -1 });
        return broadcast(room);
      }
      if (room.game) return err('Game already started: you can join as a spectator');
      if (room.seats.length >= E.MAX_PLAYERS) return err('Room is full: you can join as a spectator');
      room.seats.push({ name: cleanName(msg.name), token, ws });
      conn.room = room; conn.seat = room.seats.length - 1; conn.spec = undefined;
      send(ws, { type: 'joined', code: room.code, token, seat: conn.seat });
      return broadcast(room);
    }
  }

  const room = conn.room;
  const seat = conn.seat;
  const spec = conn.spec;
  if (!room || (seat === undefined && !spec)) return err('Not in a room');
  const myToken = spec ? spec.token : room.seats[seat!]!.token;
  const isHost = myToken === room.hostToken;
  const reindex = () => {
    room.seats.forEach((s, i) => { if (s.ws) conns.get(s.ws)!.seat = i; });
  };

  if (msg.type === 'speed') { // host only: how fast bots play (clients scale their own animations)
    if (!isHost) return;
    room.speed = [1, 2, 4, 8].includes(Number(msg.v)) ? Number(msg.v) : 1;
    return scheduleBots(room);
  }
  if (msg.type === 'cam') { // spectators pick whose side of the table they watch from
    if (!spec) return err('Not a spectator');
    spec.cam = Math.max(0, Number(msg.seat) | 0);
    return send(ws, view(room, { spec }));
  }
  if (spec) {
    const hostOnly = ['start', 'lobby', 'kick', 'addbot', 'rmbot'];
    if (!hostOnly.includes(msg.type) && msg.type !== 'sit') return err('Spectators cannot play');
  }
  if (msg.type === 'sit') { // spectator -> player (lobby only)
    if (!spec || room.game) return err('Not allowed');
    if (room.seats.length >= E.MAX_PLAYERS) return err('Room is full');
    room.specs.splice(room.specs.indexOf(spec), 1);
    room.seats.push({ name: spec.name, token: spec.token, ws });
    conn.spec = undefined; conn.seat = room.seats.length - 1;
    return broadcast(room);
  }
  if (msg.type === 'spectate') { // player -> spectator (lobby only)
    if (spec || room.game || seat === undefined) return err('Not allowed');
    const [me] = room.seats.splice(seat, 1);
    const sp: Spec = { name: me!.name, token: me!.token, ws, cam: 0 };
    room.specs.push(sp);
    conn.spec = sp; conn.seat = undefined;
    reindex();
    return broadcast(room);
  }


  const apply = (r: E.Result) => {
    if (!r.ok) return err(r.error);
    const before = room.game;
    room.game = r.state;
    broadcast(room, before ? deriveEvents(before, r.state, seat!, msg) : undefined);
  };

  switch (msg.type) {
    case 'start':
      if (!isHost) return err('Only the host can start');
      if (room.game && room.game.phase !== 'finished') return err('Already started');
      if (room.seats.length < E.MIN_PLAYERS) return err('Need at least 2 players');
      room.game = E.newGame(room.seats.map((s) => s.name));
      return broadcast(room, [{ t: 'deal' }]);
    case 'lobby': // back to lobby after a game
      if (!isHost) return err('Only the host can do that');
      if (room.game?.phase !== 'finished') return err('Game is still running');
      room.game = null;
      return broadcast(room);
    case 'kick': { // host removes a player (lobby only) or a spectator (any time)
      if (!isHost) return err('Not allowed');
      if (msg.spec !== undefined) {
        const [gone] = room.specs.splice(Number(msg.spec), 1);
        if (!gone || gone.token === room.hostToken) { if (gone) room.specs.push(gone); return err('Bad target'); }
        send(gone.ws, { type: 'kicked' });
        if (gone.ws) conns.set(gone.ws, {});
        return broadcast(room);
      }
      if (room.game) return err('Not allowed');
      const t = Number(msg.seat);
      if (!room.seats[t] || room.seats[t]!.token === room.hostToken) return err('Bad seat');
      const [gone] = room.seats.splice(t, 1);
      send(gone!.ws, { type: 'kicked' });
      reindex();
      if (gone!.ws) conns.set(gone!.ws, {});
      return broadcast(room);
    }
    case 'addbot': {
      if (!isHost || room.game) return err('Not allowed');
      if (room.seats.length >= E.MAX_PLAYERS) return err('Room is full');
      const used = new Set(room.seats.map((s) => s.name));
      const name = BOT_NAMES.find((n) => !used.has(n)) ?? 'Bot' + room.seats.length;
      room.seats.push({ name, token: randomBytes(12).toString('hex'), ws: null, bot: true });
      return broadcast(room);
    }
    case 'rmbot': { // removes the given bot, or the most recently added one
      if (!isHost || room.game) return err('Not allowed');
      let t = msg.seat === undefined ? -1 : Number(msg.seat);
      if (t < 0) for (let i = room.seats.length - 1; i >= 0; i--) if (room.seats[i]!.bot) { t = i; break; }
      if (!room.seats[t]?.bot) return err('No bot to remove');
      room.seats.splice(t, 1);
      reindex();
      return broadcast(room);
    }
    case 'swap':
      return apply(E.swap(room.game ?? ({} as E.State), seat!, Number(msg.handId), Number(msg.upId)));
    case 'ready':
      if (!room.game) return err('No game');
      return apply(E.setReady(room.game, seat!, msg.ready !== false));
    case 'play':
      if (!room.game || !Array.isArray(msg.ids)) return err('Bad request');
      return apply(E.play(room.game, seat!, msg.ids.map(Number)));
    case 'pickup':
      if (!room.game) return err('No game');
      return apply(E.pickup(room.game, seat!));
    case 'joker':
      if (!room.game) return err('No game');
      return apply(E.jokerTarget(room.game, seat!, Number(msg.target)));
    case 'parry':
      if (!room.game) return err('No game');
      return apply(E.parry(room.game, seat!));
    case 'accept':
      if (!room.game) return err('No game');
      return apply(E.acceptJoker(room.game, seat!));
    default:
      return err('Unknown message');
  }
}

wss.on('connection', (ws) => {
  conns.set(ws, {});
  ws.on('message', (data) => {
    let msg: any;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    try { handle(ws, msg); } catch (e) { console.error(e); send(ws, { type: 'error', msg: 'Server error' }); }
  });
  ws.on('close', () => {
    const { room, seat, spec } = conns.get(ws) ?? {};
    if (!room) return;
    const s = spec ?? (seat === undefined ? undefined : room.seats[seat]);
    if (s && s.ws === ws) { s.ws = null; broadcast(room); }
  });
  ws.on('error', () => {});
});

// Keepalive pings (phones/proxies) and stale room cleanup.
setInterval(() => {
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.ping();
  const now = Date.now();
  for (const [code, r] of rooms)
    if (now - r.lastActive > 6 * 3600_000 && r.seats.every((s) => !s.ws) && r.specs.every((s) => !s.ws)) { clearTimeout(r.botTimer); rooms.delete(code); }
}, 25_000);

server.listen(PORT, () => console.log(`Shithead server on http://localhost:${PORT}`));
