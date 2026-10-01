import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_ALLOWED_ORIGINS, loadConfig } from './config';

const env = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCLOUD_PROJECT: 'demo-neon-snake' };

describe('loadConfig', () => {
  it('reads the emulator settings with default port and origins', () => {
    expect(loadConfig(env)).toEqual({
      projectId: 'demo-neon-snake',
      emulatorHost: '127.0.0.1:8080',
      port: 3000,
      allowedOrigins: DEFAULT_ALLOWED_ORIGINS
    });
  });

  it('reads the port and a comma-separated origin list', () => {
    const config = loadConfig({ ...env, PORT: '4100', ALLOWED_ORIGINS: 'http://a.test, http://b.test,' });

    expect(config.port).toBe(4100);
    expect(config.allowedOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('refuses to start without an emulator host and explains how to start it', () => {
    expect(() => loadConfig({ GCLOUD_PROJECT: 'demo-neon-snake' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, FIRESTORE_EMULATOR_HOST: ' ' })).toThrow(/pnpm emulators/);
  });

  it.each([undefined, 'neon-snake', 'my-demo-project'])('refuses the project ID %j', (GCLOUD_PROJECT) => {
    expect(() => loadConfig({ ...env, GCLOUD_PROJECT })).toThrow(/demo-/);
  });

  it.each(['abc', '0', '70000'])('refuses the port %j', (PORT) => {
    expect(() => loadConfig({ ...env, PORT })).toThrow(/PORT/);
  });
});
