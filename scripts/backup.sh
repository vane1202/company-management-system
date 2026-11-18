#!/usr/bin/env bash
# 导出 PostgreSQL 自定义格式归档（pg_dump -Fc）并执行 pg_restore --list 校验。
# 如需异机副本或云存储同步，请在脚本外通过独立凭据将归档同步到外部存储。
set -euo pipefail
umask 077

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "请设置 DATABASE_URL" >&2
  exit 1
fi

OUT_DIR="${1:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="$OUT_DIR/cms-$STAMP.dump"
TMP_FILE="$DUMP_FILE.tmp"

trap 'rm -f "$TMP_FILE"' EXIT

pg_dump -Fc --no-owner --no-acl -f "$TMP_FILE" "$DATABASE_URL"
pg_restore --list "$TMP_FILE" >/dev/null
mv "$TMP_FILE" "$DUMP_FILE"
chmod 600 "$DUMP_FILE"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$DUMP_FILE" > "$DUMP_FILE.sha256"
  chmod 600 "$DUMP_FILE.sha256"
fi

if [[ -n "${BACKUP_EXTRA_PATHS:-}" ]]; then
  EXTRA_ARCHIVE="$OUT_DIR/cms-files-$STAMP.tar.gz"
  IFS=':' read -r -a extra_items <<< "$BACKUP_EXTRA_PATHS"
  existing_items=()
  for item in "${extra_items[@]}"; do
    if [[ -e "$item" ]]; then
      existing_items+=("$item")
    fi
  done
  if [[ ${#existing_items[@]} -gt 0 ]]; then
    tar -czf "$EXTRA_ARCHIVE" "${existing_items[@]}"
    chmod 600 "$EXTRA_ARCHIVE"
  fi
fi

if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && [[ "$RETENTION_DAYS" -gt 0 ]]; then
  find "$OUT_DIR" -maxdepth 1 -type f \( -name 'cms-*.dump' -o -name 'cms-*.dump.sha256' -o -name 'cms-files-*.tar.gz' \) -mtime +"$RETENTION_DAYS" -delete
fi

echo "已写入并通过目录校验: $DUMP_FILE"
