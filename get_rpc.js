require('dotenv').config();
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(() => {
  return client.query("SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'match_normativa_chunks';");
}).then(res => {
  console.log(res.rows[0]?.pg_get_functiondef);
  client.end();
}).catch(console.error);
