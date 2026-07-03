-- Habilitar RLS en las nuevas tablas
ALTER TABLE "normativa_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "normativa_chunks" ENABLE ROW LEVEL SECURITY;

-- Política: Lectura pública para cualquier usuario autenticado en normativa_documents
CREATE POLICY "Lectura publica de normativa_documents para usuarios autenticados" 
ON "normativa_documents" 
FOR SELECT 
TO authenticated 
USING (true);

-- Política: Lectura pública para cualquier usuario autenticado en normativa_chunks
CREATE POLICY "Lectura publica de normativa_chunks para usuarios autenticados" 
ON "normativa_chunks" 
FOR SELECT 
TO authenticated 
USING (true);
