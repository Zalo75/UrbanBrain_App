import { createClient } from '@supabase/supabase-js'

const BUCKET = 'expedientes'
const PAGE_SIZE = 100

function expedienteStoragePrefix(orgId: string, expedienteId: string) {
  return `organizations/${orgId}/expedientes/${expedienteId}/`
}

export async function deleteExpedienteStorageFiles({
  orgId,
  expedienteId,
  registeredPaths,
}: {
  orgId: string
  expedienteId: string
  registeredPaths: string[]
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Storage is not configured')

  const storage = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(BUCKET)
  const prefix = expedienteStoragePrefix(orgId, expedienteId)
  const folder = prefix.slice(0, -1)
  if (registeredPaths.some((path) => !path.startsWith(prefix))) {
    throw new Error('A registered document is outside the expediente storage scope')
  }
  const paths = new Set(registeredPaths)

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await storage.list(folder, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw new Error('Unable to inspect expediente storage')
    for (const file of data ?? []) paths.add(`${prefix}${file.name}`)
    if (!data || data.length < PAGE_SIZE) break
  }

  const allPaths = [...paths]
  for (let index = 0; index < allPaths.length; index += PAGE_SIZE) {
    const { error } = await storage.remove(allPaths.slice(index, index + PAGE_SIZE))
    if (error) throw new Error('Unable to delete expediente storage')
  }
}

export { expedienteStoragePrefix }
