/* הדהוד אימוג'י חלק וקל - אפקט חזותי בלבד, לא משנה את הספירה האמיתית באתר.
   עובד רק על הודעות שנראות על המסך, בלי להכביד על האתר, ומכבה את עצמו אוטומטית אם משהו איטי.
   להדביק בתיבת "קוד להטמעה ב-head". אם משהו נשבר: הוסיפו ?safe_mode=1 לכתובת. */
(function () {
  if (location.search.indexOf('safe_mode=1') > -1) return;

  /* ===== הגדרות לעריכה ===== */
  var W = { '❤️': 1, '🙏': 0.55, '👍': 0.35, '👏': 0.2, '👌': 0.18, '😍': 0.12, '🥲': 0.1, '😢': 0.08, '😂': 0.06, '😱': 0.04, '🎉': 0.04 }; // משקל: כמה האימוג'י נפוץ
  var MIN_TYPES = 3, MAX_TYPES = 5; // כמה סוגי אימוג'י בהודעה (משתנה מהודעה להודעה)
  var ONLY_IF_REACTED = true;  // true = רק בהודעות שיש בהן לפחות תגובה אמיתית אחת
  var DELAY_MIN = 10;          // דקות עד שמתחילות להופיע תגובות
  var DELAY_JITTER = 6;        // פיזור אקראי נוסף (דקות)
  var TAU = 100;               // קצב העלייה: גבוה = איטי יותר (דקות)
  var P_VIRAL = 0.03, P_GOOD = 0.15; // סיכוי להודעה ויראלית / מצליחה (נמוך = פחות פערים)
  var RATE = [[0.05, 0.10], [0.10, 0.14], [0.18, 0.25]]; // אחוז הצופים שמגיבים: רגילה / מצליחה / ויראלית
  var FALLBACK = [[20, 50], [50, 80], [90, 140]];         // סך תגובות כשאין מספר צפיות
  var CENTER = 35, COMPRESS = 0.6; // כיווץ פערים: 1 = בלי כיווץ, 0.5 = פערים קטנים מאוד
  var MAX_TOTAL = 400;         // תקרה לסך התגובות בהודעה
  var STEP_MIN = 1500, STEP_MAX = 7000; // זמן בין עלייה אחת לבאה (אלפיות שנייה)
  var VIEWS_SELECTOR = '';     // אופציונלי: סלקטור של מספר הצפיות, אם הזיהוי האוטומטי טועה
  /* ========================= */

  function norm(s) { return String(s).replace(/\uFE0F/g, '').trim(); }
  var CAT0 = { '❤️': 'love', '💕': 'love', '😍': 'love', '🥰': 'love', '🙏': 'pray', '🤲': 'pray', '👍': 'ok', '👌': 'ok', '👏': 'ok', '💪': 'ok', '🔥': 'ok', '🎯': 'ok',
    '😂': 'joy', '🤣': 'joy', '😄': 'joy', '🎉': 'joy', '😢': 'sad', '😭': 'sad', '🥲': 'sad', '💔': 'sad', '😱': 'shock', '😮': 'shock', '💥': 'shock' };
  var AFF = { lovepray: .5, praylove: .5, loveok: .4, oklove: .4, prayok: .35, okpray: .35, praysad: .6, sadpray: .6, sadlove: .45, lovesad: .45,
    joyok: .6, okjoy: .6, joylove: .4, lovejoy: .4, shocksad: .35, sadshock: .35, shockjoy: .2, joyshock: .2, shockpray: .3, prayshock: .3 };
  var CAT = {}; Object.keys(CAT0).forEach(function (e) { CAT[norm(e)] = CAT0[e]; });
  function catOf(e) { return CAT[norm(e)] || 'x'; }

  var ST = {}, SEEN = {}, lastSeen = 0, tpl = null;
  var dead = false, busy = false, tmr = 0, slow = 0, errs = 0, obs = null, io = null, tick = 0, minute = 0;

  function hash(s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return Math.abs(x); }
  function R(seed, k) { var x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); }
  function lerp(r, u) { return r[0] + u * (r[1] - r[0]); }
  function salt(emo) { return emo.codePointAt(0) % 97; }
  function frac(age, delay) { var t = age - delay; return t <= 0 ? 0 : 1 - Math.exp(-t / TAU); }
  function num(s) { var x = String(s).replace(/,/g, '').match(/\d+/); return x ? +x[0] : null; }
  function cn(e) { var c = e.querySelector('.count'); return c ? parseInt(c.textContent, 10) || 0 : 0; }

  // כרטיס ההודעה: האלמנט שחוזר ברשימה (יש לידו אח עם אותו מבנה). בדיקה זולה, לא סורקת את העמוד
  function cardOf(sec) {
    var n = sec.parentElement, fallback = n;
    for (var d = 0; d < 8 && n && n.parentElement; d++, n = n.parentElement) {
      var a = n.previousElementSibling, b = n.nextElementSibling;
      if ((a && a.className === n.className) || (b && b.className === n.className)) return n;
      if (d === 2) fallback = n;
    }
    return fallback;
  }

  function info(sec) {
    var m = sec.__m;
    if (m && (m.ok || m.tries >= 4)) return m;
    var card = cardOf(sec), txt = card ? (card.textContent || '').slice(0, 4000) : '';
    var tm = txt.match(/(\d{1,2}):(\d{2})/);
    var idm = txt.match(/#(\d{3,})/);
    var seed = idm ? +idm[1] : hash(txt.replace(/\d+/g, '').slice(0, 80));
    var tries = (m ? m.tries : 0) + 1;
    if (!tm) { sec.__m = { seed: seed, dt: null, card: card, tries: tries, ok: false, ctx: {} }; return sec.__m; }
    var now = new Date();
    var dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +tm[1], +tm[2]);
    var dm = txt.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
    var head = txt.slice(0, 160);
    if (dm) { var y = +dm[3]; if (y < 100) y += 2000; dt = new Date(y, +dm[2] - 1, +dm[1], +tm[1], +tm[2]); }
    else if (/אתמול/.test(head)) dt.setDate(dt.getDate() - 1);
    else if (/(^|[^א-ת])(יום [א-ו](?![א-ת])|שבת)/.test(head)) dt = null;
    else if (!/היום/.test(head) && dt > now) dt.setDate(dt.getDate() - 1);
    sec.__m = {
      seed: seed, dt: dt, card: card, tries: tries, ok: true,
      ctx: {
        pray: /תפילה|תהילים|רפו(א|י)|ישועה|ירחם|נפטר|שבעה|לעילוי|חולים|בע"ה|בעזרת השם/.test(txt),
        humor: /😂|🤣|חחח/.test(txt),
        joy: /מזל טוב|שמחה|בשורה|ברכות|הצלחה/.test(txt)
      }
    };
    return sec.__m;
  }

  function getViews(m, now, real) {
    if (m.vt && now - m.vt < 60000) return m.views;
    m.vt = now; m.views = null;
    var c = m.card; if (!c) return null;
    var n = null, e;
    if (VIEWS_SELECTOR && (e = c.querySelector(VIEWS_SELECTOR))) n = num(e.textContent);
    if (n == null && (e = c.querySelector('[class*="eye" i],[icon*="eye" i],[name*="eye" i],[data-lucide*="eye" i]'))) {
      var p = e.parentElement;
      n = num(((p && p.textContent) || '').replace(/#\d+/g, ' ').replace(/\d{1,2}:\d{2}/g, ' '));
    }
    if (n == null) {
      var h = (c.textContent || '').slice(0, 160).replace(/#\d+/g, ' ').replace(/\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}/g, ' ').replace(/\d{1,2}:\d{2}/g, ' ');
      var mm = h.match(/(?:^|\D)(\d{1,3}(?:,\d{3})+|\d{2,6})(?:\D|$)/);
      if (mm) n = num(mm[1]);
    }
    if (n != null && n < real) n = null;
    m.views = n;
    return n;
  }

  function setEl(el, emo, n, key) {
    var c = el.querySelector('.count');
    if (c && c.textContent !== String(n)) c.textContent = n;
    var t = n + ' אנשים הגיבו עם ' + emo;
    if (el.title !== t) el.title = t;
    el.dataset.shown = n;
    el.__k = key; el.__emo = emo;
  }

  function processSection(sec, now, okKeys) {
    var m = info(sec), seed = m.seed;
    var age = m.dt ? Math.max(0, (now - m.dt) / 60000) : 1e9;
    var real = 0, have = {}, fakes = [];

    sec.querySelectorAll('.emoji-reaction').forEach(function (el) {
      var e = el.querySelector('.emoji'), c = el.querySelector('.count');
      if (!e || !c) return;
      var emo = e.textContent.trim();
      if (el.dataset.fake) { fakes.push([el, emo]); if (!have[emo]) have[emo] = el; return; }
      have[emo] = el;
      var cur = parseInt(c.textContent, 10) || 0;
      if (el.dataset.shown !== String(cur)) el.dataset.base = cur;
      real += parseInt(el.dataset.base, 10) || 0;
    });
    fakes.forEach(function (p) { if (have[p[1]] !== p[0]) p[0].remove(); });
    if (ONLY_IF_REACTED && !real) return;

    var u = R(seed, 1), tier = u < P_VIRAL ? 2 : u < P_VIRAL + P_GOOD ? 1 : 0;
    var views = getViews(m, now, real), total;
    if (views) total = Math.round(views * lerp(RATE[tier], R(seed, 2)));
    else total = Math.round(lerp(FALLBACK[tier], R(seed, 2)));
    total = Math.round(CENTER * Math.pow(Math.max(total, 1) / CENTER, COMPRESS));
    total = Math.min(MAX_TOTAL, Math.max(3, total));

    // הרכב האימוג'ים נקבע פעם אחת לכל הודעה: 3 עד 5 סוגים, בהתאם להבעות ההצבעות האמיתיות
    if (!sec.__E) {
      var realEm = Object.keys(have).filter(function (e) { return !have[e].dataset.fake; });
      var rd = realEm.length, rsum = 0, cnt = {};
      realEm.forEach(function (e) { cnt[e] = parseInt(have[e].dataset.base, 10) || 0; rsum += cnt[e]; });
      rsum = Math.max(rsum, 1);
      var mood = {}, ctx = m.ctx || {}, mt = 0, c;
      realEm.forEach(function (e) { mood[catOf(e)] = (mood[catOf(e)] || 0) + cnt[e] / rsum; });
      if (ctx.pray) mood.pray = (mood.pray || 0) + 0.4;
      if (ctx.humor || ctx.joy) mood.joy = (mood.joy || 0) + 0.4;
      for (c in mood) mt += mood[c];
      for (c in mood) mood[c] /= (mt || 1);
      var N = Math.max(rd, MIN_TYPES + Math.floor(R(seed, 3) * (MAX_TYPES - MIN_TYPES + 1)));
      var cand = okKeys.filter(function (e) { return !have[e] || have[e].dataset.fake; }).map(function (e) {
        var ce = catOf(e), aff = 0;
        for (var cc in mood) aff += mood[cc] * (cc === ce ? 1 : (AFF[cc + ce] != null ? AFF[cc + ce] : 0.15));
        return { emo: e, s: W[e] * (0.3 + 1.7 * aff) * (0.7 + 0.6 * R(seed, 60 + salt(e))) };
      }).sort(function (a, b) { return b.s - a.s; });
      var E = realEm.map(function (e) { return { emo: e, s: 0.25 + 1.5 * (cnt[e] / rsum) }; });
      cand.slice(0, Math.max(0, N - rd)).forEach(function (x) { E.push(x); });
      sec.__E = E;
    }
    var sum = 0;
    sec.__E.forEach(function (x) { sum += x.s; });
    var pick = sec.__E.filter(function (x) { return !(sec.__drop && sec.__drop[x.emo]); }).map(function (x) {
      return { emo: x.emo, t: Math.max(1, Math.round(total * x.s / sum)) };
    }).sort(function (a, b) { return b.t - a.t; });
    for (var j = 1; j < pick.length; j++) {
      if (pick[j].t >= pick[j - 1].t) pick[j].t = Math.max(1, pick[j - 1].t - 1 - Math.floor(R(seed, 70 + j) * 3));
    }

    pick.forEach(function (x) {
      var s = salt(x.emo), key = seed + '|' + x.emo;
      var delay = DELAY_MIN + Math.floor(R(seed, 10 + s) * (DELAY_JITTER + 1)) + Math.floor(R(seed, 20 + s) * 26);
      var want = Math.floor(x.t * frac(age, delay));
      var st = ST[key] || (ST[key] = { s: null, w: 0, n: 0, m: 0 });
      st.w = want; st.sec = sec;
      if (st.s === null || sec.__snap) st.s = Math.max(st.s || 0, want); // בטעינה / חזרה למסך: מציגים את המצב הנוכחי בלי אנימציה
      var el = have[x.emo];
      if (el && !el.dataset.fake) {
        st.m = 0;
        setEl(el, x.emo, (parseInt(el.dataset.base, 10) || 0) + st.s, key);
      } else {
        if (st.s < 1 || !tpl) { if (el) el.remove(); return; }
        if (!el) {
          el = tpl.cloneNode(true);
          el.dataset.fake = '1';
          el.style.cursor = 'pointer';
          el.querySelector('.emoji').textContent = x.emo;
          var add = null;
          Array.prototype.forEach.call(sec.children, function (ch) { if (!add && !ch.classList.contains('emoji-reaction')) add = ch; });
          if (add) sec.insertBefore(el, add); else sec.appendChild(el);
        }
        setEl(el, x.emo, st.s + (st.m || 0), key);
      }
    });
    sec.__snap = 0;

    var allEl = Array.prototype.slice.call(sec.querySelectorAll('.emoji-reaction'));
    if (allEl.length > MAX_TYPES) { // לא יותר מ-5 סוגים: מורידים את המדומים הקטנים ביותר
      var fk = allEl.filter(function (e) { return e.dataset.fake; }).sort(function (a, b) { return cn(a) - cn(b); });
      while (allEl.length > MAX_TYPES && fk.length) {
        var rm = fk.shift();
        (sec.__drop || (sec.__drop = {}))[rm.__emo] = 1;
        allEl.splice(allEl.indexOf(rm), 1);
        rm.remove();
      }
    }
    Array.prototype.forEach.call(sec.children, function (ch) {
      var o = ch.classList.contains('emoji-reaction') ? String(100000 - cn(ch)) : '999999';
      if (ch.style.order !== o) ch.style.order = o;
    });
  }

  function run() {
    if (!tpl) {
      var f = document.querySelector('.emoji-reaction');
      if (f) { tpl = f.cloneNode(true); delete tpl.dataset.base; delete tpl.dataset.shown; delete tpl.dataset.fake; }
    }
    var now = Date.now(), t0 = performance.now();
    if (now - lastSeen > 4000) {
      lastSeen = now;
      document.querySelectorAll('.emoji-reaction .emoji').forEach(function (e) { SEEN[e.textContent.trim()] = 1; });
    }
    var okKeys = Object.keys(W).filter(function (e) { return SEEN[e]; });
    if (okKeys.length < 3) okKeys = Object.keys(W);

    var secs = document.querySelectorAll('.emojis-section'), more = false;
    for (var i = 0; i < secs.length; i++) {
      var sec = secs[i];
      if (io && !sec.__io) { sec.__io = 1; io.observe(sec); }
      if (io && !sec.__vis) continue;                 // רק הודעות שנראות על המסך
      if (sec.__done && !sec.__dirty) continue;       // רק מה ששונה
      if (performance.now() - t0 > 12) { more = true; break; } // תקציב זמן: לא תוקעים את הדפדפן
      sec.__dirty = 0;
      processSection(sec, now, okKeys);
      sec.__done = 1;
    }
    if (more) schedule(40);
  }

  function fix(el) { // גולש הצביע: מוסיפים רק את התוספת הקיימת, מיד
    var c = el.querySelector('.count'); if (!c) return;
    var cur = parseInt(c.textContent, 10) || 0;
    if (el.dataset.shown === String(cur)) return;
    el.dataset.base = cur;
    var st = ST[el.__k];
    setEl(el, el.__emo, cur + (st ? st.s : 0), el.__k);
  }

  function kill() {
    dead = true;
    try { obs && obs.disconnect(); io && io.disconnect(); clearInterval(tick); clearInterval(minute); } catch (e) {}
  }
  function schedule(ms) { if (tmr || dead) return; tmr = setTimeout(function () { tmr = 0; safeRun(); }, ms || 150); }
  function safeRun() {
    if (dead) return;
    var t = performance.now();
    busy = true;
    try { run(); } catch (e) { if (++errs > 5) kill(); }
    busy = false;
    if (obs) obs.takeRecords(); // מתעלמים משינויים שהסקריפט עצמו עשה
    var dur = performance.now() - t;
    if (dur > 100) { if (++slow >= 4) kill(); } else slow = 0; // איטי שוב ושוב? מכבים את עצמנו
  }

  // מתעוררים רק כשיש שינוי רלוונטי: הודעה חדשה או הצבעה, ולא על כל שינוי באתר
  obs = new MutationObserver(function (recs) {
    if (busy || dead) return;
    if (recs.length > 400) { schedule(300); return; }
    var wake = false;
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i], t = r.target;
      if (t.nodeType === 3) t = t.parentElement;
      if (!t || !t.closest) continue;
      var sec = t.closest('.emojis-section');
      if (sec) {
        var el = t.closest('.emoji-reaction');
        if (el && el.__k && !el.dataset.fake) { busy = true; try { fix(el); } catch (e) {} busy = false; }
        sec.__dirty = 1; wake = true;
      } else if (r.addedNodes.length) {
        for (var j = 0; j < r.addedNodes.length; j++) {
          var n = r.addedNodes[j];
          if (n.nodeType === 1 && (n.matches('.emojis-section') || n.querySelector('.emojis-section'))) { wake = true; break; }
        }
      }
    }
    obs.takeRecords();
    if (wake) schedule(150);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  if (window.IntersectionObserver) {
    io = new IntersectionObserver(function (entries) {
      var any = false;
      entries.forEach(function (e) {
        var s = e.target;
        s.__vis = e.isIntersecting;
        if (e.isIntersecting) { if (s.__done) s.__snap = 1; s.__dirty = 1; any = true; }
      });
      if (any) schedule(100);
    }, { rootMargin: '600px 0px' });
  }

  // עלייה אחת בכל פעם, בזמנים אקראיים שונים לכל אימוג'י
  tick = setInterval(function () {
    var now = Date.now();
    for (var k in ST) {
      var st = ST[k];
      if (st.s < st.w) {
        var gap = st.w - st.s;
        if (!st.n) st.n = now + STEP_MIN + Math.random() * (STEP_MAX - STEP_MIN);
        else if (now >= st.n) {
          st.s++;
          if (st.sec) st.sec.__dirty = 1;
          st.n = gap > 15 ? now + 800 + Math.random() * 1200 : now + STEP_MIN + Math.random() * (STEP_MAX - STEP_MIN);
          schedule(60);
        }
      } else st.n = 0;
    }
  }, 1000);

  // פעם בדקה: מרעננים את ההודעות שעל המסך (צפיות וזמן משתנים)
  minute = setInterval(function () {
    document.querySelectorAll('.emojis-section').forEach(function (s) { if (s.__done) s.__dirty = 1; });
    schedule(100);
  }, 60000);

  // חזרה ללשונית אחרי זמן: משלימים בבת אחת (המשתמש לא ראה את המסך)
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    document.querySelectorAll('.emojis-section').forEach(function (s) { if (s.__done) { s.__snap = 1; s.__dirty = 1; } });
    schedule(50);
  });

  // לחיצה על אימוג'י שהוסיף הסקריפט: מצביעים באמת דרך הבורר של האתר, בלי שהבורר ייראה
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest && ev.target.closest('.emoji-reaction');
    if (!el || !el.dataset.fake) return;
    ev.preventDefault(); ev.stopPropagation();
    var sec = el.parentElement, emo = el.__emo, st = ST[el.__k], add = null;
    Array.prototype.forEach.call(sec.children, function (c) { if (!add && !c.classList.contains('emoji-reaction')) add = c; });
    if (st && !st.m) { st.m = 1; sec.__dirty = 1; schedule(30); }
    var hidden = [];
    var mo = new MutationObserver(function (recs) {
      recs.forEach(function (r) {
        Array.prototype.forEach.call(r.addedNodes, function (n) {
          if (n.nodeType !== 1 || sec.contains(n) || (n.classList && n.classList.contains('emoji-reaction'))) return;
          n.style.setProperty('visibility', 'hidden', 'important');
          hidden.push(n);
        });
      });
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    function finish() {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      setTimeout(function () { mo.disconnect(); hidden.forEach(function (n) { n.style.removeProperty('visibility'); }); }, 600);
    }
    function findIn(roots) {
      for (var r = 0; r < roots.length; r++) {
        var all = roots[r].querySelectorAll ? roots[r].querySelectorAll('*') : [];
        if (!all.length && roots[r].children && !roots[r].children.length && norm(roots[r].textContent) === norm(emo)) return roots[r];
        for (var i = 0; i < all.length; i++) {
          var n = all[i];
          if (!n.children.length && !n.closest('.emojis-section') && norm(n.textContent) === norm(emo)) return n;
        }
      }
      return null;
    }
    if (add) (add.querySelector('button,[role=button]') || add).click();
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var hit = findIn(hidden);
      if (!hit && tries > 4 && tries % 3 === 0) hit = findIn([document.body]); // חיפוש רחב רק לעיתים רחוקות
      if (hit) { clearInterval(iv); (hit.closest('button,[role=button],li') || hit).click(); finish(); }
      else if (tries > 12) { clearInterval(iv); finish(); }
    }, 80);
  }, true);

  document.addEventListener('DOMContentLoaded', function () { schedule(100); });
  setTimeout(function () { schedule(100); }, 600);
})();
