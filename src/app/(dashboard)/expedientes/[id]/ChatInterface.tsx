"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send, FileText, AlertCircle } from "lucide-react"

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Source {
  chunk_id: string;
  municipio_nombre: string;
  nombre_pdf: string;
  titulo_detectado: string;
  similarity: number;
  source_index: number;
  original_path?: string;
  pagina_detectada?: string;
  fragmento_corto?: string;
}

interface ChatInterfaceProps {
  expedienteId: string;
  municipio: string;
}

export function ChatInterface({ expedienteId, municipio }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch(`/api/chat/history?expedienteId=${expedienteId}`);
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.history && data.history.length > 0) {
          const loadedMessages = data.history.map((h: any) => ({
            role: h.role,
            content: h.content
          }));
          setMessages(loadedMessages);
          
          // Recuperar fuentes del último mensaje del asistente si existen
          const lastAssistantMsg = [...data.history].reverse().find((m: any) => m.role === 'assistant');
          if (lastAssistantMsg && lastAssistantMsg.sources) {
            setSources(lastAssistantMsg.sources);
          }
        }
      } catch (err) {
        console.error("Error fetching chat history", err);
      }
    }
    
    if (expedienteId) {
      fetchHistory();
    }
  }, [expedienteId]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          municipio,
          expedienteId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al procesar la consulta');
      }

      setMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);
      setSources(data.sources || []);
    } catch (err: any) {
      setError(err.message || 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col xl:flex-row bg-background">
      {/* Zona Izquierda: Chat */}
      <div className="flex flex-1 flex-col border-r relative">
        <div className="flex-1 p-4 overflow-y-auto space-y-4 pb-20 max-h-[calc(100vh-8rem)]">
          <div className="bg-muted w-3/4 rounded-lg p-3 text-sm">
            Hola, soy UrbanBrain. ¿Qué necesitas saber sobre la normativa de este expediente?
          </div>
          
          {messages.map((msg, index) => (
            <div 
              key={index} 
              className={`p-3 rounded-lg text-sm max-w-[85%] ${msg.role === 'user' ? 'bg-primary text-primary-foreground ml-auto' : 'bg-muted'}`}
              style={{ whiteSpace: 'pre-wrap' }}
            >
              {msg.content}
            </div>
          ))}

          {loading && (
            <div className="bg-muted w-3/4 rounded-lg p-3 text-sm animate-pulse">
              UrbanBrain está analizando la normativa...
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
        
        {/* Input Área */}
        <div className="absolute bottom-0 left-0 right-0 p-3 bg-background border-t flex items-center gap-2">
          <Input 
            placeholder="Escribe tu consulta normativa..." 
            className="flex-1"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend();
            }}
            disabled={loading}
          />
          <Button size="icon" onClick={handleSend} disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Zona Derecha: Visor de Contexto/PDF (Solo Desktop) */}
      <div className="hidden xl:flex w-[400px] flex-col bg-muted/10 overflow-hidden max-h-[calc(100vh-8rem)]">
        <div className="p-3 border-b flex items-center gap-2 bg-muted/20">
          <FileText className="h-4 w-4" />
          <span className="font-medium text-sm">Documentos de Referencia</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {sources.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm text-center">
              Aquí se mostrarán los fragmentos del PGOU o documentos subidos relevantes para la consulta actual.
            </div>
          ) : (
            sources.map((source, idx) => (
              <div key={idx} className="bg-background border rounded-md p-3 text-sm shadow-sm">
                <div className="font-semibold text-primary mb-1">
                  [Fuente {source.source_index}]
                </div>
                <div className="text-xs text-muted-foreground mb-2 space-y-1">
                  <p><span className="font-medium">Municipio:</span> {source.municipio_nombre}</p>
                  <p><span className="font-medium">Documento:</span> {source.nombre_pdf}</p>
                  {source.pagina_detectada && (
                    <p><span className="font-medium">Página:</span> {source.pagina_detectada}</p>
                  )}
                  {source.titulo_detectado && source.titulo_detectado.trim() !== ":" && source.titulo_detectado.trim() !== "" && (
                    <p><span className="font-medium">Apartado:</span> {source.titulo_detectado}</p>
                  )}
                  {source.fragmento_corto && (
                    <p className="mt-2 text-foreground/80 italic border-l-2 border-muted-foreground/30 pl-2">
                      "{source.fragmento_corto}"
                    </p>
                  )}
                  {source.original_path && (
                    <p className="mt-2 text-[10px] text-muted-foreground/50 truncate" title={source.original_path}>
                      Ruta: {source.original_path}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
