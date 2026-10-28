import { config } from '../src/config.js';
import { conectarDb, db } from '../src/db.js';
import { prepararBase } from '../src/bootstrap.js';
import { CLAVE_DEMO, sembrarDemo, USUARIOS_DEMO } from '../src/seed-demo.js';

if (config.produccion) {
  console.error('No se cargan datos de ejemplo en producción: crean usuarios con claves conocidas.');
  process.exit(1);
}
await conectarDb(config);
await prepararBase();
if (await sembrarDemo()) {
  console.log('Datos de ejemplo cargados. Usuarios (clave para todos: %s):', CLAVE_DEMO);
  for (const [nombre, email, rol] of USUARIOS_DEMO) console.log(`  ${email.padEnd(22)} ${rol}  (${nombre})`);
} else {
  console.log('Ya hay datos cargados: no se cambió nada.');
}
await db.cerrar();
