'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Plus, Upload, Loader2, FileCheck2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/infrastructure/supabase/client'
import { registerDocument, processDocumentAction } from './actions'

type Document = {
  id: string;
  filename: string;
  documentType: string;
  uploadedAt: Date;
  processed: boolean;
}

export function DocumentList({ 
  expedienteId, 
  orgId, 
  documents 
}: { 
  expedienteId: string, 
  orgId: string,
  documents: Document[] 
}) {
  const router = useRouter()
  const [isUploading, setIsUploading] = useState(false)
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [documentType, setDocumentType] = useState<string>('planeamiento')
  const [processingId, setProcessingId] = useState<string | null>(null)

  const handleProcess = async (docId: string) => {
    setProcessingId(docId)
    try {
      const result = await processDocumentAction(docId)
      if (!result.success) {
        alert(`Error al procesar: ${result.message}`)
      } else {
        router.refresh()
      }
    } catch (error) {
      console.error(error)
      alert("Error inesperado al procesar el documento")
    } finally {
      setProcessingId(null)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0])
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) return
    setIsUploading(true)

    try {
      console.log(`[CLIENT: DocumentList] Iniciando proceso para archivo: ${selectedFile.name}`)
      const supabase = createClient()
      const timestamp = Date.now()
      const storagePath = `organizations/${orgId}/expedientes/${expedienteId}/${timestamp}-${selectedFile.name}`

      console.log(`[CLIENT: DocumentList] 1. Subiendo al bucket 'expedientes' en la ruta: ${storagePath}`)
      // Subir al bucket 'expedientes'
      const { error: uploadError } = await supabase
        .storage
        .from('expedientes')
        .upload(storagePath, selectedFile)

      if (uploadError) {
        console.error("[CLIENT: DocumentList] Error en subida al bucket:", uploadError)
        alert(`Error al subir archivo: ${uploadError.message}`)
        setIsUploading(false)
        return
      }
      
      console.log(`[CLIENT: DocumentList] 2. Subida exitosa. Registrando metadata mediante Server Action...`)
      // Registrar metadata en DB
      await registerDocument({
        expedienteId,
        filename: selectedFile.name,
        storagePath,
        documentType: documentType as 'planeamiento' | 'normativa' | 'catalogo' | 'ficha' | 'informe' | 'consulta' | 'otros',
      })
      
      console.log(`[CLIENT: DocumentList] 3. Metadata registrada con éxito.`)

      // Reset y refresh
      setShowUploadForm(false)
      setSelectedFile(null)
      router.refresh()
    } catch (error) {
      console.error("[CLIENT: DocumentList] Error inesperado en el flujo completo:", error)
      alert("Ocurrió un error inesperado al registrar el documento")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Documentos base
        </h2>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-6 w-6"
          onClick={() => setShowUploadForm(!showUploadForm)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {showUploadForm && (
        <div className="p-4 bg-zinc-100/50 dark:bg-zinc-900/50 border-b flex flex-col gap-3">
          <input 
            type="file" 
            onChange={handleFileChange}
            className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
          />
          <select 
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            className="w-full text-xs rounded-md border bg-background px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="planeamiento">Planeamiento</option>
            <option value="normativa">Normativa</option>
            <option value="catalogo">Catálogo</option>
            <option value="ficha">Ficha</option>
            <option value="informe">Informe</option>
            <option value="consulta">Consulta</option>
            <option value="otros">Otros</option>
          </select>
          <Button 
            size="sm" 
            className="w-full h-8 text-xs" 
            onClick={handleUpload}
            disabled={!selectedFile || isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
            ) : (
              <Upload className="h-3 w-3 mr-2" />
            )}
            Subir Documento
          </Button>
        </div>
      )}

      <div className="p-4 flex-1 overflow-y-auto">
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center mt-6">
            <div className="h-12 w-12 rounded-xl bg-zinc-100 dark:bg-zinc-900 border flex items-center justify-center mb-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Sin documentos</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
              Sube planos, cédulas o normativas específicas para dar contexto a la IA.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div key={doc.id} className="flex flex-col p-3 rounded-lg border bg-background shadow-sm gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium truncate" title={doc.filename}>{doc.filename}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-secondary text-secondary-foreground uppercase tracking-wider">
                    {doc.documentType}
                  </span>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {doc.processed ? (
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-500">
                        <FileCheck2 className="h-3.5 w-3.5" /> Procesado
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
                          Pendiente
                        </span>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-6 text-[10px] px-2"
                          onClick={() => handleProcess(doc.id)}
                          disabled={processingId === doc.id}
                        >
                          {processingId === doc.id ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : null}
                          Procesar
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
