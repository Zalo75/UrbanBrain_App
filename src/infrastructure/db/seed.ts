import { db, client } from './client';
import { organizations, profiles, organizationMembers } from './schema';
import { v4 as uuidv4 } from 'uuid';

async function seed() {
  console.log('🌱 Starting database seed...');

  try {
    // Generamos UUIDs fijos o aleatorios para el seed
    const orgId = uuidv4();
    const profileId = uuidv4(); // Idealmente debería mapear un ID real de auth.users si lo pruebas en local con Supabase

    // 1. Crear Organización
    const [org] = await db.insert(organizations).values({
      id: orgId,
      name: 'Estudio de Arquitectura Demo',
      slug: 'estudio-demo',
      plan: 'pro',
    }).returning();
    console.log('✅ Created Organization:', org.name);

    // 2. Crear Profile
    const [profile] = await db.insert(profiles).values({
      id: profileId,
      fullName: 'Arquitecto Demo',
      avatarUrl: null,
    }).returning();
    console.log('✅ Created Profile:', profile.fullName);

    // 3. Crear Relación Miembro
    await db.insert(organizationMembers).values({
      orgId: org.id,
      profileId: profile.id,
      role: 'owner',
    });
    console.log('✅ Created Organization Member link');

    console.log('🎉 Seed finished successfully!');
  } catch (error) {
    console.error('❌ Error during seed:', error);
  } finally {
    // Cerramos la conexión para que el script pueda finalizar
    await client.end();
  }
}

seed();
