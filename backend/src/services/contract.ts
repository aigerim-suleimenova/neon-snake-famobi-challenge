import { z } from 'zod';

/** Event contract, schema version 1. The written version lives in API.md. */
export const SCHEMA_VERSION = 1;

/** How far ahead of the server clock an event's time may be. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/** Most events one request may carry. */
export const MAX_BATCH_EVENTS = 50;

/** Safe as a Firestore document ID. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export const OUTCOMES = ['complete', 'fail', 'quit'] as const;
export const FAILURE_REASONS = ['wall', 'snake', 'obstacle', 'external'] as const;

export type Outcome = (typeof OUTCOMES)[number];
export type FailureReason = (typeof FAILURE_REASONS)[number];

interface EventBase {
  schemaVersion: typeof SCHEMA_VERSION;
  eventId: string;
  sessionId: string;
  runId: string;
  level: number;
  occurredAt: string;
}

export interface RunStartedEvent extends EventBase {
  type: 'run_started';
}

export interface RunEndedEvent extends EventBase {
  type: 'run_ended';
  outcome: Outcome;
  failureReason: FailureReason | null;
  score: number;
  levelScore: number;
  progress: number;
  durationMs: number;
}

export type AnalyticsEvent = RunStartedEvent | RunEndedEvent;

export type ValidationResult = { ok: true; event: AnalyticsEvent } | { ok: false; errors: string[] };

const id = z.string({ error: 'must be a string' }).regex(ID_PATTERN, {
  error: 'must be 1-100 letters, digits, "-" or "_"'
});
const nonNegativeInt = z.int({ error: 'must be a non-negative integer' }).min(0, {
  error: 'must be a non-negative integer'
});

const base = {
  schemaVersion: z.literal(SCHEMA_VERSION, { error: `must be ${SCHEMA_VERSION}` }),
  eventId: id,
  sessionId: id,
  runId: id,
  level: z.int({ error: 'must be a positive integer' }).min(1, { error: 'must be a positive integer' }),
  occurredAt: z.iso.datetime({ error: 'must be an ISO 8601 UTC time' })
};

const runStarted = z.object({
  ...base,
  type: z.literal('run_started'),
  failureReason: z.null({ error: 'must be absent or null for run_started' }).optional()
});

const runEnded = z
  .object({
    ...base,
    type: z.literal('run_ended'),
    outcome: z.enum(OUTCOMES, { error: `must be one of ${OUTCOMES.join(', ')}` }),
    failureReason: z
      .enum(FAILURE_REASONS, { error: `must be one of ${FAILURE_REASONS.join(', ')} or null` })
      .nullable()
      .optional(),
    score: nonNegativeInt,
    levelScore: nonNegativeInt,
    progress: z.int({ error: 'must be an integer from 0 to 100' }).min(0, {
      error: 'must be an integer from 0 to 100'
    }).max(100, { error: 'must be an integer from 0 to 100' }),
    durationMs: nonNegativeInt
  })
  .superRefine((event, ctx) => {
    if (event.outcome === 'fail' && event.failureReason == null) {
      ctx.addIssue({ code: 'custom', path: ['failureReason'], message: 'is required when outcome is fail' });
    }
    if (event.outcome !== 'fail' && event.failureReason != null) {
      ctx.addIssue({ code: 'custom', path: ['failureReason'], message: 'must be absent or null unless outcome is fail' });
    }
    if (event.outcome === 'complete' && event.progress !== 100) {
      ctx.addIssue({ code: 'custom', path: ['progress'], message: 'must be 100 when outcome is complete' });
    }
    if (event.outcome !== 'complete' && event.progress === 100) {
      ctx.addIssue({ code: 'custom', path: ['progress'], message: `must be below 100 when outcome is ${event.outcome}` });
    }
  });

const eventSchema = z.discriminatedUnion('type', [runStarted, runEnded], {
  error: (issue) =>
    typeof issue.input === 'object' && issue.input !== null
      ? 'must be one of run_started, run_ended'
      : 'must be an object'
});

function toEvent(parsed: z.infer<typeof eventSchema>): AnalyticsEvent {
  const { schemaVersion, eventId, sessionId, runId, level, occurredAt } = parsed;
  const common = { schemaVersion, eventId, sessionId, runId, level, occurredAt };
  if (parsed.type === 'run_started') return { ...common, type: 'run_started' };
  const { outcome, failureReason, score, levelScore, progress, durationMs } = parsed;
  return {
    ...common,
    type: 'run_ended',
    outcome,
    failureReason: failureReason ?? null,
    score,
    levelScore,
    progress,
    durationMs
  };
}

/**
 * Checks one incoming event against the contract. Unknown fields are dropped; each error
 * names the field it is about, e.g. `level: must be a positive integer`.
 */
export function validateEvent(input: unknown, now: Date): ValidationResult {
  const result = eventSchema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => `${issue.path.join('.') || 'event'}: ${issue.message}`)
    };
  }
  if (Date.parse(result.data.occurredAt) - now.getTime() > MAX_FUTURE_SKEW_MS) {
    return { ok: false, errors: ['occurredAt: must not be more than 5 minutes in the future'] };
  }
  return { ok: true, event: toEvent(result.data) };
}
