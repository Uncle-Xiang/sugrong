/* =========================================================================
   戎糖小记 · 留言墙 / 建议箱 Worker（Cloudflare Worker + D1，库 suggrong-contact）

   路由（OPTIONS 预检一律放行）：
     GET    /api/danmaku          最近 200 条弹幕，公开
     POST   /api/danmaku          发一条；服务端校验 + 限流（同 IP 12 秒一条、
                                 每天 20 条），色值只认白名单里的五个
     DELETE /api/danmaku?id=xxx   删一条；需要请求头 x-danmaku-admin 带上
                                 ADMIN_TOKEN（用 wrangler secret put 设置）

    POST   /api/suggest          提建议；访客可写，限流（同 IP 12 秒一条、
                                 每天 10 条）；联系方式选填
    GET    /api/suggest          建议列表；仅管理员（x-danmaku-admin）
    POST   /api/suggest/done     标记已处理 / 取消；仅管理员，body {id, done}
    DELETE /api/suggest?id=xxx   删一条建议；仅管理员

    GET    /api/works            作品列表，公开：只出 status = on / soon 的
                                 申请头带对 x-danmaku-admin 时连带把隐藏的也返回
    POST   /api/works            新增作品；仅管理员
    PUT    /api/works            改作品；仅管理员，body 里带 id
    DELETE /api/works?id=xxx     删作品；仅管理员

   部署（cloudflare/ 目录下）：
     npx wrangler deploy
   自定义域名 api.sugrong.com 已在 wrangler.toml 里配好，
   国内访问比 *.workers.dev 稳。
   ========================================================================= */

const MAX_UPLOAD = 8 * 1024 * 1024;                   /* 单张图上限 8 MB（Workers 请求体上限远大于此） */
const IMG_HOST = 'https://img.sugrong.com';         /* R2 桶的自定义域，上传完拼成完整地址 */

const MAX_LEN = 40;                                  /* 弹幕最多 40 个字符（emoji 算 1 个） */
const MAX_LIST = 200;                                /* 弹幕最多回最近 200 条 */
const SUGGEST_MAX = 300;                             /* 建议最多 300 个字符 */
const CONTACT_MAX = 60;                              /* 联系方式最多 60 个字符 */
/* 颜色：预设色 + 颜色盘任选色都收，不再用固定白名单。
   浅粉 / 白底上「太浅看不清」的颜色按比例压暗，保证对比度 ≥ 4.5:1，
   算法与前端 js/contact.js 的 deepen() 完全一致。 */
const DEFAULT_COLOR = '#1f1f1f';                     /* 和前端预设色第一个（墨黑）一致 */
const MAX_LUM = 0.1833;                              /* 白底 4.5:1 对应的最大相对亮度 */
function chan(v) { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
function lum(r, g, b) { return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b); }
function normalizeColor(raw) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(raw == null ? '' : raw).trim());
  if (!m) return DEFAULT_COLOR;                      /* 不是合法 hex：用默认色 */
  const n = parseInt(m[1], 16);
  const r0 = (n >> 16) & 255, g0 = (n >> 8) & 255, b0 = n & 255;
  let r = r0, g = g0, b = b0, f = 1;
  while (lum(r, g, b) > MAX_LUM && f > 0.0625) {      /* 保色相、只降明度 */
    f *= 0.9;
    r = Math.round(r0 * f); g = Math.round(g0 * f); b = Math.round(b0 * f);
  }
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
const COOL_MS = 12000;                               /* 发言冷却 12 秒 */
const DAY_MS = 24 * 3600 * 1000;

/* 留言墙本身是公开可写的，敏感操作（删留言 / 看建议）只认 ADMIN_TOKEN，不靠 CORS，
   所以这里对所有来源一律回 *：本地预览 / file:// / 任何端口都不会被拦。 */
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-danmaku-admin',
    'Access-Control-Max-Age': '86400'
  };
}

/* 访客走错地址时给的 404 页：样式自带、不依赖外部文件，浅色 + 站点的珊瑚粉。
   只有「非 /api 路径」才用它，接口仍然返回 JSON，调用方不用改。 */
