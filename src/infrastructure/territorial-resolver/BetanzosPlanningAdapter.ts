import type {
  ParcelGeometry,
  PlanningApplicability,
  PlanningPort,
  TerritorialCoordinates,
  TerritorialEvidence,
  TerritorialWarning,
} from '@/domain/territorial-resolver/types';
import {
  BETANZOS_CURRENT_INSTRUMENT,
  BETANZOS_NON_SPATIALLY_BOUND_INSTRUMENTS,
  BETANZOS_REGISTRY,
} from '@/municipal-pilots/betanzos/registry';

function warning(code: string, message: string): TerritorialWarning {
  return { code, message };
}

function registryEvidence(now: string): TerritorialEvidence {
  return {
    source: 'siotuga',
    sourceUrl: BETANZOS_REGISTRY.sources.inventory,
    retrievedAt: now,
    method: `registro municipal versionado ${BETANZOS_REGISTRY.registryVersion}`,
    scope: 'planning_instrument',
  };
}

/**
 * Complements the general planning catalogue with Betanzos' audited instrument
 * and document registry. Spatial classification remains the responsibility of
 * the generic SIOTUGA adapter registered by municipality code.
 */
export class BetanzosPlanningAdapter implements PlanningPort {
  constructor(
    private readonly fallback: PlanningPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async findApplicablePlanning(location: {
    municipalityCode?: string;
    coordinates?: TerritorialCoordinates;
    geometry?: ParcelGeometry;
  }): Promise<PlanningApplicability> {
    if (location.municipalityCode !== BETANZOS_REGISTRY.municipality.ineCode) {
      return this.fallback.findApplicablePlanning(location);
    }

    return {
      status: 'partial',
      instrument: BETANZOS_CURRENT_INSTRUMENT.name,
      approvalDate: BETANZOS_CURRENT_INSTRUMENT.approvalDate,
      sourceUrl: BETANZOS_CURRENT_INSTRUMENT.sourceUrl,
      applicableInstruments: [BETANZOS_CURRENT_INSTRUMENT],
      cataloguedInstruments: BETANZOS_NON_SPATIALLY_BOUND_INSTRUMENTS,
      documents: BETANZOS_REGISTRY.documents,
      canAnswerConcreteParameters: false,
      evidence: [registryEvidence(this.now().toISOString())],
      warnings: [
        warning(
          'betanzos_zoning_raster_only',
          'La ordenación pormenorizada no dispone de atributos vectoriales suficientes; no se asignan ordenanza ni parámetros automáticamente.'
        ),
        warning(
          'betanzos_instruments_need_spatial_validation',
          'Las modificaciones puntuales y el planeamiento de desarrollo están inventariados, pero su aplicabilidad espacial requiere validación técnica.'
        ),
        warning(
          'normative_binding_not_verified',
          'Los documentos normativos generales están enlazados, pero no existe una correspondencia oficial inequívoca entre el recinto detectado y artículos con parámetros concretos.'
        ),
        ...(location.geometry
          ? []
          : [
              warning(
                'point_only_planning_analysis',
                'La clasificación sólo puede comprobarse sobre un punto y puede diferir en el resto de la parcela.'
              ),
            ]),
      ],
    };
  }
}
