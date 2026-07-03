import { Ccaa, Province } from '../types';

export const galiciaCcaa: Ccaa = {
  id: 'galicia',
  name: 'Galicia',
  enabled: true
};

export const galiciaProvinces: Province[] = [
  { id: 'a_coruna', name: 'A Coruña', ccaaId: 'galicia', enabled: true },
  { id: 'lugo', name: 'Lugo', ccaaId: 'galicia', enabled: false },
  { id: 'ourense', name: 'Ourense', ccaaId: 'galicia', enabled: false },
  { id: 'pontevedra', name: 'Pontevedra', ccaaId: 'galicia', enabled: false }
];
