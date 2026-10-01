import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { HttpStatsApi } from './api/HttpStatsApi';
import type { StatsApi } from './api/StatsApi';
import { App } from './App';
import { systemClock } from './clock';

import './styles/global.css';

const DEFAULT_API_URL = 'http://localhost:3000';

const createApi = async (): Promise<StatsApi> => {
  const sample = new URLSearchParams(location.search).get('sample');
  // The sample switch and its test double are left out of production builds.
  if (import.meta.env.DEV && sample !== null) return (await import('./devSample')).createSampleApi(sample);
  return new HttpStatsApi({ baseUrl: import.meta.env.VITE_API_URL || DEFAULT_API_URL, fetch: window.fetch.bind(window) });
};

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const api = await createApi();
createRoot(root).render(
  <StrictMode>
    <App api={api} clock={systemClock} />
  </StrictMode>
);
