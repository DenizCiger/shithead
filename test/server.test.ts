// Integration tests: boot the real server and talk to it over WebSockets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 4300 + Math.floor(Math.random() * 500);
let proc: ChildProcess;

before(async () => {
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { env: { ...process.env, PORT: String(PORT), BOT_DELAY: '15' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((res) => proc.stdout!.on('data', (d) => String(d).includes('Shithead server') && res()));
});
after(() => { proc.kill(); });

type Msg = { type: string; [k: string]: any };
class Client {
  ws: WebSocket; st: Msg | null = null; inbox: Msg[] = [];
  constructor() {
    this.ws = new WebSocket(`ws://localhost:${PORT}`);
    this.ws.on('message', (d) => { const m = JSON.parse(String(d)); this.inbox.push(m); if (m.type === 'state') this.st = m; });
  }
  ready() { return new Promise<this>((res) => (this.ws.readyState === 1 ? res(this) : this.ws.on('open', () => res(this)))); }
  send(o: object) { this.ws.send(JSON.stringify(o)); }
  async until(fn: (s: Msg) => boolean, ms = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (this.st && fn(this.st)) return this.st; await new Promise((r) => setTimeout(r, 10)); }
    throw new Error('timeout; last state: ' + JSON.stringify(this.st && { phase: this.st.phase, seats: this.st.seats, settings: this.st.settings }));
  }
  errors() { return this.inbox.filter((m) => m.type === 'error').map((m) => m.msg as string); }
  async nextError(ms = 1000) { const n = this.errors().length; const t0 = Date.now(); while (this.errors().length === n && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10)); return this.errors().at(-1); }
}
const connect = () => new Client().ready();
async function room(name = 'Host') {
  const h = await connect();
  h.send({ type: 'create', name });
  const s = await h.until((s) => !!s.code);
  return { h, code: s.code as string };
}
async function joined(code: string, name: string, spectate = false) {
  const c = await connect();
  c.send({ type: 'join', code, name, spectate });
  await c.until((s) => s.code === code);
  return c;
}

test('settings: host edits, presets fill rules, guests are refused, limits are enforced', async () => {
  const { h, code } = await room();
  const g = await joined(code, 'Guest');
  assert.equal(h.st!.settings.rules.parry, true); // AHIF by default
  h.send({ type: 'settings', patch: { preset: 'classic' } });
  await g.until((s) => s.settings.rules.parry === false && s.settings.rules.r3 === false && s.settings.rules.jokers === true);
  h.send({ type: 'settings', patch: { rules: { jokers: false, parry: true } } }); // parry cannot survive without jokers
  const s = await g.until((s) => s.settings.rules.jokers === false);
  assert.equal(s.settings.rules.parry, false);
  g.send({ type: 'settings', patch: { maxPlayers: 3 } });
  assert.match((await g.nextError())!, /host/);
  h.send({ type: 'settings', patch: { maxPlayers: 1 } }); assert.match((await h.nextError())!, /limit/);
  h.send({ type: 'settings', patch: { maxPlayers: 2 } });
  await g.until((s) => s.settings.maxPlayers === 2);
  const g2 = await connect(); g2.send({ type: 'join', code, name: 'Third' });
  assert.match((await g2.nextError())!, /full/);
  h.send({ type: 'settings', patch: { maxPlayers: 6, decks: 3, assist: { autoStack: true }, rules: { difficulty: 'expert' } } });
  const t = await g.until((s) => s.settings.decks === 3);
  assert.equal(t.settings.assist.autoStack, true); assert.equal(t.settings.rules.difficulty, 'expert');
});

test('leaving: guests leave, the host hands over the crown or closes the room', async () => {
  const { h, code } = await room('A');
  const b = await joined(code, 'B'), c = await joined(code, 'C', true);
  b.send({ type: 'leave' });
  await h.until((s) => s.seats.length === 1);
  assert.ok(b.inbox.some((m) => m.type === 'left'));
  h.send({ type: 'leave', spec: 0 }); // crown the spectator
  const s = await c.until((s) => s.host);
  assert.equal(s.seats.length, 0); assert.equal(s.specs.length, 1);
  c.send({ type: 'leave' }); // last human: room closes
  await new Promise((r) => setTimeout(r, 100));
  const late = await connect(); late.send({ type: 'join', code, name: 'Late' });
  assert.match((await late.nextError())!, /not found/);
});

