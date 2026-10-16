import { serve } from '@hono/node-server';
import app from './src/index.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' },
  ({ port }) => console.log(`WLOC listening on 0.0.0.0:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
