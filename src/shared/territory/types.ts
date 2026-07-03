export interface Ccaa {
  id: string;
  name: string;
  enabled: boolean;
}

export interface Province {
  id: string;
  name: string;
  ccaaId: string;
  enabled: boolean;
}

export interface Municipality {
  id: string;
  name: string;
  provinceId: string;
  ccaaId: string;
  enabled: boolean;
  coverageStatus: 'active' | 'pending' | 'disabled';
  ineCode?: string;
  source?: string;
}
