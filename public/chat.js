/* Shithead client: in-room chat (lobby and game). Messages travel through net.js. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var COL = ['#ffe600', '#ff2e88', '#19e3ff', '#ff7a1a', '#7dff3a', '#b266ff'];
  var box = $('#chat'), log = $('#chatlog'), input = $('#chatin'), btn = $('#chatbtn'), badge = $('#chatbadge'), feed = $('#chatfeed');
  var unread = 0, open = false;

  function line(m) {
    var d = document.createElement('div'); d.className = 'cm';
    var n = document.createElement('b'); n.textContent = m.name;
    n.style.color = m.seat >= 0 ? COL[m.seat % 6] : '#aaa';
    var t = document.createElement('span'); t.textContent = ' ' + m.text; // textContent only: never HTML
    d.append(n, t); return d;
  }
  function trim(el, n) { while (el.children.length > n) el.firstChild.remove(); }
  function setOpen(on) {
    open = on; box.classList.toggle('open', on); feed.style.display = on ? 'none' : '';
    if (on) { unread = 0; badge.style.display = 'none'; log.scrollTop = log.scrollHeight; setTimeout(function () { input.focus(); }, 0); }
    else input.blur();
  }
  function add(m) {
    log.appendChild(line(m)); trim(log, 80); log.scrollTop = log.scrollHeight;
    if (open) return;
    unread++; badge.textContent = unread > 9 ? '9+' : unread; badge.style.display = 'block';
    var f = line(m); feed.appendChild(f); trim(feed, 3);
    setTimeout(function () { f.remove(); }, 7000);
  }
  function history(list) { log.innerHTML = ''; feed.innerHTML = ''; unread = 0; badge.style.display = 'none'; (list || []).forEach(function (m) { log.appendChild(line(m)); }); log.scrollTop = log.scrollHeight; }
  function submit() {
    var v = input.value.trim(); if (!v) return;
    if (window.Net) Net.send({ type: 'chat', text: v });
    input.value = '';
  }
  btn.addEventListener('click', function () { setOpen(!open); });
  $('#chatx').addEventListener('click', function () { setOpen(false); });
  input.addEventListener('keydown', function (e) {
    e.stopPropagation(); // typing must never trigger table shortcuts (space = take pile, enter = throw)
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') setOpen(false);
  });
  addEventListener('keydown', function (e) { // "T" or "/" opens chat, like most games
    var a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return;
    if (!document.body.classList.contains('inroom') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 't' || e.key === 'T' || e.key === '/') { e.preventDefault(); setOpen(true); }
  });
  window.Chat = { add: add, history: history, close: function () { setOpen(false); } };
})();
