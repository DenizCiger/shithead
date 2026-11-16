import WebSocket from 'ws';
const url = 'ws://localhost:' + (process.env.PORT || 3999);
const mk = (name) => new Promise((res) => { const ws = new WebSocket(url); ws.on('open', () => res({ ws, name, st: null })); });
const clients = await Promise.all(['A', 'B', 'C', 'D'].map(mk));
let code, done = false, moves = 0, parried = 0;
for (const c of clients) {
  c.ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.type === 'joined') { code = m.code; }
    if (m.type === 'error') console.log(c.name, 'ERR', m.msg);
    if (m.type !== 'state') return;
    c.st = m;
    if (m.phase === 'lobby' && c === clients[0] && m.seats.length === 4) c.ws.send(JSON.stringify({ type: 'start' }));
    if (m.phase === 'lobby' && c === clients[0] && m.seats.length < 4 && !c.joinedOthers) { c.joinedOthers = true; clients.slice(1).forEach((o) => o.ws.send(JSON.stringify({ type: 'join', code: m.code, name: o.name }))); }
    if (m.phase === 'swap' && !m.players[m.you].ready) c.ws.send(JSON.stringify({ type: 'ready' }));
    if (m.phase === 'finished' && !done) { done = true; console.log('FINISHED shithead=', m.players[m.shithead].name, 'moves', moves, 'parries', parried, 'deck was', 'ok'); process.exit(0); }
    if (m.phase !== 'playing') return;
    if (m.pendingJoker && m.pendingJoker.parry) { if (m.pendingJoker.parry.to === m.you) { m.parryId != null && Math.random() < 0.7 ? (parried++, c.ws.send(JSON.stringify({ type: 'parry' }))) : c.ws.send(JSON.stringify({ type: 'accept' })); } return; }
    if (m.pendingJoker && m.pendingJoker.by === m.you) { const t = m.players.find((p) => p.seat !== m.you); c.ws.send(JSON.stringify({ type: 'joker', target: t.seat })); return; }
    if (m.pendingJoker || m.current !== m.you) return;
    moves++;
    if (m.downIds.length) return c.ws.send(JSON.stringify({ type: 'play', ids: [m.downIds[0]] }));
    const zoneCards = m.zone === 'hand' ? m.hand : m.players[m.you].up;
    const r = m.playable[0];
    if (r === undefined) return c.ws.send(JSON.stringify({ type: 'pickup' }));
    c.ws.send(JSON.stringify({ type: 'play', ids: [zoneCards.find((x) => x.rank === r).id] }));
  });
}
clients[0].ws.send(JSON.stringify({ type: 'create', name: 'A' }));
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 20000);
