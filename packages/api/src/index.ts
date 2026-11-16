import './lib/load-env';
import { serve } from '@hono/node-server';
import { app } from './app';

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[sds-api] http://localhost:${info.port}`);
});
