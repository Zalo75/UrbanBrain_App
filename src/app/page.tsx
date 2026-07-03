import { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { Check } from "lucide-react"
import { HeroCarousel } from "@/components/auth/HeroCarousel"
import { PricingSection } from "@/components/public/PricingSection"
import { ContactForm } from "@/components/public/ContactForm"
import { LegalFooter } from "@/components/public/LegalFooter"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "UrbanBrain - De semanas a minutos",
  description: "Consulta normativa, gestiona expedientes y automatiza documentación técnica para estudios de arquitectura.",
}

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[#F5F5F2] selection:bg-zinc-800 selection:text-white">
      {/* NavBar flotante simple */}
      <header className="absolute top-0 left-0 w-full z-50 p-6 flex justify-end">
        <Link href="/login">
          <Button variant="outline" className="bg-white/10 hover:bg-white/20 text-white border-white/20 rounded-xl px-6">
            Acceso Clientes
          </Button>
        </Link>
      </header>

      {/* Hero Section (Aesthetic Login Mirror) */}
      <section 
        className="relative flex flex-col justify-center items-center bg-[#2B2E34] text-white min-h-[75vh] py-16 px-6 overflow-hidden"
        style={{
          backgroundImage: "url('/images/slats-background.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        <div className="relative z-20 flex flex-col items-center w-full max-w-[40rem]">
          {/* Logo superior */}
          <div className="w-full flex justify-center mb-8">
            <Image 
              src="/images/urbanbrain-logo.jpeg" 
              alt="UrbanBrain Logo" 
              width={440} 
              height={120} 
              className="w-auto h-20 md:h-24 object-contain" 
              priority
            />
          </div>

          {/* Subtítulo */}
          <p className="text-sm md:text-base text-zinc-300 font-normal text-center max-w-[28rem] opacity-80 mb-6">
            Consulta normativa, gestiona expedientes y automatiza documentación técnica.
          </p>

          {/* Beneficios Rápidos */}
          <div className="flex flex-col gap-2 mb-10 text-sm text-zinc-300/80 font-light tracking-wide w-full max-w-[22rem] mx-auto">
            <div className="flex items-center gap-3">
              <Check className="w-4 h-4 text-white/50 shrink-0" strokeWidth={1.5} />
              <span>Consulta normativa en segundos.</span>
            </div>
            <div className="flex items-center gap-3">
              <Check className="w-4 h-4 text-white/50 shrink-0" strokeWidth={1.5} />
              <span>Automatiza tareas repetitivas.</span>
            </div>
            <div className="flex items-center gap-3">
              <Check className="w-4 h-4 text-white/50 shrink-0" strokeWidth={1.5} />
              <span>Centraliza documentación técnica y urbanística.</span>
            </div>
          </div>

          {/* Carrusel inferior */}
          <HeroCarousel />
          
          {/* Frase estática editorial */}
          <h2 className="text-xl md:text-2xl font-light text-zinc-300 tracking-wide text-center mt-10">
            De semanas a minutos.
          </h2>
        </div>
      </section>

      {/* Pricing Section */}
      <PricingSection />

      {/* Contact Section */}
      <section id="contacto" className="py-16 bg-white px-6">
        <div className="max-w-2xl mx-auto flex flex-col items-center">
          <h2 className="text-3xl font-light text-zinc-900 tracking-tight mb-4">¿Hablamos?</h2>
          <p className="text-zinc-500 mb-8 text-center max-w-lg">
            Solicita acceso a la beta o cuéntanos las necesidades específicas de tu estudio de arquitectura.
          </p>
          <ContactForm />
        </div>
      </section>

      {/* Footer */}
      <LegalFooter />
    </div>
  )
}
