async function test() {
  const rc = "3125947NH4832S0000JK";
  const url = `http://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_CPRC?Provincia=&Municipio=&SRS=EPSG:4326&RefCat=${rc}`;
  try {
    const res = await fetch(url);
    const data = await res.text();
    console.log(data);
  } catch (e) {
    console.error(e);
  }
}
test();
