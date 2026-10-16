import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFromString, parseCoords, toWgs84, inRange,
  usesWgs84Locally, gcj02ToWgs84, wgs84ToGcj02, bd09mcToBd09,
} from '../src/parse.js';

test('bare WGS84 input never initiates outbound connection', async () => {
  assert.deepEqual(await parseCoords('22.544577,113.941140'), {
    lat: 22.544577, lon: 113.94114, name: '', src: 'text',
  });
});
test('Apple Hong Kong source stays WGS84', () => {
  assert.equal(usesWgs84Locally(22.284774,114.159437,'apple'), true);
  assert.deepEqual(toWgs84(22.284774,114.159437,'apple'), { lat:22.284774,lon:114.159437 });
});
test('Shenzhen Apple source converts GCJ', () => {
  const p = toWgs84(22.544577,113.94114,'apple');
  assert.equal(inRange(p.lat,p.lon),true);
  assert.ok(Math.abs(p.lon - 113.94114) > 0.001);
});
test('GCJ conversion round-trip approximates source', () => {
  const p = { lat:22.544577,lon:113.94114 };
  const gcj = wgs84ToGcj02(p.lat,p.lon);
  const rev = gcj02ToWgs84(gcj.lat,gcj.lon);
  assert.ok(Math.abs(rev.lat-p.lat)<1e-7);
  assert.ok(Math.abs(rev.lon-p.lon)<1e-7);
});
test('Baidu Mercator path and Google pin extraction', () => {
  assert.equal(extractFromString('https://www.google.com/maps/place/Apple+Park/@1.2345,2.3456!3d37.3349!4d-122.0090').src,'google');
  assert.equal(extractFromString('https://uri.amap.com/marker?position=113.941140,22.544577').lat,22.544577);
  assert.equal(inRange(bd09mcToBd09(12709535.375,2529761.45).lat, bd09mcToBd09(12709535.375,2529761.45).lon), true);
});
test('plain text body does not accept arbitrary decimal pairs', () => {
  assert.equal(extractFromString('price=1.1111,2.2222',{ allowBare:false }),null);
});
test('unsupported host without coordinates fails closed without SSRF', async () => {
  await assert.rejects(parseCoords('https://127.0.0.1/latest/meta-data/'));
  await assert.rejects(parseCoords('https://maps.apple.com.evil.invalid/short'));
});
test('redirect to disallowed origin is rejected BEFORE parsing its coordinate', async () => {
  let calls = 0;
  const request = async () => {
    calls++;
    return { headers: { get: (key) => key === 'location' ? 'http://127.0.0.1/?ll=22.1111,114.2222' : null }, text: async () => '' };
  };
  await assert.rejects(parseCoords('https://maps.app.goo.gl/abc', request));
  assert.equal(calls, 1);
});
test('allowed redirect resolves coordinates without an unsafe additional request', async () => {
  let calls = 0;
  const request = async () => {
    calls++;
    return { headers: { get: (key) => key === 'location' ? 'https://maps.apple.com/?ll=22.284774,114.159437' : null }, text: async () => '' };
  };
  const coords = await parseCoords('https://maps.app.goo.gl/abc', request);
  assert.equal(coords.lat, 22.284774);
  assert.equal(calls, 1);
});

test('Apple share short links resolve through a validated redirect', async () => {
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    return { headers: new Headers({ location: 'https://maps.apple.com/place?coordinate=22.284774,114.159437' }) };
  };
  assert.deepEqual(await parseCoords('https://maps.apple/p/review', request), {
    lat: 22.284774, lon: 114.159437, name: '', src: 'apple',
  });
  assert.deepEqual(calls, ['https://maps.apple/p/review']);
});

test('Apple short links cannot redirect to a disallowed host even with coordinates', async () => {
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    return { headers: new Headers({ location: 'https://maps.apple.evil.test/?ll=22.284774,114.159437' }) };
  };
  await assert.rejects(parseCoords('https://maps.apple/p/review', request), /未能从链接中解析出经纬度/);
  assert.deepEqual(calls, ['https://maps.apple/p/review']);
});
