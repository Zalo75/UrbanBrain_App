import { Expediente, ContextDetectionResult, IContextDetector } from '@/domain/context-engine/types';
import { getProvinceByName, getMunicipalityByName } from '@/shared/territory';

export class CatastroDetector implements IContextDetector {
  public readonly name = 'catastro';

  async detect(expediente: Expediente, currentResult: ContextDetectionResult): Promise<ContextDetectionResult> {
    const rc = expediente.refCatastral?.trim().toUpperCase();
    
    if (!rc) {
      currentResult.errors[this.name] = "El expediente no tiene referencia catastral válida.";
      return currentResult;
    }

    const url = `http://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCallejero.asmx/Consulta_DNPRC?Provincia=&Municipio=&RC=${rc}`;
    
    try {
      const res = await fetch(url);
      const xml = await res.text();
      
      const extract = (tag: string) => {
        const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\/${tag}>`, 'i'));
        return match ? match[1].trim() : null;
      };
      
      const np = extract('np');
      const nm = extract('nm');
      const ldt = extract('ldt');
      
      let address = null;
      const nv = extract('nv');
      const tv = extract('tv');
      const cv = extract('cv');
      
      if (tv && nv) {
        address = `${tv} ${nv} ${cv ? cv : ''}`.trim();
      } else if (ldt) {
        address = ldt.split(' Suelo ')[0].trim();
      }
      
      const prov = getProvinceByName(np || '');
      const mun = getMunicipalityByName(nm || '');

      // Modificamos el resultado del pipeline
      currentResult.sourceApis.push(this.name);
      currentResult.rawResponses[this.name] = { np, nm, address_raw: address, xml_sample: xml.substring(0, 500) };
      
      if (prov) currentResult.summary.provinceId = prov.id;
      if (mun) currentResult.summary.municipalityId = mun.id;
      if (np) currentResult.summary.provinceName = np;
      if (nm) currentResult.summary.municipalityName = nm;
      if (address) currentResult.summary.address = address;

    } catch (error: any) {
      currentResult.errors[this.name] = `Error conectando con Catastro: ${error.message || error}`;
    }

    return currentResult;
  }
}
