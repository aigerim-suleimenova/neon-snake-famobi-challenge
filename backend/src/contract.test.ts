import { readFileSync } from 'node:fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from './adapters/InMemoryEventStore';
import { createApp } from './http/createApp';
import { IngestionService } from './services/IngestionService';
import { StatsService } from './services/StatsService';
import { validateEvent } from './services/contract';

// The files in contract/ connect the three independent projects: the game's contract test produces events.json,
// this test checks the backend accepts it and serves exactly stats.json, and the dashboard's contract test parses
// stats.json. If a test here fails after an intended change, update the file and run all three projects' tests.
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../contract/${name}`, import.meta.url), 'utf8'));

const gameEvents = read('events.json') as unknown[];
const clock = { now: () => new Date('2026-10-01T12:30:00.000Z') };

function setup() {
  const store = new InMemoryEventStore();
  const app = createApp({
    ingestion: new IngestionService(store, clock),
    stats: new StatsService(store),
    health: store,
    allowedOrigins: []
  });
  return { app };
}

describe('contract with the game and the dashboard', () => {
  it('accepts every event the game produces', () => {
    const results = gameEvents.map((event) => validateEvent(event, clock.now()));

    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(gameEvents).toHaveLength(7);
  });

  it('stores the game events and serves exactly the statistics in contract/stats.json', async () => {
    const { app } = setup();

    const posted = await request(app).post('/api/events').send(gameEvents);
    expect(posted.status).toBe(202);
    expect(posted.body).toEqual({ accepted: gameEvents.length, duplicates: 0, rejected: [] });

    const overview = await request(app).get('/api/stats/overview');
    const levels = await request(app).get('/api/stats/levels');
    expect(overview.status).toBe(200);
    expect(levels.status).toBe(200);
    expect({ overview: overview.body, levels: levels.body }).toEqual(read('stats.json'));
  });
});
