require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(`
      ALTER TABLE expedientes 
      ADD COLUMN IF NOT EXISTS planeamiento text,
      ADD COLUMN IF NOT EXISTS contexto_validado_por_tecnico boolean DEFAULT false NOT NULL;
    `);
    console.log('Migration executed.');
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}

run();
