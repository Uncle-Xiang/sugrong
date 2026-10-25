-- =========================================================================
-- works 表加「首页最近文章」开关（2026-10-23）
--
-- 用法：wrangler d1 execute sugrong --remote --file=migrate-works-recent.sql --yes
--
-- recent = 1 的条目会出现在首页「最近文章」区块（顺序仍按 sort 倒序）；
-- 后台「作品集」里每题都多一个勾选框，取消勾选就不在首页出现（作品页不受影响）。
-- 默认 1：迁移后所有现有作品照旧出现在首页，视觉不变；已隐藏(off)的默认排除。
-- =========================================================================

ALTER TABLE works ADD COLUMN recent INTEGER NOT NULL DEFAULT 1;

UPDATE works SET recent = 0 WHERE status = 'off';

SELECT id, title, status, sort, featured, recent FROM works ORDER BY sort DESC;
