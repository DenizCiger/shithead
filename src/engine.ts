// Pure rules engine for Shithead (custom rules). No I/O.
// All mutating functions return a new state (or an error) and never throw on bad input.

export type Suit = 'C' | 'D' | 'H' | 'S' | 'X';
export interface Card {
  id: number;
  rank: number; // 2..14 (11=J, 12=Q, 13=K, 14=A), 15 = Joker
  suit: Suit;
}
export const JOKER = 15;

export interface Player {
  name: string;
  hand: Card[];
  up: Card[];
  down: Card[];
  ready: boolean;
}

export type Phase = 'swap' | 'playing' | 'finished';

export interface State {
  phase: Phase;
  players: Player[];
  deck: Card[];
  pile: Card[];
  burnedCount: number;
  direction: 1 | -1;
  current: number;
  /** seats in the order they went out (a joker can revive a finished player, removing them) */
  finished: number[];
  pendingJoker: { by: number } | null;
  shithead: number | null;
  log: string[];
}

export type Result = { ok: true; state: State } | { ok: false; error: string };

export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export function rankName(r: number): string {
  if (r === JOKER) return 'Joker';
  if (r === 11) return 'J';
  if (r === 12) return 'Q';
  if (r === 13) return 'K';
  if (r === 14) return 'A';
  return String(r);
}

function buildDeck(decks: number): Card[] {
  const out: Card[] = [];
  let id = 0;
  const suits: Suit[] = ['C', 'D', 'H', 'S'];
  for (let d = 0; d < decks; d++) {
    for (const s of suits) for (let r = 2; r <= 14; r++) out.push({ id: id++, rank: r, suit: s });
    out.push({ id: id++, rank: JOKER, suit: 'X' });
    out.push({ id: id++, rank: JOKER, suit: 'X' });
  }
  return out;
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function newGame(names: string[], rng: Rng = Math.random): State {
  if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) throw new Error('2-6 players required');
  const deck = shuffle(buildDeck(names.length > 5 ? 2 : 1), rng);
  const players: Player[] = names.map((name) => ({ name, hand: [], up: [], down: [], ready: false }));
  for (const p of players) {
    for (let i = 0; i < 3; i++) p.down.push(deck.pop()!);
    for (let i = 0; i < 3; i++) p.up.push(deck.pop()!);
    for (let i = 0; i < 3; i++) p.hand.push(deck.pop()!);
    p.hand.sort(cmpCard);
    p.up.sort(cmpCard);
  }
  return {
    phase: 'swap',
    players,
    deck,
    pile: [],
    burnedCount: 0,
    direction: 1,
    current: 0,
    finished: [],
    pendingJoker: null,
    shithead: null,
    log: ['Swap your hand and face-up cards, then press Ready.'],
  };
}

export function cmpCard(a: Card, b: Card): number {
  return a.rank - b.rank || a.suit.localeCompare(b.suit) || a.id - b.id;
}

// ---------------------------------------------------------------- helpers

const clone = <T>(x: T): T => structuredClone(x);
const total = (p: Player) => p.hand.length + p.up.length + p.down.length;
export const isActive = (s: State, seat: number) => total(s.players[seat]!) > 0;
const activeCount = (s: State) => s.players.filter((p) => total(p) > 0).length;

function addLog(s: State, msg: string) {
  s.log.push(msg);
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40);
}

export type Zone = 'hand' | 'up' | 'down';
export function zoneOf(p: Player): Zone | null {
  if (p.hand.length) return 'hand';
  if (p.up.length) return 'up';
  if (p.down.length) return 'down';
  return null;
}

/** Top card that matters for restrictions: 3s are transparent. */
export function effectiveTop(pile: Card[]): Card | null {
  for (let i = pile.length - 1; i >= 0; i--) if (pile[i]!.rank !== 3) return pile[i]!;
  return null;
}

/** Can a card of `rank` be played on this pile? */
export function rankAllowed(rank: number, pile: Card[]): boolean {
  if (rank === 2 || rank === 3 || rank === 10 || rank === JOKER) return true;
  const top = effectiveTop(pile);
  if (!top) return true;
  if (top.rank === 7) return rank <= 7;
  if (top.rank === 11) return rank === 11;
  return rank >= top.rank;
}

/** Human-readable restriction for the UI. */
export function restriction(pile: Card[]): string {
  const top = effectiveTop(pile);
  if (!top) return 'Anything goes';
  if (top.rank === 7) return '7 or lower (or 2, 3, 10, Joker)';
  if (top.rank === 11) return 'J (or 2, 3, 10, Joker)';
  if (top.rank === 2) return 'Anything goes';
  return `${rankName(top.rank)} or higher (or 2, 3, 10, Joker)`;
}

