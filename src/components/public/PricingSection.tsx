"use client"

import { useState } from "react"
import { Check } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"

const plans = [
  {
    name: "FREE",
    priceMonthly: "0 €",
    priceAnnual: "0 €",
    features: [
      "2 proyectos totales",
      "18 consultas totales",
      "Sin caducidad",
      "Acceso sujeto a validación manual durante la fase beta"
    ]
  },
  {
    name: "PAY PER USE",
    priceMonthly: "20 €",
    priceAnnual: "20 €",
    subtitle: "IVA incluido / pago único",
    features: [
      "1 proyecto",
      "10 consultas",
      "Sin suscripción",
      "Validez 12 meses desde la compra"
    ]
  },
  {
    name: "BASIC",
    priceMonthly: "45 €",
    priceAnnual: "36 €",
    subtitle: "IVA incluido / mes",
    setupFee: "150 €",
    setupFeeAnnual: "75 €",
    features: [
      "1 proyecto al mes",
      "80 consultas al mes"
    ]
  },
  {
    name: "PLUS",
    popular: true,
    priceMonthly: "89 €",
    priceAnnual: "71.20 €",
    subtitle: "IVA incluido / mes",
    setupFee: "300 €",
    setupFeeAnnual: "150 €",
    features: [
      "10 proyectos al mes",
      "300 consultas al mes"
    ]
  },
  {
    name: "PRO",
    priceMonthly: "119 €",
    priceAnnual: "95.20 €",
    subtitle: "IVA incluido / mes",
    setupFee: "500 €",
    setupFeeAnnual: "250 €",
    features: [
      "100 proyectos al mes",
      "2000 consultas al mes",
      "Base normativa personalizada",
      "Incorporación de normativa propia del estudio o administración",
      "Soporte prioritario"
    ]
  },
  {
    name: "ENTERPRISE",
    priceMonthly: "Personalizado",
    priceAnnual: "Personalizado",
    subtitle: "Para grandes volúmenes",
    buttonText: "Hablemos",
    features: [
      "Base normativa personalizada avanzada",
      "Integraciones y condiciones a medida",
      "Soporte prioritario",
      "Volumen personalizado"
    ]
  }
]

export function PricingSection() {
  const [isAnnual, setIsAnnual] = useState(false)

  return (
    <section className="py-16 px-6 bg-[#F5F5F2]">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-light tracking-tight text-zinc-900 mb-6">
            Planes adaptados a tu estudio
          </h2>
          
          <div className="flex items-center justify-center gap-4 mt-6">
            <span className={`text-sm ${!isAnnual ? 'text-zinc-900 font-medium' : 'text-zinc-500'}`}>Pago Mensual</span>
            <Switch checked={isAnnual} onCheckedChange={setIsAnnual} />
            <span className={`text-sm ${isAnnual ? 'text-zinc-900 font-medium' : 'text-zinc-500'}`}>
              Pago Anual <span className="text-emerald-600 font-medium text-xs ml-1">-20% cuota / -50% alta</span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div 
              key={plan.name} 
              className={`relative bg-white rounded-2xl p-6 border ${plan.popular ? 'border-zinc-900 shadow-xl scale-105 z-10' : 'border-zinc-200 shadow-sm'} flex flex-col`}
            >
              {plan.popular && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 text-white text-xs font-medium px-4 py-1 rounded-full uppercase tracking-widest">
                  Más popular
                </div>
              )}
              
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-zinc-500 tracking-wider mb-2">{plan.name}</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-light text-zinc-900">
                    {isAnnual ? plan.priceAnnual : plan.priceMonthly}
                  </span>
                </div>
                {plan.subtitle && (
                  <p className="text-sm text-zinc-500 mt-2">{plan.subtitle}</p>
                )}
                {plan.setupFee && (
                  <p className="text-sm text-emerald-600 mt-1 font-medium">
                    + Alta inicial: {isAnnual ? plan.setupFeeAnnual : plan.setupFee}
                  </p>
                )}
              </div>

              <div className="flex-1">
                <ul className="space-y-3">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex gap-3 text-sm text-zinc-700">
                      <Check className="h-5 w-5 text-zinc-900 shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6">
                <Button 
                  onClick={() => document.getElementById('contacto')?.scrollIntoView({ behavior: 'smooth' })}
                  variant={plan.popular ? 'default' : 'outline'} 
                  className={`w-full h-12 rounded-xl ${plan.popular ? 'bg-zinc-900 text-white hover:bg-black' : 'border-zinc-200 text-zinc-900 hover:bg-zinc-50'}`}
                >
                  {plan.buttonText || "Comenzar"}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Nota OCR */}
        <div className="mt-12 max-w-2xl mx-auto text-center p-6 bg-white rounded-xl border border-zinc-200">
          <p className="text-sm text-zinc-600 leading-relaxed">
            Los PDF con texto seleccionable se procesan sin coste adicional.<br/>
            La documentación escaneada o basada en imágenes requiere OCR opcional:<br/>
            <span className="font-medium text-zinc-900">15 € por cada 100 páginas procesadas.</span>
          </p>
        </div>
      </div>
    </section>
  )
}
