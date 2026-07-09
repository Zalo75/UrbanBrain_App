import { detectContextAction } from './src/app/(dashboard)/expedientes/new/actions';

async function run() {
  const fd = new FormData();
  fd.append('refCatastral', '3125947NH4832S0000JK');
  const res = await detectContextAction(fd);
  console.log(res);
}

run();
