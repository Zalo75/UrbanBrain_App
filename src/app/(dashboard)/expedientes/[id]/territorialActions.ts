'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { getExpedienteAccess } from '@/application/authorization/expedienteAccess';
import { ContextDetectionEngine } from '@/application/context-engine/ContextDetectionEngine';
import { normalizeCadastralReference } from '@/application/territorial-resolver/resolveParcelLocation';
import { db } from '@/infrastructure/db/client';
import { expedientes } from '@/infrastructure/db/schema';

export interface TerritorialResolutionActionState {
  status: 'idle' | 'success' | 'error';
  message: string;
}

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export async function resolveTerritorialContextAction(
  expedienteId: string,
  _previousState: TerritorialResolutionActionState,
  formData: FormData
): Promise<TerritorialResolutionActionState> {
  const access = await getExpedienteAccess(expedienteId);
  if (!access.ok) {
    return { status: 'error', message: 'No se ha encontrado el expediente.' };
  }

  const rawReference = textValue(formData, 'refCatastral');
  const cadastralReference = normalizeCadastralReference(rawReference);
  if (rawReference && !cadastralReference) {
    return { status: 'error', message: 'La referencia catastral no tiene un formato válido.' };
  }

  const address = textValue(formData, 'address');
  const rawLat = textValue(formData, 'lat');
  const rawLng = textValue(formData, 'lng');
  if (Boolean(rawLat) !== Boolean(rawLng)) {
    return { status: 'error', message: 'Latitud y longitud deben introducirse juntas.' };
  }

  const lat = rawLat ? Number(rawLat) : null;
  const lng = rawLng ? Number(rawLng) : null;
  if (
    (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) ||
    (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180))
  ) {
    return { status: 'error', message: 'Las coordenadas WGS84 no son válidas.' };
  }
  if (!cadastralReference && lat === null && !address) {
    return {
      status: 'error',
      message: 'Introduzca una referencia catastral, unas coordenadas o una dirección.',
    };
  }

  const existingReference = normalizeCadastralReference(access.expediente.refCatastral);
  const locationChanged = Boolean(
    existingReference !== cadastralReference ||
    (access.expediente.address?.trim() || '') !== address ||
    access.expediente.lat !== lat ||
    access.expediente.lng !== lng
  );

  let result;
  try {
    await db
      .update(expedientes)
      .set({
        refCatastral: cadastralReference,
        address: address || null,
        lat,
        lng,
        location: lat !== null && lng !== null ? [lng, lat] : null,
        locationSource: cadastralReference
          ? 'cadastral_reference'
          : lat !== null
            ? 'coordinates'
            : 'address',
        contextoValidadoPorTecnico: locationChanged
          ? false
          : access.expediente.contextoValidadoPorTecnico,
      })
      .where(and(eq(expedientes.id, expedienteId), eq(expedientes.orgId, access.orgId)));

    result = await new ContextDetectionEngine().detectContext(expedienteId, access.userId);
    if (!result) {
      return { status: 'error', message: 'No se ha encontrado el expediente.' };
    }
  } catch {
    return {
      status: 'error',
      message: 'No se ha podido completar la consulta territorial. Inténtelo de nuevo.',
    };
  }

  revalidatePath(`/expedientes/${expedienteId}`);
  const message =
    result.status === 'confirmed'
      ? 'Ubicación confirmada y contexto territorial actualizado.'
      : result.status === 'probable' || result.status === 'ambiguous'
        ? 'Se ha guardado un resultado aproximado que requiere validación.'
        : 'La consulta se ha guardado, pero no ha podido determinarse la ubicación.';
  return { status: 'success', message };
}
