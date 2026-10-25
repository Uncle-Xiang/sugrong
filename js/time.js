/* =========================================================================
   戎糖小记 · time.js（一万天倒计时 页面独有脚本）
   整页只做一件事：把到 2026-12-20 的时/分/秒算出来，归零后换场放烟花。
     1) 倒计时（对齐整秒边界循环，数字变化时轻跳一下）
     2) 归零揭幕（数字卡退场 → 10000 升起 → 祝福跟上）
     3) 烟花 / 星尘 / 冲击波（canvas，归零后才启动，倒计时期间不占性能）
     4) 点击放烟花（含 ?test 参数可立刻进入庆祝态，方便本地预览）
   导航 / 吸顶 / 当前页高亮 / 年份等公共交互在 js/app.js，这里不重复。
   ========================================================================= */
(function () {
  'use strict';

  var doc = document;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------- 倒计时 + 烟花（time.html） */
  var daysEl = doc.getElementById('days');
  if (daysEl) {
    var targetDate = new Date('2026-12-20T00:00:00');
    var isTest = new URLSearchParams(location.search).has('test');
    var countdownEnded = false;

    var canvas = doc.getElementById('fireworks-canvas');
    var ctx = canvas ? canvas.getContext('2d') : null;
    var particles = [];
    var dust = [];     /* 星尘：庆祝态背景里缓慢上升的光点 */
    var rings = [];    /* 揭幕冲击波 */
    var dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    var particleScale = window.innerWidth < 380 ? 0.5 : window.innerWidth < 600 ? 0.7 : 1;
    var glowScale = window.innerWidth < 600 ? 0.4 : 1;
    var cw = window.innerWidth;
    var ch = window.innerHeight;

    function resizeCanvas() {
      if (!canvas) return;
      cw = window.innerWidth;
      ch = window.innerHeight;
      canvas.style.width = cw + 'px';
      canvas.style.height = ch + 'px';
      canvas.width = Math.floor(cw * dpr);
      canvas.height = Math.floor(ch * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    var fireworkColors = [
      '#ff6b6b', '#ff9a9e', '#ffd1d1',
      '#ffd93d', '#ff9a3d', '#ffe7a0',
      '#6bcb77', '#4dd0e1', '#9b72cb',
      '#ff8fab', '#c9b6ff', '#7bf1a8'
    ];

    function createFirework(x, y) {
      var count = Math.floor((50 + Math.floor(Math.random() * 60)) * particleScale);
      var color = fireworkColors[Math.floor(Math.random() * fireworkColors.length)];
      var shape = Math.random();
      var i, angle, speed;

      if (shape < 0.25) {                      /* 双层环 */
        for (i = 0; i < count; i++) {
          angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
          speed = 2 + Math.random() * 6;
          speed *= (i % 2 === 0) ? 1.5 : 0.6;
          particles.push({ x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            life: 1, decay: 0.008 + Math.random() * 0.015, color: color, size: 1.5 + Math.random() * 3 });
        }
      } else if (shape < 0.55) {               /* 椭圆 */
        for (i = 0; i < count; i++) {
          angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
          speed = 2 + Math.random() * 6;
          particles.push({ x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.6,
            life: 1, decay: 0.008 + Math.random() * 0.015, color: color, size: 1.5 + Math.random() * 3 });
        }
      } else if (shape < 0.75) {               /* 标准圆 */
        for (i = 0; i < count; i++) {
          angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
          speed = 2 + Math.random() * 6;
          particles.push({ x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            life: 1, decay: 0.008 + Math.random() * 0.015, color: color, size: 1.5 + Math.random() * 3 });
        }
      } else if (shape < 0.85) {               /* 心形 */
        for (i = 0; i < count; i++) {
          var t = (Math.PI * 2 * i) / count;
          var scale = 3 + Math.random() * 4;
          var hx = 16 * Math.pow(Math.sin(t), 3);
          var hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
          particles.push({ x: x, y: y, vx: hx * scale * 0.3, vy: hy * scale * 0.3,
            life: 1, decay: 0.008 + Math.random() * 0.015, color: '#ff6b6b', size: 1.5 + Math.random() * 3 });
        }
      } else {                                 /* 散射星形 */
        var arms = 5 + Math.floor(Math.random() * 3);
        for (i = 0; i < count; i++) {
          angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.2;
          var armIndex = Math.floor((angle / (Math.PI * 2)) * arms);
          var armAngle = (armIndex / arms) * Math.PI * 2;
          var dist = 0.3 + Math.random() * 0.7;
          particles.push({ x: x, y: y, vx: Math.cos(armAngle) * dist * 8, vy: Math.sin(armAngle) * dist * 8,
            life: 1, decay: 0.008 + Math.random() * 0.015, color: color, size: 1.5 + Math.random() * 3 });
        }
      }
    }

    /* --- 星尘：缓慢上升、微微闪烁的光点 --- */
    var dustColors = ['#ffd93d', '#ffbcc5', '#ffffff', '#ff9a3d', '#c9b6ff', '#7bf1a8'];
    function newDust(anywhere) {
      return {
        x: Math.random() * cw,
        y: anywhere ? Math.random() * ch : ch + 8 + Math.random() * 60,
        vx: (Math.random() - 0.5) * 0.16,
        vy: -(0.12 + Math.random() * 0.42),
        r: 0.7 + Math.random() * 1.7,
        tw: Math.random() * Math.PI * 2,
        twSpd: 0.01 + Math.random() * 0.022,
        sway: Math.random() * Math.PI * 2,
        color: dustColors[Math.floor(Math.random() * dustColors.length)]
      };
    }
    function seedDust() {
      if (reduceMotion) return;
      dust = [];
      var n = window.innerWidth < 600 ? 44 : 78;
      for (var i = 0; i < n; i++) dust.push(newDust(true));
    }
    /* --- 揭幕冲击波：从中心荡开的金色细环 --- */
    function ringBurst() {
      if (reduceMotion) return;
      rings.push({ r: 16, a: .5, w: 2.6, spd: 7 });
      window.setTimeout(function () { rings.push({ r: 8, a: .32, w: 1.4, spd: 5 }); }, 240);
    }

    function animateFireworks() {
      if (!ctx) return;
      ctx.clearRect(0, 0, cw, ch);

      /* 星尘：上升 + 摇曳 + 闪烁，出屏后从底部补位 */
      for (var di = dust.length - 1; di >= 0; di--) {
        var d = dust[di];
        d.x += d.vx + Math.sin(d.sway) * 0.12;
        d.y += d.vy;
        d.sway += 0.008;
        d.tw += d.twSpd;
        if (d.y < -12) { dust[di] = newDust(false); continue; }
        if (d.x < -12) d.x = cw + 12;
        else if (d.x > cw + 12) d.x = -12;
        ctx.globalAlpha = 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(d.tw));
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      /* 冲击波：金色细环从中心荡开 */
      for (var ri = rings.length - 1; ri >= 0; ri--) {
        var rg = rings[ri];
        rg.r += rg.spd;
        rg.a *= 0.965;
        if (rg.a < 0.012) { rings.splice(ri, 1); continue; }
        ctx.globalAlpha = rg.a;
        ctx.strokeStyle = 'rgba(255, 216, 150, 1)';
        ctx.lineWidth = rg.w;
        ctx.beginPath();
        ctx.arc(cw / 2, ch * 0.42, rg.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      particles = particles.filter(function (p) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.06;
        p.vx *= 0.99;
        p.life -= p.decay;
        if (p.life <= 0) return false;
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8 * glowScale;
        return true;
      });
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      window.requestAnimationFrame(animateFireworks);
    }

    /* 收尾那行的剩余天数 */
    var cdFootDays = doc.getElementById('cdFooterDays');

    /* 数字变化时轻轻跳一下（只在值真的变了才播，避免每秒都闪） */
    function bump(el) {
      if (reduceMotion || !el) return;
      el.classList.remove('is-tick');
      void el.offsetWidth;                 /* 强制重排，让动画可以重复触发 */
      el.classList.add('is-tick');
    }

    function updateCountdown() {
      var now = new Date();
      var diff = isTest ? -1 : targetDate - now;
      var titleEl = doc.getElementById('cdTitle');
      var eyebrowEl = doc.getElementById('cdEyebrow');
      var targetEl = doc.getElementById('cdTarget');
      var containerEl = doc.getElementById('cdContainer');
      var heroEl = doc.getElementById('cdHero');
      var progressEl = doc.getElementById('cdProgress');
      var celebration = doc.getElementById('celebration');

      if (diff <= 0) {
        ['days', 'hours', 'minutes', 'seconds'].forEach(function (id) {
          var el = doc.getElementById(id);
          if (el) el.textContent = '00';
        });
        if (progressEl) progressEl.style.display = 'none';
        if (!countdownEnded) {
          countdownEnded = true;
          doc.body.classList.add('celebrating');
          if (titleEl) titleEl.textContent = '今天是2026年12月20日 · 星期日';
          if (eyebrowEl) eyebrowEl.textContent = 'Time · 一万天纪念';
          /* 揭幕编排（缓慢版）：数字卡与日期行缓缓退场 → 10000 缓缓升起 → 祝福跟上 */
          if (containerEl) containerEl.classList.add('is-out');
          if (targetEl) targetEl.classList.add('is-out');
          window.setTimeout(function () {
            if (containerEl) containerEl.style.display = 'none';
            if (targetEl) targetEl.style.display = 'none';
            if (heroEl) heroEl.classList.add('show');
            if (canvas) { resizeCanvas(); seedDust(); animateFireworks(); ringBurst(); }
          }, 900);
          window.setTimeout(function () {
            if (celebration) celebration.classList.add('show');
          }, 1900);
        }
        return;
      }

      var days = Math.floor(diff / 86400000);
      var hours = Math.floor((diff % 86400000) / 3600000);
      var minutes = Math.floor((diff % 3600000) / 60000);
      var seconds = Math.floor((diff % 60000) / 1000);
      var set = function (id, v) {
        var el = doc.getElementById(id);
        if (!el) return;
        var next = String(v).padStart(2, '0');
        if (el.textContent !== next) { el.textContent = next; bump(el); }
      };
      set('days', days); set('hours', hours); set('minutes', minutes); set('seconds', seconds);

      /* 收尾那行的剩余天数 */
      if (cdFootDays && cdFootDays.textContent !== String(days)) cdFootDays.textContent = days;
    }

    /* 点击 / 触摸放烟花（仅倒计时结束后） */
    var lastFireAt = 0;
    var skipSelector = '.back-btn, .site-header, .carousel-nav, .carousel-dots, .scroll-cue';
    function tryFireAt(x, y, target) {
      if (!countdownEnded) return;
      if (target && target.closest && target.closest(skipSelector)) return;
      var now = performance.now();
      if (now - lastFireAt < 80) return;
      lastFireAt = now;
      createFirework(x, y);
    }
    doc.addEventListener('click', function (e) { tryFireAt(e.clientX, e.clientY, e.target); });
    doc.addEventListener('touchstart', function (e) {
      if (!countdownEnded || e.touches.length > 1) return;
      var t = e.target;
      if (t.closest && t.closest(skipSelector)) return;
      tryFireAt(e.touches[0].clientX, e.touches[0].clientY, t);
      e.preventDefault();
    }, { passive: false });

    if (canvas) {
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);
      window.addEventListener('orientationchange', function () { window.setTimeout(resizeCanvas, 200); });
      /* 星尘与烟花在归零揭幕时才启动，倒计时期间不占性能 */
    }
    updateCountdown();
    /* 对齐到整秒边界再循环：数字变化更准，也不会漂移 */
    (function scheduleTick() {
      window.setTimeout(function () { updateCountdown(); scheduleTick(); },
        1000 - (Date.now() % 1000) + 15);
    })();
  }
})();
