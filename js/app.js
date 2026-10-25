/* =========================================================================
   戎糖小记 · app.js
   共用交互：移动端菜单 / 吸顶头部 / 当前页高亮 / 滚动进场 / 数字滚动
             作品轮播（无依赖）/ 年份 / 刷新加载特效（需 .page-cover + .page-wrap）
   页面独有脚本：about.js / works.js / contact.js / time.js
   ========================================================================= */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var header = doc.getElementById('siteHeader');
  var nav = doc.getElementById('primaryNav');
  var navToggle = doc.getElementById('navToggle');
  var scrollCue = doc.getElementById('scrollCue');

  /* ------------------------------------------------------------ 吸顶头部 */
  var headerH = header ? header.offsetHeight : 80;
  function measureHeader() { headerH = header ? header.offsetHeight : 80; }

  /* ------------------------------------------------------------ 当前页高亮 */
  (function markCurrentPage() {
    /* 注意：线上（Cloudflare 静态资源）会把 /works.html 307 到 /works，
       所以 location.pathname 拿到的是「works」而没有扩展名。
       两边都归一化（去目录、去查询串、去锚点、去 .html、index 视为首页）再比，
       否则除了首页以外所有页面的高亮都会悄悄失效。 */
    function norm(s) {
      s = String(s || '').split('#')[0].split('?')[0].split('/').pop();
      s = s.replace(/\.html$/i, '');
      return (!s || s === 'index') ? 'index' : s;
    }
    var here = norm(location.pathname);
    Array.prototype.forEach.call(doc.querySelectorAll('.nav-link'), function (a) {
      var target = norm(a.getAttribute('href'));
      if (target === here) {
        a.classList.add('is-active');
        a.setAttribute('aria-current', 'page');
      }
    });
  })();

  /* ------------------------------------------------------------ 滚动状态 */
  /* 导航变白的时机：整张首图滚过（首图底边越过导航底边）之后 */
  var heroEl = doc.querySelector('.hero');
  var heroContent = doc.querySelector('.hero .hero-inner');
  var heroBottom = 0;
  var heroFadeUntil = 0;
  function measureHero() {
    if (!heroEl) {
      /* 没有首图的页面（如倒计时页）：滚过一屏的 55% 就变白 */
      heroBottom = Math.max(120, window.innerHeight * 0.55 - headerH);
      heroFadeUntil = 0;
      return;
    }
    var top = heroEl.getBoundingClientRect().top + (window.scrollY || window.pageYOffset);
    heroBottom = top + heroEl.offsetHeight - headerH;
    /* 滚动到整张首图的一半时，首图上的文字完全消失 */
    heroFadeUntil = Math.max(1, heroBottom * 0.5);
  }
  measureHero();

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      var y = window.scrollY || window.pageYOffset;
      /* 页顶透明，整张首图滚过去后变白；菜单展开时也保持浅底深字 */
      if (header) header.classList.toggle('is-stuck', navShouldBeStuck());
      /* 文字随滚动渐隐，到首图一半处彻底消失；回到顶部再渐显 */
      if (heroContent) {
        var p = heroFadeUntil > 0 ? Math.min(1, y / heroFadeUntil) : 0;
        var eased = 1 - Math.pow(1 - p, 1.8);
        heroContent.style.setProperty('--hero-fade', (1 - eased).toFixed(3));
        heroContent.style.transform = 'translate3d(0,' + (-34 * eased).toFixed(1) + 'px,0)';
        heroContent.style.pointerEvents = eased > 0.6 ? 'none' : '';
        heroEl.classList.toggle('is-faded', eased > 0.97);
      }
      if (scrollCue) scrollCue.classList.toggle('is-hidden', y > 120);
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  window.addEventListener('resize', function () { measureHero(); onScroll(); });
  window.addEventListener('load', function () { measureHero(); onScroll(); });

  /* ------------------------------------------------------------ 移动端菜单 */
  function navShouldBeStuck() {
    return doc.body.classList.contains('is-nav-open') || (window.scrollY || 0) > heroBottom;
  }
  function closeNav() {
    if (!nav || !navToggle) return;
    nav.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', '打开菜单');
    doc.body.classList.remove('is-nav-open');
    /* 关掉菜单后立刻按当前滚动位置决定导航外观 */
    if (header) header.classList.toggle('is-stuck', navShouldBeStuck());
  }
  function openNav() {
    nav.classList.add('is-open');
    navToggle.setAttribute('aria-expanded', 'true');
    navToggle.setAttribute('aria-label', '关闭菜单');
    doc.body.classList.add('is-nav-open');
    /* 菜单面板是浅色的：打开时导航一并切成浅底深字，导航文字才看得清 */
    if (header) header.classList.add('is-stuck');
  }
  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      if (nav.classList.contains('is-open')) closeNav(); else openNav();
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeNav();
    });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });
    window.addEventListener('resize', function () {
      measureHeader();
      if (window.innerWidth > 980) closeNav();
    });
  }

  /* ------------------------------------------------------------ 滚动进场
     抽成函数：首页 index.js 动态渲染完列表后，可以再调一次把新元素接进来 */
  var revealObserver = null;
  function initReveals(root) {
    var scope = root || doc;
    var els = Array.prototype.slice.call(scope.querySelectorAll('[data-reveal]'));
    els.forEach(function (el) {
      if (el._revealBound) return;                 /* 已接管过的不重复处理 */
      el._revealBound = true;
      var d = el.getAttribute('data-reveal-delay');
      if (d) el.style.setProperty('--reveal-delay', d);
    });
    if ('IntersectionObserver' in window && !reduceMotion) {
      if (!revealObserver) {
        revealObserver = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-in');
              revealObserver.unobserve(entry.target);
            }
          });
        }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
      }
      els.forEach(function (el) { revealObserver.observe(el); });
    } else {
      els.forEach(function (el) { el.classList.add('is-in'); });
    }
    return els;
  }
  var reveals = initReveals();
  window.initReveals = initReveals;
  window.addEventListener('load', function () {
    window.setTimeout(function () {
      reveals.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('is-in');
      });
    }, 300);
  });

  /* ------------------------------------------------------------ 数字滚动
     支持两种数据源：
       data-count="127"              直接给定目标值
       data-since="2024-04-01"       从该日期起算到今天的运行天数（实时动态，会持续刷新） */
  var DAY_MS = 86400000;
  /* 小记启动日：全站「运行天数」统一以这一天为起点 */
  var SITE_START = '2024-04-01';

  function sinceDays(el) {
    var raw = el.getAttribute('data-since') || SITE_START;
    var parts = String(raw).split('-');
    var from = new Date(+parts[0], (+parts[1] || 1) - 1, +parts[2] || 1);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.floor((today - from) / DAY_MS) + 1;   /* 含启动当天 */
    return days > 0 ? days : 0;
  }

  function counterTarget(el) {
    if (el.hasAttribute('data-since')) return sinceDays(el);
    return parseFloat(el.getAttribute('data-count')) || 0;
  }

  /* 记录所有"实时"计数器，便于随时刷新到最新天数 */
  var liveCounters = [];

  /* 后缀（天 / +）已拆到 <i class="stat-suffix"> 里单独控制字号，
     所以这里只写数字本身，不能再用 textContent 覆盖（否则会把 <i> 冲掉） */
  function writeNumber(el, value) {
    var suffixEl = el.querySelector('.stat-suffix');
    if (suffixEl) {
      /* 只替换数字文本节点，保留后缀元素 */
      var node = el.firstChild;
      if (node && node.nodeType === 3) { node.nodeValue = String(value); }
      else { el.insertBefore(doc.createTextNode(String(value)), el.firstChild); }
    } else {
      el.textContent = String(value) + (el.getAttribute('data-suffix') || '');
    }
  }

  function runCounter(el) {
    var target = counterTarget(el);
    var live = el.hasAttribute('data-since');
    if (live) liveCounters.push(el);
    var duration = 1400;
    var start = null;
    if (reduceMotion) { writeNumber(el, target); return; }
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      writeNumber(el, Math.round(target * eased));
      if (p < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  /* 定时把「运行天数」刷到最新（跨零点也能自动 +1） */
  function refreshLiveCounters() {
    liveCounters.forEach(function (el) { writeNumber(el, counterTarget(el)); });
  }
  window.setInterval(function () {
    if (!doc.hidden) refreshLiveCounters();
  }, 60000);
  doc.addEventListener('visibilitychange', function () {
    if (!doc.hidden) refreshLiveCounters();
  });

  var counters = Array.prototype.slice.call(doc.querySelectorAll('[data-count], [data-since]'));
  if ('IntersectionObserver' in window) {
    var counterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          runCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { counterObserver.observe(el); });
  } else {
    counters.forEach(runCounter);
  }

  /* --------------------------------------------------------- 作品轮播（定时跳播）
     思路：所有卡片绝对定位在轨道同一原点，用 translateX 推到各自位置，当前张永远位于
           容器正中；每隔 3 秒平滑地切到下一张，循环往复。
     无缝的关键：切换目标取「模 n 等价、且离现位最近」的格位，从最后一张跳回第一张时
           每张卡片也只是匀速移动一格，视觉上看不出接缝；不克隆节点、不用 scroll-snap。
     交互：悬停 / 键盘聚焦 / 拖拽 / 页面隐藏 / 滚出视野时自动暂停，恢复后继续数 3 秒；
           箭头、圆点、拖拽、方向键可精确切换，操作后重新计时。 */
  function initCarousel(carousel) {
    var track = carousel.querySelector('.carousel-track');
    var viewport = carousel.querySelector('.carousel-viewport') || carousel;
    var prevBtn = carousel.querySelector('.carousel-nav--prev');
    var nextBtn = carousel.querySelector('.carousel-nav--next');
    var dotsWrap = carousel.querySelector('.carousel-dots');
    if (!track) return;

    var slides = Array.prototype.slice.call(track.querySelectorAll('.slide'));
    if (!slides.length) return;
    var n = slides.length;

    /* window / document 级监听统一登记，重建轮播时能整批摘掉（首页 index.js 会用到） */
    var offList = [];
    function onWin(type, fn, opts) {
      window.addEventListener(type, fn, opts);
      offList.push([window, type, fn, opts]);
    }
    function onDoc(type, fn, opts) {
      doc.addEventListener(type, fn, opts);
      offList.push([doc, type, fn, opts]);
    }
    var visObserver = null;
    if (typeof carousel._cdCleanup === 'function') carousel._cdCleanup();
    carousel._cdCleanup = function () {
      offList.forEach(function (t) { t[0].removeEventListener(t[1], t[2], t[3]); });
      if (visObserver) visObserver.disconnect();
      window.clearTimeout(animTimer);
      window.clearTimeout(autoTimer);
      carousel._cdCleanup = null;
    };

    /* ---- 卡片宽度：随视口自适应，但留出左右"露出一点"的边距 ---- */
    function gapSize() {
      var g = parseFloat(window.getComputedStyle(track).getPropertyValue('--carousel-gap'));
      return isNaN(g) ? 24 : g;
    }
    function computeWidth() {
      /* 减去视口左右内边距（给箭头留位置），再按比例决定卡片宽度 */
      var cs = window.getComputedStyle(viewport);
      var pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      var avail = Math.max(200, viewport.clientWidth - pad);
      var peek = avail < 700 ? 0.94 : 0.62;          /* 窄屏几乎占满，宽屏两侧各露一点 */
      return Math.max(180, Math.min(avail * peek, avail - 2));
    }

    var width = 0, gap = gapSize(), step = 0, baseOffset = 0;
    var activeF = 0;               /* 「当前张」：跳播时取整数值，即高亮张 */
    var active = 0;                /* 当前张序号（0..n-1） */
    var curI = [];                 /* 每张卡片当前的格位（k - activeF 的就近等价） */
    var animating = false;
    var hovering = false, focused = false, dragging = false;
    var animTimer = null, autoTimer = null;
    var AUTO_MS = 2500;            /* 每 2.5s 秒跳到下一张 */
    var ANIM_MS = 560;             /* 切换过渡时长（与 .slide 的 transform 过渡一致） */

    function mod(a, m) { return ((a % m) + m) % m; }

    function layout() {
      var w = computeWidth();
      gap = gapSize();
      if (w !== width) {
        width = w;
        slides.forEach(function (s) {
          s.style.width = width + 'px';
          s.style.height = Math.round(width * 0.625) + 'px';
        });
        track.style.height = Math.round(width * 0.625) + 'px';
      }
      step = width + gap;
      /* 卡片 absolute + left:0 是相对视口的 padding box，所以居中量要减掉左内边距 */
      var padLeft = parseFloat(window.getComputedStyle(viewport).paddingLeft) || 0;
      baseOffset = (viewport.clientWidth - width) / 2 - padLeft;
      placeAll(false);
    }

    /* 规范格位：模 n 后落入 [-n/2, n/2)。流动时每帧用它，换位点永远在屏幕外 */
    function nearestI(k) {
      var i = mod(k - activeF, n);
      if (i > n / 2) i -= n;
      return i;
    }
    /* 过渡目标格位：相对「现在的格位」再就近取一次，避免过渡绕远路扫过整个轮播 */
    function targetI(k, target) {
      var raw = k - target;
      return raw + n * Math.round((curI[k] - raw) / n);
    }
    function setX(s, i, dx) {
      s.style.transform = 'translate3d(' + (baseOffset + i * step + (dx || 0)).toFixed(1) + 'px,0,0)';
    }

    /* 按当前 activeF 布置所有卡片；animated=false 时先关过渡再强制回流，立即生位 */
    function placeAll(animated) {
      if (animated) {
        track.classList.remove('no-anim');
      } else {
        track.classList.add('no-anim');
      }
      slides.forEach(function (s, k) {
        curI[k] = nearestI(k);
        setX(s, curI[k]);
      });
      if (!animated) {
        void track.offsetWidth;      /* 强制回流，保证这次立即生位、不进过渡 */
        track.classList.remove('no-anim');
      }
    }

    function paint() {
      slides.forEach(function (s, k) {
        s.classList.toggle('is-active', k === active);
        var i = k - active;
        s.style.zIndex = String(10 - Math.min(9, Math.abs(i)));
        s.setAttribute('aria-hidden', Math.abs(i) > 1 ? 'true' : 'false');
      });
      if (dots.length) {
        dots.forEach(function (d, k) {
          d.setAttribute('aria-selected', k === active ? 'true' : 'false');
        });
      }
    }

    /* ---- 定时跳播：每 3 秒切到下一张，循环 ---- */
    function isPaused() {
      return reduceMotion || hovering || focused || dragging || doc.hidden;
    }
    function scheduleAuto(ms) {
      window.clearTimeout(autoTimer);
      autoTimer = window.setTimeout(tickAuto, ms);
    }
    function startAuto() {
      if (autoTimer || isPaused()) return;
      scheduleAuto(AUTO_MS);
    }
    function stopAuto() {
      window.clearTimeout(autoTimer);
      autoTimer = null;
    }
    function tickAuto() {
      autoTimer = null;
      if (isPaused()) return;                   /* 暂停中：条件消失时 startAuto 会重新排 */
      if (animating) { scheduleAuto(150); return; } /* 上一跳的过渡还没演完，顺延一小会 */
      goTo(active + 1);
      scheduleAuto(AUTO_MS);
    }
    /* 用户操作后重新数 3 秒，避免刚操作完又立刻自动跳 */
    function userGoTo(index) {
      goTo(index);
      if (!isPaused()) scheduleAuto(AUTO_MS);
    }

    /* ---- 精确切换到第 index 张（取就近的等价目标），过渡完成后归位 ---- */
    function goTo(index) {
      var target = index + n * Math.round((activeF - index) / n);
      window.clearTimeout(animTimer);
      animating = true;
      slides.forEach(function (s, k) {
        curI[k] = targetI(k, target);
        setX(s, curI[k]);
      });
      activeF = target;
      active = mod(Math.round(target), n);
      paint();
      animTimer = window.setTimeout(function () {
        animating = false;
        placeAll(false);      /* 规范位与过渡位只差整数组，差异都落在屏幕外 */
      }, ANIM_MS);
    }
    var animTimer = null;

    /* ---- 圆点 ---- */
    var dots = [];
    if (dotsWrap) {
      for (var d = 0; d < n; d++) {
        (function (idx) {
          var b = doc.createElement('button');
          b.type = 'button';
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-label', '第 ' + (idx + 1) + ' 张作品');
          b.addEventListener('click', function () { userGoTo(idx); });
          dotsWrap.appendChild(b);
          dots.push(b);
        })(d);
      }
    }

    /* ---- 箭头 / 键盘 ---- */
    function next() { userGoTo(active + 1); }
    function prev() { userGoTo(active - 1); }
    if (nextBtn) nextBtn.addEventListener('click', next);
    if (prevBtn) prevBtn.addEventListener('click', prev);
    viewport.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    });

    /* ---- 点击卡片：两侧的卡片移过来，中间的卡片跳转链接 ---- */
    slides.forEach(function (slide, k) {
      slide.addEventListener('click', function (e) {
        if (Date.now() - lastDragEnd < 600) { e.preventDefault(); return; }
        if (k !== active) {
          e.preventDefault();
          userGoTo(k);
        }
      });
    });

    /* ---- 触摸 / 拖拽滑动 ---- */
    var startX = 0, dragDx = 0, lastT = 0, lastDragEnd = 0;
    function onDown(e) {
      if (animating) return;
      dragging = true;
      startX = (e.touches ? e.touches[0].clientX : e.clientX);
      dragDx = 0;
      lastT = Date.now();
      stopAuto();
      track.classList.add('is-dragging');
      /* 鼠标：拦住原生拖拽（链接/图片）和文字选中，否则拖不动 */
      if (!e.touches && e.cancelable) e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      var x = (e.touches ? e.touches[0].clientX : e.clientX);
      dragDx = x - startX;
      var limit = step * 0.9;
      if (dragDx > limit) dragDx = limit;
      if (dragDx < -limit) dragDx = -limit;
      slides.forEach(function (s, k) { setX(s, curI[k], dragDx); });
      if (e.cancelable) e.preventDefault();
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      track.classList.remove('is-dragging');
      var dt = Date.now() - lastT;
      var threshold = Math.max(40, width * 0.16 * (dt < 260 ? 0.6 : 1));
      var move = 0;
      if (dragDx > threshold) move = -1;
      else if (dragDx < -threshold) move = 1;
      /* 真拖拽过：短时间内随后的 click 一律作废（触屏的兼容鼠标事件会补一个 click，
         不拦的话「滑动一下」会被当成「点开链接」） */
      if (Math.abs(dragDx) > 8) lastDragEnd = Date.now();
      dragDx = 0;
      userGoTo(active + move);    /* 位移不够就吸附回最近的一张 */
    }
    viewport.addEventListener('touchstart', onDown, { passive: true });
    viewport.addEventListener('touchmove', onMove, { passive: false });
    viewport.addEventListener('touchend', onUp);
    viewport.addEventListener('touchcancel', onUp);
    viewport.addEventListener('mousedown', function (e) { onDown(e); });
    onWin('mousemove', function (e) { if (dragging) onMove(e); });
    onWin('mouseup', function () { if (dragging) onUp(); });

    /* ---- 暂停 / 恢复：悬停、键盘聚焦、页面隐藏、滚出视野 ---- */
    carousel.addEventListener('mouseenter', function () { hovering = true; stopAuto(); });
    carousel.addEventListener('mouseleave', function () { hovering = false; if (!focused) startAuto(); });
    viewport.addEventListener('focus', function () { focused = true; stopAuto(); });
    viewport.addEventListener('blur', function () { focused = false; if (!hovering) startAuto(); });
    onDoc('visibilitychange', function () {
      if (doc.hidden) stopAuto(); else if (!hovering && !focused) startAuto();
    });
    /* 滚出视野时停止计时，省点精力；回到视野再继续 */
    if ('IntersectionObserver' in window) {
      visObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            if (!hovering && !focused && !doc.hidden) startAuto();
          } else {
            stopAuto();
          }
        });
      }, { threshold: 0.25 });
      visObserver.observe(carousel);
    }

    /* ---- 初始化 ---- */
    layout();
    paint();
    onWin('load', function () { layout(); paint(); });
    onWin('resize', function () {
      window.clearTimeout(carousel._rt);
      carousel._rt = window.setTimeout(function () { layout(); paint(); }, 150);
    });
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { layout(); paint(); });
    startAuto();
  }
  Array.prototype.forEach.call(doc.querySelectorAll('.carousel'), initCarousel);

  /* 首页 index.js 用作品集数据渲染完卡片后，调它重建轮播 */
  window.initCarousels = function (root) {
    Array.prototype.forEach.call((root || doc).querySelectorAll('.carousel'), initCarousel);
  };

  /* ============================================================ 刷新加载特效
     粉白封面 → 资源就绪后整页淡入 → 入场序列（首图推近 / 标题遮罩上滑 / 页头落下）
     页面需要自备 .page-cover + .page-wrap 与 head 内联样式，没有就整段跳过：
     body.is-ready 对不参与的页面没有副作用，但 scrollTo(0,0) 会打断锚点，所以宁可不执行
     ====================================================================== */
  var EXPO_OUT = 'cubic-bezier(0.19, 1, 0.22, 1)'; /* gsap "expo.out" */

  function animateOnce(el, frames, opts) {
    if (!el || typeof el.animate !== 'function') return;
    var a = el.animate(frames, opts);
    /* fill:both 的动画留在 DOM 上会一直压着元素的自然状态，播完就撤 */
    if (a && a.finished) a.finished.then(function () { a.cancel(); })['catch'](function () {});
    else if (a) a.onfinish = function () { a.cancel(); };
  }

  function playIntro() {
    /* ① 首图卡片推近：translateY 20% + scale .6 → 1，圆角收到底（2.5s expo.out）。
         靶点取 [data-hero-bg-inner]：滚动用的 scale 在它的父级卡片上，两者互不干扰 */
    animateOnce(doc.querySelector('[data-hero-bg-inner]'), [
      { transform: 'translateY(20%) scale(.6)', borderRadius: '26px' },
      { transform: 'translateY(0) scale(1)', borderRadius: '0px' }
    ], { duration: 2500, delay: 120, easing: EXPO_OUT, fill: 'both' });

    /* ② 标题遮罩上滑：clip-path 收底 + translateY 85% → 归位（逐行 stagger 90ms） */
    Array.prototype.forEach.call(doc.querySelectorAll('[data-hero-intro="title"]'), function (t, i) {
      animateOnce(t, [
        { clipPath: 'inset(0% 0% 100% 0%)', transform: 'translateY(85%)' },
        { clipPath: 'inset(-16% -16% -16% -16%)', transform: 'translateY(0)' }
      ], { duration: 950, delay: 260 + 90 * i, easing: EXPO_OUT, fill: 'both' });
    });

    /* ③ 页头落下 */
    animateOnce(header, [
      { opacity: 0, transform: 'translateY(-14px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 650, delay: 180, easing: EXPO_OUT, fill: 'both' });

    /* 首页的 Ken Burns（去模糊 + 缓慢漂移）与推近同时开始：两边都从「当前值」出发，
       全程连续；若错开时间，后启动的那层第一帧会造成跳变 */
    heroImgIntro();
  }

  /* 首图刷新入场：轻微去模糊 + 从 1.12 倍缓推归位，像在对焦。
     只对带 data-hero-img-in 的首图生效（目前是首页）；
     hover 的 scale 写在 CSS 里，动画播完即撤销，两者不打架。 */
  function heroImgIntro() {
    var img = doc.querySelector('[data-hero-img-in]');
    if (!img) return;
    var play = function () {
      /* 给容器加 is-live：CSS 里的 Ken Burns（先归位再缓慢推近）从这里开始 */
      var media = img.closest('.hero-media');
      if (media) media.classList.add('is-live');
      /* img 只做「去模糊 + 显影」，缩放那部分在 .hero-zoom 上，避免占住 transform 影响 hover */
      animateOnce(img, [
        { opacity: .5, filter: 'blur(9px)' },
        { opacity: 1, filter: 'blur(0px)' }
      ], {
        duration: 1400, delay: 60,
        /* 比 expo.out 更匀速一点：不然前 300ms 就走完七成，看着像闪一下 */
        easing: 'cubic-bezier(.24,.72,.28,1)',
        fill: 'both'
      });
    };
    /* 等首图自己就绪再播：否则图还没下载完，动画空放着，图到了会「啪」地直接出现 */
    if (img.complete) play();
    else {
      img.addEventListener('load', play, { once: true });
      window.setTimeout(play, 2500);   /* 兜底：load 一直不来也别卡住 */
    }
  }

  function initLoadEffect() {
    if (!doc.querySelector('.page-cover')) {
      /* 没有加载封面的页面（首页）：首图入场自己计时播，别再等 is-ready */
      if (!reduceMotion) window.setTimeout(heroImgIntro, 120);
      return;
    }
    var finished = false;

    var finish = function () {
      if (finished) return;
      finished = true;
      doc.body.classList.add('is-ready');
      window.scrollTo(0, 0); /* 滚动条重置至页面最顶部 */
      if (!reduceMotion) playIntro();
    };

    /* 等全部资源就绪（图片 / 样式 / 字体）；2.6s 兜底，避免封面悬挂 */
    var resLoaded = new Promise(function (resolve) {
      if (doc.readyState === 'complete') resolve();
      else window.addEventListener('load', resolve, { once: true });
    });
    var fontsReady = (doc.fonts && doc.fonts.ready) ? doc.fonts.ready : Promise.resolve();
    Promise.race([
      Promise.all([resLoaded, fontsReady]),
      new Promise(function (resolve) { window.setTimeout(resolve, 2600); })
    ]).then(finish);

    /* 从后退缓存恢复时直接呈现，不再播放加载序列 */
    window.addEventListener('pageshow', function (e) { if (e.persisted) finish(); });
  }
  initLoadEffect();

  /* ------------------------------------------------------------ 年份 */
  Array.prototype.forEach.call(doc.querySelectorAll('[data-year]'), function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ============================================================ 卡片式首图：滚动进度
     读 [data-hero-progress] 容器，把 0 -> 1 的滚动进度写进它的 --progress，
     由 common.css 的「卡片式首图」段消费（卡片收缩 / 图片反向放大 / 文字变色或淡出）。
     有该容器的页面（about / contact / works）自动生效，没有就什么都不做。 */
  (function initHeroProgress() {
    var scroller = doc.querySelector('[data-hero-progress]');
    if (!scroller) return;
    var ticking = false;

    var update = function () {
      var total = scroller.offsetHeight - window.innerHeight;
      var p = 0;
      if (total > 0) {
        p = -scroller.getBoundingClientRect().top / total;
        p = Math.min(Math.max(p, 0), 1);
      }
      scroller.style.setProperty('--progress', p.toFixed(4));
      ticking = false;
    };
    var onScroll = function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  })();

  /* 关闭无 JS 的进场降级标记 */
  root.classList.add('js-ready');
})();
