import { AppSidebar } from '@/components/layout/AppSidebar';
import { Header } from '@/components/layout/Header';
import { MobileNav } from '@/components/layout/MobileNav';
import { redirect } from 'next/navigation';
import { authProvider } from '@/infrastructure/auth';
import { db } from '@/infrastructure/db/client';
import { organizationMembers, organizations, profiles } from '@/infrastructure/db/schema';
import { eq } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

type Organization = InferSelectModel<typeof organizations>;
type Profile = InferSelectModel<typeof profiles>;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const userId = await authProvider.getUserId();
  if (!userId) {
    redirect('/login');
  }

  let activeOrg: Organization | null = null;
  let userProfile: Profile | null = null;
  let needsOnboarding = false;

  try {
    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.profileId, userId));
    if (memberships.length === 0) {
      needsOnboarding = true;
    } else {
      const orgId = memberships[0].orgId;
      const orgs = await db.select().from(organizations).where(eq(organizations.id, orgId));
      activeOrg = orgs[0];

      const profilesResult = await db.select().from(profiles).where(eq(profiles.id, userId));
      userProfile = profilesResult[0];

      if (!activeOrg || !userProfile) {
        needsOnboarding = true;
      }
    }
  } catch (error: unknown) {
    const err = error as Error & { code?: string };
    console.error('Database connection failed in Dashboard Layout:', err);
    if (
      err?.message?.includes('ECONNREFUSED') ||
      err?.code === 'ECONNREFUSED' ||
      err?.message?.includes('ENOTFOUND')
    ) {
      activeOrg = {
        id: 'temp',
        name: 'Mi Estudio (Sin BD)',
        slug: 'temp',
        plan: 'freemium',
        verificationStatus: 'pending',
        contactName: null,
        phone: null,
        province: null,
        verifiedAt: null,
        verifiedBy: null,
        createdAt: new Date(),
      } as unknown as Organization;
      userProfile = {
        id: userId,
        fullName: 'Usuario (Falta BD)',
        avatarUrl: null,
        createdAt: new Date(),
      } as unknown as Profile;
    } else {
      // If it's a "relation does not exist" or other error, better to let it crash or go to onboarding
      needsOnboarding = true;
    }
  }

  if (needsOnboarding) {
    redirect('/onboarding');
  }

  // Si llegamos aquí y siguen siendo null (y no hubo redirect ni fallback real), forzamos onboarding por seguridad
  if (!activeOrg || !userProfile) {
    redirect('/onboarding');
  }

  return (
    <div className="bg-background flex h-[100dvh] w-full overflow-hidden">
      <AppSidebar
        className="hidden w-64 shrink-0 md:flex"
        organization={activeOrg}
        userProfile={userProfile}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header userProfile={userProfile} />
        {activeOrg.verificationStatus === 'pending' && (
          <div className="flex justify-center border-b border-amber-200 bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            Tu cuenta profesional está pendiente de verificación. Te llamaremos para activar el
            acceso completo.
          </div>
        )}
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
        <div
          className="bg-background z-50 flex-shrink-0 border-t md:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <MobileNav className="h-16" />
        </div>
      </div>
    </div>
  );
}
