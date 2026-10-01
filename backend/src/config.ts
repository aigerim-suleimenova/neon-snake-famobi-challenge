export interface Config {
  projectId: string;
  emulatorHost: string;
  port: number;
  allowedOrigins: string[];
}

/** Game dev server, game preview, dashboard. */
export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:5174'];
const DEFAULT_PORT = 3000;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Reads the configuration from environment variables. Refuses anything that could reach a real
 * Firebase project: an emulator host is required and the project ID must start with `demo-`.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const emulatorHost = env.FIRESTORE_EMULATOR_HOST?.trim();
  if (!emulatorHost) {
    throw new ConfigError(
      'FIRESTORE_EMULATOR_HOST is not set. This backend only runs against the Firestore emulator: ' +
        'start it with `pnpm emulators`, then start the API with `pnpm dev`.'
    );
  }

  const projectId = env.GCLOUD_PROJECT?.trim() ?? '';
  if (!projectId.startsWith('demo-')) {
    throw new ConfigError(
      `GCLOUD_PROJECT must be a demo project ID starting with "demo-" (got "${projectId}"), ` +
        'so no real Firebase project can be reached.'
    );
  }

  const port = env.PORT ? Number(env.PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be a port number (got "${env.PORT}").`);
  }

  const allowedOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;

  return { projectId, emulatorHost, port, allowedOrigins };
}
