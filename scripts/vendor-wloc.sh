#!/usr/bin/env bash
# 开发/审计机器上执行一次；将审核后的固定版本提交 Git，而不是服务器启动时下载。
set -Eeuo pipefail
# macOS 默认提供 shasum，Linux 通常提供 sha256sum；二者使用相同的清单格式。
if command -v sha256sum >/dev/null 2>&1; then
  checksum_cmd=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  checksum_cmd=(shasum -a 256)
else
  echo 'Missing SHA-256 utility: sha256sum or shasum is required' >&2
  exit 1
fi
COMMIT='7f28c5e4fb6b802862988735b92e5c800382f2a2'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/vendor/wloc"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet https://github.com/xepes0/wloc.git "$TMP/source"
git -C "$TMP/source" checkout --quiet --detach "$COMMIT"
[[ "$(git -C "$TMP/source" rev-parse HEAD)" == "$COMMIT" ]] || exit 1
mkdir -p "$OUT"
install -m 0644 "$TMP/source/dist/wloc.js" "$OUT/wloc.js"
install -m 0644 "$TMP/source/dist/wloc-settings.js" "$OUT/wloc-settings.js"
install -m 0644 "$TMP/source/wloc.jpg" "$OUT/wloc.jpg"
install -m 0644 "$TMP/source/LICENSE" "$OUT/UPSTREAM-LICENSE"
if [[ -f "$TMP/source/NOTICE.md" ]]; then
  install -m 0644 "$TMP/source/NOTICE.md" "$OUT/UPSTREAM-NOTICE.md"
fi
printf '%s\n' "source=https://github.com/xepes0/wloc" "commit=$COMMIT" > "$OUT/UPSTREAM-REVISION.txt"
( cd "$OUT" && "${checksum_cmd[@]}" wloc.js wloc-settings.js wloc.jpg UPSTREAM-LICENSE > SHA256SUMS && "${checksum_cmd[@]}" -c SHA256SUMS )
echo "Vendor assets are in $OUT. Review, then commit vendor/wloc to YOUR Git repository."
