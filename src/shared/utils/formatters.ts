export function formatActionType(actionType: string | null | undefined): string {
  if (!actionType) return '';
  const mapping: Record<string, string> = {
    'consulta_urbanistica': 'Consulta Urbanística',
    'informe_urbanistico': 'Informe Urbanístico',
    'vivienda_unifamiliar': 'Vivienda Unifamiliar',
    'reforma': 'Reforma',
    'segregacion': 'Segregación',
    'parcelacion': 'Parcelación',
    'cambio_de_uso': 'Cambio de Uso',
    'nave': 'Nave Industrial/Agrícola',
    'legalizacion': 'Legalización',
    'demolicion': 'Demolición',
    'otro': 'Otro'
  };
  return mapping[actionType] || actionType;
}

export function formatLandClass(landClass: string | null | undefined): string {
  if (!landClass) return '';
  const mapping: Record<string, string> = {
    'desconocido': 'Desconocido',
    'urbano_consolidado': 'Urbano Consolidado',
    'urbano_no_consolidado': 'Urbano No Consolidado',
    'urbanizable': 'Urbanizable',
    'rustico_no_urbanizable': 'Rústico / No Urbanizable',
    'nucleo_rural': 'Núcleo Rural'
  };
  return mapping[landClass] || landClass;
}

export function formatLocationSource(source: string | null | undefined): string {
  if (!source) return '';
  const mapping: Record<string, string> = {
    'cadastral_reference': 'Catastro',
    'address': 'Dirección',
    'coordinates': 'Coordenadas',
    'planning_area': 'Ámbito',
    'manual': 'Manual'
  };
  return mapping[source] || source;
}
