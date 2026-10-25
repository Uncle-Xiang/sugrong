-- 戎糖小记 · 作品集初始数据（5 条，对应 works.html 最早那 5 张卡）
-- 用法：wrangler d1 execute sugrong --remote --file=./seed-works.sql --yes
-- 说明：
--   · INSERT OR REPLACE，重复执行不会造出重复行（id 是主键）；
--   · SQLite 不认 '\n' 反斜杠转义，换行要用 char(10) 拼；
--   · cover 用 R2 的图片域名（img.sugrong.com，键名与站内 assets/ 一致），
--     想换回站内路径就把前缀去掉；
--   · type / date 是筛选维度：date 统一 YYYY-MM-DD，空串表示「还没定日子」，
--     type 留空串的作品不会在前台生成筛选项。

INSERT OR REPLACE INTO works
  (id, title, kicker, summary, cover, link, link_text, status, sort, at, updated, type, date)
VALUES
  ('w-countdown', '倒计时', 'Page · 互动页面',
   '秘密' || char(10) || '期待那一天的到来...',
   'https://img.sugrong.com/assets/gd1.jpg', 'time.html', '打开页面', 'on', 50,
   CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000,
   '互动页面', '2026-10-21'),

  ('w-daily', '日常记录篇', 'Notes · 日常记录',
   '把一天里最想留住的那个瞬间写下来，配上当时的光线。',
   'https://img.sugrong.com/assets/gd2.jpg', 'https://mp.weixin.qq.com/s/Ydptq01KOBoXR7nXBdMh0Q', '阅读文章', 'on', 40,
   CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000,
   '日常记录', '2024-05-18'),

  ('w-festival', '节日记事篇', 'Festival · 节日记录',
   '古韵不只在千年传说，也在粽叶飘香时温柔的那一瞬间。',
   'https://img.sugrong.com/assets/gd3.jpg', 'https://mp.weixin.qq.com/s/G9l5XR7qGsJamSHsWNJnXw', '阅读文章', 'on', 30,
   CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000,
   '节日记录', '2024-06-10'),

  ('w-birthday', '生日纪念篇', 'Birthday · 生日记录',
   '成长不只在悄然发生，也在举杯庆贺时闪闪发光的瞬间。',
   'https://img.sugrong.com/assets/gd4.jpg', 'https://mp.weixin.qq.com/s/bEFJzfNgTC4qrh-viOcD5w', '阅读文章', 'on', 20,
   CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000,
   '生日记录', '2024-07-26'),

  ('w-coming', '敬请期待', 'Coming · 未完待续',
   '新的图文正在慢慢长大，做好了就会放到这里来。',
   'https://img.sugrong.com/assets/gd5.jpg', '', '', 'soon', 10,
   CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000,
   '', '');

SELECT id, title, type, date, status, sort FROM works ORDER BY sort DESC;
