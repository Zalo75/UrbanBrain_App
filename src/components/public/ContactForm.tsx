"use client"

import { useState } from "react"
import { submitContactForm } from "@/app/(public)/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function ContactForm() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")

  async function action(formData: FormData) {
    setIsSubmitting(true)
    setError("")
    
    try {
      const result = await submitContactForm(formData)
      if (result.success) {
        setSuccess(true)
      } else {
        setError(result.error || "Error al enviar el mensaje")
      }
    } catch {
      setError("Error de red. Por favor, inténtalo de nuevo.")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="w-full max-w-xl p-8 bg-zinc-50 border border-zinc-200 rounded-2xl text-center">
        <h3 className="text-xl font-medium text-zinc-900 mb-2">Mensaje enviado</h3>
        <p className="text-zinc-500">Nos pondremos en contacto contigo lo antes posible.</p>
        <Button 
          variant="outline" 
          className="mt-6"
          onClick={() => setSuccess(false)}
        >
          Enviar otro mensaje
        </Button>
      </div>
    )
  }

  return (
    <form action={action} className="w-full max-w-xl space-y-6">
      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm">
          {error}
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="name">Nombre completo *</Label>
          <Input id="name" name="name" required className="h-12 rounded-xl" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email profesional *</Label>
          <Input id="email" name="email" type="email" required className="h-12 rounded-xl" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="company">Estudio o Empresa</Label>
          <Input id="company" name="company" className="h-12 rounded-xl" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Teléfono</Label>
          <Input id="phone" name="phone" type="tel" className="h-12 rounded-xl" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="message">¿En qué podemos ayudarte? *</Label>
        <Textarea 
          id="message" 
          name="message" 
          required 
          className="min-h-[120px] rounded-xl resize-none" 
        />
      </div>

      <Button 
        type="submit" 
        disabled={isSubmitting}
        className="w-full h-12 rounded-xl bg-zinc-900 text-white hover:bg-black"
      >
        {isSubmitting ? "Enviando..." : "Enviar mensaje"}
      </Button>
    </form>
  )
}
