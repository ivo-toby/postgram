import { Hono } from 'hono';

export function createApp(): Hono {
  const app = new Hono();

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      version: '0.1.0',
      postgres: 'connected',
      embedding_model: 'unknown'
    })
  );

  return app;
}
