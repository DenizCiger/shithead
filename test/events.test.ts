import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.ts';
import { deriveEvents } from '../src/events.ts';
import type { Card, State } from '../src/engine.ts';

let nid = 5000;
const C = (rank: number, suit: Card['suit'] = 'H'): Card => ({ id: nid++, rank, suit });
const J = () => C(E.JOKER, 'X');

function mk(hands: Card[][], pile: Card[]): State {
  const s = E.newGame(hands.map((_, i) => 'P' + i), E.mulberry32(1));
  s.phase = 'playing';
  s.deck = [];
  s.players.forEach((p, i) => { p.hand = hands[i]!; p.up = [C(14)]; p.down = [C(13)]; p.ready = true; });
  s.pile = pile;
  s.current = 0;
  return s;
}
const ok = (r: E.Result): State => { assert.ok(r.ok, r.ok ? '' : r.error); return (r as { state: State }).state; };
const types = (evs: { t: string }[]) => evs.map((e) => e.t);

test('events: joker thrown at a joker holder, parried, then taken', () => {
  const s0 = mk([[J(), C(5)], [J(), J(), C(6)], [C(7)]], [C(9)]);
  const play = { type: 'play', ids: [s0.players[0]!.hand[0]!.id] };
  const s1 = ok(E.play(s0, 0, play.ids));
  assert.deepEqual(types(deriveEvents(s0, s1, 0, play)), ['play', 'joker', 'turn']);

  const target = { type: 'joker', target: 1 };
  const s2 = ok(E.jokerTarget(s1, 0, 1));
  assert.deepEqual(deriveEvents(s1, s2, 0, target), [{ t: 'throw', by: 0, target: 1 }]);

  const s3 = ok(E.parry(s2, 1)); // seat 0 has no joker left: the pile lands on them
  const evs = deriveEvents(s2, s3, 1, { type: 'parry' });
  assert.deepEqual(types(evs).slice(0, 2), ['parry', 'give']);
  assert.deepEqual(evs[0], { t: 'parry', seat: 1, to: 0, burned: 1 });
  assert.deepEqual(evs[1], { t: 'give', by: 1, target: 0, count: 1, revived: false });
});


test('events: an expert misplay carries the shot flag', () => {
  const s0 = mk([[C(5), C(9)], [C(4)]], [C(12)]);
  s0.rules = E.normalizeRules({ difficulty: 'expert', shot: true });
  const play = { type: 'play', ids: [s0.players[0]!.hand[0]!.id] };
  const evs = deriveEvents(s0, ok(E.play(s0, 0, play.ids)), 0, play);
  assert.deepEqual(evs[0], { t: 'pickup', seat: 0, count: 1, penalty: true, shot: true });
});


test('events: accept gives the pile to the decider', () => {
  const s0 = mk([[J(), C(5)], [J(), C(6)], [C(7)]], [C(9), C(10 - 1)]);
  let s = ok(E.play(s0, 0, [s0.players[0]!.hand[0]!.id]));
  s = ok(E.jokerTarget(s, 0, 1));
  const n = ok(E.acceptJoker(s, 1));
  const evs = deriveEvents(s, n, 1, { type: 'accept' });
  assert.deepEqual(evs[0], { t: 'give', by: 0, target: 1, count: 2, revived: false });
  assert.equal(n.current, 0);
});
