"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const titularData = `
Titular: Gonzalo González Cajide
NIF: 32794343T
Dirección: C/ Alcalde Lens 25B, L7, 15010 A Coruña
Email de contacto: technika360@technika360.com
`

const specificClause = `
UrbanBrain es una herramienta de apoyo técnico e informativo destinada a profesionales del sector de la arquitectura y el urbanismo. 
Las respuestas proporcionadas por la plataforma no sustituyen la revisión normativa ni el criterio profesional del técnico competente.
`

export function LegalFooter() {
  return (
    <footer className="w-full bg-[#2B2E34] text-zinc-400 py-12 px-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="text-sm">
          © {new Date().getFullYear()} UrbanBrain. Todos los derechos reservados.
        </div>
        
        <div className="flex flex-wrap justify-center gap-6 text-sm">
          <LegalModal title="Aviso Legal">
            <div className="space-y-4 text-zinc-600 text-sm">
              <p>En cumplimiento de la Ley 34/2002, de 11 de julio, de Servicios de la Sociedad de la Información y de Comercio Electrónico (LSSI-CE), se informan los siguientes datos del titular de este sitio web:</p>
              <pre className="font-sans whitespace-pre-wrap bg-zinc-50 p-4 rounded-lg">{titularData}</pre>
              <p>El acceso y/o uso de este portal atribuye la condición de USUARIO, que acepta, desde dicho acceso y/o uso, las Condiciones Generales de Uso aquí reflejadas.</p>
            </div>
          </LegalModal>

          <LegalModal title="Política de Privacidad">
            <div className="space-y-4 text-zinc-600 text-sm">
              <div className="p-4 bg-zinc-100 rounded-lg font-medium text-zinc-800">
                {specificClause}
              </div>
              <p>De conformidad con lo dispuesto en el Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo (RGPD), informamos que los datos personales recabados a través de este sitio web serán tratados por el Titular de forma confidencial.</p>
              <p>Finalidad del tratamiento: Mantener una relación comercial con el Usuario. Gestión de solicitudes de información y soporte.</p>
              <p>Criterios de conservación de los datos: Se conservarán mientras exista un interés mutuo para mantener el fin del tratamiento.</p>
              <p>Proveedores necesarios: para prestar el servicio utilizamos proveedores tecnológicos como Supabase (autenticación y datos), Google Gemini y DeepSeek (funciones de IA). El acceso se limita a lo necesario para operar la beta privada. Evite introducir datos personales innecesarios.</p>
              <p>Derechos que asisten al Usuario: Derecho a retirar el consentimiento en cualquier momento. Derecho de acceso, rectificación, portabilidad y supresión de sus datos y a la limitación u oposición al su tratamiento.</p>
            </div>
          </LegalModal>

          <LegalModal title="Política de Cookies">
            <div className="space-y-4 text-zinc-600 text-sm">
              <p>Este sitio utiliza únicamente tecnologías necesarias para el funcionamiento, la seguridad y el mantenimiento de la sesión.</p>
              <p><strong>¿Qué son las cookies?</strong><br/>Una cookie es un fichero que se descarga en su ordenador al acceder a determinadas páginas web. Las cookies permiten a una página web, entre otras cosas, almacenar y recuperar información sobre los hábitos de navegación de un usuario o de su equipo.</p>
              <p>Actualmente, UrbanBrain utiliza únicamente cookies técnicas necesarias para el mantenimiento de la sesión (ej. autenticación mediante Supabase). No utilizamos cookies analíticas o publicitarias invasivas.</p>
            </div>
          </LegalModal>

          <LegalModal title="Términos del Servicio">
            <div className="space-y-4 text-zinc-600 text-sm">
              <div className="p-4 bg-zinc-100 rounded-lg font-medium text-zinc-800">
                {specificClause}
              </div>
              <p>Las presentes Condiciones Generales regulan el uso (incluyendo el mero acceso) de las páginas web integrantes del sitio web de UrbanBrain, incluidos los contenidos y servicios puestos a disposición en ellas.</p>
              <p>UrbanBrain se reserva el derecho de modificar en cualquier momento y sin previo aviso, la presentación y configuración del sitio web, así como los presentes Términos del Servicio.</p>
              <p><strong>Uso de la cuenta:</strong><br/>El usuario se compromete a hacer un uso adecuado de los contenidos y servicios de UrbanBrain. Es responsable de mantener la confidencialidad de su cuenta y contraseña.</p>
              <p><strong>Limitación de Responsabilidad:</strong><br/>UrbanBrain no garantiza la inexistencia de errores en el acceso a la web, en su contenido, ni que éste se encuentre actualizado, aunque desarrollará sus mejores esfuerzos para, en su caso, evitarlos, subsanarlos o actualizarlos.</p>
            </div>
          </LegalModal>
        </div>
      </div>
    </footer>
  )
}

function LegalModal({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger className="hover:text-white transition-colors underline-offset-4 hover:underline">
        {title}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl mb-4">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Contenido legal de {title}
          </DialogDescription>
          <div className="text-left mt-4">
            {children}
          </div>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
