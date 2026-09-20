import { NextRequest, NextResponse } from 'next/server';
import { getExpedienteAccess } from '@/application/authorization/expedienteAccess';
import {
  getExistingDerivationsForSource,
  transformSource,
} from '@/application/document-reading/sourceTransformationEngine';
import { SourceDerivationType } from '@/application/document-reading/types';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const expedienteId = searchParams.get('expedienteId');
    const sourceRef = searchParams.get('sourceRef');
    const sourceHash = searchParams.get('sourceHash') || undefined;

    if (!expedienteId || !sourceRef) {
      return NextResponse.json(
        { error: 'expedienteId y sourceRef son obligatorios.' },
        { status: 400 }
      );
    }

    const access = await getExpedienteAccess(expedienteId);
    if (!access.ok) {
      const status = access.reason === 'unauthenticated' ? 401 : 404;
      return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Not found' }, { status });
    }

    const derivations = await getExistingDerivationsForSource(expedienteId, sourceRef, sourceHash);
    return NextResponse.json({ derivations });
  } catch (error) {
    console.error('Error fetching source derivations:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { expedienteId, sourceRef, derivationType, targetLanguage } = body;

    if (!expedienteId || typeof expedienteId !== 'string') {
      return NextResponse.json({ error: 'expedienteId es obligatorio.' }, { status: 400 });
    }
    if (!sourceRef || typeof sourceRef !== 'string') {
      return NextResponse.json({ error: 'sourceRef es obligatorio.' }, { status: 400 });
    }
    if (derivationType !== 'ocr_correction' && derivationType !== 'translation') {
      return NextResponse.json(
        { error: 'derivationType debe ser "ocr_correction" o "translation".' },
        { status: 400 }
      );
    }

    if (sourceRef.startsWith('planning:evidence') || sourceRef.startsWith('synthetic:')) {
      return NextResponse.json(
        { error: 'Las fuentes sintéticas de planeamiento no admiten transformaciones.' },
        { status: 422 }
      );
    }

    const access = await getExpedienteAccess(expedienteId);
    if (!access.ok) {
      const status = access.reason === 'unauthenticated' ? 401 : 404;
      return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Not found' }, { status });
    }

    const result = await transformSource({
      expedienteId,
      sourceRef,
      derivationType: derivationType as SourceDerivationType,
      targetLanguage: typeof targetLanguage === 'string' ? targetLanguage : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('FAIL_CLOSED_SYNTHETIC_SOURCE')) {
      return NextResponse.json(
        { error: 'Las fuentes sintéticas de planeamiento no admiten transformaciones.' },
        { status: 422 }
      );
    }
    if (message.startsWith('FAIL_CLOSED_NOT_ACCREDITED')) {
      return NextResponse.json({ error: 'La fuente solicitada no está acreditada en este expediente.' }, { status: 422 });
    }
    if (message.startsWith('FAIL_CLOSED')) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    if (message.includes('PROVIDER_NOT_CONFIGURED') || message.includes('Servicio de transformación documental no configurado')) {
      return NextResponse.json({ error: 'Servicio de transformación documental no configurado.' }, { status: 503 });
    }
    console.error('Error transforming source:', error);
    return NextResponse.json({ error: 'Error al procesar la transformación de la fuente.' }, { status: 500 });
  }
}
