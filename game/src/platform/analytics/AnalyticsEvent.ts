import type { RunEndReason } from '../../application/gameEvents';
import type { FailureReason } from '../../game/types';

/** Event contract, schema version 1, as documented in backend/API.md. */
export const SCHEMA_VERSION = 1;

interface EventBase {
  schemaVersion: typeof SCHEMA_VERSION;
  eventId: string;
  sessionId: string;
  runId: string;
  level: number;
  /** ISO 8601, UTC. */
  occurredAt: string;
}

export interface RunStartedEvent extends EventBase {
  type: 'run_started';
}

export interface RunEndedEvent extends EventBase {
  type: 'run_ended';
  outcome: RunEndReason;
  /** Set only when the outcome is `fail`. */
  failureReason: FailureReason | null;
  score: number;
  levelScore: number;
  /** Integer percentage of the level's fruit target: 100 for complete, below 100 otherwise. */
  progress: number;
  durationMs: number;
}

export type AnalyticsEvent = RunStartedEvent | RunEndedEvent;

/** Delivers analytics events. Never blocks or throws into gameplay. */
export interface EventSender {
  send(event: AnalyticsEvent): void;
}

/** Used when no backend URL is configured: analytics is off. */
export class NoopEventSender implements EventSender {
  send(): void {}
}
