import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventStore } from '../ports/EventStore';
import { STORE_DEADLINE_MS, StoreUnavailable, withStoreDeadline } from './storeDeadline';

const never = () => new Promise<never>(() => {});

describe('withStoreDeadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes through answers that arrive in time', async () => {
    const store: EventStore = {
      saveEvent: async () => 'stored',
      listRuns: async () => [],
      ping: async () => true
    };
    const guarded = withStoreDeadline(store);

    expect(await guarded.ping()).toBe(true);
    expect(await guarded.listRuns()).toEqual([]);
  });

  it('fails every call with StoreUnavailable after 3 s without an answer', async () => {
    vi.useFakeTimers();
    const guarded = withStoreDeadline({ saveEvent: never, listRuns: never, ping: never });

    const calls = [guarded.ping(), guarded.listRuns()];
    calls.forEach((call) => call.catch(() => {}));
    await vi.advanceTimersByTimeAsync(STORE_DEADLINE_MS - 1);
    let settled = false;
    Promise.allSettled(calls).then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    for (const call of calls) await expect(call).rejects.toBeInstanceOf(StoreUnavailable);
  });

  it('passes store errors through unchanged', async () => {
    const failure = new Error('broken');
    const guarded = withStoreDeadline({ saveEvent: never, listRuns: () => Promise.reject(failure), ping: never });

    await expect(guarded.listRuns()).rejects.toBe(failure);
  });
});
