import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env.local') });
import { loadAuthorizedParcelInputs } from './src/infrastructure/db/parcelContextRepository';

async function run() {
  // Use a known Sada expediente ID if you have it. Wait, the user didn't give the ID.
  // I can query it from DB.
  const { db } = await import('./src/infrastructure/db/client');
  const { expedientes } = await import('./src/infrastructure/db/schema');
  const { eq, ilike } = await import('drizzle-orm');

  const exps = await db.select().from(expedientes).where(ilike(expedientes.municipio, '%sada%')).limit(5);
  for (const exp of exps) {
    console.log('Expediente:', exp.id, exp.municipio, exp.address);
    const inputs = await loadAuthorizedParcelInputs(exp.id, exp.ownerId);
    console.log(JSON.stringify(inputs?.detected?.urbanisticFacts, null, 2));
    break;
  }
}

run().catch(console.error).finally(() => process.exit(0));
