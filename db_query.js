require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  console.log("--- TABLE STRUCTURE ---");
  const tableRes = await client.query(`
    select column_name, data_type
    from information_schema.columns
    where table_schema='public'
    and table_name='normativa_chunks'
    order by ordinal_position;
  `);
  console.table(tableRes.rows);

  console.log("\n--- FUNCTION DEFINITION ---");
  const funcRes = await client.query(`
    SELECT pg_get_functiondef(oid) 
    FROM pg_proc 
    WHERE proname = 'match_normativa_chunks';
  `);
  
  if (funcRes.rows.length > 0) {
    console.log(funcRes.rows[0].pg_get_functiondef);
  } else {
    console.log("Function 'match_normativa_chunks' not found.");
  }
  
  await client.end();
}

run().catch(console.error);
