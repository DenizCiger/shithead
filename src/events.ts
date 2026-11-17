// Derives presentation events (what just happened) from an engine state transition.
// The client only ever receives state snapshots; these events let it animate the transition.
// Everything here is public information (played cards, counts), never hidden hands.
import * as E from './engine.ts';

export type Ev = { t: string; [k: string]: unknown };

const pub = (c: E.Card) => ({ id: c.id, rank: c.rank, suit: c.suit });

function tail(s: E.State, n: E.State, ev: Ev[]) {
  for (const x of n.finished) if (!s.finished.includes(x)) ev.push({ t: 'out', seat: x, place: n.finished.indexOf(x) + 1 });
  if (n.phase === 'finished' && s.phase !== 'finished') ev.push({ t: 'end', shithead: n.shithead });
  else if (n.current !== s.current || ev.length) ev.push({ t: 'turn', seat: n.current });
}

function diffPlay(s: E.State, n: E.State, seat: number, ids: number[]): Ev[] {
  const ev: Ev[] = [];
  const p = s.players[seat]!;
  const zone = E.zoneOf(p)!;
  const picked = ids.map((id) => p[zone].find((c) => c.id === id)!).map(pub);
  const cards = [...picked.filter((c) => c.rank === 6), ...picked.filter((c) => c.rank !== 6)];
  const penalty = zone !== 'down' && s.pile.length > 0 && n.pile.length === 0 && n.burnedCount === s.burnedCount
    && picked.every((c) => n.players[seat]![zone].some((x) => x.id === c.id));
  if (penalty) { // expert difficulty: the misplay just takes the pile
    ev.push({ t: 'pickup', seat, count: s.pile.length, penalty: true });
    tail(s, n, ev);
    return ev;
  }
  const failed = zone === 'down' && n.pile.length === 0 && n.players[seat]!.hand.length > p.hand.length;
  if (failed) {
    ev.push({ t: 'flipfail', seat, card: cards[0], count: s.pile.length + 1 });
  } else {
    ev.push({ t: 'play', seat, cards, zone, blind: zone === 'down', pileBefore: s.pile.length });
    if (cards.some((c) => c.rank === E.JOKER)) ev.push({ t: 'joker', seat, pending: !!n.pendingJoker });
    else if (n.burnedCount > s.burnedCount) ev.push({ t: 'burn', seat, count: n.burnedCount - s.burnedCount, by: cards[0]!.rank === 10 ? 'ten' : 'four' });
    if (n.direction !== s.direction) ev.push({ t: 'reverse', direction: n.direction });
    const eights = cards.filter((c) => c.rank === 8).length;
    if (eights && n.rules.r8 && n.burnedCount === s.burnedCount) ev.push({ t: 'skip', n: eights });
  }
  const drew = s.deck.length - n.deck.length;
  if (drew) ev.push({ t: 'draw', seat, n: drew });
  tail(s, n, ev);
  return ev;
}

/** Events for one accepted action. `s` is the state before, `n` the state after. */
export function deriveEvents(s: E.State, n: E.State, seat: number, msg: { type: string; [k: string]: unknown }): Ev[] {
  const ev: Ev[] = [];
  const pj = s.pendingJoker;
  switch (msg.type) {
    case 'swap': return [{ t: 'swap', seat }];
    case 'ready':
      ev.push({ t: 'ready', seat });
      if (n.phase === 'playing' && s.phase === 'swap') ev.push({ t: 'begin', seat: n.current }, { t: 'turn', seat: n.current });
      return ev;
    case 'play': return diffPlay(s, n, seat, (msg.ids as number[]).map(Number));
    case 'pickup':
      ev.push({ t: 'pickup', seat, count: s.pile.length });
      tail(s, n, ev);
      return ev;
    case 'joker': {
      const target = Number(msg.target);
      if (n.pendingJoker?.parry) return [{ t: 'throw', by: seat, target }];
      ev.push({ t: 'give', by: seat, target, count: s.pile.length, revived: !E.isActive(s, target) });
      tail(s, n, ev);
      return ev;
    }
    case 'parry': {
      const back = pj!.parry!.from;
      ev.push({ t: 'parry', seat, to: back, burned: n.burnedCount - s.burnedCount });
      if (n.pendingJoker?.parry) ev.push({ t: 'throw', by: seat, target: back });
      else ev.push({ t: 'give', by: seat, target: back, count: s.pile.length, revived: !E.isActive(s, back) });
      const d = s.deck.length - n.deck.length;
      if (d) ev.push({ t: 'draw', seat, n: d });
      tail(s, n, ev);
      return ev;
    }
    case 'accept':
      ev.push({ t: 'give', by: pj!.parry!.from, target: seat, count: s.pile.length, revived: !E.isActive(s, seat) });
      tail(s, n, ev);
      return ev;
  }
  return ev;
}
