-- =========================================================================
-- works 表加「首页最新发布」标记（2026-10-22）
--
-- 用法：wrangler d1 execute sugrong --remote --file=migrate-works-featured.sql --yes
--
-- featured = 1 的那一条会渲染到首页「最新发布」区块（全站只有一条，
-- 后台勾选时 Worker 会自动把其他条置 0）。默认 0。
-- =========================================================================

ALTER TABLE works ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;

-- 把现在首页写死的那条（倒计时）设成精选，迁移后视觉不变
UPDATE works SET featured = 1 WHERE id = 'w-countdown';

SELECT id, title, featured, status, sort FROM works ORDER BY sort DESC;
