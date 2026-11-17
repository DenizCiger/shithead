/* Shithead client: connection, home screen and the lobby ("war room"). The game table itself is game.js. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var screen = $('#screen'), modalEl = $('#modal'), toastEl = $('#toast'), connEl = $('#conn'), voteEl = $('#vote');
  screen.classList.add('lb'); modalEl.classList.add('lb');
  var COL = ['#ffe600', '#ff2e88', '#19e3ff', '#ff7a1a', '#7dff3a', '#b266ff'];
  var ws, st = null, connected = false, session = null, name = localStorage.getItem('shithead-name') || '';
  try { session = JSON.parse(localStorage.getItem('shithead') || 'null'); } catch (e) { session = null; }
  var joinCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  var invited = joinCode.length === 4, watch = false, modal = null, heir = null;

  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { toastEl.classList.remove('show'); }, 2500);
  }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  function patch(p) { send({ type: 'settings', patch: p }); }
  window.Net = { send: send, rules: function () { return st && st.settings ? st.settings.rules : null; } };

  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = function () {
      connected = true; connEl.style.display = 'none';
      if (session) send({ type: 'join', code: session.code, token: session.token, name: name });
      render();
    };
    ws.onclose = function () { connected = false; connEl.style.display = 'block'; render(); setTimeout(connect, 1500); };
    ws.onmessage = function (e) {
      var m = JSON.parse(e.data);
      if (m.type === 'joined') {
        session = { code: m.code, token: m.token };
        localStorage.setItem('shithead', JSON.stringify(session));
      } else if (m.type === 'state') {
        st = m; render();
      } else if (m.type === 'error') {
        if (st && st.phase !== 'lobby' && session) window.Game.error(m.msg); else toast(m.msg);
        if (m.msg === 'Room not found' && session) forget();
      } else if (m.type === 'chat') { window.Chat.add(m.msg);
      } else if (m.type === 'react') { window.Game.react(m);
      } else if (m.type === 'chathist') { window.Chat.history(m.log);
      } else if (m.type === 'kicked') { forget(); toast(m.msg || 'You were removed from the room');
      } else if (m.type === 'closed') { forget(); toast('The room was closed');
      } else if (m.type === 'left') { forget(); }
    };
  }
  function forget() { window.Chat.history([]); window.Chat.close(); session = null; st = null; modal = null; localStorage.removeItem('shithead'); window.Game.reset(); render(); }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(function (kid) { if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid)); });
    }
    return el;
  }
  function ib(label, title, fn, cls, dis) {
    return h('button', { class: 'ib' + (cls ? ' ' + cls : ''), title: title, 'aria-label': title, disabled: !!dis, onclick: fn }, label);
  }

  // ---------------------------------------------------------------- home
  function home() {
    var cells = [0, 1, 2, 3].map(function (i) { return h('span', { class: joinCode[i] ? 'f' : (i === joinCode.length ? 'cur' : '') }, joinCode[i] || ''); });
    function guard(fn) { return function () { if (!name.trim()) return toast('Enter a name first'); fn(); }; }
    function doJoin() { send({ type: 'join', code: joinCode, name: name, spectate: watch }); }
    var av = h('span', { class: 'av', id: 'nmav' }, (name.trim()[0] || '?').toUpperCase());
    return h('div', { class: 'door' },
      h('h1', { class: 'title' }, 'SHITHEAD'),
      h('div', { class: 'fighter' }, av,
        h('input', { id: 'nm', maxlength: 16, value: name, placeholder: 'YOUR NAME', 'aria-label': 'Your name', autocomplete: 'off',
          oninput: function (e) { name = e.target.value; localStorage.setItem('shithead-name', name); av.textContent = (name.trim()[0] || '?').toUpperCase(); } })),
      h('span', { class: 'lab' }, invited ? 'YOU ARE INVITED TO ROOM' : 'ENTER A ROOM CODE'),
      h('div', { class: 'cells' }, cells,
        h('input', { id: 'rc', maxlength: 4, value: joinCode, 'aria-label': 'Room code', autocapitalize: 'characters', autocomplete: 'off',
          oninput: function (e) { joinCode = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); e.target.value = joinCode; render(); },
          onkeydown: function (e) { if (e.key === 'Enter' && joinCode.length === 4) guard(doJoin)(); } })),
      h('button', { class: 'btn big cy', disabled: joinCode.length !== 4, onclick: guard(doJoin) }, watch ? 'WATCH ROOM' : 'ENTER ROOM'),
      h('div', { class: 'or' }, 'NO CODE?'),
      h('button', { class: 'btn big pink', onclick: guard(function () { send({ type: 'create', name: name, spectate: watch }); }) }, watch ? 'OPEN A TABLE & WATCH' : 'OPEN A NEW TABLE'),
      h('div', { class: 'watch' },
        h('button', { class: 'tog' + (watch ? ' on' : ''), 'aria-pressed': watch ? 'true' : 'false', 'aria-label': 'Just watching', onclick: function () { watch = !watch; render(); } }, watch ? 'ON' : 'OFF'),
        h('span', {}, 'JUST WATCHING (SPECTATOR)')),
      !connected && h('div', { class: 'sys', style: 'margin-top:20px' }, 'Connecting…'));
  }

  // ---------------------------------------------------------------- lobby
  function memberRow(i) {
    var S = st.settings, m = st.seats[i], host = st.host, no = null;
    if (i >= S.maxPlayers)
      return h('button', { class: 'prow locked', disabled: !host, title: host ? 'Open seats up to ' + (i + 1) : '', onclick: function () { patch({ maxPlayers: i + 1 }); } },
        no, '🔒 LOCKED', host && h('span', { class: 'sys', style: 'margin-left:auto' }, 'tap to open'));
    if (!m) {
      var first = i === st.seats.length;
      return h('div', { class: 'prow open' }, no, h('span', { class: 'grow' }, 'OPEN SEAT'),
        host && first && h('button', { class: 'btn sm sec', onclick: function () { send({ type: 'addbot' }); } }, '+ BOT'),
        host && i === S.maxPlayers - 1 && i >= 2 && h('button', { class: 'btn sm ghost', style: 'margin-left:6px', title: 'Lock this seat (lower the player limit)', onclick: function () { patch({ maxPlayers: i }); } }, '🔒'));
    }
    var me = !st.spectator && i === st.you, crowned = i === st.hostSeat;
    return h('div', { class: 'prow' + (me ? ' me' : '') + (m.connected ? '' : ' off'), style: '--pc:' + COL[i % 6] },
      no, h('span', { class: 'av' }, m.bot ? '⚙' : m.name[0].toUpperCase()),
      h('span', { class: 'nm cut grow' }, crowned && h('span', { class: me ? '' : 'crown' }, '♛ '), m.name),
      h('span', { class: 'tags' }, me && h('span', { class: 'tag' }, 'YOU'), m.bot && h('span', { class: 'tag c' }, 'BOT'), !m.connected && h('span', { class: 'tag m' }, 'OFFLINE')),
      h('span', { class: 'acts' },
        me && ib('👁', 'Move to the bench and just watch', function () { send({ type: 'spectate' }); }),
        host && !me && !m.bot && ib('♛', 'Make ' + m.name + ' the host', function () { send({ type: 'crown', seat: i }); }),
        host && !me && !m.bot && ib('👁', 'Move ' + m.name + ' to the bench', function () { send({ type: 'move', seat: i }); }),
        host && !me && (m.bot ? ib('✕', 'Remove ' + m.name, function () { send({ type: 'rmbot', seat: i }); }, 'bad') : ib('✕', 'Kick ' + m.name, function () { send({ type: 'kick', seat: i }); }, 'bad'))));
  }

  function benchRow(sp) {
    var host = st.host, me = !!sp.me, full = st.seats.length >= st.settings.maxPlayers;
    return h('div', { class: 'tok' + (me ? ' me' : '') + (sp.connected ? '' : ' off') },
      sp.host && h('span', { class: 'crown' }, '♛'), h('span', { class: 'grow cut' }, '👁 ' + sp.name),
      me && h('span', { class: 'tag dim' }, 'YOU'), !sp.connected && h('span', { class: 'tag m' }, 'OFFLINE'),
      me && ib('SIT', 'Take a seat at the table', function () { send({ type: 'sit' }); }, 'txt', full),
      host && !me && ib('SIT', 'Seat ' + sp.name + ' at the table', function () { send({ type: 'move', spec: sp.idx }); }, 'txt', full),
      host && !me && ib('♛', 'Make ' + sp.name + ' the host', function () { send({ type: 'crown', spec: sp.idx }); }),
      host && !me && ib('✕', 'Kick ' + sp.name, function () { send({ type: 'kick', spec: sp.idx }); }, 'bad'));
  }

  function hostName() {
    var s = st.seats[st.hostSeat];
    if (s) return s.name;
    var sp = st.specs.filter(function (x) { return x.host; })[0];
    return sp ? sp.name : '?';
  }

  function wall() {
    var S = st.settings, R = S.rules, host = st.host, U = window.RulesUI, p = U.presetOf(R);
    var d = U.DIFF.filter(function (x) { return x.v === R.difficulty; })[0];
    var sel = h('select', { id: 'preset', 'aria-label': 'Ruleset preset', disabled: !host, onchange: function (e) { if (e.target.value !== 'custom') patch({ preset: e.target.value }); } },
      Object.keys(U.PRESETS).map(function (k) { return h('option', { value: k, selected: p === k }, U.PRESETS[k].name); }),
      p === 'custom' && h('option', { value: 'custom', selected: true, disabled: true }, 'CUSTOM'));
    return h('div', { class: 'zone wall' }, h('h3', {}, 'RULE WALL'),
      h('span', { class: 'hint' }, host ? 'Tap a sticker to rip it off or slap it back on.' : 'Set by ♛ ' + hostName() + ' · live'),
      h('div', { class: 'sel' }, sel),
      h('div', { class: 'stick' }, U.META.map(function (x) {
        return h('button', { class: R[x.k] ? '' : 'off', disabled: !host || (x.needs && !R[x.needs]), title: x.desc, 'aria-pressed': R[x.k] ? 'true' : 'false',
          onclick: function () { var o = {}; o[x.k] = !R[x.k]; patch({ rules: o }); } }, x.short);
      })),
      h('span', { class: 'lab' }, 'DIFFICULTY'),
      h('div', { class: 'seg diff' }, U.DIFF.map(function (x) {
        return h('button', { class: x.v === R.difficulty ? 'on' : '', disabled: !host, onclick: function () { patch({ rules: { difficulty: x.v } }); } }, x.l);
      })),
      h('div', { class: 'sys dd' }, d.desc),
      R.difficulty === 'expert' && h('div', { class: 'stick' },
        h('button', { class: R.shot ? '' : 'off', disabled: !host, title: U.SHOT.desc, 'aria-pressed': R.shot ? 'true' : 'false',
          onclick: function () { patch({ rules: { shot: !R.shot } }); } }, U.SHOT.short)),
      h('span', { class: 'lab' }, 'ASSISTS (EVERYONE)'),
      h('div', { class: 'stick as' }, U.ASSIST.map(function (x) {
        return h('button', { class: S.assist[x.k] ? '' : 'off', disabled: !host, title: x.desc, 'aria-pressed': S.assist[x.k] ? 'true' : 'false',
          onclick: function () { var o = {}; o[x.k] = !S.assist[x.k]; patch({ assist: o }); } }, x.short);
      })),
      h('button', { class: 'btn sec sm', onclick: function () { window.RulesUI.open(R); } }, '? HOW THESE RULES PLAY'));
  }

  function lobby() {
    var S = st.settings, host = st.host, rows = [], cards = (S.decks || S.autoDecks) * (S.rules.jokers ? 54 : 52);
    for (var i = 0; i < 6; i++) rows.push(memberRow(i));
    var decks = h('div', { class: 'set' }, h('span', {}, 'DECKS ', h('span', { class: 'sys' }, cards + ' cards')),
      h('div', { class: 'seg' }, [{ v: 0, l: 'AUTO (' + S.autoDecks + ')' }, { v: 1, l: '1' }, { v: 2, l: '2' }, { v: 3, l: '3' }, { v: 4, l: '4' }].map(function (o) {
        return h('button', { class: o.v === S.decks ? 'on' : '', disabled: !host, onclick: function () { patch({ decks: o.v }); } }, o.l);
      })));
    return h('div', { class: 'lob' },
      h('div', { class: 'strip' },
        h('div', {}, h('div', { class: 'lab' }, 'ROOM'), h('div', { class: 'code' }, st.code)),
        h('button', { class: 'btn cy sm', style: 'font-size:18px;padding:5px 12px 6px', onclick: copyLink }, 'COPY ', h('span', { class: 'lg' }, 'INVITE '), 'LINK')),
      h('div', { class: 'board' },
        h('div', { class: 'mainc' },
          h('div', { class: 'zone tbl' }, h('h3', {}, 'TABLE ' + st.seats.length + '/' + S.maxPlayers),
            h('span', { class: 'hint' }, host ? 'Add bots, bench or crown people. Lock a seat to shrink the table.' : 'You can switch between the table and the bench.'),
            h('div', { class: 'rows' }, rows), decks),
          h('div', { class: 'zone bench' }, h('h3', {}, 'BENCH · ' + st.specs.length + ' WATCHING'),
            h('div', { class: 'toks' }, st.specs.map(benchRow), !st.specs.length && h('div', { class: 'empty' }, 'Nobody is watching.'),
              !st.spectator && h('button', { class: 'btn sm sec', style: 'justify-self:start', onclick: function () { send({ type: 'spectate' }); } }, '👁 WATCH INSTEAD')))),
        wall()),
      h('div', { class: 'bar' },
        h('button', { class: 'btn sec', onclick: openLeave }, '⏻ LEAVE', h('span', { class: 'lg' }, ' ROOM')),
        host ? h('button', { class: 'btn big', style: '--sh:var(--m)', disabled: st.seats.length < 2, onclick: function () { send({ type: 'start' }); } }, st.seats.length < 2 ? 'NEED 2+' : 'START', h('span', { class: 'lg' }, st.seats.length < 2 ? ' PLAYERS' : ' GAME'))
             : h('span', { class: 'wait cut' }, 'WAITING FOR ♛ ' + hostName() + '…')));
  }
  function copyLink() {
    var url = location.origin + '/?room=' + st.code;
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(function () {});
    toast('Invite link copied');
  }

  // ---------------------------------------------------------------- leave
  function others() { // everybody who could take the crown
    var o = [];
    st.seats.forEach(function (s, i) { if (!s.bot && !(!st.spectator && i === st.you)) o.push({ key: 's' + i, msg: { seat: i }, name: s.name, on: s.connected, spec: false }); });
    st.specs.forEach(function (s) { if (!s.me) o.push({ key: 'v' + s.idx, msg: { spec: s.idx }, name: s.name, on: s.connected, spec: true }); });
    return o.sort(function (a, b) { return (b.on - a.on) || (a.spec - b.spec); });
  }
  function openLeave() { if (!st) return; heir = null; modal = 'leave'; render(); }
  function closeModal() { modal = null; render(); }
  function leaveModal() {
    var inGame = st.phase !== 'lobby', os = st.host ? others() : [];
    var pick = os.filter(function (o) { return o.key === heir; })[0] || os[0];
    var stay = h('button', { class: 'btn sec', onclick: closeModal }, 'STAY');
    if (!st.host)
      return h('div', { class: 'sbox m' }, h('h2', {}, 'LEAVE ROOM?'),
        h('p', { class: 'sys' }, st.spectator ? 'You stop watching room ' : inGame ? 'A bot takes over your seat in room ' : 'You give up your seat in room ', h('b', {}, st.code), '.'),
        h('div', { class: 'row' }, h('button', { class: 'btn pink', onclick: function () { send({ type: 'leave' }); } }, 'LEAVE'), stay));
    if (!os.length)
      return h('div', { class: 'sbox m' }, h('h2', {}, 'CLOSE THE ROOM?'),
        h('p', { class: 'sys' }, 'You are the last human here. Leaving closes room ', h('b', {}, st.code), ' and sends the bots home.'),
        h('div', { class: 'row' }, h('button', { class: 'btn pink', onclick: function () { send({ type: 'leave', close: true }); } }, 'CLOSE & LEAVE'), stay));
    return h('div', { class: 'sbox m' }, h('h2', {}, 'YOU HOLD THE CROWN'),
      h('p', { class: 'sys' }, 'Leaving hands the room to someone else. Settings stay as they are.' + (inGame && !st.spectator ? ' A bot takes your seat.' : '')),
      h('span', { class: 'lab' }, 'NEW HOST'),
      os.map(function (o) {
        return h('button', { class: 'heir' + (o === pick ? ' on' : ''), onclick: function () { heir = o.key; render(); } },
          h('span', { class: 'grow cut' }, o.name), o.spec && h('span', { class: 'tag dim' }, 'SPECTATOR'), !o.on && h('span', { class: 'tag m' }, 'OFFLINE'), o === pick && h('span', { class: 'crown' }, '♛'));
      }),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: function () { send(Object.assign({ type: 'leave' }, pick.msg)); } }, 'CROWN ' + pick.name.toUpperCase() + ' & LEAVE'),
        h('button', { class: 'btn pink', onclick: function () { send({ type: 'leave', close: true }); } }, 'CLOSE ROOM FOR ALL'), stay));
  }

  // ---------------------------------------------------------------- votekick banner (top left, mid-game)
  var voteEnd = 0, voteTick = null;
  function tickVote() {
    var s = voteEl.querySelector('.vs');
    if (s) s.textContent = Math.max(0, Math.ceil((voteEnd - Date.now()) / 1000)) + 's';
  }
  function renderVote() {
    var v = st && session && st.phase !== 'lobby' ? st.vote : null;
    voteEl.classList.toggle('on', !!v);
    if (!v) { clearInterval(voteTick); voteTick = null; voteEl.replaceChildren(); return; }
    voteEnd = Date.now() + v.endsIn;
    var me = !st.spectator && v.seat === st.you;
    function ballot(yes) {
      return h('button', { class: (yes ? 'y' : 'n') + (v.mine === (yes ? 'yes' : 'no') ? ' on' : ''), onclick: function () { send({ type: 'vote', yes: yes }); } }, yes ? 'YES' : 'NO');
    }
    voteEl.replaceChildren(h('div', { class: 'vbox' },
      h('div', { class: 'vh' }, h('span', { class: 'grow cut' }, me ? 'VOTE TO KICK YOU' : 'KICK ' + v.name.toUpperCase() + '?'), h('span', { class: 'vw' }, v.why === 'afk' ? 'AFK' : 'OFFLINE')),
      me && h('div', { class: 'vp' }, st.phase === 'swap' ? 'Hit READY to stay in the game.' : 'Make a move to stay in the game.'),
      h('div', { class: 'vt' }, h('span', {}, 'YES ' + v.yes + '/' + v.need), h('span', {}, 'NO ' + v.no), h('span', { class: 'vs' })),
      v.canVote && h('div', { class: 'vb' }, ballot(true), ballot(false))));
    tickVote();
    if (!voteTick) voteTick = setInterval(tickVote, 250);
  }

  // ---------------------------------------------------------------- render
  function render() {
    renderVote();
    var inGame = !!(st && session && st.phase !== 'lobby');
    window.Game.show(inGame);
    document.body.classList.toggle('inroom', !!(st && session));
    document.body.classList.toggle('ingame', inGame);
    document.body.classList.toggle('spec', !!(st && st.spectator));
    if (inGame) {
      screen.classList.remove('on');
      window.Game.push(st, st.events || []);
      st = Object.assign({}, st, { events: [] }); // consumed; later local re-renders must not replay them
    } else {
      window.Game.reset();
      screen.classList.add('on');
      var a = document.activeElement, focus = a && a.id, val = focus && a.value, scroll = screen.scrollTop;
      screen.replaceChildren((st && session) ? lobby() : home());
      screen.scrollTop = scroll;
      if (focus) { var el = document.getElementById(focus); if (el) { el.focus(); if (val != null && el.setSelectionRange) try { el.setSelectionRange(val.length, val.length); } catch (e) {} } }
    }
    var mk = modal === 'leave' && st && session ? h('div', { class: 'ov', onclick: function (e) { if (e.target.classList.contains('ov')) closeModal(); } }, leaveModal()) : null;
    modalEl.replaceChildren.apply(modalEl, mk ? [mk] : []);
  }

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal) closeModal(); });
  var sl = $('#sleave');
  if (sl) sl.addEventListener('click', function () { $('#settings').classList.remove('open'); openLeave(); });
  connect();
  render();
})();
