-- Activar RLS en la tabla profiles
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;

-- Política 1: Los usuarios pueden leer su propio perfil
CREATE POLICY "Users can view own profile" 
ON "profiles" 
FOR SELECT 
USING (auth.uid() = id);

-- Política 2: Los usuarios pueden actualizar su propio perfil
CREATE POLICY "Users can update own profile" 
ON "profiles" 
FOR UPDATE 
USING (auth.uid() = id);

-- Política 3: Los usuarios pueden insertar su propio perfil (generalmente vía trigger en auth.users, pero se permite aquí por seguridad)
CREATE POLICY "Users can insert own profile" 
ON "profiles" 
FOR INSERT 
WITH CHECK (auth.uid() = id);

-- Activar RLS para organizaciones y miembros (Políticas básicas para V1)
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_members" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view organizations they belong to" 
ON "organizations" 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM "organization_members" 
    WHERE "organization_members"."organization_id" = "organizations"."id" 
    AND "organization_members"."user_id" = auth.uid()
  )
);

CREATE POLICY "Users can view their own memberships" 
ON "organization_members" 
FOR SELECT 
USING (auth.uid() = user_id);
