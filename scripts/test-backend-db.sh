#!/usr/bin/env bash
# Runs the backend database integration suites, each against its own isolated test database.
#
# Requires a throwaway PostgreSQL on 127.0.0.1:16542 (never the business or demo database).
# Quick start with Docker:
#   docker run -d --name cms-test-pg -p 127.0.0.1:16542:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
# Then:  PGUSER=postgres bash scripts/test-backend-db.sh
#
# The suites TRUNCATE tables, so each one refuses to start unless its database name and port match.
set -euo pipefail

HOST=127.0.0.1
PORT=16542
USER_NAME="${PGUSER:-postgres}"
cd "$(dirname "$0")/../backend"

# test file (without .test.ts)  ->  database it is allowed to wipe
declare -A SUITES=(
  [commerce]=cms_commerce_test
  [fanLeads.integration]=cms_commerce_test
  [serviceAccounts]=cms_commerce_test
  [csAccounts]=cms_cs_accounts_test
  [dailyDetail]=cms_daily_detail_test
  [dailyMigration]=cms_daily_migration_test
  [payroll]=cms_payroll_test
  [review]=cms_review_test
  [salaryAccess]=cms_salary_test
  [integration]=cms_integration_test
)

export SESSION_SECRET="${SESSION_SECRET:-local-test-secret-not-for-production-use-0123456789}"

for database in $(printf '%s\n' "${SUITES[@]}" | sort -u); do
  psql -qh "$HOST" -p "$PORT" -U "$USER_NAME" -d postgres -tc \
    "SELECT 1 FROM pg_database WHERE datname='$database'" | grep -q 1 \
    || psql -qh "$HOST" -p "$PORT" -U "$USER_NAME" -d postgres -c "CREATE DATABASE $database"
done

failed=0
for suite in "${!SUITES[@]}"; do
  echo "== $suite -> ${SUITES[$suite]}"
  TEST_DATABASE_URL="postgres://$USER_NAME@$HOST:$PORT/${SUITES[$suite]}" \
    npx vitest run --config vitest.config.ts "tests/$suite.test.ts" || failed=1
done
exit $failed
