// 自托管 Hono 入口；访问认证/速率限制在 Nginx 层完成。
import { Hono } from 'hono/tiny';
import { getPageHtml } from './page.js';
import { parseCoords, gcj02ToWgs84, toWgs84, round6, inRange } from './parse.js';

const app = new Hono();
app.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});
app.get('/healthz', (c) => c.json({ status: 'ok' }));
app.get('/', (c) => c.html(getPageHtml()));
app.get('/api/parse', async (c) => {
  const raw = c.req.query('u') ?? '';
  const cs = (c.req.query('cs') ?? '').toLowerCase();
  const fmt = (c.req.query('format') ?? '').toLowerCase();
  if (raw.length > 8192) return c.json({ error: '输入长度超过限制' }, 413);
  if (!['', 'none', 'gcj', 'bd'].includes(cs)) {
    return c.json({ error: '不支持的坐标系参数' }, 400);
  }
  try {
    let { lat, lon, name, src } = await parseCoords(raw);
    if (cs === 'gcj') ({ lat, lon } = gcj02ToWgs84(lat, lon));
    else if (cs === 'bd') ({ lat, lon } = toWgs84(lat, lon, 'baidu'));
    else if (cs !== 'none') ({ lat, lon } = toWgs84(lat, lon, src));
    if (!inRange(lat, lon)) throw new Error('解析坐标超出合法范围');
    lat = round6(lat);
    lon = round6(lon);
    name ||= '';
    return fmt === 'json' ? c.json({ lat, lon, name }) : c.text(`lat=${lat}&lon=${lon}`);
  } catch (err) {
    // 不输出内部调用栈；业务异常包含允许的域名信息/失败原因。
    return c.json({ error: err instanceof Error ? err.message : '解析失败' }, 422);
  }
});
app.onError((_err, c) => c.json({ error: 'Internal Server Error' }, 500));
export default app;
