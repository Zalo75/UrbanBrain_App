'use client'

import { useState } from 'react'
import { MoreHorizontal, Edit2, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateExpediente, archiveExpediente } from '@/app/(dashboard)/expedientes/actions'

interface Expediente {
  id: string
  name: string
  municipio: string
  refCatastral: string | null
}

export function ExpedienteActions({ expediente }: { expediente: Expediente }) {
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isArchiveOpen, setIsArchiveOpen] = useState(false)
  const [isPending, setIsPending] = useState(false)

  async function handleArchive() {
    setIsPending(true)
    try {
      await archiveExpediente(expediente.id)
      setIsArchiveOpen(false)
      // La lista se actualizará mediante revalidatePath en el action
    } catch (error) {
      console.error(error)
    } finally {
      setIsPending(false)
    }
  }

  async function handleEdit(formData: FormData) {
    setIsPending(true)
    try {
      await updateExpediente(expediente.id, formData)
      setIsEditOpen(false)
    } catch (error) {
      console.error(error)
    } finally {
      setIsPending(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:pointer-events-none disabled:opacity-50">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Abrir menú</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setIsEditOpen(true)} className="cursor-pointer">
            <Edit2 className="mr-2 h-4 w-4" />
            <span>Editar</span>
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={() => setIsArchiveOpen(true)} 
            className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Archive className="mr-2 h-4 w-4" />
            <span>Archivar</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Editar Expediente</DialogTitle>
            <DialogDescription>
              Modifica los detalles del expediente. Haz clic en guardar cuando termines.
            </DialogDescription>
          </DialogHeader>
          <form action={handleEdit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre del Proyecto</Label>
              <Input id="name" name="name" defaultValue={expediente.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="municipio">Municipio</Label>
              <Input id="municipio" name="municipio" defaultValue={expediente.municipio} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="refCatastral">Referencia Catastral (Opcional)</Label>
              <Input id="refCatastral" name="refCatastral" defaultValue={expediente.refCatastral || ''} />
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Guardando...' : 'Guardar cambios'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isArchiveOpen} onOpenChange={setIsArchiveOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Archivar Expediente</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas archivar este expediente? Dejará de ser visible en tu panel principal. Podrás restaurarlo en el futuro si lo necesitas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => setIsArchiveOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleArchive} disabled={isPending}>
              {isPending ? 'Archivando...' : 'Archivar expediente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
