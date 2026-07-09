const { getProvinceByName, getMunicipalityByName } = require('./src/shared/territory/index.ts');
// Wait, I can't require TS file in raw Node.js.
// Let's just create a raw node script that copies the normalization logic and the array.