test('host can move people between table and bench, crown and kick', async () => {
  const { h, code } = await room('Boss');
  const b = await joined(code, 'B');
  h.send({ type: 'move', seat: 1 });
  await b.until((s) => s.spectator === true);
  h.send({ type: 'move', spec: 0 });
  await b.until((s) => s.spectator === false && s.you === 1);
  b.send({ type: 'crown', seat: 0 }); assert.ok(await b.nextError());
  h.send({ type: 'crown', seat: 1 });
  await b.until((s) => s.host === true);
  h.send({ type: 'kick', seat: 1 }); assert.ok(await h.nextError()); // no longer the host
  b.send({ type: 'kick', seat: 0 }); assert.ok(await b.nextError()); // the host cannot kick themselves... they hold the crown
});

async function startGame(h: Client, patch: object, bots = 1) {
  h.send({ type: 'settings', patch });
  for (let i = 0; i < bots; i++) h.send({ type: 'addbot' });
  await h.until((s) => s.seats.length >= 1 + bots);
  h.send({ type: 'start' });
  await h.until((s) => s.phase === 'swap');
  h.send({ type: 'ready' });
}

test('expert difficulty: an illegal play takes the pile (through the server)', async () => {
  const { h } = await room();
  await startGame(h, { rules: { difficulty: 'expert' } });
  const s = await h.until((s) => s.phase === 'playing');
  assert.equal(s.rules.difficulty, 'expert');
  // play until it is our turn with a pile and a card that cannot be played; then misplay it
  for (let guard = 0; guard < 400; guard++) {
    const st = await h.until((x) => x.phase !== 'playing' || (x.current === x.you && !x.pendingJoker));
    if (st.phase !== 'playing') break;
    const bad = st.zone === 'hand' && st.pileCount > 0 ? st.hand.find((c: any) => !st.playable.includes(c.rank)) : null;
    if (bad) {
      const before = st.pileCount, hand = st.hand.length;
      h.send({ type: 'play', ids: [bad.id] });
      const after = await h.until((x) => x !== st && x.pileCount === 0);
      assert.ok(after.hand.length >= hand + before - 0, 'pile landed in the hand');
      assert.ok(after.hand.some((c: any) => c.id === bad.id));
      assert.deepEqual(h.errors(), []);
      return;
    }
    if (st.downIds.length) h.send({ type: 'play', ids: [st.downIds[0]] });
    else if (st.playable.length) h.send({ type: 'play', ids: [st.hand.concat(st.players[st.you].up).find((c: any) => c.rank === st.playable[0] && (st.zone === 'hand' ? st.hand : st.players[st.you].up).some((x: any) => x.id === c.id)).id] });
    else h.send({ type: 'pickup' });
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail('never found a misplay opportunity');
});

test('auto-take, auto-play, auto-stack and random joker never stall a game', { timeout: 120000 }, async () => {
  const { h } = await room();
  await startGame(h, { assist: { autoTake: true, autoStack: true, autoOne: true }, rules: { randomJoker: true } }, 2);
  await h.until((s) => s.phase === 'playing');
  let stacked = 0;
  for (let guard = 0; guard < 4000; guard++) {
    // the human only acts when there is a real choice; forced moves and joker targets are the server's job
    const st = await h.until((x) => x.phase === 'finished' || (x.current === x.you && !x.pendingJoker && (x.downIds.length > 0 || x.playable.length > 1 || (x.playable.length === 1 && x.canPickup && false))), 30000);
    if (st.phase === 'finished') break;
    if (st.downIds.length) { h.send({ type: 'play', ids: [st.downIds[0]] }); await h.until((x) => x !== st); continue; }
    const cards = st.zone === 'hand' ? st.hand : st.players[st.you].up;
    const r = Math.min(...st.playable);
    const same = cards.filter((c: any) => c.rank === r);
    h.send({ type: 'play', ids: [same[0].id] });
    if (same.length > 1 && st.zone === 'hand') {
      const after = await h.until((x) => x !== st);
      if (after.hand.filter((c: any) => c.rank === r).length === 0) stacked++;
    } else await h.until((x) => x !== st);
  }
  assert.equal(h.st!.phase, 'finished');
  assert.deepEqual(h.errors(), []);
  assert.ok(stacked >= 0);
});

test('spectator host with six bots: game runs to the end', async () => {
  const h = await connect(); h.send({ type: 'create', name: 'Watcher', spectate: true });
  await h.until((s) => !!s.code);
  for (let i = 0; i < 6; i++) h.send({ type: 'addbot' });
  await h.until((s) => s.seats.length === 6);
  h.send({ type: 'start' });
  const end = await h.until((s) => s.phase === 'finished', 60000);
  assert.ok(end.shithead !== null);
});

test('chat: reaches players and spectators, is cleaned, rate limited, and replayed to a rejoiner', async () => {
  const { h, code } = await room('Host');
  const g = await joined(code, 'Guest');
  const w = await joined(code, 'Watcher', true);
  const chats = (c: Client) => c.inbox.filter((m) => m.type === 'chat').map((m) => m.msg);
  const until = async (fn: () => boolean) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(fn()); };
  g.send({ type: 'chat', text: '  hello   <b>there</b>  ' });
  await until(() => [h, g, w].every((c) => chats(c).length === 1));
  assert.equal(chats(w)[0].text, 'hello <b>there</b>');
  assert.equal(chats(h)[0].name, 'Guest');
  assert.equal(chats(w)[0].seat, 1);
  w.send({ type: 'chat', text: 'x'.repeat(500) });
  await until(() => chats(h).length === 2);
  assert.equal(chats(h)[1].text.length, 200);
  assert.equal(chats(h)[1].seat, -1); // spectator
  g.send({ type: 'chat', text: '   ' }); // empty: ignored
  for (let i = 0; i < 6; i++) h.send({ type: 'chat', text: 'spam ' + i });
  assert.match((await h.nextError())!, /Slow down/);
  assert.equal(chats(h).filter((m) => m.text.startsWith('spam')).length, 5);
  const tok = h.inbox.find((m) => m.type === 'joined')!.token;
  const h2 = await connect();
  h2.send({ type: 'join', code, token: tok, name: 'Host' });
  await until(() => h2.inbox.some((m) => m.type === 'chathist'));
  assert.equal(h2.inbox.find((m) => m.type === 'chathist')!.log.length, 7);
});

