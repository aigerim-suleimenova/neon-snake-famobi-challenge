import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreEventStore } from './adapters/FirestoreEventStore';
import { systemClock } from './adapters/systemClock';
import { ConfigError, loadConfig, type Config } from './config';
import { createApp } from './http/createApp';
import { IngestionService } from './services/IngestionService';
import { StatsService } from './services/StatsService';
import { withStoreDeadline } from './services/storeDeadline';

// Composition root: the only place that knows every concrete part.
function readConfig(): Config {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}

const config = readConfig();
// firebase-admin connects to FIRESTORE_EMULATOR_HOST without credentials.
const firestore = getFirestore(initializeApp({ projectId: config.projectId }));
const store = withStoreDeadline(new FirestoreEventStore(firestore));

const app = createApp({
  ingestion: new IngestionService(store, systemClock),
  stats: new StatsService(store),
  health: store,
  allowedOrigins: config.allowedOrigins
});

app.listen(config.port, () => {
  console.log(`Analytics API on http://localhost:${config.port} (Firestore emulator ${config.emulatorHost}, project ${config.projectId})`);
});
