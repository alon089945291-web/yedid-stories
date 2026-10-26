/* סטטוס / סטורי לאתר ידיד נפש - כפתור עגול, צופה במסך מלא ופאנל ניהול.
   הנתונים נשמרים כקובץ stories.json בתוך ה-GitHub שלך. כניסה לניהול: לחיצה ארוכה על הכפתור או #status-admin */
(function () {
  if (window.__ss || location.search.indexOf('safe_mode=1') > -1) return;
  window.__ss = 1;

  /* ===== הגדרות ===== */
  var CFG = {
    CHANNEL: 'ידיד נפש',
    LOGO_URL: '',                 // קישור לתמונת הלוגו. אם ריק - ינסה לזהות מהאתר
    GITHUB: { owner: 'alon089945291-web', repo: 'yedid-stories', branch: 'main', pages: 'https://alon089945291-web.github.io/yedid-stories/' },
    COLOR: '#ff6a00',             // צבע מותג של הטבעת והכפתורים
    RIGHT: 18, BOTTOM: 92         // מיקום הכפתור (פיקסלים מהפינה הימנית-תחתונה)
  };
  /* =============================== */

  var DEMO = location.protocol === 'file:' || location.search.indexOf('ssdemo=1') > -1; // הדגמה: פותחים את הקובץ ישירות במחשב
  var DEF = { on: true, imgSec: 5, maxVid: 30, expireH: 24, showBars: true, showCap: true, color: CFG.COLOR };
  var D = { list: [], S: Object.assign({}, DEF) }; // נתונים
  var V = { open: false, i: 0, el: 0, dur: 5000, p: 0, paused: false, ready: false, vid: null, last: 0, raf: 0 }; // מצב צופה
  var sh, root, isAdmin = false, demoId = 10;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $(s) { return sh.querySelector(s); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} }
  function ago(ms) {
    var m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return 'הרגע'; if (m < 60) return 'לפני ' + m + ' דקות';
    var h = Math.floor(m / 60); if (h < 24) return h === 1 ? 'לפני שעה' : 'לפני ' + h + ' שעות';
    var d = Math.floor(h / 24); return d === 1 ? 'אתמול' : 'לפני ' + d + ' ימים';
  }
  function svg(a, b, e) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs><rect width="720" height="1280" fill="url(#g)"/><text x="360" y="680" font-size="240" text-anchor="middle">' + e + '</text></svg>');
  }
  var DEMO_LIST = [
    { id: 'd1', type: 'image', url: svg('#ff9a3c', '#c81e3a', '💛'), caption: 'ברוכים הבאים לסטטוס של ידיד נפש', style: 's2', order: 10, active: true, createdAt: Date.now() - 3600e3 },
    { id: 'd2', type: 'image', url: svg('#2b5876', '#4e4376', '🕯️'), caption: 'רגע של חיזוק לקראת הערב', style: 's3', order: 20, active: true, createdAt: Date.now() - 2400e3 },
    { id: 'd3', type: 'image', url: svg('#11998e', '#38ef7d', '🌿'), caption: 'אתם לא לבד, אנחנו כאן', style: 's4', order: 30, active: true, createdAt: Date.now() - 600e3 }
  ];

  // ---------- נתונים (נשמרים בקובץ stories.json בתוך ה-GitHub) ----------
  var G = { data: null, sha: null }, LOCAL = {};
  function tok() { return store('ss_tok') || ''; }
  function ghFetch(path, method, body) {
    var u = 'https://api.github.com/repos/' + CFG.GITHUB.owner + '/' + CFG.GITHUB.repo + '/contents/' + path + (method ? '' : '?ref=' + CFG.GITHUB.branch + '&t=' + Date.now());
    return fetch(u, { method: method || 'GET', cache: 'no-store', headers: { Authorization: 'Bearer ' + tok(), Accept: 'application/vnd.github+json' }, body: body ? JSON.stringify(body) : undefined });
  }
  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
  function unb64(s) { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), function (c) { return c.charCodeAt(0); })); }
  async function loadG() {
    var r = await ghFetch('stories.json');
    if (r.status === 404) { G.data = { settings: {}, stories: [] }; G.sha = null; }
    else if (!r.ok) throw new Error(r.status === 401 ? 'הטוקן לא תקין' : r.status === 403 ? 'הטוקן בלי הרשאה למאגר' : 'שגיאה ' + r.status);
    else { var j = await r.json(); G.data = JSON.parse(unb64(j.content)); G.sha = j.sha; }
    G.data.stories = G.data.stories || []; G.data.settings = G.data.settings || {};
    D.list = G.data.stories; D.S = Object.assign({}, DEF, G.data.settings);
  }
  async function commit(msg) {
    var body = { message: msg, content: b64(JSON.stringify(G.data, null, 1)), branch: CFG.GITHUB.branch }; if (G.sha) body.sha = G.sha;
    var r = await ghFetch('stories.json', 'PUT', body);
    if (r.status === 409 || r.status === 422) throw new Error('התנגשות שמירה, רענן את הדף ונסה שוב');
    if (!r.ok) throw new Error('השמירה נכשלה (' + r.status + ')');
    G.sha = (await r.json()).content.sha;
  }
  async function fetchAll() {
    if (DEMO) { if (!D.demoInit) { D.demoInit = 1; D.list = DEMO_LIST.slice(); } return; }
    if (G.data) return; // מנהל: הנתונים הטריים כבר אצלנו
    try {
      var r = await fetch(CFG.GITHUB.pages + 'stories.json?t=' + Math.floor(Date.now() / 60000)); if (!r.ok) return;
      var j = await r.json(); D.list = j.stories || []; D.S = Object.assign({}, DEF, j.settings || {});
    } catch (e) {}
  }
  function sorted() { return D.list.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0); }); }
  function visible() {
    var ex = D.S.expireH > 0 ? D.S.expireH * 3600e3 : 0;
    return sorted().filter(function (s) { return s.active !== false && s.url && (!ex || Date.now() - s.createdAt < ex); });
  }
  async function dropMedia(url) {
    try {
      var p = url.replace(CFG.GITHUB.pages, ''), r = await ghFetch(p); if (!r.ok) return;
      await ghFetch(p, 'DELETE', { message: 'מחיקת מדיה', sha: (await r.json()).sha, branch: CFG.GITHUB.branch });
    } catch (e) {}
  }
  async function write(op, id, data) {
    var L = DEMO ? D.list : G.data.stories;
    if (op === 'add') { data.id = 's' + Date.now(); L.push(data); }
    else if (op === 'set') Object.assign(L.filter(function (s) { return s.id === id; })[0] || {}, data);
    else {
      var old = L.filter(function (s) { return s.id === id; })[0];
      L = L.filter(function (s) { return s.id !== id; });
      if (!DEMO && old && old.url && old.url.indexOf(CFG.GITHUB.pages + 'media/') === 0) dropMedia(old.url);
    }
    if (DEMO) D.list = L; else { G.data.stories = L; D.list = L; await commit('עדכון סטטוס'); }
    refreshFab();
  }
  async function saveSettings(o) {
    Object.assign(D.S, o);
    if (!DEMO) { G.data.settings = Object.assign(G.data.settings, o); await commit('עדכון הגדרות'); }
    applyColor(); refreshFab();
  }
  function shrink(file) { // מכווץ תמונות לרוחב 1080 כדי לשמור על המאגר קל
    return new Promise(function (ok) {
      var im = new Image(); im.onload = function () {
        var w = Math.min(1080, im.width), h = Math.round(im.height * w / im.width), c = document.createElement('canvas');
        c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0, w, h); c.toBlob(function (b) { ok(b || file); }, 'image/jpeg', 0.86);
      };
      im.onerror = function () { ok(file); }; im.src = URL.createObjectURL(file);
    });
  }
  async function upload(file, onp) {
    var isV = /^video/.test(file.type), local = URL.createObjectURL(file);
    if (DEMO) return { url: local, type: isV ? 'video' : 'image' };
    var blob = file, ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    if (!isV) { blob = await shrink(file); ext = 'jpg'; }
    else if (file.size > 40 * 1048576) throw new Error('הסרטון גדול מדי (מעל 40MB). כווץ או קצר אותו');
    onp('מעלה…');
    var data = await new Promise(function (ok) { var fr = new FileReader(); fr.onload = function () { ok(fr.result.split(',')[1]); }; fr.readAsDataURL(blob); });
    var path = 'media/' + Date.now() + '.' + ext;
    var r = await ghFetch(path, 'PUT', { message: 'העלאת מדיה', content: data, branch: CFG.GITHUB.branch });
    if (!r.ok) throw new Error('ההעלאה נכשלה (' + r.status + ')');
    var url = CFG.GITHUB.pages + path; LOCAL[url] = local;
    return { url: url, type: isV ? 'video' : 'image' };
  }

  // ---------- עיצוב ----------
  var CSS = '*{box-sizing:border-box;font-family:Assistant,Arial,sans-serif}button{font:inherit;cursor:pointer;border:0}' +
    '.fab{position:fixed;width:58px;height:58px;border-radius:50%;padding:3px;background:#c9ccd3;z-index:5;box-shadow:0 6px 18px rgba(0,0,0,.25);transition:transform .15s;display:none}' +
    '.fab.on{display:block}.fab:active{transform:scale(.92)}.fab.new{background:conic-gradient(var(--c),#ffd34e,#ff3d77,var(--c));animation:sp 3s linear infinite}' +
    '.fab.new::after{content:"";position:absolute;inset:-5px;border-radius:50%;border:2px solid var(--c);opacity:.5;animation:pu 1.8s ease-out infinite}' +
    '@keyframes sp{to{transform:rotate(360deg)}}@keyframes pu{from{transform:scale(.9);opacity:.6}to{transform:scale(1.25);opacity:0}}' +
    '.fab .in{position:absolute;inset:3px;border-radius:50%;border:3px solid #fff;background:#222 center/cover;display:grid;place-items:center;color:#fff;font-weight:700}' +
    '.fab.new .in{animation:sp 3s linear infinite reverse}' +
    '.ov{position:fixed;inset:0;background:rgba(0,0,0,.9);display:none;align-items:center;justify-content:center;z-index:10;direction:rtl}.ov.on{display:flex}' +
    '.ph{position:relative;width:min(420px,100vw);height:min(100dvh,820px);background:#000;border-radius:18px;overflow:hidden;color:#fff;user-select:none;-webkit-user-select:none}' +
    '@media(max-width:500px){.ph{border-radius:0;height:100dvh}}' +
    '.md{position:absolute;inset:0;display:grid;place-items:center;background:#000}.md img,.md video{width:100%;height:100%;object-fit:contain}' +
    '.sh{position:absolute;left:0;right:0;top:0;height:120px;background:linear-gradient(rgba(0,0,0,.6),transparent);pointer-events:none}' +
    '.bars{position:absolute;top:10px;left:10px;right:10px;display:flex;gap:4px;direction:rtl}.bars i{flex:1;height:3px;border-radius:3px;background:rgba(255,255,255,.35);overflow:hidden}' +
    '.bars b{display:block;height:100%;background:#fff;transform:scaleX(0);transform-origin:right}' +
    '.hd{position:absolute;top:22px;left:12px;right:12px;display:flex;align-items:center;gap:10px}.lg{width:40px;height:40px;border-radius:50%;border:2px solid #fff;background:#333 center/cover;flex:none;display:grid;place-items:center;font-weight:700}' +
    '.nm{flex:1;min-width:0;line-height:1.2}.nm b{display:block;font-size:15px}.nm span{font-size:12px;opacity:.8}' +
    '.ib{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;font-size:16px;backdrop-filter:blur(6px)}' +
    '.cp{position:absolute;left:0;right:0;bottom:0;padding:90px 20px 30px;background:linear-gradient(transparent,rgba(0,0,0,.72));text-align:center;pointer-events:none}' +
    '.cp div{display:inline-block;font-size:21px;font-weight:700;line-height:1.5;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;text-shadow:0 2px 8px rgba(0,0,0,.6)}' +
    '.cp .s2{background:rgba(255,255,255,.18);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.3);border-radius:16px;padding:10px 18px}' +
    '.cp .s3{color:#ffd34e;font-size:24px;letter-spacing:.2px}.cp .s4{background:var(--c);border-radius:14px;padding:9px 18px;text-shadow:none}' +
    '.tz{position:absolute;top:70px;bottom:130px;width:34%;background:transparent}.ar{position:absolute;top:50%;margin-top:-19px;width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.2);color:#fff;font-size:22px;backdrop-filter:blur(6px);opacity:.0;transition:opacity .2s}.ph:hover .ar{opacity:1}' +
    '.pn{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:20;direction:rtl}.pn.on{display:flex}' +
    '.bx{background:#fff;color:#1b1c20;width:min(560px,96vw);max-height:92vh;overflow:auto;border-radius:18px;padding:18px;box-shadow:0 20px 50px rgba(0,0,0,.4)}' +
    '.bx h3{margin:0 0 10px;display:flex;justify-content:space-between;align-items:center}.bx h4{margin:16px 0 8px;padding-top:12px;border-top:1px solid #eee}' +
    '.rw{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:7px 0;font-size:14px}.rw input[type=number]{width:80px}.bx input,.bx select,.bx textarea{border:1px solid #d6d8de;border-radius:10px;padding:7px 9px;font-size:14px}.bx textarea{width:100%;min-height:64px}' +
    '.b1{background:var(--c);color:#fff;border-radius:11px;padding:9px 16px;font-weight:700}.b2{background:#eef0f4;border-radius:11px;padding:7px 12px}' +
    '.it{display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #f0f0f3}.it .th{width:44px;height:58px;border-radius:8px;background:#222 center/cover;flex:none;overflow:hidden}.it .th video{width:100%;height:100%;object-fit:cover}' +
    '.it .tx{flex:1;min-width:0;font-size:13px}.it .tx small{color:#888;display:block}.it button{background:#eef0f4;border-radius:8px;padding:4px 8px}.msg{font-size:13px;color:#666;margin-top:6px}';

  function applyColor() { if (root) root.style.setProperty('--c', D.S.color || CFG.COLOR); }
  function logoUrl() {
    if (CFG.LOGO_URL) return CFG.LOGO_URL;
    var imgs = document.querySelectorAll('img'), W = window.innerWidth;
    for (var i = 0; i < imgs.length; i++) {
      var r = imgs[i].getBoundingClientRect();
      if (r.top < 120 && r.width > 28 && r.width < 100 && r.right > W * 0.6 && imgs[i].src) return imgs[i].src;
    }
    return '';
  }

  function isAdminPage() { return !!(store('ss_admin') || location.hash === '#status-admin' || /github\.io$/.test(location.hostname)); }

  // ---------- כפתור ----------
  function refreshFab() {
    var fab = $('#fab'); if (!fab) return;
    var l = visible(), flagged = isAdminPage();
    fab.classList.toggle('on', D.S.on !== false && (l.length > 0 || !!flagged));
    var newest = l.length ? l[l.length - 1].createdAt : 0;
    fab.classList.toggle('new', newest > (+store('ss_seen') || 0));
    var lg = logoUrl();
    var inn = $('#fab .in'); inn.style.backgroundImage = lg ? 'url("' + lg + '")' : ''; inn.textContent = lg ? '' : CFG.CHANNEL.slice(0, 1);
  }

  // ---------- צופה ----------
  function setBars() {
    var b = sh.querySelectorAll('.bars b'), n = b.length;
    for (var k = 0; k < n; k++) b[k].style.transform = 'scaleX(' + (k < V.i ? 1 : k === V.i ? Math.min(1, V.p) : 0) + ')';
  }
  function show(i) {
    var l = V.l; if (i < 0) i = 0; if (i >= l.length) return close();
    V.i = i; V.el = 0; V.p = 0; V.ready = false; V.vid = null;
    var s = l[i], md = $('.md'); md.innerHTML = '';
    $('.bars').style.display = D.S.showBars === false ? 'none' : 'flex';
    $('.bars').innerHTML = l.map(function () { return '<i><b></b></i>'; }).join('');
    var lg = logoUrl(); var g = $('.lg'); g.style.backgroundImage = lg ? 'url("' + lg + '")' : ''; g.textContent = lg ? '' : CFG.CHANNEL.slice(0, 1);
    $('.nm b').textContent = CFG.CHANNEL; $('.nm span').textContent = ago(s.createdAt || Date.now());
    var cp = $('.cp'); cp.style.display = s.caption && D.S.showCap !== false ? '' : 'none';
    cp.innerHTML = '<div class="' + esc(s.style || 's2') + '">' + esc(s.caption) + '</div>';
    $('#mu').style.display = s.type === 'video' ? '' : 'none';
    if (s.type === 'video') {
      var v = document.createElement('video'); v.src = s.url; v.playsInline = true; v.muted = V.muted !== false; v.preload = 'auto';
      v.onloadedmetadata = function () { V.dur = Math.min(v.duration || 10, D.S.maxVid || 30) * 1000; V.ready = true; v.play().catch(function () {}); };
      v.onended = function () { V.p = 1; }; V.vid = v; md.appendChild(v);
    } else {
      var im = new Image(); im.onload = function () { V.dur = (+s.duration || D.S.imgSec || 5) * 1000; V.ready = true; };
      im.onerror = function () { V.dur = 2000; V.ready = true; }; im.src = s.url; md.appendChild(im);
    }
    var nx = l[i + 1]; if (nx && nx.type !== 'video') (new Image()).src = nx.url; // טעינה מראש
    setBars();
  }
  function loop(ts) {
    if (!V.open) return;
    var dt = ts - (V.last || ts); V.last = ts;
    if (!V.paused && V.ready) {
      if (V.vid) V.p = V.vid.duration ? V.vid.currentTime * 1000 / V.dur : 0; else { V.el += dt; V.p = V.el / V.dur; }
      var cur = sh.querySelectorAll('.bars b')[V.i]; if (cur) cur.style.transform = 'scaleX(' + Math.min(1, V.p) + ')';
      if (V.p >= 1) { show(V.i + 1); }
    }
    V.raf = requestAnimationFrame(loop);
  }
  function pause(p) { V.paused = p; if (V.vid) { if (p) V.vid.pause(); else V.vid.play().catch(function () {}); } }
  async function open() {
    await fetchAll();
    V.l = visible();
    if (!V.l.length) { refreshFab(); if (isAdminPage()) adminEntry(); return; } // אין סטטוסים עדיין: מנהל נכנס ישר לניהול
    V.open = true; V.paused = false; V.last = 0; $('.ov').classList.add('on');
    document.documentElement.style.overflow = 'hidden';
    store('ss_seen', String(V.l[V.l.length - 1].createdAt));
    $('#gear').style.display = isAdmin || store('ss_admin') ? '' : 'none';
    show(0); V.raf = requestAnimationFrame(loop);
  }
  function close() {
    V.open = false; cancelAnimationFrame(V.raf); $('.md').innerHTML = ''; $('.ov').classList.remove('on');
    document.documentElement.style.overflow = ''; refreshFab();
  }

  // ---------- ניהול ----------
  async function adminEntry() {
    if (DEMO) { isAdmin = true; await fetchAll(); return panel(); }
    $('.pn').classList.add('on');
    if (!tok()) return tokenScreen();
    $('.bx').innerHTML = '<p>טוען…</p>';
    try { await loadG(); isAdmin = true; store('ss_admin', '1'); panel(); }
    catch (e) {
      if (/טוקן/.test(e.message)) { store('ss_tok', ''); return tokenScreen(e.message); }
      $('.bx').innerHTML = '<p>' + esc(e.message) + '</p><button class="b2" data-a="x">סגירה</button>';
    }
  }
  function tokenScreen(msg) {
    $('.bx').innerHTML = '<h3>כניסת מנהל <button class="b2" data-a="x">✕</button></h3>' + (msg ? '<p class="msg" style="color:#c00">' + esc(msg) + '</p>' : '') +
      '<p>הדבק כאן את הטוקן מ-GitHub (נוצר פעם אחת ונשמר רק במכשיר הזה):</p><input type="password" id="tk" style="width:100%" placeholder="github_pat_...">' +
      '<p class="msg">הרשאה נדרשת: Contents - Read and write, על המאגר yedid-stories בלבד.</p><button class="b1" data-a="tok">כניסה</button>';
  }
  function panel() {
    var S = D.S, l = sorted(), ex = S.expireH > 0 ? S.expireH * 3600e3 : 0;
    $('.pn').classList.add('on');
    $('.bx').innerHTML = '<h3>ניהול סטטוס <span><button class="b2" data-a="prev">תצוגה</button> <button class="b2" data-a="out">יציאה</button> <button class="b2" data-a="x">✕</button></span></h3>' +
      (DEMO ? '<div class="msg">מצב הדגמה: שום דבר לא נשמר אחרי רענון.</div>' : '<div class="msg">שינויים מופיעים באתר כדקה אחרי השמירה (זמן הפרסום של GitHub).</div>') +
      '<h4>הגדרות</h4>' +
      '<div class="rw"><span>הצג את הכפתור באתר</span><input type="checkbox" id="sOn"' + (S.on !== false ? ' checked' : '') + '></div>' +
      '<div class="rw"><span>זמן הצגת תמונה (שניות)</span><input type="number" id="sImg" min="1" max="60" value="' + S.imgSec + '"></div>' +
      '<div class="rw"><span>אורך מקסימלי לסרטון (שניות)</span><input type="number" id="sVid" min="3" max="180" value="' + S.maxVid + '"></div>' +
      '<div class="rw"><span>הסרה אוטומטית אחרי (שעות, 0 = לעולם לא)</span><input type="number" id="sExp" min="0" value="' + S.expireH + '"></div>' +
      '<div class="rw"><span>הצג פסי התקדמות</span><input type="checkbox" id="sBar"' + (S.showBars !== false ? ' checked' : '') + '></div>' +
      '<div class="rw"><span>הצג כיתובים</span><input type="checkbox" id="sCap"' + (S.showCap !== false ? ' checked' : '') + '></div>' +
      '<div class="rw"><span>צבע מותג</span><input type="color" id="sCol" value="' + (S.color || CFG.COLOR) + '"></div>' +
      '<button class="b1" data-a="saveS">שמירת הגדרות</button><span class="msg" id="m1"></span>' +
      '<h4>הוספת סטטוס</h4>' +
      '<div class="rw"><input type="file" id="nF" accept="image/*,video/*"></div>' +
      '<div class="rw"><input type="text" id="nU" placeholder="או קישור לתמונה / סרטון" style="flex:1"></div>' +
      '<textarea id="nC" placeholder="כיתוב (אופציונלי)"></textarea>' +
      '<div class="rw"><span>סגנון כיתוב</span><select id="nS"><option value="s1">פשוט</option><option value="s2" selected>זכוכית</option><option value="s3">זהב</option><option value="s4">צבעוני</option></select>' +
      '<span>שניות (ריק = ברירת מחדל)</span><input type="number" id="nD" min="1" max="60"></div>' +
      '<button class="b1" data-a="add">פרסום</button><span class="msg" id="m2"></span>' +
      '<h4>הסטטוסים (' + l.length + ')</h4>' +
      (l.map(function (s, k) {
        var old = ex && Date.now() - s.createdAt >= ex;
        return '<div class="it"><div class="th"' + (s.type === 'video' ? '><video src="' + esc(LOCAL[s.url] || s.url) + '#t=0.5"muted preload="metadata"></video>' : ' style="background-image:url(\'' + esc(LOCAL[s.url] || s.url) + '\')">') + '</div>' +
          '<div class="tx">' + esc((s.caption || '(בלי כיתוב)').slice(0, 60)) + '<small>' + ago(s.createdAt || Date.now()) + (s.active === false ? ' · מוסתר' : '') + (old ? ' · פג תוקף' : '') + '</small></div>' +
          '<button data-a="up" data-i="' + k + '">▲</button><button data-a="dn" data-i="' + k + '">▼</button><button data-a="ed" data-i="' + k + '">✏</button><button data-a="hd" data-i="' + k + '">👁</button><button data-a="rm" data-i="' + k + '">🗑</button></div>';
      }).join('') || '<div class="msg">אין עדיין סטטוסים.</div>');
  }
  async function act(a, el) {
    var l = sorted(), k = +el.dataset.i, s = l[k], v = function (id) { return $('#' + id); };
    if (a === 'x') { $('.pn').classList.remove('on'); return; }
    if (a === 'tok') { store('ss_tok', v('tk').value.trim()); return adminEntry(); }
    if (a === 'out') { store('ss_tok', ''); store('ss_admin', ''); G.data = null; isAdmin = false; $('.pn').classList.remove('on'); return; }
    if (a === 'prev') { $('.pn').classList.remove('on'); return open(); }
    if (a === 'saveS') {
      await saveSettings({ on: v('sOn').checked, imgSec: +v('sImg').value || 5, maxVid: +v('sVid').value || 30, expireH: +v('sExp').value || 0, showBars: v('sBar').checked, showCap: v('sCap').checked, color: v('sCol').value });
      v('m1').textContent = ' נשמר ✓'; return;
    }
    if (a === 'add') {
      var f = v('nF').files[0], url = v('nU').value.trim(), m = v('m2'), type = /\.(mp4|webm|mov)(\?|$)/i.test(url) ? 'video' : 'image';
      if (!f && !url) { m.textContent = ' בחר קובץ או הדבק קישור'; return; }
      try {
        if (f) { m.textContent = ' מעלה…'; var r = await upload(f, function (t) { m.textContent = ' ' + t; }); url = r.url; type = r.type; }
        var mx = l.length ? Math.max.apply(null, l.map(function (x) { return x.order || 0; })) : 0;
        await write('add', null, { type: type, url: url, caption: v('nC').value.trim(), style: v('nS').value, duration: +v('nD').value || 0, order: mx + 10, active: true, createdAt: Date.now() });
        panel(); $('#m2').textContent = ' פורסם ✓';
      } catch (e) { m.textContent = ' ' + e.message; }
      return;
    }
    if (!s) return;
    if (a === 'rm') { if (confirm('למחוק את הסטטוס?')) { await write('del', s.id); panel(); } return; }
    if (a === 'hd') { await write('set', s.id, { active: s.active === false }); panel(); return; }
    if (a === 'ed') { var c = prompt('כיתוב חדש:', s.caption || ''); if (c !== null) { await write('set', s.id, { caption: c }); panel(); } return; }
    if (a === 'up' || a === 'dn') {
      var o = l[k + (a === 'up' ? -1 : 1)]; if (!o) return;
      var so = s.order || 0, oo = o.order || 0; if (so === oo) oo = so + (a === 'up' ? -1 : 1);
      await write('set', s.id, { order: oo }); await write('set', o.id, { order: so }); panel();
    }
  }

  // ---------- בנייה ----------
  function boot() {
    var host = document.createElement('div'); host.style.cssText = 'all:initial;position:fixed;z-index:2147483000;left:0;top:0;width:0;height:0';
    document.body.appendChild(host); sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = '<style>' + CSS + '</style><div id="r">' +
      '<button class="fab" id="fab" aria-label="סטטוס" style="right:' + CFG.RIGHT + 'px;bottom:' + CFG.BOTTOM + 'px"><span class="in"></span></button>' +
      '<div class="ov"><div class="ph"><div class="md"></div><div class="sh"></div><div class="bars"></div>' +
      '<div class="hd"><div class="lg"></div><div class="nm"><b></b><span></span></div><button class="ib" id="mu" title="צליל">🔇</button><button class="ib" id="gear" title="ניהול" style="display:none">⚙</button><button class="ib" id="cl" title="סגירה">✕</button></div>' +
      '<div class="cp"></div><div class="tz" id="tn" style="left:0"></div><div class="tz" id="tp" style="right:0"></div>' +
      '<button class="ar" id="an" style="left:8px">‹</button><button class="ar" id="ap" style="right:8px">›</button></div></div>' +
      '<div class="pn"><div class="bx"></div></div></div>';
    root = $('#r'); applyColor();
    refreshFab(); // מציג מיד את הכפתור בדף הניהול
    var fab = $('#fab'), lp = 0, longp = false;
    fab.addEventListener('pointerdown', function () { longp = false; lp = setTimeout(function () { longp = true; adminEntry(); }, 700); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (e) { fab.addEventListener(e, function () { clearTimeout(lp); }); });
    fab.addEventListener('click', function () { if (!longp) open(); });
    $('#cl').onclick = close; $('#gear').onclick = function () { close(); adminEntry(); };
    $('#mu').onclick = function () { V.muted = V.vid ? !V.vid.muted : true; if (V.vid) V.vid.muted = V.muted; this.textContent = V.muted ? '🔇' : '🔊'; };
    $('#an').onclick = function () { show(V.i + 1); }; $('#ap').onclick = function () { show(V.i - 1); }; // בעברית: שמאלה = הבא
    [['#tn', 1], ['#tp', -1]].forEach(function (z) {
      var t0 = 0, el = $(z[0]);
      el.addEventListener('pointerdown', function () { t0 = Date.now(); pause(true); });
      el.addEventListener('pointerup', function () { pause(false); if (Date.now() - t0 < 250) show(V.i + z[1]); });
      el.addEventListener('pointerleave', function () { pause(false); });
    });
    $('.pn').addEventListener('click', function (e) { var b = e.target.closest('[data-a]'); if (b) act(b.dataset.a, b).catch(function (er) { alert(er && er.message ? er.message : 'שגיאה'); }); else if (e.target.classList.contains('pn')) $('.pn').classList.remove('on'); });
    document.addEventListener('keydown', function (e) {
      if (!V.open) return;
      if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') show(V.i + 1); else if (e.key === 'ArrowRight') show(V.i - 1); else if (e.key === ' ') pause(!V.paused);
    });
    document.addEventListener('visibilitychange', function () { if (V.open) pause(document.hidden); });
    window.addEventListener('hashchange', function () { if (location.hash === '#status-admin') { refreshFab(); adminEntry(); } });
    var go = function () { fetchAll().then(function () { refreshFab(); if (location.hash === '#status-admin') adminEntry(); }); };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 2500 }); else setTimeout(go, 800);
    setInterval(function () { if (!V.open) fetchAll().then(refreshFab); }, 300000);
    setTimeout(refreshFab, 2500); // הלוגו באתר נטען מאוחר יותר
  }

  window.ssAdmin = function () { if (sh) adminEntry(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