function topRun(pile: Card[]): number {
  if (!pile.length) return 0;
  const r = pile[pile.length - 1]!.rank;
  let n = 0;
  for (let i = pile.length - 1; i >= 0 && pile[i]!.rank === r; i--) n++;
  return n;
}

/** Step `steps` active players from `from` in the given direction. */
function advance(s: State, from: number, steps: number): number {
  const n = s.players.length;
  let pos = from;
  for (let i = 0; i < steps; i++) {
    do {
      pos = (pos + s.direction + n) % n;
    } while (!isActive(s, pos));
  }
  return pos;
}

/** Ranks the seat could play right now from their active zone (single-rank view). */
export function playableRanks(s: State, seat: number): number[] {
  if (s.phase !== 'playing' || s.pendingJoker || s.current !== seat) return [];
  const p = s.players[seat]!;
  const z = zoneOf(p);
  if (!z || z === 'down') return [];
  const ranks = new Set<number>();
  for (const c of p[z]) if (rankAllowed(c.rank, s.pile)) ranks.add(c.rank);
  return [...ranks];
}

// ---------------------------------------------------------------- swap phase

export function swap(s: State, seat: number, handId: number, upId: number): Result {
  if (s.phase !== 'swap') return { ok: false, error: 'Not in swap phase' };
  const n = clone(s);
  const p = n.players[seat];
  if (!p) return { ok: false, error: 'Bad seat' };
  if (p.ready) return { ok: false, error: 'You are already ready' };
  const hi = p.hand.findIndex((c) => c.id === handId);
  const ui = p.up.findIndex((c) => c.id === upId);
  if (hi < 0 || ui < 0) return { ok: false, error: 'Card not found' };
  [p.hand[hi], p.up[ui]] = [p.up[ui]!, p.hand[hi]!];
  p.hand.sort(cmpCard);
  p.up.sort(cmpCard);
  return { ok: true, state: n };
}

export function setReady(s: State, seat: number, ready = true): Result {
  if (s.phase !== 'swap') return { ok: false, error: 'Not in swap phase' };
  const n = clone(s);
  const p = n.players[seat];
  if (!p) return { ok: false, error: 'Bad seat' };
  p.ready = ready;
  if (n.players.every((q) => q.ready)) startPlaying(n);
  return { ok: true, state: n };
}

const SUIT_ORDER: Record<Suit, number> = { C: 0, D: 1, H: 2, S: 3, X: 4 };

function startPlaying(n: State) {
  n.phase = 'playing';
  let best: { seat: number; c: Card } | null = null;
  n.players.forEach((p, seat) => {
    for (const c of p.hand) {
      if (c.rank === 2 || c.rank === 3 || c.rank === 10 || c.rank === JOKER) continue;
      if (!best || c.rank < best.c.rank || (c.rank === best.c.rank && SUIT_ORDER[c.suit] < SUIT_ORDER[best.c.suit]))
        best = { seat, c };
    }
  });
  n.current = best ? (best as { seat: number }).seat : 0;
  addLog(n, `${n.players[n.current]!.name} starts (lowest card).`);
}

// ---------------------------------------------------------------- playing

function cardLabel(c: Card) {
  return c.rank === JOKER ? 'Joker' : rankName(c.rank);
}

function finishOut(n: State, seat: number) {
  if (!n.finished.includes(seat)) {
    n.finished.push(seat);
    addLog(n, `${n.players[seat]!.name} is out!`);
  }
}

function checkEnd(n: State): boolean {
  if (activeCount(n) <= 1) {
    n.phase = 'finished';
    const last = n.players.findIndex((_, i) => isActive(n, i));
    n.shithead = last >= 0 ? last : null;
    n.pendingJoker = null;
    if (last >= 0) addLog(n, `${n.players[last]!.name} is the shithead! 💩`);
    return true;
  }
  return false;
}

function refill(n: State, p: Player) {
  while (p.hand.length < 3 && n.deck.length) p.hand.push(n.deck.pop()!);
  p.hand.sort(cmpCard);
}

/** Validate card selection; returns the cards (in play order) or an error. */
function selectCards(n: State, seat: number, ids: number[]): { cards: Card[]; zone: Zone } | string {
  const p = n.players[seat]!;
  const zone = zoneOf(p);
  if (!zone) return 'You have no cards';
  if (!ids.length) return 'Select at least one card';
  if (new Set(ids).size !== ids.length) return 'Duplicate cards';
  const cards: Card[] = [];
  for (const id of ids) {
    const c = p[zone].find((x) => x.id === id);
    if (!c) return zone === 'down' ? 'Flip one of your face-down cards' : `Those cards aren't in your ${zone === 'hand' ? 'hand' : 'face-up row'}`;
    cards.push(c);
  }
  if (zone === 'down' && cards.length !== 1) return 'Flip one face-down card at a time';
  return { cards, zone };
}

