(() => {
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const SUIT = { C: '♣', D: '♦', H: '♥', S: '♠', X: '' };
  const RN = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '🃏' };
  const rn = (r) => RN[r] || String(r);

  let ws, st = null, session = JSON.parse(localStorage.getItem('shithead') || 'null');
  let sel = [];            // selected card ids (playing)
  let swapHand = null;     // selected hand id (swap)
  let name = localStorage.getItem('shithead-name') || '';
  let connected = false;
  let joinCode = new URLSearchParams(location.search).get('room') || '';

  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('show'), 2500);
  }

  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => {
      connected = true;
      if (session) send({ type: 'join', code: session.code, token: session.token, name });
      render();
    };
    ws.onclose = () => { connected = false; render(); setTimeout(connect, 1500); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'joined') {
        session = { code: m.code, token: m.token };
        localStorage.setItem('shithead', JSON.stringify(session));
      } else if (m.type === 'state') {
        const prevPhase = st && st.phase;
        st = m;
        if (prevPhase !== m.phase || m.current !== m.you) sel = [];
        sel = sel.filter((id) => m.hand.some((c) => c.id === id) || (m.players[m.you] && m.players[m.you].up.some((c) => c.id === id)));
        render();
      } else if (m.type === 'error') {
        toast(m.msg);
        if (m.msg === 'Room not found' && session) { session = null; localStorage.removeItem('shithead'); st = null; render(); }
      } else if (m.type === 'kicked') {
        session = null; st = null; localStorage.removeItem('shithead'); render();
      }
    };
  }
  const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

  // ------------------------------------------------------------ rendering helpers
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };

  function cardEl(c, opts = {}) {
    const red = c.suit === 'H' || c.suit === 'D';
    const el = h('div', { class: ['card', red ? 'red' : '', c.rank === 15 ? 'joker' : '', opts.small ? 'small' : '', opts.dim ? 'dim' : '', opts.sel ? 'sel' : '', opts.onclick ? 'tap' : ''].join(' ') },
      c.rank === 15 ? 'JOKER' : [h('div', {}, rn(c.rank)), h('div', { class: 's' }, SUIT[c.suit])]);
    if (opts.onclick) el.addEventListener('click', opts.onclick);
    return el;
  }
  const backEl = (opts = {}) => h('div', { class: 'card back' + (opts.small ? ' small' : '') + (opts.onclick ? ' tap' : '') , onclick: opts.onclick });

  // ------------------------------------------------------------ screens
  function renderHome() {
    app.replaceChildren(
      h('h1', {}, '💩 Shithead'),
      h('div', { class: 'panel' },
        h('label', {}, 'Your name'),
        h('input', { id: 'nm', maxlength: 16, value: name, placeholder: 'Name', oninput: (e) => { name = e.target.value; localStorage.setItem('shithead-name', name); } }),
        h('div', { class: 'row' }, h('button', { onclick: () => name.trim() ? send({ type: 'create', name }) : toast('Enter a name') }, 'Create room')),
      ),
      h('div', { class: 'panel' },
        h('label', {}, 'Join a room'),
        h('input', { id: 'rc', maxlength: 4, value: joinCode, placeholder: 'ROOM CODE', style: 'text-transform:uppercase', oninput: (e) => { joinCode = e.target.value.toUpperCase(); } }),
        h('button', { onclick: () => name.trim() && joinCode.length === 4 ? send({ type: 'join', code: joinCode, name }) : toast('Enter name and 4-letter code') }, 'Join'),
      ),
      h('div', { class: 'panel rules' }, rulesText()),
      !connected && h('div', { class: 'muted' }, 'Connecting…'),
    );
  }

  function rulesText() {
    return h('div', {},
      h('b', {}, 'Card rules'), h('br'),
      '2, 3, 10 & Joker: always playable. 3 is transparent. 10 burns the pile.', h('br'),
      '4: reverse · 8: skip (stacks) · 7: next plays ≤7 · J: next plays J.', h('br'),
      'Others: equal or higher. Same-rank cards can be played together; 4 in a row burns. 6s may be followed by 7s.', h('br'),
      'Joker: give the whole pile to anyone (even a player who is already out).');
  }

  function renderLobby() {
    const url = location.origin + '/?room=' + st.code;
    app.replaceChildren(
      h('h1', {}, '💩 Shithead'),
      h('div', { class: 'panel' },
        h('div', { class: 'muted', style: 'text-align:center' }, 'Room code'),
        h('div', { class: 'code' }, st.code),
        h('div', { class: 'row center' }, h('button', { class: 'sec', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(url); toast('Link copied'); } }, 'Copy invite link')),
      ),
      h('div', { class: 'panel' },
        h('b', {}, `Players (${st.seats.length}/6)`),
        st.seats.map((s) => h('div', { class: 'row', style: 'margin:6px 0' },
          h('span', {}, (s.seat === 0 ? '👑 ' : '') + s.name + (s.seat === st.you ? ' (you)' : '')),
          !s.connected && h('span', { class: 'muted' }, 'disconnected'),
          st.host && s.seat > 0 && h('button', { class: 'sec', onclick: () => send({ type: 'kick', seat: s.seat }) }, 'Kick'))),
        st.host
          ? h('button', { disabled: st.seats.length < 2, onclick: () => send({ type: 'start' }) }, st.seats.length < 2 ? 'Need 2+ players' : 'Start game')
          : h('div', { class: 'muted' }, 'Waiting for the host to start…'),
      ),
      h('div', { class: 'panel rules' }, rulesText()),
    );
  }

  function opponents() {
    return h('div', { class: 'opps' }, st.players.filter((p) => p.seat !== st.you).map((p) => {
      const out = !p.active && st.phase !== 'swap';
      return h('div', { class: 'opp' + (st.current === p.seat && st.phase === 'playing' ? ' cur' : '') + (out ? ' out' : '') },
        h('div', { class: 'name' }, p.name + (st.seats[p.seat].connected ? '' : ' 📴') + (out ? ' ✅' : '') + (st.phase === 'swap' && p.ready ? ' ✔' : '')),
        h('div', { class: 'cards' },
          p.up.map((c) => cardEl(c, { small: true })),
          Array.from({ length: p.downCount }, () => backEl({ small: true }))),
        h('div', { class: 'muted' }, `Hand: ${p.handCount}`));
    }));
  }

  function renderGame() {
    const me = st.players[st.you];
    const myTurn = st.phase === 'playing' && st.current === st.you && !st.pendingJoker;
    const inSwap = st.phase === 'swap';
    const zone = st.zone;

    // --- hand / up selection
    const activeIds = zone === 'hand' ? st.hand : zone === 'up' ? me.up : [];
    const selRanks = new Set(activeIds.filter((c) => sel.includes(c.id)).map((c) => c.rank));
    const canAdd = (c) => {
      if (!st.playable.includes(c.rank)) return false;
      if (!selRanks.size || selRanks.has(c.rank)) return true;
      // 6 + 7 combo
      return selRanks.size === 1 && ((selRanks.has(6) && c.rank === 7) || (selRanks.has(7) && c.rank === 6)) && st.playable.includes(6);
    };
    const toggle = (c) => {
      if (sel.includes(c.id)) sel = sel.filter((x) => x !== c.id);
      else if (canAdd(c)) sel = [...sel, c.id];
      else if (st.playable.includes(c.rank)) sel = [c.id];
      render();
    };

    const handCards = st.hand.map((c) => {
      if (inSwap) return cardEl(c, { sel: swapHand === c.id, onclick: () => { if (!me.ready) { swapHand = swapHand === c.id ? null : c.id; render(); } } });
      const playable = myTurn && zone === 'hand' && st.playable.includes(c.rank);
      return cardEl(c, { dim: myTurn && zone === 'hand' && !playable, sel: sel.includes(c.id), onclick: playable ? () => toggle(c) : undefined });
    });
    const upCards = me.up.map((c) => {
      if (inSwap) return cardEl(c, { onclick: () => { if (me.ready) return; if (swapHand != null) { send({ type: 'swap', handId: swapHand, upId: c.id }); swapHand = null; } else toast('Pick a hand card first'); } });
      const playable = myTurn && zone === 'up' && st.playable.includes(c.rank);
      return cardEl(c, { dim: myTurn && zone === 'up' && !playable, sel: sel.includes(c.id), onclick: playable ? () => toggle(c) : undefined });
    });
    const downCards = Array.from({ length: me.downCount }, (_, i) => {
      const id = st.downIds[i];
      return backEl({ onclick: id != null ? () => send({ type: 'play', ids: [id] }) : undefined });
    });

    // --- table
    const pileEl = h('div', { class: 'pile' }, st.pile.length ? st.pile.map((c) => cardEl(c)) : h('span', { class: 'muted', style: 'align-self:center' }, 'Empty pile'));
    const cur = st.players[st.current];
    const table = h('div', { class: 'table' },
      h('div', {},
        h('span', { class: 'badge' }, `Deck ${st.deckCount}`),
        h('span', { class: 'badge' }, `Pile ${st.pileCount}`),
        h('span', { class: 'badge' }, `🔥 ${st.burned}`),
        h('span', { class: 'badge' }, st.direction === 1 ? '↻ clockwise' : '↺ counter-clockwise')),
      pileEl,
      inSwap
        ? h('div', {}, 'Swap hand ↔ face-up cards, then press Ready')
        : st.phase === 'playing' && h('div', {}, h('b', {}, st.pendingJoker ? `${st.players[st.pendingJoker.by].name} is choosing a joker target…` : (myTurn ? 'Your turn' : `${cur.name}'s turn`)), h('div', { class: 'muted' }, 'Play: ' + st.restriction)),
    );

    // --- actions
    const actions = h('div', { class: 'row' });
    if (inSwap) {
      actions.append(h('button', { disabled: me.ready, onclick: () => send({ type: 'ready' }) }, me.ready ? 'Waiting for others…' : 'Ready'));
    } else if (myTurn) {
      if (zone === 'down') actions.append(h('span', { class: 'muted' }, 'Tap a face-down card to flip it'));
      else {
        actions.append(h('button', { disabled: !sel.length, onclick: () => { send({ type: 'play', ids: sel }); sel = []; } }, sel.length ? `Play ${sel.length} card${sel.length > 1 ? 's' : ''}` : 'Select cards'));
        actions.append(h('button', { class: 'sec', disabled: !st.canPickup, onclick: () => send({ type: 'pickup' }) }, 'Pick up pile'));
      }
    }

    const mine = h('div', { class: 'mine' + (myTurn ? ' cur' : '') },
      h('b', {}, me.name + ' (you)' + (!me.active && !inSwap ? ' ✅ out' : '')),
      h('div', { class: 'muted' }, 'Face-down & face-up'),
      h('div', { class: 'zone', style: 'min-height:84px' }, downCards, upCards),
      h('div', { class: 'muted' }, 'Hand'),
      h('div', { class: 'zone' }, handCards),
      actions);

    const log = h('div', { class: 'panel log' }, st.log.slice().reverse().map((l) => h('div', {}, l)));
    app.replaceChildren(opponents(), table, mine, log);

    // joker modal
    if (st.pendingJoker && st.pendingJoker.by === st.you) {
      app.append(h('div', { class: 'modal' }, h('div', { class: 'box' },
        h('b', {}, '🃏 Who takes the pile?'),
        st.players.filter((p) => p.seat !== st.you).map((p) => h('button', { onclick: () => send({ type: 'joker', target: p.seat }) }, `${p.name}${p.active ? ` (${p.handCount + p.up.length + p.downCount} cards)` : ' — out (revive!)'}`)))));
    }
    // game over modal
    if (st.phase === 'finished') {
      const order = st.finished.map((s) => st.players[s].name);
      app.append(h('div', { class: 'modal' }, h('div', { class: 'box' },
        h('h2', {}, st.shithead === st.you ? 'You are the shithead 💩' : `${st.players[st.shithead].name} is the shithead 💩`),
        h('ol', {}, order.map((n) => h('li', {}, n)), h('li', {}, st.players[st.shithead].name + ' 💩')),
        st.host ? h('button', { onclick: () => send({ type: 'start' }) }, 'Play again') : h('div', { class: 'muted' }, 'Waiting for host…'),
        st.host && h('button', { class: 'sec', onclick: () => send({ type: 'lobby' }) }, 'Back to lobby'))));
    }
  }

  function render() {
    if (!st || !session) return renderHome();
    if (st.phase === 'lobby') return renderLobby();
    return renderGame();
  }

  connect();
  render();
})();
