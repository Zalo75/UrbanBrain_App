'use client'

import { FileCheck2, FileText, Loader2, Plus, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { hasOrganizationPermission, type OrganizationRole } from '@/application/authorization/organizationRoles'
import { Button } from '@/components/ui/button'
import { createClient } from '@/infrastructure/supabase/client'
import { prepareDocumentUpload, registerDocument } from './actions'

type Document = {
  id: string
  filename: string
  documentType: string
  uploadedAt: Date
  processed: boolean
}

export function DocumentList({ expedienteId, documents, membershipRole }: {
  expedienteId: string
  documents: Document[]
  membershipRole: OrganizationRole
}) {
  const router = useRouter()
  const [isUploading, setIsUploading] = useState(false)
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [documentType, setDocumentType] = useState('planeamiento')
  const canUpload = hasOrganizationPermission(membershipRole, 'document.upload')

  async function handleUpload() {
    if (!selectedFile || !canUpload || isUploading) return
    setIsUploading(true)
    try {
      const { storagePath, token } = await prepareDocumentUpload({
        expedienteId,
        filename: selectedFile.name,
        contentType: selectedFile.type,
        size: selectedFile.size,
      })
      const { error } = await createClient().storage.from('expedientes').uploadToSignedUrl(storagePath, token, selectedFile, { contentType: selectedFile.type })
      if (error) {
        alert('No se ha podido subir el archivo.')
        return
      }
      await registerDocument({
        expedienteId,
        filename: selectedFile.name,
        storagePath,
        documentType: documentType as 'planeamiento' | 'normativa' | 'catalogo' | 'ficha' | 'informe' | 'consulta' | 'otros',
      })
      setShowUploadForm(false)
      setSelectedFile(null)
      router.refresh()
    } catch {
      alert('No se ha podido registrar el documento.')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-muted-foreground" /> Documentos base
        </h2>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowUploadForm(!showUploadForm)} disabled={!canUpload} aria-label={canUpload ? 'Subir documento' : 'Tu rol es de solo lectura'}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {showUploadForm && canUpload && (
        <div className="flex flex-col gap-3 border-b bg-zinc-100/50 p-4 dark:bg-zinc-900/50">
          <input type="file" accept="application/pdf" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-primary file:px-2 file:py-1 file:text-xs file:text-primary-foreground" />
          <select value={documentType} onChange={(event) => setDocumentType(event.target.value)} className="w-full rounded-md border bg-background px-2 py-1.5 text-xs">
            <option value="planeamiento">Planeamiento</option><option value="normativa">Normativa</option><option value="catalogo">Catálogo</option><option value="ficha">Ficha</option><option value="informe">Informe</option><option value="consulta">Consulta</option><option value="otros">Otros</option>
          </select>
          <Button size="sm" className="h-8 w-full text-xs" onClick={handleUpload} disabled={!selectedFile || isUploading}>
            {isUploading ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Upload className="mr-2 h-3 w-3" />} Subir documento
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {documents.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border bg-zinc-100 dark:bg-zinc-900"><FileText className="h-5 w-5 text-muted-foreground" /></div>
            <p className="text-sm font-medium">Sin documentos</p>
            <p className="mt-1 max-w-[220px] text-xs text-muted-foreground">Puede adjuntar documentación al expediente. Su procesamiento automático no está disponible en esta beta.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div key={doc.id} className="flex flex-col gap-2 rounded-lg border bg-background p-3 shadow-sm">
                <div className="flex items-center gap-2 overflow-hidden"><FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate text-sm font-medium" title={doc.filename}>{doc.filename}</span></div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-secondary-foreground">{doc.documentType}</span>
                  {doc.processed ? (
                    <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500"><FileCheck2 className="h-3.5 w-3.5" /> Procesado</span>
                  ) : (
                    <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" disabled title="Procesamiento no disponible durante la beta privada">Procesamiento próximamente</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