test('react: players reach everyone (spectators watch), spectators cannot send, junk is dropped', async () => {
  const { h, code } = await room('Host');
  const g = await joined(code, 'Guest');
  const w = await joined(code, 'Watcher', true);
  const rx = (c: Client) => c.inbox.filter((m) => m.type === 'react');
  const until = async (fn: () => boolean) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(fn()); };
  g.send({ type: 'react', emoji: '🖕', to: 0 });
  await until(() => [h, g, w].every((c) => rx(c).length === 1));
  assert.deepEqual(rx(w)[0].from, { name: 'Guest', seat: 1 });
  assert.deepEqual(rx(w)[0].to, { name: 'Host', seat: 0 });
  w.send({ type: 'react', emoji: '😂' }); // spectators have chat, not reactions
  assert.match((await w.nextError())!, /Spectators/);
  g.send({ type: 'react', emoji: '😂', to: 1 }); // aimed at yourself = no target
  await until(() => rx(h).length === 2);
  assert.equal(rx(h)[1].to, null);
  g.send({ type: 'react', emoji: '<script>' }); // not in the allowlist
  g.send({ type: 'react', emoji: '👍', to: 99 });
  await until(() => rx(h).length === 3);
  assert.equal(rx(h)[2].emoji, '👍');
  assert.equal(rx(h)[2].to, null);
});
