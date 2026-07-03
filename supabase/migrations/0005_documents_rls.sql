-- Activar RLS en la tabla documents
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;

-- Política para SELECT: Permitir ver documentos si el usuario pertenece a la organización del expediente
CREATE POLICY "Users can view documents of their organization's expedientes" 
ON "documents" 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM "expedientes" e
    JOIN "organization_members" om ON e."org_id" = om."org_id"
    WHERE e."id" = "documents"."expediente_id"
    AND om."profile_id" = auth.uid()
  )
);

-- Política para INSERT: Permitir insertar si el usuario pertenece a la organización del expediente
CREATE POLICY "Users can insert documents into their organization's expedientes" 
ON "documents" 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM "expedientes" e
    JOIN "organization_members" om ON e."org_id" = om."org_id"
    WHERE e."id" = "documents"."expediente_id"
    AND om."profile_id" = auth.uid()
  )
);

-- Política para UPDATE/DELETE (opcional para el futuro, pero lo dejamos preparado)
CREATE POLICY "Users can update documents of their organization's expedientes" 
ON "documents" 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM "expedientes" e
    JOIN "organization_members" om ON e."org_id" = om."org_id"
    WHERE e."id" = "documents"."expediente_id"
    AND om."profile_id" = auth.uid()
  )
);
