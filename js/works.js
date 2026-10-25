/* =========================================================================
   戎糖小记 · works.js（我的作品 页面独有脚本）
   三件事：
     1) 卡片来自数据库 —— 拉 GET {API_BASE}/api/works 渲染；拿不到就保留 HTML 里
        那份静态卡片（断网 / 接口挂了页面照样能看，这点跟留言墙一个思路）
     2) 图片淡入   —— 懒加载图解码完成后再显形，避免「先空后闪」
     3) 卡片柔光   —— 指针位置写进 --mx / --my，配合 works.css 的径向渐变
   导航 / 吸顶 / 当前页高亮 / 滚动进场 / 年份等公共交互在 js/app.js，这里不重复。
   ========================================================================= */
(function () {
  'use strict';

  var doc = document;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(pointer: fine)').matches;

  /* 云端接口地址；留空字符串就等于「纯静态模式」，只显示 HTML 里那份卡片 */
  var API_BASE = 'https://api.sugrong.com';
  var TIMEOUT_MS = 7000;
  var MAX_CARDS = 60;

  var grid = doc.getElementById('worksGrid');
  var state = doc.getElementById('worksState');
  var filters = doc.getElementById('worksFilters');
  var typeRow = doc.getElementById('typeRow');
  var yearRow = doc.getElementById('yearRow');
  var typeChips = doc.getElementById('typeChips');
  var yearChips = doc.getElementById('yearChips');
  var countEl = doc.getElementById('worksCount');

  /* 当前选中的筛选项，空串 = 「全部」 */
  var picked = { type: '', year: '' };
  /* 渲染出来的卡片与数据的对应关系，筛选时只切显隐、不重建 DOM */
  var cards = [];

  /* ------------------------------------------------------------ 小工具 */
  function say(msg, isError) {
    if (!state) return;
    state.textContent = msg || '';
    state.className = 'works-state' + (isError ? ' is-error' : '') + (msg ? ' is-on' : '');
  }

  /* 图片地址：只放行站内相对路径和 http(s) 直链，挡掉 javascript: / data: 等 */
  function safeCover(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
    if (/^[\w.\-/]+\.(jpe?g|png|webp|gif|avif|svg)$/i.test(s) &&
        !/^\.{2}/.test(s) && !/[:/]{2}/.test(s)) return s;
    return '';
  }

  /* 跳转地址：站内页面（time.html / dir/a.html#x）或 http(s) 外链 */
  function safeLink(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
    if (/^[\w.\-/]+\.html(#[^\s"'<>]*)?$/i.test(s) &&
        !/^\.{2}/.test(s) && !/[:/]{2}/.test(s)) return s;
    return '';
  }

  function el(tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  }

  /* ------------------------------------------------------------ 图片淡入 */
  function watchImage(img) {
    function show() { img.classList.add('is-loaded'); }
    if (img.complete && img.naturalWidth > 0) { show(); return; }
    img.addEventListener('load', show, { once: true });
    /* 加载失败也让出来，空白块比破图更难看 */
    img.addEventListener('error', show, { once: true });
  }

  function initImageFade(scope) {
    Array.prototype.forEach.call((scope || doc).querySelectorAll('.card-media img'), watchImage);
  }

  /* ------------------------------------------------------------ 卡片柔光
     触摸设备没有 hover，减少动效时也不要这层光斑，两种都直接跳过 */
  function initCardGlow(scope) {
    if (reduceMotion || !finePointer) return;

    Array.prototype.forEach.call((scope || doc).querySelectorAll('.work-card'), function (card) {
      var frame = 0;
      var mx = 0, my = 0;

      /* 逐帧写变量，pointermove 再密也只在下一帧落一次笔 */
      function paint() {
        frame = 0;
        card.style.setProperty('--mx', mx + 'px');
        card.style.setProperty('--my', my + 'px');
      }

      card.addEventListener('pointermove', function (e) {
        var rect = card.getBoundingClientRect();
        mx = e.clientX - rect.left;
        my = e.clientY - rect.top;
        if (!frame) frame = window.requestAnimationFrame(paint);
      }, { passive: true });
    });
  }

  /* ------------------------------------------------------------ 滚动进场
     app.js 里的观察器只在启动时扫一遍 DOM，这张是渲染后才进场的，
     所以自己再开一个同样的观察器，阈值和 app.js 保持一致 */
  function initReveal(nodes) {
    if (!nodes.length) return;
    Array.prototype.forEach.call(nodes, function (node) {
      var d = node.getAttribute('data-reveal-delay');
      if (d) node.style.setProperty('--reveal-delay', d);
    });

    if (!('IntersectionObserver' in window) || reduceMotion) {
      Array.prototype.forEach.call(nodes, function (n) { n.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
    Array.prototype.forEach.call(nodes, function (n) { io.observe(n); });

    /* 兜底：已经躺在首屏里的卡片，照 app.js 的做法补一刀，别等滚动才显形 */
    window.setTimeout(function () {
      Array.prototype.forEach.call(nodes, function (n) {
        var r = n.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) n.classList.add('is-in');
      });
    }, 300);
  }

  /* ------------------------------------------------------------ 造卡片
     全部走 createElement + textContent，不拼字符串 HTML —— 库里的内容由
     站长自己在后台填，仍然按「不可信」处理 */
  function buildCard(item, i) {
    var card = el('article', 'card work-card');
    card.setAttribute('data-reveal', '');
    card.setAttribute('data-reveal-delay', String(i % 3));

    /* 封面：没有图就给一块同色占位，保持卡片高度一致 */
    var media = el('div', 'card-media');
    var cover = safeCover(item.cover);
    if (cover) {
      var img = doc.createElement('img');
      img.src = cover;
      img.alt = (item.title || '作品') + '预览';
      img.width = 2048;
      img.height = 1152;
      img.loading = 'lazy';
      img.decoding = 'async';
      media.appendChild(img);
    } else {
      media.className += ' card-media--empty';
      media.setAttribute('aria-hidden', 'true');
    }
    card.appendChild(media);

    var body = el('div', 'card-body');

    /* 头部一行：小标签在左，发布日期在右；两者缺任一就只有另一个 */
    if (item.kicker || item.date) {
      var head = el('div', 'card-head');
      if (item.kicker) head.appendChild(el('p', 'card-kicker', item.kicker));
      if (item.date) {
        var t = doc.createElement('time');
        t.className = 'card-date';
        t.dateTime = item.date;
        t.textContent = item.date.replace(/-/g, '.');
        head.appendChild(t);
      }
      body.appendChild(head);
    }
    body.appendChild(el('h3', 'h3', item.title));

    /* 简介：服务器存的是纯文本，换行用 <br> 还原成卡片原来的两行版式 */
    if (item.summary) {
      var sum = el('p');
      String(item.summary).split('\n').forEach(function (line, n, arr) {
        if (n) sum.appendChild(doc.createElement('br'));
        sum.appendChild(doc.createTextNode(line));
      });
      body.appendChild(sum);
    }

    var foot = el('div', 'card-foot');
    var link = safeLink(item.link);
    if (item.status === 'soon' || (!link && !item.link_text)) {
      /* 筹备中：给徽章，不给链接 */
      foot.appendChild(el('span', 'badge-soon', item.link_text || '筹备中'));
    } else if (link) {
      var a = el('a', 'card-more');
      a.href = link;
      /* 外链另开窗口，站内页面就地跳 */
      if (/^https?:/i.test(link)) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      a.appendChild(doc.createTextNode(item.link_text || '查看详情'));
      a.appendChild(el('span', 'card-more-arrow', '→'));
      foot.appendChild(a);
    }
    body.appendChild(foot);
    card.appendChild(body);
    return card;
  }

  /* ------------------------------------------------------------ 筛选 */
  /* 两组片：类型（作品实际用到的分类）+ 时间（发布年份，从 YYYY-MM-DD 取前四位）。
     选项由数据生成，以后后台加新分类 / 新年份不用改代码；
     某一组没有可筛的（比如全都没填日期）就把那一行藏掉。 */
  function buildFilters(items) {
    if (!filters) return;

    var types = [], years = [];
    items.forEach(function (m) {
      if (m.type && types.indexOf(m.type) < 0) types.push(m.type);
      var y = String(m.date || '').slice(0, 4);
      if (/^\d{4}$/.test(y) && years.indexOf(y) < 0) years.push(y);
    });
    years.sort().reverse();                       /* 最近的年份排前面 */

    fillChips(typeChips, types);
    fillChips(yearChips, years);
    if (typeRow) typeRow.hidden = !types.length;
    if (yearRow) yearRow.hidden = !years.length;
    filters.hidden = !types.length && !years.length;
    picked.type = '';
    picked.year = '';
  }

  /* 片子的点击行为：点普通片子 = 选中 / 再点一次取消；点「全部」= 这一组回到全选。
     保证每一组里始终有且只有一个选中项，不会出现「谁都没选」的悬空状态 */
  function chipClick(box, b, isAll) {
    var on = b.classList.contains('is-on');
    var target = (isAll || !on) ? b : box.firstElementChild;   /* 取消时退回「全部」 */

    Array.prototype.forEach.call(box.children, function (c) {
      var active = c === target;
      c.classList.toggle('is-on', active);
      c.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    var key = box === typeChips ? 'type' : 'year';
    picked[key] = (target === b && !isAll) ? b.getAttribute('data-value') : '';
    applyFilter();
  }

  /* 「全部」固定在每一组第一个，data-value 为空串 */
  function fillChips(box, options) {
    if (!box) return;
    box.textContent = '';

    var all = el('button', 'works-chip is-on', '全部');
    all.type = 'button';
    all.setAttribute('data-value', '');
    all.setAttribute('aria-pressed', 'true');
    all.addEventListener('click', function () { chipClick(box, all, true); });
    box.appendChild(all);

    options.forEach(function (v) {
      var b = el('button', 'works-chip', v);
      b.type = 'button';
      b.setAttribute('data-value', v);
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { chipClick(box, b, false); });
      box.appendChild(b);
    });
  }

  function applyFilter() {
    if (!cards.length) return;
    var shown = 0;

    cards.forEach(function (c) {
      var okType = !picked.type || c.item.type === picked.type;
      var okYear = !picked.year || String(c.item.date || '').slice(0, 4) === picked.year;
      var on = okType && okYear;
      c.el.hidden = !on;
      if (on) shown++;
    });

    if (countEl) {
      countEl.textContent = picked.type || picked.year
        ? '筛出 ' + shown + ' 篇'
        : '共 ' + shown + ' 篇';
    }
    say(shown ? '' : '这个筛选下还没有作品，换个条件看看');

    /* 被筛出来的卡片如果本来还没进场（之前一直被藏着），补一刀让它们显形 */
    window.setTimeout(function () {
      cards.forEach(function (c) {
        if (c.el.hidden) return;
        var r = c.el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) c.el.classList.add('is-in');
      });
    }, 30);
  }

  /* ------------------------------------------------------------ 取数据 */
  function timedFetch(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = window.setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || TIMEOUT_MS);
    var opts = ctrl ? { signal: ctrl.signal } : {};
    return fetch(url, opts).then(function (r) {
      window.clearTimeout(timer);
      return r;
    }, function (e) {
      window.clearTimeout(timer);
      throw e;
    });
  }

  function loadWorks() {
    if (!grid || !API_BASE) return Promise.resolve(false);

    return timedFetch(API_BASE + '/api/works').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      var items = (data && data.items) || [];

      /* 接口通了但确实一件都没有：那是站长在后台全隐藏了，照实说一句，
         别再拿静态兜底糊上去（否则后台改半天页面上纹丝不动，会以为是坏了） */
      if (!items.length) {
        grid.textContent = '';
        say('作品正在整理中，过两天再来看看～');
        if (filters) filters.hidden = true;      /* 没东西可筛 */
        return true;
      }

      var frag = doc.createDocumentFragment();
      cards = [];
      items.slice(0, MAX_CARDS).forEach(function (item, i) {
        var card = buildCard(item, i);
        cards.push({ item: item, el: card });
        frag.appendChild(card);
      });

      grid.textContent = '';              /* 换掉 HTML 里的静态兜底卡片 */
      grid.appendChild(frag);
      initImageFade(grid);
      initCardGlow(grid);
      initReveal(grid.querySelectorAll('[data-reveal]'));
      buildFilters(items.slice(0, MAX_CARDS));
      applyFilter();
      say('');
      return true;
    }).catch(function () {
      /* 拿不到就什么也不动：静态卡片还在页面上，读者看不出差别。
         筛选也跟着收起来——静态卡片没有 type / date 可筛 */
      if (filters) filters.hidden = true;
      return false;
    });
  }

  /* ------------------------------------------------------------ 启动 */
  function init() {
    /* 静态卡片先按原来的方式跑一遍（图片淡入 / 柔光），
       接口回来后会整体替换，届时上面两个初始化也会对着新卡片再跑一次 */
    initImageFade();
    initCardGlow();
    loadWorks();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
