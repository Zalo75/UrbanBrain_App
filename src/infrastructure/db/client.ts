import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const isProduction = process.env.NODE_ENV === 'production';
const maxConnections = isProduction ? 3 : 1;

type PostgresClient = ReturnType<typeof postgres>;
type DrizzleDatabase = ReturnType<typeof drizzle<typeof schema>>;
type DatabaseGlobals = typeof globalThis & {
  __urbanbrainPostgresClient?: PostgresClient;
  __urbanbrainDrizzleDatabase?: DrizzleDatabase;
};

const databaseGlobals = globalThis as DatabaseGlobals;

// Keep one pool across Next.js development module reloads. Supabase session mode
// has a small fixed pool, so the postgres.js default of 10 is intentionally avoided.
export const client =
  (!isProduction && databaseGlobals.__urbanbrainPostgresClient) ||
  postgres(connectionString, {
    prepare: false,
    max: maxConnections,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
  });

export const db =
  (!isProduction && databaseGlobals.__urbanbrainDrizzleDatabase) ||
  drizzle(client, { schema });

if (!isProduction) {
  databaseGlobals.__urbanbrainPostgresClient = client;
  databaseGlobals.__urbanbrainDrizzleDatabase = db;
}
