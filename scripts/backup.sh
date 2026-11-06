#!/usr/bin/env bash
# 导出本地/内测数据库快照。本脚本只做明文 pg_dump。
# 当前仓库未配置加密、密钥管理和对象存储上传，因此不能声称「已启用加密备份」。
set -euo pipefail
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "请设置 DATABASE_URL" >&2
  exit 1
fi
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/cms-$STAMP.sql.gz"
pg_dump "$DATABASE_URL" | gzip > "$FILE"
echo "已写入 $FILE （未加密，请自行离线保护）"
