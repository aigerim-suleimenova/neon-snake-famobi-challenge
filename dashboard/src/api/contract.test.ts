// @vitest-environment node
import { describe, expect, it } from 'vitest';

import contractStats from '../../../contract/stats.json';
import { toDashboardView } from '../view/toDashboardView';
import { HttpStatsApi } from './HttpStatsApi';

// contract/stats.json is what the backend's contract test proves the API serves for the game's events.
// If this test fails, the dashboard no longer reads the backend's answers.

/** Serves the contract file the way the backend would. */
const fetchContract: typeof fetch = async (input) => {
  const path = new URL(String(input)).pathname;
  const body = path === '/api/stats/overview' ? contractStats.overview : path === '/api/stats/levels' ? contractStats.levels : null;
  return body ? Response.json(body) : new Response('not found', { status: 404 });
};

describe('contract with the backend', () => {
  it('reads the statistics the backend serves', async () => {
    const api = new HttpStatsApi({ baseUrl: 'http://localhost:3000', fetch: fetchContract });

    const overview = await api.getOverview();
    const levels = await api.getLevels();
    const view = toDashboardView(overview, levels);

    expect(view.kpis.map((kpi) => kpi.value)).toEqual(['1', '4', '3', '1', '33.3%', '4.00']);
    expect(view.completion.map((row) => row.valueText)).toEqual(['100.0%', '0.0%']);
    expect(view.table.map((row) => [row.label, row.runs, row.mostFailsAt, row.topReason])).toEqual([
      ['L1', '2', '—', '—'],
      ['L2', '2', '20–39%', 'Obstacle · 1']
    ]);
  });
});
