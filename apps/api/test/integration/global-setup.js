/* Creates the test database when missing and applies Prisma migrations. */
const { execSync } = require('child_process');
const path = require('path');
require('./setup-env');

const { PrismaClient } = require('@prisma/client');

const apiDir = path.resolve(__dirname, '../..');
const testUrl = process.env.DATABASE_URL;

function databaseName(url) {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Unsafe test database name: ${name}`);
  }
  return name;
}

module.exports = async function globalSetup() {
  const name = databaseName(testUrl);
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  adminUrl.searchParams.delete('schema');

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    const existing = await admin.$queryRawUnsafe(
      'SELECT 1 AS present FROM pg_database WHERE datname = $1',
      name,
    );
    if (!existing.length) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma migrate deploy', {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
};
