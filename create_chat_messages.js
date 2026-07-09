require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  const sql = `
    CREATE TABLE IF NOT EXISTS chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      expediente_id uuid REFERENCES expedientes(id) ON DELETE CASCADE,
      user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
      role text NOT NULL CHECK (role IN ('user', 'assistant')),
      content text NOT NULL,
      sources jsonb,
      created_at timestamp with time zone DEFAULT now()
    );
    
    CREATE INDEX IF NOT EXISTS chat_messages_expediente_id_idx ON chat_messages(expediente_id);
    CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx ON chat_messages(created_at);
  `;

  try {
    await client.query(sql);
    console.log("Table chat_messages created successfully.");
  } catch (e) {
    console.error("Error creating table:", e);
  } finally {
    await client.end();
  }
}

run().catch(console.error);
