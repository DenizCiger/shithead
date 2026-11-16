/* Shithead client: connection, home and lobby screens. The game table itself is game.js. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var screen = $('#screen'), toastEl = $('#toast'), connEl = $('#conn');
  var ws, st = null, connected = false, session = null, name = localStorage.getItem('shithead-name') || '';
  try { session = JSON.parse(localStorage.getItem('shithead') || 'null'); } catch (e) { session = null; }
  var joinCode = new URLSearchParams(location.search).get('room') || '';

  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { toastEl.classList.remove('show'); }, 2500);
  }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  window.Net = { send: send };

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
      } else if (m.type === 'kicked') { forget(); toast('You were removed from the room'); }
    };
  }
  function forget() { session = null; st = null; localStorage.removeItem('shithead'); window.Game.reset(); render(); }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(function (kid) { if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid)); });
    }
    return el;
  }

  function home() {
    return [h('h1', {}, 'SHITHEAD'),
      h('div', { class: 'box' },
        h('label', {}, 'YOUR NAME'),
        h('input', { id: 'nm', maxlength: 16, value: name, placeholder: 'Name', oninput: function (e) { name = e.target.value; localStorage.setItem('shithead-name', name); } }),
        h('button', { class: 'bigbtn', onclick: function () { name.trim() ? send({ type: 'create', name: name }) : toast('Enter a name'); } }, 'CREATE ROOM')),
      h('div', { class: 'box' },
        h('label', {}, 'JOIN A ROOM'),
        h('input', { id: 'rc', maxlength: 4, value: joinCode, placeholder: 'CODE', oninput: function (e) { joinCode = e.target.value.toUpperCase(); e.target.value = joinCode; } }),
        h('button', { class: 'bigbtn', onclick: function () { name.trim() && joinCode.length === 4 ? send({ type: 'join', code: joinCode, name: name }) : toast('Enter your name and the 4-letter code'); } }, 'JOIN')),
      !connected && h('div', { class: 'muted' }, 'Connecting…')];
  }

  function lobby() {
    var url = location.origin + '/?room=' + st.code;
    return [h('h1', {}, 'SHITHEAD'),
      h('div', { class: 'box' },
        h('div', { class: 'lab', style: 'text-align:center' }, 'ROOM CODE'),
        h('div', { class: 'code' }, st.code),
        h('div', { class: 'row', style: 'justify-content:center' }, h('button', { class: 'bigbtn sec', onclick: function () { if (navigator.clipboard) navigator.clipboard.writeText(url); toast('Link copied'); } }, 'COPY INVITE LINK'))),
      h('div', { class: 'box' },
        h('div', { class: 'lab' }, 'PLAYERS (' + st.seats.length + '/6)'),
        st.seats.map(function (s) {
          return h('div', { class: 'row pl' },
            h('span', {}, (s.seat === 0 ? '♛ ' : '') + s.name + (s.seat === st.you ? ' (you)' : '') + (s.bot ? ' 🤖' : ''), !s.connected && h('i', {}, '  offline')),
            st.host && s.seat > 0 && h('button', { class: 'bigbtn sec', style: 'font-size:16px', onclick: function () { send({ type: s.bot ? 'rmbot' : 'kick', seat: s.seat }); } }, s.bot ? 'REMOVE' : 'KICK'));
        }),
        st.host && h('div', { class: 'row', style: 'justify-content:center;margin-top:8px' },
          h('button', { class: 'bigbtn sec', style: 'font-size:16px', disabled: st.seats.length >= 6, onclick: function () { send({ type: 'addbot' }); } }, '+ ADD BOT'),
          st.seats.some(function (s) { return s.bot; }) && h('button', { class: 'bigbtn sec', style: 'font-size:16px', onclick: function () { send({ type: 'rmbot' }); } }, '− REMOVE BOT')),
        st.host
          ? h('button', { class: 'bigbtn', style: 'margin-top:10px', disabled: st.seats.length < 2, onclick: function () { send({ type: 'start' }); } }, st.seats.length < 2 ? 'NEED 2+ PLAYERS' : 'START GAME')
          : h('div', { class: 'muted' }, 'Waiting for the host to start…'))];
  }

  function render() {
    var inGame = !!(st && session && st.phase !== 'lobby');
    window.Game.show(inGame);
    if (inGame) {
      screen.classList.remove('on');
      window.Game.push(st, st.events || []);
      st = Object.assign({}, st, { events: [] }); // consumed; later local re-renders must not replay them
      return;
    }
    window.Game.reset();
    screen.classList.add('on');
    var focus = document.activeElement && document.activeElement.id;
    var val = focus && document.activeElement.value;
    screen.replaceChildren(h('div', { class: 'wrap' }, (st && session) ? lobby() : home()));
    if (focus) { var el = document.getElementById(focus); if (el) { el.focus(); if (val != null && el.setSelectionRange) try { el.setSelectionRange(val.length, val.length); } catch (e) {} } }
  }

  connect();
  render();
})();
