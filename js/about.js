/* =========================================================================
   戎糖小记 · about.js
   About 页概念版首图（移植自 网页概念版/assets/js/main.js）：
   - 滚动进度 --progress(0 -> 1)：驱动媒体卡片收缩 / 文字白->黑 / 竖线与段落展开
   - 刷新加载特效：整段已上移到公共 app.js（index / works / time 也能复用），
     这里只负责备好被它选中的钩子：[data-hero-bg-inner] 和 [data-hero-intro="title"]
   - 下方模块（Topics / Numbers / Say hi）沿用 data-reveal 滚动渐入
   - 移动端堆叠块：分字（中文按字、英文按词）+ 进场
   - Numbers 卡片：点击 / 回车翻面看背面小记、鼠标指针倾斜、运行天数换算成
     「X 年 X 个月 X 天」（首次翻面时写入）
   ========================================================================= */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* 刷新即回到最顶部：禁用浏览器默认的滚动位置恢复 */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* ---------- 移动端：分字 + 进场 ---------- */
  function initMobileAnimations() {
    /* 把 [data-animation="split"] 的文本拆成逐字/逐词 span（中文按字、英文按词） */
    document.querySelectorAll('[data-animation="split"]').forEach(function (el) {
      var raw = (el.textContent || '').trim();
      if (!raw) return;
      var byWord = /\s/.test(raw);
      var parts = byWord ? raw.split(/\s+/) : raw.split('');
      el.textContent = '';
      parts.forEach(function (w, i) {
        var item = document.createElement('span');
        item.className = 'anim-text-item';
        item.textContent = w;
        item.style.setProperty('--index', String(i));
        el.appendChild(item);
        if (byWord && i < parts.length - 1) {
          el.appendChild(document.createTextNode(' '));
        }
      });
    });

    var blocks = document.querySelectorAll('[data-anim-parent]');
    if (!blocks.length) return;

    var reveal = function (block) {
      block.querySelectorAll('.anim-text, .anim-fade, .anim-scale-y').forEach(function (el) {
        el.classList.add('is-inview');
      });
    };

    if (!('IntersectionObserver' in window)) {
      blocks.forEach(reveal);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          reveal(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    blocks.forEach(function (b) { io.observe(b); });
  }

  /* ---------- Numbers 卡片：点击翻面 + 鼠标倾斜 + 实时天数文案 ---------- */
  function initNumbersCards() {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.about-numbers_card'));
    if (!cards.length) return;

    var START = { y: 2024, m: 3, d: 1 }; /* 2024-04-01（月份 0 起算） */

    /* 「X 年 X 个月 X 天」按日历推算，和公共 app.js 的 data-since 天数保持一致口径 */
    var daysText = function () {
      var now = new Date();
      var y = now.getFullYear() - START.y;
      var m = now.getMonth() - START.m;
      var d = now.getDate() - START.d;
      if (d < 0) {
        m -= 1;
        d += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
      }
      if (m < 0) { m += 12; y -= 1; }
      var parts = [];
      if (y > 0) parts.push(y + ' 年');
      if (m > 0) parts.push(m + ' 个月');
      parts.push(d > 0 ? d + ' 天' : '刚好满月');
      return '从 2024.04.01 到现在，走过 ' + parts.join(' ') + '，一天都没有缺席。每一天都算数。';
    };

    /* 掀页式换面：出场面沿水平轴上掀（rotateX）并淡出，入场面反向落回并淡入。
       两段串接，任一时刻只渲染一面 —— 不会出现空卡、镜像透字或两面叠字 */
    var OUT_MS = 240;
    var IN_MS = 360;

    var swapFaces = function (card, on) {
      var front = card.querySelector('.about-numbers_face--front');
      var back = card.querySelector('.about-numbers_face--back');
      if (!front || !back) return;
      var out = on ? front : back;
      var inn = on ? back : front;

      if (reduceMotion || typeof out.animate !== 'function') {
        out.style.visibility = 'hidden';
        inn.style.visibility = 'visible';
        return;
      }

      inn.style.opacity = '0'; /* 入场面先压住，避免与出场面同帧叠字 */
      var a1 = out.animate(
        [
          { transform: 'rotateX(0deg) scale(1)', opacity: 1 },
          { transform: 'rotateX(-78deg) scale(.96)', opacity: 0 }
        ],
        { duration: OUT_MS, easing: 'cubic-bezier(.4, 0, .9, .55)', fill: 'both' }
      );

      var playIn = function () {
        try { a1.cancel(); } catch (e) {}
        out.style.visibility = 'hidden';
        inn.style.visibility = 'visible';
        var a2 = inn.animate(
          [
            { transform: 'rotateX(78deg) scale(.96)', opacity: 0 },
            { transform: 'rotateX(0deg) scale(1)', opacity: 1 }
          ],
          { duration: IN_MS, easing: 'cubic-bezier(.15, .75, .3, 1)', fill: 'both' }
        );
        var done = function () {
          inn.style.opacity = ''; /* 先交回 CSS 默认 1，同帧再 cancel，避免闪一下透明 */
          try { a2.cancel(); } catch (e) {}
        };
        a2.onfinish = done;
      };

      a1.onfinish = playIn;
    };

    var resetTilt = function (card) {
      card.style.setProperty('--tilt-x', '0deg');
      card.style.setProperty('--tilt-y', '0deg');
    };

    var flip = function (card) {
      /* 动画进行中忽略新的触发，避免两段动画叠在同一面上打架 */
      if (card.getAttribute('data-flip-busy') === '1') return;
      card.setAttribute('data-flip-busy', '1');

      var on = card.classList.toggle('is-flipped');
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
      swapFaces(card, on);
      var back = card.querySelector('.about-numbers_face--back');
      if (back) {
        if (on) back.removeAttribute('inert');
        else back.setAttribute('inert', '');
      }
      resetTilt(card);
      if (on) {
        var fact = card.querySelector('[data-days-fact]');
        if (fact && !fact.getAttribute('data-filled')) {
          fact.textContent = daysText();
          fact.setAttribute('data-filled', '1');
        }
      }
      window.setTimeout(function () { card.removeAttribute('data-flip-busy'); }, OUT_MS + IN_MS + 60);
    };

    /* 仅在精确指针（鼠标）且用户不排斥动效时启用倾斜 */
    var tiltOn = !reduceMotion && window.matchMedia('(pointer: fine)').matches;

    cards.forEach(function (card) {
      var back = card.querySelector('.about-numbers_face--back');
      if (back) {
        back.setAttribute('inert', '');
        back.style.visibility = 'hidden'; /* 初始只渲染正面 */
      }

      card.addEventListener('click', function () { flip(card); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          flip(card);
        }
      });

      if (!tiltOn) return;
      var rect = null;
      card.addEventListener('pointerenter', function (e) {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        rect = card.getBoundingClientRect();
      });
      card.addEventListener('pointermove', function (e) {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        if (!rect || card.classList.contains('is-flipped')) return;
        var px = (e.clientX - rect.left) / rect.width - 0.5;
        var py = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.setProperty('--tilt-y', (px * 9).toFixed(2) + 'deg');
        card.style.setProperty('--tilt-x', (-py * 7).toFixed(2) + 'deg');
      });
      card.addEventListener('pointerleave', function () { rect = null; resetTilt(card); });
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    initMobileAnimations();
    initNumbersCards();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
