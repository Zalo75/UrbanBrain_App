import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { ExpedienteForm } from "./ExpedienteForm"
import { getEnabledProvinces, allMunicipalities } from "@/shared/territory"

export const metadata = {
  title: "Nuevo Expediente - UrbanBrain",
}

export default function NewExpedientePage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-8 md:py-12 lg:py-24">
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Volver al Dashboard
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Nuevo Expediente</h1>
          <p className="text-muted-foreground mt-2 text-base">
            Crea un espacio de trabajo para consultar normativas y gestionar documentos urbanísticos.
          </p>
        </div>

        <ExpedienteForm provinces={getEnabledProvinces()} municipalities={allMunicipalities} />
      </div>
    </div>
  )
}
