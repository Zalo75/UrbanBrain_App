import { Ccaa, Province, Municipality } from './types';
import { galiciaCcaa, galiciaProvinces } from './ccaa/galicia';
import { aCorunaMunicipalities } from './provinces/a_coruna';

export * from './types';

export const allCcaa: Ccaa[] = [
  galiciaCcaa
];

export const allProvinces: Province[] = [
  ...galiciaProvinces
];

export const allMunicipalities: Municipality[] = [
  ...aCorunaMunicipalities
].sort((a, b) => a.name.localeCompare(b.name, 'es'));

export function getEnabledCcaa() {
  return allCcaa.filter(c => c.enabled);
}

export function getEnabledProvinces() {
  return allProvinces.filter(p => p.enabled);
}

export function getProvincesByCcaa(ccaaId: string) {
  return allProvinces.filter(p => p.ccaaId === ccaaId);
}

export function getEnabledProvincesByCcaa(ccaaId: string) {
  return allProvinces.filter(p => p.ccaaId === ccaaId && p.enabled);
}

export function getMunicipalitiesByProvince(provinceId: string) {
  return allMunicipalities.filter(m => m.provinceId === provinceId);
}

export function getEnabledMunicipalitiesByProvince(provinceId: string) {
  return allMunicipalities.filter(m => m.provinceId === provinceId && m.enabled);
}

export function isMunicipalityEnabled(municipalityId: string): boolean {
  const mun = allMunicipalities.find(m => m.id === municipalityId);
  return mun ? mun.enabled : false;
}

export function getProvinceNameById(provinceId: string): string {
  const prov = allProvinces.find(p => p.id === provinceId);
  return prov ? prov.name : provinceId;
}

export function getProvinceById(provinceId: string): Province | undefined {
  return allProvinces.find((province) => province.id === provinceId);
}

export function getMunicipalityNameById(municipalityId: string): string {
  const mun = allMunicipalities.find(m => m.id === municipalityId);
  return mun ? mun.name : municipalityId;
}

export function getMunicipalityById(municipalityId: string): Municipality | undefined {
  return allMunicipalities.find((municipality) => municipality.id === municipalityId);
}

export function getProvinceByName(name: string): Province | undefined {
  if (!name) return undefined;
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return allProvinces.find(p => 
    p.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() === normalized
  );
}

export function getMunicipalityByName(name: string): Municipality | undefined {
  if (!name) return undefined;
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return allMunicipalities.find(m => 
    m.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() === normalized
  );
}

export function getMunicipalityByIneCode(ineCode: string | null | undefined): Municipality | undefined {
  const normalized = ineCode?.replace(/\D/g, '');
  return normalized
    ? allMunicipalities.find((municipality) => municipality.ineCode === normalized)
    : undefined;
}

function normalizeTerritoryText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function municipalityFromAddress(address: string | null | undefined): Municipality | undefined {
  if (!address) return undefined;
  const withoutProvinceSuffix = address.replace(/\([^)]*\)\s*$/u, '');
  const normalizedAddress = ` ${normalizeTerritoryText(withoutProvinceSuffix)} `;
  const matches = allMunicipalities.filter((municipality) =>
    normalizedAddress.includes(` ${normalizeTerritoryText(municipality.name)} `)
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Normalizes Catastro municipality data through the existing territorial catalogue.
 * Address matching is a conservative fallback for records that omit the dedicated
 * municipality field; ambiguity intentionally remains unresolved.
 */
export function resolveMunicipalityIdentity(input: {
  municipality?: string | null;
  municipalityCode?: string | null;
  address?: string | null;
}): Municipality | undefined {
  return (
    getMunicipalityByIneCode(input.municipalityCode) ??
    getMunicipalityByName(input.municipality ?? '') ??
    municipalityFromAddress(input.address)
  );
}
