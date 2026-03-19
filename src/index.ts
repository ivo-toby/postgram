import { Hono } from 'hono';

type HealthStatus = {
  postgres: 'connected' | 'disconnected';
  embeddingModel: string | null;
};

type AppOptions = {
  getHealthStatus?: () => Promise<HealthStatus> | HealthStatus;
};

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

function getDefaultHealthStatus(): HealthStatus {
  return {
    postgres: 'connected',
    embeddingModel: DEFAULT_EMBEDDING_MODEL
  };
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();
  const getHealthStatus = options.getHealthStatus ?? getDefaultHealthStatus;

  app.get('/health', async (c) => {
    const health = await getHealthStatus();

    if (health.postgres === 'disconnected') {
      return c.json(
        {
          status: 'degraded',
          postgres: 'disconnected'
        },
        503
      );
    }

    return c.json({
      status: 'ok',
      version: '0.1.0',
      postgres: health.postgres,
      embedding_model: health.embeddingModel ?? DEFAULT_EMBEDDING_MODEL
    });
  });

  return app;
}
