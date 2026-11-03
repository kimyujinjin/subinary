import assert from 'node:assert/strict';
import test from 'node:test';
import { configSchema, validateEnv } from '../../packages/config/dist/index.mjs';

// Synthetic config objects only. Do not call loadConfig() or inspect process.env.
const config = configSchema.shape.financeConnections;
const KEY = '33'.repeat(32);
function requiredEnv() {
  return { NODE_ENV: 'test', API_PORT: '3001', WORKER_PORT: '3002', WEB_PORT: '3000',
    DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:5432/synthetic', REDIS_HOST: 'localhost', REDIS_PORT: '6379',
    BULLMQ_PREFIX: 'synthetic-test', STORAGE_ENDPOINT: 'http://localhost:9000', STORAGE_REGION: 'synthetic',
    STORAGE_ACCESS_KEY: 'synthetic', STORAGE_SECRET_KEY: 'synthetic', STORAGE_BUCKET: 'synthetic', STORAGE_FORCE_PATH_STYLE: 'false',
    JWT_ACCESS_SECRET: 'synthetic-jwt-value', DEVICE_SECRET_ENC_KEY: '44'.repeat(32) };
}

test('finance connections are disabled by default and accept disabled/empty environment configuration', () => {
  assert.deepEqual(config.parse(undefined), { enabled: false });
  assert.equal(config.parse({}).enabled, false);
  assert.equal(config.parse({ enabled: 'false' }).enabled, false);
  assert.equal(validateEnv(requiredEnv()).financeConnections.enabled, false);
  assert.equal(validateEnv({ ...requiredEnv(), FINANCE_CONNECTIONS_ENABLED: '',
    FINANCE_CONNECTION_VAULT_ACTIVE_VERSION: '', FINANCE_CONNECTION_VAULT_KEYS_JSON: '' }).financeConnections.enabled, false);
});

test('only the dedicated versioned configuration enables finance connections', () => {
  const result = validateEnv({ ...requiredEnv(), FINANCE_CONNECTIONS_ENABLED: 'true',
    FINANCE_CONNECTION_VAULT_ACTIVE_VERSION: '2', FINANCE_CONNECTION_VAULT_KEYS_JSON: JSON.stringify({ '1': KEY, '2': '55'.repeat(32) }) });
  assert.equal(result.financeConnections.enabled, true);
  assert.equal(result.financeConnections.activeKeyVersion, 2);
  assert.equal(result.financeConnections.keyring['2'], '55'.repeat(32));
  assert.throws(() => validateEnv({ ...requiredEnv(), FINANCE_CONNECTIONS_ENABLED: 'true' }), /dedicated active vault key/);
});

test('keyrings have bounded entries, canonical positive versions and exact AES-256 keys', () => {
  for (const keyring of [{}, [], null, { '0': KEY }, { '-1': KEY }, { '01': KEY }, { '1.5': KEY },
    { '2147483648': KEY }, { '1': 'a'.repeat(63) }, { '1': 'g'.repeat(64) }, { '1': KEY + '\n' },
    Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i + 1), KEY]))]) {
    assert.equal(config.safeParse({ enabled: true, activeKeyVersion: 1, keyring }).success, false);
  }
  assert.equal(config.safeParse({ enabled: true, activeKeyVersion: 2, keyring: { '1': KEY } }).success, false);
  assert.equal(config.safeParse({ enabled: true, activeKeyVersion: 1, keyring: { '1': KEY.toUpperCase() } }).success, true);
});

test('invalid keyring JSON and hostile keys do not enter configuration error output', () => {
  for (const keyring of ['SYNTHETIC_SECRET_NOT_JSON', '{"SYNTHETIC_SECRET_KEY_NAME":"SYNTHETIC_SECRET_VALUE"}',
    JSON.stringify({ '1': 'SYNTHETIC_SECRET_VALUE' }), 'x'.repeat(4097)]) {
    assert.throws(() => validateEnv({ ...requiredEnv(), FINANCE_CONNECTIONS_ENABLED: 'true',
      FINANCE_CONNECTION_VAULT_ACTIVE_VERSION: '1', FINANCE_CONNECTION_VAULT_KEYS_JSON: keyring }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /financeConnections/);
      assert.doesNotMatch(error.message, /SYNTHETIC_SECRET/);
      return true;
    });
  }
});
