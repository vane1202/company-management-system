#!/usr/bin/env bash
# 在隔离数据库上执行一次备份归档恢复演练并核对核心业务表行数。
# 严禁指向生产库或演示库（cms_demo / 15433）。
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "用法: TEST_ADMIN_URL=postgres://... bash scripts/verify-backup-restore.sh <dump_file>" >&2
  exit 1
fi

DUMP_FILE="$1"
if [[ ! -f "$DUMP_FILE" ]]; then
  echo "归档不存在: $DUMP_FILE" >&2
  exit 1
fi

ADMIN_URL="${TEST_ADMIN_URL:-}"
VERIFY_DB="${VERIFY_DB_NAME:-cms_restore_verify}"
if [[ -z "$ADMIN_URL" ]]; then
  echo "请设置 TEST_ADMIN_URL（指向隔离 PostgreSQL 的维护库，例如 postgres://postgres@127.0.0.1:16542/postgres）" >&2
  exit 1
fi

if [[ "$ADMIN_URL" == *":15433/"* || "$ADMIN_URL" == *"/cms_demo"* || "$VERIFY_DB" == "cms" || "$VERIFY_DB" == "cms_demo" ]]; then
  echo "拒绝在生产库或演示库上执行恢复演练" >&2
  exit 1
fi

if [[ ! "$VERIFY_DB" =~ ^[a-z0-9_]+$ ]]; then
  echo "VERIFY_DB_NAME 格式无效: $VERIFY_DB" >&2
  exit 1
fi

BASE_URL="${ADMIN_URL%/*}"
TARGET_URL="$BASE_URL/$VERIFY_DB"

pg_restore --list "$DUMP_FILE" >/dev/null
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $VERIFY_DB;"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $VERIFY_DB;"

cleanup() {
  psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS $VERIFY_DB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

pg_restore --no-owner --no-acl -d "$TARGET_URL" "$DUMP_FILE"

psql "$TARGET_URL" -v ON_ERROR_STOP=1 -c "
SELECT 'users' AS table_name, count(*) AS row_count FROM users
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'customer_payments', count(*) FROM customer_payments
UNION ALL SELECT 'order_expenses', count(*) FROM order_expenses
UNION ALL SELECT 'warehouse_bills', count(*) FROM warehouse_bills
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs;
"

echo "隔离恢复演练通过: $DUMP_FILE"
