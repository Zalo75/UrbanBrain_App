'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { getExpedienteAccess } from '@/application/authorization/expedienteAccess';
import { hasOrganizationPermission } from '@/application/authorization/organizationRoles';
import { ContextDetectionEngine } from '@/application/context-engine/ContextDetectionEngine';
import { normalizeCadastralReference } from '@/application/territorial-resolver/resolveParcelLocation';
import {
  allSourceChecks,
  officialContextForUse,
} from '@/application/territorial-resolver/territorialContinuity';
import { buildTerritorialContextView } from '@/application/territorial-resolver/territorialContextView';
import type { ManualTerritorialContext } from '@/domain/territorial-resolver/types';
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

function limitedText(formData: FormData, name: string, maxLength = 160) {
  return textValue(formData, name).slice(0, maxLength);
}

export async function resolveTerritorialContextAction(
  expedienteId: string,
  _previousState: TerritorialResolutionActionState,
  formData: FormData
): Promise<TerritorialResolutionActionState> {
  const attemptStartedAt = new Date().toISOString();
  const access = await getExpedienteAccess(expedienteId);
  if (!access.ok) {
    return { status: 'error', message: 'No se ha encontrado el expediente.' };
  }
  const intent = textValue(formData, 'intent') === 'manual' ? 'manual' : 'resolve';
  if (
    intent === 'manual' &&
    !hasOrganizationPermission(access.membershipRole, 'context.manual.write')
  ) {
    return { status: 'error', message: 'No tienes permisos para guardar contexto manual.' };
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
  const manualMunicipality = limitedText(formData, 'manualMunicipality', 80);
  const manualClassification = limitedText(formData, 'manualClassification', 80);
  const manualCategory = limitedText(formData, 'manualCategory', 80);
  const manualArea = limitedText(formData, 'manualArea', 100);
  const manualOrdinance = limitedText(formData, 'manualOrdinance', 100);
  const manualObservations = limitedText(formData, 'manualObservations', 1000);
  const hasManualData = Boolean(
    cadastralReference ||
      address ||
      lat !== null ||
      manualMunicipality ||
      manualClassification ||
      manualCategory ||
      manualArea ||
      manualOrdinance ||
      manualObservations
  );

  if (
    !cadastralReference &&
    lat === null &&
    !address &&
    !(intent === 'manual' && hasManualData)
  ) {
    return {
      status: 'error',
      message: 'Introduzca una referencia catastral, unas coordenadas o una dirección.',
    };
  }

  let result;
  try {
    const engine = new ContextDetectionEngine();
    const input = {
      cadastralReference,
      coordinates: lat !== null && lng !== null ? { lat, lng } : undefined,
      address: address || undefined,
    };

    if (intent === 'manual') {
      const recordedAt = attemptStartedAt;
      const requestedTechnicianValidation = formData.get('technicianValidated') === 'on';
      const technicianValidated = requestedTechnicianValidation &&
        hasOrganizationPermission(access.membershipRole, 'context.technical_review');
      if (requestedTechnicianValidation && !technicianValidated) {
        return {
          status: 'error',
          message: 'Tu rol permite guardar datos provisionales, pero no validarlos como t\u00e9cnico.',
        };
      }
      const manualContext: ManualTerritorialContext = {
        cadastralReference: cadastralReference ?? undefined,
        municipality: manualMunicipality || undefined,
        address: address || undefined,
        coordinates: input.coordinates,
        classification: manualClassification || undefined,
        category: manualCategory || undefined,
        area: manualArea || undefined,
        ordinance: manualOrdinance || undefined,
        observations: manualObservations || undefined,
        provenance: 'manual',
        verification: technicianValidated ? 'technician_validated' : 'unverified',
        recordedAt,
        validatedAt: technicianValidated ? recordedAt : undefined,
        validatedBy: technicianValidated ? access.userId : undefined,
      };
      result = await engine.recordManualContext(
        expedienteId,
        access.userId,
        input,
        manualContext
      );
    } else {
      result = await engine.detectContextFromInput(
        expedienteId,
        access.userId,
        input,
        attemptStartedAt
      );
    }
    if (!result) {
      return { status: 'error', message: 'No se ha encontrado el expediente.' };
    }

    const officialContext = intent === 'resolve' ? officialContextForUse(result) : undefined;
    if (officialContext) {
      const existingReference = normalizeCadastralReference(access.expediente.refCatastral);
      const locationChanged = Boolean(
        existingReference !== normalizeCadastralReference(officialContext.cadastralReference) ||
        (access.expediente.address?.trim() || '') !==
          (officialContext.normalizedAddress?.trim() || '') ||
        access.expediente.lat !== (officialContext.coordinates?.lat ?? null) ||
        access.expediente.lng !== (officialContext.coordinates?.lng ?? null)
      );
      await db
        .update(expedientes)
        .set({
          refCatastral: officialContext.cadastralReference ?? null,
          address: officialContext.normalizedAddress ?? null,
          lat: officialContext.coordinates?.lat ?? null,
          lng: officialContext.coordinates?.lng ?? null,
          location: officialContext.coordinates
            ? [officialContext.coordinates.lng, officialContext.coordinates.lat]
            : null,
          locationSource:
            officialContext.inputMethod === 'coordinates'
              ? 'coordinates'
              : officialContext.evidence.some((item) => item.source === 'catastro')
                ? 'cadastral_reference'
                : 'address',
          contextoValidadoPorTecnico: locationChanged
            ? false
            : access.expediente.contextoValidadoPorTecnico,
        })
        .where(and(eq(expedientes.id, expedienteId), eq(expedientes.orgId, access.orgId)));
    }
  } catch {
    return {
      status: 'error',
      message: 'No se ha podido completar la consulta territorial. Inténtelo de nuevo.',
    };
  }

  revalidatePath(`/expedientes/${expedienteId}`);
  if (intent === 'manual') {
    return {
      status: 'success',
      message:
        result.continuity?.manualContext?.verification === 'technician_validated'
          ? 'Datos manuales guardados como validados por el t\u00e9cnico, diferenciados de las fuentes oficiales.'
          : 'Datos manuales guardados como provisionales y pendientes de validaci\u00f3n.',
    };
  }
  const incompleteChecks = allSourceChecks(result).filter((check) =>
    ['partial', 'timeout', 'unavailable', 'malformed'].includes(check.status)
  );
  if (incompleteChecks.length > 0) {
    return {
      status: 'success',
      message: result.continuity?.usingPreviousOfficialContext
        ? `${incompleteChecks[0].message} Se conserva el \u00faltimo contexto oficial v\u00e1lido.`
        : `${incompleteChecks[0].message} Puedes reintentar o continuar con datos manuales.`,
    };
  }
  const message =
    result.status === 'confirmed'
      ? buildTerritorialContextView(result)?.status === 'confirmed'
        ? 'Ubicación confirmada y contexto territorial actualizado.'
        : 'Ubicación catastral confirmada, pero el contexto territorial sigue parcial y requiere completar municipio, planeamiento o clasificación.'
      : result.status === 'probable' || result.status === 'ambiguous'
        ? 'Se ha guardado un resultado aproximado que requiere validación.'
        : 'La consulta se ha guardado, pero no ha podido determinarse la ubicación.';
  return { status: 'success', message };
}
