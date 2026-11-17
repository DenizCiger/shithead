/* Rule catalogue shared by the lobby (rule wall) and the "how to play" modal. */
(function () {
  'use strict';
  // tier: 'classic' = part of the usual game, 'bonus' = house variant
  var META = [
    { k: 'jokers', short: 'JOKERS', cards: 'JOKER', tier: 'classic', desc: 'Two Jokers per deck. Play one to hand the whole pile to any player, even one who is already out.' },
    { k: 'r10', short: '10 BURN', cards: '10', tier: 'classic', desc: 'Always playable. Burns the pile and you play again.' },
    { k: 'four', short: 'x4 BURN', cards: 'x4', tier: 'classic', desc: 'Four cards of the same rank in a row burn the pile.' },
    { k: 'r3', short: '3 GLASS', cards: '3', tier: 'bonus', desc: 'Always playable and transparent: the card underneath still counts.' },
    { k: 'r4', short: '4 REVERSE', cards: '4', tier: 'bonus', desc: 'Reverses the direction of play (acts as a skip with two players left).' },
    { k: 'r8', short: '8 SKIP', cards: '8', tier: 'bonus', desc: 'Skips the next player. Several 8s skip several players.' },
    { k: 'combo', short: '67', cards: '6 + 7', tier: 'bonus', desc: '6s may be followed by 7s in the same throw.' },
    { k: 'parry', short: 'PARRY', cards: 'PARRY', tier: 'bonus', needs: 'jokers', desc: 'Targeted by a Joker while holding one? Play it from your hand to bounce the pile back at the caster. Can ping-pong.' },
    { k: 'randomJoker', short: 'RANDOM JOKER', cards: 'JOKER ?', tier: 'bonus', needs: 'jokers', desc: 'A Joker picks its victim at random instead of the player choosing.' }
  ];
  var ASSIST = [
    { k: 'autoTake', short: 'AUTO-TAKE', desc: 'Nothing playable? The pile is picked up for you.' },
    { k: 'autoOne', short: 'AUTO-PLAY', desc: 'Only one legal play? It is played for you.' },
    { k: 'autoStack', short: 'AUTO-STACK', desc: 'Playing a card throws every card of that rank.' }
  ];
  var DIFF = [
    { v: 'assisted', l: 'ASSISTED', desc: 'Cards you cannot play are dimmed and locked.' },
    { v: 'normal', l: 'NORMAL', desc: 'Nothing is dimmed. Illegal throws are simply blocked.' },
    { v: 'expert', l: 'EXPERT', desc: 'An illegal throw takes the whole pile as a penalty.' }
  ];
  var SHOT = { short: '🥃 SHOT ON MISPLAY', desc: 'Expert only: a punished misplay also costs a (fake) shot. Expect a wobbly table.' };
  var CLASSIC = { jokers: true, parry: false, r3: false, r4: false, r8: false, r10: true, four: true, combo: false, randomJoker: false };
  var AHIF = { jokers: true, parry: true, r3: true, r4: true, r8: true, r10: true, four: true, combo: true, randomJoker: false };
  var PRESETS = { classic: { name: 'CLASSIC', rules: CLASSIC }, ahif: { name: 'AHIF', rules: AHIF } };
  function presetOf(rules) {
    var hit = 'custom';
    Object.keys(PRESETS).forEach(function (p) { if (META.every(function (m) { return !!PRESETS[p].rules[m.k] === !!rules[m.k]; })) hit = p; });
    return hit;
  }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function item(cards, text, bonus) {
    var li = el('div', 'ri' + (bonus ? ' bonus' : ''));
    li.append(el('b', '', cards), el('span', '', text));
    if (bonus) li.append(el('em', '', 'BONUS'));
    return li;
  }

  /** `rules` = a room's rules, or null for the generic reference (classic on the left, bonus on the right). */
  function open(rules) {
    var box = document.querySelector('#rules .sbox');
    box.replaceChildren();
    box.append(el('h2', '', 'HOW TO PLAY'));
    var p = el('p', 'rl');
    p.append('Get rid of all your cards. The last player holding cards is the ', el('b', '', 'shithead'), '. Play your hand first, then your face-up cards, then your face-down cards blind.');
    box.append(p);
    var on = rules || CLASSIC;
    var special = { 3: on.r3, 4: on.r4, 8: on.r8, 10: on.r10 };
    var plain = ['3', '4', '5', '6', '8', '9', '10', 'Q', 'K', 'A'].filter(function (r) { return !special[r]; }).join(' ');
    var core = [
      [plain, 'Play equal or higher than the top card.'],
      ['2', 'Always playable. Resets the pile: anything goes next.'],
      ['7', 'Next player must play 7 or lower.'],
      ['J', 'Next player must play a J' + (on.r10 || on.r3 || on.jokers ? ' (or a wild card).' : ' (or a 2).')],
      ['SAME', 'Cards of the same rank can be played together. Nothing playable? Pick up the pile.']
    ];
    var left = el('div', 'rcol'), right = el('div', 'rcol off');
    left.append(el('h3', '', rules ? 'IN PLAY' : 'CLASSIC RULES'));
    right.append(el('h3', '', rules ? 'TURNED OFF' : 'BONUS RULES'));
    core.forEach(function (c) { left.append(item(c[0], c[1], false)); });
    META.forEach(function (m) {
      var enabled = rules ? !!rules[m.k] : m.tier === 'classic';
      if (!rules && m.tier === 'bonus') enabled = false;
      (enabled ? left : right).append(item(m.cards, m.desc, m.tier === 'bonus'));
    });
    if (!right.querySelector('.ri')) right.append(el('div', 'rnone', 'Nothing is turned off.'));
    var cols = el('div', 'rcols');
    cols.append(left, right);
    box.append(cols);
    if (rules && rules.difficulty) {
      var d = DIFF.filter(function (x) { return x.v === rules.difficulty; })[0];
      var note = el('p', 'rl');
      note.append(el('b', '', d.l + ': '), d.desc);
      if (rules.shot) note.append(' ' + SHOT.desc.replace('Expert only: a', 'A'));
      box.append(note);
    }
    var row = el('div', 'srow'), btn = el('button', 'bigbtn', 'CLOSE');
    btn.id = 'rclose';
    row.append(btn);
    box.append(row);
    document.getElementById('rules').classList.add('open');
  }

  window.RulesUI = { META: META, ASSIST: ASSIST, DIFF: DIFF, SHOT: SHOT, PRESETS: PRESETS, presetOf: presetOf, open: open };
})();
