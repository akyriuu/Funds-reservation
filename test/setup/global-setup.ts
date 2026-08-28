import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';

declare global {
  // eslint-disable-next-line no-var
  var __POSTGRES__: StartedPostgreSqlContainer | undefined;
}

export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('hold_system_test')
    .withUsername('hold')
    .withPassword('hold')
    .start();

  const databaseUrl = container.getConnectionUri();

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_POOL_MAX = '30';
  process.env.HOLD_EXPIRATION_ENABLED = 'false';

  globalThis.__POSTGRES__ = container;
}