# WLOC 私有化安全版 —— 完整源码覆盖包

适配仓库：`https://github.com/Gyoliu/wloc-spoofer`（基于 2026-10-13 公开 main 源码接口）。

这不是 `apply.py`：所有修改过的源码均为完整文件。将本包与原仓库合并使用，**保留原仓库的 `src/page.js`、`src/gcj-browser.js`、`wloc.module`、`functions/`、`dist/`**。原 `src/index.js` 和 `src/parse.js` 用本包完整文件替换，新增 `src/map-fetch.js`。原项目中 `src/page.js` 一定要保留，否则页面入口无法运行。

## A. 在开发/测试机器上合并和验证

```bash
# 已经有原项目 clone，且 git status --short 是空的
cd /path/to/wloc-spoofer
git switch -c feature/selfhost
# 解压 wloc-selfhost-complete.zip 到 /tmp/wloc-selfhost-complete
cp -a /tmp/wloc-selfhost-complete/. .
# 如有 .gitignore.additions，请将规则人工追加到项目已有 .gitignore
node --check src/parse.js
node --check src/map-fetch.js
node --check src/index.js
node --test test/map-fetch-security.test.mjs test/parser-selfhost.test.mjs
# 按已提交的锁文件安装依赖，建议在有网络的开发机器上运行
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

`package.json` 和 `package-lock.json` 必须一并提交。开发环境使用 `npm ci`，Docker 构建使用 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`，两者均严格使用锁文件。只有主动调整依赖时才运行 `npm install` 更新锁文件，并重新验证。

## B. 固定第三方脚本（建议在开发机器运行并提交 Git）

```bash
bash scripts/vendor-wloc.sh
# 校验脚本和追溯信息
(cd vendor/wloc && sha256sum -c SHA256SUMS)
# macOS 使用：(cd vendor/wloc && shasum -a 256 -c SHA256SUMS)
python3 scripts/audit-wloc.py vendor/wloc
# 人工审阅 vendor/wloc/wloc.js、vendor/wloc/wloc-settings.js 和上游 LICENSE/NOTICE
# 这些文件是上游预编译/打包产物，静态分析/哈希校验不能保证其无漏洞。

git add src/index.js src/parse.js src/map-fetch.js server.js package.json package-lock.json \
  Dockerfile docker-compose.yml .dockerignore nginx scripts test vendor README-SELFHOST.zh-CN.md
git commit -m "feat: self-host WLOC securely with Node and pinned vendor scripts"
git push -u origin feature/selfhost
```

检查分支、CI、Diff 后合并到 `main`，或者服务器直接部署 `feature/selfhost` 分支。**本交付不直接修改你的 GitHub 仓库，也未生成或托管第三方脚本字节；`vendor-wloc.sh` 在能连 GitHub 的开发机获取固定版本后，必须人工审核并提交这些资产，生产机才会不依赖 GitHub Raw。**

## C. 服务器首次部署

```bash
cd /opt/wloc/wloc-spoofer
git fetch origin
git switch main
git pull --ff-only origin main

# 确认已提交 vendor 文件
test -s vendor/wloc/wloc.js
test -s vendor/wloc/wloc-settings.js
# 填入实际站点 HTTPS 域名，Nginx 将使用 /var/www/wloc 的已审计静态副本
sudo env SITE_ORIGIN=https://wloc.example.com bash scripts/publish-assets.sh

# 创建 Basic Auth（Debian/Ubuntu）
sudo apt-get install -y apache2-utils
sudo htpasswd -c /etc/nginx/.wloc.htpasswd wlocadmin
sudo chown root:www-data /etc/nginx/.wloc.htpasswd
sudo chmod 640 /etc/nginx/.wloc.htpasswd

# 先确保 TLS 证书已正确签发，再启用 Nginx 配置。
# 将 YOUR_DOMAIN 改为实际域名，与 SITE_ORIGIN 保持一致；确认替换后的 .pem/.key 路径。
sudo cp nginx/wloc.conf.example /etc/nginx/conf.d/wloc.conf
sudo sed -i 's/wloc\.example\.com/YOUR_DOMAIN/g' /etc/nginx/conf.d/wloc.conf
sudo nginx -t && sudo systemctl reload nginx

docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
```

