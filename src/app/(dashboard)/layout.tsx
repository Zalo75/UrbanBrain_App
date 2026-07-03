import { AppSidebar } from "@/components/layout/AppSidebar"
import { Header } from "@/components/layout/Header"
import { MobileNav } from "@/components/layout/MobileNav"
import { redirect } from 'next/navigation'
import { authProvider } from '@/infrastructure/auth'
import { db } from '@/infrastructure/db/client'
import { organizationMembers, organizations, profiles } from '@/infrastructure/db/schema'
import { eq } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'

type Organization = InferSelectModel<typeof organizations>
type Profile = InferSelectModel<typeof profiles>

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const userId = await authProvider.getUserId()
  if (!userId) {
    redirect('/login')
  }

  let activeOrg: Organization | null = null;
  let userProfile: Profile | null = null;
  let needsOnboarding = false;

  try {
    const memberships = await db.select().from(organizationMembers).where(eq(organizationMembers.profileId, userId))
    if (memberships.length === 0) {
      needsOnboarding = true;
    } else {
      const orgId = memberships[0].orgId
      const orgs = await db.select().from(organizations).where(eq(organizations.id, orgId))
      activeOrg = orgs[0]
      
      const profilesResult = await db.select().from(profiles).where(eq(profiles.id, userId))
      userProfile = profilesResult[0]
      
      if (!activeOrg || !userProfile) {
        needsOnboarding = true;
      }
    }
  } catch (error: unknown) {
    const err = error as Error & { code?: string };
    console.error("Database connection failed in Dashboard Layout:", err)
    if (err?.message?.includes('ECONNREFUSED') || err?.code === 'ECONNREFUSED' || err?.message?.includes('ENOTFOUND')) {
      activeOrg = { 
        id: 'temp', name: 'Mi Estudio (Sin BD)', slug: 'temp', plan: 'freemium', 
        verificationStatus: 'pending', contactName: null, phone: null, province: null, verifiedAt: null, verifiedBy: null, createdAt: new Date() 
      } as unknown as Organization;
      userProfile = { id: userId, fullName: 'Usuario (Falta BD)', avatarUrl: null, createdAt: new Date() } as unknown as Profile;
    } else {
      // If it's a "relation does not exist" or other error, better to let it crash or go to onboarding
      needsOnboarding = true;
    }
  }

  if (needsOnboarding) {
    redirect('/onboarding')
  }

  // Si llegamos aquí y siguen siendo null (y no hubo redirect ni fallback real), forzamos onboarding por seguridad
  if (!activeOrg || !userProfile) {
    redirect('/onboarding')
  }

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      <AppSidebar 
        className="hidden md:flex w-64" 
        organization={activeOrg} 
        userProfile={userProfile} 
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header userProfile={userProfile} />
        {activeOrg.verificationStatus === 'pending' && (
          <div className="bg-amber-100 dark:bg-amber-900/40 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm py-2 px-4 flex justify-center text-center font-medium">
            Tu cuenta profesional está pendiente de verificación. Te llamaremos para activar el acceso completo.
          </div>
        )}
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0 relative">
          {children}
        </main>
        <MobileNav className="md:hidden absolute bottom-0 left-0 right-0 h-16 border-t z-50" />
      </div>
    </div>
  )
}
