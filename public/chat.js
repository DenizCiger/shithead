/* Shithead client: in-room chat (lobby and game). Messages travel through net.js. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var COL = ['#ffe600', '#ff2e88', '#19e3ff', '#ff7a1a', '#7dff3a', '#b266ff'];
  var box = $('#chat'), log = $('#chatlog'), input = $('#chatin'), feed = $('#chatfeed');
  var open = false;

  function line(m) {
    var d = document.createElement('div'); d.className = 'cm';
    var n = document.createElement('b'); n.textContent = m.name;
    n.style.color = m.seat >= 0 ? COL[m.seat % 6] : '#aaa';
    var t = document.createElement('span'); t.textContent = ' ' + m.text; // textContent only: never HTML
    d.append(n, t); return d;
  }
  function trim(el, n) { while (el.children.length > n) el.firstChild.remove(); }
  // Docked bottom-left. Collapsed: fading recent lines over a slim input bar. Open: the scrollable log above the bar.
  function setOpen(on) {
    open = on; box.classList.toggle('open', on);
    if (on) log.scrollTop = log.scrollHeight; // the floating lines just hide while open and carry on expiring, so they're still there if you close quickly
    else if (document.activeElement === input) input.blur();
  }
  function add(m) {
    var stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40; // don't yank the view while someone reads back
    log.appendChild(line(m)); trim(log, 200); if (stick) log.scrollTop = log.scrollHeight;
    if (open) return;
    var f = line(m); feed.appendChild(f); trim(feed, 4);
    setTimeout(function () { f.remove(); }, 9000);
  }
  function history(list) { log.innerHTML = ''; feed.innerHTML = ''; (list || []).forEach(function (m) { log.appendChild(line(m)); }); log.scrollTop = log.scrollHeight; }
  function submit() {
    var v = input.value.trim(); if (!v) return;
    if (window.Net) Net.send({ type: 'chat', text: v });
    input.value = '';
  }
  // open explicitly instead of relying on the focus event: some Chromium setups focus the input (you can type) without ever firing 'focus'
  function openChat() { setOpen(true); if (document.activeElement !== input) input.focus(); }
  feed.addEventListener('click', openChat);
  // scrolling over the recent lines or the bar itself opens the history (the lines fade, so the bar must work too)
  [feed, input].forEach(function (el) { el.addEventListener('wheel', function () { if (!open) openChat(); }, { passive: true }); });
  input.addEventListener('focus', function () { setOpen(true); }); // tabbing into the bar, where the browser does fire it
  input.addEventListener('click', function () { if (!open) openChat(); });
  input.addEventListener('keydown', function (e) {
    e.stopPropagation(); // typing must never trigger table shortcuts (space = take pile, enter = throw)
    if (e.key === 'Enter') { e.preventDefault(); submit(); setOpen(false); } // hand the keyboard back to the table
    else if (e.key === 'Escape') setOpen(false);
    else if (!open) setOpen(true); // typing into a focused-but-closed bar
  });
  addEventListener('pointerdown', function (e) { if (open && !box.contains(e.target)) setOpen(false); });
  addEventListener('keydown', function (e) { // "T" or "/" opens chat, like most games
    var a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return;
    if (!document.body.classList.contains('inroom') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 't' || e.key === 'T' || e.key === '/') { e.preventDefault(); openChat(); }
  });

  window.Chat = { add: add, history: history, close: function () { setOpen(false); } };
})();
