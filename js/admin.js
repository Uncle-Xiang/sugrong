/* =========================================================================
   戎糖小记 · admin.js（站长时间 页面独有脚本，不进导航）
   两个独立界面：密码门 / 仪表盘，用 .is-on 整屏切换（登录后密码门整体下屏）。
   1) 密码门：ADMIN_TOKEN 只存 sessionStorage，关页面就忘；
   2) 登录后并行拉「建议 + 留言」两份数据，页签切换纯本地渲染；
   3) 建议：筛选 / 标记已处理 / 删除；留言：删除。
   所有请求都带 x-danmaku-admin 头，Worker 侧校验，401 一律踢回密码门。
   ========================================================================= */
(function () {
  'use strict';

  var doc = document;

  /* ---- 接口地址：同源优先，失败自动回落 ----
     站点和接口是同一个 Worker（www.sugrong.com 与 api.sugrong.com 背后是同一份代码），
     所以线上优先打**同源** /api：同源没有跨域预检，也不受「代理只放行主域」「api 子域
     DNS 被污染」这类问题的牵连。本地预览（127.0.0.1 / file://）没有同源接口，
     直接用 api.sugrong.com。两个地址任一网络层失败，timedFetch 会自动换另一个重试。 */
  var API_HOST = 'https://api.sugrong.com';
  var SAME_SITE = /^https?:$/.test(location.protocol) && /(^|\.)sugrong\.com$/.test(location.hostname);
  var API_BASE = SAME_SITE ? '' : API_HOST;      /* '' = 同源，拼出来就是 /api/xxx */
  var API_ALT = SAME_SITE ? API_HOST : '';
  var TOKEN_KEY = 'rt_admin_token';
  var token = '';

  /* ---- 元素 ---- */
  var gateScreen = doc.getElementById('gateScreen');
  var boardScreen = doc.getElementById('boardScreen');
  var gateForm = doc.getElementById('gateForm');
  var gateInput = doc.getElementById('gateToken');
  var gateBtn = gateForm ? gateForm.querySelector('.gate-card_btn') : null;
  var gateNote = doc.getElementById('gateNote');
  var gateDiagBox = doc.getElementById('gateDiagBox');
  var gateDiagOut = doc.getElementById('gateDiagOut');
  var gateDiagCopy = doc.getElementById('gateDiagCopy');
  var logoutBtn = doc.getElementById('logoutBtn');

  var tabSuggest = doc.getElementById('tabSuggest');
  var tabDanmaku = doc.getElementById('tabDanmaku');
  var tabWorks = doc.getElementById('tabWorks');
  var panelSuggest = doc.getElementById('panelSuggest');
  var panelDanmaku = doc.getElementById('panelDanmaku');
  var panelWorks = doc.getElementById('panelWorks');
  var suggestCountEl = doc.getElementById('suggestCount');
  var danmakuCountEl = doc.getElementById('danmakuCount');
  var worksCountEl = doc.getElementById('worksCount');

  var filtersBox = panelSuggest ? panelSuggest.querySelector('.board-filters') : null;
  var suggestState = doc.getElementById('suggestState');
  var suggestList = doc.getElementById('suggestList');
  var danmakuState = doc.getElementById('danmakuState');
  var danmakuList = doc.getElementById('danmakuList');

  /* 作品集 */
  var worksState = doc.getElementById('worksState');
  var worksList = doc.getElementById('worksList');
  var worksForm = doc.getElementById('worksForm');
  var worksFormTitle = doc.getElementById('worksFormTitle');
  var worksFormNote = doc.getElementById('worksFormNote');
  var worksSave = doc.getElementById('worksSave');
  var worksCancel = doc.getElementById('worksCancel');
  var wf = {
    title: doc.getElementById('wfTitle'),
    kicker: doc.getElementById('wfKicker'),
    summary: doc.getElementById('wfSummary'),
    cover: doc.getElementById('wfCover'),
    link: doc.getElementById('wfLink'),
    type: doc.getElementById('wfType'),
    date: doc.getElementById('wfDate'),
    linkText: doc.getElementById('wfLinkText'),
    status: doc.getElementById('wfStatus'),
    sort: doc.getElementById('wfSort'),
    featured: doc.getElementById('wfFeatured'),
    recent: doc.getElementById('wfRecent')
  };

  /* 封面上传（R2）：拖拽区 / 文件选择 / 缩略图 / 提示语 */
  var coverDrop = doc.getElementById('coverDrop');
  var coverFile = doc.getElementById('coverFile');
  var coverThumb = doc.getElementById('coverThumb');
  var coverNote = doc.getElementById('coverNote');
  var coverName = doc.getElementById('coverName');
  var coverSend = doc.getElementById('coverSend');
  var coverSendText = doc.getElementById('coverSendText');
  var coverBusy = false;
  var coverPick = null;          /* 已选但还没上传的文件 */
  var COVER_HINT = 'jpg / png / webp / gif / avif，单张 ≤ 8 MB。选好后可以改文件名，再点右边的「上传」';

  /* ---- 数据缓存（登录后拉一次，页签/筛选都从这里渲染） ---- */
  var cache = { suggest: [], danmaku: [], works: [] };
  var filter = 'all';                 /* all | todo | done */
  var editingId = '';                 /* 正在编辑的作品 id，空串 = 新增模式 */

  /* ---------- 小工具 ---------- */
  function showScreen(which) {
    var gate = which === 'gate';
    gateScreen.classList.toggle('is-on', gate);
    boardScreen.classList.toggle('is-on', !gate);
  }

  /* 带超时的 fetch。
     ① 每次尝试都新建 AbortController（一个 controller 只能 abort 一次，复用会直接报错）；
     ② opts 做浅拷贝，不污染调用方传进来的对象；
     ③ 网络层失败（DNS / TLS / 被代理或插件拦掉 → TypeError）时换另一个接口地址再试一次；
        超时（AbortError）不重试，省得一次登录卡两遍。 */
  function timedFetch(url, opts, ms) {
    var alt = '';
    if (API_BASE && API_ALT && url.indexOf(API_BASE) === 0) alt = API_ALT + url.slice(API_BASE.length);
    else if (!API_BASE && API_ALT && url.charAt(0) === '/') alt = API_ALT + url;
    var urls = alt ? [url, alt] : [url];

    function attempt(i) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = window.setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 12000);
      var o = {}, k;
      if (opts) { for (k in opts) { o[k] = opts[k]; } }
      o.headers = {};
      if (opts && opts.headers) { for (k in opts.headers) { o.headers[k] = opts.headers[k]; } }
      o.headers['x-danmaku-admin'] = token;
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

  function api(url, opts) {
    return timedFetch(API_BASE + url, opts).then(function (r) {
      if (r.status === 401) {
        kickOut('密码失效了，重新进一下吧');
        var e401 = new Error('unauthorized');
        e401.code = 401;              /* 密码问题，和「网络连不上」区分开 */
        throw e401;
      }
      if (!r.ok) {
        /* 200/401 以外的状态（400 校验失败、413 太大、415 格式、503 没绑定…）
           单独报出来，别混进密码不对里。顺便把服务端那句人话 error 带上 */
        var eHttp = new Error('http ' + r.status);
        eHttp.code = r.status;
        return r.json().then(function (o) {
          if (o && o.error) eHttp.detail = o.error;
          throw eHttp;
        }, function () { throw eHttp; });
      }
      return r.json();
    });
  }

  function baseLabel() { return API_BASE || location.origin; }

  /* 把一次失败翻译成人话：到底该改密码，还是该查网络 */
  function reasonOf(err) {
    if (!err) return '出错了，再试一次';
    if (err.code === 401) return '密码不对，再试一次';
    if (err.code === 'bad') return '服务器返回的数据不对，刷新页面再试一次';
    if (err.name === 'AbortError') return '请求超时了：' + baseLabel() + ' 一直没响应';
    if (typeof err.code === 'number') return '服务器返回了 ' + err.code + '，稍后再试';
    return '连不上 ' + baseLabel() + '，正在自查原因…';
  }

  /* 网络层失败（不是 401、不是 200 却 ok:false）才值得跑自检 */
  function isNetErr(err) {
    if (!err) return true;
    if (typeof err.code === 'number' || err.code === 'bad') return false;
    return true;
  }

  /* ---------- 网络自检 ----------
     分别探三个点：本站同源 / api 子域 / 一个公共对照点（www.cloudflare.com）。
     三者成败一对照，就能分清是「整台设备出不去」「代理只放行了主域」还是「偶发失败」。
     探的是 Cloudflare 的 /cdn-cgi/trace：它由边缘直接返回 200，不经过 Worker 逻辑，
     拿来判断「能不能连上这个域名」最干净（返回 401 之类也说明连上了，但这里要 200 才算）。 */
  function probe(url) {
    var t0 = Date.now();
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = window.setTimeout(function () { if (ctrl) ctrl.abort(); }, 4000);
    var o = { cache: 'no-store' };
    if (ctrl) o.signal = ctrl.signal;
    return fetch(url, o).then(function (r) {
      window.clearTimeout(timer);
      return { url: url, ok: true, status: r.status, ms: Date.now() - t0 };
    }, function (e) {
      window.clearTimeout(timer);
      return { url: url, ok: false, err: (e && e.name) || 'Error', msg: (e && e.message) || '', ms: Date.now() - t0 };
    });
  }

  function diagnose() {
    var selfUrl = /^https?:$/.test(location.protocol) ? location.origin + '/cdn-cgi/trace' : '';
    var d = { at: new Date().toLocaleString('zh-CN'), href: location.href, online: navigator.onLine !== false };
    var steps = [];
    if (selfUrl) steps.push(['self', selfUrl]);
    steps.push(['api', API_HOST + '/cdn-cgi/trace']);
    steps.push(['ctrl', 'https://www.cloudflare.com/cdn-cgi/trace']);
    return steps.reduce(function (p, s) {
      return p.then(function () { return probe(s[1]); }).then(function (r) { d[s[0]] = r; });
    }, Promise.resolve()).then(function () { return d; });
  }

  /* trace 拿到 200 才算这条域名真的通 */
  function reachable(p) { return !!(p && p.ok && p.status === 200); }

  function verdict(d) {
    if (!d.online) return '这台设备现在没联网（navigator.onLine = false），先把 Wi-Fi / 流量打开';
    var self = reachable(d.self), api = reachable(d.api), ctrl = reachable(d.ctrl);
    if (api) return '接口其实是通的（HTTP ' + d.api.status + '，' + d.api.ms + 'ms），刚才多半是一次偶发失败，再试一次就好';
    if (!SAME_SITE) {
      /* 本地预览：没有同源接口可对照，只能判断「外网通不通」 */
      return ctrl
        ? '外网是通的，但连不上 ' + API_HOST + '：DNS 或代理拦了这个子域，也可能是本地网络到 Cloudflare 不稳'
        : '这台设备整条外网都不通：检查代理开关、VPN、安全软件的联网防护';
    }
    if (self && !api) return '主站能通、api.sugrong.com 不通：多半是 DNS 或代理只放行了主域，把 api 子域加进直连规则';
    if (!self && !api && ctrl) return '能上外网，但 sugrong.com 整个不通：代理 / VPN 的分流规则拦了它，或本机 DNS 被污染';
    if (!self && !api && !ctrl) return '这台设备整条外网都不通：检查代理开关、VPN、安全软件的联网防护';
    return '没探出明确原因，把下面这段复制给开发者看';
  }

  function sayDiag(d) {
    if (!gateDiagOut) return;
    var lines = ['时间 ' + d.at, '页面 ' + d.href, '在线 ' + (d.online ? '是' : '否')];
    ['self', 'api', 'ctrl'].forEach(function (k) {
      var p = d[k];
      if (!p) return;
      var tail = p.ok ? ('HTTP ' + p.status) : (p.err + ' ' + p.msg).slice(0, 110);
      lines.push((reachable(p) ? '✔ ' : '✘ ') + p.url + '  →  ' + tail + '  [' + p.ms + 'ms]');
    });
    gateDiagOut.textContent = lines.join('\n');
    if (gateDiagBox) gateDiagBox.hidden = false;
  }

  function kickOut(msg) {
    try { window.sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    token = '';
    showScreen('gate');
    if (gateInput) gateInput.value = '';
    if (gateNote) {
      gateNote.className = 'gate-card_note' + (msg ? ' is-error' : '');
      gateNote.textContent = msg || '';
    }
  }

  function sayGate(msg, isError) {
    if (!gateNote) return;
    gateNote.className = 'gate-card_note' + (isError ? ' is-error' : '');
    gateNote.textContent = msg;
  }
  function saySuggest(msg, isError) {
    if (!suggestState) return;
    suggestState.className = 'board-state' + (isError ? ' is-error' : '');
    suggestState.textContent = msg;
  }
  function sayDanmaku(msg, isError) {
    if (!danmakuState) return;
    danmakuState.className = 'board-state' + (isError ? ' is-error' : '');
    danmakuState.textContent = msg;
  }
  function sayWorks(msg, isError) {
    if (!worksState) return;
    worksState.className = 'board-state' + (isError ? ' is-error' : '');
    worksState.textContent = msg;
  }
  function sayWorksNote(msg, isError) {
    if (!worksFormNote) return;
    worksFormNote.className = 'board-state' + (isError ? ' is-error' : '');
    worksFormNote.textContent = msg;
  }

  function timeLabel(at) {
    var d = new Date(at);
    var p = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------- 密码门 ---------- */
  function enter(t) {
    token = t;
    return api('/api/suggest').then(function (o) {
      if (!o || !o.ok) {
        /* 200 却返回 ok:false：既不是密码问题也不是断网，单独报 */
        var eBad = new Error('bad');
        eBad.code = 'bad';
        throw eBad;
      }
      try { window.sessionStorage.setItem(TOKEN_KEY, t); } catch (e) {}
      showScreen('board');
      loadAll();
      return true;
    });
  }

  if (gateForm && gateInput) {
    gateForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var t = gateInput.value.trim();
      if (!t) { sayGate('先把密码填上', true); gateInput.focus(); return; }
      gateBtn.disabled = true;
      sayGate('验证中…');
      enter(t).then(function () {
        sayGate('');
        if (gateDiagBox) gateDiagBox.hidden = true;
      }).catch(function (err) {
        sayGate(reasonOf(err), true);
        if (!isNetErr(err)) return;
        /* 网络层失败：跑一遍自检，把「连不上」换成能看懂的结论 + 可复制的明细 */
        return diagnose().then(function (d) {
          sayGate(verdict(d), true);
          sayDiag(d);
        });
      }).then(function () {
        gateBtn.disabled = false;
      });
    });
  }

  /* 自检明细一键复制：站长发群/发人看比自己描述快得多 */
  if (gateDiagCopy && gateDiagOut) {
    gateDiagCopy.addEventListener('click', function () {
      var text = gateDiagOut.textContent || '';
      var reset = function (label) {
        gateDiagCopy.textContent = label;
        window.setTimeout(function () { gateDiagCopy.textContent = '复制诊断'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { reset('已复制'); }, function () { reset('复制失败'); });
      } else {
        var r = doc.createRange();
        r.selectNodeContents(gateDiagOut);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        reset('按 Ctrl+C 复制');
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () { kickOut(''); });
  }

  /* ---------- 数据：三份一起拉 ---------- */
  function loadAll() {
    saySuggest('加载中…');
    sayDanmaku('加载中…');
    sayWorks('加载中…');
    return Promise.all([
      api('/api/suggest').catch(function (e) {
        if (e && e.message === 'unauthorized') throw e;
        saySuggest('建议加载失败，稍后重试', true);
        return { ok: true, items: [] };
      }),
      api('/api/danmaku').catch(function (e) {
        if (e && e.message === 'unauthorized') throw e;
        sayDanmaku('留言加载失败，稍后重试', true);
        return { ok: true, items: [] };
      }),
      /* 带令牌读，隐藏（off）的作品也会回来，方便后台留档再翻出来 */
      api('/api/works').catch(function (e) {
        if (e && e.message === 'unauthorized') throw e;
        sayWorks('作品加载失败，稍后重试', true);
        return { ok: true, items: [] };
      })
    ]).then(function (rs) {
      cache.suggest = (rs[0] && rs[0].items) || [];
      cache.danmaku = (rs[1] && rs[1].items) || [];
      cache.works = (rs[2] && rs[2].items) || [];
      renderSuggest();
      renderDanmaku();
      renderWorks();
    }).catch(function () { /* 401 已踢回密码门 */ });
  }

  /* ---------- 页签 ---------- */
  var TABS = [
    { key: 'suggest', tab: tabSuggest, panel: panelSuggest },
    { key: 'danmaku', tab: tabDanmaku, panel: panelDanmaku },
    { key: 'works', tab: tabWorks, panel: panelWorks }
  ];
  function switchTab(which) {
    TABS.forEach(function (t) {
      if (!t.tab || !t.panel) return;
      var on = t.key === which;
      t.tab.classList.toggle('is-on', on);
      t.tab.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tab.tabIndex = on ? 0 : -1;
      t.panel.classList.toggle('is-on', on);
    });
  }
  TABS.forEach(function (t) {
    if (t.tab) t.tab.addEventListener('click', function () { switchTab(t.key); });
  });

  /* ---------- 建议箱 ---------- */
  function renderSuggest() {
    var items = cache.suggest;
    if (suggestCountEl) suggestCountEl.textContent = String(items.length);

    var view = items.filter(function (m) {
      if (filter === 'todo') return !m.done;
      if (filter === 'done') return !!m.done;
      return true;
    });

    if (!view.length) {
      saySuggest(items.length ? '这个筛选下没有建议' : '还没有收到建议，第一条留给大家');
    } else {
      saySuggest('');
    }
    suggestList.innerHTML = '';

    view.forEach(function (m) {
      var li = doc.createElement('li');
      li.className = 'board-item' + (m.done ? ' is-done' : '');
      li.setAttribute('data-id', m.id);

      var head = doc.createElement('div');
      head.className = 'board-item_head';

      var tag = doc.createElement('span');
      tag.className = 'board-item_tag ' + (m.done ? 'board-item_tag--done' : 'board-item_tag--todo');
      tag.textContent = m.done ? '已完成' : '未处理';
      head.appendChild(tag);

      var time = doc.createElement('span');
      time.className = 'board-item_time';
      time.textContent = timeLabel(m.at);
      head.appendChild(time);

      if (m.contact) {
        var c = doc.createElement('span');
        c.className = 'board-item_contact';
        c.textContent = '联系方式：' + m.contact;
        head.appendChild(c);
      }
      li.appendChild(head);

      var text = doc.createElement('p');
      text.className = 'board-item_text';
      text.textContent = m.text;
      li.appendChild(text);

      var foot = doc.createElement('div');
      foot.className = 'board-item_foot';

      var toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.className = 'board-item_btn';
      toggle.textContent = m.done ? '取消完成' : '标记完成';
      toggle.setAttribute('aria-label', (m.done ? '取消完成：' : '标记完成：') + m.text);
      toggle.addEventListener('click', function () {
        api('/api/suggest/done', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: m.id, done: m.done ? 0 : 1 })
        }).then(loadAll).catch(function () {});
      });
      foot.appendChild(toggle);

      var del = doc.createElement('button');
      del.type = 'button';
      del.className = 'board-item_btn board-item_btn--danger';
      del.textContent = '删除';
      del.setAttribute('aria-label', '删除建议：' + m.text);
      del.addEventListener('click', function () {
        if (!window.confirm('确定删除这条建议？删了就没了。')) return;
        api('/api/suggest?id=' + encodeURIComponent(m.id), { method: 'DELETE' })
          .then(loadAll).catch(function () {});
      });
      foot.appendChild(del);

      li.appendChild(foot);
      suggestList.appendChild(li);
    });
  }

  if (filtersBox) {
    Array.prototype.forEach.call(filtersBox.querySelectorAll('.board-filter'), function (btn) {
      btn.addEventListener('click', function () {
        filter = btn.getAttribute('data-filter') || 'all';
        Array.prototype.forEach.call(filtersBox.querySelectorAll('.board-filter'), function (b) {
          var on = b === btn;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        renderSuggest();
      });
    });
  }

  /* ---------- 留言墙 ---------- */
  function renderDanmaku() {
    var items = cache.danmaku;
    if (danmakuCountEl) danmakuCountEl.textContent = String(items.length);
    if (!items.length) sayDanmaku('留言墙还是空的');
    else sayDanmaku('');
    danmakuList.innerHTML = '';

    items.slice().reverse().forEach(function (m) {
      var li = doc.createElement('li');
      li.className = 'board-item';
      li.setAttribute('data-id', m.id);

      var head = doc.createElement('div');
      head.className = 'board-item_head';

      var dot = doc.createElement('span');
      dot.className = 'board-item_dot';
      dot.style.setProperty('--c', m.color || '#ff6b6b');
      head.appendChild(dot);

      var time = doc.createElement('span');
      time.className = 'board-item_time';
      time.textContent = timeLabel(m.at);
      head.appendChild(time);
      li.appendChild(head);

      var text = doc.createElement('p');
      text.className = 'board-item_text';
      text.textContent = m.text;
      li.appendChild(text);

      var foot = doc.createElement('div');
      foot.className = 'board-item_foot';

      var del = doc.createElement('button');
      del.type = 'button';
      del.className = 'board-item_btn board-item_btn--danger';
      del.textContent = '删除';
      del.setAttribute('aria-label', '删除留言：' + m.text);
      del.addEventListener('click', function () {
        if (!window.confirm('确定删除这条留言？删了就没了。')) return;
        api('/api/danmaku?id=' + encodeURIComponent(m.id), { method: 'DELETE' })
          .then(loadAll).catch(function () {});
      });
      foot.appendChild(del);

      li.appendChild(foot);
      danmakuList.appendChild(li);
    });
  }

  /* ======================================================================
     作品集：上面的表单管「新增 / 编辑」，下面的列表管「上线 / 隐藏 / 删除」
     ==================================================================== */
  var WORK_STATUS = { on: '展示中', soon: '筹备中', off: '已隐藏' };

  function mkBtn(text, onClick, aria) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'board-item_btn';
    b.textContent = text;
    if (aria) b.setAttribute('aria-label', aria);
    b.addEventListener('click', onClick);
    return b;
  }

  /* fillForm(null) = 回到新增模式 */
  function fillForm(item) {
    editingId = item ? item.id : '';
    if (item) {
      wf.title.value = item.title || '';
      wf.kicker.value = item.kicker || '';
      wf.summary.value = item.summary || '';
      wf.cover.value = item.cover || '';
      previewCover(item.cover || '');
      coverPick = null;
      if (coverName) coverName.value = '';
      dropReady();
      sayCover('');
      wf.link.value = item.link || '';
      wf.type.value = item.type || '';
      wf.date.value = item.date || '';
      wf.linkText.value = item.link_text || '';
      wf.status.value = item.status || 'on';
      wf.sort.value = item.sort == null ? 0 : item.sort;
      if (wf.featured) wf.featured.checked = !!item.featured;
      /* 老数据没有 recent 字段时按「上首页」算，和前台保持一致 */
      if (wf.recent) wf.recent.checked = item.recent === undefined ? true : !!item.recent;
      worksForm.classList.add('is-editing');
      worksFormTitle.textContent = '编辑：' + (item.title || '');
      worksSave.textContent = '保存修改';
      if (worksCancel) worksCancel.hidden = false;
    } else {
      worksForm.reset();
      wf.status.value = 'on';
      wf.sort.value = 0;
      if (wf.featured) wf.featured.checked = false;
      if (wf.recent) wf.recent.checked = true;
      previewCover('');
      coverPick = null;
      if (coverName) coverName.value = '';
      dropReady();
      sayCover('');
      worksForm.classList.remove('is-editing');
      worksFormTitle.textContent = '新增作品';
      worksSave.textContent = '保存';
      if (worksCancel) worksCancel.hidden = true;
    }
    sayWorksNote('');
  }

  function busy(on) { worksSave.disabled = !!on; }

  /* ---------- 封面图上传（PUT /api/upload → R2 → 回填地址） ---------- */
  var COVER_MAX = 8 * 1024 * 1024;

  function sayCover(msg, isError) {
    if (!coverNote) return;
    coverNote.textContent = msg || COVER_HINT;
    if (coverDrop) coverDrop.classList.toggle('is-error', !!isError);
  }
  function previewCover(url) {
    if (!coverThumb) return;
    if (url) { coverThumb.src = url; coverThumb.hidden = false; }
    else { coverThumb.removeAttribute('src'); coverThumb.hidden = true; }
  }
  /* 把失败翻译成这句人话：优先用服务端返回的 error 文案 */
  function coverErr(err) {
    if (!err) return '上传失败，再试一次';
    if (err.code === 401) return '密码失效了，重新登录再传';
    if (err.code === 413) return err.detail || '这张太大了（单张上限 8 MB）';
    if (err.code === 415) return err.detail || '只收 jpg / png / webp / gif / avif';
    if (err.code === 503) return err.detail || 'R2 桶没绑定，先在 wrangler.toml 里加 [[r2_buckets]]';
    if (err.detail) return err.detail;
    if (err.name === 'AbortError') return '上传超时了，换张小一点的图试试';
    return '上传失败：' + (err.message || '可能是网络问题');
  }

  /* 文件名去掉扩展名，用来预填输入框 */
  function baseName(name) {
    return String(name || '').replace(/\.[a-z0-9]+$/i, '').slice(0, 60);
  }
  function dropReady() {
    if (coverSend) coverSend.disabled = !coverPick || coverBusy;
  }

  /* 第一步：只是把文件接住，顺便把原文件名填进输入框 */
  function pickCover(file) {
    if (!file || typeof file.size !== 'number') return;
    if (!/^image\/(jpeg|png|webp|gif|avif)$/i.test(file.type)) {
      sayCover('这个格式不支持，只收 jpg / png / webp / gif / avif', true);
      return;
    }
    if (file.size > COVER_MAX) {
      sayCover('这张 ' + (file.size / 1048576).toFixed(1) + ' MB，超过 8 MB 了', true);
      return;
    }
    coverPick = file;
    if (coverName) coverName.value = baseName(file.name);
    sayCover('已选：' + file.name + '（' + Math.max(1, Math.round(file.size / 1024)) + ' KB）· 改好文件名后点「上传」');
    dropReady();
  }

  /* 第二步：真正上传。名字用输入框里的，空了就退回原文件名 */
  function sendCover() {
    if (!coverPick || coverBusy) {
      if (!coverPick) sayCover('先在上面选一张图', true);
      return;
    }
    var want = (coverName && coverName.value.trim()) || baseName(coverPick.name) || '';
    coverBusy = true;
    dropReady();
    if (coverDrop) coverDrop.classList.add('is-busy');
    if (coverSendText) coverSendText.textContent = '上传中…';
    sayCover('上传中… ' + (want || ''));
    var url = '/api/upload' + (want ? '?name=' + encodeURIComponent(want) : '');
    api(url, { method: 'PUT', headers: { 'Content-Type': coverPick.type }, body: coverPick })
      .then(function (o) {
        if (!o || !o.ok || !o.url) throw new Error('bad');
        wf.cover.value = o.url;
        previewCover(o.url);
        sayCover('已上传 ' + Math.round(o.size / 1024) + ' KB → ' + o.key);
        coverPick = null;
        if (coverFile) coverFile.value = '';
      })
      .catch(function (err) { sayCover(coverErr(err), true); })
      .then(function () {
        coverBusy = false;
        if (coverSendText) coverSendText.textContent = '上传';
        if (coverDrop) coverDrop.classList.remove('is-busy');
        dropReady();
      });
  }

  if (coverFile) {
    coverFile.addEventListener('change', function () {
      pickCover(coverFile.files && coverFile.files[0]);
    });
  }
  if (coverSend) coverSend.addEventListener('click', sendCover);

  if (coverDrop) {
    ['dragenter', 'dragover'].forEach(function (ev) {
      coverDrop.addEventListener(ev, function (e) { e.preventDefault(); coverDrop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      coverDrop.addEventListener(ev, function (e) { e.preventDefault(); coverDrop.classList.remove('is-over'); });
    });
    coverDrop.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) pickCover(f);
    });
  }

  function renderWorks() {
    var items = cache.works;
    if (worksCountEl) worksCountEl.textContent = String(items.length);
    if (!items.length) sayWorks('还没有作品，用上面的表单加一条');
    else sayWorks('');
    worksList.innerHTML = '';

    items.forEach(function (m) {
      var name = m.title || '（无标题）';

      var li = doc.createElement('li');
      li.className = 'board-item' + (m.status === 'off' ? ' is-off' : '');
      li.setAttribute('data-id', m.id);

      var head = doc.createElement('div');
      head.className = 'board-item_head';

      var tag = doc.createElement('span');
      tag.className = 'board-item_tag board-item_tag--' + (m.status || 'on');
      tag.textContent = WORK_STATUS[m.status] || m.status;
      head.appendChild(tag);

      if (m.featured) {
        var star = doc.createElement('span');
        star.className = 'board-item_star';
        star.textContent = '首屏';
        head.appendChild(star);
      }

      /* 首页「最近文章」开关：勾着才显示这个标记，方便一眼看出哪些没上首页 */
      if (m.recent === 0) {
        var off = doc.createElement('span');
        off.className = 'board-item_star board-item_star--muted';
        off.textContent = '不上首页';
        head.appendChild(off);
      }

      var order = doc.createElement('span');
      order.className = 'board-item_time';
      order.textContent = '排序 ' + (m.sort == null ? 0 : m.sort);
      head.appendChild(order);

      var time = doc.createElement('span');
      time.className = 'board-item_time';
      time.textContent = timeLabel(m.updated || m.at);
      head.appendChild(time);
      li.appendChild(head);

      var title = doc.createElement('p');
      title.className = 'board-item_title';
      title.textContent = name;
      li.appendChild(title);

      if (m.summary) {
        var sum = doc.createElement('p');
        sum.className = 'board-item_text';
        sum.textContent = m.summary;
        li.appendChild(sum);
      }

      var meta = doc.createElement('p');
      meta.className = 'board-item_meta';
      var bits = [];
      if (m.type) bits.push(m.type);
      if (m.date) bits.push(m.date);
      if (m.cover) bits.push('封面 ' + m.cover);
      if (m.link) bits.push('链接 ' + m.link);
      if (m.link_text) bits.push('按钮「' + m.link_text + '」');
      meta.textContent = (bits.length ? bits.join(' ｜ ') : '没填分类 / 时间 / 封面 / 链接');
      li.appendChild(meta);

      var foot = doc.createElement('div');
      foot.className = 'board-item_foot';

      foot.appendChild(mkBtn('编辑', function () {
        fillForm(m);
        worksForm.scrollIntoView({ block: 'nearest' });
      }, '编辑作品：' + name));

      foot.appendChild(mkBtn(m.status === 'off' ? '恢复展示' : '隐藏', function () {
        busy(true);
        api('/api/works', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: m.id, status: m.status === 'off' ? 'on' : 'off' })
        }).then(loadAll).catch(function () {
          sayWorksNote('没改成功，再看一眼网络', true);
        }).then(function () {
          busy(false);
          sayWorksNote('');          /* 上一次保存的话别一直挂着，像刚保存过 */
        });
      }, (m.status === 'off' ? '恢复展示：' : '隐藏：') + name));

      var del = mkBtn('删除', function () {
        if (!window.confirm('确定删除《' + name + '》？删了就没了。')) return;
        busy(true);
        api('/api/works?id=' + encodeURIComponent(m.id), { method: 'DELETE' })
          .then(function () {
            if (editingId === m.id) fillForm(null);
            return loadAll();
          }).catch(function () {
            sayWorksNote('没删成，再看一眼网络', true);
          }).then(function () {
            busy(false);
            sayWorksNote('');        /* 同上：别让旧提示误导 */
          });
      }, '删除作品：' + name);
      del.className += ' board-item_btn--danger';
      foot.appendChild(del);

      li.appendChild(foot);
      worksList.appendChild(li);
    });
  }

  if (worksForm) {
    worksForm.addEventListener('submit', function (e) {
      e.preventDefault();

      var title = wf.title.value.trim();
      if (!title) { sayWorksNote('标题不能为空', true); wf.title.focus(); return; }

      var wasEdit = !!editingId;
      var payload = {
        title: title,
        kicker: wf.kicker.value.trim(),
        summary: wf.summary.value.trim(),
        cover: wf.cover.value.trim(),
        link: wf.link.value.trim(),
        type: wf.type.value.trim(),
        date: wf.date.value.trim(),
        link_text: wf.linkText.value.trim(),
        status: wf.status.value,
        sort: wf.sort.value,
        featured: wf.featured && wf.featured.checked ? 1 : 0,
        recent: wf.recent && wf.recent.checked ? 1 : 0
      };

      busy(true);
      sayWorksNote('保存中…');

      var req;
      if (wasEdit) {
        payload.id = editingId;
        req = api('/api/works', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        req = api('/api/works', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      req.then(function (res) {
        if (!res || !res.ok) {
          sayWorksNote((res && res.error) || '保存失败，再试一次', true);
          return;
        }
        /* 顺序有讲究：fillForm 会顺手清掉提示行，所以先重置表单再说话 */
        fillForm(null);
        sayWorksNote(wasEdit ? '改好了' : '加好了，前台刷新就能看到');
        return loadAll();
      }).catch(function () {
        sayWorksNote('网络连不上，再试一次', true);
      }).then(function () { busy(false); });
    });

    /* 浏览器的 reset 会把 select / number 一起清掉，补回默认值。
       注意这里千万别顺手清提示语：保存成功后的提示就是在 fillForm()（内部会 reset）
       之后才写上去的，异步清一道就把刚说的话抹了 */
    worksForm.addEventListener('reset', function () {
      window.setTimeout(function () {
        if (editingId) return;
        wf.status.value = 'on';
        wf.sort.value = 0;
      }, 0);
    });
  }

  if (worksCancel) {
    worksCancel.addEventListener('click', function () { fillForm(null); });
  }
  /* 先把表单摆成「新增」状态（缺 elements 时别炸，admin.html 结构不完整就跳过整段） */
  if (worksForm && wf.title) fillForm(null);

  /* ---------- 启动：sessionStorage 里有 token 就直接进仪表盘 ---------- */
  try {
    var saved = window.sessionStorage.getItem(TOKEN_KEY);
    if (saved) {
      enter(saved).catch(function () { /* token 失效：停在密码门 */ });
    }
  } catch (e) {}
})();
