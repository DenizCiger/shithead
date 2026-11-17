import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.ts';
import type { Card, State } from '../src/engine.ts';

let nid = 1000;
const C = (rank: number, suit: Card['suit'] = 'H'): Card => ({ id: nid++, rank, suit });

/** Build a playing state with given hands (up/down get filler so nobody is out). */
function mk(hands: Card[][], pile: Card[] = [], opts: { deck?: Card[]; up?: Card[][]; down?: Card[][] } = {}): State {
  const s = E.newGame(hands.map((_, i) => 'P' + i), E.mulberry32(1));
  s.phase = 'playing';
  s.deck = opts.deck ?? [];
  s.pile = pile;
  s.players.forEach((p, i) => {
    p.hand = hands[i]!;
    p.up = opts.up?.[i] ?? [C(14)];
    p.down = opts.down?.[i] ?? [C(14)];
  });
  s.current = 0;
  return s;
}
const ok = (r: E.Result): State => { assert.ok(r.ok, r.ok ? '' : r.error); return (r as any).state; };
const bad = (r: E.Result) => assert.equal(r.ok, false);

test('normal: equal or higher, specials always', () => {
  const s = mk([[C(5), C(2), C(3), C(10), C(9)], [C(4)]], [C(8)]);
  bad(E.play(s, 0, [s.players[0]!.hand[0]!.id])); // 5 on 8
  ok(E.play(s, 0, [s.players[0]!.hand[1]!.id])); // 2
});
test('3 is transparent', () => {
  const s = mk([[C(5)], [C(4)]], [C(9), C(3)]);
  bad(E.play(s, 0, [s.players[0]!.hand[0]!.id]));
});
test('7: 7 or lower; J: only J', () => {
  assert.ok(E.rankAllowed(6, [C(7)]));
  assert.ok(!E.rankAllowed(8, [C(7)]));
  assert.ok(E.rankAllowed(10, [C(7)]));
  assert.ok(E.rankAllowed(11, [C(11)]));
  assert.ok(!E.rankAllowed(12, [C(11)]));
  assert.ok(E.rankAllowed(3, [C(11)]));
});
test('10 burns and player goes again', () => {
  const s = mk([[C(10), C(5)], [C(4)], [C(6)]], [C(9)]);
  const n = ok(E.play(s, 0, [s.players[0]!.hand[0]!.id]));
  assert.equal(n.pile.length, 0); assert.equal(n.current, 0);
});
test('four in a row burns, 3 breaks the chain', () => {
  let s = mk([[C(9)], [C(5)]], [C(9), C(9), C(9)]);
  assert.equal(ok(E.play(s, 0, [s.players[0]!.hand[0]!.id])).pile.length, 0);
  s = mk([[C(9)], [C(5)]], [C(9), C(9), C(3), C(9)]);
  assert.equal(ok(E.play(s, 0, [s.players[0]!.hand[0]!.id])).pile.length, 5);
});
test('8s stack skips, can skip yourself', () => {
  const s = mk([[C(8), C(8, 'S')], [C(5)], [C(5)]]);
  const n = ok(E.play(s, 0, s.players[0]!.hand.map((c) => c.id)));
  assert.equal(n.current, 0);
});
test('4 reverses; 2 players acts as skip', () => {
  const s = mk([[C(4), C(9)], [C(5)], [C(5)]]);
  const n = ok(E.play(s, 0, [s.players[0]!.hand[0]!.id]));
  assert.equal(n.direction, -1); assert.equal(n.current, 2);
  const s2 = mk([[C(4), C(9)], [C(5)]]);
  assert.equal(ok(E.play(s2, 0, [s2.players[0]!.hand[0]!.id])).current, 0);
});
test('67 combo: one 6 then one 7, repeatable as 6,7,6,7', () => {
  const s = mk([[C(6), C(6, 'S'), C(7), C(7, 'S'), C(9)], [C(5)]], [C(5)]);
  const [s1, s2, v1, v2, nine] = s.players[0]!.hand.map((c) => c.id) as [number, number, number, number, number];
  assert.equal(ok(E.play(s, 0, [s1, v1])).pile.length, 3);
  const n = ok(E.play(s, 0, [s1, v1, s2, v2]));
  assert.deepEqual(n.pile.slice(1).map((c) => c.rank), [6, 7, 6, 7]);
  assert.equal(n.current, 1);
  bad(E.play(s, 0, [s1, s2, v1])); // 6 + 6 + 7
  bad(E.play(s, 0, [s1, v1, v2])); // 6 + 7 + 7
  bad(E.play(s, 0, [s1, s2, v1, v2])); // pairs out of order
  bad(E.play(s, 0, [v1, s1])); // 7 first
  bad(E.play(s, 0, [s1, nine]));
});
test('67 combo: three pairs burn the pile and you go again', () => {
  const sixes = [C(6), C(6, 'S'), C(6, 'D')], sevens = [C(7), C(7, 'S'), C(7, 'D')];
  const s = mk([[...sixes, ...sevens, C(9)], [C(5)]], [C(5)]);
  const ids = sixes.flatMap((c, i) => [c.id, sevens[i]!.id]);
  const n = ok(E.play(s, 0, ids));
  assert.equal(n.pile.length, 0); assert.equal(n.current, 0); assert.equal(n.burnedCount, 7);
  const two = ok(E.play(s, 0, ids.slice(0, 4)));
  assert.equal(two.pile.length, 5); assert.equal(two.current, 1);
});
test('67 where the 6 completes four of a kind: the whole throw burns and you go again', () => {
  const s = mk([[C(6), C(7), C(9)], [C(5)]], [C(6, 'D'), C(6, 'C'), C(6, 'S')]);
  const n = ok(E.play(s, 0, s.players[0]!.hand.slice(0, 2).map((c) => c.id)));
  assert.equal(n.pile.length, 0); assert.equal(n.current, 0); assert.equal(n.burnedCount, 5);
});
test('67 combo: legal moves offer only 6,7 pairs', () => {
  const s = mk([[C(6), C(6, 'S'), C(7), C(9)], [C(5)]], [C(5)]);
  const byId = new Map(s.players[0]!.hand.map((c) => [c.id, c.rank]));
  const combos = E.legalMoves(s, 0).flatMap((m) => (m.t === 'play' && new Set(m.ids.map((id) => byId.get(id))).size > 1 ? [m.ids.map((id) => byId.get(id))] : []));
  assert.deepEqual(combos, [[6, 7]]);
});
test('cannot play: pickup passes turn', () => {
  const s = mk([[C(5)], [C(4)]], [C(9)]);
  const n = ok(E.pickup(s, 0));
  assert.equal(n.players[0]!.hand.length, 2); assert.equal(n.current, 1); assert.equal(n.pile.length, 0);
});
test('joker revives finished player', () => {
  const s = mk([[C(E.JOKER, 'X')], [C(5)], [C(6)]], [C(9)]);
  s.players[0]!.up = []; s.players[0]!.down = [];
  s.players[2]!.hand = []; s.players[2]!.up = []; s.players[2]!.down = []; s.finished = [2];
  let n = ok(E.play(s, 0, [s.players[0]!.hand[0]!.id]));
  assert.ok(n.pendingJoker); assert.equal(n.phase, 'playing');
  n = ok(E.jokerTarget(n, 0, 2));
  assert.equal(n.players[2]!.hand.length, 1); assert.deepEqual(n.finished, [0]);
  assert.equal(n.current, 1);
});
test('joker target without a joker takes the pile at once', () => {
  const s = mk([[C(E.JOKER, 'X'), C(5)], [C(6)], [C(7)]], [C(9), C(10 - 1)]);
  let n = ok(E.play(s, 0, [s.players[0]!.hand.find((c) => c.rank === E.JOKER)!.id]));
  n = ok(E.jokerTarget(n, 0, 1));
  assert.equal(n.pendingJoker, null); assert.equal(n.players[1]!.hand.length, 3); assert.equal(n.current, 0);
});
test('joker can be parried back, and ping-pongs while both sides hold jokers', () => {
  const s = mk([[C(E.JOKER, 'X'), C(5)], [C(E.JOKER, 'X'), C(E.JOKER, 'X'), C(6)], [C(7)]], [C(9), C(12)]);
  let n = ok(E.play(s, 0, [s.players[0]!.hand.find((c) => c.rank === E.JOKER)!.id]));
  n = ok(E.jokerTarget(n, 0, 1));
  assert.deepEqual(n.pendingJoker, { by: 0, parry: { from: 0, to: 1 } });
  assert.equal(E.actingSeat(n), 1);
  assert.ok(!E.play(n, 1, [n.players[1]!.hand[0]!.id]).ok, 'cannot play normally while a parry is pending');
  assert.ok(!E.parry(n, 2).ok); assert.ok(!E.acceptJoker(n, 0).ok);
  const burned = n.burnedCount;
  n = ok(E.parry(n, 1)); // 0 has no joker left in hand -> the pile lands on them
  assert.equal(n.pendingJoker, null); assert.equal(n.burnedCount, burned + 1);
  assert.equal(n.players[0]!.hand.length, 3); assert.equal(n.players[1]!.hand.filter((c) => c.rank === E.JOKER).length, 1);
  assert.equal(n.current, 0); assert.equal(n.pile.length, 0);
});
test('parry ping-pong: both hold two jokers', () => {
  const J = () => C(E.JOKER, 'X');
  const s = mk([[J(), J(), C(5)], [J(), J(), C(6)], [C(7)]], [C(9)]);
  let n = ok(E.play(s, 0, [s.players[0]!.hand.find((c) => c.rank === E.JOKER)!.id]));
  n = ok(E.jokerTarget(n, 0, 1)); n = ok(E.parry(n, 1));
  assert.deepEqual(n.pendingJoker, { by: 0, parry: { from: 1, to: 0 } });
  n = ok(E.parry(n, 0)); // back at 1, who has one joker left
  assert.deepEqual(n.pendingJoker, { by: 0, parry: { from: 0, to: 1 } });
  n = ok(E.acceptJoker(n, 1));
  assert.equal(n.pendingJoker, null); assert.equal(n.players[1]!.hand.length, 1 + 1 + 1); assert.equal(n.current, 0);
});
test('blind flip failing picks up pile + card', () => {
  const s = mk([[], [C(4)]], [C(12)], { up: [[], [C(14)]], down: [[C(5)], [C(14)]] });
  const n = ok(E.play(s, 0, [s.players[0]!.down[0]!.id]));
  assert.equal(n.players[0]!.hand.length, 2); assert.equal(n.current, 1);
});