export function play(s: State, seat: number, ids: number[]): Result {
  if (s.phase !== 'playing') return { ok: false, error: 'Game is not running' };
  if (s.pendingJoker) return { ok: false, error: 'Waiting for joker target' };
  if (s.current !== seat) return { ok: false, error: 'Not your turn' };
  const n = clone(s);
  const sel = selectCards(n, seat, ids);
  if (typeof sel === 'string') return { ok: false, error: sel };
  const p = n.players[seat]!;
  const { zone } = sel;
  let cards = sel.cards;

  // Group by rank. Allowed: one rank, or the 6+7 combo.
  const ranks = [...new Set(cards.map((c) => c.rank))];
  let combo = false;
  if (ranks.length > 1) {
    if (ranks.length === 2 && ranks.includes(6) && ranks.includes(7)) {
      combo = true;
      cards = [...cards.filter((c) => c.rank === 6), ...cards.filter((c) => c.rank === 7)];
    } else return { ok: false, error: 'You can only play cards of the same rank (6s may be followed by 7s)' };
  }
  const first = cards[0]!.rank;
  const name = p.name;

  // Face-down flip: reveal; if illegal, pick up pile + card.
  if (zone === 'down') {
    const c = cards[0]!;
    p.down = p.down.filter((x) => x.id !== c.id);
    if (!rankAllowed(c.rank, n.pile)) {
      addLog(n, `${name} flips a ${cardLabel(c)} blind — can't play it and picks up the pile.`);
      p.hand.push(...n.pile, c);
      p.hand.sort(cmpCard);
      n.pile = [];
      n.current = advance(n, seat, 1);
      return { ok: true, state: n };
    }
    addLog(n, `${name} flips a ${cardLabel(c)} blind.`);
    p.down.push(c); // put back temporarily so common removal below works
  } else if (!rankAllowed(first, n.pile)) {
    return { ok: false, error: `Can't play ${cardLabel(cards[0]!)} on this pile` };
  }

  // Remove from zone, push onto pile.
  const idset = new Set(cards.map((c) => c.id));
  p[zone] = p[zone].filter((c) => !idset.has(c.id));

  let flips = 0;
  let skips = 0;
  let burn = false;
  let joker = false;

  const playGroup = (group: Card[]) => {
    const r = group[0]!.rank;
    n.pile.push(...group);
    if (r === 4) flips += group.length;
    if (r === 8) skips += group.length;
    if (r === 10) burn = true;
    if (r === JOKER) joker = true;
    if (r !== JOKER && topRun(n.pile) >= 4) burn = true;
  };

  if (combo) {
    const sixes = cards.filter((c) => c.rank === 6);
    const sevens = cards.filter((c) => c.rank === 7);
    playGroup(sixes);
    if (burn) return { ok: false, error: 'Four 6s burn the pile — play the 7s next turn' };
    playGroup(sevens);
    addLog(n, `${name} plays ${sixes.length}×6 + ${sevens.length}×7.`);
  } else {
    playGroup(cards);
    if (zone !== 'down') addLog(n, `${name} plays ${cards.length}×${cardLabel(cards[0]!)}.`);
  }

  refill(n, p);
  const out = total(p) === 0;
  if (out) finishOut(n, seat);

  if (joker) {
    // Remove jokers from pile; they are discarded. Rest of pile goes to a chosen player.
    n.burnedCount += n.pile.filter((c) => c.rank === JOKER).length;
    n.pile = n.pile.filter((c) => c.rank !== JOKER);
    if (n.pile.length) {
      n.pendingJoker = { by: seat };
      n.current = seat;
      addLog(n, `${name} played a Joker — choosing who takes the pile!`);
      return { ok: true, state: n };
    }
    addLog(n, `${name} played a Joker on an empty pile.`);
    if (checkEnd(n)) return { ok: true, state: n };
    n.current = out ? advance(n, seat, 1) : seat;
    return { ok: true, state: n };
  }

  if (checkEnd(n)) return { ok: true, state: n };

  if (flips % 2 === 1) {
    n.direction = (n.direction * -1) as 1 | -1;
    addLog(n, 'Direction reversed!');
  }

  if (burn) {
    n.burnedCount += n.pile.length;
    n.pile = [];
    addLog(n, `🔥 The pile burns! ${out ? 'Next player starts.' : `${name} plays again.`}`);
    n.current = out ? advance(n, seat, 1) : seat;
    return { ok: true, state: n };
  }

  let steps = 1 + skips;
  // With two players left, reversing acts as a skip.
  if (activeCount(n) === 2 && !out) steps += flips;
  if (skips) addLog(n, `${skips} player${skips > 1 ? 's' : ''} skipped.`);
  n.current = advance(n, seat, steps);
  return { ok: true, state: n };
}

