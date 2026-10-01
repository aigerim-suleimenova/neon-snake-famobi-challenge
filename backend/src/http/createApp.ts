import express, { type ErrorRequestHandler, type Response } from 'express';
import { MAX_BATCH_EVENTS } from '../services/contract';
import type { IngestionService } from '../services/IngestionService';
import type { StatsService } from '../services/StatsService';
import { StoreUnavailable } from '../services/storeDeadline';
import { cors } from './cors';

const BODY_LIMIT_KB = 100;
const BODY_LIMIT = `${BODY_LIMIT_KB}kb`;

export interface AppDeps {
  ingestion: Pick<IngestionService, 'ingest'>;
  stats: Pick<StatsService, 'overview' | 'levels'>;
  health: { ping(): Promise<boolean> };
  allowedOrigins: readonly string[];
  logError?: (error: unknown) => void;
}

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: { message } });
}

/** The HTTP layer only: parsing, routes, CORS and mapping errors to status codes. */
export function createApp({ ingestion, stats, health, allowedOrigins, logError = console.error }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors(allowedOrigins));

  app.post(
    '/api/events',
    express.json({ limit: BODY_LIMIT }),
    // navigator.sendBeacon posts text/plain to avoid a preflight; the body is still JSON.
    express.text({ type: 'text/plain', limit: BODY_LIMIT }),
    async (req, res) => {
      let batch: unknown = req.body;
      if (typeof batch === 'string') {
        try {
          batch = JSON.parse(batch);
        } catch {
          return sendError(res, 400, 'Body must be valid JSON');
        }
      }
      if (!Array.isArray(batch) || batch.length === 0 || batch.length > MAX_BATCH_EVENTS) {
        return sendError(res, 400, `Body must be a JSON array of 1 to ${MAX_BATCH_EVENTS} events`);
      }
      res.status(202).json(await ingestion.ingest(batch));
    }
  );

  app.get('/api/stats/overview', async (_req, res) => {
    res.json(await stats.overview());
  });

  app.get('/api/stats/levels', async (_req, res) => {
    res.json({ levels: await stats.levels() });
  });

  app.get('/api/health', async (_req, res) => {
    const reachable = await health.ping().catch(() => false);
    if (reachable) res.json({ status: 'ok' });
    else sendError(res, 503, 'Storage is unavailable');
  });

  app.use((_req, res) => sendError(res, 404, 'Not found'));

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof StoreUnavailable) return sendError(res, 503, 'Storage is unavailable, try again later');
    if (error?.type === 'entity.too.large') return sendError(res, 413, `Body must not exceed ${BODY_LIMIT_KB} kB`);
    if (error?.type === 'entity.parse.failed') return sendError(res, 400, 'Body must be valid JSON');
    logError(error);
    sendError(res, 500, 'Internal server error');
  };
  app.use(handleError);

  return app;
}
