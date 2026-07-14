import { resolveParcelLocation } from '../src/application/territorial-resolver/resolveParcelLocation';
import { BetanzosPlanningAdapter } from '../src/infrastructure/territorial-resolver/BetanzosPlanningAdapter';
import { CartoCiudadOfficialAdapter } from '../src/infrastructure/territorial-resolver/CartoCiudadOfficialAdapter';
import { CatastroOfficialAdapter } from '../src/infrastructure/territorial-resolver/CatastroOfficialAdapter';
import { DatabasePlanningAdapter } from '../src/infrastructure/territorial-resolver/DatabasePlanningAdapter';
import { IdegAffectAdapter } from '../src/infrastructure/territorial-resolver/IdegAffectAdapter';

const reference = process.env.BETANZOS_TEST_CADASTRAL_REFERENCE;
if (!reference) {
  throw new Error(
    'Define BETANZOS_TEST_CADASTRAL_REFERENCE sólo en tu entorno local para ejecutar esta comprobación.'
  );
}

const result = await resolveParcelLocation(
  { cadastralReference: reference },
  {
    catastro: new CatastroOfficialAdapter(),
    geocoder: new CartoCiudadOfficialAdapter(),
    planning: new BetanzosPlanningAdapter(new DatabasePlanningAdapter()),
    affects: new IdegAffectAdapter(),
  }
);

const normalized = reference.toUpperCase().replace(/[^A-Z0-9]/g, '');
const maskedReference = `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;

console.log({
  cadastralReference: maskedReference,
  locationStatus: result.status,
  municipality: result.municipality,
  municipalityCode: result.municipalityCode,
  geometryAvailable: Boolean(result.parcelGeometry),
  planningStatus: result.planning.status,
  classificationCode: result.planning.classification?.code,
  categoryCode: result.planning.classification?.categoryCode,
  areas: result.planning.areas?.map((area) => ({ type: area.type, name: area.name })),
  canAnswerConcreteParameters: result.planning.canAnswerConcreteParameters ?? false,
  affectCategories: [...new Set(result.affects.detected.map((affect) => affect.category))],
  warningCodes: [
    ...result.warnings.map((warning) => warning.code),
    ...result.planning.warnings.map((warning) => warning.code),
    ...result.affects.warnings.map((warning) => warning.code),
  ],
});
