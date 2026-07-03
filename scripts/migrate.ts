import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as dotenv from 'dotenv';
dotenv.config();

const runMigrate = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  
  console.log('Connecting to database...');
  // Transaction pooler might have issues with migration locks if not configured correctly,
  // but it usually works. If this fails, we can use Session pooler (port 5432).
  const migrationClient = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(migrationClient);
  
  console.log('Running migrations from supabase/migrations...');
  try {
    await migrate(db, { migrationsFolder: 'supabase/migrations' });
    console.log('Migrations applied successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await migrationClient.end();
  }
};

runMigrate().catch(console.error);
