async function detectContext(refCatastral) {
  const url = `http://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCallejero.asmx/Consulta_DNPRC?Provincia=&Municipio=&RC=${refCatastral}`;
  try {
    const res = await fetch(url);
    const xml = await res.text();
    
    const extract = (tag) => {
      const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
      return match ? match[1].trim() : null;
    };
    
    // <np> = provincia, <nm> = municipio, <ldt> = direccion larga
    const np = extract('np');
    const nm = extract('nm');
    const ldt = extract('ldt');
    
    // Limpiar direccion: "AV CORUÑA  Suelo 3125943-42-34-NH4832S 15185 CERCEDA (A CORUÑA)"
    // Catastro mete el RC en el medio a veces en rústica/suelo
    
    let address = null;
    const nv = extract('nv');
    const tv = extract('tv');
    const cv = extract('cv'); // numero
    if (tv && nv) {
      address = `${tv} ${nv} ${cv ? cv : ''}`.trim();
    } else if (ldt) {
      address = ldt.split(' Suelo ')[0]; // heuristica basica
    }
    
    return {
      province: np,
      municipality: nm,
      address
    }
  } catch (e) {
    console.error(e);
    return null;
  }
}

detectContext("3125947NH4832S0000JK").then(console.log);
