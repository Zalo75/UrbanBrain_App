require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query("SELECT e.org_id, m.profile_id FROM expedientes e JOIN organization_members m ON m.org_id = e.org_id WHERE e.id = 'a07f0f64-1c4b-4732-9378-7d0482124872' LIMIT 1;");
    console.log(res.rows[0].profile_id);
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}

run();
