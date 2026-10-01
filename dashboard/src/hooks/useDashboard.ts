import { useEffect, useReducer } from 'react';

import type { StatsApi } from '../api/StatsApi';
import type { Clock } from '../clock';
import { toDashboardView, type DashboardView } from '../view/toDashboardView';

export type LoadStatus = 'loading' | 'ready' | 'refreshing' | 'error' | 'retrying';

interface Loaded {
  view: DashboardView;
  updatedAt: Date;
}

type State =
  | { status: 'loading'; request: number }
  | { status: 'ready' | 'refreshing'; request: number; loaded: Loaded }
  | { status: 'error' | 'retrying'; request: number };

type Action = { type: 'start' } | { type: 'succeeded'; loaded: Loaded } | { type: 'failed' };

/**
 * loading ─ok─▶ ready ─Refresh─▶ refreshing ─ok─▶ ready
 *    └─fail─▶ error ─Retry or Refresh─▶ retrying ─ok─▶ ready
 * Any failure leads to error. A start is ignored while a load runs, so at most one load is in flight.
 */
const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'start':
      if (state.status === 'ready') return { status: 'refreshing', request: state.request + 1, loaded: state.loaded };
      if (state.status === 'error') return { status: 'retrying', request: state.request + 1 };
      return state;
    case 'succeeded':
      return { status: 'ready', request: state.request, loaded: action.loaded };
    case 'failed':
      return { status: 'error', request: state.request };
  }
};

const pad = (n: number) => String(n).padStart(2, '0');
const statusText = (state: State): string => {
  if ('loaded' in state) return `Updated ${pad(state.loaded.updatedAt.getHours())}:${pad(state.loaded.updatedAt.getMinutes())}`;
  return state.status === 'loading' ? 'Loading…' : 'Offline';
};

export interface DashboardState {
  status: LoadStatus;
  /** The last loaded data; kept while refreshing, null while loading or offline. */
  view: DashboardView | null;
  statusText: string;
  canRefresh: boolean;
  canRetry: boolean;
  refresh(): void;
  retry(): void;
}

/** Loads both statistics on mount and on refresh() or retry(); never on its own otherwise. */
export const useDashboard = (api: StatsApi, clock: Clock): DashboardState => {
  const [state, dispatch] = useReducer(reducer, { status: 'loading', request: 0 });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api.getOverview(controller.signal), api.getLevels(controller.signal)]).then(
      ([overview, levels]) => {
        if (!controller.signal.aborted) dispatch({ type: 'succeeded', loaded: { view: toDashboardView(overview, levels), updatedAt: clock.now() } });
      },
      () => {
        if (!controller.signal.aborted) dispatch({ type: 'failed' });
      }
    );
    // Cancels the load on unmount (and StrictMode's extra effect run in development).
    return () => controller.abort();
  }, [api, clock, state.request]);

  const start = () => dispatch({ type: 'start' });

  return {
    status: state.status,
    view: 'loaded' in state ? state.loaded.view : null,
    statusText: statusText(state),
    canRefresh: state.status === 'ready' || state.status === 'error',
    canRetry: state.status === 'error',
    refresh: start,
    retry: start
  };
};
