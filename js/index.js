/* =========================================================================
   戎糖小记 · index.js（首页独有脚本）
   只做一件事：把首页「最新发布」区块换成数据库里被勾成「首屏最新发布」的那条作品
   （后台：作品集 → 勾「设为首屏『最新发布』」，全站只有一条）。

   设计原则：**失败就什么都不做**。HTML 里那套文案/图片是兜底内容，
   接口挂了、没勾选、没开 JS，页面照旧可看，不会出现空白块。
   ========================================================================= */
(function () {
  'use strict';

  var doc = document;
  var img = doc.getElementById('featImg');
  var link = doc.getElementById('featLink');
  var title = doc.getElementById('featTitle');
  var desc = doc.getElementById('featDesc');
  var meta = doc.getElementById('featMeta');
  var btn = doc.getElementById('featBtn');
  var btnText = doc.getElementById('featBtnText');
  var actions = doc.getElementById('featActions');
  if (!img || !title) return;

  /* 接口地址：线上同源优先（www.sugrong.com 自己就带 /api），本地预览回落 api 子域 */
  var HOST = 'https://api.sugrong.com';
  var SAME = /^https?:$/.test(location.protocol) && /(^|\.)sugrong\.com$/.test(location.hostname);
  var urls = SAME ? ['/api/works', HOST + '/api/works'] : [HOST + '/api/works'];

  function get(i) {
    if (i >= urls.length) return Promise.reject(new Error('all failed'));
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = window.setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    var o = { cache: 'no-store' };
    if (ctrl) o.signal = ctrl.signal;
    return fetch(urls[i], o).then(function (r) {
      window.clearTimeout(timer);
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }, function (e) {
      window.clearTimeout(timer);
      if (i + 1 < urls.length && !(e && e.name === 'AbortError')) return get(i + 1);
      throw e;
    });
  }

  function apply(it) {
    if (it.cover) {
      img.src = it.cover;
      img.alt = '最新发布：' + (it.title || '');
    }
    /* 标题取作品标题；简介用 summary（保留换行） */
    if (it.title) title.textContent = it.title;
    if (it.summary) desc.textContent = it.summary;

    /* 标题下面那行「类型 · 日期」：两个都没填就整行收起来 */
    if (meta) {
      var bits = [];
      if (it.type) bits.push(it.type);
      if (it.date) bits.push(it.date);
      meta.textContent = bits.join(' · ');
      meta.hidden = !bits.length;
    }

    /* 有链接才显示按钮；筹备中的（没链接）就把按钮收起来 */
    if (it.link) {
      link.href = it.link;
      link.setAttribute('aria-label', '打开最新发布：' + (it.title || ''));
      if (/^https?:/i.test(it.link)) {
        link.target = '_blank';
        link.rel = 'noopener';
        btn.target = '_blank';
        btn.rel = 'noopener';
      }
      btn.href = it.link;
      if (btnText) btnText.textContent = it.link_text || '阅读文章';
      if (actions) actions.hidden = false;
    } else if (actions) {
      actions.hidden = true;
    }
  }

  /* =======================================================================
     最近文章（列表式）：数据同样来自 /api/works
     - 用作品数据重建列表；HTML 里那 5 行只是接口挂了时的兜底
     - 桌面端：鼠标悬停某行才弹出封面浮窗（position:fixed，跟着光标走）
     - 触屏 / 窄屏：没有 hover，改成每行常显的小缩略图（见 CSS）
     ======================================================================= */
  var CDN = 'https://img.sugrong.com';
  function absUrl(u) {
    if (!u) return '';
    if (/^(https?:)?\/\//i.test(u)) return u;
    return CDN + (u.charAt(0) === '/' ? u : '/' + u);
  }

  /* 一行：封面（默认收起） + 标题/胶囊 + 右侧日期
     展开效果全在 CSS（.rec-link:hover / :focus-visible），这里只负责结构 */
  function buildRow(it) {
    var li = doc.createElement('li');
    li.className = 'rec-row';
    li.setAttribute('data-reveal', '');

    var href = (it.link || '').trim();
    var isExt = /^https?:/i.test(href);
    var link = href ? doc.createElement('a') : doc.createElement('div');
    link.className = 'rec-link' + (href ? '' : ' is-plain');
    if (href) {
      link.href = href;
      if (isExt) { link.target = '_blank'; link.rel = 'noopener'; }
    }
    link.setAttribute('aria-label', (it.title || '作品') + '：' + (it.link_text || '查看'));

    var thumb = doc.createElement('span');
    thumb.className = 'rec-thumb';
    var img = doc.createElement('img');
    img.src = absUrl(it.cover) || (CDN + '/assets/gd1.jpg');
    img.alt = '';
    img.width = 264;
    img.height = 164;
    img.loading = 'lazy';
    img.decoding = 'async';
    thumb.appendChild(img);

    var main = doc.createElement('span');
    main.className = 'rec-main';
    var title = doc.createElement('span');
    title.className = 'rec-title';
    title.textContent = it.title || '未命名';
    var tag = doc.createElement('span');
    tag.className = 'rec-tag';
    tag.textContent = it.type || '小记';
    main.appendChild(title);
    main.appendChild(tag);

    var side = doc.createElement('span');
    side.className = 'rec-side';
    side.textContent = it.status === 'soon' ? '筹备中' : (it.date || '');

    link.appendChild(thumb);
    link.appendChild(main);
    link.appendChild(side);
    li.appendChild(link);
    return li;
  }

  function mountRecent(items) {
    var list = doc.getElementById('recentList');
    if (!list || !items || !items.length) return;

    /* 后台「放进首页最近文章」的勾选才算；没有 recent 字段（迁移前）按勾上算 */
    var show = items.filter(function (it) {
      return it && it.recent !== 0 && it.recent !== '0';
    });
    if (!show.length) return;              /* 一条都没勾：保留 HTML 里的静态兜底 */

    list.textContent = '';
    show.slice(0, 8).forEach(function (it) {
      list.appendChild(buildRow(it));
      /* 预加载封面：悬停展开时直接出图，不用等网络 */
      var c = absUrl(it.cover);
      if (c) { var pre = new Image(); pre.decoding = 'async'; pre.src = c; }
    });

    /* 新行带 data-reveal，得让进场动画重新接管 */
    if (typeof window.initReveals === 'function') window.initReveals(list);
  }

  get(0).then(function (d) {
    var items = (d && d.items) || [];
    var pick = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i] && (items[i].featured === 1 || items[i].featured === true)) { pick = items[i]; break; }
    }
    if (pick) apply(pick);
    if (items.length) mountRecent(items.slice(0, 8));
  }).catch(function () { /* 静默：保留 HTML 里的兜底内容 */ });
})();
