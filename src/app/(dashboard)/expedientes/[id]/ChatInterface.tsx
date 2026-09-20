'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Send,
  FileText,
  AlertCircle,
  ArrowDown,
  Copy,
  ExternalLink,
  ArrowLeft,
  AlertTriangle,
  Sparkles,
  Languages,
  Loader2,
} from 'lucide-react';
import {
  buildPdfPageUrl,
  buildPdfUrl,
  buildSafeHttpUrl,
  prepareCitationPresentation,
} from './chatCitations';
import {
  buildSourceCitationText,
  getCopyableSourceFragment,
  normalizeDetectedReference,
  normalizeFragment,
} from './sourceClipboard';
import { cn } from '@/lib/utils';
import type { SourceDerivationRecord } from '@/application/document-reading/types';
import { detectDocumentLanguage, type SupportedLanguage } from '@/application/document-reading/languageDetector';

type ReadingTab = 'original' | 'ocr' | 'translation';

const PRODUCT_LANGUAGES: { code: SupportedLanguage; label: string; name: string }[] = [
  { code: 'es', label: 'Castellano', name: 'castellano' },
  { code: 'gl', label: 'Galego', name: 'gallego' },
  { code: 'ca', label: 'Català', name: 'catalán' },
  { code: 'eu', label: 'Euskara', name: 'euskera' },
  { code: 'en', label: 'English', name: 'inglés' },
];

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
  source_kind?: string | null;
  official_url?: string | null;
  original_path?: string | null;
  pagina_detectada?: string | number | null;
  fragmento_corto?: string | null;
  fragmento_completo?: string | null;
  content?: string | null;
  texto?: string | null;
  truncated?: boolean;
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

  let candidateIndex = 0;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    candidateIndex += 1;
    const raw = candidate as Record<string, unknown>;
    const rawIndex = raw.source_index ?? raw.sourceIndex ?? candidateIndex;
    const sourceIndex = normalizePositiveInteger(rawIndex) ?? candidateIndex;
    if (seenSourceIndexes.has(sourceIndex)) continue;

    seenSourceIndexes.add(sourceIndex);
    const explicitOfficialUrl = typeof raw.official_url === 'string'
      ? raw.official_url
      : typeof raw.officialUrl === 'string' ? raw.officialUrl : null;
    const officialUrl = buildSafeHttpUrl(explicitOfficialUrl) ??
      buildSafeHttpUrl(typeof raw.original_path === 'string' ? raw.original_path : null);
    const rawChunkId = raw.chunk_id ?? raw.chunkId ?? raw.id;
    const rawDocumentName = raw.nombre_pdf ?? raw.filename ?? raw.documentName ?? raw.title;
    const rawPage = raw.pagina_detectada ?? raw.page;

    const rawCompleto =
      raw.fragmento_completo ??
      raw.fragmentoCompleto ??
      raw.content ??
      raw.texto ??
      raw.text ??
      raw.fragmento ??
      raw.fragment;

    const rawCorto =
      raw.fragmento_corto ??
      raw.fragmentoCorto ??
      raw.preview ??
      raw.snippet;

    const normalizedCompleto = normalizeFragment(rawCompleto);
    const normalizedCorto =
      normalizeFragment(rawCorto) ??
      (normalizedCompleto && normalizedCompleto.length > 180
        ? `${normalizedCompleto.slice(0, 180)}…`
        : normalizedCompleto);

    sources.push({
      chunk_id: typeof rawChunkId === 'string' || typeof rawChunkId === 'number' ? String(rawChunkId) : '',
      municipio_nombre: typeof raw.municipio_nombre === 'string' ? raw.municipio_nombre : 'No identificado',
      nombre_pdf: typeof rawDocumentName === 'string' ? rawDocumentName : 'Documento',
      titulo_detectado: normalizeDetectedReference(raw.titulo_detectado),
      similarity: typeof raw.similarity === 'number' ? raw.similarity : null,
      source_index: sourceIndex,
      source_kind: typeof raw.source_kind === 'string' ? raw.source_kind : null,
      official_url: officialUrl,
      original_path: officialUrl,
      pagina_detectada:
        typeof rawPage === 'string' || typeof rawPage === 'number'
          ? rawPage
          : null,
      fragmento_corto: normalizedCorto,
      fragmento_completo: normalizedCompleto,
      content: normalizedCompleto ?? normalizedCorto,
      texto: normalizedCompleto ?? normalizedCorto,
      truncated: raw.truncated === true,
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
  const [activeSourceView, setActiveSourceView] = useState<'text' | 'pdf' | null>(null);
  const [readingTab, setReadingTab] = useState<ReadingTab>('original');
  const [targetLanguage, setTargetLanguage] = useState<SupportedLanguage>('es');
  const [sourceDerivations, setSourceDerivations] = useState<
    Record<string, { ocr?: SourceDerivationRecord; translations?: Record<string, SourceDerivationRecord> }>
  >({});
  const [transformLoading, setTransformLoading] = useState(false);
  const [transformError, setTransformError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const sourcePanelRef = useRef<HTMLDivElement>(null);

  const isSyntheticSource = Boolean(
    activeSource?.chunk_id?.startsWith('planning:evidence') ||
    activeSource?.chunk_id?.startsWith('synthetic:')
  );

  const selectSource = useCallback((source: Source | null) => {
    setActiveSource(source);
    setActiveSourceView(null);
    setReadingTab('original');
    setTransformError(null);

    if (source) {
      const fragment =
        source.fragmento_completo ??
        source.fragmento_corto ??
        normalizeFragment(source.content) ??
        normalizeFragment(source.texto) ??
        '';
      const detected = detectDocumentLanguage(fragment).language;
      setTargetLanguage((current) => (current === detected ? (detected === 'es' ? 'gl' : 'es') : current));
    }
  }, []);

  useEffect(() => {
    if (sourcePanelRef.current) {
      sourcePanelRef.current.scrollTop = 0;
    }
  }, [activeSource]);

  useEffect(() => {
    if (!activeSource || !expedienteId || isSyntheticSource) return;
    const sourceRef = activeSource.chunk_id || String(activeSource.source_index);
    let cancelled = false;

    async function loadDerivations() {
      try {
        const res = await fetch(
          `/api/sources/transform?expedienteId=${encodeURIComponent(expedienteId)}&sourceRef=${encodeURIComponent(sourceRef)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.derivations || !Array.isArray(data.derivations)) return;

        setSourceDerivations((prev) => {
          const current = prev[sourceRef] || {};
          const nextOcr =
            (data.derivations as SourceDerivationRecord[]).find((d) => d.derivationType === 'ocr_correction') ??
            current.ocr;
          const translations: Record<string, SourceDerivationRecord> = { ...(current.translations || {}) };
          for (const d of data.derivations as SourceDerivationRecord[]) {
            if (d.derivationType === 'translation' && d.targetLanguage) {
              translations[d.targetLanguage] = d;
            }
          }
          return {
            ...prev,
            [sourceRef]: {
              ocr: nextOcr,
              translations,
            },
          };
        });
      } catch {
        // Non-blocking fetch
      }
    }

    loadDerivations();
    return () => {
      cancelled = true;
    };
  }, [activeSource, expedienteId, isSyntheticSource]);

  const handleTransformSource = async (derivationType: 'ocr_correction' | 'translation', requestedTargetLang?: SupportedLanguage) => {
    if (!activeSource || transformLoading || isSyntheticSource) return;
    const sourceRef = activeSource.chunk_id || String(activeSource.source_index);
    const langToSend = requestedTargetLang || targetLanguage;
    setTransformLoading(true);
    setTransformError(null);

    try {
      const res = await fetch('/api/sources/transform', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expedienteId,
          sourceRef,
          derivationType,
          targetLanguage: derivationType === 'translation' ? langToSend : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Error al procesar la transformación.');
      }

      const result = await res.json();
      const derivation: SourceDerivationRecord = result.derivation;

      setSourceDerivations((prev) => {
        const current = prev[sourceRef] || {};
        if (derivationType === 'ocr_correction') {
          return {
            ...prev,
            [sourceRef]: {
              ...current,
              ocr: derivation,
            },
          };
        } else {
          return {
            ...prev,
            [sourceRef]: {
              ...current,
              translations: {
                ...(current.translations || {}),
                [langToSend]: derivation,
              },
            },
          };
        }
      });
    } catch (err) {
      setTransformError(err instanceof Error ? err.message : 'Error al procesar la transformación.');
    } finally {
      setTransformLoading(false);
    }
  };
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
        selectSource(null);
      } catch {
        setError('No se ha podido cargar el historial del chat.');
      }
    }

    if (expedienteId) {
      fetchHistory();
    }
  }, [expedienteId, selectSource]);

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
    const timeoutId = window.setTimeout(() => controller.abort(), 125_000);

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
      selectSource(null);
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

          {messages.map((msg, index) => {
            const citationPresentation = prepareCitationPresentation(msg.content);
            return (
              <div
                key={index}
                className={`max-w-[85%] rounded-lg p-3 text-sm break-words ${msg.role === 'user' ? 'bg-primary text-primary-foreground ml-auto' : 'bg-muted'}`}
                style={{ whiteSpace: 'pre-wrap' }}
              >
              {citationPresentation.tokens.map((token, i) => {
                if (token.type === 'text') {
                  return <span key={i}>{token.value}</span>;
                }
                if (token.type === 'context') {
                  return null;
                }
                const source = msg.sources.find((item) => {
                  if (token.sourceRef && item.chunk_id === token.sourceRef) return true;
                  if (token.sourceIndex !== undefined && item.source_index === token.sourceIndex) return true;
                  if (token.sourceRef && item.chunk_id.startsWith(token.sourceRef + ':')) return true;
                  return false;
                });
                const sourceUrl = source?.official_url ?? source?.original_path;
                const pageUrl = source
                  ? buildPdfPageUrl(sourceUrl, source.pagina_detectada)
                  : null;
                const pdfUrl = source ? buildPdfUrl(sourceUrl) : null;
                const externalUrl = source ? buildSafeHttpUrl(sourceUrl) : null;
                const destinationUrl = pageUrl ?? pdfUrl ?? externalUrl;

                if (!source) {
                  return (
                    <span key={i}>{token.originalText}</span>
                  );
                }

                const handleSelectCitation = (e: React.MouseEvent) => {
                  e.preventDefault();
                  selectSource(source);
                };

                if (destinationUrl) {
                  return (
                    <a
                      key={i}
                      href={destinationUrl}
                      onClick={handleSelectCitation}
                      className="text-primary hover:underline font-semibold cursor-pointer"
                    >
                      {token.originalText}
                    </a>
                  );
                }

                return (
                  <button
                    key={i}
                    type="button"
                    onClick={handleSelectCitation}
                    className="text-primary inline border-0 bg-transparent p-0 font-semibold hover:underline cursor-pointer"
                  >
                    {token.originalText}
                  </button>
                );
              })}
              {citationPresentation.showContextIndicator && (
                <span className="mx-1 inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground" title="Dato estructurado del expediente; no es una fuente documental">
                  Dato del expediente
                </span>
              )}
              </div>
            );
          })}

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
        <div ref={sourcePanelRef} className="flex-1 space-y-4 overflow-y-auto p-4">
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
                  onClick={() => selectSource(source)}
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
            const sourceRef = source.chunk_id || String(source.source_index);
            const sourceUrl = source.official_url ?? source.original_path;
            const safeOriginalUrl = buildSafeHttpUrl(sourceUrl);
            const pdfUrl = buildPdfUrl(sourceUrl);
            const pdfPageUrl = buildPdfPageUrl(sourceUrl, source.pagina_detectada);
            const documentUrl = pdfPageUrl ?? pdfUrl;
            const hasUrl = safeOriginalUrl !== null;
            const sourceFragment =
              source.fragmento_completo ??
              source.fragmento_corto ??
              normalizeFragment(source.content) ??
              normalizeFragment(source.texto);
            const copyableFragment = getCopyableSourceFragment(source);

            const detectedSourceLang = detectDocumentLanguage(sourceFragment || '').language;
            const availableTargetLanguages = PRODUCT_LANGUAGES.filter((language) => language.code !== detectedSourceLang);
            const effectiveTargetLang = targetLanguage === detectedSourceLang
              ? (detectedSourceLang === 'es' ? 'gl' : 'es')
              : targetLanguage;

            const activeDerivations = isSyntheticSource ? undefined : sourceDerivations[sourceRef];
            const currentOcr = activeDerivations?.ocr;
            const currentTranslation = activeDerivations?.translations?.[effectiveTargetLang];

            const activeDerivedText =
              !isSyntheticSource && readingTab === 'ocr'
                ? currentOcr?.derivedText ?? null
                : !isSyntheticSource && readingTab === 'translation'
                ? currentTranslation?.derivedText ?? null
                : null;

            const textToCopy =
              !isSyntheticSource && readingTab !== 'original' && activeDerivedText ? activeDerivedText : copyableFragment;

            const citationText = buildSourceCitationText(source, {
              activeViewMode: isSyntheticSource ? 'original' : readingTab,
              targetLanguage: !isSyntheticSource && readingTab === 'translation' ? effectiveTargetLang : null,
              derivedText: activeDerivedText,
            });

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
              const label =
                readingTab === 'ocr' && activeDerivedText
                  ? 'Texto OCR corregido copiado.'
                  : readingTab === 'translation' && activeDerivedText
                  ? 'Traducción asistida copiada.'
                  : 'Fragmento copiado.';
              await copyText(textToCopy, label);
            };

            const handleCopyWithCitation = async () => {
              await copyText(citationText, 'Cita copiada.');
            };

            return (
              <div className="flex flex-col min-h-full bg-background rounded-md border p-4 text-sm shadow-sm">
                <div className="mb-4">
                  <div className="text-primary font-semibold mb-2 text-lg">
                    [Fuente {source.source_index}]
                  </div>
                  {source.chunk_id && source.chunk_id !== String(source.source_index) && (
                    <div className="text-xs text-muted-foreground font-mono mb-2 break-all">
                      {source.chunk_id}
                    </div>
                  )}
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

                <div className="grid grid-cols-2 gap-2 mb-4">
                  <Button
                    type="button"
                    variant={activeSourceView === 'text' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveSourceView((prev) => (prev === 'text' ? null : 'text'))}
                    className="w-full text-xs font-semibold"
                  >
                    <FileText className="w-3.5 h-3.5 mr-1.5" />
                    TEXTO
                  </Button>
                  <Button
                    type="button"
                    variant={activeSourceView === 'pdf' ? 'default' : 'outline'}
                    size="sm"
                    disabled={!hasUrl}
                    onClick={() => setActiveSourceView((prev) => (prev === 'pdf' ? null : 'pdf'))}
                    className="w-full text-xs font-semibold"
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    PDF
                  </Button>
                </div>

                {activeSourceView === 'text' ? (
                  <div className="flex-1 flex flex-col min-h-0 mb-4 gap-2">
                    {/* Sub-tabs: Original | OCR corregido | Traducción asistida */}
                    {!isSyntheticSource && (
                    <div className="flex items-center gap-1 border-b pb-1.5 text-xs font-medium" role="tablist" aria-label="Modo de lectura">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={readingTab === 'original'}
                        onClick={() => setReadingTab('original')}
                        className={cn(
                          "px-2.5 py-1 rounded transition-colors text-xs font-medium cursor-pointer",
                          readingTab === 'original'
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        Original
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={readingTab === 'ocr'}
                        onClick={() => setReadingTab('ocr')}
                        className={cn(
                          "px-2.5 py-1 rounded transition-colors text-xs font-medium inline-flex items-center gap-1 cursor-pointer",
                          readingTab === 'ocr'
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        <Sparkles className="w-3 h-3" />
                        OCR corregido
                        {currentOcr && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Disponible" />
                        )}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={readingTab === 'translation'}
                        onClick={() => setReadingTab('translation')}
                        className={cn(
                          "px-2.5 py-1 rounded transition-colors text-xs font-medium inline-flex items-center gap-1 cursor-pointer",
                          readingTab === 'translation'
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        <Languages className="w-3 h-3" />
                        Traducción asistida
                        {currentTranslation && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Disponible" />
                        )}
                      </button>
                    </div>
                    )}

                    {/* Tab Content */}
                    {(readingTab === 'original' || isSyntheticSource) && (
                      <div className="flex-1 flex flex-col min-h-0 gap-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground font-medium">Fragmento literal acreditado:</span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground border">
                            Original acreditado
                          </span>
                        </div>
                        <div
                          data-testid="source-fragment-container"
                          className="flex-1 min-h-[160px] max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-md border p-3 text-xs text-foreground bg-muted/20 select-text leading-relaxed"
                        >
                          {sourceFragment
                            ? <>Texto recuperado: &ldquo;{sourceFragment}&rdquo;</>
                            : 'Fragmento no disponible.'}
                        </div>
                        {source.truncated && (
                          <p className="text-xs text-muted-foreground font-sans">
                            El fragmento ampliado se ha limitado por su tamaño. Consulte el documento original.
                          </p>
                        )}
                      </div>
                    )}

                    {!isSyntheticSource && readingTab === 'ocr' && (
                      <div className="flex-1 flex flex-col min-h-0 gap-2">
                        {currentOcr ? (
                          <>
                            <div className="border-blue-500/30 bg-blue-500/10 text-blue-900 dark:text-blue-200 rounded-md border p-2 text-[11px] font-medium flex items-start gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-blue-500" />
                              <span>
                                OCR corregido — limpieza tipográfica automática. El contenido original acreditado permanece inalterado.
                              </span>
                            </div>
                            <div
                              data-testid="source-ocr-container"
                              className="flex-1 min-h-[160px] max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-md border p-3 text-xs text-foreground bg-muted/20 select-text leading-relaxed"
                            >
                              {currentOcr.derivedText}
                            </div>
                          </>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border rounded-md border-dashed text-muted-foreground text-xs gap-3">
                            <Sparkles className="w-6 h-6 text-muted-foreground/60" />
                            <div>
                              <p className="font-medium text-foreground mb-1">Limpieza tipográfica de OCR</p>
                              <p className="text-muted-foreground">
                                Recompone palabras cortadas por guiones y saltos de línea mecánicos sin alterar números ni contenido normativo.
                              </p>
                            </div>
                            {transformError && (
                              <p className="text-destructive text-xs">{transformError}</p>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="text-xs"
                              disabled={transformLoading || !sourceFragment}
                              onClick={() => handleTransformSource('ocr_correction')}
                            >
                              {transformLoading ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                  Limpiando texto...
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                                  Limpiar defectos de OCR
                                </>
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {!isSyntheticSource && readingTab === 'translation' && (
                      <div className="flex-1 flex flex-col min-h-0 gap-2">
                        {/* Target language selector */}
                        <div className="flex items-center justify-between text-xs gap-2">
                          <span className="text-muted-foreground font-medium">Idioma de destino:</span>
                          <div className="inline-flex flex-wrap rounded-md border p-0.5 bg-muted/30">
                            {availableTargetLanguages.map((language) => (
                              <button
                                key={language.code}
                                type="button"
                                onClick={() => setTargetLanguage(language.code)}
                                className={cn(
                                  "px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer",
                                  effectiveTargetLang === language.code
                                    ? "bg-background text-foreground shadow-xs font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                                )}
                              >
                                {language.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {currentTranslation ? (
                          <>
                            <div className="border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 rounded-md border p-2 text-[11px] font-medium flex items-start gap-1.5">
                              <Languages className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
                              <div className="space-y-0.5">
                                <p>
                                  Traducción asistida — versión de apoyo para comprensión, sin validez jurídica oficial.
                                </p>
                                <p className="text-[10px] opacity-80">
                                  {currentTranslation.translationSource === 'ocr_correction'
                                    ? 'Generada a partir del texto con OCR corregido.'
                                    : 'Generada a partir del original acreditado.'}
                                </p>
                              </div>
                            </div>
                            <div
                              data-testid="source-translation-container"
                              className="flex-1 min-h-[160px] max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-md border p-3 text-xs text-foreground bg-muted/20 select-text leading-relaxed"
                            >
                              {currentTranslation.derivedText}
                            </div>
                          </>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border rounded-md border-dashed text-muted-foreground text-xs gap-3">
                            <Languages className="w-6 h-6 text-muted-foreground/60" />
                            <div>
                              <p className="font-medium text-foreground mb-1">Traducción documental asistida</p>
                              <p className="text-muted-foreground">
                                Traducción fiel de terminología jurídica y urbanística al {PRODUCT_LANGUAGES.find(
                                  (language) => language.code === effectiveTargetLang,
                                )?.name ?? effectiveTargetLang}.
                                {currentOcr && ' Se utilizará la versión con OCR corregido para mayor precisión.'}
                              </p>
                            </div>
                            {transformError && (
                              <p className="text-destructive text-xs">{transformError}</p>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="text-xs"
                              disabled={transformLoading || !sourceFragment}
                              onClick={() => handleTransformSource('translation', effectiveTargetLang)}
                            >
                              {transformLoading ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                  Traduciendo...
                                </>
                              ) : (
                                <>
                                  <Languages className="w-3.5 h-3.5 mr-1.5" />
                                  Traducir a {PRODUCT_LANGUAGES.find(
                                    (language) => language.code === effectiveTargetLang,
                                  )?.name ?? effectiveTargetLang}
                                </>
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : activeSourceView === 'pdf' ? (
                  documentUrl ? (
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
                    </div>
                  ) : safeOriginalUrl ? (
                    <div className="flex-1 overflow-y-auto mb-4 border rounded-md p-3 text-sm whitespace-pre-wrap">
                      <p className="text-muted-foreground mb-3 text-xs">
                        Esta fuente enlaza una ficha o documento externo. No se dispone de un PDF con página exacta.
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto mb-4 border rounded-md p-3 text-xs text-muted-foreground">
                      Documento oficial no disponible.
                    </div>
                  )
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-4 border rounded-md border-dashed text-muted-foreground text-xs my-2">
                    <p className="font-medium text-foreground mb-1">Fuente seleccionada</p>
                    <p>
                      Pulsa <span className="font-semibold text-primary">TEXTO</span> para examinar el fragmento literal acreditado, o <span className="font-semibold text-primary">PDF</span> para inspeccionar el documento oficial.
                    </p>
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
                      disabled={!textToCopy}
                      aria-describedby={!textToCopy ? copyUnavailableId : undefined}
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
                      disabled={!citationText}
                      aria-describedby={!citationText ? copyUnavailableId : undefined}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1.5" />
                      Copiar con cita
                    </Button>
                  </div>
                  {!textToCopy && (
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
                    {hasUrl && (
                      <Button variant="default" size="sm" className="flex-1 text-xs" onClick={() => {
                        window.open(documentUrl ?? safeOriginalUrl, '_blank', 'noopener,noreferrer');
                      }}>
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                        Abrir documento original
                      </Button>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="w-full text-xs mt-2" onClick={() => selectSource(null)}>
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