export function jokerTarget(s: State, seat: number, target: number): Result {
  if (s.phase !== 'playing' || !s.pendingJoker) return { ok: false, error: 'No joker pending' };
  if (s.pendingJoker.by !== seat) return { ok: false, error: 'Not your joker' };
  if (target === seat || !s.players[target]) return { ok: false, error: 'Pick another player' };
  const n = clone(s);
  const t = n.players[target]!;
  const wasOut = !isActive(n, target);
  t.hand.push(...n.pile);
  t.hand.sort(cmpCard);
  addLog(n, `${n.players[seat]!.name} hands the pile (${n.pile.length} cards) to ${t.name}${wasOut ? ' — back in the game!' : '.'}`);
  n.pile = [];
  n.pendingJoker = null;
  if (wasOut) n.finished = n.finished.filter((x) => x !== target);
  if (checkEnd(n)) return { ok: true, state: n };
  n.current = isActive(n, seat) ? seat : advance(n, seat, 1);
  return { ok: true, state: n };
}

export function canPickup(s: State, seat: number): boolean {
  if (s.phase !== 'playing' || s.pendingJoker || s.current !== seat) return false;
  const z = zoneOf(s.players[seat]!);
  return !!z && z !== 'down' && s.pile.length > 0;
}

export function pickup(s: State, seat: number): Result {
  if (s.phase !== 'playing') return { ok: false, error: 'Game is not running' };
  if (s.pendingJoker) return { ok: false, error: 'Waiting for joker target' };
  if (s.current !== seat) return { ok: false, error: 'Not your turn' };
  if (!s.pile.length) return { ok: false, error: 'Nothing to pick up' };
  if (zoneOf(s.players[seat]!) === 'down') return { ok: false, error: 'Flip a face-down card instead' };
  const n = clone(s);
  const p = n.players[seat]!;
  p.hand.push(...n.pile);
  p.hand.sort(cmpCard);
  addLog(n, `${p.name} picks up the pile (${n.pile.length} cards).`);
  n.pile = [];
  n.current = advance(n, seat, 1);
  return { ok: true, state: n };
}

// ---------------------------------------------------------------- legal move enumeration (tests, bots, hints)

export type Action =
  | { t: 'play'; ids: number[] }
  | { t: 'pickup' }
  | { t: 'joker'; target: number }
  | { t: 'swap'; handId: number; upId: number }
  | { t: 'ready' };

export function applyAction(s: State, seat: number, a: Action): Result {
  switch (a.t) {
    case 'play': return play(s, seat, a.ids);
    case 'pickup': return pickup(s, seat);
    case 'joker': return jokerTarget(s, seat, a.target);
    case 'swap': return swap(s, seat, a.handId, a.upId);
    case 'ready': return setReady(s, seat);
  }
}

export function legalMoves(s: State, seat: number): Action[] {
  const out: Action[] = [];
  if (s.phase === 'swap') {
    if (!s.players[seat]!.ready) out.push({ t: 'ready' });
    return out;
  }
  if (s.phase !== 'playing') return out;
  if (s.pendingJoker) {
    if (s.pendingJoker.by === seat)
      s.players.forEach((_, i) => i !== seat && out.push({ t: 'joker', target: i }));
    return out;
  }
  if (s.current !== seat) return out;
  const p = s.players[seat]!;
  const z = zoneOf(p);
  if (!z) return out;
  if (z === 'down') {
    for (const c of p.down) out.push({ t: 'play', ids: [c.id] });
    return out;
  }
  if (canPickup(s, seat)) out.push({ t: 'pickup' });
  const byRank = new Map<number, Card[]>();
  for (const c of p[z]) byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), c]);
  for (const [r, cs] of byRank) {
    if (!rankAllowed(r, s.pile)) continue;
    for (let k = 1; k <= cs.length; k++) out.push({ t: 'play', ids: cs.slice(0, k).map((c) => c.id) });
  }
  const sixes = byRank.get(6), sevens = byRank.get(7);
  if (sixes && sevens && rankAllowed(6, s.pile)) {
    for (let a = 1; a <= sixes.length; a++)
      for (let b = 1; b <= sevens.length; b++)
      {
        const ids = [...sixes.slice(0, a), ...sevens.slice(0, b)].map((c) => c.id);
        if (play(s, seat, ids).ok) out.push({ t: 'play', ids });
      }
  }
  return out;
}

export function allCards(s: State): Card[] {
  return [
    ...s.deck, ...s.pile,
    ...s.players.flatMap((p) => [...p.hand, ...p.up, ...p.down]),
  ];
}