function notFoundPage() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>页面走丢了 · 戎糖小记</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    padding: 24px; text-align: center;
    background: radial-gradient(120% 90% at 50% 0%, #fff2f4 0%, #fff8f9 55%, #fff 100%);
    color: #4a3b3d;
    font-family: ui-rounded, "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
  }
  .box { max-width: 30em; }
  .code {
    margin: 0; font-size: clamp(64px, 14vw, 108px); line-height: 1; letter-spacing: .04em;
    background: linear-gradient(120deg, #ff9eb5 0%, #ff7d9d 45%, #ff6b6b 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  h1 { margin: 18px 0 10px; font-size: clamp(20px, 3vw, 26px); font-weight: 600; }
  p { margin: 0 0 26px; font-size: 15px; line-height: 1.8; color: #7c6b6e; }
  a {
    display: inline-block; padding: 12px 26px; border-radius: 999px;
    background: linear-gradient(120deg, #ff9eb5, #ff6b6b); color: #fff;
    text-decoration: none; font-size: 15px; font-weight: 600;
    box-shadow: 0 10px 24px rgba(255, 107, 107, .28);
  }
  a:active { transform: translateY(1px); }
</style>
</head>
<body>
  <div class="box">
    <p class="code">404</p>
    <h1>这一页走丢了</h1>
    <p>地址可能敲错了，或者这个页面还没做出来。<br>回小站继续逛逛吧。</p>
    <a href="https://www.sugrong.com/">回到首页</a>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors())
  });
}

