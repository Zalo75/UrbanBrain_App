'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, FileText, AlertCircle } from 'lucide-react';

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

interface ChatHistoryEntry extends Message {
  sources?: Source[] | null;
}

interface ChatInterfaceProps {
  expedienteId: string;
}

export function ChatInterface({ expedienteId }: ChatInterfaceProps) {
  const inFlightRef = useRef(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch(`/api/chat/history?expedienteId=${expedienteId}`);
        if (!res.ok) {
          setError('No se ha podido cargar el historial del chat.');
          return;
        }
        const data = await res.json();

        if (data.history && data.history.length > 0) {
          const history = data.history as ChatHistoryEntry[];
          const loadedMessages = history.map((entry) => ({
            role: entry.role,
            content: entry.content,
          }));
          setMessages(loadedMessages);

          // Recuperar fuentes del último mensaje del asistente si existen
          const lastAssistantMsg = [...history]
            .reverse()
            .find((entry) => entry.role === 'assistant');
          if (lastAssistantMsg && lastAssistantMsg.sources) {
            setSources(lastAssistantMsg.sources);
          }
        }
      } catch {
        setError('No se ha podido cargar el historial del chat.');
      }
    }

    if (expedienteId) {
      fetchHistory();
    }
  }, [expedienteId]);

  const handleSend = async () => {
    if (!input.trim() || inFlightRef.current) return;

    const userMessage = input.trim();
    if (userMessage.length > 4000) {
      setError('La consulta no puede superar 4000 caracteres.');
      return;
    }
    inFlightRef.current = true;
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setInput('');
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 50_000);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          expedienteId,
        }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al procesar la consulta');
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer }]);
      setSources(data.sources || []);
    } catch (err: unknown) {
      setError(err instanceof DOMException && err.name === 'AbortError' ? 'La consulta ha tardado demasiado. Inténtelo de nuevo.' : err instanceof Error ? err.message : 'No se ha podido completar la consulta.');
    } finally {
      window.clearTimeout(timeoutId);
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="bg-background flex h-full min-h-0 w-full flex-col overflow-hidden xl:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="bg-muted max-w-[85%] rounded-lg p-3 text-sm break-words">
            Hola, soy UrbanBrain. ¿Qué necesitas saber sobre la normativa de este expediente?
          </div>

          {messages.map((msg, index) => (
            <div
              key={index}
              className={`max-w-[85%] rounded-lg p-3 text-sm break-words ${msg.role === 'user' ? 'bg-primary text-primary-foreground ml-auto' : 'bg-muted'}`}
              style={{ whiteSpace: 'pre-wrap' }}
            >
              {msg.content}
            </div>
          ))}

          {loading && (
            <div className="bg-muted max-w-[85%] animate-pulse rounded-lg p-3 text-sm break-words">
              UrbanBrain está analizando la normativa...
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 text-destructive flex max-w-[85%] items-start gap-2 rounded-lg p-3 text-sm break-words">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
        </div>
        <div className="bg-background flex flex-shrink-0 flex-col gap-2 border-t p-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Escribe tu consulta normativa..."
              className="flex-1 shadow-sm"
              value={input}
              maxLength={4000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={loading}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="flex-shrink-0 shadow-sm"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="text-muted-foreground px-2 text-center text-[10px]">
            UrbanBrain puede cometer errores. Verifica siempre la información con las fuentes
            normativas citadas.
          </div>
        </div>
      </div>

      {/* Zona Derecha: Visor de Contexto/PDF (Solo Desktop) */}
      <div className="bg-muted/10 hidden w-[400px] flex-col overflow-hidden xl:flex">
        <div className="bg-muted/20 flex items-center gap-2 border-b p-3">
          <FileText className="h-4 w-4" />
          <span className="text-sm font-medium">Documentos de Referencia</span>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {sources.length === 0 ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
              Aquí se mostrarán los fragmentos del PGOU o documentos subidos relevantes para la
              consulta actual.
            </div>
          ) : (
            sources.map((source, idx) => (
              <div key={idx} className="bg-background rounded-md border p-3 text-sm shadow-sm">
                <div className="text-primary mb-1 font-semibold">
                  [Fuente {source.source_index}]
                </div>
                <div className="text-muted-foreground mb-2 space-y-1 text-xs">
                  <p>
                    <span className="font-medium">Municipio:</span> {source.municipio_nombre}
                  </p>
                  <p>
                    <span className="font-medium">Documento:</span> {source.nombre_pdf}
                  </p>
                  {source.pagina_detectada && (
                    <p>
                      <span className="font-medium">Página:</span> {source.pagina_detectada}
                    </p>
                  )}
                  {source.titulo_detectado &&
                    source.titulo_detectado.trim() !== ':' &&
                    source.titulo_detectado.trim() !== '' && (
                      <p>
                        <span className="font-medium">Apartado:</span> {source.titulo_detectado}
                      </p>
                    )}
                  {source.fragmento_corto && (
                    <p className="text-foreground/80 border-muted-foreground/30 mt-2 border-l-2 pl-2 italic">
                      &ldquo;{source.fragmento_corto}&rdquo;
                    </p>
                  )}
                  {source.original_path && (
                    <p
                      className="text-muted-foreground/50 mt-2 truncate text-[10px]"
                      title={source.original_path}
                    >
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
