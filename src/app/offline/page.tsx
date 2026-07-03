import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WifiOff } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function OfflinePage() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <WifiOff className="h-12 w-12 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl">Sin conexión</CardTitle>
          <CardDescription>Parece que has perdido la conexión a internet.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-6">
            UrbanBrain requiere conexión para buscar en la normativa y acceder a los expedientes.
          </p>
          <Link href="/" className={cn(buttonVariants(), "w-full")}>
            Reintentar conexión
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