/* 清洗：去链接 / 控制字符 / 连续重复字，再把空白压成一个空格 */
function clean(text) {
  return String(text == null ? '' : text)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/(.)\1{7,}/g, '$1$1$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/* 联系方式不清链接（可能是个人主页），只去控制字符 */
function cleanContact(text) {
  return String(text == null ? '' : text)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* 按「字符」截断，不会把 emoji 的代理对切成半边 */
function clip(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/* CF 边缘会把真实客户端 IP 放在这个头里 */
function ipOf(request) {
  return request.headers.get('CF-Connecting-IP') || '0.0.0.0';
}

/* ==================== 作品集：字段清洗 ====================
   这些字段最终会回到 works.html 的 DOM 里，前端也会再校验一遍；
   这里守住服务端这道：长度 + 换行 + 链接协议，避免把 javascript: 之类的东西存进去 */
const WORK_TITLE_MAX = 40;
const WORK_KICKER_MAX = 40;
const WORK_SUMMARY_MAX = 200;
const WORK_TEXT_MAX = 20;
const WORK_TYPE_MAX = 12;                                 /* 分类名最多 12 个字 */
const WORK_DATE_MAX = 10;                                 /* YYYY-MM-DD */
/* 分类不做白名单：后台用 datalist 带预设（见 admin.html），填别的值也照存，
   前台筛选项由 GET 返回的数据自动生成，所以加 / 删分类都不用改这里 */

/* 分类：纯文本，去空白 */
function workType(raw) {
  return plain(raw, WORK_TYPE_MAX).replace(/\s+/g, '');
}

/* 时间：只认 YYYY-MM-DD / YYYY-MM，统一补成 YYYY-MM-DD；认不出来的当没填 */
function workDate(raw) {
  const m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(String(raw == null ? '' : raw).trim());
  if (!m) return '';
  const y = m[1], mo = m[2].padStart(2, '0'), d = (m[3] || '01').padStart(2, '0');
  /* 顺手挡一下 13 月 45 号这种 */
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return '';
  return y + '-' + mo + '-' + d;
}

/* 纯文本：去控制字符、压空白，但保留换行（作品简介支持两行） */
function plain(text, max) {
  const s = String(text == null ? '' : text)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')   /* 保留 \n \t，后者下一步压成空格 */
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return max ? clip(s, max) : s;
}

/* 图片：允许站内相对路径（assets/xxx.jpg）或 http(s) 直链；没了就空字符串 */
function coverUrl(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^[\w.\-/]+\.(jpe?g|png|webp|gif|avif|svg)$/i.test(s) && !/^\.{2}|:\/\//.test(s)) return s;
  return '';
}

/* 跳转链接：允许站内页面（time.html / index.html#x）或 http(s) 外链 */
function pageUrl(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^[\w.\-/]+\.html(#[^\s"'<>]*)?$/i.test(s) && !/^\.{2}|:\/\//.test(s)) return s;
  return '';
}

function statusOf(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return s === 'on' || s === 'soon' || s === 'off' ? s : 'on';
}

function sortOf(raw) {
  const n = parseInt(raw, 10);
  if (isNaN(n)) return 0;
  return Math.max(-9999, Math.min(9999, n));
}

/* 把请求体翻译成一列干净字段。
   partial = true 时只认传上来的键，并额外给出 SET 子句与参数（供 UPDATE 用） */
/* 「首页最新发布」标记：全站只有一条。只有明确传 1 / '1' / true 才算勾上，
   其它一律 0 —— 后台是个 checkbox，序列化出来就是 true/false。 */
function featuredOf(v) {
  return (v === 1 || v === '1' || v === true) ? 1 : 0;
}

/* 「首页最近文章」开关：只有明确传 0/false 才算不上首页，没传就是 1，
   这样迁移前的老数据不会从首页消失 */
function recentOf(v) {
  if (v === undefined || v === null || v === '') return 1;
  return (v === 0 || v === '0' || v === false) ? 0 : 1;
}

function parseWork(body, partial) {
  const b = body || {};
  const has = function (k) { return Object.prototype.hasOwnProperty.call(b, k); };

  const title = plain(b.title, WORK_TITLE_MAX);
  if (!title && (!partial || has('title'))) return null;

  const all = {
    title: title,
    kicker: plain(b.kicker, WORK_KICKER_MAX),
    summary: plain(b.summary, WORK_SUMMARY_MAX),
    cover: coverUrl(b.cover),
    link: pageUrl(b.link),
    linkText: plain(b.link_text, WORK_TEXT_MAX),
    status: statusOf(b.status),
    sort: sortOf(b.sort),
    type: workType(b.type),
    date: workDate(b.date),
    featured: featuredOf(b.featured),
    recent: recentOf(b.recent)
  };

  if (!partial) return all;

  /* 只挑本次真的传了的字段 */
  const set = [], vals = [];
  Object.keys(all).forEach(function (k) {
    const key = { linkText: 'link_text' }[k] || k;
    if (has(k) || has(key)) { set.push(key + ' = ?'); vals.push(all[k]); }
  });
  if (!set.length) return { title: all.title, _set: '', _vals: [], _n: 0 };
  return Object.assign(all, { _set: set.join(', '), _vals: vals, _n: set.length });
}

function dictWork(row, fields) {
  return Object.assign({
    id: row.id, at: row.at, updated: row.updated
  }, fields);
}

function isAdmin(request, env) {
  const token = request.headers.get('x-danmaku-admin');
  return !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

/* 限流：cool = 冷却，day = 每日额度。校验放在调用之前做，空内容不消耗额度。
   kinds 由调用方给（弹幕 cool/day，建议 scool/sday）。 */
async function rateLimit(env, ip, coolKind, dayKind, dayLimit) {
  const now = Date.now();

  const cool = await env.DB.prepare(
    'SELECT hits, at FROM rate_limit WHERE ip = ? AND kind = ?'
  ).bind(ip, coolKind).first();
  if (cool && now - cool.at < COOL_MS) {
    return { ok: false, wait: Math.ceil((COOL_MS - (now - cool.at)) / 1000) };
  }

  const day = await env.DB.prepare(
    'SELECT hits, at FROM rate_limit WHERE ip = ? AND kind = ?'
  ).bind(ip, dayKind).first();
  const fresh = !day || now - day.at >= DAY_MS;
  if (!fresh && day.hits >= dayLimit) {
    return { ok: false, exhausted: true };
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO rate_limit (ip, kind, hits, at) VALUES (?, ?, 1, ?)
       ON CONFLICT(ip, kind) DO UPDATE SET hits = 1, at = excluded.at`
    ).bind(ip, coolKind, now),
    env.DB.prepare(
      `INSERT INTO rate_limit (ip, kind, hits, at) VALUES (?, ?, 1, ?)
       ON CONFLICT(ip, kind) DO UPDATE SET
         hits = CASE WHEN excluded.at - at >= ${DAY_MS} OR hits = 0 THEN 1 ELSE hits + 1 END,
         at = excluded.at`
    ).bind(ip, dayKind, now)
  ]);
  return { ok: true };
}

const worker = {
  /* 统一入口：包一层 try/catch。
     D1 连不上时（库被删、绑定 id 写错、超配额、网络抖动）Worker 会抛异常，
     Cloudflare 直接返回 `error code: 1101` 的 HTML 错误页 —— 前端拿不到 JSON，
     解析失败后连「离线兜底」都进不去。这里统一兜成 JSON 503，
     作品页的静态卡片兜底、留言墙的本地模式才能照常生效。 */
  async fetch(request, env) {
    try {
      return await worker.handle(request, env);
    } catch (err) {
      console.error('worker error:', (err && err.stack) || err);
      return json({ ok: false, error: '数据库暂时不可用，稍后再试' }, 503);
    }
  },

  async handle(request, env) {
    const url = new URL(request.url);

    /* 预检：不带 token 也放行 */
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }

    /* 接口自述：直接敲 /api 时给清单，别让人看到裸 404（网页在 www.sugrong.com） */
    if (url.pathname === '/api' || url.pathname === '/api/') {
      return json({
        ok: true,
        service: '戎糖小记 · 接口',
        site: 'https://www.sugrong.com',
        endpoints: [
          'GET  /api/danmaku',
          'POST /api/danmaku',
          'GET  /api/suggest        （需要 x-danmaku-admin）',
          'POST /api/suggest',
          'PUT  /api/suggest/done   （需要 x-danmaku-admin）',
          'DELETE /api/suggest?id=  （需要 x-danmaku-admin）',
          'GET  /api/works',
          'POST /api/works         （需要 x-danmaku-admin）',
          'PUT  /api/works?id=     （需要 x-danmaku-admin）',
          'DELETE /api/works?id=   （需要 x-danmaku-admin）'
        ]
      });
    }

    /* ==================== 弹幕墙 ==================== */
    if (url.pathname === '/api/danmaku') {
      /* 读：最近 200 条，正序返回 */
      if (request.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT id, text, color, at FROM (
             SELECT id, text, color, at FROM danmaku ORDER BY at DESC LIMIT ${MAX_LIST}
           ) ORDER BY at ASC`
        ).all();
        return json({ ok: true, items: results || [] });
      }

      /* 写：校验 → 限流 → 入库 */
      if (request.method === 'POST') {
        let body;
        try { body = await request.json(); }
        catch (e) { return json({ ok: false, error: '请求体不是 JSON' }, 400); }

        const text = clip(clean(body && body.text), MAX_LEN);
        if (!text) return json({ ok: false, error: '内容为空' }, 400);

        const color = normalizeColor(body && body.color);
        const ip = ipOf(request);

        const limit = await rateLimit(env, ip, 'cool', 'day', 20);
        if (!limit.ok) {
          return limit.exhausted
            ? json({ ok: false, error: '今天发得够多啦，明天再来～' }, 429)
            : json({ ok: false, error: '慢一点，' + (limit.wait || 1) + ' 秒后再发一条' }, 429);
        }

        const id = 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
        await env.DB.prepare(
          'INSERT INTO danmaku (id, text, color, at) VALUES (?, ?, ?, ?)'
        ).bind(id, text, color, Date.now()).run();

        return json({ ok: true, id: id });
      }

      /* 删：仅站长 */
      if (request.method === 'DELETE') {
        if (!isAdmin(request, env)) return json({ ok: false, error: '没有权限' }, 401);
        const id = url.searchParams.get('id');
        if (!id) return json({ ok: false, error: '缺少 id' }, 400);

        await env.DB.prepare('DELETE FROM danmaku WHERE id = ?').bind(id).run();
        return json({ ok: true });
      }

      return json({ ok: false, error: '方法不允许' }, 405);
    }

    /* ==================== 建议箱 ==================== */
    if (url.pathname === '/api/suggest') {
      /* 访客提交：校验 → 限流 → 入库 */
      if (request.method === 'POST') {
        let body;
        try { body = await request.json(); }
        catch (e) { return json({ ok: false, error: '请求体不是 JSON' }, 400); }

        const text = clip(clean(body && body.text), SUGGEST_MAX);
        if (!text) return json({ ok: false, error: '建议不能为空' }, 400);

        const contact = clip(cleanContact(body && body.contact), CONTACT_MAX);
        const ip = ipOf(request);

        const limit = await rateLimit(env, ip, 'scool', 'sday', 10);
        if (!limit.ok) {
          return limit.exhausted
            ? json({ ok: false, error: '今天提得够多啦，明天再来～' }, 429)
            : json({ ok: false, error: '慢一点，' + (limit.wait || 1) + ' 秒后再提一条' }, 429);
        }

        const id = 's' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
        await env.DB.prepare(
          'INSERT INTO suggest (id, text, contact, at, done) VALUES (?, ?, ?, ?, 0)'
        ).bind(id, text, contact, Date.now()).run();

        return json({ ok: true, id: id });
      }

      /* 以下都是管理员操作 */
      if (!isAdmin(request, env)) return json({ ok: false, error: '没有权限' }, 401);

      /* 列表：全部建议，新的在前 */
      if (request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, text, contact, at, done FROM suggest ORDER BY at DESC LIMIT 500'
        ).all();
        return json({ ok: true, items: results || [] });
      }

      /* 删除 */
      if (request.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!id) return json({ ok: false, error: '缺少 id' }, 400);
        await env.DB.prepare('DELETE FROM suggest WHERE id = ?').bind(id).run();
        return json({ ok: true });
      }

      return json({ ok: false, error: '方法不允许' }, 405);
    }

    /* ==================== 建议箱：标记已处理 ==================== */
    if (url.pathname === '/api/suggest/done') {
      if (!isAdmin(request, env)) return json({ ok: false, error: '没有权限' }, 401);
      if (request.method !== 'POST') return json({ ok: false, error: '方法不允许' }, 405);

      let body;
      try { body = await request.json(); }
      catch (e) { return json({ ok: false, error: '请求体不是 JSON' }, 400); }

      const id = body && body.id;
      if (!id) return json({ ok: false, error: '缺少 id' }, 400);
      const done = body && body.done ? 1 : 0;

      await env.DB.prepare('UPDATE suggest SET done = ? WHERE id = ?').bind(done, id).run();
      return json({ ok: true });
    }

    /* ==================== 图片上传（R2） ====================
       只有站长能用（x-danmaku-admin）。请求体就是文件本身（raw body），
       格式靠 Content-Type 判断，键名自带随机串，所以内容永不覆盖、可以长缓存。
       返回 img.sugrong.com 的完整地址，后台直接填进「封面」。 */
    if (url.pathname === '/api/upload') {
      if (request.method !== 'PUT' && request.method !== 'POST') {
        return json({ ok: false, error: '方法不允许' }, 405);
      }
      if (!isAdmin(request, env)) return json({ ok: false, error: '没有权限' }, 401);
      if (!env.sugrong || typeof env.sugrong.put !== 'function') {
        return json({ ok: false, error: 'R2 桶没绑定：wrangler.toml 里要有 [[r2_buckets]]' }, 503);
      }

      const ALLOWED = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/avif': 'avif'
      };
      const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const ext = ALLOWED[type];
      if (!ext) return json({ ok: false, error: '只收 jpg / png / webp / gif / avif' }, 415);

      const declared = Number(request.headers.get('content-length') || 0);
      if (declared > MAX_UPLOAD) {
        return json({ ok: false, error: '单张图别超过 ' + (MAX_UPLOAD / 1048576) + ' MB' }, 413);
      }
      const buf = await request.arrayBuffer();
      if (!buf || !buf.byteLength) return json({ ok: false, error: '文件是空的' }, 400);
      if (buf.byteLength > MAX_UPLOAD) {
        return json({ ok: false, error: '单张图别超过 ' + (MAX_UPLOAD / 1048576) + ' MB' }, 413);
      }

      /* 文件名：前端可以用 ?name= 指定（后台那个「文件名」输入框），不传就用 up-<时间戳>。
         先把路径分隔符、控制字符、URL 危险字符都换成 '-'，长度截到 60，
         扩展名以 Content-Type 为准（不信任用户填的）。
         同名已存在时自动加 -2 / -3 …，**绝不覆盖**——图是 1 年 immutable 缓存，
         覆盖了老访客看到的还是旧图。 */
      let rawName = '';
      try { rawName = decodeURIComponent(url.searchParams.get('name') || ''); }
      catch (e) { rawName = url.searchParams.get('name') || ''; }
      let base = String(rawName || '')
        .replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 60);
      if (!base) base = 'up-' + Date.now().toString(36);

      let key = 'assets/' + base + '.' + ext;
      let n = 2;
      while (await env.sugrong.head(key)) {
        key = 'assets/' + base + '-' + n + '.' + ext;
        if (++n > 20) { key = 'assets/' + base + '-' + Date.now().toString(36) + '.' + ext; break; }
      }

      await env.sugrong.put(key, buf, {
        httpMetadata: {
          contentType: type,
          cacheControl: 'public, max-age=31536000, immutable'
        }
      });
      return json({ ok: true, key: key, size: buf.byteLength, url: IMG_HOST + '/' + key });
    }

    /* ==================== 作品集（works.html 的数据源） ==================== */
