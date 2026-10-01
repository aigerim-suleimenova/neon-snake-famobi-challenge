import type { Run, RunStatus } from '../ports/EventStore';
import { FAILURE_REASONS, type FailureReason } from './contract';

export interface Overview {
  sessions: number;
  runs: number;
  finished: number;
  unfinished: number;
  /** complete ÷ finished; `null` when no run has finished. */
  completionRate: number | null;
  /** runs ÷ sessions; `null` without runs. */
  runsPerSession: number | null;
}

export const PROGRESS_RANGES = ['0-19', '20-39', '40-59', '60-79', '80-99'] as const;
export type ProgressRange = (typeof PROGRESS_RANGES)[number];

export interface LevelStats {
  level: number;
  outcomes: Record<RunStatus, number>;
  completionRate: number | null;
  /** Average duration of complete, fail and quit runs, rounded to whole ms; `null` when none. */
  averageDurationMs: number | null;
  failedByProgress: Record<ProgressRange, number>;
  failedByReason: Record<FailureReason, number>;
}

const isFinished = (run: Run) => run.status !== 'unfinished';

function completionRate(runs: readonly Run[]): number | null {
  const finished = runs.filter(isFinished).length;
  if (finished === 0) return null;
  return runs.filter((run) => run.status === 'complete').length / finished;
}

function progressRange(progress: number): ProgressRange {
  return PROGRESS_RANGES[Math.min(PROGRESS_RANGES.length - 1, Math.floor(progress / 20))];
}

export function overview(runs: readonly Run[]): Overview {
  const sessions = new Set(runs.map((run) => run.sessionId)).size;
  const finished = runs.filter(isFinished).length;
  return {
    sessions,
    runs: runs.length,
    finished,
    unfinished: runs.length - finished,
    completionRate: completionRate(runs),
    runsPerSession: sessions === 0 ? null : runs.length / sessions
  };
}

function levelStats(level: number, runs: readonly Run[]): LevelStats {
  const outcomes: Record<RunStatus, number> = { complete: 0, fail: 0, quit: 0, unfinished: 0 };
  const failedByProgress = Object.fromEntries(PROGRESS_RANGES.map((range) => [range, 0])) as Record<ProgressRange, number>;
  const failedByReason = Object.fromEntries(FAILURE_REASONS.map((reason) => [reason, 0])) as Record<FailureReason, number>;
  const durations: number[] = [];

  for (const run of runs) {
    outcomes[run.status] += 1;
    if (isFinished(run) && run.durationMs !== null) durations.push(run.durationMs);
    if (run.status === 'fail') {
      if (run.progress !== null) failedByProgress[progressRange(run.progress)] += 1;
      if (run.failureReason !== null) failedByReason[run.failureReason] += 1;
    }
  }

  return {
    level,
    outcomes,
    completionRate: completionRate(runs),
    averageDurationMs:
      durations.length === 0 ? null : Math.round(durations.reduce((sum, ms) => sum + ms, 0) / durations.length),
    failedByProgress,
    failedByReason
  };
}

/** One entry per level with at least one run, in ascending level order. */
export function levels(runs: readonly Run[]): LevelStats[] {
  const byLevel = new Map<number, Run[]>();
  for (const run of runs) byLevel.set(run.level, [...(byLevel.get(run.level) ?? []), run]);
  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, levelRuns]) => levelStats(level, levelRuns));
}
