'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, FileText, AlertCircle, ArrowDown, Copy, ExternalLink, ArrowLeft, AlertTriangle } from 'lucide-react';
import {
  buildPdfPageUrl,
  buildPdfUrl,
  buildSafeHttpUrl,
  parseCitations,
} from './chatCitations';
import {
  buildSourceCitationText,
  getCopyableSourceFragment,
  normalizeDetectedReference,
  normalizeFragment,
} from './sourceClipboard';

const BOTTOM_THRESHOLD_PX = 48;

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
}

interface Source {
  chunk_id: string;
  municipio_nombre: string;
  nombre_pdf: string;
  titulo_detectado?: string | null;
  similarity?: number | null;
  source_index: number;
  original_path?: string | null;
  pagina_detectada?: string | number | null;
  fragmento_corto?: string | null;
  fragmento_completo?: string | null;
}

interface ChatHistoryEntry {
  role?: unknown;
  content?: unknown;
  sources?: unknown;
}

interface ChatInterfaceProps {
  expedienteId: string;
}

interface CopyFeedback {
  source: Source;
  kind: 'success' | 'error';
  message: string;
}

function normalizePositiveInteger(value: unknown): number | null {
  const normalized = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;

  for (const character of normalized) {
    if (character < '0' || character > '9') return null;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];

  const sources: Source[] = [];
  const seenSourceIndexes = new Set<number>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const raw = candidate as Record<string, unknown>;
    const sourceIndex = normalizePositiveInteger(raw.source_index);
    if (sourceIndex === null || seenSourceIndexes.has(sourceIndex)) continue;

    seenSourceIndexes.add(sourceIndex);
    sources.push({
      chunk_id: typeof raw.chunk_id === 'string' || typeof raw.chunk_id === 'number' ? String(raw.chunk_id) : '',
      municipio_nombre: typeof raw.municipio_nombre === 'string' ? raw.municipio_nombre : 'No identificado',
      nombre_pdf: typeof raw.nombre_pdf === 'string' ? raw.nombre_pdf : 'Documento',
      titulo_detectado: normalizeDetectedReference(raw.titulo_detectado),
      similarity: typeof raw.similarity === 'number' ? raw.similarity : null,
      source_index: sourceIndex,
      original_path: typeof raw.original_path === 'string' ? raw.original_path : null,
      pagina_detectada:
        typeof raw.pagina_detectada === 'string' || typeof raw.pagina_detectada === 'number'
          ? raw.pagina_detectada
          : null,
      fragmento_corto: normalizeFragment(raw.fragmento_corto),
      fragmento_completo: normalizeFragment(raw.fragmento_completo),
    });
  }

  return sources;
}

function normalizeHistory(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): Message[] => {
    if (!entry || typeof entry !== 'object') return [];
    const historyEntry = entry as ChatHistoryEntry;
    if ((historyEntry.role !== 'user' && historyEntry.role !== 'assistant') || typeof historyEntry.content !== 'string') {
      return [];
    }

    return [{
      role: historyEntry.role,
      content: historyEntry.content,
      sources: normalizeSources(historyEntry.sources),
    }];
  });
}

