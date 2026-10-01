import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import contractEvents from '../../../../contract/events.json';
import { GameController } from '../../application/GameController';
import { offlinePlatform } from '../../application/GamePlatform';
import type { GameStorage } from '../../core/storage/GameStorage';
import { SnakeGame } from '../../game/snakeGame';
import { spawnFoodAhead } from '../../test/spawnFoodAhead';
import type { AnalyticsEvent } from './AnalyticsEvent';
import { connectAnalytics } from './connectAnalytics';

const START = Date.parse('2026-10-01T12:00:00.000Z');
const TICK_MS = 150;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The real controller and simulation with the offline platform; fruit always spawns in front of the snake. */
const setup = () => {
  const simulation = new SnakeGame();
  spawnFoodAhead(simulation);
  const storage: GameStorage = {
    loadProfile: () => ({ bestScore: 0, highestUnlockedLevel: 1, totalRuns: 0, playerMuted: false }),
    saveProfile: () => {}
  };
  const controller = new GameController(simulation, storage, offlinePlatform);
  const sent: AnalyticsEvent[] = [];
  let counter = 0;
  connectAnalytics(controller.events, { send: (event) => sent.push(event) }, () => `id-${(counter += 1)}`);

  /** Advances the game by up to `count` steps, stopping when the level ends. */
  const play = async (count: number) => {
    for (let step = 0; step < count && controller.getSnapshot().phase === 'playing'; step += 1) {
      vi.setSystemTime(Date.now() + TICK_MS);
      controller.tick();
    }
    await flush();
  };
  return { controller, sent, play };
};

beforeEach(() => {
  vi.stubGlobal('window', {});
  vi.useFakeTimers({ toFake: ['Date'], now: START });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('analytics contract', () => {
  // contract/events.json is also validated by the backend's contract test. If this test fails because the game's
  // events changed on purpose, update the file and check that the backend still accepts it.
  it('produces exactly the events in contract/events.json', async () => {
    const { controller, sent, play } = setup();

    await controller.startNewGame();
    await play(10);
    expect(controller.getSnapshot().phase).toBe('level-complete');

    await controller.goToNextLevel();
    await play(10);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'game-over', failureReason: 'obstacle' });

    await controller.restartLevel();
    await play(1);
    await controller.quitToMenu();
    await flush();

    await controller.startAtLevel(1);
    await play(1);

    expect(sent).toEqual(contractEvents);
  });
});
