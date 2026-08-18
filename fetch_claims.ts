import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });


import { desc, isNotNull } from 'drizzle-orm';
import fs from 'fs';

async function run() {
  const { db } = await import('./src/infrastructure/db/client');
  const { factualShadowEvaluations } = await import('./src/infrastructure/db/schema');
  
  const exps = await db.select()
    .from(factualShadowEvaluations)
    .where(isNotNull(factualShadowEvaluations.structuredOutput))
    .orderBy(desc(factualShadowEvaluations.createdAt))
    .limit(5);

  if (exps.length === 0) {
    console.log('No evaluations found in database.');
    process.exit(0);
  }

  for (const exp of exps) {
    const out = exp.structuredOutput as any;
    if (out && out.claims && out.claims.length === 13) {
      console.log('Found the 13 claims! Writing to output.json...');
      fs.writeFileSync('output.json', JSON.stringify(out, null, 2));
      process.exit(0);
    }
  }

  console.log('Writing the most recent one instead...');
  fs.writeFileSync('output.json', JSON.stringify(exps[0].structuredOutput, null, 2));
}

run().catch(console.error).finally(() => process.exit(0));
