/* =========================================================================
   戎糖小记 · contact.js（联系我们 页面独有脚本）
   1) 二维码灯箱：点卡片上的「放大二维码」打开，支持 ESC / 点背景 / 关闭按钮，
      打开时把焦点移进去、关闭时还给原来那颗按钮。
   2) 留言墙：双模式存储——
      API_BASE 指向 Cloudflare Worker 时走云端（D1 数据库 suggrong-contact，
      所有人共享同一条墙）；Worker 连不上时自动退回 localStorage 本地模式，
      页面上的徽章会标明当前在哪一格。
   3) 建议箱：只写不读。提交进 D1 的 suggest 表，站长在 admin.html 查看 /
      标记 / 删除（那个页不进导航）。
   全站公共交互（导航 / 吸顶 / 进场 / 年份…）都在 js/app.js，这里不重复。
   ========================================================================= */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- 云端后端地址 ----
     站点和接口是同一个 Worker（www.sugrong.com 与 api.sugrong.com 背后同一份代码），
     所以线上优先打**同源** /api：同源没有跨域预检，也不受「代理只放行主域」「api 子域
     DNS 被污染」这类问题牵连。本地预览（127.0.0.1 / file://）没有同源接口，用 api.sugrong.com。
     任一地址网络层失败，timedFetch 会自动换另一个重试；两个都不通才退回本地模式。 */
  var API_HOST = 'https://api.sugrong.com';
  var SAME_SITE = /^https?:$/.test(location.protocol) && /(^|\.)sugrong\.com$/.test(location.hostname);
  var API_BASE = SAME_SITE ? '' : API_HOST;
  var API_ALT = SAME_SITE ? API_HOST : '';
  function isCloud() { return !!API_HOST; }

  /* ---- 留言墙「云端 / 本地」偏好：只影响留言墙，建议箱始终走云端 ---- */
  var MODE_KEY = 'rt_wall_mode';
  function readModePref() {
    try {
      return window.localStorage.getItem(MODE_KEY) === 'local' ? 'local' : 'cloud';
    } catch (e) { return 'cloud'; }
  }
  function saveModePref(mode) {
    try { window.localStorage.setItem(MODE_KEY, mode); } catch (e) {}
  }

  /* ---- 带超时的 fetch：慢网别把提交按钮挂死 ----
     ① 每次尝试新建 AbortController（复用被 abort 过的会直接抛错）；
     ② opts 浅拷贝，不改调用方对象；
     ③ 网络层失败（DNS / TLS / 被代理或插件拦掉）换另一个接口地址重试一次；
        超时（AbortError）不重试，免得一条留言等两遍。 */
  function timedFetch(url, opts, ms) {
    var alt = '';
    if (API_BASE && API_ALT && url.indexOf(API_BASE) === 0) alt = API_ALT + url.slice(API_BASE.length);
    else if (!API_BASE && API_ALT && url.charAt(0) === '/') alt = API_ALT + url;
    var urls = alt ? [url, alt] : [url];

    function attempt(i) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = window.setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 8000);
      var o = {}, k;
      if (opts) { for (k in opts) { o[k] = opts[k]; } }
      if (ctrl) o.signal = ctrl.signal;
      return fetch(urls[i], o).then(function (r) {
        window.clearTimeout(timer);
        return r;
      }, function (e) {
        window.clearTimeout(timer);
        if (i + 1 < urls.length && !(e && e.name === 'AbortError')) return attempt(i + 1);
        throw e;
      });
    }
    return attempt(0);
  }

  /* ---- 内容防护（留言 / 建议两个表单共用；截断按「字符」数，不切断 emoji 的代理对）---- */
  function sanitize(text) {
    return String(text == null ? '' : text)
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/[\u0000-\u001f]/g, '')
      .replace(/(.)\1{7,}/g, '$1$1$1')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function clip(text, max) {
    var chars = Array.from(text);
    return chars.length > max ? chars.slice(0, max).join('') : text;
  }

  /* ======================================================================
     一、二维码灯箱
     ====================================================================== */
  (function initLightbox() {
    var box = doc.getElementById('qrLightbox');
    if (!box) return;

    var img = doc.getElementById('qrLbImg');
    var title = doc.getElementById('qrLbTitle');
    var sub = doc.getElementById('qrLbSub');
    var desc = doc.getElementById('qrLbDesc');
    var closeBtn = box.querySelector('.qr-lightbox_close');
    var opener = null;
    var open = false;

    function show(trigger) {
      opener = trigger || null;
      box.removeAttribute('hidden');
      open = true;
      /* 焦点交给关闭按钮，键盘用户不会掉到背后的页面里 */
      if (closeBtn) closeBtn.focus();
    }

    function hide() {
      if (!open) return;
      open = false;
      box.setAttribute('hidden', '');
      if (opener && opener.isConnected) opener.focus();
      opener = null;
    }

    Array.prototype.forEach.call(doc.querySelectorAll('.qr-open'), function (btn) {
      btn.addEventListener('click', function () {
        var src = btn.getAttribute('data-src');
        if (!src) return;
        if (img) { img.setAttribute('src', src); img.setAttribute('alt', btn.getAttribute('data-alt') || '二维码'); }
        if (title) title.textContent = btn.getAttribute('data-title') || '';
        if (sub) sub.textContent = btn.getAttribute('data-sub') || '';
        if (desc) desc.textContent = btn.getAttribute('data-desc') || '';
        show(btn);
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-close]'), function (el) {
      el.addEventListener('click', hide);
    });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) hide();
    });

    /* 灯箱打开期间，背后的页面不要被 Tab 穿进去 */
    root.addEventListener('keydown', function (e) {
      if (!open || e.key !== 'Tab' || !closeBtn) return;
      e.preventDefault();
      closeBtn.focus();
    });
  })();

  /* ======================================================================
   二、留言墙
   ====================================================================== */
  (function initWall() {
    var wall = doc.getElementById('danmaku');
    var wallSec = doc.getElementById('wall');
    if (!wall) return;

    var stage = doc.getElementById('danmakuStage');
    var empty = doc.getElementById('danmakuEmpty');
    var form = doc.getElementById('danmakuForm');
    var input = doc.getElementById('danmakuText');
    var note = doc.getElementById('danmakuNote');
    var modeBadge = doc.getElementById('wallMode');
    var mineBox = doc.getElementById('wallMine');
    var mineList = doc.getElementById('wallMineList');
    var mineCount = doc.getElementById('wallMineCount');
    var mineClear = doc.getElementById('wallMineClear');
    /* 「云端 / 本地」切换器（radiogroup，和色板同一套键盘操作） */
    var switchBox = doc.getElementById('wallSwitch');
    var modeOpts = switchBox
      ? Array.prototype.slice.call(switchBox.querySelectorAll('.wall-switch_opt'))
      : [];
    /* 色板与颜文字在表单里，不在弹幕屏内：以整个 section 为范围找 */
    var swatches = Array.prototype.slice.call((wallSec || wall).querySelectorAll('.danmaku-swatch'));
    var picker = doc.getElementById('danmakuColor');
    var pickerBox = doc.getElementById('danmakuPicker');
    if (!stage) return;

    /* ---- 模式开关：用户可在页面上选「云端 / 本地」，选择记在本机 ---- ---- */
    var STORE_KEY = 'rt_danmaku_v1';
    var mode = readModePref();                       /* 'cloud' | 'local' */

    /* 真正的存储去向 = 后端在 + 用户选了云端；建议箱不看这个，只看 isCloud() */
    function useCloud() { return isCloud() && mode === 'cloud'; }
    var MAX_KEEP = 200;
    var MAX_AGE = 90 * 86400000;
    var SPEED = 0.16;              /* 像素/毫秒，约 160px/秒：1440 宽约 10 秒飘完一遍 */
    var MIN_DURATION = 8;          /* 秒：再短也让它慢慢飘完 */
    var COOLDOWN = 4000;
    /* 预设色：黑色打头并且是默认色，白底对比度均 ≥ 4.5:1；颜色盘可任选其他颜色 */
    var COLORS = ['#1f1f1f', '#d63f2e', '#c2185b', '#7b5cc4', '#238268', '#3a6ea5'];
    /* 老数据 / 旧缓存里是亮色或第一版的暗色：读出来时换成对应深色 */
    var COLOR_UPGRADE = {
      '#ff8f7a': '#d63f2e', '#ff9ec4': '#c2185b', '#c7aaff': '#7b5cc4',
      '#7fd8b0': '#238268', '#8fc3f5': '#3a6ea5',
      '#e84f3c': '#d63f2e', '#2f8f6f': '#238268'
    };

    /* ---- 可读性保护：颜色太浅（白底对比度 < 4.5:1）就整体压暗 ----
       和 Worker 侧用的是同一套算法，前端乐观上屏与后端入库结果一致，
       不会出现「刚发是浅黄、刷新变深黄」。 */
    var MAX_LUM = 0.1833;            /* 白底 4.5:1 对应的最大相对亮度 */
    function chan(v) { var x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
    function lum(r, g, b) { return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b); }
    function hex2rgb(h) {
      var m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
      if (!m) return null;
      var n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function rgb2hex(r, g, b) {
      return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }
    function deepen(h) {
      var c = hex2rgb(h);
      if (!c) return COLORS[0];
      var r0 = c[0], g0 = c[1], b0 = c[2];
      var r = r0, g = g0, b = b0, f = 1;
      /* 按比例压暗（保住色相，只降明度），最多压到 1/16 就停，死循环兜底 */
      while (lum(r, g, b) > MAX_LUM && f > 0.0625) {
        f *= 0.9;
        r = Math.round(r0 * f); g = Math.round(g0 * f); b = Math.round(b0 * f);
      }
      return rgb2hex(r, g, b);
    }

    var color = COLORS[0];
    var slots = [];                /* 近期弹幕的纵向占位，用来避免新弹幕叠在一起 */
    var mineIds = {};
    var lastSend = 0;
    var messages = [];             /* 当前已知的全部留言（云端拉回 / 本地读出的合并结果） */

    /* ---- 本地存储层（本地模式 + 云端模式的「我发的」标记都用它）---- */
    function loadLocal() {
      try {
        var raw = window.localStorage.getItem(STORE_KEY);
        if (!raw) return [];
        var list = JSON.parse(raw);
        if (!Array.isArray(list)) return [];
        var now = Date.now();
        return list.filter(function (m) {
          return m && m.text && (now - (m.at || 0)) < MAX_AGE;
        }).slice(-MAX_KEEP).map(function (m) {
          if (COLOR_UPGRADE[m.color]) m.color = COLOR_UPGRADE[m.color];
          return m;
        });
      } catch (e) { return []; }
    }
    function persist(list) {
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(-MAX_KEEP))); }
      catch (e) { /* 隐身模式 / 配额满：忽略，弹幕照样能上屏 */ }
    }
    function saveMine() {
      try { window.localStorage.setItem(STORE_KEY + '_mine', JSON.stringify(mineIds)); } catch (e) {}
    }
    try {
      var saved = JSON.parse(window.localStorage.getItem(STORE_KEY + '_mine') || '{}');
      if (saved && typeof saved === 'object') mineIds = saved;
    } catch (e) {}

    /* ---- 云端 ---- */
    function loadCloud() {
      return timedFetch(API_BASE + '/api/danmaku', null, 6000)
        .then(function (r) { return r.json(); })
        .then(function (o) {
          if (!o || !o.ok || !Array.isArray(o.items)) throw new Error('bad payload');
          return o.items.map(function (m) {
            if (COLOR_UPGRADE[m.color]) m.color = COLOR_UPGRADE[m.color];
            return m;
          });
        });
    }
    function sendCloud(text, c) {
      return timedFetch(API_BASE + '/api/danmaku', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, color: c })
      }, 10000).then(function (r) { return r.json(); });
    }

    /* ---- 静态只在「减少动效」时启用：窄窗口 / 手机也要飘，不然会堆成一块 ---- */
    function isStatic() { return reduceMotion; }

    /* 窄屏同屏放少一点，免得 4 条泳道挤成一团 */
    function isNarrow() { return !window.matchMedia('(min-width: 768px)').matches; }
    function spawnLimit() { return isNarrow() ? 4 : 6; }

    /* ---- 上屏：出场高度随机，不再固定几条轨道 ----
       记下近期每条弹幕的纵向位置，新弹幕随机试几次找一个不打架的高度；
       实在挤就挑间隔最大的那个（宁可略挨着，也不退回固定轨道）。 */
    function randomTop(el) {
      var h = stage.clientHeight || 240;
      var elH = el.offsetHeight || 40;
      var minY = 4;
      var maxY = Math.max(minY, h - elH - 4);
      var now = Date.now();

      /* 一条弹幕飘完一圈要 MIN_DURATION 起步，这期间它一直在屏上（还会循环回来），
         所以占位保留一整个飘行周期，否则新弹幕会撞上还没飘完的那条 */
      slots = slots.filter(function (s) { return now - s.at < MIN_DURATION * 1000; });

      var best = minY + Math.random() * (maxY - minY);
      var bestGap = -1;
      for (var t = 0; t < 12; t++) {
        var y = minY + Math.random() * (maxY - minY);
        var gap = 1e9;
        for (var i = 0; i < slots.length; i++) {
          var d = Math.abs((y + elH / 2) - (slots[i].y + slots[i].h / 2));
          if (d < gap) gap = d;
        }
        if (gap > elH + 6) { best = y; bestGap = gap; break; }   /* 够开就用它 */
        if (gap > bestGap) { bestGap = gap; best = y; }
      }
      slots.push({ y: best, h: elH, at: now });
      return Math.round(best);
    }

    /* 出场点也随机：在右边缘外面再随机多留 0~18% 屏宽，出来的时机就不齐了 */
    function randomStart(el) {
      var extra = Math.random() * 18;
      el.style.left = (100 + extra) + '%';
    }

    /* 飘动距离与时长写进 CSS 变量，动画本体交给浏览器合成线程 */
    function measure(el) {
      var stageW = stage.clientWidth || 600;
      var w = el.offsetWidth || 120;
      /* left 可能是 100%~118%，飘出去的距离要跟着算 */
      var leftPct = parseFloat(el.style.left) || 100;
      var travel = -(stageW * leftPct / 100 + w + 20);
      var seconds = Math.max(MIN_DURATION, Math.abs(travel) / SPEED / 1000);
      el.style.setProperty('--dm-travel', travel + 'px');
      el.style.setProperty('--dm-dur', seconds.toFixed(2) + 's');
    }
    function relayoutAll() {
      if (isStatic()) return;
      Array.prototype.forEach.call(stage.children, function (el) {
        if (el.classList.contains('danmaku-item')) measure(el);
      });
    }

    function timeLabel(at) {
      var d = new Date(at);
      var p = function (n) { return n < 10 ? '0' + n : String(n); };
      return p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function spawn(msg, opts) {
      opts = opts || {};
      var el = doc.createElement('span');
      el.className = 'danmaku-item' + (opts.isNew ? ' is-new' : '');
      el.style.setProperty('--c', msg.color || COLORS[0]);
      if (msg.id) el.setAttribute('data-id', msg.id);
      el.style.setProperty('--dm-delay', (opts.delay || 0) + 's');

      var text = doc.createElement('span');
      text.className = 'dm-text';
      text.textContent = msg.text;
      el.appendChild(text);

      var isMine = !!mineIds[msg.id];
      if (msg.at) {
        var time = doc.createElement('span');
        time.className = 'dm-time';
        time.textContent = timeLabel(msg.at);
        el.appendChild(time);
      }
      if (isMine) {
        var del = doc.createElement('button');
        del.type = 'button';
        del.className = 'dm-del';
        del.setAttribute('aria-hidden', 'true');   /* 真正的管理入口在「我发的」里 */
        del.setAttribute('tabindex', '-1');
        del.textContent = '×';
        el.appendChild(del);
        el.classList.add('is-mine');
      }

      stage.appendChild(el);
      if (!isStatic()) {
        randomStart(el);                          /* 先定出场点，measure 要用它算距离 */
        el.style.top = randomTop(el) + 'px';
        measure(el);
      }
      /* 上屏的高亮圈放完就摘掉 is-new：它是 animation 简写，一直挂着会持续
         重置 animation-play-state，导致这条永远暂停不了 */
      if (opts.isNew) {
        window.setTimeout(function () { el.classList.remove('is-new'); }, 700);
      }
      return el;
    }

    function dropById(id) {
      var el = stage.querySelector('.danmaku-item[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    function updateEmpty() {
      if (!empty) return;
      empty.hidden = !!stage.querySelector('.danmaku-item');
    }

    /* ---- 空屏欢迎语：本地模式专属，云端空墙就空着等第一条 ---- */
    function seedWelcome() {
      var greetings = [
        /* 跳过 COLORS[0]（黑色）：欢迎语还是彩色更热闹，黑色留给正经留言 */
        { text: '欢迎来到戎糖小记 ✨', color: COLORS[1] },
        { text: '写一句想说的话吧 (｡･ω･｡)', color: COLORS[2] },
        { text: '这里可以随便说点什么～', color: COLORS[4] },
        { text: '很开心你来了 (*´▽`*)', color: COLORS[5] }
      ];
      var g = greetings[Math.floor(Math.random() * greetings.length)];
      var msg = { id: 'seed' + Date.now(), text: g.text, color: g.color, at: Date.now() };
      /* 只入列，不上屏：调用方 hydrate() 会统一 spawn，否则会出现两条一模一样的欢迎语 */
      messages.push(msg);
      persist(messages);
    }

    /* ---- 「我发的」列表 ---- */
    function renderMine() {
      if (!mineBox || !mineList) return;
      var mine = messages.filter(function (m) { return mineIds[m.id]; });
      if (mineCount) mineCount.textContent = String(mine.length);
      mineList.innerHTML = '';
      mine.forEach(function (m) {
        var li = doc.createElement('li');

        var span = doc.createElement('span');
        span.className = 'wmi-text';
        span.textContent = m.text;
        li.appendChild(span);

        var time = doc.createElement('span');
        time.className = 'wmi-time';
        time.textContent = timeLabel(m.at);
        li.appendChild(time);

        var del = doc.createElement('button');
        del.type = 'button';
        del.className = 'wmi-del';
        del.setAttribute('aria-label', '从我的列表移除：' + m.text);
        del.textContent = '×';
        del.addEventListener('click', function () { removeMine(m.id); });
        li.appendChild(del);

        mineList.appendChild(li);
      });
      mineBox.hidden = mine.length === 0;
    }

    /* 从「我发的」里移除：本地模式连数据一起删，云端模式只收起（公开留言删不掉） */
    function removeMine(id) {
      delete mineIds[id];
      saveMine();
      if (useCloud()) {
        dropById(id);
        renderMine();
        updateEmpty();
        if (note) {
          note.className = 'wall-note';
          note.textContent = '已从你的列表收起；留言是公开的，需要撤下请联系站长';
          window.setTimeout(function () { if (note.textContent.indexOf('公开') === 0) note.textContent = ''; }, 4000);
        }
        return;
      }
      messages = messages.filter(function (m) { return m.id !== id; });
      persist(messages);
      dropById(id);
      renderMine();
      updateEmpty();
    }

    if (mineClear) {
      mineClear.addEventListener('click', function () {
        if (useCloud()) return;   /* 云端模式这个按钮是隐藏的，双保险 */
        var mineMsgs = messages.filter(function (m) { return mineIds[m.id]; });
        var keep = messages.filter(function (m) { return !mineIds[m.id]; });
        Object.keys(mineIds).forEach(function (id) { delete mineIds[id]; });
        saveMine();
        messages = keep;
        persist(keep);
        Array.prototype.forEach.call(
          stage.querySelectorAll('.danmaku-item'),
          function (el) { el.parentNode.removeChild(el); }
        );
        renderMine();
        updateEmpty();
        if (note) {
          note.className = 'wall-note';
          note.textContent = mineMsgs.length
            ? '已经清空你发过的 ' + mineMsgs.length + ' 条'
            : '还没有发过留言';
          window.setTimeout(function () { note.textContent = ''; }, 2600);
        }
      });
    }

    /* ---- 初始化 / 换模式后重灌：先拉该模式的留言，再依次放出 ---- */
    function hydrate() {
      if (modeBadge) {
        modeBadge.textContent = useCloud()
          ? '云端模式 · 留言公开，所有人都能看到'
          : '本地模式 · 留言只存在这台设备上';
        modeBadge.classList.toggle('is-local', !useCloud());
      }
      if (mineClear) mineClear.hidden = useCloud();

      if (useCloud()) {
        loadCloud().then(function (items) {
          messages = items;
          items.slice(-spawnLimit()).forEach(function (m, i) {
            spawn({ id: m.id, text: m.text, color: m.color, at: m.at },
                  { delay: i * 1.1 + Math.random() * 0.8 });
          });
          updateEmpty();
          renderMine();
        }).catch(function () {
          /* Worker 连不上：退回本机数据，徽章说明清楚，但保留用户的选择 */
          if (modeBadge) {
            modeBadge.textContent = '云端没连上，先显示这台设备上的留言';
            modeBadge.classList.add('is-local');
          }
          if (mineClear) mineClear.hidden = false;
          messages = loadLocal();
          persist(messages);
          if (!messages.length) seedWelcome();
          messages.slice(-spawnLimit()).forEach(function (m, i) {
            spawn({ id: m.id, text: m.text, color: m.color, at: m.at },
                  { delay: i * 1.1 + Math.random() * 0.8 });
          });
          updateEmpty();
          renderMine();
        });
        return;
      }

      messages = loadLocal();
      persist(messages);
      if (!messages.length) seedWelcome();
      if (messages.length) {
        messages.slice(-spawnLimit()).forEach(function (m, i) {
          spawn({ id: m.id, text: m.text, color: m.color, at: m.at },
                { delay: i * 1.1 + Math.random() * 0.8 });
        });
      }
      updateEmpty();
      renderMine();
    }
    hydrate();

    /* ---- 窗口变了重新算飘动距离（--dm-travel 是一次性写死的）---- */
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(relayoutAll, 200);
    }, { passive: true });

    /* ---- 发送 ---- */
    if (form && input) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var text = clip(sanitize(input.value), 40);
        var now = Date.now();

        if (!text) {
          input.setAttribute('aria-invalid', 'true');
          if (note) { note.className = 'wall-note is-error'; note.textContent = '写点什么再发吧～'; }
          input.focus();
          return;
        }
        if (now - lastSend < COOLDOWN) {
          if (note) {
            note.className = 'wall-note is-error';
            note.textContent = '慢一点，' + Math.ceil((COOLDOWN - (now - lastSend)) / 1000) + ' 秒后再发一条';
          }
          return;
        }

        lastSend = now;
        input.removeAttribute('aria-invalid');
        input.value = '';

        var msg = { id: 'tmp' + now.toString(36) + Math.floor(Math.random() * 1296).toString(36), text: text, color: color, at: now };
        mineIds[msg.id] = 1;
        saveMine();

        /* 本地模式先入列再渲染，不然「我发的」这一屏是空的（得刷新才出现） */
        if (!useCloud()) {
          messages.push(msg);
          persist(messages);
        }

        /* 先上屏，网络慢也不憋着发言的人 */
        spawn(msg, { isNew: true });
        updateEmpty();
        renderMine();
        if (note) { note.className = 'wall-note'; note.textContent = '已飘上去啦 ✨'; }
        input.focus();

        if (!useCloud()) return;

        /* 云端：等服务端确认，拿到正式 id 后换掉临时 id */
        sendCloud(text, msg.color).then(function (o) {
          if (o && o.ok && o.id) {
            mineIds[o.id] = 1;
            delete mineIds[msg.id];
            saveMine();
            var el = stage.querySelector('.danmaku-item[data-id="' + msg.id + '"]');
            if (el) el.setAttribute('data-id', o.id);
            messages.push({ id: o.id, text: text, color: msg.color, at: now });
            renderMine();
          } else {
            throw new Error(o && o.error || 'rejected');
          }
        }).catch(function () {
          /* 服务端没接住：这条转本地保存，刷新还在 */
          messages.push(msg);
          persist(messages);
          if (note) {
            note.className = 'wall-note is-error';
            note.textContent = '网络不稳，这条先存在本地，别人看不到';
          }
        });
      });

      input.addEventListener('input', function () {
        if (input.getAttribute('aria-invalid') === 'true') {
          input.removeAttribute('aria-invalid');
          if (note) note.textContent = '';
        }
      });
    }

    /* ---- 弹幕里那颗 ×（鼠标顺手用）---- */
    stage.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.dm-del') : null;
      if (!btn) return;
      var item = btn.closest('.danmaku-item');
      var id = item && item.getAttribute('data-id');
      if (id) removeMine(id);
      else if (item && item.parentNode) item.parentNode.removeChild(item);
      updateEmpty();
    });

    /* ---- 颜色：预设色（radiogroup，左右方向键可切）+ 颜色盘任选色 ----
       color 里存的一定是 deepen() 之后的值，保证白底看得清。 */
    function applyColor(next, focusIdx) {
      /* 非法色 / 极端浅色都在这里收敛 */
      color = deepen(next);
      var hit = -1;
      swatches.forEach(function (o, i) {
        var on = o.getAttribute('data-color') === color;
        if (on) hit = i;
        o.setAttribute('aria-checked', on ? 'true' : 'false');
        o.setAttribute('tabindex', on ? '0' : '-1');
      });
      /* 用的是自定义色：没有一个预设色亮起，就把第一颗留在 tab 位上 */
      if (hit < 0 && swatches[0]) swatches[0].setAttribute('tabindex', '0');
      /* 取色器显示用户选的原色（不回写加深值，免得拖动时颜色乱跳） */
      if (picker && picker.value !== next && hex2rgb(next)) picker.value = next;
      if (pickerBox) pickerBox.classList.toggle('is-active', hit < 0);
      if (focusIdx != null && swatches[focusIdx]) swatches[focusIdx].focus();
    }
    swatches.forEach(function (sw, i) {
      sw.addEventListener('click', function () {
        applyColor(sw.getAttribute('data-color') || COLORS[0], null);
      });
      sw.addEventListener('keydown', function (e) {
        var step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
                 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        var next = (i + step + swatches.length) % swatches.length;
        applyColor(swatches[next].getAttribute('data-color') || COLORS[0], next);
      });
    });
    /* 颜色盘：input 事件在拖动取色器时实时更新，用的是原生系统取色器 */
    if (picker) {
      picker.addEventListener('input', function () { applyColor(picker.value, null); });
      picker.addEventListener('change', function () { applyColor(picker.value, null); });
    }
    applyColor(COLORS[0], null);

    /* ---- 「云端 / 本地」切换：清屏 → 按新模式重新灌 ---- */
    function paintMode() {
      modeOpts.forEach(function (b, i) {
        var on = b.getAttribute('data-mode') === mode;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.setAttribute('tabindex', on ? '0' : '-1');
      });
    }
    function clearStage() {
      while (stage.firstChild) stage.removeChild(stage.firstChild);
    }
    function switchTo(next) {
      if (next === mode) return;
      mode = next;
      saveModePref(mode);
      paintMode();
      clearStage();
      messages = [];
      hydrate();
      if (note) {
        note.className = 'wall-note';
        note.textContent = mode === 'cloud'
          ? '已切到云端，留言公开可见 ✨'
          : '已切到本地，留言只存在这台设备 💾';
        window.setTimeout(function () {
          if (note.textContent.indexOf('已切到') === 0) note.textContent = '';
        }, 3200);
      }
    }
    modeOpts.forEach(function (b, i) {
      b.addEventListener('click', function () { switchTo(b.getAttribute('data-mode')); });
      b.addEventListener('keydown', function (e) {
        var step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
                 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        var next = (i + step + modeOpts.length) % modeOpts.length;
        var target = modeOpts[next];
        if (target) { switchTo(target.getAttribute('data-mode')); target.focus(); }
      });
    });
    /* 没配后端时整个切换器没有意义，藏起来，只留状态说明 */
    if (switchBox && !isCloud()) switchBox.hidden = true;
    paintMode();

  })();

  /* ======================================================================
   三、建议箱（原「关于这个小站」信息卡的位置）
   访客只写不读；读和管理在 admin.html（不进导航的站长页）。
   ====================================================================== */
  (function initSuggest() {
    var form = doc.getElementById('suggestForm');
    if (!form) return;

    var text = doc.getElementById('suggestText');
    var contact = doc.getElementById('suggestContact');
    var count = doc.getElementById('suggestCount');
    var note = doc.getElementById('suggestNote');
    var btn = form.querySelector('.suggest-form_send');

    var MAX_TEXT = 300;
    var MAX_CONTACT = 60;

    function refreshCount() {
      if (count) count.textContent = Array.from(text.value).length + ' / ' + MAX_TEXT;
    }
    text.addEventListener('input', function () {
      refreshCount();
      if (note && note.textContent) note.textContent = '';
    });
    refreshCount();

    function say(msg, isError) {
      if (!note) return;
      note.className = 'suggest-form_note' + (isError ? ' is-error' : '');
      note.textContent = msg;
    }

    if (form && text) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = clip(sanitize(text.value), MAX_TEXT);
        if (!body) { say('写点什么再提交吧～', true); text.focus(); return; }

        /* 联系方式不剥链接（可能是个人主页），只去控制字符 */
        var contactText = clip(
          String(contact.value).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim(),
          MAX_CONTACT
        );

        if (!isCloud()) { say('建议箱还没接上，稍后再试', true); return; }

        btn.disabled = true;
        say('提交中…');

        timedFetch(API_BASE + '/api/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: body, contact: contactText })
        }, 10000).then(function (r) {
          return r.json();
        }).then(function (o) {
          if (o && o.ok) {
            say('收到啦，谢谢你 ✨ 只有站长能看到');
            text.value = '';
            if (contact) contact.value = '';
            refreshCount();
          } else {
            say((o && o.error) || '没提交成功，稍后再试', true);
          }
        }).catch(function () {
          say('网络不稳，没提交成功，稍后再试', true);
        }).then(function () {
          btn.disabled = false;
        });
      });
    }
  })();
})();
