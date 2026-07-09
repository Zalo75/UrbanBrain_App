require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');

async function run() {
  const url = process.env.DATABASE_URL.replace(':5432', ':6543');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const sql = fs.readFileSync('migrate_phase1a.sql', 'utf8');
    await client.query(sql);
    
    // Check tables
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema='public' 
      AND table_name IN ('municipal_planning', 'planning_zones', 'afeccion_types', 'expediente_afecciones', 'context_detections');
    `);
    console.log('Tables created:', res.rows.map(r => r.table_name));
    
    // Seed afeccion_types
    await client.query(`
      INSERT INTO afeccion_types (category, name, description)
      VALUES 
      ('costas', 'DPMT', 'Dominio Público Marítimo Terrestre'),
      ('costas', 'Servidumbre Protección', 'Servidumbre de protección de costas'),
      ('aguas', 'DPH', 'Dominio Público Hidráulico'),
      ('aguas', 'Policía', 'Zona de policía de cauces'),
      ('patrimonio', 'BIC', 'Bien de Interés Cultural'),
      ('carreteras', 'Red Autonómica', 'Carreteras de la Xunta de Galicia')
      ON CONFLICT DO NOTHING;
    `);
    console.log('Seed executed successfully.');
    
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}

run();
