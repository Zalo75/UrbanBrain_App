require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query("DELETE FROM expedientes WHERE id = 'b5809641-73cd-4082-93c6-e92a861aeab5'");
    console.log('Deleted rows:', res.rowCount);
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}

run();
