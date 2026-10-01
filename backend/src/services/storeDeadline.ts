import type { EventStore } from '../ports/EventStore';

/** Below the game's 5 s request timeout, so the game receives the 503 instead of timing out. */
export const STORE_DEADLINE_MS = 3000;

/** The store did not answer in time; HTTP answers 503. */
export class StoreUnavailable extends Error {
  constructor(deadlineMs: number) {
    super(`Store did not answer within ${deadlineMs} ms`);
    this.name = 'StoreUnavailable';
  }
}

function withDeadline<T>(work: Promise<T>, deadlineMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StoreUnavailable(deadlineMs)), deadlineMs);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** Wraps every call of a store in a deadline. The store's own work is not cancelled. */
export function withStoreDeadline(store: EventStore, deadlineMs = STORE_DEADLINE_MS): EventStore {
  return {
    saveEvent: (event, receivedAt) => withDeadline(store.saveEvent(event, receivedAt), deadlineMs),
    listRuns: () => withDeadline(store.listRuns(), deadlineMs),
    ping: () => withDeadline(store.ping(), deadlineMs)
  };
}
