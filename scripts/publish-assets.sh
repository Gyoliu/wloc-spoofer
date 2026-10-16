#!/usr/bin/env bash
# 服务器 git pull 后运行：仅复制已提交 Git 的固定脚本，完全不访问外部 GitHub。
set -Eeuo pipefail
SITE_ORIGIN="${SITE_ORIGIN:?SITE_ORIGIN=https://wloc.example.com is required}"
STATIC_ROOT="${STATIC_ROOT:-/var/www/wloc}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor/wloc"
[[ "$SITE_ORIGIN" =~ ^https://[A-Za-z0-9.-]+$ ]] || { echo 'Invalid SITE_ORIGIN' >&2; exit 1; }
for file in wloc.js wloc-settings.js wloc.jpg UPSTREAM-LICENSE SHA256SUMS UPSTREAM-REVISION.txt; do
  [[ -f "$VENDOR/$file" ]] || { echo "Missing $VENDOR/$file; run vendor-wloc.sh on the development machine and commit assets first" >&2; exit 1; }
done
( cd "$VENDOR" && sha256sum -c SHA256SUMS )
install -d -m 0755 "$STATIC_ROOT/scripts"
install -m 0644 "$VENDOR/wloc.js" "$STATIC_ROOT/scripts/wloc.js"
install -m 0644 "$VENDOR/wloc-settings.js" "$STATIC_ROOT/scripts/wloc-settings.js"
install -m 0644 "$VENDOR/wloc.jpg" "$STATIC_ROOT/wloc.jpg"
install -m 0644 "$VENDOR/UPSTREAM-LICENSE" "$STATIC_ROOT/UPSTREAM-LICENSE"
install -m 0644 "$VENDOR/UPSTREAM-REVISION.txt" "$STATIC_ROOT/UPSTREAM-REVISION.txt"
[[ ! -f "$VENDOR/UPSTREAM-NOTICE.md" ]] || install -m 0644 "$VENDOR/UPSTREAM-NOTICE.md" "$STATIC_ROOT/UPSTREAM-NOTICE.md"
# 使用原模块的 MITM/正则/参数，只替换两个远程执行脚本和图标 URL。
sed \
  -e "s|https://raw.githubusercontent.com/xepes0/wloc/refs/heads/main/dist/wloc.js|$SITE_ORIGIN/scripts/wloc.js|g" \
  -e "s|https://raw.githubusercontent.com/xepes0/wloc/refs/heads/main/dist/wloc-settings.js|$SITE_ORIGIN/scripts/wloc-settings.js|g" \
  -e "s|https://raw.githubusercontent.com/xepes0/wloc/refs/heads/main/wloc.jpg|$SITE_ORIGIN/wloc.jpg|g" \
  "$ROOT/wloc.module" > "$STATIC_ROOT/wloc.module"
if grep -q 'script-path=https://raw.githubusercontent.com/' "$STATIC_ROOT/wloc.module"; then
  echo 'ERROR: remote script-path still present' >&2; exit 1
fi
chmod 0644 "$STATIC_ROOT/wloc.module"
( cd "$STATIC_ROOT" && sha256sum scripts/wloc.js scripts/wloc-settings.js wloc.jpg wloc.module > SHA256SUMS && sha256sum -c SHA256SUMS )
echo "Published to $STATIC_ROOT (no external downloads performed)"