export function ChatInterface({ expedienteId }: ChatInterfaceProps) {
  const inFlightRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabledRef = useRef(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeSource, setActiveSource] = useState<Source | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  const updateAutoScroll = useCallback((enabled: boolean) => {
    autoScrollEnabledRef.current = enabled;
    setAutoScrollEnabled(enabled);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    updateAutoScroll(distanceToBottom <= BOTTOM_THRESHOLD_PX);
  }, [updateAutoScroll]);

  const handleScrollToLatest = useCallback(() => {
    scrollToBottom('smooth');
    updateAutoScroll(true);
  }, [scrollToBottom, updateAutoScroll]);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch(`/api/chat/history?expedienteId=${expedienteId}`);
        if (!res.ok) {
          setError('No se ha podido cargar el historial del chat.');
          return;
        }
        const data = await res.json();

        setMessages(normalizeHistory(data.history));
        setActiveSource(null);
      } catch {
        setError('No se ha podido cargar el historial del chat.');
      }
    }

    if (expedienteId) {
      fetchHistory();
    }
  }, [expedienteId]);

  useEffect(() => {
    if (autoScrollEnabledRef.current) {
      scrollToBottom('auto');
    }
  }, [error, loading, messages, scrollToBottom]);

  const handleSend = async () => {
    if (!input.trim() || inFlightRef.current) return;

    const userMessage = input.trim();
    if (userMessage.length > 4000) {
      setError('La consulta no puede superar 4000 caracteres.');
      return;
    }
    inFlightRef.current = true;
    updateAutoScroll(true);
    setMessages((prev) => [...prev, { role: 'user', content: userMessage, sources: [] }]);
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

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: typeof data.answer === 'string' ? data.answer : '',
          sources: normalizeSources(data.sources),
        },
      ]);
      setActiveSource(null);
    } catch (err: unknown) {
      setError(err instanceof DOMException && err.name === 'AbortError' ? 'La consulta ha tardado demasiado. Inténtelo de nuevo.' : err instanceof Error ? err.message : 'No se ha podido completar la consulta.');
    } finally {
      window.clearTimeout(timeoutId);
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  const latestAssistantSources = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant')
    ?.sources ?? [];

  return (
    <div className="bg-background flex h-full min-h-0 w-full flex-col overflow-hidden xl:flex-row">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r">
        <div
          ref={scrollContainerRef}
          data-testid="chat-scroll-container"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
          onScroll={handleMessagesScroll}
        >
          <div className="bg-muted max-w-[85%] rounded-lg p-3 text-sm break-words">
            Hola, soy UrbanBrain. ¿Qué necesitas saber sobre la normativa de este expediente?
          </div>

          {messages.map((msg, index) => (
            <div
              key={index}
              className={`max-w-[85%] rounded-lg p-3 text-sm break-words ${msg.role === 'user' ? 'bg-primary text-primary-foreground ml-auto' : 'bg-muted'}`}
              style={{ whiteSpace: 'pre-wrap' }}
            >
              {parseCitations(msg.content).map((token, i) => {
                if (token.type === 'text') {
                  return <span key={i}>{token.value}</span>;
                }
                const source = msg.sources.find((item) => item.source_index === token.sourceIndex);
                const pageUrl = source
                  ? buildPdfPageUrl(source.original_path, source.pagina_detectada)
                  : null;
                const pdfUrl = source ? buildPdfUrl(source.original_path) : null;
                const externalUrl = source ? buildSafeHttpUrl(source.original_path) : null;
                const destinationUrl = pageUrl ?? pdfUrl ?? externalUrl;

                if (!source) {
                  return (
                    <span key={i}>{token.originalText}</span>
                  );
                }

                if (destinationUrl) {
                  return (
                    <a
                      key={i}
                      href={destinationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setActiveSource(source)}
                      className="text-primary hover:underline font-semibold cursor-pointer"
                    >
                      {token.originalText}
                    </a>
                  );
                }

                return <span key={i}>{token.originalText}</span>;
              })}
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

          <div ref={messagesEndRef} aria-hidden="true" />
        </div>

        {!autoScrollEnabled && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="absolute bottom-24 left-1/2 z-10 -translate-x-1/2 shadow-md"
            onClick={handleScrollToLatest}
          >
            <ArrowDown className="h-4 w-4" />
            Ir al último mensaje
          </Button>
        )}

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
              aria-label="Enviar consulta"
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
          {latestAssistantSources.length === 0 ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
              Aquí se mostrarán los fragmentos del PGOU o documentos subidos relevantes para la
              consulta actual.
            </div>
          ) : activeSource === null ? (
            <>
              <div className="text-muted-foreground text-center text-xs mb-2">
                Pulsa una fuente de la respuesta para examinarla
              </div>
              {latestAssistantSources.map((source) => (
                <button
                  key={source.source_index}
                  type="button"
                  className="bg-background w-full rounded-md border p-3 text-left text-sm shadow-sm cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setActiveSource(source)}
                >
                  <div className="text-primary mb-1 font-semibold">
                    [Fuente {source.source_index}]
                  </div>
                  <div className="text-muted-foreground mb-2 space-y-1 text-xs">
                    <p><span className="font-medium">Municipio:</span> {source.municipio_nombre}</p>
                    <p><span className="font-medium">Documento:</span> {source.nombre_pdf}</p>
                    {source.fragmento_corto && (
                      <p className="text-foreground/80 border-muted-foreground/30 mt-2 border-l-2 pl-2 italic">
                        &ldquo;{source.fragmento_corto}&rdquo;
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </>
          ) : (() => {
            const source = activeSource;
            if (!source) return null;
            const safeOriginalUrl = buildSafeHttpUrl(source.original_path);
            const pdfUrl = buildPdfUrl(source.original_path);
            const pdfPageUrl = buildPdfPageUrl(source.original_path, source.pagina_detectada);
            const documentUrl = pdfPageUrl ?? pdfUrl;
            const isSiotuga = safeOriginalUrl?.includes('siotuga.xunta.gal/siotuga/inventario');
            const hasUrl = safeOriginalUrl !== null;
            const sourceFragment = source.fragmento_completo ?? source.fragmento_corto;
            const copyableFragment = getCopyableSourceFragment(source);
            const citationText = buildSourceCitationText(source);
            const copyUnavailableId = `copy-unavailable-${source.source_index}`;

            const copyText = async (text: string | null, successMessage: string) => {
              setCopyFeedback(null);
              if (!text) {
                setCopyFeedback({
                  source,
                  kind: 'error',
                  message: 'No hay un fragmento disponible para copiar.',
                });
                return;
              }

              try {
                const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
                if (!clipboard || typeof clipboard.writeText !== 'function') {
                  setCopyFeedback({
                    source,
                    kind: 'error',
                    message: 'No se pudo copiar porque el portapapeles no está disponible.',
                  });
                  return;
                }

                await clipboard.writeText(text);
                setCopyFeedback({ source, kind: 'success', message: successMessage });
              } catch {
                setCopyFeedback({
                  source,
                  kind: 'error',
                  message: 'No se pudo copiar. Comprueba los permisos del portapapeles e inténtalo de nuevo.',
                });
              }
            };

            const handleCopy = async () => {
              await copyText(copyableFragment, 'Fragmento copiado.');
            };

            const handleCopyWithCitation = async () => {
              await copyText(citationText, 'Cita copiada.');
            };

            return (
              <div className="flex flex-col h-full bg-background rounded-md border p-4 text-sm shadow-sm">
                <div className="mb-4">
                  <div className="text-primary font-semibold mb-2 text-lg">
                    [Fuente {source.source_index}]
                  </div>
                  <div className="space-y-1">
                    <p><span className="font-medium">Documento:</span> {source.nombre_pdf}</p>
                    {(source.municipio_nombre && source.municipio_nombre !== 'No identificado') && (
                      <p><span className="font-medium">Municipio/Ámbito:</span> {source.municipio_nombre}</p>
                    )}
                    {source.titulo_detectado && (
                      <p><span className="font-medium">Referencia detectada:</span> {source.titulo_detectado}</p>
                    )}
                    {source.pagina_detectada && (
                      <p><span className="font-medium">Página:</span> {source.pagina_detectada}</p>
                    )}
                  </div>
                </div>

                <div className="border-yellow-500/30 bg-yellow-500/10 text-yellow-900 dark:text-yellow-100 rounded-md border p-3 mb-4 text-xs font-medium flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Texto extraído automáticamente. Puede contener errores de lectura o formato. Verifique siempre el documento original.
                  </span>
                </div>

                {documentUrl ? (() => {

                  return (
                    <div className="flex-1 flex flex-col min-h-0 mb-4 gap-2">
                      {pdfPageUrl === null && (
                        <div className="bg-muted text-muted-foreground p-2 text-xs rounded-md">
                          Página no determinada. Mostrando el documento desde el inicio.
                        </div>
                      )}
                      <iframe
                        src={documentUrl}

                        className="w-full flex-1 rounded-md border bg-white min-h-[300px]"
                        title={`Visor PDF ${source.nombre_pdf}`}
                      />
                      <div className="text-xs text-muted-foreground line-clamp-3">
                        {sourceFragment
                          ? <>Texto recuperado: &ldquo;{sourceFragment}&rdquo;</>
                          : 'Fragmento no disponible.'}
                      </div>
                    </div>
                  );
                })() : safeOriginalUrl ? (
                  <div className="flex-1 overflow-y-auto mb-4 border rounded-md p-3 text-sm whitespace-pre-wrap">
                    <p className="text-muted-foreground mb-3 text-xs">
                      Esta fuente enlaza una ficha o documento externo. No se dispone de un PDF con página exacta.
                    </p>
                    {sourceFragment ?? 'Fragmento no disponible.'}
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto mb-4 border rounded-md p-3 text-sm whitespace-pre-wrap">
                    {sourceFragment ?? 'Fragmento no disponible.'}
                  </div>
                )}

                <div className="flex flex-col gap-2 shrink-0">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={handleCopy}
                      disabled={!copyableFragment}
                      aria-describedby={!copyableFragment ? copyUnavailableId : undefined}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1.5" />
                      Copiar fragmento
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={handleCopyWithCitation}
                      disabled={!copyableFragment}
                      aria-describedby={!copyableFragment ? copyUnavailableId : undefined}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1.5" />
                      Copiar con cita
                    </Button>
                  </div>
                  {!copyableFragment && (
                    <p id={copyUnavailableId} role="status" aria-live="polite" className="text-destructive text-xs">
                      No hay un fragmento disponible para copiar.
                    </p>
                  )}
                  {copyFeedback?.source === source && (
                    <p
                      role="status"
                      aria-live="polite"
                      className={copyFeedback.kind === 'error' ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}
                    >
                      {copyFeedback.message}
                    </p>
                  )}
                  <div className="flex gap-2">
                    {hasUrl ? (
                      <Button variant="default" size="sm" className="flex-1 text-xs" onClick={() => {
                        window.open(documentUrl ?? safeOriginalUrl, '_blank', 'noopener,noreferrer');
                      }}>
                        {isSiotuga ? (
                          <>
                            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                            Abrir ficha de SIOTUGA
                          </>
                        ) : documentUrl ? (
                          <>
                            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                            Abrir original
                          </>
                        ) : (
                          <>
                            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                            Abrir documento externo
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" className="flex-1 text-xs" disabled>
                        Enlace oficial no disponible
                      </Button>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="w-full text-xs mt-2" onClick={() => setActiveSource(null)}>
                    <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                    Volver a fuentes
                  </Button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
