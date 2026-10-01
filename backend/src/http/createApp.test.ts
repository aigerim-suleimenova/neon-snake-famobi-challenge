import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore } from '../adapters/InMemoryEventStore';
import type { EventStore } from '../ports/EventStore';
import { IngestionService } from '../services/IngestionService';
import { StatsService } from '../services/StatsService';
import { withStoreDeadline } from '../services/storeDeadline';
import { endEvent, startEvent } from '../test/events';
import { createApp } from './createApp';

const clock = { now: () => new Date('2026-10-01T12:00:00.000Z') };
const GAME_ORIGIN = 'http://localhost:5173';
const never = () => new Promise<never>(() => {});

function setup(store: EventStore = new InMemoryEventStore(), logError = vi.fn()) {
  const app = createApp({
    ingestion: new IngestionService(store, clock),
    stats: new StatsService(store),
    health: store,
    allowedOrigins: [GAME_ORIGIN],
    logError
  });
  return { app, store, logError };
}

/** A store that misses every deadline, as when the emulator hangs. */
const hangingStore = () => withStoreDeadline({ saveEvent: never, listRuns: never, ping: never }, 20);

describe('POST /api/events', () => {
  it('stores a JSON batch and answers 202 with the summary', async () => {
    const { app, store } = setup();

    const res = await request(app).post('/api/events').send([startEvent()]);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 1, duplicates: 0, rejected: [] });
    expect(await store.listRuns()).toHaveLength(1);
  });

  it('accepts a text/plain body as sent by sendBeacon', async () => {
    const { app, store } = setup();

    const res = await request(app)
      .post('/api/events')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(JSON.stringify([startEvent(), endEvent()]));

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 2, duplicates: 0, rejected: [] });
    expect(await store.listRuns()).toEqual([expect.objectContaining({ status: 'fail' })]);
  });

  it('lists invalid events and conflicts in rejected', async () => {
    const { app } = setup();
    await request(app).post('/api/events').send([startEvent()]);

    const res = await request(app)
      .post('/api/events')
      .send([startEvent(), endEvent({ level: 2 }), startEvent({ eventId: 'x', runId: 'r2', level: 0 })]);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      accepted: 0,
      duplicates: 1,
      rejected: [
        { index: 1, errors: ['level: run r1 is on level 1'] },
        { index: 2, errors: ['level: must be a positive integer'] }
      ]
    });
  });

  it.each([
    ['a single object', JSON.stringify(startEvent())],
    ['an empty array', '[]'],
    ['51 events', JSON.stringify(Array.from({ length: 51 }, (_, i) => startEvent({ eventId: `e${i}`, runId: `r${i}` })))]
  ])('answers 400 for %s and stores nothing', async (_, body) => {
    const { app, store } = setup();

    const res = await request(app).post('/api/events').set('Content-Type', 'application/json').send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { message: 'Body must be a JSON array of 1 to 50 events' } });
    expect(await store.listRuns()).toEqual([]);
  });

  it.each(['application/json', 'text/plain'])('answers 400 for invalid JSON sent as %s', async (type) => {
    const { app } = setup();

    const res = await request(app).post('/api/events').set('Content-Type', type).send('[{"eventId":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { message: 'Body must be valid JSON' } });
  });

  it('answers 400 for a body that is not JSON or text', async () => {
    const { app } = setup();

    const res = await request(app).post('/api/events').set('Content-Type', 'application/xml').send('<events/>');

    expect(res.status).toBe(400);
  });

  it.each(['application/json', 'text/plain'])('answers 413 for a %s body over 100 kB', async (type) => {
    const { app, store } = setup();
    const body = JSON.stringify([startEvent({ padding: 'x'.repeat(101 * 1024) })]);

    const res = await request(app).post('/api/events').set('Content-Type', type).send(body);

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: { message: 'Body must not exceed 100 kB' } });
    expect(await store.listRuns()).toEqual([]);
  });

  it('answers 503 when the store misses its deadline', async () => {
    const { app } = setup(hangingStore());

    const res = await request(app).post('/api/events').send([startEvent()]);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { message: 'Storage is unavailable, try again later' } });
  });

  it('answers 500 without internals for an unexpected error and logs it', async () => {
    const failure = new Error('disk on fire');
    const store: EventStore = { saveEvent: () => Promise.reject(failure), listRuns: never, ping: never };
    const { app, logError } = setup(store);

    const res = await request(app).post('/api/events').send([startEvent()]);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal server error' } });
    expect(logError).toHaveBeenCalledWith(failure);
  });
});

describe('GET /api/stats', () => {
  it('serves the overview and the levels', async () => {
    const { app } = setup();
    await request(app).post('/api/events').send([startEvent(), endEvent()]);

    const overview = await request(app).get('/api/stats/overview');
    const levels = await request(app).get('/api/stats/levels');

    expect(overview.status).toBe(200);
    expect(overview.body).toEqual({
      sessions: 1,
      runs: 1,
      finished: 1,
      unfinished: 0,
      completionRate: 0,
      runsPerSession: 1
    });
    expect(levels.status).toBe(200);
    expect(levels.body).toEqual({
      levels: [
        {
          level: 1,
          outcomes: { complete: 0, fail: 1, quit: 0, unfinished: 0 },
          completionRate: 0,
          averageDurationMs: 9000,
          failedByProgress: { '0-19': 0, '20-39': 0, '40-59': 1, '60-79': 0, '80-99': 0 },
          failedByReason: { wall: 1, snake: 0, obstacle: 0, external: 0 }
        }
      ]
    });
  });

  it.each(['/api/stats/overview', '/api/stats/levels'])('answers 503 on %s when the store misses its deadline', async (path) => {
    const { app } = setup(hangingStore());

    const res = await request(app).get(path);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { message: 'Storage is unavailable, try again later' } });
  });
});

describe('GET /api/health', () => {
  it('answers 200 when the store is reachable', async () => {
    const res = await request(setup().app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('answers 503 when the store misses its deadline', async () => {
    const res = await request(setup(hangingStore()).app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { message: 'Storage is unavailable' } });
  });

  it('answers 503 when the store reports it is unreachable', async () => {
    const store = new InMemoryEventStore();
    vi.spyOn(store, 'ping').mockResolvedValue(false);

    expect((await request(setup(store).app).get('/api/health')).status).toBe(503);
  });
});

describe('errors and CORS', () => {
  it('answers 404 in the error format for unknown routes', async () => {
    const res = await request(setup().app).get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { message: 'Not found' } });
  });

  it('lets an allowed origin read responses', async () => {
    const res = await request(setup().app).get('/api/health').set('Origin', GAME_ORIGIN);

    expect(res.headers['access-control-allow-origin']).toBe(GAME_ORIGIN);
    expect(res.headers.vary).toContain('Origin');
  });

  it('answers the preflight for a JSON post from an allowed origin', async () => {
    const res = await request(setup().app)
      .options('/api/events')
      .set('Origin', GAME_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(GAME_ORIGIN);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toMatch(/content-type/i);
  });

  it('gives a disallowed origin no CORS headers, so the browser hides the response', async () => {
    const app = setup().app;

    const get = await request(app).get('/api/stats/overview').set('Origin', 'https://evil.example');
    const preflight = await request(app)
      .options('/api/events')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(get.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-methods']).toBeUndefined();
  });
});
