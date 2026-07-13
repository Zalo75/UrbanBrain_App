"use client";

import { useState } from "react";
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
  page: string | null;
  source_url?: string;
  similarity: number;
  source_index: number;
}

// Simple text formatter to improve readability
const FormattedText = ({ text }: { text: string }) => {
  const paragraphs = text.split('\n\n');
  return (
    <div className="space-y-3">
      {paragraphs.map((p, i) => {
        // Handle basic bold syntax
        const parts = p.split(/(\*\*.*?\*\*)/g);
        return (
          <p key={i} className="leading-relaxed">
            {parts.map((part, j) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
              }
              // Handle newlines within paragraphs (like list items)
              const lines = part.split('\n');
              if (lines.length > 1) {
                return lines.map((line, k) => (
                  <span key={k}>
                    {line}
                    {k < lines.length - 1 && <br />}
                  </span>
                ));
              }
              return part;
            })}
          </p>
        );
      })}
    </div>
  );
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);

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
          municipio: "Oza" // Municipio hardcodeado para la V1
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
    <div className="flex h-full w-full flex-col lg:flex-row overflow-hidden min-h-0">
      <div className="flex flex-1 flex-col border-r overflow-hidden min-h-0 min-w-0">
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
          <div className="bg-muted max-w-[85%] rounded-lg p-4 text-sm shadow-sm break-words">
            Hola, soy UrbanBrain. ¿Qué necesitas saber sobre la normativa de este expediente?
          </div>

          {messages.map((msg, index) => (
            <div
              key={index}
              className={`p-4 rounded-lg text-sm max-w-[85%] shadow-sm break-words ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground ml-auto'
                  : 'bg-muted text-foreground'
              }`}
            >
              {msg.role === 'user' ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
              ) : (
                <FormattedText text={msg.content} />
              )}
            </div>
          ))}

          {loading && (
            <div className="bg-muted max-w-[85%] rounded-lg p-4 text-sm animate-pulse shadow-sm">
              UrbanBrain está analizando la normativa...
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm flex items-start gap-2 max-w-[85%] shadow-sm">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t bg-background flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Input
              id="chat-input"
              placeholder="Escribe tu consulta normativa..."
              className="flex-1 shadow-sm"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSend();
              }}
              disabled={loading}
            />
            <Button
              id="chat-send-btn"
              size="icon"
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="flex-shrink-0 shadow-sm"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="text-[10px] sm:text-xs text-center text-muted-foreground px-2">
            UrbanBrain puede cometer errores. Verifica siempre la información con las fuentes normativas citadas.
          </div>
        </div>
      </div>

      {/* Zona Derecha: Visor de Contexto/PDF (Solo Desktop) */}
      <div className="hidden lg:flex w-[400px] xl:w-[500px] flex-col bg-muted/10 overflow-hidden">
        <div className="p-4 border-b flex items-center gap-2 bg-muted/30">
          <FileText className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">Documentos de Referencia</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {sources.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm text-center px-6">
              Aquí se mostrarán los fragmentos del PGOU o documentos normativos relevantes para tu consulta.
            </div>
          ) : (
            sources.map((source, idx) => (
              <div key={idx} className="bg-background border border-border/50 rounded-lg p-4 text-sm shadow-sm flex flex-col gap-2 hover:border-primary/30 transition-colors">
                <div className="flex items-center justify-between border-b pb-2 mb-2">
                  <span className="font-bold text-primary bg-primary/10 px-2 py-0.5 rounded text-xs">[Fuente {source.source_index}]</span>
                  <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full truncate max-w-[150px]" title={source.municipio_nombre}>
                    {source.municipio_nombre}
                  </span>
                </div>
                <div className="text-sm font-semibold leading-tight text-foreground">
                  {source.nombre_pdf}
                </div>
                {source.titulo_detectado && (
                  <div className="text-xs text-foreground/80 mt-1 bg-muted/50 p-2 rounded">
                    <span className="font-medium">Apartado:</span> {source.titulo_detectado}
                  </div>
                )}
                {source.page && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <FileText className="h-3 w-3" /> Página {source.page}
                  </div>
                )}
                {source.source_url && (
                  <a href={source.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-800 hover:underline mt-1 inline-flex items-center gap-1 font-medium">
                    📄 Ver documento oficial
                  </a>
                )}
                <div className="mt-2 text-xs text-muted-foreground/70 font-medium">
                  Relevancia: {(source.similarity * 100).toFixed(1)}%
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