服务器只需执行已提交代码的构建/发布命令；无需执行 `apply.py`，也无需服务器端 `git clone xepes0/wloc`。

### 服务器后续更新（Git 已经合并入 main）

```bash
cd /opt/wloc/wloc-spoofer
git status --short
git pull --ff-only origin main
node --test test/map-fetch-security.test.mjs test/parser-selfhost.test.mjs
sudo env SITE_ORIGIN=https://wloc.example.com bash scripts/publish-assets.sh
docker compose -f docker-compose.yml up -d --build --force-recreate wloc
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs --tail=100 wloc
```

## D. Basic Auth 与 API 调用

- Nginx 的 `auth_basic` 在 `server{}` 层，默认保护 `/` 和 `/api/parse`，两者使用同一 Realm。网页同源 fetch 会使用 Safari 已通过的身份认证。
- `/wloc.module`、`/scripts/wloc.js`、`/scripts/wloc-settings.js`、`/wloc.jpg` 被明确设置为匿名可下载，代理客户端无需 Basic Auth 即可订阅。
- `GET /api/parse?u=...&format=json` 支持普通坐标/地图链接；请求头可携带 `Authorization: Basic ...`；curl 推荐 `-u` 交互输入密码，不要把密码写进 URL。

```bash
# 未登录 -> 401
curl -i 'https://wloc.example.com/api/parse?u=22.544577%2C113.941140&format=json'
# 输入账号对应密码 -> 200
curl -i --basic -u wlocadmin -G 'https://wloc.example.com/api/parse' \
  --data-urlencode 'u=22.544577,113.941140' \
  --data-urlencode 'format=json'
# 模块和脚本匿名下载 -> 200
curl -I 'https://wloc.example.com/wloc.module'
curl -I 'https://wloc.example.com/scripts/wloc.js'
```

注：容器端口只绑定 `127.0.0.1:3000`，认证和限流由 Nginx 实现；避免将 3000 端口直连公网。对于有多个上游代理/LB 的部署，必须正确设定真实 IP，否则 IP 限流可能对代理整体生效。

## E. SSRF 防护边界

- 仅允许精确白名单 HTTPS 地图域名；禁用用户信息、非标准端口、IP 字面量。
- DNS 解析在 HTTPS Socket 连接中进行校验，锁定经过验证的公网 IPv4；防止校验 DNS 与实际连接使用不同地址。
- 不自动追随 HTTP 重定向，对每个 Location 做白名单检查后才继续。
- 最大 5 次出站请求，每次 8 秒超时；正文仅保留前 512 KiB 供解析，到达上限立即关闭连接，最大 URL 8192 字符。
- API Basic Auth 和每 IP 12 次/分钟限制；API 普通访问日志关闭以降低坐标泄露。
- 建议增加容器出口防火墙，阻断对内网、云元数据、链路本地的访问。JS 白名单是防线之一，不等于完整网络隔离。
- 为控制 SSRF 风险，只允许 IPv4 出站；IPv6-only 地图短链可能解析失败。
- 白名单可能需要根据实际短链域名做审计后逐项补充；非允许域名会安全失败。

## F. 验证状态与遗留项

JavaScript 语法检查及纯 JS 单元测试覆盖坐标转换、短链白名单、重定向、正文截断边界和固定版本 WLOC 脚本的 Stash 响应格式。`vendor/wloc/` 保存固定上游提交的脚本、图标、校验清单、许可证及来源说明；更新资源后应重新执行 B 部分的校验与审查。Docker 构建、真实 DNS/HTTP 重定向集成、Nginx 启动和 iPhone 实机行为需要在对应环境验证。

本版将 `src/index.js` 中原先的开放 `Access-Control-Allow-Origin:*` 移除（同源 Safari 和 iOS Shortcuts 不依赖它），如果有跨域第三方网页调用 API，可能需要另行配置授权来源。原有 `wrangler.jsonc` / Cloudflare Pages 路由文件虽然保留，但此 `src/map-fetch.js` 使用 Node 内置模块，不再兼容直接按旧 Worker 入口部署。
