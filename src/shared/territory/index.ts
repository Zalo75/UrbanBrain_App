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

export function getMunicipalityNameById(municipalityId: string): string {
  const mun = allMunicipalities.find(m => m.id === municipalityId);
  return mun ? mun.name : municipalityId;
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
