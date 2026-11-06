#!/usr/bin/env bash
# 在 Linux 打包机构建 Windows 本机内测 zip。不包含 node_modules、.git、.env 或密钥。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-/workspace/releases}"
STAGING="$(mktemp -d /tmp/cms-winrel-XXXXXX)"
cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT

cd "$ROOT"

if [[ ! -f package.json || ! -f backend/package.json || ! -f frontend/package.json ]]; then
  echo "仓库结构不完整" >&2
  exit 1
fi

echo "构建前端与后端..."
npm run build

DEST="$STAGING/cms-internal"
mkdir -p \
  "$DEST/backend/dist" \
  "$DEST/backend/migrations" \
  "$DEST/frontend/dist" \
  "$DEST/scripts" \
  "$DEST/logs"

cp -a "$ROOT/backend/dist/." "$DEST/backend/dist/"
cp -a "$ROOT/backend/migrations/." "$DEST/backend/migrations/"
cp -a "$ROOT/frontend/dist/." "$DEST/frontend/dist/"

cp -a "$ROOT/scripts/windows/"*.ps1 "$DEST/scripts/"
cp -a "$ROOT/scripts/windows/安装说明.txt" "$DEST/安装说明.txt"
cp -a "$ROOT/scripts/windows/package.production.json" "$DEST/package.json"
cp -a "$ROOT/scripts/windows/env.windows.example" "$DEST/.env.example"

cat > "$DEST/.gitignore" << 'EOF'
node_modules/
.env
.env.local
logs/
cms.pid
data/
EOF

COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
COMMIT_SHORT="$(git -C "$ROOT" rev-parse --short HEAD)"
VERSION="$(node -p "require('./backend/package.json').version")"
BUILT_AT="$(date '+%Y-%m-%d %H:%M %Z')"

cat > "$DEST/BUILDINFO.txt" << EOF
name=company-management-system
version=${VERSION}
git_commit=${COMMIT}
built_at=${BUILT_AT}
built_on=linux (not Windows)
frontend=prebuilt dist
backend=tsc-compiled JavaScript
native_modules=none (bcryptjs is pure JavaScript)
windows_tests=not_run
notes=This package was assembled on Linux. Do not treat Linux test results as Windows acceptance.
EOF

echo "生成 package-lock.json（需要访问 npm 源）..."
(
  cd "$DEST"
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
  rm -rf node_modules
)

python3 - "$DEST" << 'PY'
import os
import sys
from pathlib import Path

root = Path(sys.argv[1])
forbidden_names = {".env", ".git", "node_modules", ".pg-test-pass", "demo-credentials.txt", "credentials"}
found = []
for dirpath, dirnames, filenames in os.walk(root):
    for name in list(dirnames):
        if name in forbidden_names:
            found.append(str(Path(dirpath) / name))
    for name in filenames:
        rel = Path(dirpath) / name
        if name in forbidden_names or name.endswith(".pid"):
            found.append(str(rel))
        lower = name.lower()
        if "credential" in lower or name.endswith(".pem") or name.endswith(".key"):
            found.append(str(rel))
if found:
    raise SystemExit("refuse to package secret or forbidden paths:\n" + "\n".join(found))

required = [
    "安装说明.txt",
    "package.json",
    "package-lock.json",
    ".env.example",
    "backend/dist/index.js",
    "backend/dist/migrate-cli.js",
    "backend/dist/scripts/init-admin.js",
    "backend/dist/scripts/seed-demo.js",
    "backend/migrations/001_init.sql",
    "frontend/dist/index.html",
    "scripts/Install-Cms.ps1",
    "scripts/Start-Cms.ps1",
    "scripts/Stop-Cms.ps1",
    "scripts/New-CmsEnv.ps1",
    "scripts/Initialize-CmsDemo.ps1",
    "scripts/Initialize-CmsAdmin.ps1",
    "scripts/CmsCommon.ps1",
    "BUILDINFO.txt",
]
missing = [p for p in required if not (root / p).exists()]
if missing:
    raise SystemExit("missing required files:\n" + "\n".join(missing))
print("pre-zip checks passed")
PY

mkdir -p "$OUT_DIR"
NAME="company-management-system-windows-${VERSION}-${COMMIT_SHORT}"
ZIP_PATH="$OUT_DIR/${NAME}.zip"
rm -f "$ZIP_PATH"

python3 - "$STAGING" "$ZIP_PATH" << 'PY'
import sys
import zipfile
from pathlib import Path

staging = Path(sys.argv[1])
zip_path = Path(sys.argv[2])
root = staging / "cms-internal"
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for path in sorted(root.rglob("*")):
        if path.is_file():
            zf.write(path, arcname=str(Path("cms-internal") / path.relative_to(root)))
print("wrote", zip_path)
PY

python3 - "$ZIP_PATH" << 'PY'
import hashlib
import sys
import zipfile
from pathlib import Path

zip_path = Path(sys.argv[1])
digest_hasher = hashlib.sha256()
with zip_path.open("rb") as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest_hasher.update(chunk)
digest = digest_hasher.hexdigest()
Path(str(zip_path) + ".sha256").write_text(f"{digest}  {zip_path.name}\n", encoding="utf-8")
print(f"sha256={digest}")
print(f"size={zip_path.stat().st_size}")
with zipfile.ZipFile(zip_path) as zf:
    names = zf.namelist()
print(f"entries={len(names)}")
banned = [
    n for n in names
    if n.endswith("/.env") or "/node_modules/" in n or "/.git/" in n or n.endswith("demo-credentials.txt")
]
if banned:
    raise SystemExit("zip contains forbidden entries:\n" + "\n".join(banned))
PY

echo "ZIP_PATH=$ZIP_PATH"
