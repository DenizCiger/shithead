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

interface Seat { name: string; token: string; ws: WebSocket | null }
interface Room {
  code: string;
  seats: Seat[]; // seat index == engine seat
  game: E.State | null;
  lastActive: number;
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
function view(room: Room, seat: number) {
  const g = room.game;
  const base = {
    type: 'state',
    code: room.code,
    you: seat,
    host: seat === 0,
    seats: room.seats.map((s, i) => ({ seat: i, name: s.name, connected: !!s.ws })),
  };
  if (!g) return { ...base, phase: 'lobby' };
  const me = g.players[seat]!;
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
    hand: me.hand.map(pubCard),
    zone: E.zoneOf(me),
    playable: E.playableRanks(g, seat),
    canPickup: E.canPickup(g, seat),
    parryId: g.pendingJoker?.parry?.to === seat ? (me.hand.find((c) => c.rank === E.JOKER)?.id ?? null) : null,
    downIds: E.zoneOf(me) === 'down' && g.current === seat && g.phase === 'playing' && !g.pendingJoker ? me.down.map((c) => c.id) : [],
  };
}

function broadcast(room: Room, events?: Ev[]) {
  room.lastActive = Date.now();
  room.seats.forEach((s, i) => send(s.ws, events ? { ...view(room, i), events } : view(room, i)));
}

interface Conn { room?: Room; seat?: number }
const conns = new WeakMap<WebSocket, Conn>();

const cleanName = (n: unknown) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Player';

function handle(ws: WebSocket, msg: any) {
  const conn = conns.get(ws)!;
  const err = (m: string) => send(ws, { type: 'error', msg: m });

  switch (msg.type) {
    case 'create': {
      const code = genCode();
      const token = randomBytes(12).toString('hex');
      const room: Room = { code, seats: [{ name: cleanName(msg.name), token, ws }], game: null, lastActive: Date.now() };
      rooms.set(code, room);
      conn.room = room; conn.seat = 0;
      send(ws, { type: 'joined', code, token, seat: 0 });
      return broadcast(room);
    }
    case 'join': {
      const room = rooms.get(String(msg.code ?? '').toUpperCase());
      if (!room) return err('Room not found');
      // Rejoin with token
      const existing = msg.token ? room.seats.findIndex((s) => s.token === msg.token) : -1;
      if (existing >= 0) {
        const s = room.seats[existing]!;
        if (s.ws && s.ws !== ws) s.ws.close();
        s.ws = ws;
        conn.room = room; conn.seat = existing;
        send(ws, { type: 'joined', code: room.code, token: s.token, seat: existing });
        return broadcast(room);
      }
      if (room.game) return err('Game already started');
      if (room.seats.length >= E.MAX_PLAYERS) return err('Room is full');
      const token = randomBytes(12).toString('hex');
      room.seats.push({ name: cleanName(msg.name), token, ws });
      conn.room = room; conn.seat = room.seats.length - 1;
      send(ws, { type: 'joined', code: room.code, token, seat: conn.seat });
      return broadcast(room);
    }
  }

  const room = conn.room;
  const seat = conn.seat;
  if (!room || seat === undefined) return err('Not in a room');

  const apply = (r: E.Result) => {
    if (!r.ok) return err(r.error);
    const before = room.game;
    room.game = r.state;
    broadcast(room, before ? deriveEvents(before, r.state, seat, msg) : undefined);
  };

  switch (msg.type) {
    case 'start':
      if (seat !== 0) return err('Only the host can start');
      if (room.game && room.game.phase !== 'finished') return err('Already started');
      if (room.seats.length < E.MIN_PLAYERS) return err('Need at least 2 players');
      room.game = E.newGame(room.seats.map((s) => s.name));
      return broadcast(room, [{ t: 'deal' }]);
    case 'lobby': // back to lobby after a game
      if (seat !== 0) return err('Only the host can do that');
      if (room.game?.phase !== 'finished') return err('Game is still running');
      room.game = null;
      return broadcast(room);
    case 'kick': { // host removes a seat in the lobby only
      if (seat !== 0 || room.game) return err('Not allowed');
      const t = Number(msg.seat);
      if (!(t > 0 && t < room.seats.length)) return err('Bad seat');
      const [gone] = room.seats.splice(t, 1);
      send(gone!.ws, { type: 'kicked' });
      // fix seat indices of remaining connections
      for (const [i, s] of room.seats.entries()) if (s.ws) conns.get(s.ws)!.seat = i;
      if (gone!.ws) conns.set(gone!.ws, {});
      return broadcast(room);
    }
    case 'swap':
      return apply(E.swap(room.game ?? ({} as E.State), seat, Number(msg.handId), Number(msg.upId)));
    case 'ready':
      if (!room.game) return err('No game');
      return apply(E.setReady(room.game, seat, msg.ready !== false));
    case 'play':
      if (!room.game || !Array.isArray(msg.ids)) return err('Bad request');
      return apply(E.play(room.game, seat, msg.ids.map(Number)));
    case 'pickup':
      if (!room.game) return err('No game');
      return apply(E.pickup(room.game, seat));
    case 'joker':
      if (!room.game) return err('No game');
      return apply(E.jokerTarget(room.game, seat, Number(msg.target)));
    case 'parry':
      if (!room.game) return err('No game');
      return apply(E.parry(room.game, seat));
    case 'accept':
      if (!room.game) return err('No game');
      return apply(E.acceptJoker(room.game, seat));
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
    const { room, seat } = conns.get(ws) ?? {};
    if (!room || seat === undefined) return;
    const s = room.seats[seat];
    if (s && s.ws === ws) { s.ws = null; broadcast(room); }
  });
  ws.on('error', () => {});
});

// Keepalive pings (phones/proxies) and stale room cleanup.
setInterval(() => {
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.ping();
  const now = Date.now();
  for (const [code, r] of rooms)
    if (now - r.lastActive > 6 * 3600_000 && r.seats.every((s) => !s.ws)) rooms.delete(code);
}, 25_000);

server.listen(PORT, () => console.log(`Shithead server on http://localhost:${PORT}`));
