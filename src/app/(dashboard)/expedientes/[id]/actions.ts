'use server'

import { authProvider } from '@/infrastructure/auth'
import { db } from '@/infrastructure/db/client'
import { expedientes, documents, organizationMembers } from '@/infrastructure/db/schema'
import { eq, and } from 'drizzle-orm'

export async function registerDocument(data: {
  expedienteId: string,
  filename: string,
  storagePath: string,
  documentType: 'planeamiento' | 'normativa' | 'catalogo' | 'ficha' | 'informe' | 'consulta' | 'otros'
}) {
  const userId = await authProvider.getUserId()
  if (!userId) {
    console.error("[ACTION: registerDocument] Error: Unauthorized (no userId)")
    throw new Error('Unauthorized')
  }

  // Verificar que el usuario pertenece a la organización del expediente
  console.log(`[ACTION: registerDocument] Verificando membresía para userId: ${userId}`)
  const memberships = await db.select().from(organizationMembers).where(eq(organizationMembers.profileId, userId))
  if (memberships.length === 0) {
    console.error("[ACTION: registerDocument] Error: No organization found for user")
    throw new Error('No organization found')
  }
  const orgId = memberships[0].orgId

  console.log(`[ACTION: registerDocument] Verificando acceso al expedienteId: ${data.expedienteId} para orgId: ${orgId}`)
  const [expediente] = await db
    .select()
    .from(expedientes)
    .where(and(eq(expedientes.id, data.expedienteId), eq(expedientes.orgId, orgId)))

  if (!expediente) {
    console.error("[ACTION: registerDocument] Error: Expediente not found or access denied")
    throw new Error('Expediente not found or access denied')
  }

  console.log(`[ACTION: registerDocument] Intentando insertar en DB tabla documents...`)
  // Insertar metadata en la tabla documents
  try {
    await db.insert(documents).values({
      expedienteId: data.expedienteId,
      filename: data.filename,
      storagePath: data.storagePath,
      documentType: data.documentType,
      uploadedBy: userId,
    })
    console.log(`[ACTION: registerDocument] Inserción exitosa`)
  } catch (error) {
    console.error("[ACTION: registerDocument] Error durante la inserción en documents:", error)
    throw error
  }

  return { success: true }
}

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getEmbeddingProvider } from '@/domain/services/embeddings'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { documentChunks } from '@/infrastructure/db/schema'

export async function processDocumentAction(documentId: string) {
  const userId = await authProvider.getUserId()
  if (!userId) throw new Error('Unauthorized')

  const memberships = await db.select().from(organizationMembers).where(eq(organizationMembers.profileId, userId))
  if (memberships.length === 0) throw new Error('No organization found')
  const orgId = memberships[0].orgId

  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId))
  if (!doc) throw new Error('Document not found')

  const [expediente] = await db
    .select()
    .from(expedientes)
    .where(and(eq(expedientes.id, doc.expedienteId), eq(expedientes.orgId, orgId)))
  
  if (!expediente) throw new Error('Expediente not found or access denied')

  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) { 
            try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
          },
        },
      }
    )

    // 1. Descargar archivo
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('expedientes')
      .download(doc.storagePath)

    if (downloadError || !fileData) {
      throw new Error(`Error downloading file: ${downloadError?.message}`)
    }

    // 2. Extraer texto con unpdf
    const { extractText } = await import('unpdf')
    
    console.log("Mime:", fileData.type)
    console.log("Size:", fileData.size)
    const buffer = Buffer.from(await fileData.arrayBuffer())
    
    console.log(
      "Magic bytes:",
      buffer.slice(0,20).toString("ascii")
    )
    console.log(
      "Magic hex:",
      buffer.slice(0,20).toString("hex")
    )
    let parsed
    try {
      // unpdf accepts Uint8Array which Buffer extends
      parsed = await extractText(new Uint8Array(buffer))
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error'
      throw new Error('Failed to parse PDF: ' + errorMsg)
    }

    const text = Array.isArray(parsed.text) ? parsed.text.join('\n') : String(parsed.text || '')
    
    if (text.trim().length < 50) {
      // Parece escaneado
      await db.update(documents)
        .set({ processed: false })
        .where(eq(documents.id, documentId))
      return { success: false, error: 'NO_TEXT', message: 'Este PDF parece escaneado y necesitará OCR en una versión posterior.' }
    }

    // 3. Chunking
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    })
    const chunks = await splitter.createDocuments([text])

    // 4. Embeddings
    const provider = getEmbeddingProvider()
    
    const textsToEmbed = chunks.map(c => c.pageContent.replace(/\n/g, ' '))
    
    // Batch procesar embeddings (en trozos para no exceder límites)
    const batchSize = 500;
    for (let i = 0; i < textsToEmbed.length; i += batchSize) {
      const batch = textsToEmbed.slice(i, i + batchSize);
      const batchChunks = chunks.slice(i, i + batchSize);
      
      const embeddings = await provider.generateEmbeddings(batch);

      // 5. Insertar en DB
      const inserts = batchChunks.map((chunk, idx) => ({
        documentId: doc.id,
        expedienteId: doc.expedienteId,
        content: chunk.pageContent,
        embedding: embeddings[idx],
        metadata: chunk.metadata,
      }))

      if (inserts.length > 0) {
        await db.insert(documentChunks).values(inserts)
      }
    }

    // 6. Actualizar estado
    await db.update(documents)
      .set({ processed: true, chunked: true, embedded: true })
      .where(eq(documents.id, documentId))

    return { success: true }
  } catch (error: unknown) {
    const err = error as Error
    console.error("[ACTION: processDocumentAction] Error:", err)
    return { success: false, error: 'PROCESSING_ERROR', message: err.message || 'Error desconocido' }
  }
}
