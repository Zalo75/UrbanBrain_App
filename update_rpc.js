require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  const sql = `
    DROP FUNCTION IF EXISTS public.match_normativa_chunks(vector, integer, text);

    CREATE OR REPLACE FUNCTION public.match_normativa_chunks(
      query_embedding vector(768),
      match_count int DEFAULT 10,
      filter_municipio text DEFAULT NULL
    )
    RETURNS TABLE (
      chunk_id text,
      municipio_nombre text,
      nombre_pdf text,
      titulo_detectado text,
      texto text,
      similarity double precision,
      original_path text,
      pagina_detectada text,
      fragmento_corto text
    )
    LANGUAGE sql
    STABLE
    AS $$
      SELECT
        nc.chunk_id,
        nc.municipio_nombre,
        nc.nombre_pdf,
        nc.titulo_detectado,
        nc.texto,
        1 - (nc.embedding <=> query_embedding) AS similarity,
        nc.ruta_pdf AS original_path,
        
        substring(nc.texto from '--- PAGINA (\\d+) ---') AS pagina_detectada,
        
        trim(substring(replace(nc.texto, E'\\n', ' '), 1, 150)) || '...' AS fragmento_corto

      FROM public.normativa_chunks nc
      WHERE
        filter_municipio IS NULL
        OR nc.municipio_nombre ILIKE '%' || filter_municipio || '%'
      ORDER BY nc.embedding <=> query_embedding
      LIMIT match_count;
    $$;
  `;

  try {
    await client.query(sql);
    console.log("RPC updated successfully.");
  } catch (e) {
    console.error("Error updating RPC:", e);
  } finally {
    await client.end();
  }
}

run().catch(console.error);
