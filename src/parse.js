// WLOC 地图链接解析（Node.js 自托管安全版）
// 保留 Apple / 高德 / Google / 百度，GCJ-02 / BD09MC / WGS84 转换。
import { isAllowedMapUrl, safeMapRequest, validateMapUrl } from './map-fetch.js';

const MAX_URL_LENGTH = 8192;
const MAX_REDIRECTS = 5;

export function safeDecode(s) {
  if (!s) return '';
  try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); }
  catch { return String(s); }
}
export function inRange(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
function queryName(s) {
  const m = s.match(/[?&]name=([^&]+)/i);
  return m ? safeDecode(m[1]) : '';
}
function googleName(s) {
  const m = s.match(/\/maps\/place\/([^/@?]+)/);
  return m ? safeDecode(m[1]).replace(/\+/g, ' ').trim() : '';
}
function baiduPathName(s) {
  const m = s.match(/\/poi\/([^/@?]+)/);
  return m ? safeDecode(m[1]).trim() : '';
}

export function extractFromString(input, opts = {}) {
  if (!input) return null;
  const s = String(input);
  const allowBare = opts.allowBare !== false;
  let m;
  m = s.match(/(?:^|[?&])(?:coordinate|ll|sll)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
  if (m) return checkHit({ lat: +m[1], lon: +m[2], name: queryName(s), src: 'apple' });
  // Google 地点 pin 优先于视口中心。
  m = s.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (m) return checkHit({ lat: +m[1], lon: +m[2], name: googleName(s), src: 'google' });
  m = s.match(/[?&]p=[^,&%]*(?:,|%2C)(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i);
  if (m) return checkHit({ lat: +m[1], lon: +m[2], name: m[3] ? safeDecode(m[3]) : '', src: 'amap' });
  m = s.match(/[?&]q=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i);
  if (m) return checkHit({ lat: +m[1], lon: +m[2], name: m[3] ? safeDecode(m[3]) : '', src: 'amap' });
  // 高德 URI 经度在前。
  m = s.match(/(?:^|[?&])(?:lnglat|position)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
  if (m) return checkHit({ lat: +m[2], lon: +m[1], name: queryName(s), src: 'amap' });
  // 百度 BD09MC 网页路径。
  m = s.match(/baidu\.com\/[^\s]*?@(-?\d{6,9}(?:\.\d+)?)(?:,|%2C)(-?\d{6,9}(?:\.\d+)?)/i);
  if (m) {
    const bd = bd09mcToBd09(+m[1], +m[2]);
    if (bd) return checkHit({ ...bd, name: baiduPathName(s), src: 'baidu' });
  }
  m = s.match(/\/maps\/[^\s]*@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return checkHit({ lat: +m[1], lon: +m[2], name: googleName(s), src: 'google' });
  if (allowBare) {
    m = s.match(/(-?\d{1,3}\.\d{4,})\s*(?:,|%2C)\s*(-?\d{1,3}\.\d{4,})/);
    if (m) return checkHit({ lat: +m[1], lon: +m[2], name: '', src: 'text' });
  }
  return null;
}
function checkHit(hit) { return inRange(hit.lat, hit.lon) ? hit : null; }
function isBaiduHost(input) {
  try { return /(^|\.)baidu\.com$/i.test(new URL(input).hostname); }
  catch { return false; }
}

// 若输入中已经带明确坐标，仅本地解析；只有短链/无坐标链接会发起服务端请求。
// 每一跳先经过 validateMapUrl，再尝试从 URL 中提取坐标：不能让被拒绝的跳转绕过策略。
export async function parseCoords(raw, request = safeMapRequest) {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('空输入');
  if (text.length > MAX_URL_LENGTH) throw new Error('输入过长');
  const urlMatch = text.match(/https?:\/\/[^\s'"<>]+/i);
  const target = urlMatch ? urlMatch[0] : text;
  let hit = extractFromString(target);
  if (hit) return hit;
  if (!urlMatch) throw new Error('未能从输入中解析出经纬度');

  let current = target;
  const visited = new Set();
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    if (!isAllowedMapUrl(current) || visited.has(current)) break;
    visited.add(current);
    let resp;
    try { resp = await request(current); }
    catch { break; }

    const location = resp.headers.get('location');
    if (location) {
      let next;
      try { next = validateMapUrl(new URL(location, current).toString()).href; }
      catch { break; }
      hit = extractFromString(next);
      if (hit) return hit;
      current = next;
      continue;
    }
    hit = extractFromString(resp.url);
    if (hit) return hit;
    try {
      const body = await resp.text();
      hit = extractFromString(body, { allowBare: false });
      if (hit) return hit;
      if (isBaiduHost(current)) {
        hit = extractBaiduFromBody(body);
        if (hit) return hit;
      }
    } catch { /* fail closed */ }
    break;
  }
  if (isBaiduHost(target)) {
    throw new Error('该百度链接需由网页脚本解析坐标。请在浏览器打开后复制包含 /poi/名称/@数字,数字 的完整地址。');
  }
  throw new Error('未能从链接中解析出经纬度（仅允许白名单 HTTPS 地图域名）');
}
export function round6(n) { return Math.round(Number(n) * 1e6) / 1e6; }

// 百度 BD09MC -> BD09（百度并非标准 Web Mercator）。
const MCBAND = [12890594.86, 8362377.87, 5591021, 3481989.83, 1678043.12, 0];
const MC2LL = [
  [1.410526172116255e-8, 8.98305509648872e-6, -1.9939833816331, 200.9824383106796, -187.2403703815547, 91.6087516669843, -23.38765649603339, 2.57121317296198, -0.03801003308653, 1.73379812e7],
  [-7.435856389565537e-9, 8.983055097726239e-6, -0.78625201886289, 96.32687599759846, -1.85204757529826, -59.36935905485877, 47.40033549296737, -16.50741931063887, 2.28786674699375, 1.026014486e7],
  [-3.030883460898826e-8, 8.98305509983578e-6, 0.30071316287616, 59.74293618442277, 7.357984074871, -25.38371002664745, 13.45380521110908, -3.29883767235584, 0.32710905363475, 6.85681737e6],
  [-1.981981304930552e-8, 8.983055099779535e-6, 0.03278182852591, 40.31678527705744, 0.65659298677277, -4.44255534477492, 0.85341911805263, 0.12923347998204, -0.04625736007561, 4.48277706e6],
  [3.09191371068437e-9, 8.983055096812155e-6, 6.995724062e-5, 23.10934304144901, -0.00023663490511, -0.6321817810242, -0.00663494467273, 0.03430082397953, -0.00466043876332, 2.5551644e6],
  [2.890871144776878e-9, 8.983055095805407e-6, -3.068298e-8, 7.47137025468032, -3.53937994e-6, -0.02145144861037, -1.234426596e-5, 0.00010322952773, -3.23890364e-6, 8.260885e5],
];
export function bd09mcToBd09(x, y) {
  const ax = Math.abs(x), ay = Math.abs(y);
  let f = null;
  for (let i = 0; i < MCBAND.length; i++) if (ay >= MCBAND[i]) { f = MC2LL[i]; break; }
  if (!f) return null;
  const c = ay / f[9];
  let lon = f[0] + f[1] * ax;
  let lat = f[2] + f[3] * c + f[4] * c ** 2 + f[5] * c ** 3 + f[6] * c ** 4 + f[7] * c ** 5 + f[8] * c ** 6;
  lon *= x < 0 ? -1 : 1;
  lat *= y < 0 ? -1 : 1;
  return { lat, lon };
}
const X_PI = Math.PI * 3000 / 180;
export function bd09ToGcj02(lat, lon) {
  const x = lon - 0.0065, y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const t = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return { lat: z * Math.sin(t), lon: z * Math.cos(t) };
}

// 港澳台 Apple/Google 原始定位为 WGS84；高德/百度仍按各自偏移转换。
const HK_POLY = [
  [113.8, 22.1], [113.8, 22.43], [113.9, 22.455],
  [113.98, 22.487], [114.05, 22.507], [114.11, 22.527],
  [114.17, 22.543], [114.24, 22.552], [114.32, 22.545],
  [114.5, 22.45], [114.5, 22.1],
];
function pointInPoly(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inMacau(lat, lon) { return lat >= 22.1 && lat <= 22.215 && lon >= 113.525 && lon <= 113.605; }
function inTaiwan(lat, lon) { return lat >= 21.85 && lat <= 25.35 && lon >= 119.3 && lon <= 122.1; }
export function usesWgs84Locally(lat, lon, src) {
  return (src === 'apple' || src === 'google') &&
    (inMacau(lat, lon) || inTaiwan(lat, lon) || pointInPoly(lat, lon, HK_POLY));
}
export function toWgs84(lat, lon, src) {
  if (src === 'baidu') {
    const g = bd09ToGcj02(lat, lon);
    return gcj02ToWgs84(g.lat, g.lon);
  }
  if (src === 'amap' || src === 'apple' || src === 'google') {
    if (usesWgs84Locally(lat, lon, src)) return { lat, lon };
    return gcj02ToWgs84(lat, lon);
  }
  return { lat, lon };
}
export function extractBaiduFromBody(body) {
  const m = String(body).match(/"x"\s*:\s*"?(-?\d+(?:\.\d+)?)"?\s*,\s*"y"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/);
  if (!m) return null;
  const x = +m[1], y = +m[2];
  if (!(Math.abs(x) > 1e5 && Math.abs(y) > 1e5)) return null;
  const bd = bd09mcToBd09(x, y);
  if (!bd || !inRange(bd.lat, bd.lon)) return null;
  const nm = String(body).match(/<title>[^<]*?【([^】]{1,40})】/);
  return { ...bd, name: nm ? nm[1] : '', src: 'baidu' };
}

const GCJ_A = 6378245;
const GCJ_EE = 0.00669342162296594323;
function gcjOutOfChina(lng, la) { return lng < 72.004 || lng > 137.8347 || la < 0.8293 || la > 55.8271; }
function gcjDeltaLat(x, y) {
  let r = -100.0 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2) / 3;
  r += ((160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2) / 3;
  return r;
}
function gcjDeltaLon(x, y) {
  let r = 300.0 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2) / 3;
  r += ((150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2) / 3;
  return r;
}
export function wgs84ToGcj02(lat, lon) {
  if (gcjOutOfChina(lon, lat)) return { lat, lon };
  let dLat = gcjDeltaLat(lon - 105, lat - 35);
  let dLon = gcjDeltaLon(lon - 105, lat - 35);
  const radLat = lat / 180 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = dLat * 180 / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI);
  dLon = dLon * 180 / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lon: lon + dLon };
}
export function gcj02ToWgs84(lat, lon) {
  if (gcjOutOfChina(lon, lat)) return { lat, lon };
  let wgsLat = lat, wgsLon = lon;
  for (let i = 0; i < 6; i++) {
    const g = wgs84ToGcj02(wgsLat, wgsLon);
    const errLat = g.lat - lat, errLon = g.lon - lon;
    if (Math.abs(errLat) < 1e-9 && Math.abs(errLon) < 1e-9) break;
    wgsLat -= errLat;
    wgsLon -= errLon;
  }
  return { lat: wgsLat, lon: wgsLon };
}
