import type { EventStore } from '../ports/EventStore';
import { levels, overview, type LevelStats, type Overview } from './stats';

/** Computes the statistics on request from all stored runs. */
export class StatsService {
  constructor(private readonly store: EventStore) {}

  async overview(): Promise<Overview> {
    return overview(await this.store.listRuns());
  }

  async levels(): Promise<LevelStats[]> {
    return levels(await this.store.listRuns());
  }
}
