import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { isAllowedMapUrl, isPublicIPv4, safeMapRequest } from '../src/map-fetch.js';
import { parseCoords } from '../src/parse.js';

test('allow only exact HTTPS map hosts', () => {
  assert.equal(isAllowedMapUrl('https://maps.apple.com/?ll=22.1234,114.1234'), true);
  assert.equal(isAllowedMapUrl('https://maps.apple/p/review'), true);
  assert.equal(isAllowedMapUrl('https://maps.apple.evil.test/p/review'), false);
  assert.equal(isAllowedMapUrl('https://sub.maps.apple/p/review'), false);
  assert.equal(isAllowedMapUrl('http://maps.apple/p/review'), false);
  assert.equal(isAllowedMapUrl('https://maps.apple:444/p/review'), false);
  assert.equal(isAllowedMapUrl('https://user:pass@maps.apple/p/review'), false);
  assert.equal(isAllowedMapUrl('https://surl.amap.com/abc'), true);
  assert.equal(isAllowedMapUrl('http://maps.apple.com/'), false);
  assert.equal(isAllowedMapUrl('https://maps.apple.com:444/'), false);
  assert.equal(isAllowedMapUrl('https://maps.apple.com.evil.test/'), false);
  assert.equal(isAllowedMapUrl('https://user:pass@maps.apple.com/'), false);
  assert.equal(isAllowedMapUrl('https://127.0.0.1/'), false);
  assert.equal(isAllowedMapUrl('https://169.254.169.254/'), false);
  assert.equal(isAllowedMapUrl('https://[::1]/'), false);
  assert.equal(isAllowedMapUrl('https://maps.apple.com\\@evil.test/'), false);
});

test('forbid private/reserved IPv4 even after DNS resolution', () => {
  for (const addr of ['127.0.0.1', '10.0.0.1', '172.16.0.1',
    '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '198.18.0.1', '192.0.2.1']) {
    assert.equal(isPublicIPv4(addr), false, addr);
  }
  assert.equal(isPublicIPv4('8.8.8.8'), true);
  assert.equal(isPublicIPv4('2606:4700:4700::1111'), false);
});

// 用内存流模拟 HTTPS 响应，验证截断和连接关闭行为，不访问真实网络。
function mockHttpsBody(t, chunks) {
  const response = Readable.from(chunks);
  response.statusCode = 200;
  response.headers = {};
  t.mock.method(https, 'request', (_url, _options, onResponse) => {
    const request = new EventEmitter();
    request.end = () => queueMicrotask(() => onResponse(response));
    return request;
  });
  return response;
}

const BODY_LIMIT = 512 * 1024;
const COORDINATE_LINK = '<a href="https://maps.apple.com/?ll=22.284774,114.159437">';

for (const size of [BODY_LIMIT - 1, BODY_LIMIT, BODY_LIMIT + 1]) {
  for (const split of [false, true]) {
    test(`coordinates survive a ${size}-byte body (${split ? 'multiple chunks' : 'single chunk'})`, async (t) => {
      const body = Buffer.from(COORDINATE_LINK + ' '.repeat(size - COORDINATE_LINK.length));
      const chunks = split ? [body.subarray(0, 37), body.subarray(37)] : [body];
      const stream = mockHttpsBody(t, chunks);
      const response = await safeMapRequest('https://maps.apple.com/review');
      assert.equal(Buffer.byteLength(await response.text()), Math.min(size, BODY_LIMIT));
      if (size >= BODY_LIMIT) assert.equal(stream.destroyed, true);
      assert.deepEqual(await parseCoords('https://maps.apple.com/review', async () => response), {
        lat: 22.284774, lon: 114.159437, name: '', src: 'apple',
      });
    });
  }
}

test('coordinates beyond the body limit are not parsed', async (t) => {
  mockHttpsBody(t, [Buffer.from(' '.repeat(BODY_LIMIT) + COORDINATE_LINK)]);
  await assert.rejects(parseCoords('https://maps.apple.com/review'), /未能从链接中解析出经纬度/);
});

test('response errors before the body limit still reject the request', async (t) => {
  mockHttpsBody(t, (function* () {
    yield Buffer.from('incomplete response');
    throw new Error('simulated response failure');
  })());
  await assert.rejects(safeMapRequest('https://maps.apple.com/review'), /simulated response failure/);
});
