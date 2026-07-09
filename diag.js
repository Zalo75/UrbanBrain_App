require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  const query = `
    SELECT e.id, e.name, e.province, e.municipio, e.created_at, COUNT(c.id) as message_count
    FROM expedientes e
    LEFT JOIN chat_messages c ON c.expediente_id = e.id
    GROUP BY e.id
    ORDER BY e.created_at DESC;
  `;

  try {
    const res = await client.query(query);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}

run();
