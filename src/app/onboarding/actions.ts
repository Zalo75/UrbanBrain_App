'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/infrastructure/db/client'
import { organizations, organizationMembers, profiles } from '@/infrastructure/db/schema'
import { authProvider } from '@/infrastructure/auth'

export async function createOrganization(formData: FormData) {
  const name = formData.get('name') as string
  if (!name || name.trim() === '') {
    redirect('/onboarding?error=invalid_name')
  }

  const contactName = formData.get('contact_name') as string
  if (!contactName || contactName.trim() === '') {
    redirect('/onboarding?error=invalid_contact')
  }

  const phone = formData.get('phone') as string
  const phoneClean = phone ? phone.replace(/\s+/g, '') : '';
  const phoneRegex = /^(\+34|0034|34)?[6789]\d{8}$/;
  if (!phoneClean || !phoneRegex.test(phoneClean)) {
    redirect('/onboarding?error=invalid_phone')
  }

  const accountTypeRaw = formData.get('account_type') as string || 'independent_professional'
  const accountType = accountTypeRaw as 'independent_professional' | 'studio_company' | 'public_administration' | 'real_estate_developer' | 'other'
  const province = formData.get('province') as string

  const userId = await authProvider.getUserId()
  if (!userId) {
    redirect('/login')
  }

  // Generar un slug simple
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).substring(2, 6)
  
  let success = false;

  try {
    // Transacción para crear el perfil, la organización y el miembro owner
    await db.transaction(async (tx) => {
      // 1. Insertar Profile (onConflictDoNothing en caso de que el trigger ya lo haya creado)
      await tx.insert(profiles).values({
        id: userId,
        fullName: contactName.trim(),
      }).onConflictDoNothing()

      // 2. Insertar Organization
      const [newOrg] = await tx.insert(organizations).values({
        name,
        slug,
        plan: 'freemium',
        accountType,
        contactName: contactName.trim(),
        phone: phoneClean,
        province: province ? province.trim() : null,
        verificationStatus: 'pending'
      }).returning({ id: organizations.id })

      // 3. Insertar OrganizationMember
      await tx.insert(organizationMembers).values({
        orgId: newOrg.id,
        profileId: userId,
        role: 'owner'
      })
    })
    success = true;
  } catch (error) {
    console.error('Error creating organization:', error)
  }

  if (!success) {
    redirect('/onboarding?error=creation_failed')
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
