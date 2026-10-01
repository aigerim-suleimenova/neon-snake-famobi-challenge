import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { endEvent, startEvent, validated } from '../test/events';
import { FirestoreEventStore } from './FirestoreEventStore';

// `firebase emulators:exec` sets both variables.
const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT ?? 'demo-neon-snake';
if (!host) throw new Error('Run these tests with `pnpm test:emulator`.');

const app = initializeApp({ projectId }, 'firestore-adapter-test');
const db = getFirestore(app);
const store = new FirestoreEventStore(db);
const receivedAt = new Date('2026-10-01T12:00:00.000Z');

beforeEach(async () => {
  const res = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error(`Could not clear the emulator: ${res.status}`);
});

afterAll(() => deleteApp(app));

const expectedRun = {
  runId: 'r1',
  sessionId: 's1',
  level: 1,
  status: 'fail',
  startedAt: '2026-10-01T11:59:00.000Z',
  endedAt: '2026-10-01T11:59:09.000Z',
  failureReason: 'wall',
  score: 30,
  levelScore: 30,
  progress: 43,
  durationMs: 9000,
  startEventId: 'start-r1',
  endEventId: 'end-r1'
};

describe('FirestoreEventStore (emulator)', () => {
  it('stores the event with receivedAt and creates the run', async () => {
    expect(await store.saveEvent(validated(startEvent()), receivedAt)).toBe('stored');

    const event = (await db.collection('events').doc('start-r1').get()).data();
    expect(event).toMatchObject({ ...startEvent() });
    expect(event?.receivedAt.toDate()).toEqual(receivedAt);

    const run = (await db.collection('runs').doc('r1').get()).data();
    expect(run).toMatchObject({ sessionId: 's1', level: 1, status: 'unfinished', startEventId: 'start-r1' });
    expect(run?.updatedAt).toBeDefined();
    expect(await store.listRuns()).toEqual([
      expect.objectContaining({ runId: 'r1', status: 'unfinished', endedAt: null })
    ]);
  });

  it('reports a resent event as a duplicate and changes nothing', async () => {
    await store.saveEvent(validated(startEvent()), receivedAt);
    const before = (await db.collection('runs').doc('r1').get()).data();

    expect(await store.saveEvent(validated(startEvent()), new Date())).toBe('duplicate');

    expect((await db.collection('runs').doc('r1').get()).data()).toEqual(before);
    expect((await db.collection('events').doc('start-r1').get()).data()?.receivedAt.toDate()).toEqual(receivedAt);
  });

  it('rejects a conflicting event and changes nothing', async () => {
    await store.saveEvent(validated(startEvent()), receivedAt);
    const before = (await db.collection('runs').doc('r1').get()).data();

    expect(await store.saveEvent(validated(endEvent({ level: 2 })), receivedAt)).toEqual({
      conflict: 'level: run r1 is on level 1'
    });

    expect((await db.collection('runs').doc('r1').get()).data()).toEqual(before);
    expect((await db.collection('events').doc('end-r1').get()).exists).toBe(false);
  });

  it('merges start then end into the finished run', async () => {
    await store.saveEvent(validated(startEvent()), receivedAt);
    await store.saveEvent(validated(endEvent()), receivedAt);

    expect(await store.listRuns()).toEqual([expectedRun]);
  });

  it('merges end then start into the same run', async () => {
    await store.saveEvent(validated(endEvent()), receivedAt);
    await store.saveEvent(validated(startEvent()), receivedAt);

    expect(await store.listRuns()).toEqual([expectedRun]);
  });

  it('answers a ping', async () => {
    expect(await store.ping()).toBe(true);
  });
});