if (url.pathname === '/api/works') {
  const admin = isAdmin(request, env);

  /* 读：公开只出展示中的；管理员（带对 header）连隐藏的一起看，方便在后台改草稿 */
  if (request.method === 'GET') {
    const cols = 'id, title, kicker, summary, cover, link, link_text, status, sort, at, updated, type, date, featured, recent';
    const where = admin ? '' : " WHERE status IN ('on','soon')";
    let results;
    try {
      const r = await env.DB.prepare(`SELECT ${cols} FROM works${where} ORDER BY sort DESC, at DESC LIMIT 300`).all();
      results = r.results;
    } catch (e) {
      /* recent 列还没加上（迁移没跑）时退回旧字段，别让整个接口挂掉；
         前端对「没有 recent」的处理是按 1 算，页面视觉不变 */
      const legacy = 'id, title, kicker, summary, cover, link, link_text, status, sort, at, updated, type, date, featured';
      const r = await env.DB.prepare(`SELECT ${legacy} FROM works${where} ORDER BY sort DESC, at DESC LIMIT 300`).all();
      results = r.results;
    }
    return json({ ok: true, items: results || [] });
  }

  /* 以下写操作全部要令牌 */
  if (!admin) return json({ ok: false, error: '没有权限' }, 401);

  let body = {};
  if (request.method === 'POST' || request.method === 'PUT') {
    try { body = await request.json(); }
    catch (e) { return json({ ok: false, error: '请求体不是 JSON' }, 400); }
  }

  /* 新增 */
  if (request.method === 'POST') {
    const fields = parseWork(body);
    if (!fields) return json({ ok: false, error: '标题不能为空' }, 400);

    const id = 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO works (id, title, kicker, summary, cover, link, link_text, status, sort, at, updated, type, date, featured, recent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, fields.title, fields.kicker, fields.summary, fields.cover,
           fields.link, fields.linkText, fields.status, fields.sort, now, now,
           fields.type, fields.date, fields.featured, fields.recent).run();
    /* 首页最新发布只能有一条：勾了这条就把别的都取消 */
    if (fields.featured) {
      await env.DB.prepare('UPDATE works SET featured = 0 WHERE id != ?').bind(id).run();
    }
    return json({ ok: true, id: id, item: dictWork({ id: id, at: now, updated: now }, fields) });
  }

  /* 修改：只改传上来的字段，其余保持原样 */
  if (request.method === 'PUT') {
    const id = String((body && body.id) || '').trim();
    if (!id) return json({ ok: false, error: '缺少 id' }, 400);

    const row = await env.DB.prepare('SELECT id FROM works WHERE id = ?').bind(id).first();
    if (!row) return json({ ok: false, error: '没有这件作品' }, 404);

    const fields = parseWork(body, true);
    if (!fields) return json({ ok: false, error: '字段不合法' }, 400);
    if (fields._n === 0) return json({ ok: false, error: '没有要改的字段' }, 400);

    /* 注意 bind() 是可变参数，不接受数组：更新字段个数不固定，要用扩展运算符摊开 */
    await env.DB.prepare(
      `UPDATE works SET ${fields._set} , updated = ? WHERE id = ?`
    ).bind(...fields._vals.concat([Date.now(), id])).run();
    if (fields.featured === 1) {
      await env.DB.prepare('UPDATE works SET featured = 0 WHERE id != ?').bind(id).run();
    }
    return json({ ok: true, id: id });
  }

  /* 删除 */
  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return json({ ok: false, error: '缺少 id' }, 400);
    await env.DB.prepare('DELETE FROM works WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: '方法不允许' }, 405);
}

    /* 路径走错：给访客一个能看的 404 页面；/api/* 仍然返回 JSON */
    if (url.pathname.indexOf('/api/') !== 0 && url.pathname !== '/api') return notFoundPage();
    return json({ ok: false, error: 'Not Found' }, 404);
  }
};

export default worker;
