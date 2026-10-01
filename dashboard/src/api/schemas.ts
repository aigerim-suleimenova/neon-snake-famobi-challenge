import { z } from 'zod';

// Mirrors the response shapes documented in backend/API.md. The dashboard keeps its own copy
// (the projects share no code); these checks turn a changed or broken backend into the error state.

const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(1).nullable();

export const OverviewSchema = z.object({
  sessions: count,
  runs: count,
  finished: count,
  unfinished: count,
  completionRate: rate,
  runsPerSession: z.number().nonnegative().nullable()
});

export const PROGRESS_RANGES = ['0-19', '20-39', '40-59', '60-79', '80-99'] as const;
export const FAILURE_REASONS = ['wall', 'snake', 'obstacle', 'external'] as const;

export const LevelStatsSchema = z.object({
  level: z.number().int().positive(),
  outcomes: z.object({ complete: count, fail: count, quit: count, unfinished: count }),
  completionRate: rate,
  averageDurationMs: count.nullable(),
  failedByProgress: z.object({ '0-19': count, '20-39': count, '40-59': count, '60-79': count, '80-99': count }),
  failedByReason: z.object({ wall: count, snake: count, obstacle: count, external: count })
});

export const LevelsResponseSchema = z.object({ levels: z.array(LevelStatsSchema) });

export type Overview = z.infer<typeof OverviewSchema>;
export type LevelStats = z.infer<typeof LevelStatsSchema>;
export type ProgressRange = (typeof PROGRESS_RANGES)[number];
export type FailureReason = (typeof FAILURE_REASONS)[number];
