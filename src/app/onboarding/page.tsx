import { redirect } from 'next/navigation'
import { authProvider } from '@/infrastructure/auth'
import { db } from '@/infrastructure/db/client'
import { organizationMembers, profiles } from '@/infrastructure/db/schema'
import { eq } from 'drizzle-orm'
import { createOrganization } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const metadata = {
  title: 'Crea tu Estudio - UrbanBrain',
}

export default async function OnboardingPage() {
  const userId = await authProvider.getUserId()
  if (!userId) {
    redirect('/login')
  }

  // Comprobar si el usuario ya tiene organización
  let greetingName = 'Arquitecto/a';
  let hasOrg = false;

  try {
    const memberships = await db.select().from(organizationMembers).where(eq(organizationMembers.profileId, userId))
    if (memberships.length > 0) {
      hasOrg = true;
    } else {
      // Obtener nombre para saludarle
      const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId))
      if (profile?.fullName) {
        greetingName = profile.fullName.split(' ')[0];
      }
    }
  } catch (error) {
    console.error("Database connection failed in Onboarding:", error)
    // Silencioso: asumimos que no tiene organización ni nombre para que pueda ver la UI
  }

  if (hasOrg) {
    redirect('/dashboard')
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-muted/30">
      <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[450px] p-8 bg-background rounded-xl border shadow-sm">
        <div className="flex flex-col space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Hola, {greetingName}
          </h1>
          <p className="text-sm text-muted-foreground">
            Para empezar a gestionar expedientes, necesitamos crear tu entorno de trabajo.
          </p>
        </div>

        <form action={createOrganization} className="space-y-6">
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="name" className="text-base">Nombre del estudio o profesional</Label>
              <Input
                id="name"
                name="name"
                type="text"
                placeholder="Ej: Estudio Otero Arquitectos"
                required
                className="h-12"
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="account_type" className="text-base">Tipo de cuenta</Label>
              <select
                id="account_type"
                name="account_type"
                required
                className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="independent_professional">Profesional independiente</option>
                <option value="studio_company">Estudio / empresa</option>
                <option value="public_administration">Administración pública</option>
                <option value="real_estate_developer">Inmobiliaria / promotora</option>
                <option value="other">Otro</option>
              </select>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="contact_name" className="text-base">Nombre de contacto</Label>
              <Input
                id="contact_name"
                name="contact_name"
                type="text"
                placeholder="Ej: Laura Martínez"
                required
                className="h-12"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="phone" className="text-base">Teléfono (España)</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                placeholder="Ej: +34 600 000 000"
                required
                className="h-12"
              />
              <p className="text-xs text-muted-foreground">Nos pondremos en contacto contigo para verificar el estudio.</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="province" className="text-base">Provincia (Opcional)</Label>
              <Input
                id="province"
                name="province"
                type="text"
                placeholder="Ej: Madrid"
                className="h-12"
              />
            </div>
          </div>
          
          <Button type="submit" className="w-full h-12 text-md">
            Comenzar a usar UrbanBrain
          </Button>
        </form>
      </div>
    </div>
  )
}
