import { Metadata } from "next"
import Image from "next/image"
import { login, loginWithGoogle } from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { HeroCarousel } from "@/components/auth/HeroCarousel"

export const metadata: Metadata = {
  title: "Acceso - UrbanBrain",
  description: "Accede a UrbanBrain.",
}

// Iconos inline para Apple y Google
const AppleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 mr-2" fill="currentColor">
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.126 3.805 3.052 1.52-.074 2.126-.983 3.964-.983 1.815 0 2.385.983 3.963.946 1.631-.038 2.65-1.52 3.65-2.977 1.157-1.69 1.63-3.326 1.65-3.412-.04-.015-3.197-1.226-3.23-4.89-.026-3.064 2.502-4.52 2.612-4.58-1.428-2.09-3.626-2.378-4.417-2.433-2.062-.164-4.062 1.218-4.595 1.218zm2.493-2.355c.813-.984 1.36-2.355 1.212-3.722-1.16.046-2.607.77-3.447 1.748-.68.73-1.332 2.138-1.156 3.47 1.298.1 2.573-.507 3.391-1.496z" />
  </svg>
)

const GoogleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 mr-2" fill="currentColor">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
)

export default function AuthenticationPage() {
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      {/* Lado Izquierdo (Marca) */}
      <div 
        className="relative hidden md:flex flex-col justify-center items-center bg-[#2B2E34] text-white p-12 overflow-hidden"
        style={{
          backgroundImage: "url('/images/slats-background.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        
        {/* Contenedor central */}
        <div className="relative z-20 flex flex-col items-center w-full max-w-[32rem]">
          {/* Logo superior (mb-10 = 40px) */}
          <div className="w-full flex justify-center mb-10">
            <Image 
              src="/images/urbanbrain-logo.jpeg" 
              alt="UrbanBrain Logo" 
              width={440} 
              height={120} 
              className="w-auto h-24 object-contain" 
              priority
            />
          </div>

          {/* Subtítulo (mb-12 = 48px) */}
          <p className="text-sm text-zinc-300 font-normal text-center max-w-[24rem] opacity-80 mb-12">
            Consulta normativa, gestiona expedientes y automatiza documentación técnica.
          </p>

          {/* Carrusel inferior */}
          <HeroCarousel />
          
          {/* Frase estática editorial (mt-9 = 36px) */}
          <h2 className="text-xl font-light text-zinc-300 tracking-wide text-center mt-9">
            De semanas a minutos.
          </h2>
        </div>
      </div>

      {/* Lado Derecho (Auth) */}
      <div className="flex flex-col justify-center items-center bg-[#F5F5F2] p-8 lg:p-16">
        <div className="w-full max-w-sm space-y-8">
          
          <div className="space-y-2 text-center md:text-left">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
              Bienvenido de nuevo
            </h1>
            <p className="text-sm text-zinc-500">
              Inicia sesión en tu cuenta de UrbanBrain
            </p>
          </div>

          <div className="space-y-4">
            <form action={loginWithGoogle}>
              <Button type="submit" variant="outline" className="w-full h-14 rounded-xl bg-white hover:bg-zinc-50 text-zinc-700 font-medium border-zinc-200">
                <GoogleIcon />
                Continuar con Google
              </Button>
            </form>
            <Button disabled variant="outline" className="w-full h-14 rounded-xl bg-white hover:bg-zinc-50 text-zinc-700 font-medium border-zinc-200 opacity-50 cursor-not-allowed">
              <AppleIcon />
              Continuar con Apple (Próximamente)
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-zinc-300" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[#F5F5F2] px-2 text-zinc-500">
                O continuar con correo
              </span>
            </div>
          </div>

          <form action={login} className="space-y-6">
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="email" className="text-zinc-700">Correo electrónico</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="nombre@estudio.com"
                  required
                  className="h-14 rounded-xl bg-white border-zinc-200 focus-visible:ring-zinc-400"
                />
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="password" className="text-zinc-700">Contraseña</Label>
                  <a href="#" className="text-xs text-zinc-500 hover:text-zinc-900 underline underline-offset-4">
                    ¿Olvidaste tu contraseña?
                  </a>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  className="h-14 rounded-xl bg-white border-zinc-200 focus-visible:ring-zinc-400"
                />
              </div>
            </div>
            
            <Button className="w-full h-14 rounded-xl bg-[#2B2E34] hover:bg-black text-white" type="submit">
              Acceder al Workspace
            </Button>
          </form>
          
          <p className="text-center text-sm text-zinc-500 mt-8">
            ¿No tienes cuenta?{' '}
            <a href="#" className="font-medium text-zinc-900 hover:underline underline-offset-4">
              Solicitar acceso
            </a>
          </p>

        </div>
      </div>
    </div>
  )
}
