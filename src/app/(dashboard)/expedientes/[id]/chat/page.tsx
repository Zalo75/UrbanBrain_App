import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send, FileText } from "lucide-react"

export default function ChatPage() {
  return (
    <div className="flex h-full w-full flex-col lg:flex-row">
      {/* Zona Izquierda: Chat */}
      <div className="flex flex-1 flex-col border-r relative">
        <div className="flex-1 p-4 overflow-y-auto space-y-4 pb-20">
          <div className="bg-muted w-3/4 rounded-lg p-3 text-sm">
            Hola, soy UrbanBrain. ¿Qué necesitas saber sobre la normativa de este expediente?
          </div>
          {/* Mensajes simulados */}
        </div>
        
        {/* Input Área */}
        <div className="absolute bottom-0 left-0 right-0 p-3 bg-background border-t flex items-center gap-2">
          <Input placeholder="Escribe tu consulta normativa..." className="flex-1" />
          <Button size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Zona Derecha: Visor de Contexto/PDF (Solo Desktop) */}
      <div className="hidden lg:flex w-[400px] xl:w-[500px] flex-col bg-muted/10">
        <div className="p-3 border-b flex items-center gap-2 bg-muted/20">
          <FileText className="h-4 w-4" />
          <span className="font-medium text-sm">Documentos de Referencia</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4 text-center">
          Aquí se mostrarán los fragmentos del PGOU o documentos subidos relevantes para la consulta actual.
        </div>
      </div>
    </div>
  )
}
