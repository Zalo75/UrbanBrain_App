'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { getExpedienteAccess } from '@/application/authorization/expedienteAccess';
import { hasOrganizationPermission } from '@/application/authorization/organizationRoles';
import { ContextDetectionEngine } from '@/application/context-engine/ContextDetectionEngine';
import { normalizeCadastralReference } from '@/application/territorial-resolver/resolveParcelLocation';
import {
  allSourceChecks,
  effectiveOfficialContext,
  officialContextForUse,
} from '@/application/territorial-resolver/territorialContinuity';
import { territorialAffectKey } from '@/application/territorial-resolver/manualTerritorialContext';
import {
  actionAreaParcelSurface,
  createDetectedZoneActionArea,
  createWholeParcelActionArea,
  revokeActionAreaSelection,
} from '@/application/territorial-resolver/actionAreaSelection';
import { buildTerritorialContextView } from '@/application/territorial-resolver/territorialContextView';
import type {
  ManualAffectDecision,
  ManualTerritorialContext,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types';
import { db } from '@/infrastructure/db/client';
import { expedientes } from '@/infrastructure/db/schema';
import { loadAuthorizedParcelInputs } from '@/infrastructure/db/parcelContextRepository';
import { createTechnicianDetermination } from '@/domain/territorial-resolver/determinations';
import type { ContextDetermination } from '@/domain/territorial-resolver/types';
import { IdegAffectAdapter } from '@/infrastructure/territorial-resolver/IdegAffectAdapter';

function updateDetermination<T>(
  newValue: T | undefined,
  userId: string,
  existingAutomaticValue: T | undefined,
  isValidated: boolean,
  recordedAt: string
): ContextDetermination<T> | undefined {
  if (!newValue) return undefined;
  return createTechnicianDetermination(
    newValue,
    userId,
    existingAutomaticValue,
    { verification: isValidated ? 'technician_validated' : 'unverified', now: () => new Date(recordedAt) }
  );
}

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
  const revokeManualOrdinance = formData.get('manualOrdinanceRevoke') === 'on';
  const manualObservations = limitedText(formData, 'manualObservations', 1000);
  const actionAreaEdited = formData.get('actionAreaEdited') === '1';
  const hasManualData = Boolean(
    cadastralReference ||
      address ||
      lat !== null ||
      manualMunicipality ||
      manualClassification ||
      manualCategory ||
      manualArea ||
      manualOrdinance ||
      revokeManualOrdinance ||
      manualObservations ||
      actionAreaEdited
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
      const authorizedInputs = await loadAuthorizedParcelInputs(expedienteId, access.userId);
      const previousRaw = authorizedInputs?.latestDetectionRaw as TerritorialResolution | undefined;
      const previousManual = previousRaw?.continuity?.manualContext;
      const effectiveOfficial = previousRaw ? officialContextForUse(previousRaw) : undefined;
      let affectDecisions: ManualAffectDecision[] = previousManual?.affectDecisions ?? [];
      if (formData.get('manualAffectsEdited') === '1') {
        const automaticAffects = effectiveOfficialContext(previousRaw)?.affects.detected ?? [];
        const previousByTarget = new Map(
          affectDecisions.map((decision) => [decision.targetKey ?? decision.id, decision])
        );
        const reviewed: ManualAffectDecision[] = [];
        for (const [index, affect] of automaticAffects.entries()) {
          const targetKey = territorialAffectKey(affect);
          const requestedAction = textValue(formData, `manualAffectAction.${index}`);
          const reason = limitedText(formData, `manualAffectReason.${index}`, 500);
          const previous = previousByTarget.get(targetKey);
          if (!requestedAction) {
            if (previous) reviewed.push(previous);
            continue;
          }
          if (requestedAction !== 'confirm' && requestedAction !== 'exclude') {
            return {
              status: 'error',
              message: 'La decisión manual sobre una afección no es válida.',
            };
          }
          if (requestedAction === 'exclude' && !reason) {
            return {
              status: 'error',
              message: `Indique el motivo para excluir operativamente la afección “${affect.name}”.`,
            };
          }
          reviewed.push({
            id: previous?.id ?? crypto.randomUUID(),
            targetKey,
            category: affect.category,
            name: affect.name,
            action: requestedAction,
            reason: reason || 'Confirmada manualmente en el diagnóstico territorial.',
            provenance: 'manual',
            verification: technicianValidated ? 'technician_validated' : 'unverified',
            recordedAt,
            recordedBy: access.userId,
            validatedAt: technicianValidated ? recordedAt : undefined,
            validatedBy: technicianValidated ? access.userId : undefined,
          });
        }
        const previousAdditions = affectDecisions.filter((decision) => decision.action === 'add');
        for (const [index, previous] of previousAdditions.entries()) {
          if (formData.get(`manualAddedAffectIncluded.${index}`) !== 'on') continue;
          reviewed.push({
            ...previous,
            reason:
              limitedText(formData, `manualAddedAffectReason.${index}`, 500) || previous.reason,
            verification: technicianValidated ? 'technician_validated' : 'unverified',
            recordedAt,
            recordedBy: access.userId,
            validatedAt: technicianValidated ? recordedAt : undefined,
            validatedBy: technicianValidated ? access.userId : undefined,
          });
        }
        const addedCategory = limitedText(formData, 'manualAffectCategory', 100);
        const addedName = limitedText(formData, 'manualAffectName', 160);
        const addedReason = limitedText(formData, 'manualAffectAddReason', 500);
        if (addedCategory || addedName || addedReason) {
          if (!addedCategory || !addedName || !addedReason) {
            return {
              status: 'error',
              message: 'Para añadir una afección manual indique categoría, nombre y motivo.',
            };
          }
          reviewed.push({
            id: crypto.randomUUID(),
            category: addedCategory,
            name: addedName,
            action: 'add',
            reason: addedReason,
            provenance: 'manual',
            verification: technicianValidated ? 'technician_validated' : 'unverified',
            recordedAt,
            recordedBy: access.userId,
            validatedAt: technicianValidated ? recordedAt : undefined,
            validatedBy: technicianValidated ? access.userId : undefined,
          });
        }
        affectDecisions = reviewed;
      }
      const classTech = updateDetermination(manualClassification || undefined, access.userId, authorizedInputs?.detected?.classificationDetermination?.automatic?.value, technicianValidated, recordedAt);
      const catTech = updateDetermination(manualCategory || undefined, access.userId, authorizedInputs?.detected?.categoryDetermination?.automatic?.value, technicianValidated, recordedAt);
      const existingOrdinance = previousManual?.ordinance;
      const ordinanceChanged = manualOrdinance !== existingOrdinance;
      const ordTech = revokeManualOrdinance
        ? undefined
        : manualOrdinance &&
            (ordinanceChanged || !previousManual?.ordinanceDetermination?.technician)
          ? updateDetermination(
              manualOrdinance,
              access.userId,
              authorizedInputs?.detected?.ordinanceDetermination?.automatic?.value,
              technicianValidated,
              recordedAt
            )
          : previousManual?.ordinanceDetermination?.technician;
      const effectiveManualOrdinance = revokeManualOrdinance
        ? undefined
        : manualOrdinance || existingOrdinance;

      let actionAreaSelection = previousManual?.actionAreaSelection;
      let actionAreaChanged = false;
      if (actionAreaEdited) {
        const actionAreaMode = textValue(formData, 'actionAreaMode');
        const requestedAreaValidation = formData.get('actionAreaValidated') === 'on';
        const actionAreaValidated = requestedAreaValidation &&
          hasOrganizationPermission(access.membershipRole, 'context.technical_review');
        if (requestedAreaValidation && !actionAreaValidated) {
          return {
            status: 'error',
            message: 'Tu rol permite seleccionar un área, pero no validarla como técnico.',
          };
        }
        const areaVerification = actionAreaValidated ? 'technician_validated' : 'unverified';
        if (actionAreaMode === 'detected_zone') {
          const candidateId = textValue(formData, 'actionAreaCandidateId');
          const candidate = effectiveOfficial?.planning.classificationResolution?.candidates.find(
            (item) => item.id === candidateId
          );
          if (!candidate?.parcelCoverage?.intersectionGeometry) {
            return {
              status: 'error',
              message: 'La zona seleccionada no dispone de una geometría oficial utilizable.',
            };
          }
          const areaAffects = await new IdegAffectAdapter().findAffects({
            geometry: candidate.parcelCoverage.intersectionGeometry,
          });
          actionAreaSelection = createDetectedZoneActionArea({
            candidate,
            selectedBy: access.userId,
            selectedAt: recordedAt,
            verification: areaVerification,
            affects: areaAffects,
            previous: previousManual?.actionAreaSelection,
          });
          if (!actionAreaSelection) {
            return {
              status: 'error',
              message: 'No se ha podido construir el área de actuación desde la zona detectada.',
            };
          }
          actionAreaChanged =
            previousManual?.actionAreaSelection?.current?.selectedCandidateId !== candidateId;
        } else if (actionAreaMode === 'whole_parcel') {
          const geometry = effectiveOfficial?.parcelGeometry;
          const surfaceSquareMetres = actionAreaParcelSurface(effectiveOfficial);
          if (!geometry || !surfaceSquareMetres) {
            return {
              status: 'error',
              message: 'La parcela completa no dispone de geometría y superficie calculada.',
            };
          }
          actionAreaSelection = createWholeParcelActionArea({
            geometry,
            surfaceSquareMetres,
            selectedBy: access.userId,
            selectedAt: recordedAt,
            verification: areaVerification,
            affects: effectiveOfficial.affects,
            previous: previousManual?.actionAreaSelection,
          });
          actionAreaChanged =
            previousManual?.actionAreaSelection?.current?.selectionType !== 'whole_parcel';
        } else if (actionAreaMode === 'revoke') {
          actionAreaSelection = revokeActionAreaSelection(
            previousManual?.actionAreaSelection,
            access.userId,
            recordedAt
          );
          actionAreaChanged = Boolean(previousManual?.actionAreaSelection?.current);
        } else {
          return { status: 'error', message: 'La selección del área de actuación no es válida.' };
        }
      }

      const preservedManual = actionAreaEdited ? previousManual : undefined;
      const finalManualOrdinance = actionAreaChanged
        ? undefined
        : (effectiveManualOrdinance ?? preservedManual?.ordinance);
      const finalOrdinanceDetermination = actionAreaChanged
        ? undefined
        : (ordTech ?? preservedManual?.ordinanceDetermination?.technician);
      const finalAffectDecisions = actionAreaChanged ? [] : affectDecisions;

      const manualContext: ManualTerritorialContext = {
        cadastralReference: cadastralReference ?? preservedManual?.cadastralReference,
        municipality: manualMunicipality || preservedManual?.municipality,
        address: address || preservedManual?.address,
        coordinates: input.coordinates ?? preservedManual?.coordinates,
        classification: manualClassification || preservedManual?.classification,
        category: manualCategory || preservedManual?.category,
        area: manualArea || preservedManual?.area,
        ordinance: finalManualOrdinance,
        observations: manualObservations || preservedManual?.observations,
        classificationDetermination: classTech
          ? { technician: classTech }
          : preservedManual?.classificationDetermination,
        categoryDetermination: catTech
          ? { technician: catTech }
          : preservedManual?.categoryDetermination,
        ordinanceDetermination: finalOrdinanceDetermination
          ? { technician: finalOrdinanceDetermination }
          : undefined,
        actionAreaSelection,
        affectDecisions: finalAffectDecisions,
        urbanisticFacts: previousManual?.urbanisticFacts,
        provenance: 'manual',
        verification: actionAreaEdited
          ? (previousManual?.verification ?? 'unverified')
          : technicianValidated
            ? 'technician_validated'
            : 'unverified',
        recordedAt,
        validatedAt: actionAreaEdited
          ? previousManual?.validatedAt
          : technicianValidated
            ? recordedAt
            : undefined,
        validatedBy: actionAreaEdited
          ? previousManual?.validatedBy
          : technicianValidated
            ? access.userId
            : undefined,
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
        .where(and(eq(expedientes.id, expedienteId), eq(expedientes.ownerId, access.userId)));
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
