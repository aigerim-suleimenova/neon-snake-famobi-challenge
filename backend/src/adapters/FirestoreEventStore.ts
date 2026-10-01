import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import type { EventStore, Run, SaveResult } from '../ports/EventStore';
import type { AnalyticsEvent } from '../services/contract';
import { applyEvent, findConflict } from '../services/runRecord';

/**
 * EventStore on Firestore: `events/{eventId}` holds each event as validated plus `receivedAt`,
 * `runs/{runId}` one summary per run (the document ID is the run ID).
 */
export class FirestoreEventStore implements EventStore {
  constructor(private readonly db: Firestore) {}

  saveEvent(event: AnalyticsEvent, receivedAt: Date): Promise<SaveResult> {
    const eventRef = this.db.collection('events').doc(event.eventId);
    const runRef = this.db.collection('runs').doc(event.runId);

    return this.db.runTransaction(async (tx): Promise<SaveResult> => {
      const [stored, runSnapshot] = await tx.getAll(eventRef, runRef);
      if (stored.exists) return 'duplicate';

      const run = runSnapshot.exists ? toRun(runSnapshot) : undefined;
      const conflict = findConflict(run, event);
      if (conflict) return { conflict };

      const { runId: _, ...merged } = applyEvent(run, event);
      tx.create(eventRef, { ...event, receivedAt: Timestamp.fromDate(receivedAt) });
      tx.set(runRef, { ...merged, updatedAt: FieldValue.serverTimestamp() });
      return 'stored';
    });
  }

  async listRuns(): Promise<Run[]> {
    const snapshot = await this.db.collection('runs').get();
    return snapshot.docs.map(toRun);
  }

  async ping(): Promise<boolean> {
    await this.db.listCollections();
    return true;
  }
}

function toRun(snapshot: DocumentSnapshot): Run {
  const { updatedAt: _, ...data } = snapshot.data() as Omit<Run, 'runId'> & { updatedAt: unknown };
  return { runId: snapshot.id, ...data };
}
