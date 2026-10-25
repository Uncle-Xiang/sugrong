-- 戎糖小记 · 留言墙数据表（Cloudflare D1 · 库名 suggrong-contact）
-- 用法：wrangler d1 execute suggrong-contact --remote --file=./schema.sql

-- 弹幕留言：所有人可见，按时间正序放出
CREATE TABLE IF NOT EXISTS danmaku (
  id    TEXT PRIMARY KEY,
  text  TEXT NOT NULL,
  color TEXT NOT NULL,
  at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_danmaku_at ON danmaku(at DESC);

-- 频率限制：同一 IP 12 秒一条、每天 20 条
CREATE TABLE IF NOT EXISTS rate_limit (
  ip   TEXT NOT NULL,
  kind TEXT NOT NULL,           -- 'cool' | 'day'（弹幕）/ 'scool' | 'sday'（建议）
  hits INTEGER NOT NULL DEFAULT 0,
  at   INTEGER NOT NULL,
  PRIMARY KEY (ip, kind)
);

-- 建议箱：只有站长能看到，done = 1 表示已处理
CREATE TABLE IF NOT EXISTS suggest (
  id      TEXT PRIMARY KEY,
  text    TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  at      INTEGER NOT NULL,
  done    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_suggest_at ON suggest(at DESC);

-- 作品集：works.html 的数据源（公开读，站长在 admin 页增删改）
-- sort 越大越靠前；status: on = 展示 / soon = 筹备中（卡片显示徽章、不显示链接）/ off = 隐藏
-- type 分类（中文展示值，后台用 datalist 带预设但不锁死，前台筛选项由数据自动生成）
-- date 发布时间，统一 YYYY-MM-DD；空字符串 = 还没定日子（筹备中的作品）
CREATE TABLE IF NOT EXISTS works (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  kicker    TEXT NOT NULL DEFAULT '',
  summary   TEXT NOT NULL DEFAULT '',
  cover     TEXT NOT NULL DEFAULT '',
  link      TEXT NOT NULL DEFAULT '',
  link_text TEXT NOT NULL DEFAULT '',
  status    TEXT NOT NULL DEFAULT 'on',
  sort      INTEGER NOT NULL DEFAULT 0,
  at        INTEGER NOT NULL,
  updated   INTEGER NOT NULL,
  type      TEXT NOT NULL DEFAULT '',
  date      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_works_sort ON works(sort DESC, at DESC);
