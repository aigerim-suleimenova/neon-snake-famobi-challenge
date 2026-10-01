import type { AnalyticsEvent, FailureReason, Outcome } from '../services/contract';

export type RunStatus = 'unfinished' | Outcome;

/** One level attempt, summarised from its run_started and run_ended events. */
export interface Run {
  runId: string;
  sessionId: string;
  level: number;
  status: RunStatus;
  startedAt: string | null;
  endedAt: string | null;
  failureReason: FailureReason | null;
  score: number | null;
  levelScore: number | null;
  progress: number | null;
  durationMs: number | null;
  startEventId: string | null;
  endEventId: string | null;
}

/** A conflict names the field and the run, e.g. `level: run r1 is on level 1`. */
export type SaveResult = 'stored' | 'duplicate' | { conflict: string };

export interface EventStore {
  /** Stores the event and merges it into its run, atomically. Changes nothing for a duplicate or conflict. */
  saveEvent(event: AnalyticsEvent, receivedAt: Date): Promise<SaveResult>;
  listRuns(): Promise<Run[]>;
  /** Resolves `true` when the store is reachable. */
  ping(): Promise<boolean>;
}