test('fuzz: random playouts conserve cards and terminate', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rng = E.mulberry32(seed);
    const np = 2 + (seed % 5);
    let s = E.newGame(Array.from({ length: np }, (_, i) => 'P' + i), rng);
    const totalCards = E.allCards(s).length;
    for (let i = 0; i < np; i++) if (rng() < 0.5) { const p = s.players[i]!; s = ok(E.swap(s, i, p.hand[0]!.id, p.up[0]!.id)); }
    for (let i = 0; i < np; i++) s = ok(E.setReady(s, i));
    assert.equal(s.phase, 'playing');
    let steps = 0;
    while (s.phase === 'playing') {
      assert.ok(++steps < 20000, `seed ${seed} did not terminate`);
      const actor = E.actingSeat(s);
      assert.ok(s.pendingJoker || E.isActive(s, s.current), 'current must be active');
      const moves = E.legalMoves(s, actor);
      assert.ok(moves.length, `seed ${seed}: no moves`);
      // bias toward playing; pick pickup rarely
      const plays = moves.filter((m) => m.t !== 'pickup');
      const m = plays.length && rng() < 0.9 ? plays[Math.floor(rng() * plays.length)]! : moves[Math.floor(rng() * moves.length)]!;
      const r = E.applyAction(s, actor, m);
      assert.ok(r.ok, r.ok ? '' : r.error);
      s = (r as any).state;
      assert.equal(E.allCards(s).length + s.burnedCount, totalCards, 'conservation');
    }
    assert.ok(s.shithead !== null);
  }
});

