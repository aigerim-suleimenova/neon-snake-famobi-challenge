import type { EventStore, Run, SaveResult } from '../ports/EventStore';
import type { AnalyticsEvent } from '../services/contract';
import { applyEvent, findConflict } from '../services/runRecord';

export interface StoredEvent {
  event: AnalyticsEvent;
  receivedAt: Date;
}

/** EventStore kept in memory, for tests and for running without the emulator. */
export class InMemoryEventStore implements EventStore {
  private readonly events = new Map<string, StoredEvent>();
  private readonly runs = new Map<string, Run>();

  async saveEvent(event: AnalyticsEvent, receivedAt: Date): Promise<SaveResult> {
    if (this.events.has(event.eventId)) return 'duplicate';

    const run = this.runs.get(event.runId);
    const conflict = findConflict(run, event);
    if (conflict) return { conflict };

    this.events.set(event.eventId, { event, receivedAt });
    this.runs.set(event.runId, applyEvent(run, event));
    return 'stored';
  }

  async listRuns(): Promise<Run[]> {
    return [...this.runs.values()];
  }

  async ping(): Promise<boolean> {
    return true;
  }

  storedEvents(): StoredEvent[] {
    return [...this.events.values()];
  }
}
