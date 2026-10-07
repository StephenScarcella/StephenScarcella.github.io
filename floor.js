// Warehouse floor: static layout drawn once to an offscreen canvas, forklifts animated on top.
// World is 1000 x 640 units; everything scales to the frame width.
(function () {
  'use strict';
  var W = 1000, H = 640;
  var cv = document.getElementById('floor');
  var ctx = cv.getContext('2d');
  var frame = document.getElementById('frame');
  var tip = document.getElementById('tip');
  var panel = document.getElementById('panel');
  var panelBody = document.getElementById('panelBody');
  var panelLoc = document.getElementById('panelLoc');
  var logEl = document.getElementById('log');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Empty data-href = link not ready yet: hide it rather than show a dead button.
  document.querySelectorAll('[data-href]').forEach(function (a) {
    if (a.dataset.href) a.href = a.dataset.href; else a.closest('.links') ? a.closest('.links').remove() : a.remove();
  });

  // Video clips: same rule, no file = no player.
  document.querySelectorAll('video[data-src]').forEach(function (v) {
    if (v.dataset.src) v.src = v.dataset.src; else v.remove();
  });

  // ---- zones: [x, y, w, h] in world units ----
  var ZONES = [
    { id: 'about',   label: 'Receiving',  sub: 'About me',               r: [20, 60, 130, 480] },
    { id: 'tahari',  label: 'Racks A–D',  sub: 'Elie Tahari · 2021–25',  r: [240, 80, 380, 152] },
    { id: 'xact',    label: 'Racks E–H',  sub: 'XACT · 2025–now',        r: [240, 300, 380, 152] },
    { id: 'wms',     label: 'Pack 1',     sub: 'XACT WMS',               r: [710, 70, 120, 120] },
    { id: 'outage',  label: 'Pack 2',     sub: 'Power Outage game',      r: [845, 70, 120, 120] },
    { id: 'traffic', label: 'Pack 3',     sub: 'Hoboken traffic sim',    r: [710, 205, 120, 120] },
    { id: 'twin',    label: 'Pack 4',     sub: 'XACT Floor 3D twin',     r: [845, 205, 120, 120] },
    { id: 'office',  label: 'Office',     sub: 'Resume',                 r: [710, 390, 255, 215] },
    { id: 'ship',    label: 'Outbound',   sub: 'Contact',                r: [240, 535, 380, 85] }
  ];
  var byId = {}; ZONES.forEach(function (z) { byId[z.id] = z; });

  // ---- forklift routes: aisle centerlines, axis-aligned legs; S = stop with a log line ----
  var ROUTES = [
    { id: 'FL-01', speed: 62, path: [[100, 180, 'received pallet · DOCK 2'], [200, 180], [200, 156], [430, 156, 'putaway → A-07'], [660, 156], [660, 266], [200, 266], [200, 180]] },
    { id: 'FL-02', speed: 55, path: [[200, 376], [480, 376, 'picked → F-09'], [660, 376], [660, 496], [380, 496, 'staged for TJX · DOOR 7'], [200, 496]] },
    { id: 'FL-03', speed: 70, path: [[100, 420, 'received cartons · DOCK 4'], [200, 420], [200, 55], [540, 55, 'replenished → B-12'], [660, 55], [660, 205, 'delivered to PACK 1'], [660, 266], [200, 266]] }
  ];

  // ---- colors from CSS tokens (re-read on theme change) ----
  var C = {};
  function readColors() {
    var s = getComputedStyle(document.documentElement);
    ['floor', 'floor-2', 'line', 'wall', 'upright', 'beam', 'pallet', 'box', 'box-2', 'fork', 'fork-dark', 'hi', 'floor-label', 'glass', 'table', 'tx', 'paper']
      .forEach(function (k) { C[k] = s.getPropertyValue('--' + k).trim(); });
  }

  // deterministic "random" so racks look the same every load
  var seed = 7;
  function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }

  var stat = document.createElement('canvas');
  var sctx = stat.getContext('2d');
  var scale = 1, dpr = 1;

  function sizeCanvas() {
    var w = frame.clientWidth;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = w / W;
    cv.width = Math.round(w * dpr); cv.height = Math.round(H * scale * dpr);
    cv.style.height = (H * scale) + 'px';
    stat.width = cv.width; stat.height = cv.height;
    drawStatic();
  }

  function stencil(c, text, x, y, size, color, align) {
    c.save();
    c.fillStyle = color; c.font = '800 ' + size + 'px "Big Shoulders Stencil Display", "Arial Narrow", Impact, sans-serif';
    c.textAlign = align || 'center'; c.textBaseline = 'middle';
    c.fillText(text, x, y); c.restore();
  }
  function mono(c, text, x, y, size, color, align) {
    c.save(); c.fillStyle = color; c.font = '600 ' + size + 'px "Martian Mono", Consolas, monospace';
    c.textAlign = align || 'left'; c.textBaseline = 'middle'; c.fillText(text, x, y); c.restore();
  }

  function palletAt(c, x, y, s) {
    c.fillStyle = C.pallet; c.fillRect(x, y, s, s);
    c.fillStyle = C.box; c.fillRect(x + 2, y + 2, s - 4, s - 4);
    c.strokeStyle = C['box-2']; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x + 2, y + s / 2); c.lineTo(x + s - 2, y + s / 2); c.moveTo(x + s / 2, y + 2); c.lineTo(x + s / 2, y + s - 2); c.stroke();
  }

  function rackRow(c, x, y, w, h, letter) {
    var bays = 10, bw = w / bays;
    for (var i = 0; i < bays; i++) if (rnd() < 0.74) palletAt(c, x + i * bw + 5, y + 3, Math.min(bw - 10, h - 6));
    c.strokeStyle = C.beam; c.lineWidth = 2.5; c.strokeRect(x, y, w, h);
    c.fillStyle = C.upright;
    for (var j = 0; j <= bays; j++) { c.fillRect(x + j * bw - 2.5, y - 2, 5, 5); c.fillRect(x + j * bw - 2.5, y + h - 3, 5, 5); }
    mono(c, letter, x - 12, y + h / 2, 11, C['floor-label'], 'center');
  }

  function drawStatic() {
    seed = 7;
    var c = sctx;
    c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    c.fillStyle = C.floor; c.fillRect(0, 0, W, H);
    // slab joints
    c.strokeStyle = C['floor-2']; c.lineWidth = 1;
    for (var gx = 100; gx < W; gx += 100) { c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx, H); c.stroke(); }
    for (var gy = 80; gy < H; gy += 80) { c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke(); }

    // walls with dock door gaps (west = inbound, south = outbound)
    c.strokeStyle = C.wall; c.lineWidth = 8; c.strokeRect(4, 4, W - 8, H - 8);
    c.fillStyle = C.floor;
    for (var d = 0; d < 5; d++) {
      var dy = 88 + d * 96; c.fillRect(0, dy, 9, 58);
      c.fillStyle = C.line; c.fillRect(9, dy, 4, 58); c.fillStyle = C.floor;
      mono(c, 'D' + (d + 1), 18, dy + 29, 9, C['floor-label']);
    }
    for (var o = 0; o < 4; o++) {
      var ox = 268 + o * 92; c.fillRect(ox, H - 9, 58, 9);
      c.fillStyle = C.line; c.fillRect(ox, H - 13, 58, 4); c.fillStyle = C.floor;
      mono(c, 'DOOR ' + (o + 6), ox + 29, H - 22, 8, C['floor-label'], 'center');
    }

    // receiving: hatched staging lane + staged pallets
    c.save(); c.beginPath(); c.rect(36, 60, 110, 480); c.clip();
    c.strokeStyle = C['floor-2']; c.lineWidth = 3;
    for (var hx = -480; hx < 160; hx += 16) { c.beginPath(); c.moveTo(hx, 540); c.lineTo(hx + 480, 60); c.stroke(); }
    c.restore();
    [[52, 96], [52, 124], [84, 96], [52, 252], [52, 280], [84, 300], [52, 470], [84, 470], [52, 498]].forEach(function (p) { palletAt(c, p[0], p[1], 24); });
    stencil(c, 'RECEIVING', 100, 560, 18, C['floor-label']);

    // racks
    var rows = [[80, 'A', 'B'], [180, 'C', 'D'], [300, 'E', 'F'], [400, 'G', 'H']];
    rows.forEach(function (r) { rackRow(c, 240, r[0], 380, 26, r[1]); rackRow(c, 240, r[0] + 26, 380, 26, r[2]); });
    stencil(c, 'TAHARI  2021–25', 430, 156, 20, C['floor-label']);
    stencil(c, 'XACT  2025–NOW', 430, 376, 20, C['floor-label']);

    // safety lines around rack blocks and pack area
    c.strokeStyle = C.line; c.lineWidth = 3;
    c.strokeRect(232, 72, 396, 168); c.strokeRect(232, 292, 396, 168);
    c.setLineDash([10, 8]); c.strokeRect(702, 62, 271, 271); c.strokeRect(232, 527, 396, 96); c.setLineDash([]);

    // pack stations
    ZONES.filter(function (z) { return /^Pack/.test(z.label); }).forEach(function (z) {
      var x = z.r[0], y = z.r[1];
      c.fillStyle = C.table; c.fillRect(x + 12, y + 30, 96, 46);
      c.fillStyle = C['fork-dark']; c.fillRect(x + 46, y + 36, 28, 6);           // monitor
      c.fillStyle = C.box; c.fillRect(x + 18, y + 48, 18, 18); c.fillRect(x + 84, y + 50, 16, 14); // cartons
      c.fillStyle = C.wall; c.beginPath(); c.arc(x + 60, y + 92, 7, 0, Math.PI * 2); c.fill(); // packer stool
      mono(c, z.label.toUpperCase(), x + 60, y + 14, 9, C['floor-label'], 'center');
      mono(c, z.sub, x + 60, y + 110, 9, C.tx, 'center');
    });

    // office: walls, glass, desk
    var of = byId.office.r;
    c.strokeStyle = C.wall; c.lineWidth = 6; c.strokeRect(of[0], of[1], of[2], of[3]);
    c.strokeStyle = C.glass; c.lineWidth = 6; c.beginPath(); c.moveTo(of[0] + 30, of[1]); c.lineTo(of[0] + 200, of[1]); c.stroke();
    c.fillStyle = C.floor; c.fillRect(of[0] - 4, of[1] + 120, 8, 40); // door
    c.fillStyle = C.table; c.fillRect(of[0] + 120, of[1] + 60, 100, 44);
    c.fillStyle = C['fork-dark']; c.fillRect(of[0] + 150, of[1] + 66, 34, 6);
    c.fillStyle = C.paper; c.fillRect(of[0] + 128, of[1] + 78, 16, 20);
    c.fillStyle = C.wall; c.beginPath(); c.arc(of[0] + 168, of[1] + 120, 9, 0, Math.PI * 2); c.fill();
    stencil(c, 'OFFICE', of[0] + 60, of[1] + 175, 22, C['floor-label']);
    mono(c, 'resume · education', of[0] + 60, of[1] + 196, 9, C.tx, 'center');

    // outbound staging
    [[262, 556], [290, 556], [262, 584], [354, 556], [382, 556], [446, 584], [538, 556], [566, 556], [566, 584]].forEach(function (p) { palletAt(c, p[0], p[1], 24); });
    stencil(c, 'OUTBOUND · CONTACT', 430, 512, 16, C['floor-label']);
  }

  // ---- forklifts ----
  var fls = ROUTES.map(function (r, i) {
    var p = r.path[0];
    return { id: r.id, path: r.path, speed: r.speed, seg: 0, x: p[0], y: p[1], ang: 0, wait: 0.4 + i * 0.7, carry: i === 1, blocked: 0, t: i };
  });

  function angDiff(a, b) { var d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

  function update(f, dt) {
    f.t += dt;
    if (f.wait > 0) { f.wait -= dt; return; }
    var n = f.path.length, a = f.path[f.seg], b = f.path[(f.seg + 1) % n];
    var dx = b[0] - f.x, dy = b[1] - f.y, dist = Math.hypot(dx, dy);
    if (dist < 0.01) { f.seg = (f.seg + 1) % n; return; }
    var target = Math.atan2(dy, dx), dd = angDiff(f.ang, target);
    if (Math.abs(dd) > 0.04) { f.ang += Math.sign(dd) * Math.min(Math.abs(dd), 3.2 * dt); return; }
    f.ang = target;
    // yield if another truck is just ahead
    var ax = f.x + Math.cos(f.ang) * 30, ay = f.y + Math.sin(f.ang) * 30;
    for (var i = 0; i < fls.length; i++) {
      var o = fls[i]; if (o === f) continue;
      if (Math.hypot(o.x - ax, o.y - ay) < 24 && f.blocked < 1.6) { f.blocked += dt; return; }
    }
    f.blocked = 0;
    var step = f.speed * dt;
    if (step >= dist) {
      f.x = b[0]; f.y = b[1]; f.seg = (f.seg + 1) % n;
      if (b[2]) { f.wait = 1.4; f.carry = !f.carry; log(f.id + ' · ' + b[2]); }
    } else { f.x += dx / dist * step; f.y += dy / dist * step; }
  }

  function drawFork(c, f) {
    c.save(); c.translate(f.x, f.y); c.rotate(f.ang);
    c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(-14, -8, 32, 20);                  // shadow
    c.fillStyle = C['fork-dark']; c.fillRect(9, -6, 13, 2.5); c.fillRect(9, 3.5, 13, 2.5); // forks
    if (f.carry) palletAt(c, 9, -10, 20);
    c.fillStyle = C['fork-dark']; c.fillRect(6, -9, 3, 18);                          // mast
    c.fillStyle = C.fork; c.fillRect(-15, -9, 21, 18);                              // body
    c.fillStyle = C['fork-dark']; c.fillRect(-15, -9, 5, 18);                       // counterweight
    c.strokeStyle = C['fork-dark']; c.lineWidth = 1.4; c.strokeRect(-8, -7, 12, 14); // overhead guard
    c.beginPath(); c.moveTo(-8, -7); c.lineTo(4, 7); c.moveTo(4, -7); c.lineTo(-8, 7); c.stroke();
    var blink = reduce ? 1 : (Math.sin(f.t * 6) > 0 ? 1 : 0.25);
    c.fillStyle = 'rgba(255,150,0,' + blink + ')'; c.beginPath(); c.arc(-11, 0, 2.6, 0, Math.PI * 2); c.fill();
    c.restore();
    mono(c, f.id, f.x, f.y - 17, 8, C.tx, 'center');
  }

  // ---- interaction ----
  var hover = null, active = null;
  function zoneAt(px, py) {
    for (var i = ZONES.length - 1; i >= 0; i--) { var r = ZONES[i].r; if (px >= r[0] && px <= r[0] + r[2] && py >= r[1] && py <= r[1] + r[3]) return ZONES[i]; }
    return null;
  }
  function toWorld(e) { var b = cv.getBoundingClientRect(); return [(e.clientX - b.left) / scale, (e.clientY - b.top) / scale]; }

  cv.addEventListener('pointermove', function (e) {
    var p = toWorld(e), z = zoneAt(p[0], p[1]);
    hover = z; cv.style.cursor = z ? 'pointer' : 'default';
    if (z && e.pointerType === 'mouse') {
      tip.hidden = false; tip.innerHTML = '';
      tip.appendChild(document.createTextNode(z.label));
      var s = document.createElement('small'); s.textContent = z.sub; tip.appendChild(s);
      tip.style.left = (e.clientX - cv.getBoundingClientRect().left) + 'px';
      tip.style.top = (e.clientY - cv.getBoundingClientRect().top) + 'px';
    } else tip.hidden = true;
    if (reduce) render();
  });
  cv.addEventListener('pointerleave', function () { hover = null; tip.hidden = true; if (reduce) render(); });
  cv.addEventListener('click', function (e) { var p = toWorld(e), z = zoneAt(p[0], p[1]); if (z) open(z.id); });

  var lastFocus = null;
  function open(id) {
    var src = document.getElementById(id); if (!src) return;
    active = byId[id] || null;
    lastFocus = document.activeElement;
    panelLoc.textContent = src.dataset.loc || '';
    panelBody.innerHTML = '';
    Array.prototype.forEach.call(src.children, function (ch) { panelBody.appendChild(ch.cloneNode(true)); });
    var h = panelBody.querySelector('h2'); if (h) h.id = 'panelTitle';
    panel.hidden = false; panelBody.scrollTop = 0;
    document.getElementById('close').focus({ preventScroll: true });
    setCurrent(id);
    try { history.replaceState(null, '', '#' + id); } catch (err) {}
    if (reduce) render();
  }
  function close() {
    panel.hidden = true; active = null; setCurrent(null);
    try { history.replaceState(null, '', location.pathname); } catch (err) {}
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    if (reduce) render();
  }
  document.getElementById('close').addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) close(); });

  // chips
  var chips = document.getElementById('chips');
  ZONES.forEach(function (z) {
    var b = document.createElement('button'); b.type = 'button'; b.id = 'chip-' + z.id; b.dataset.id = z.id;
    b.appendChild(document.createTextNode(z.sub));
    b.addEventListener('click', function () { open(z.id); frame.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); });
    chips.appendChild(b);
  });
  function setCurrent(id) { chips.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-current', String(b.dataset.id === id)); }); }

  // floor log
  var lines = [];
  function log(msg) {
    var t = new Date(), hh = String(t.getHours()).padStart(2, '0'), mm = String(t.getMinutes()).padStart(2, '0');
    lines.unshift(hh + ':' + mm + '  ' + msg); lines = lines.slice(0, 4);
    logEl.innerHTML = ''; lines.forEach(function (l) { var li = document.createElement('li'); li.textContent = l; logEl.appendChild(li); });
  }

  // ---- render loop ----
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(stat, 0, 0);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    [active, hover].forEach(function (z, i) {
      if (!z || (i === 1 && z === active)) return;
      var r = z.r;
      ctx.save(); ctx.globalAlpha = i === 0 ? 0.16 : 0.1; ctx.fillStyle = C.hi; ctx.fillRect(r[0], r[1], r[2], r[3]); ctx.restore();
      ctx.save(); ctx.strokeStyle = C.hi; ctx.lineWidth = 3; ctx.setLineDash(i === 0 ? [] : [8, 6]); ctx.strokeRect(r[0] - 2, r[1] - 2, r[2] + 4, r[3] + 4); ctx.restore();
    });
    fls.forEach(function (f) { drawFork(ctx, f); });
  }
  var last = 0;
  function loop(ts) {
    var dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    fls.forEach(function (f) { update(f, dt); });
    render();
    requestAnimationFrame(loop);
  }

  // ---- boot ----
  readColors();
  sizeCanvas();
  if (window.ResizeObserver) new ResizeObserver(function () { sizeCanvas(); if (reduce) render(); }).observe(frame);
  else window.addEventListener('resize', sizeCanvas);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { readColors(); drawStatic(); if (reduce) render(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { drawStatic(); if (reduce) render(); });

  log('FL-01 · shift start · all trucks inspected');
  if (location.hash && byId[location.hash.slice(1)]) open(location.hash.slice(1));
  if (reduce) render(); else requestAnimationFrame(loop);
})();
