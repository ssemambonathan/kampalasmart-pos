/* Loaded before any test module so AppModule's config sees the test values. */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = line.slice(separator + 1).trim();
  }
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://kampala:kampala@localhost:5432/kampalasmart_test?schema=public';
process.env.JWT_ACCESS_SECRET = 'integration-test-secret-value-with-32-chars';
process.env.REDIS_URL = '';
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.LOGIN_RATE_WINDOW_SECONDS = '60';
process.env.COOKIE_SECURE = 'false';
process.env.LOG_LEVEL = 'error';
process.env.EMAIL_PROVIDER = '';
