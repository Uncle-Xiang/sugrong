#!/usr/bin/env bash
# =============================================================================
# 新建一个干净的 D1 库 sugrong，并让 Worker 改用它（不做数据迁移）
#
# 用法（任意目录执行都行）：
#   bash init-db-sugrong.sh                 # 建库 + 建表 + 灌 5 条作品种子 + 改 toml
#   bash init-db-sugrong.sh --no-seed       # 只要空库和表结构，不加示例作品
#   bash init-db-sugrong.sh --db-id=<uuid>  # 库已在控制台建好，只建表/灌种子/改 toml（跳过 create）
#   bash init-db-sugrong.sh --name=别的名字  # 不叫 sugrong 也行
#
# 不会动旧库 sugrong-contact，也不会删任何数据。
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

NEW_DB="sugrong"
DB_ID=""
SEED=1

for arg in "$@"; do
  case "$arg" in
    --no-seed)     SEED=0 ;;
    --db-id=*)     DB_ID="${arg#--db-id=}" ;;
    --name=*)      NEW_DB="${arg#--name=}" ;;
    *) echo "未知参数：$arg"; exit 1 ;;
  esac
done

# 默认用同目录的 ./wr（本机已装好的 wrangler），没有再退回 npx
if [ -z "${WRANGLER:-}" ]; then
  if [ -x ./wr ]; then WRANGLER="./wr"; else WRANGLER="npx wrangler"; fi
fi

# 支持把 token 放在 .cf_token（已加入 .gitignore / .assetsignore）
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -s .cf_token ]; then
  CLOUDFLARE_API_TOKEN="$(tr -d '\r\n' < .cf_token)"
  export CLOUDFLARE_API_TOKEN
  echo "已从 .cf_token 读取 API Token"
fi

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
die() { printf '\033[31m%s\033[0m\n' "$1"; exit 1; }

# ---------- 0. 环境 ----------
say "0/5 检查环境"
[ -f wrangler.toml ] || die "这里没有 wrangler.toml，脚本要放在 cloudflare/ 目录里"
[ -f schema.sql ]    || die "找不到 schema.sql"
[ -f seed-works.sql ]|| die "找不到 seed-works.sql"
$WRANGLER --version >/dev/null 2>&1 || die "wrangler 跑不起来（./wr 或 npx wrangler 报错？）"
echo "wrangler → $($WRANGLER --version 2>/dev/null | tail -1)"

# ---------- 1. 建库 ----------
say "1/5 准备数据库 $NEW_DB"
if [ -n "$DB_ID" ]; then
  echo "沿用你给的 database_id：$DB_ID（不再执行 d1 create）"
else
  OUT="$($WRANGLER d1 create "$NEW_DB" 2>&1 || true)"
  printf '%s\n' "$OUT"
  DB_ID="$(printf '%s' "$OUT" | sed -n 's/.*database_id *= *"\([^"]*\)".*/\1/p' | head -1)"
  if printf '%s' "$OUT" | grep -qiE "CLOUDFLARE_API_TOKEN|not authenticated|Authentication error"; then
    die "还没登录：先执行 ./wr login（或把 token 写进 .cf_token），再重跑本脚本"
  fi
  if [ -z "$DB_ID" ]; then
    echo
    echo "没拿到 database_id。通常是这个库名已经存在（D1 不允许重名）。"
    echo "两个办法："
    echo "  1) 换个名字：bash init-db-sugrong.sh --name=${NEW_DB}2"
    echo "  2) 用控制台里已有的库：./wr d1 list 找到 id，再 --db-id=<uuid>"
    exit 1
  fi
  echo "新库 database_id：$DB_ID"
fi

# 后续所有 d1 操作都直接对着 database_id（Cloudflare 的 /d1/database/{id|name}
# 两种都认），这样即使控制台里库名和 --name 不一致也不会「找不到库」
TARGET="$DB_ID"

# ---------- 2. 建表 ----------
say "2/5 建表（schema.sql：danmaku / suggest / works / rate_limit）"
$WRANGLER d1 execute "$TARGET" --remote --file=schema.sql --yes

# ---------- 3. 种子 ----------
if [ "$SEED" = "1" ]; then
  say "3/5 灌入 5 条作品种子（seed-works.sql，INSERT OR REPLACE，可重复执行）"
  $WRANGLER d1 execute "$TARGET" --remote --file=seed-works.sql --yes
else
  say "3/5 跳过种子（--no-seed）"
fi

# ---------- 4. 自检 ----------
say "4/5 自检新库"
$WRANGLER d1 execute "$TARGET" --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" || true
$WRANGLER d1 execute "$TARGET" --remote --command \
  "SELECT 'danmaku' t, COUNT(*) n FROM danmaku
   UNION ALL SELECT 'suggest', COUNT(*) FROM suggest
   UNION ALL SELECT 'works', COUNT(*) FROM works
   UNION ALL SELECT 'rate_limit', COUNT(*) FROM rate_limit;" || true

# ---------- 5. 改配置 ----------
say "5/5 把 Worker 的绑定改到新库（wrangler.toml）"
if grep -q "database_id = \"${DB_ID}\"" wrangler.toml 2>/dev/null; then
  echo "wrangler.toml 已经指向 ${DB_ID}，不用改"
  grep -nE 'database_name|database_id' wrangler.toml
else
STAMP="$(date +%Y%m%d-%H%M%S)"
cp wrangler.toml "wrangler.toml.bak-${STAMP}"
sed -i \
  -e "s/database_name *= *\"[^\"]*\"/database_name = \"${NEW_DB}\"/" \
  -e "s/database_id *= *\"[^\"]*\"/database_id = \"${DB_ID}\"/" \
  -e "s|^# 留言墙数据库：.*|# 留言墙数据库：${NEW_DB}（uuid ${DB_ID}）|" \
  wrangler.toml
grep -nE '留言墙数据库|database_name|database_id' wrangler.toml
echo "原配置已备份为 wrangler.toml.bak-${STAMP}"
fi

cat <<EOF

下一步：
  1) 部署：              ./wr deploy
  2) 接口自检：          curl -s -o /dev/null -w "%{http_code}\\n" https://www.sugrong.com/api
                         （200 = 新代码在线；改库前是 404）
  3) 作品页：            https://www.sugrong.com/works.html
  4) 后台（密码不变）：  https://www.sugrong.com/admin.html
  5) 旧的 sugrong-contact 没动，确认新库跑稳后再考虑要不要删：
       ./wr d1 delete sugrong-contact --skip-confirmation
EOF