test('default deck count is ceil(players / 2)', () => {
  assert.deepEqual([2, 3, 4, 5, 6].map(E.defaultDecks), [1, 2, 2, 3, 3]);
  for (const n of [2, 4, 5]) {
    const s = E.newGame(Array.from({ length: n }, (_, i) => 'P' + i), E.mulberry32(3));
    assert.equal(E.allCards(s).length, 54 * Math.ceil(n / 2));
  }
  assert.equal(E.allCards(E.newGame(['a', 'b'], E.mulberry32(3), 2)).length, 108);
});

// ---------------------------------------------------------------- room rules

const withRules = (s: State, r: Partial<E.Rules>): State => { s.rules = E.normalizeRules({ ...s.rules, ...r }); return s; };

test('classic: 3 is an ordinary card, no transparency', () => {
  const s = withRules(mk([[C(3), C(9)], [C(5)]], [C(9)]), E.CLASSIC);
  bad(E.play(s, 0, [s.players[0]!.hand[0]!.id])); // a 3 on a 9 is illegal
  assert.equal(E.effectiveTop([C(9), C(3)], E.CLASSIC)!.rank, 3);
  assert.equal(E.effectiveTop([C(9), C(3)], E.AHIF)!.rank, 9);
});
test('classic: 4 does not reverse, 8 does not skip, 6+7 is not a combo', () => {
  let s = withRules(mk([[C(4), C(9)], [C(5)], [C(5)]], [C(2)]), E.CLASSIC);
  let n = ok(E.play(s, 0, [s.players[0]!.hand[0]!.id]));
  assert.equal(n.direction, 1); assert.equal(n.current, 1);
  s = withRules(mk([[C(8), C(9)], [C(5)], [C(5)]], [C(2)]), E.CLASSIC);
  n = ok(E.play(s, 0, [s.players[0]!.hand[0]!.id]));
  assert.equal(n.current, 1);
  s = withRules(mk([[C(6), C(7), C(9)], [C(5)]], [C(5)]), E.CLASSIC);
  bad(E.play(s, 0, [s.players[0]!.hand[0]!.id, s.players[0]!.hand[1]!.id]));
});
test('10 and four-of-a-kind burns can be switched off', () => {
  let s = withRules(mk([[C(10), C(5)], [C(4)]], [C(9)]), { r10: false });
  let n = ok(E.play(s, 0, [s.players[0]!.hand[0]!.id]));
  assert.equal(n.pile.length, 2); assert.equal(n.current, 1);
  s = withRules(mk([[C(9)], [C(5)]], [C(9), C(9), C(9)]), { four: false });
  assert.equal(ok(E.play(s, 0, [s.players[0]!.hand[0]!.id])).pile.length, 4);
});
test('parry off: a joker holder simply takes the pile', () => {
  const s = withRules(mk([[C(E.JOKER, 'X'), C(5)], [C(E.JOKER, 'X'), C(6)], [C(7)]], [C(9)]), { parry: false });
  let n = ok(E.play(s, 0, [s.players[0]!.hand[0]!.id]));
  n = ok(E.jokerTarget(n, 0, 1));
  assert.equal(n.pendingJoker, null); assert.equal(n.players[1]!.hand.length, 3);
});
test('jokers off: no jokers in the deck, and parry/random are forced off', () => {
  const r = E.normalizeRules({ jokers: false, parry: true, randomJoker: true });
  assert.ok(!r.parry && !r.randomJoker);
  assert.equal(E.allCards(E.newGame(['a', 'b'], E.mulberry32(2), 1, r)).length, 52);
});
test('expert difficulty: an illegal play takes the pile; other difficulties just refuse', () => {
  const mkp = (d: E.Difficulty) => withRules(mk([[C(5), C(9)], [C(4)]], [C(12), C(13)]), { difficulty: d });
  bad(E.play(mkp('normal'), 0, [mkp('normal').players[0]!.hand[0]!.id]));
  const s = mkp('expert');
  const n = ok(E.play(s, 0, [s.players[0]!.hand[0]!.id]));
  assert.equal(n.pile.length, 0); assert.equal(n.players[0]!.hand.length, 4); assert.equal(n.current, 1);
});
test('fuzz: random rule sets conserve cards and terminate', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = E.mulberry32(seed + 900);
    const rules = E.normalizeRules(Object.fromEntries(E.RULE_KEYS.map((k) => [k, rng() < 0.6])) as Partial<E.Rules>);
    const np = 2 + (seed % 5);
    let s = E.newGame(Array.from({ length: np }, (_, i) => 'P' + i), rng, undefined, rules);
    const total = E.allCards(s).length;
    for (let i = 0; i < np; i++) s = ok(E.setReady(s, i));
    let steps = 0;
    while (s.phase === 'playing') {
      assert.ok(++steps < 300000, `seed ${seed} did not terminate`);
      const actor = E.actingSeat(s);
      const moves = E.legalMoves(s, actor);
      assert.ok(moves.length, `seed ${seed}: no moves`);
      const plays = moves.filter((m) => m.t !== 'pickup');
      const m = plays.length && rng() < 0.9 ? plays[Math.floor(rng() * plays.length)]! : moves[Math.floor(rng() * moves.length)]!;
      s = ok(E.applyAction(s, actor, m));
      assert.equal(E.allCards(s).length + s.burnedCount, total);
    }
  }
});
