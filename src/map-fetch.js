// Node.js-only safe outbound HTTP client for /api/parse.
// Restricts HTTPS hosts, blocks non-public IPv4 and pins validated DNS to the socket.
import https from 'node:https';
import dns from 'node:dns';
import { BlockList, isIP } from 'node:net';

const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 512 * 1024;

// Review additions individually. Exact hosts only: no domain suffix wildcard.
export const ALLOWED_MAP_HOSTS = new Set([
  // Apple 分享短链使用 maps.apple，再重定向至完整地图地址。
  'maps.apple.com', 'maps.apple',
  'www.google.com', 'maps.google.com', 'maps.app.goo.gl', 'goo.gl',
  'www.amap.com', 'amap.com', 'surl.amap.com', 'uri.amap.com',
  'ditu.amap.com', 'm.amap.com', 'm.ditu.amap.com',
  'map.baidu.com', 'j.map.baidu.com', 'm.baidu.com', 'map.app.baidu.com',
]);

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(network, prefix, 'ipv4');

export function isPublicIPv4(address) {
  return isIP(address) === 4 && !blocked.check(address, 'ipv4');
}

export function validateMapUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 8192 || /[\\\u0000-\u0020\u007f]/.test(raw)) {
    throw new Error('非法地图 URL');
  }
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.hostname.endsWith('.') || !ALLOWED_MAP_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('不允许访问此地图域名或协议');
  }
  url.hash = '';
  return url;
}

export function isAllowedMapUrl(raw) {
  try { validateMapUrl(raw); return true; } catch { return false; }
}

// DNS lookup happens inside the HTTPS socket dial: the validated IP is the
// same IP that Node connects to (not a check-then-fetch DNS TOCTOU).
function guardedLookup(host, opts, callback) {
  dns.lookup(host, { family: 4, all: true }, (err, answers) => {
    if (err) return callback(err);
    if (!answers?.length || answers.some((a) => !isPublicIPv4(a.address))) {
      return callback(new Error('DNS 解析结果包含非公网 IPv4 地址'));
    }
    const selected = answers[0].address;
    if (opts?.all) callback(null, [{ address: selected, family: 4 }]);
    else callback(null, selected, 4);
  });
}

// Returns a minimal Response-like object expected by src/parse.js.
// Redirects are NEVER followed here; caller validates EACH Location hop.
export async function safeMapRequest(raw) {
  const url = validateMapUrl(raw);
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (err, result) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(result);
    };
    const req = https.request(url, {
      method: 'GET',
      family: 4,
      autoSelectFamily: false,
      lookup: guardedLookup,
      agent: false,
      maxHeaderSize: 16 * 1024,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WlocParser/1.0)',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'identity',
      },
    }, (res) => {
      const headers = {
        get(name) {
          const v = res.headers[String(name).toLowerCase()];
          return typeof v === 'string' ? v : null;
        },
      };
      const result = (body) => ({
        url: url.href,
        headers,
        body: null,
        text: async () => body,
      });
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && headers.get('location')) {
        settle(null, result(''));
        res.destroy();
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        if (settled) return;
        const remaining = MAX_BODY_BYTES - total;
        if (remaining > 0) {
          const kept = chunk.subarray(0, remaining);
          chunks.push(kept);
          total += kept.length;
        }
        if (total >= MAX_BODY_BYTES) {
          // 达到上限后保留正文前缀供坐标解析，并立即关闭连接，限制读取量。
          settle(null, result(Buffer.concat(chunks, total).toString('utf8')));
          res.destroy();
        }
      });
      res.on('end', () => settle(null, result(Buffer.concat(chunks, total).toString('utf8'))));
      res.on('error', (e) => settle(e));
    });
    req.on('error', (e) => settle(e));
    req.end();
  });
}
